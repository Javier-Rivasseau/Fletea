// ============================================================
// FletesCerealeros - Datos de localidades y rutas
// Zona: Pehuajó y alrededores, Buenos Aires, Argentina
// ============================================================

const LOCALITIES = {
    pehuajo: { name: 'Pehuajó', lat: -35.8108, lon: -61.8988, type: 'origen' },
    carlos_casares: { name: 'Carlos Casares', lat: -35.6225, lon: -61.3653, type: 'origen' },
    bolivar: { name: 'Bolívar', lat: -36.2319, lon: -61.1000, type: 'origen' },
    trenque_lauquen: { name: 'Trenque Lauquen', lat: -35.9703, lon: -62.7314, type: 'origen' },
    tejedor: { name: 'Tejedor', lat: -35.5917, lon: -62.1000, type: 'origen' },
    henderson: { name: 'Henderson', lat: -36.3000, lon: -61.7167, type: 'origen' },
    daireaux: { name: 'Daireaux', lat: -36.5933, lon: -61.7461, type: 'origen' },
    // Puertos
    bahia_blanca: { name: 'Bahía Blanca', lat: -38.7196, lon: -62.2724, type: 'puerto' },
    quequen: { name: 'Quequén', lat: -38.5833, lon: -58.7000, type: 'puerto' },
    rosario: { name: 'Rosario', lat: -32.9468, lon: -60.6393, type: 'puerto' },
    san_nicolas: { name: 'San Nicolás', lat: -33.3330, lon: -60.2260, type: 'puerto' },
    san_lorenzo: { name: 'San Lorenzo', lat: -32.7500, lon: -60.7333, type: 'puerto' },
};

// Rutas principales con distancias aproximadas en km
const ROUTES = [
    { from: 'pehuajo', to: 'bahia_blanca', km: 350, hours: 4.5 },
    { from: 'pehuajo', to: 'quequen', km: 400, hours: 5.0 },
    { from: 'pehuajo', to: 'rosario', km: 450, hours: 5.5 },
    { from: 'pehuajo', to: 'san_nicolas', km: 420, hours: 5.0 },
    { from: 'pehuajo', to: 'san_lorenzo', km: 460, hours: 5.5 },
    { from: 'carlos_casares', to: 'rosario', km: 400, hours: 5.0 },
    { from: 'carlos_casares', to: 'bahia_blanca', km: 380, hours: 4.5 },
    { from: 'bolivar', to: 'quequen', km: 350, hours: 4.5 },
    { from: 'bolivar', to: 'bahia_blanca', km: 320, hours: 4.0 },
    { from: 'trenque_lauquen', to: 'bahia_blanca', km: 300, hours: 3.5 },
    { from: 'trenque_lauquen', to: 'rosario', km: 500, hours: 6.0 },
];

const CEREALS = ['trigo', 'maíz', 'soja', 'girasol', 'cebada', 'sorgo', 'avena'];

// Calcula distancia aproximada entre dos puntos (Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Busca la localidad más cercana a un nombre dado (fuzzy match)
function findLocality(name) {
    const normalized = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const [key, loc] of Object.entries(LOCALITIES)) {
        const locNorm = loc.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (locNorm.includes(normalized) || normalized.includes(locNorm) || key.includes(normalized)) {
            return { key, ...loc };
        }
    }
    return null;
}

// Devuelve las localidades que están en una ruta (dentro de un radio de desvío)
function localitiesOnRoute(fromKey, toKey, maxDeviationKm = 50) {
    const from = LOCALITIES[fromKey];
    const to = LOCALITIES[toKey];
    if (!from || !to) return [];

    const results = [];
    for (const [key, loc] of Object.entries(LOCALITIES)) {
        if (key === fromKey || key === toKey) continue;
        // Distancia del punto a la línea recta entre from y to
        const distToFrom = calculateDistance(from.lat, from.lon, loc.lat, loc.lon);
        const distToTo = calculateDistance(to.lat, to.lon, loc.lat, loc.lon);
        const directDist = calculateDistance(from.lat, from.lon, to.lat, to.lon);
        // Si la suma de distancias al origen y destino es similar a la directa, está en ruta
        const deviation = (distToFrom + distToTo) - directDist;
        if (deviation <= maxDeviationKm) {
            results.push({ key, ...loc, deviationKm: Math.round(deviation) });
        }
    }
    return results.sort((a, b) => a.deviationKm - b.deviationKm);
}

module.exports = {
    LOCALITIES,
    ROUTES,
    CEREALS,
    calculateDistance,
    findLocality,
    localitiesOnRoute,
};
