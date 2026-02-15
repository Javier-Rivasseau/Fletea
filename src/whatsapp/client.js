const qrcode = require('qrcode-terminal');
const logger = require('../utils/logger');
const { handleIncomingMessage } = require('../handler/conversation');

// Helper para enviar mensajes (implementado más abajo con delay)
// async function sendMessage(sock, jid, text) ...

async function connectToWhatsApp() {
    // Dynamic import for ESM module
    // Dynamic import for ESM module
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('@whiskeysockets/baileys');
    const { usePostgresAuthState } = require('./auth-store-db');

    let state, saveCreds;

    if (process.env.DATABASE_URL) {
        logger.info('🗄️ Usando almacenamiento de sesión en Base de Datos (PostgreSQL)');
        const auth = await usePostgresAuthState('baileys_auth_info');
        state = auth.state;
        saveCreds = auth.saveCreds;
    } else {
        logger.info('📂 Usando almacenamiento de sesión local (File System)');
        const auth = await useMultiFileAuthState('auth_info_baileys');
        state = auth.state;
        saveCreds = auth.saveCreds;
    }

    const sock = makeWASocket({
        printQRInTerminal: true, // Esto imprimirá el QR en los logs de Railway/Terminal
        auth: state,
        defaultQueryTimeoutMs: undefined, // Evitar timeouts en algunas redes
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            logger.info('📲 Escaneá este QR con tu celular para conectar el bot:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            logger.warn('❌ Conexión cerrada. Reconectando:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            logger.info('✅ Conexión establecida con WhatsApp!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const phone = msg.key.remoteJid.split('@')[0];
            const name = msg.pushName || 'Usuario';

            // Extraer texto de diferentes tipos de mensaje (texto simple o extendido)
            const text = msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption;

            if (!text) return; // Ignorar mensajes sin texto por ahora

            logger.info(`📩 Nuevo mensaje de ${name} (${phone}): ${text}`);

            // Procesar el mensaje
            const response = await handleIncomingMessage({
                phone,
                text,
                name,
                source: 'whatsapp_baileys'
            });

            // Enviar respuesta(s)
            if (response.response) {
                await sendMessage(sock, msg.key.remoteJid, response.response);
            }

            // Enviar notificaciones adicionales (matches)
            if (response.matchNotifications && response.matchNotifications.length > 0) {
                for (const notif of response.matchNotifications) {
                    // Cuidado: notif.phone viene sin sufijo, hay que agregar @s.whatsapp.net
                    // Además, Baileys requiere formato internacional sin +
                    const jid = notif.phone.includes('@') ? notif.phone : `${notif.phone}@s.whatsapp.net`;
                    await sendMessage(sock, jid, notif.text);
                }
            }

        } catch (err) {
            logger.error('Error procesando mensaje de WhatsApp:', err);
        }
    });
}

// Helper para enviar mensajes con delay "humano"
async function sendMessage(sock, jid, text) {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate('composing', jid);

    // Simular tiempo de escritura (1s por cada 100 caracteres, min 2s)
    const delay = Math.max(2000, text.length * 20);
    await new Promise(resolve => setTimeout(resolve, delay));

    await sock.sendMessage(jid, { text });
    await sock.sendPresenceUpdate('paused', jid);
}

module.exports = { connectToWhatsApp };
