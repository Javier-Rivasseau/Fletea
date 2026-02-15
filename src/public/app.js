// ============================================================
// FletesCerealeros - Dashboard & WhatsApp Simulator (Frontend)
// ============================================================

const state = {
    currentPhone: '5492396550001',
    currentName: 'Raúl (Camionero)',
    chats: {},        // { phone: [{ role, text, time }] }
    refreshInterval: null,
};

// ─── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initProfileSelector();
    initQuickMessages();
    initChatForm();
    refreshDashboard();
    state.refreshInterval = setInterval(refreshDashboard, 5000);
});

// ─── Profile Selector ───────────────────────────────────────
function initProfileSelector() {
    document.querySelectorAll('.profile-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.profile-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentPhone = btn.dataset.phone;
            state.currentName = btn.dataset.name;
            renderChat();
            // Update quick messages based on profile type
            const isProductor = state.currentName.toLowerCase().includes('productor');
            updateQuickMessages(isProductor);
        });
    });
}

function updateQuickMessages(isProductor) {
    const container = document.querySelector('.quick-messages');
    if (isProductor) {
        container.innerHTML = `
      <button class="quick-btn" data-msg="Hola, soy productora de Carlos Casares">👋 Presentarme</button>
      <button class="quick-btn" data-msg="Necesito sacar 28 tn de soja a Rosario">📦 Pedir flete</button>
      <button class="quick-btn" data-msg="Necesito mover 32 tn de trigo a Bahía Blanca">📦 Flete trigo</button>
      <button class="quick-btn" data-msg="¿Qué hay disponible?">📋 Ver disponible</button>
      <button class="quick-btn" data-msg="ayuda">❓ Ayuda</button>
    `;
    } else {
        container.innerHTML = `
      <button class="quick-btn" data-msg="Hola, soy camionero de Pehuajó">👋 Presentarme</button>
      <button class="quick-btn" data-msg="Vuelvo de Rosario en 2 horas">🔄 Retorno vacío</button>
      <button class="quick-btn" data-msg="Vuelvo de Bahía Blanca vacío">🔄 Retorno BB</button>
      <button class="quick-btn" data-msg="Viajo a Rosario mañana">🚛 Ofrecer viaje</button>
      <button class="quick-btn" data-msg="¿Qué hay disponible?">📋 Ver disponible</button>
      <button class="quick-btn" data-msg="ayuda">❓ Ayuda</button>
    `;
    }
    initQuickMessages();
}

// ─── Quick Messages ─────────────────────────────────────────
function initQuickMessages() {
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById('chat-input');
            input.value = btn.dataset.msg;
            input.focus();
        });
    });
}

// ─── Chat Form ──────────────────────────────────────────────
function initChatForm() {
    document.getElementById('chat-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        addChatMessage(state.currentPhone, 'user', text);
        renderChat();
        showTyping();

        try {
            const res = await fetch('/api/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: state.currentPhone,
                    text,
                    name: state.currentName.split(' (')[0],
                }),
            });
            const data = await res.json();
            hideTyping();

            addChatMessage(state.currentPhone, 'assistant', data.response);

            // Show match notifications
            if (data.matchNotifications?.length > 0) {
                for (const notif of data.matchNotifications) {
                    addChatMessage(notif.phone, 'assistant', notif.text);
                    // If notification is for this user's phone, show it inline
                    if (notif.phone === state.currentPhone) {
                        addChatMessage(state.currentPhone, 'notification', '🎯 ¡Match encontrado!');
                    }
                }
            }

            renderChat();
            refreshDashboard();
        } catch (err) {
            hideTyping();
            addChatMessage(state.currentPhone, 'assistant', '⚠️ Error de conexión. ¿Está corriendo el servidor?');
            renderChat();
        }
    });
}

// ─── Chat Message Management ────────────────────────────────
function addChatMessage(phone, role, text) {
    if (!state.chats[phone]) state.chats[phone] = [];
    state.chats[phone].push({
        role,
        text,
        time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
    });
}

function renderChat() {
    const container = document.getElementById('chat-container');
    const messages = state.chats[state.currentPhone] || [];

    if (messages.length === 0) {
        container.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-icon">🚛🌾</div>
        <p>Chateá como <strong>${state.currentName}</strong></p>
        <p><small>Usá los botones rápidos o escribí un mensaje</small></p>
      </div>`;
        return;
    }

    container.innerHTML = messages.map(m => {
        if (m.role === 'notification') {
            return `<div class="chat-bubble notification">${escapeHtml(m.text)}</div>`;
        }
        return `
      <div class="chat-bubble ${m.role}">
        ${m.role === 'assistant' ? '<div class="bubble-phone">FletesCerealeros Bot</div>' : ''}
        <div>${formatMessage(m.text)}</div>
        <div class="bubble-time">${m.time}</div>
      </div>`;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

function showTyping() {
    const container = document.getElementById('chat-container');
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.id = 'typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
}

function hideTyping() {
    const el = document.getElementById('typing');
    if (el) el.remove();
}

// ─── Dashboard Refresh ──────────────────────────────────────
async function refreshDashboard() {
    try {
        const [stats, trips, matches, users] = await Promise.all([
            fetch('/api/stats').then(r => r.json()),
            fetch('/api/trips').then(r => r.json()),
            fetch('/api/matches').then(r => r.json()),
            fetch('/api/users').then(r => r.json()),
        ]);

        // Update stats
        document.getElementById('stat-users').textContent = stats.totalUsers;
        document.getElementById('stat-camioneros').textContent = stats.camioneros;
        document.getElementById('stat-productores').textContent = stats.productores;
        document.getElementById('stat-retornos').textContent = stats.retornosVacios;
        document.getElementById('stat-pedidos').textContent = stats.pedidosFlete;
        document.getElementById('stat-matches').textContent = stats.matchesRealizados;

        // Update trips
        const tripsList = document.getElementById('trips-list');
        if (trips.length === 0) {
            tripsList.innerHTML = '<div class="empty-state">No hay viajes registrados todavía</div>';
        } else {
            tripsList.innerHTML = trips.map(t => `
        <div class="trip-item">
          <span class="trip-type ${t.type}">${formatTripType(t.type)}</span>
          <div class="trip-route">${t.origin} → ${t.destination}</div>
          <div class="trip-meta">
            ${t.user_name || 'Sin nombre'} · 
            ${t.cereal_type ? t.cereal_type + ' · ' : ''}
            ${t.tons ? t.tons + ' tn · ' : ''}
            ${t.time_estimate || ''}
          </div>
        </div>`).join('');
        }

        // Update matches
        const matchesList = document.getElementById('matches-list');
        if (matches.length === 0) {
            matchesList.innerHTML = '<div class="empty-state">No hay matches todavía</div>';
        } else {
            matchesList.innerHTML = matches.map(m => `
        <div class="match-item">
          <span class="match-score">Score: ${m.score}</span>
          <span style="margin-left:8px;font-size:12px;color:var(--text-muted)">${m.status}</span>
          <div class="match-parties">
            🚛 ${m.camionero_name || 'Camionero'} ↔ 🌾 ${m.productor_name || 'Productor'}
          </div>
          <div class="trip-meta">${m.trip_origin || '?'} → ${m.trip_destination || '?'}</div>
        </div>`).join('');
        }

        // Update users
        const usersList = document.getElementById('users-list');
        if (users.length === 0) {
            usersList.innerHTML = '<div class="empty-state">No hay usuarios registrados</div>';
        } else {
            usersList.innerHTML = users.map(u => `
        <div class="user-item">
          <span class="user-type-badge ${u.type}">${u.type}</span>
          <strong style="margin-left:8px">${u.name || 'Sin nombre'}</strong>
          <div class="user-meta">${u.locality || 'Sin localidad'} · ${u.phone}</div>
        </div>`).join('');
        }

    } catch (err) {
        console.error('Error refreshing dashboard:', err);
    }
}

// ─── Helpers ─────────────────────────────────────────────────
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatMessage(text) {
    return escapeHtml(text)
        .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

function formatTripType(type) {
    const map = {
        retorno_vacio: '🔄 Retorno vacío',
        pedido_flete: '📦 Pedido flete',
        oferta_flete: '🚛 Oferta flete',
    };
    return map[type] || type;
}
