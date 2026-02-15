// ============================================================
// FletesCerealeros - API Routes (Dashboard)
// ============================================================
const express = require('express');
const db = require('../db/database');

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
            // Fix: ensure correct method name and params
            const history = await db.getConversationHistory(req.params.phone, 50);
            res.json(history);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;
}

module.exports = { createApiRouter };
