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
        // 1. Iniciar Servidor Express PRIMERO
        // Esto garantiza que el dashboard sea accesible incluso si la DB tarda en conectar.
        const server = app.listen(PORT, '0.0.0.0', () => {
            logger.info('═══════════════════════════════════════════════');
            logger.info(`🚀 Servidor FLETEA activo en puerto ${PORT}`);
            logger.info(`🌐 Host: 0.0.0.0`);
            logger.info(`📊 Dashboard: http://localhost:${PORT}/`);
            logger.info('═══════════════════════════════════════════════');

            // Iniciar servicios pesados en "background"
            initializeServices();
        });

        // Endpoint simple para Health Check
        app.get('/ping', (req, res) => res.send('pong'));

        // Registro de accesos
        app.get('/', (req, res, next) => {
            logger.info(`🖥️ Acceso dashboard (/) - IP: ${req.ip}`);
            next();
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
        logger.error('❌ ERROR CRÍTICO EN EXPRESS:', error);
        setTimeout(() => process.exit(1), 5000);
    }
}

async function initializeServices() {
    try {
        // 1. Iniciar Base de Datos (PostgreSQL)
        logger.info('⏳ Conectando con Base de Datos...');
        await initDatabase();
        logger.info('📦 Base de datos vinculada');

        // 2. Iniciar Kimi AI
        initKimiClient();
        logger.info('🧠 Kimi AI cargado');

        // 3. Rutas API (Dashboard)
        const apiRoutes = createApiRouter();
        app.use('/api', apiRoutes);
        logger.info('🌐 Endpoints API activados');

        // 4. Modo Simulación
        setWebNotifyCallback((message) => {
            logger.debug('Notificación Web:', message);
        });

        // 5. Iniciar WhatsApp (Baileys) si está activado
        if (process.env.ENABLE_WHATSAPP === 'true' || process.env.MODE === 'production') {
            logger.info('📱 Preparando módulo WhatsApp...');
            connectToWhatsApp();
        } else {
            logger.info('📱 WhatsApp omitido (Modo Simulación/Web)');
        }

    } catch (error) {
        logger.error('⚠️ ERROR DURANTE INICIALIZACIÓN DE SERVICIOS:', error.message);
        // No matamos el proceso, permitimos re-intentos o uso limitado del dashboard
    }
}

startServer();
