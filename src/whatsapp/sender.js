// ============================================================
// FletesCerealeros - WhatsApp Message Sender
// ============================================================
const logger = require('../utils/logger');

async function sendWhatsAppMessage(to, text) {
    if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
        logger.info(`📤 [SIMULACIÓN] Mensaje a ${to}: ${text}`);
        return { success: true, simulated: true };
    }

    try {
        const url = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body: text },
            }),
        });

        const data = await response.json();
        if (data.error) {
            logger.error(`Error enviando a WhatsApp: ${data.error.message}`);
            return { success: false, error: data.error.message };
        }

        logger.info(`📤 Mensaje enviado a ${to}`);
        return { success: true, data };
    } catch (error) {
        logger.error(`Error enviando mensaje WhatsApp: ${error.message}`);
        return { success: false, error: error.message };
    }
}

module.exports = { sendWhatsAppMessage };
