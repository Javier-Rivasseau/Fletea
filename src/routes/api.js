const express = require('express');
const db = require('../db/database');
const { getWhatsAppStatus } = require('../whatsapp/client');
const { handleIncomingMessage } = require('../handler/conversation');

function createApiRouter() {
    const router = express.Router();

    router.get('/stats', async (req, res) => {
        try {
            const stats = await db.getStats();
            res.json(stats);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/users', async (req, res) => {
        try {
            const users = await db.getAllUsers();
            res.json(users);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/trips', async (req, res) => {
        try {
            const type = req.query.type || null;
            const trips = await db.getActiveTrips(type);
            res.json(trips);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/matches', async (req, res) => {
        try {
            const matches = await db.getActiveMatches();
            res.json(matches);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/conversations/:phone', async (req, res) => {
        try {
            const history = await db.getConversationHistory(req.params.phone, 50);
            res.json(history);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.get('/health', (req, res) => {
        const whatsapp = getWhatsAppStatus();
        res.json({
            status: 'ok',
            database: db.isConnected() ? 'connected' : 'disconnected',
            ai: !!process.env.KIMI_API_KEY ? 'online (Kimi 2.5)' : 'simulation',
            whatsapp: whatsapp.status,
            hasQR: !!whatsapp.qr,
            pairingCode: whatsapp.pairingCode,
            version: '1.4.0'
        });
    });

    // Nuevo endpoint para obtener el QR base64
    router.get('/qr', (req, res) => {
        const whatsapp = getWhatsAppStatus();
        if (whatsapp.qr) {
            res.json({ qr: whatsapp.qr });
        } else {
            res.status(404).json({ error: 'No QR available or already connected' });
        }
    });

    // Endpoint para limpiar la sesión de WhatsApp (útil si el QR expiró o la sesión es inválida)
    router.post('/reset-whatsapp', async (req, res) => {
        try {
            const pool = db.getPool();
            await pool.query('DELETE FROM baileys_auth');
            res.json({ ok: true, message: 'Sesión de WhatsApp borrada. Reiniciá el servidor para generar un QR nuevo.' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Endpoint de Simulación para probar sin WhatsApp
    router.post('/simulate', async (req, res) => {
        try {
            const { phone, text, name } = req.body;
            const result = await handleIncomingMessage({
                phone,
                text,
                name,
                source: 'web_simulation'
            });
            res.json(result);
        } catch (error) {
            console.error('Error en simulación API:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

module.exports = { createApiRouter };
