// ============================================================
// FletesCerealeros - Motor de Matching
// Matchea retornos vacíos con pedidos de flete
// ============================================================
const { findLocality, localitiesOnRoute, calculateDistance, LOCALITIES } = require('../data/localities');
const logger = require('../utils/logger');

/**
 * Busca matches posibles entre un retorno vacío y pedidos de flete activos
 * @param {Object} retorno - El viaje de retorno vacío
 * @param {Array} pedidos - Lista de pedidos de flete activos
 * @returns {Array} Matches ordenados por score (mejor primero)
 */
function findMatches(retorno, pedidos) {
    const matches = [];

    const retornoOrigin = findLocality(retorno.origin);
    const retornoDest = findLocality(retorno.destination);

    if (!retornoOrigin || !retornoDest) {
        logger.warn(`No se pudo geolocalizar retorno: ${retorno.origin} → ${retorno.destination}`);
        return matches;
    }

    // Localidades que están en la ruta del retorno
    const routeLocalities = localitiesOnRoute(retornoOrigin.key, retornoDest.key, 80);
    const routeLocalityKeys = new Set([
        retornoOrigin.key,
        retornoDest.key,
        ...routeLocalities.map(l => l.key),
    ]);

    for (const pedido of pedidos) {
        const pedidoOrigin = findLocality(pedido.origin);
        if (!pedidoOrigin) continue;

        let score = 0;
        const reasons = [];

        // 1. ¿El origen del pedido está en la ruta del retorno?
        if (routeLocalityKeys.has(pedidoOrigin.key)) {
            score += 50;
            reasons.push('origen en ruta de retorno');
        } else {
            // Calcular desvío
            const distToRoute = calculateDistance(
                pedidoOrigin.lat, pedidoOrigin.lon,
                retornoDest.lat, retornoDest.lon
            );
            const maxDeviation = 100; // km
            if (distToRoute <= maxDeviation) {
                score += Math.max(0, 30 - (distToRoute / maxDeviation) * 30);
                reasons.push(`origen a ${Math.round(distToRoute)} km de la ruta`);
            } else {
                continue; // Demasiado lejos
            }
        }

        // 2. ¿El destino del pedido coincide con el origen del retorno (puerto)?
        const pedidoDest = findLocality(pedido.destination);
        if (pedidoDest) {
            const distPuertos = calculateDistance(
                pedidoDest.lat, pedidoDest.lon,
                retornoOrigin.lat, retornoOrigin.lon
            );
            if (distPuertos < 50) {
                score += 30;
                reasons.push('mismo puerto de destino');
            } else if (distPuertos < 150) {
                score += 15;
                reasons.push('puerto cercano');
            }
        }

        // 3. Bonus por fecha (si coinciden)
        if (retorno.date && pedido.date) {
            if (retorno.date === pedido.date || pedido.date === 'flexible') {
                score += 20;
                reasons.push('fecha compatible');
            }
        } else {
            score += 10; // Sin fecha = asumimos flexible
        }

        if (score >= 20) {
            matches.push({
                pedido,
                score,
                reasons,
            });
        }
    }

    return matches.sort((a, b) => b.score - a.score);
}

/**
 * Busca pedidos de flete que podrían ser recogidos por un camionero
 * que vuelve vacío en una ruta determinada
 */
function findMatchesForRetorno(retorno, pedidos) {
    const results = findMatches(retorno, pedidos);

    if (results.length > 0) {
        logger.info(`🎯 Encontrados ${results.length} matches para retorno ${retorno.origin} → ${retorno.destination}`);
        results.forEach((m, i) => {
            logger.info(`  ${i + 1}. ${m.pedido.user_name || 'Productor'}: ${m.pedido.origin} → ${m.pedido.destination} (score: ${m.score})`);
        });
    }

    return results;
}

/**
 * Busca retornos vacíos que podrían servir para un pedido de flete
 */
function findMatchesForPedido(pedido, retornos) {
    // Invertimos la lógica: el pedido busca retornos que pasen por su zona
    const matches = [];

    const pedidoOrigin = findLocality(pedido.origin);
    if (!pedidoOrigin) return matches;

    for (const retorno of retornos) {
        const retornoOrigin = findLocality(retorno.origin);
        const retornoDest = findLocality(retorno.destination);
        if (!retornoOrigin || !retornoDest) continue;

        const routeLocalities = localitiesOnRoute(retornoOrigin.key, retornoDest.key, 80);
        const routeKeys = new Set([retornoOrigin.key, retornoDest.key, ...routeLocalities.map(l => l.key)]);

        let score = 0;
        const reasons = [];

        if (routeKeys.has(pedidoOrigin.key)) {
            score += 50;
            reasons.push('camionero pasa por tu zona');
        }

        // Puerto compatible
        const pedidoDest = findLocality(pedido.destination);
        if (pedidoDest && retornoOrigin) {
            const dist = calculateDistance(pedidoDest.lat, pedidoDest.lon, retornoOrigin.lat, retornoOrigin.lon);
            if (dist < 50) {
                score += 30;
                reasons.push('mismo puerto');
            }
        }

        if (retorno.date === 'hoy' || pedido.date === 'flexible') {
            score += 15;
            reasons.push('disponible pronto');
        }

        if (score >= 20) {
            matches.push({ retorno, score, reasons });
        }
    }

    return matches.sort((a, b) => b.score - a.score);
}

module.exports = { findMatches, findMatchesForRetorno, findMatchesForPedido };
