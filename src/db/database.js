// ============================================================
// FletesCerealeros - Base de datos PostgreSQL (Supabase)
// ============================================================
const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool;

function initDatabase() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        logger.warn('⚠️ No DATABASE_URL found. Running in simulation mode (no persistent database).');
        return;
    }

    try {
        // Try to parse as connection string directly first (recommended for PG Pool)
        pool = new Pool({
            connectionString,
            ssl: {
                rejectUnauthorized: false
            },
            max: 5, // Reduce to avoid hitting connection limits on free tiers
            idleTimeoutMillis: 180000, // Keep connections alive longer to reduce handshake latency
            connectionTimeoutMillis: 5000,
        });

        logger.info('🔌 Pool de PostgreSQL configurado');
    } catch (e) {
        logger.error('❌ Error fatal configurando pool de PostgreSQL:', e.message);
        throw e;
    }

    pool.on('error', (err) => {
        logger.error('Unexpected error on idle PostgreSQL client', err);
    });

    return initTables();
}

async function initTables() {
    if (!pool) return;

    return new Promise(async (resolve, reject) => {
        // Timeout de seguridad: si la DB no responde en 15s, seguir adelante
        const timeout = setTimeout(() => {
            logger.warn('⚠️ La inicialización de tablas de Base de Datos está tardando demasiado. Continuando...');
            resolve();
        }, 15000);

        let client;
        try {
            client = await pool.connect();
            logger.info('🛰️ Conectado a PostgreSQL exitosamente');
            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    phone TEXT UNIQUE NOT NULL,
                    name TEXT,
                    type TEXT CHECK(type IN ('camionero', 'productor', 'ambos')) NOT NULL DEFAULT 'camionero',
                    locality TEXT,
                    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    active BOOLEAN DEFAULT TRUE
                );

                CREATE TABLE IF NOT EXISTS trucks (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    patente TEXT,
                    capacity_tn REAL DEFAULT 30,
                    trailer_type TEXT DEFAULT 'cerealero'
                );

                CREATE TABLE IF NOT EXISTS trips (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    type TEXT CHECK(type IN ('oferta_flete', 'pedido_flete', 'retorno_vacio')) NOT NULL,
                    origin TEXT NOT NULL,
                    destination TEXT NOT NULL,
                    date TEXT,
                    time_estimate TEXT,
                    cereal_type TEXT,
                    tons REAL,
                    price_per_ton REAL,
                    status TEXT CHECK(status IN ('activo', 'matcheado', 'completado', 'cancelado')) DEFAULT 'activo',
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS matches (
                    id SERIAL PRIMARY KEY,
                    trip_oferta_id INTEGER REFERENCES trips(id),
                    trip_pedido_id INTEGER REFERENCES trips(id),
                    camionero_id INTEGER NOT NULL REFERENCES users(id),
                    productor_id INTEGER NOT NULL REFERENCES users(id),
                    status TEXT CHECK(status IN ('propuesto', 'aceptado', 'rechazado', 'completado')) DEFAULT 'propuesto',
                    score REAL DEFAULT 0,
                    matched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS conversations (
                    id SERIAL PRIMARY KEY,
                    user_phone TEXT NOT NULL,
                    role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS baileys_auth (
                    category TEXT NOT NULL,
                    key_id TEXT NOT NULL,
                    value TEXT NOT NULL,
                    PRIMARY KEY (category, key_id)
                );

                CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
                CREATE INDEX IF NOT EXISTS idx_trips_type ON trips(type);
                CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(user_phone);
                CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
            `);
            logger.info('✅ Tablas PostgreSQL verificadas/creadas');
            clearTimeout(timeout);
            resolve();
        } catch (err) {
            logger.error('Error inicializando tablas:', err);
            clearTimeout(timeout);
            resolve(); // Continuar aunque falle, para no romper el dashboard
        } finally {
            if (client) client.release();
        }
    });
}

// ─── Auth Store Operations ──────────────────────────────────
async function saveAuthKey(category, keyId, value) {
    const query = `
        INSERT INTO baileys_auth (category, key_id, value)
        VALUES ($1, $2, $3)
        ON CONFLICT (category, key_id)
        DO UPDATE SET value = EXCLUDED.value
    `;
    await getPool().query(query, [category, keyId, value]);
}

async function getAuthKey(category, keyId) {
    const res = await getPool().query(
        'SELECT value FROM baileys_auth WHERE category = $1 AND key_id = $2',
        [category, keyId]
    );
    return res.rows[0] ? res.rows[0].value : null;
}

async function deleteAuthKey(category, keyId) {
    await getPool().query(
        'DELETE FROM baileys_auth WHERE category = $1 AND key_id = $2',
        [category, keyId]
    );
}

function getPool() {
    if (!pool) {
        initDatabase();
    }
    if (!pool) {
        throw new Error('No hay conexión a la base de datos PostgreSQL. Configurá DATABASE_URL.');
    }
    return pool;
}

function isConnected() {
    return !!pool;
}

// ─── Helpers para consultas (Simulando API sincrona de better-sqlite3 donde sea posible con async/await) ───
// NOTA: PG es asíncrono. Tendremos que refactorizar el código que llama a esto para ser async.

async function findOrCreateUser(phone, name = null, type = 'camionero', locality = null) {
    const res = await getPool().query('SELECT * FROM users WHERE phone = $1', [phone]);
    let user = res.rows[0];

    if (!user) {
        const insert = await getPool().query(
            'INSERT INTO users (phone, name, type, locality) VALUES ($1, $2, $3, $4) RETURNING *',
            [phone, name, type, locality]
        );
        user = insert.rows[0];
    }
    return user;
}

async function updateUser(phone, updates) {
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, val] of Object.entries(updates)) {
        if (['name', 'type', 'locality', 'active'].includes(key)) {
            fields.push(`${key} = $${idx}`);
            values.push(val);
            idx++;
        }
    }

    if (fields.length === 0) return;

    values.push(phone);
    await getPool().query(`UPDATE users SET ${fields.join(', ')} WHERE phone = $${idx}`, values);
}

async function getUser(phone) {
    const res = await getPool().query('SELECT * FROM users WHERE phone = $1', [phone]);
    return res.rows[0];
}

async function getAllUsers() {
    const res = await getPool().query('SELECT * FROM users ORDER BY registered_at DESC');
    return res.rows;
}

// ─── Trip Operations ────────────────────────────────────────
async function createTrip(userId, type, origin, destination, extra = {}) {
    const res = await getPool().query(`
    INSERT INTO trips (user_id, type, origin, destination, date, time_estimate, cereal_type, tons, price_per_ton, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
        userId, type, origin, destination,
        extra.date || null, extra.time_estimate || null,
        extra.cereal_type || null, extra.tons || null,
        extra.price_per_ton || null, extra.notes || null
    ]);
    return res.rows[0];
}

async function getActiveTrips(type = null) {
    let query = `
      SELECT t.*, u.name as user_name, u.phone as user_phone, u.locality as user_locality
      FROM trips t JOIN users u ON t.user_id = u.id
      WHERE t.status = 'activo'
    `;
    const params = [];

    if (type) {
        query += ` AND t.type = $1`;
        params.push(type);
    }

    query += ` ORDER BY t.created_at DESC`;

    const res = await getPool().query(query, params);
    return res.rows;
}

async function updateTripStatus(tripId, status) {
    await getPool().query('UPDATE trips SET status = $1 WHERE id = $2', [status, tripId]);
}

// ─── Match Operations ───────────────────────────────────────
async function createMatch(tripOfertaId, tripPedidoId, camioneroId, productorId, score = 0) {
    const res = await getPool().query(`
    INSERT INTO matches (trip_oferta_id, trip_pedido_id, camionero_id, productor_id, score)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [tripOfertaId, tripPedidoId, camioneroId, productorId, score]);
    return res.rows[0];
}

async function getActiveMatches() {
    const res = await getPool().query(`
    SELECT m.*,
      uc.name as camionero_name, uc.phone as camionero_phone, uc.locality as camionero_locality,
      up.name as productor_name, up.phone as productor_phone, up.locality as productor_locality,
      to2.origin as trip_origin, to2.destination as trip_destination
    FROM matches m
    JOIN users uc ON m.camionero_id = uc.id
    JOIN users up ON m.productor_id = up.id
    LEFT JOIN trips to2 ON m.trip_oferta_id = to2.id
    WHERE m.status IN ('propuesto', 'aceptado')
    ORDER BY m.matched_at DESC
  `);
    return res.rows;
}

async function updateMatchStatus(matchId, status) {
    await getPool().query('UPDATE matches SET status = $1 WHERE id = $2', [status, matchId]);
}

async function getPendingMatchForUser(userId) {
    const res = await getPool().query(`
    SELECT m.*,
      uc.name as camionero_name, uc.phone as camionero_phone, uc.locality as camionero_locality,
      up.name as productor_name, up.phone as productor_phone, up.locality as productor_locality,
      to2.origin as trip_origin, to2.destination as trip_destination
    FROM matches m
    JOIN users uc ON m.camionero_id = uc.id
    JOIN users up ON m.productor_id = up.id
    LEFT JOIN trips to2 ON m.trip_oferta_id = to2.id
    WHERE (m.camionero_id = $1 OR m.productor_id = $2) AND m.status = 'propuesto'
    ORDER BY m.matched_at DESC
    LIMIT 1
  `, [userId, userId]);
    return res.rows[0];
}

async function getMatchById(matchId) {
    const res = await getPool().query(`
    SELECT m.*,
      uc.name as camionero_name, uc.phone as camionero_phone, uc.locality as camionero_locality,
      up.name as productor_name, up.phone as productor_phone, up.locality as productor_locality
    FROM matches m
    JOIN users uc ON m.camionero_id = uc.id
    JOIN users up ON m.productor_id = up.id
    WHERE m.id = $1
  `, [matchId]);
    return res.rows[0];
}

// ─── Conversation History ───────────────────────────────────
async function saveConversation(phone, role, content) {
    await getPool().query(
        'INSERT INTO conversations (user_phone, role, content) VALUES ($1, $2, $3)',
        [phone, role, content]
    );
}

async function getConversationHistory(phone, limit = 20) {
    const res = await getPool().query(
        'SELECT role, content FROM conversations WHERE user_phone = $1 ORDER BY timestamp DESC LIMIT $2',
        [phone, limit]
    );
    return res.rows.reverse();
}

async function clearConversationHistory(phone) {
    await getPool().query('DELETE FROM conversations WHERE user_phone = $1', [phone]);
}

// ─── Stats ──────────────────────────────────────────────────
async function getStats() {
    const pool = getPool();
    const [
        totalUsers, camioneros, yproductores,
        activeTrips, retornosVacios, pedidosFlete,
        matchesRealizados, matchesAceptados
    ] = await Promise.all([
        pool.query('SELECT COUNT(*) as count FROM users'),
        pool.query("SELECT COUNT(*) as count FROM users WHERE type = 'camionero'"),
        pool.query("SELECT COUNT(*) as count FROM users WHERE type = 'productor'"),
        pool.query("SELECT COUNT(*) as count FROM trips WHERE status = 'activo'"),
        pool.query("SELECT COUNT(*) as count FROM trips WHERE status = 'activo' AND type = 'retorno_vacio'"),
        pool.query("SELECT COUNT(*) as count FROM trips WHERE status = 'activo' AND type = 'pedido_flete'"),
        pool.query('SELECT COUNT(*) as count FROM matches'),
        pool.query("SELECT COUNT(*) as count FROM matches WHERE status = 'aceptado'")
    ]);

    return {
        totalUsers: parseInt(totalUsers.rows[0].count),
        camioneros: parseInt(camioneros.rows[0].count),
        productores: parseInt(yproductores.rows[0].count),
        activeTrips: parseInt(activeTrips.rows[0].count),
        retornosVacios: parseInt(retornosVacios.rows[0].count),
        pedidosFlete: parseInt(pedidosFlete.rows[0].count),
        matchesRealizados: parseInt(matchesRealizados.rows[0].count),
        matchesAceptados: parseInt(matchesAceptados.rows[0].count),
    };
}

module.exports = {
    initDatabase,
    getPool,
    findOrCreateUser,
    updateUser,
    getUser,
    getAllUsers,
    createTrip,
    getActiveTrips,
    updateTripStatus,
    createMatch,
    getActiveMatches,
    updateMatchStatus,
    getPendingMatchForUser,
    getMatchById,
    saveConversation,
    getConversationHistory,
    clearConversationHistory,
    getStats,
    saveAuthKey,
    getAuthKey,
    deleteAuthKey,
    isConnected,
};
