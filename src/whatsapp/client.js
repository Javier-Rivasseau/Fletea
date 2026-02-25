const qrcode = require('qrcode-terminal');
const logger = require('../utils/logger');
const { handleIncomingMessage } = require('../handler/conversation');

// Variables para exponer el estado y el QR a la API
let currentQR = null;
let connectionStatus = 'initializing';
let pairingCode = null;

async function connectToWhatsApp() {
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

    let isPairingRequested = false;

    const sock = makeWASocket({
        printQRInTerminal: !process.env.PHONE_NUMBER,
        auth: state,
        defaultQueryTimeoutMs: undefined,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
    });

    // Soporte para Pairing Code (Alternativa al QR)
    const requestPairing = async () => {
        if (isPairingRequested || !process.env.PHONE_NUMBER || sock.authState.creds.registered) return;

        const phoneNumber = process.env.PHONE_NUMBER.replace(/\D/g, '');
        isPairingRequested = true;

        logger.info(`📲 Solicitando código de vinculación para: ${phoneNumber}`);
        try {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const code = await sock.requestPairingCode(phoneNumber);
            pairingCode = code;
            logger.info('╔══════════════════════════════════════════════╗');
            logger.info(`║  TU CÓDIGO DE VINCULACIÓN: ${code}       ║`);
            logger.info('╚══════════════════════════════════════════════╝');
        } catch (err) {
            logger.error('Error al solicitar pairing code:', err.message);
            isPairingRequested = false;
        }
    };

    if (process.env.PHONE_NUMBER && !sock.authState.creds.registered) {
        requestPairing();
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !process.env.PHONE_NUMBER) {
            currentQR = qr;
            logger.info('📲 Nuevo QR generado. Disponible en el Dashboard.');
            try {
                qrcode.generate(qr, { small: true });
            } catch (e) {
                // En entornos sin TTY (como Zeabur) esto puede fallar — no es crítico
                logger.debug('qrcode-terminal no disponible en este entorno (sin TTY)');
            }
        }

        if (connection === 'close') {
            connectionStatus = 'closed';
            currentQR = null;
            const statusCode = lastDisconnect.error?.output?.statusCode;

            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            const isConflict = statusCode === 405; // 405 means session conflict (connection replaced)
            const shouldReconnect = !isLoggedOut;

            logger.warn(`❌ Conexión cerrada (Status: ${statusCode}). Reconectando: ${shouldReconnect}`);

            if (isLoggedOut) {
                logger.warn('⚠️ Sesión de WhatsApp cerrada. Debes volver a escanear el QR o generar código desde el Dashboard.');
            } else if (isConflict) {
                logger.warn('⚠️ Conflicto de sesión (Status 405). Fletea está corriendo en otro servidor o se está redeployando. Intentando reconectar en 30s para sobrevivir al rolling update de Zeabur...');
                setTimeout(() => connectToWhatsApp(), 30000); // 30s backoff for conflicts
            } else if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 10000); // 10s backoff normal
            }
        } else if (connection === 'open') {
            connectionStatus = 'open';
            currentQR = null;
            pairingCode = null;
            logger.info('✅ Conexión establecida con WhatsApp!');
        } else if (connection === 'connecting') {
            connectionStatus = 'connecting';
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const phone = msg.key.remoteJid.split('@')[0];
            const name = msg.pushName || 'Usuario';

            const text = msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption;

            if (!text) return;

            logger.info(`📩 Nuevo mensaje de ${name} (${phone}): ${text}`);

            const response = await handleIncomingMessage({
                phone,
                text,
                name,
                source: 'whatsapp_baileys'
            });

            if (response.response) {
                await sendMessage(sock, msg.key.remoteJid, response.response);
            }

            if (response.matchNotifications && response.matchNotifications.length > 0) {
                for (const notif of response.matchNotifications) {
                    const jid = notif.phone.includes('@') ? notif.phone : `${notif.phone}@s.whatsapp.net`;
                    await sendMessage(sock, jid, notif.text);
                }
            }

        } catch (err) {
            logger.error('Error procesando mensaje de WhatsApp:', err);
        }
    });
}

async function sendMessage(sock, jid, text) {
    try {
        await sock.presenceSubscribe(jid);
        await sock.sendPresenceUpdate('composing', jid);
        const delay = Math.max(2000, text.length * 20);
        await new Promise(resolve => setTimeout(resolve, delay));
        await sock.sendMessage(jid, { text });
        await sock.sendPresenceUpdate('paused', jid);
    } catch (e) {
        logger.error('Error enviando mensaje WhatsApp:', e);
    }
}

// Getters para exportar estado
function getWhatsAppStatus() {
    return {
        status: connectionStatus,
        qr: currentQR,
        pairingCode: pairingCode
    };
}

module.exports = { connectToWhatsApp, getWhatsAppStatus };
