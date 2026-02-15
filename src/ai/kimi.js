// ============================================================
// FletesCerealeros - Kimi 2.5 AI Integration
// Con fallback local para modo simulación (gratis)
// ============================================================
const OpenAI = require('openai');
const { SYSTEM_PROMPT } = require('./system-prompt');
const logger = require('../utils/logger');

let client = null;

function initKimiClient() {
    if (process.env.KIMI_API_KEY) {
        client = new OpenAI({
            apiKey: process.env.KIMI_API_KEY,
            baseURL: process.env.KIMI_BASE_URL || 'https://integrate.api.nvidia.com/v1',
        });
        logger.info('🤖 Kimi 2.5 API (NVIDIA NIM) inicializado');
    } else {
        logger.info('🤖 Modo simulación: usando AI local (sin API key)');
    }
}

// ─── Procesamiento con Kimi 2.5 real ────────────────────────
async function processWithKimi(messages) {
    try {
        const response = await client.chat.completions.create({
            model: process.env.KIMI_MODEL || 'moonshotai/kimi-k2.5',
            messages,
            temperature: 0.1, // Lower temperature is faster/more deterministic
            max_tokens: 500, // Reduced from 2048 for faster response
        });
        return response.choices[0].message.content;
    } catch (error) {
        logger.error('Error llamando a Kimi API:', error);
        throw error;
    }
}

// ─── AI Local (Fallback gratuito) ───────────────────────────
// Analiza el mensaje con reglas simples cuando no hay API key
async function processWithLocalAI(userMessage, userPhone, conversationHistory, dbOps) {
    const msg = userMessage.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const user = await dbOps.getUser(userPhone);

    // ── Primer contacto / Registro ──
    if (!user) {
        // Detectar si se presenta
        const nameMatch = userMessage.match(/(?:soy|me llamo|mi nombre es)\s+([A-ZÁÉÍÓÚa-záéíóú\s]+?)(?:[,.]|\s+(?:camionero|productor|de\s))/i);
        const isCamionero = /camioner/i.test(msg);
        const isProductor = /productor/i.test(msg);
        const localityMatch = userMessage.match(/(?:de|en|desde)\s+(Pehuaj[oó]|Carlos\s*Casares|Bol[ií]var|Trenque\s*Lauquen|Tejedor|Henderson|Daireaux)/i);

        if (nameMatch || isCamionero || isProductor) {
            const action = {
                action: 'REGISTRAR_USUARIO',
                data: {
                    name: nameMatch ? nameMatch[1].trim() : null,
                    type: isProductor ? 'productor' : 'camionero',
                    locality: localityMatch ? localityMatch[1] : null,
                }
            };

            let response = '';
            if (action.data.name) {
                response = `¡Hola ${action.data.name}! 🚛 Bienvenido a FletesCerealeros. Te registré como ${action.data.type}`;
                if (action.data.locality) response += ` de ${action.data.locality}`;
                response += '.\n\n';
                if (action.data.type === 'camionero') {
                    response += 'Podés avisarme cuando vuelvas vacío de un puerto y te busco carga para el retorno. También podés ofrecer viajes.';
                } else {
                    response += 'Podés pedirme flete cuando necesites mover cereal y te busco un camionero disponible.';
                }
            } else {
                response = '¡Hola! 👋 Bienvenido a FletesCerealeros.\n¿Cómo te llamás y de dónde sos? ¿Sos camionero o productor?';
                return { text: response, action: null };
            }

            return { text: response, action };
        }

        return {
            text: '¡Hola! 👋 Soy el bot de FletesCerealeros. Conecto camioneros cerealeros con productores para aprovechar los retornos vacíos.\n\n¿Cómo te llamás? ¿Sos camionero 🚛 o productor 🌾? ¿De qué localidad?',
            action: null,
        };
    }

    // ── Retorno vacío ──
    const retornoMatch = msg.match(/(?:vuelvo|volviendo|regreso|salgo|saliendo).*?(?:de|desde)\s+(\w+)/i) ||
        msg.match(/(?:retorno|retornando).*?(?:de|desde)\s+(\w+)/i) ||
        msg.match(/(?:vacio|vac[ií]o).*?(?:de|desde)\s+(\w+)/i);
    const timeMatch = userMessage.match(/(?:en|dentro de)\s+(\d+)\s*(hs?|horas?|min|minutos?)/i);

    if (retornoMatch || (/vuelvo|volviendo|retorno|vaci/i.test(msg) && /rosario|bahia|quequen|puerto|san nicolas|san lorenzo/i.test(msg))) {
        const originCities = userMessage.match(/(Rosario|Bah[ií]a\s*Blanca|Quequ[eé]n|San\s*Nicol[aá]s|San\s*Lorenzo)/i);
        const origin = originCities ? originCities[1] : (retornoMatch ? retornoMatch[1] : 'Puerto');
        const timeEst = timeMatch ? `${timeMatch[1]} ${timeMatch[2]}` : null;

        const action = {
            action: 'RETORNO_VACIO',
            data: {
                origin: origin,
                destination: user.locality || 'Pehuajó',
                time_estimate: timeEst,
                date: 'hoy',
            }
        };

        let response = `🚛 ¡Registrado, ${user.name || 'camionero'}! Retorno vacío: ${origin} → ${action.data.destination}`;
        if (timeEst) response += ` (llegada estimada en ${timeEst})`;
        response += '.\n\nEstoy buscando si alguien necesita flete en tu ruta. Te aviso enseguida si encuentro algo. ✅';

        return { text: response, action };
    }

    // ── Pedido de flete ──
    if (/necesito|preciso|quiero\s+(?:sacar|enviar|mandar|mover|llevar)|busco.*flete|pedido.*flete/i.test(msg)) {
        const cerealMatch = userMessage.match(/(trigo|ma[ií]z|soja|girasol|cebada|sorgo|avena)/i);
        const tonsMatch = userMessage.match(/(\d+)\s*(?:tn|toneladas?|t\b)/i);
        const destMatch = userMessage.match(/(?:a|hacia|para|destino)\s+(Rosario|Bah[ií]a\s*Blanca|Quequ[eé]n|San\s*Nicol[aá]s|San\s*Lorenzo)/i);

        const action = {
            action: 'PEDIDO_FLETE',
            data: {
                origin: user.locality || 'a confirmar',
                destination: destMatch ? destMatch[1] : 'a confirmar',
                cereal_type: cerealMatch ? cerealMatch[1].toLowerCase() : null,
                tons: tonsMatch ? parseFloat(tonsMatch[1]) : null,
                date: 'flexible',
            }
        };

        let response = `🌾 ¡Anotado, ${user.name || 'productor'}! Pedido de flete`;
        if (action.data.tons) response += `: ${action.data.tons} tn`;
        if (action.data.cereal_type) response += ` de ${action.data.cereal_type}`;
        response += `, ${action.data.origin} → ${action.data.destination}`;
        response += '.\n\nTe aviso cuando haya un camionero disponible en esa ruta. ✅';

        if (!action.data.cereal_type || !action.data.tons || action.data.destination === 'a confirmar') {
            response += '\n\n📋 Me faltaría saber:';
            if (!action.data.cereal_type) response += '\n• ¿Qué cereal?';
            if (!action.data.tons) response += '\n• ¿Cuántas toneladas?';
            if (action.data.destination === 'a confirmar') response += '\n• ¿A qué puerto/destino?';
        }

        return { text: response, action };
    }

    // ── Oferta de viaje ──
    if (/(?:ofrezco|tengo|hago|viajo|salgo).*(?:viaje|flete|carga|camion)/i.test(msg) ||
        /(?:voy|yendo|llevo).*(?:a|hacia|para)\s+(?:rosario|bahia|quequen|puerto|san nicolas|san lorenzo)/i.test(msg)) {
        const destMatch = userMessage.match(/(Rosario|Bah[ií]a\s*Blanca|Quequ[eé]n|San\s*Nicol[aá]s|San\s*Lorenzo)/i);

        const action = {
            action: 'OFERTA_FLETE',
            data: {
                origin: user.locality || 'Pehuajó',
                destination: destMatch ? destMatch[1] : 'a confirmar',
                date: 'hoy',
                capacity_tn: 30,
            }
        };

        let response = `🚛 ¡Genial, ${user.name || 'camionero'}! Registré tu viaje: ${action.data.origin} → ${action.data.destination}`;
        response += '.\n\nSi algún productor necesita mover cereal en esa ruta, te aviso. ✅';

        return { text: response, action };
    }

    // ── Consulta de disponibilidad ──
    if (/(?:que hay|qu[eé] hay|hay algo|disponible|fletes.*disponibles|camiones.*disponibles|viajes)/i.test(msg)) {
        return {
            text: `📋 Te busco qué hay disponible. Dame un momento...`,
            action: { action: 'CONSULTAR_DISPONIBILIDAD', data: { query_type: 'todo', zona: user.locality || 'Pehuajó' } },
        };
    }

    // ── Ayuda ──
    if (/ayuda|help|como funciona|qu[eé] puedo/i.test(msg)) {
        const isDriver = user.type === 'camionero';
        return {
            text: `📖 *FletesCerealeros - ¿Cómo funciona?*\n\n${isDriver
                ? '🚛 *Como camionero podés:*\n• Avisar cuando volvés vacío: "Vuelvo de Rosario en 2 hs"\n• Ofrecer un viaje: "Viajo a Bahía Blanca mañana"\n• Ver fletes disponibles: "¿Qué hay disponible?"'
                : '🌾 *Como productor podés:*\n• Pedir un flete: "Necesito sacar 28 tn de soja a Rosario"\n• Ver camiones disponibles: "¿Qué hay disponible?"'
                }\n\n🔄 Te notifico automáticamente cuando hay un match para tu ruta.`,
            action: null,
        };
    }

    // ── Confirmación / Rechazo de match ──
    // Detectamos si el usuario está respondiendo a un match pendiente
    // Regex mejorada para aceptar variaciones como "Si", "Si dale", "Sisi", "Dale si", "Bueno dale", etc.
    if (/^(s[ií]|dale|va|ok|lo tomo|acepto|confirm|de una|bueno)\b/i.test(msg.trim()) ||
        /(s[ií]|dale|va),? lo (tomo|quiero)/i.test(msg) ||
        /^(s[ií]s[ií])/i.test(msg)) {

        const action = {
            action: 'CONFIRMAR_MATCH',
            data: { response: 'accepted' }
        };
        // El texto lo definirá el handler al procesar la acción y ver si hay match real
        return { text: '', action };
    }

    if (/^(no|nop|paso|rechazo|no me interesa|no gracias)$/i.test(msg.trim())) {
        const action = {
            action: 'RECHAZAR_MATCH',
            data: { response: 'rejected' }
        };
        return { text: 'Entendido. Rechazo la propuesta. Si cambiás de opinión avisame.', action };
    }

    // ── Default ──
    return {
        text: `Hola ${user.name || ''}! No entendí bien tu mensaje. 🤔\n\nPodés decirme cosas como:\n🚛 "Vuelvo de Rosario en 2 horas"\n🌾 "Necesito flete para 30 tn de soja a Rosario"\n📋 "¿Qué hay disponible?"\n\nO escribí "ayuda" para más info.`,
        action: null,
    };
}

// ─── Entry Point ────────────────────────────────────────────
async function processMessage(userPhone, messageText, conversationHistory, dbOps) {
    try {
        // Si hay API key de Kimi, usar Kimi 2.5
        if (client) {
            const messages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...conversationHistory.map(h => ({ role: h.role, content: h.content })),
                { role: 'user', content: messageText },
            ];

            const aiResponse = await processWithKimi(messages);

            // Extraer acción JSON de la respuesta
            const actionMatch = aiResponse.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
            let action = null;
            let text = aiResponse;

            if (actionMatch) {
                try {
                    action = JSON.parse(actionMatch[1]);
                    text = aiResponse.replace(/```json\s*\n?[\s\S]*?\n?\s*```/, '').trim();
                } catch (e) {
                    logger.warn('No se pudo parsear acción JSON de Kimi:', e.message);
                }
            }

            return { text, action };
        }

        // Fallback: AI local gratuita
        return await processWithLocalAI(messageText, userPhone, conversationHistory, dbOps);

    } catch (error) {
        logger.error('Error procesando mensaje con AI:', error);
        return {
            text: '⚠️ Tuve un problema procesando tu mensaje. Intentá de nuevo en unos segundos.',
            action: null,
        };
    }
}

module.exports = { initKimiClient, processMessage };
