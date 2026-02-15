// ============================================================
// FletesCerealeros - Main Entry Point
// ============================================================
require('dotenv').config();

const express = require('express');
const path = require('path');
const logger = require('./utils/logger');
const { initDatabase } = require('./db/database');
const { initKimiClient } = require('./ai/kimi');
const { createApiRouter } = require('./routes/api');
const { handleIncomingMessage, setWebNotifyCallback } = require('./handler/conversation');
const { connectToWhatsApp } = require('./whatsapp/client');

const PORT = process.env.PORT || 3000;
const MODE = process.env.MODE || 'simulation';

// ─── Initialize ──────────────────────────────────────────────
logger.info('═══════════════════════════════════════════════');
logger.info('🚛 Fletea - Iniciando servidor...');
logger.info(`📋 Modo: ${MODE}`);
logger.info('═══════════════════════════════════════════════');

// ─── Express App ─────────────────────────────────────────────
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Inicialización
async function startServer() {
    try {
        // 1. Iniciar Base de Datos (PostgreSQL)
        await initDatabase();
        logger.info('📦 Base de datos inicializada');

        // 2. Iniciar Kimi AI
        initKimiClient();
        logger.info('🧠 Kimi AI inicializado');

        // 3. Conectar a WhatsApp (Baileys) - Solo si no estamos en modo test puro
        if (process.env.NODE_ENV !== 'test') {
            connectToWhatsApp();
            logger.info('📱 Conectando a WhatsApp...');
        }

        // 4. Rutas API (Dashboard)
        const apiRoutes = createApiRouter();
        app.use('/api', apiRoutes);
        logger.info('🌐 Rutas API cargadas');

        // 5. Webhook de WhatsApp (REMOVED - Using Baileys)
        // const webhookRouter = createWebhookRouter();
        // app.use('/webhook', webhookRouter);
        // logger.info('🔗 Webhook de WhatsApp configurado');

        // 6. Configurar callback para notificaciones web (simulación)
        setWebNotifyCallback((message) => {
            // This could be used to push messages to connected clients (e.g., via WebSockets)
            logger.debug('Web notification callback triggered:', message);
        });

        // 7. Endpoint de Simulación (para desarrollo/tests sin WhatsApp real)
        app.post('/api/simulate', async (req, res) => {
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
                logger.error('Error en simulación:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // 8. Iniciar Servidor Express
        app.listen(PORT, () => {
            logger.info(`🚀 Servidor corriendo en http://localhost:${PORT}`);
            logger.info(`📊 Dashboard disponible en http://localhost:${PORT}/dashboard.html`);

            if (MODE === 'simulation') {
                logger.info('');
                logger.info('╔══════════════════════════════════════════════╗');
                logger.info('║  🎮 MODO SIMULACIÓN - ¡Probalo gratis!      ║');
                logger.info('║  Abrí http://localhost:' + PORT + ' en tu browser  ║');
                logger.info('║  No necesitás API keys ni WhatsApp           ║');
                logger.info('╚══════════════════════════════════════════════╝');
            }
        });

    } catch (error) {
        logger.error('❌ Error fatal al iniciar:', error);
        process.exit(1);
    }
}

startServer();
