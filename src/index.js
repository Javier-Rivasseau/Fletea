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

        // 4. Rutas API (Dashboard)
        const apiRoutes = createApiRouter();
        app.use('/api', apiRoutes);
        logger.info('🌐 Rutas API cargadas');

        // Endpoint simple para Health Check de Zeabur
        app.get('/ping', (req, res) => res.send('pong'));

        // Registrar accesos al dashboard
        app.get('/', (req, res, next) => {
            logger.info(`🖥️ Acceso al dashboard (/) desde: ${req.ip}`);
            next();
        });

        app.get('/dashboard.html', (req, res, next) => {
            logger.info(`🖥️ Acceso al dashboard (/dashboard.html) desde: ${req.ip}`);
            next();
        });

        // 6. Configurar callback para notificaciones web (simulación)
        setWebNotifyCallback((message) => {
            logger.debug('Web notification callback triggered:', message);
        });

        // 7. Endpoint de Simulación
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
        const server = app.listen(PORT, '0.0.0.0', () => {
            logger.info('═══════════════════════════════════════════════');
            logger.info(`🚀 Servidor FLETEA corriendo en puerto ${PORT}`);
            logger.info(`🌐 Host: 0.0.0.0`);
            logger.info(`📊 Dashboard: http://localhost:${PORT}/`);
            logger.info('═══════════════════════════════════════════════');

            // 3. Conectar a WhatsApp (Baileys) – DESPUÉS de que el servidor esté listo
            // Esto ayuda a pasar los health checks de despliegue antes de iniciar WA.
            if (process.env.ENABLE_WHATSAPP === 'true') {
                logger.info('📱 Iniciando conexión a WhatsApp...');
                connectToWhatsApp();
            } else {
                logger.info('📱 WhatsApp desactivado (ENABLE_WHATSAPP !== true). Usando solo modo Web.');
            }

            if (MODE === 'simulation') {
                logger.info('🎮 MODO SIMULACIÓN ACTIVADO');
            }
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                logger.error(`❌ Puerto ${PORT} ocupado. Cerrando.`);
                process.exit(1);
            } else {
                logger.error('❌ Error en servidor Express:', err);
            }
        });

    } catch (error) {
        logger.error('❌ ERROR FATAL DURANTE EL ARRANQUE:', error);
        // Intentar mantener el proceso vivo unos segundos para que el usuario vea el log
        setTimeout(() => process.exit(1), 5000);
    }
}

startServer();
