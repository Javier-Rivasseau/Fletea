// ============================================================
// FletesCerealeros - Conversation Handler (Orquestador)
// Flujo: Mensaje → Identificar usuario → Kimi AI → Acciones → Matching → Respuesta
// ============================================================
const { processMessage: aiProcess } = require('../ai/kimi');
const { sendWhatsAppMessage } = require('../whatsapp/sender');
const { findMatchesForRetorno, findMatchesForPedido } = require('../matching/matcher');
const db = require('../db/database');
const logger = require('../utils/logger');

// Almacenamiento de callbacks para notificación en simulación web
let webNotifyCallback = null;
function setWebNotifyCallback(cb) { webNotifyCallback = cb; }

async function handleIncomingMessage({ phone, text, name, source }) {
    logger.info(`🔄 Procesando mensaje de ${phone} (${source}): "${text}"`);

    // 1. Guardar mensaje del usuario en historial
    await db.saveConversation(phone, 'user', text);

    // 2. Obtener historial de conversación
    const history = await db.getConversationHistory(phone, 15);

    // 3. Enviar a Kimi / AI local para procesamiento
    const dbOps = { getUser: db.getUser, getAllUsers: db.getAllUsers };
    const aiResult = await aiProcess(phone, text, history, dbOps);

    logger.info(`🤖 Respuesta AI: "${aiResult.text.substring(0, 100)}..."`);
    if (aiResult.action) {
        logger.info(`⚡ Acción detectada: ${aiResult.action.action}`);
    }

    // 4. Ejecutar acciones detectadas
    let matchNotifications = [];
    if (aiResult.action) {
        matchNotifications = await executeAction(phone, name, aiResult.action);
    }

    // 5. Guardar respuesta del asistente en historial
    await db.saveConversation(phone, 'assistant', aiResult.text);

    // DEPRECATED: La función ya no envía mensajes directamente.
    // El llamador (client.js o api.js) es responsable de enviar la respuesta y las notificaciones.
    // Esto desacopla la lógica del transporte (WhatsApp/Web).
    /*
    await sendResponse(phone, aiResult.text, source);
    for (const notification of matchNotifications) {
        await sendResponse(notification.phone, notification.text, source);
    }
    */

    // Guardar las notificaciones extra en el historial también
    for (const notification of matchNotifications) {
        await db.saveConversation(notification.phone, 'assistant', notification.text);
    }

    return { response: aiResult.text, action: aiResult.action, matchNotifications };
}

async function executeAction(phone, name, action) {
    const notifications = [];

    switch (action.action) {
        case 'REGISTRAR_USUARIO': {
            const data = action.data;
            await db.findOrCreateUser(phone, data.name || name, data.type || 'camionero', data.locality);
            if (data.name || data.type || data.locality) {
                await db.updateUser(phone, {
                    name: data.name || name,
                    type: data.type,
                    locality: data.locality,
                });
            }
            logger.info(`👤 Usuario registrado: ${data.name || name} (${data.type}) de ${data.locality}`);
            break;
        }

        case 'ACTUALIZAR_USUARIO': {
            const data = action.data;
            await db.updateUser(phone, data);
            logger.info(`👤 Usuario actualizado: ${phone}`);
            break;
        }

        case 'RETORNO_VACIO': {
            const user = await db.findOrCreateUser(phone, name, 'camionero');
            const trip = await db.createTrip(user.id, 'retorno_vacio', action.data.origin, action.data.destination, {
                time_estimate: action.data.time_estimate,
                date: action.data.date || 'hoy',
            });
            logger.info(`🔄 Retorno vacío registrado: ${action.data.origin} → ${action.data.destination}`);

            // MATCHING: Buscar pedidos que se puedan servir con este retorno
            const pedidos = await db.getActiveTrips('pedido_flete');
            const matches = findMatchesForRetorno(trip, pedidos);

            if (matches.length > 0) {
                for (const match of matches.slice(0, 3)) { // Máximo 3 notificaciones
                    const pedido = match.pedido;

                    // Crear match en BD
                    await db.createMatch(trip.id, pedido.id, user.id, pedido.user_id, match.score);

                    // Notificar al productor
                    notifications.push({
                        phone: pedido.user_phone,
                        text: `🎯 ¡Hay un camionero disponible para tu flete!\n\n` +
                            `🚛 ${user.name || 'Camionero'} vuelve de ${action.data.origin} hacia ${action.data.destination}` +
                            (action.data.time_estimate ? ` (llega en ${action.data.time_estimate})` : '') +
                            `.\n\nTu pedido: ${pedido.tons ? pedido.tons + ' tn de ' : ''}${pedido.cereal_type || 'cereal'}, ${pedido.origin} → ${pedido.destination}` +
                            `\n\n¿Te interesa? Respondé "sí" o "no".`,
                    });

                    // Notificar al camionero que hay match
                    notifications.push({
                        phone: phone,
                        text: `🎯 ¡Encontré carga para tu retorno!\n\n` +
                            `🌾 ${pedido.user_name || 'Productor'} de ${pedido.user_locality || pedido.origin} necesita mover ` +
                            `${pedido.tons ? pedido.tons + ' tn de ' : ''}${pedido.cereal_type || 'cereal'} a ${pedido.destination}` +
                            `\n\nScore de compatibilidad: ${match.score}/100` +
                            `\n\n¿Lo tomás? Respondé "sí" o "no".`,
                    });

                    logger.info(`🎯 MATCH! Camionero ${user.name} ↔ Productor ${pedido.user_name} (score: ${match.score})`);
                }
            }
            break;
        }

        case 'PEDIDO_FLETE': {
            const user = await db.findOrCreateUser(phone, name, 'productor');
            if (user.type === 'camionero') {
                await db.updateUser(phone, { type: 'ambos' });
            }
            const trip = await db.createTrip(user.id, 'pedido_flete', action.data.origin, action.data.destination, {
                cereal_type: action.data.cereal_type,
                tons: action.data.tons,
                date: action.data.date || 'flexible',
            });
            logger.info(`📦 Pedido de flete registrado: ${action.data.origin} → ${action.data.destination}`);

            // MATCHING: Buscar retornos vacíos que puedan servir
            const retornos = await db.getActiveTrips('retorno_vacio');
            const matches = findMatchesForPedido(trip, retornos);

            if (matches.length > 0) {
                const best = matches[0];

                await db.createMatch(best.retorno.id, trip.id, best.retorno.user_id, user.id, best.score);

                notifications.push({
                    phone: best.retorno.user_phone,
                    text: `🎯 ¡Hay carga para tu retorno vacío!\n\n` +
                        `🌾 ${user.name || 'Productor'} de ${action.data.origin} necesita mover ` +
                        `${action.data.tons ? action.data.tons + ' tn de ' : ''}${action.data.cereal_type || 'cereal'} a ${action.data.destination}` +
                        `\n\n¿Te interesa? Respondé "sí" o "no".`,
                });

                notifications.push({
                    phone: phone,
                    text: `🎯 ¡Encontré un camionero!\n\n` +
                        `🚛 ${best.retorno.user_name || 'Camionero'} viene de ${best.retorno.origin} hacia ${best.retorno.destination}` +
                        `\n\nScore de compatibilidad: ${best.score}/100` +
                        `\n\nTe aviso cuando confirme. ✅`,
                });

                logger.info(`🎯 MATCH! Productor ${user.name} ↔ Camionero ${best.retorno.user_name} (score: ${best.score})`);
            }
            break;
        }

        case 'OFERTA_FLETE': {
            const user = await db.findOrCreateUser(phone, name, 'camionero');
            const trip = await db.createTrip(user.id, 'oferta_flete', action.data.origin, action.data.destination, {
                date: action.data.date,
            });
            logger.info(`🚛 Oferta de flete registrada: ${action.data.origin} → ${action.data.destination}`);
            break;
        }

        case 'CONSULTAR_DISPONIBILIDAD': {
            const activeTrips = await db.getActiveTrips();
            const retornos = activeTrips.filter(t => t.type === 'retorno_vacio');
            const pedidos = activeTrips.filter(t => t.type === 'pedido_flete');
            const ofertas = activeTrips.filter(t => t.type === 'oferta_flete');

            let availText = '📋 *Disponibilidad actual:*\n\n';

            if (retornos.length > 0) {
                availText += `🔄 *Retornos vacíos (${retornos.length}):*\n`;
                retornos.slice(0, 5).forEach(r => {
                    availText += `  • ${r.user_name || 'Camionero'}: ${r.origin} → ${r.destination}${r.time_estimate ? ' (' + r.time_estimate + ')' : ''}\n`;
                });
                availText += '\n';
            }

            if (pedidos.length > 0) {
                availText += `🌾 *Pedidos de flete (${pedidos.length}):*\n`;
                pedidos.slice(0, 5).forEach(p => {
                    availText += `  • ${p.user_name || 'Productor'}: ${p.tons ? p.tons + 'tn ' : ''}${p.cereal_type || ''} ${p.origin} → ${p.destination}\n`;
                });
                availText += '\n';
            }

            if (ofertas.length > 0) {
                availText += `🚛 *Viajes ofrecidos (${ofertas.length}):*\n`;
                ofertas.slice(0, 5).forEach(o => {
                    availText += `  • ${o.user_name || 'Camionero'}: ${o.origin} → ${o.destination}\n`;
                });
            }

            if (activeTrips.length === 0) {
                availText = '📋 No hay viajes registrados todavía. ¡Sé el primero!';
            }

            notifications.push({ phone, text: availText });
            break;
        }

        case 'CONFIRMAR_MATCH': {
            // Buscar si el usuario tiene un match pendiente ("propuesto")
            const user = await db.getUser(phone);
            if (!user) break;

            const match = await db.getPendingMatchForUser(user.id);

            if (match) {
                // Confirmamos el match
                await db.updateMatchStatus(match.id, 'aceptado');
                logger.info(`✅ Match confirmado: Match ID ${match.id} (Camionero: ${match.camionero_name}, Productor: ${match.productor_name})`);

                // Identificar quién es quién
                const isCamionero = user.id === match.camionero_id;
                const otherPartyPhone = isCamionero ? match.productor_phone : match.camionero_phone;
                const otherPartyName = isCamionero ? match.productor_name : match.camionero_name;

                // Mensaje para el usuario actual (quien confirmó)
                notifications.push({
                    phone: phone,
                    text: `🎉 *¡Excelente! Match confirmado.* 🎉\n\n` +
                        `Acá tenés los datos para contactarlo:\n` +
                        `👤 *${otherPartyName}*\n` +
                        `📱 *${otherPartyPhone}*\n` +
                        `📍 ${isCamionero ? match.productor_locality : match.camionero_locality}\n\n` +
                        `¡Escribile ahora para coordinar! 🤝`
                });

                // Mensaje para la otra parte
                notifications.push({
                    phone: otherPartyPhone,
                    text: `🎉 *¡Buenas noticias! Se confirmó el viaje.* 🎉\n\n` +
                        `El usuario *${user.name}* aceptó la propuesta.\n\n` +
                        `Datos de contacto:\n` +
                        `👤 *${user.name}*\n` +
                        `📱 *${phone}*\n` +
                        `📍 ${user.locality || 'Zona Pehuajó'}\n\n` +
                        `¡Contáctense para coordinar la carga! 🚛`
                });

            } else {
                notifications.push({
                    phone: phone,
                    text: '⚠️ No encontré ninguna propuesta de viaje pendiente para confirmar. Decime "Ayuda" si necesitás ver tus opciones.'
                });
            }
            break;
        }

        case 'RECHAZAR_MATCH': {
            const user = await db.getUser(phone);
            if (!user) break;
            const match = await db.getPendingMatchForUser(user.id);

            if (match) {
                await db.updateMatchStatus(match.id, 'rechazado');
                logger.info(`❌ Match rechazado por ${user.name}`);

                // Avisar a la otra parte (opcional, por ahora solo confirmamos rechazo al usuario)
                // notifications.push({ phone: phone, text: 'Listo, propuesta rechazada. Te aviso si sale otra cosa.' }); 
                // (Ya lo responde el bot en kimi.js, pero acá podríamos agregar lógica extra si hiciera falta)
            } else {
                notifications.push({
                    phone: phone,
                    text: 'No tenés ninguna propuesta pendiente para rechazar.'
                });
            }
            break;
        }
    }

    return notifications;
}

async function sendResponse(phone, text, source) {
    if (source === 'web' && webNotifyCallback) {
        webNotifyCallback(phone, text);
    } else {
        await sendWhatsAppMessage(phone, text);
    }
}

module.exports = { handleIncomingMessage, setWebNotifyCallback };
