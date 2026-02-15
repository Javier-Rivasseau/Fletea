const express = require('express');
const db = require('../db/database');
const { getWhatsAppStatus } = require('../whatsapp/client');

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
            ai: !!process.env.KIMI_API_KEY ? 'online' : 'simulation',
            whatsapp: whatsapp.status,
            hasQR: !!whatsapp.qr,
            pairingCode: whatsapp.pairingCode,
            version: '1.3.0'
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

    return router;
}

module.exports = { createApiRouter };
