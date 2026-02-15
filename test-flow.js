// Quick test script for the full matching flow
const http = require('http');

function post(path, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request({
            hostname: 'localhost',
            port: 3000,
            path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch { resolve(body); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function get(path) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:3000${path}`, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch { resolve(body); }
            });
        }).on('error', reject);
    });
}

async function runTest() {
    console.log('=== TEST COMPLETO FletesCerealeros ===\n');

    // Paso 1: Registrar camionero Raul
    console.log('PASO 1: Registrar camionero Raul de Pehuajo');
    const r1 = await post('/api/simulate', { phone: '5492396550001', text: 'Hola, soy Raul, camionero de Pehuajo', name: 'Raul' });
    console.log('  Respuesta:', r1.response?.substring(0, 120));
    console.log('  Accion:', r1.action?.action || 'ninguna');
    console.log();

    // Paso 2: Registrar productora Maria
    console.log('PASO 2: Registrar productora Maria de Carlos Casares');
    const r2 = await post('/api/simulate', { phone: '5492396550002', text: 'Hola, soy Maria, productora de Carlos Casares', name: 'Maria' });
    console.log('  Respuesta:', r2.response?.substring(0, 120));
    console.log('  Accion:', r2.action?.action || 'ninguna');
    console.log();

    // Paso 3: Maria pide flete a Rosario
    console.log('PASO 3: Maria pide flete 28 tn de soja a Rosario');
    const r3 = await post('/api/simulate', { phone: '5492396550002', text: 'Necesito sacar 28 tn de soja a Rosario', name: 'Maria' });
    console.log('  Respuesta:', r3.response?.substring(0, 150));
    console.log('  Accion:', r3.action?.action || 'ninguna');
    console.log('  Match notifications:', r3.matchNotifications?.length || 0);
    console.log();

    // Paso 4: Raul avisa retorno vacio de Rosario en 2 hs
    console.log('PASO 4: Raul avisa retorno vacio de Rosario en 2 hs');
    const r4 = await post('/api/simulate', { phone: '5492396550001', text: 'Vuelvo de Rosario en 2 horas', name: 'Raul' });
    console.log('  Respuesta:', r4.response?.substring(0, 150));
    console.log('  Accion:', r4.action?.action || 'ninguna');
    console.log('  Match notifications:', r4.matchNotifications?.length || 0);
    if (r4.matchNotifications?.length > 0) {
        console.log('  --- MATCH ENCONTRADO! ---');
        r4.matchNotifications.forEach((n, i) => {
            console.log(`  Notif ${i + 1} (a ${n.phone}):`, n.text.substring(0, 120).replace(/\n/g, ' '));
        });

        // Paso 4b: Raul confirma el match
        console.log('\nPASO 4b: Raul confirma el match diciendo "sí"');
        const r4b = await post('/api/simulate', { phone: '5492396550001', text: 'Sí, dale', name: 'Raul' });
        console.log('  Respuesta:', r4b.response || '(sin respuesta directa)');
        console.log('  Accion:', r4b.action?.action || 'ninguna');
        console.log('  Notificaciones de confirmación:', r4b.matchNotifications?.length || 0);
        if (r4b.matchNotifications?.length > 0) {
            r4b.matchNotifications.forEach((n, i) => {
                console.log(`  Confirm Notif ${i + 1} (a ${n.phone}):`, n.text.substring(0, 120).replace(/\n/g, ' '));
            });
        }
    }
    console.log();

    // Paso 5: Verificar stats
    console.log('PASO 5: Verificar estadisticas');
    const stats = await get('/api/stats');
    console.log('  Stats:', JSON.stringify(stats, null, 2));
    console.log();

    // Paso 6: Verificar matches
    console.log('PASO 6: Verificar matches creados');
    const matches = await get('/api/matches');
    console.log('  Matches:', matches.length);
    matches.forEach((m, i) => {
        console.log(`  Match ${i + 1}: ${m.camionero_name} <-> ${m.productor_name} (score: ${m.score})`);
    });
    console.log();

    // Paso 7: Verificar viajes
    console.log('PASO 7: Verificar viajes activos');
    const trips = await get('/api/trips');
    console.log('  Viajes:', trips.length);
    trips.forEach((t, i) => {
        console.log(`  Viaje ${i + 1}: [${t.type}] ${t.origin} -> ${t.destination} (${t.user_name})`);
    });

    console.log('\n=== TEST COMPLETO ===');
}

runTest().catch(console.error);
