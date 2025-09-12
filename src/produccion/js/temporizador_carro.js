

// /js/temporizador_carro.js  (ES module)

// ⛔ MOD: ampliar import
import { setEtapaCarro, getEtapaCarro, esEtapa1 } from './utilsEtapasMedicion.js';

// (Fallback seguro por si tu utils no exporta get/es)
if (typeof getEtapaCarro !== 'function') {
  window.__GET_ETAPA_FALLBACK__ = (cid) => Number(localStorage.getItem(`carro:${cid}:etapa`) || 1);
}
if (typeof esEtapa1 !== 'function') {
  window.__ES_ETAPA1_FALLBACK__ = (cid) => (window.__GET_ETAPA_FALLBACK__?.(cid) ?? 1) === 1;
}


let _inicializado = false;

/* ──────────────────────────────────────────────────────────────
   Fallback para APIs: prueba /api/tiempos y si no existe, /api/produccion
   ────────────────────────────────────────────────────────────── */
const _API_BASES = [
  (p) => `http://localhost:3002/api/tiempos${p}`,
  (p) => `http://localhost:3002/api/produccion${p}`,
];

async function _postFirstAvailable(path, query, data) {
  const q = query ? `?${new URLSearchParams(query).toString()}` : '';
  let lastErr;
  for (const mk of _API_BASES) {
    const url = mk(path) + q;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: data ? { 'Content-Type': 'application/json' } : undefined,
        body: data ? JSON.stringify(data) : undefined,
      });
      if (res.ok) return res;
      if (res.status === 404) { lastErr = res; continue; }
      const txt = await res.text();
      throw new Error(`${res.status} ${txt}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No se encontró endpoint en ningún base');
}

/* ──────────────────────────────────────────────────────────────
   Snapshot local de etapas (para rehidratación)
   ────────────────────────────────────────────────────────────── */
const _ST_KEY = id => `timers_carro_${id}`;
const _load = id => {
  try { return JSON.parse(localStorage.getItem(_ST_KEY(id))) || {1:{},2:{},3:{}}; }
  catch { return {1:{},2:{},3:{}}; }
};
const _save = (id, snap) => { try { localStorage.setItem(_ST_KEY(id), JSON.stringify(snap)); } catch {} };

// --- snapshot por ARTÍCULO (igual idea que etapas) ---
const _ART_KEY = id => `timers_articulos_${id}`;
const _loadArt = (id) => {
  try { return JSON.parse(localStorage.getItem(_ART_KEY(id))) || {}; }
  catch { return {}; }
};
const _saveArt = (id, snap) => {
  try { localStorage.setItem(_ART_KEY(id), JSON.stringify(snap)); } catch {}
};



// Importa estado del backend → snapshot local por artículo
export function importarEstadoLocalArticulos(carroId, filas) {
  const snap = {};
  (filas || []).forEach(r => {
    const n = r.articulo_numero;
    if (!n) return;
    if (r.tiempo_fin)    snap[n] = { running:false, start:null, elapsed:Number(r.duracion_ms || 0) };
    else if (r.tiempo_inicio) snap[n] = { running:true,  start:Date.parse(r.tiempo_inicio), elapsed:0 };
    else                 snap[n] = { running:false, start:null, elapsed:0 };
  });
  _saveArt(carroId, snap);
}

// Actualiza un artículo en el snapshot
function _updateArtSnap(carroId, numero, patch) {
  const snap = _loadArt(carroId);
  snap[numero] = { ...(snap[numero] || {}), ...patch };
  _saveArt(carroId, snap);
}

// Convierte el SELECT del backend en snapshot local
export function importarEstadoLocal(carroId, est) {
  const snap = { 1:{}, 2:{}, 3:{} };
  [1,2,3].forEach(n => {
    const i   = est[`etapa${n}_inicio`];
    const f   = est[`etapa${n}_fin`];
    const dur = Number(est[`etapa${n}_duracion_ms`] || 0);
    if (f)        snap[n] = { running:false, start:null, elapsed: dur };
    else if (i)   snap[n] = { running:true,  start: Date.parse(i), elapsed: 0 };
    else          snap[n] = { running:false, start:null, elapsed: 0 };
  });
  _save(carroId, snap);
}

/* ──────────────────────────────────────────────────────────────
   Estado local en memoria (para ticks y clases)
   ────────────────────────────────────────────────────────────── */
const etapas = new Map(); // carroId -> {1:{running,start,interval}, 2:{...}, 3:{...}}
function _ensure(carroId) {
  if (!etapas.has(carroId)) etapas.set(carroId, {1:{},2:{},3:{}});
  return etapas.get(carroId);
}

function _carroBloqueado() { return !!window.__carroBloqueadoPorPreparado; }
function _etapaTerminada(carroId, n) {
  const s = _load(carroId)[n] || {};
  return !s.running && (s.elapsed || 0) > 0;
}

/* ──────────────────────────────────────────────────────────────
   Temporizadores por artículo
   ────────────────────────────────────────────────────────────── */
const temporizadores = new Map(); // key -> { running, start, interval }

let usuarioId = null;
try {
  const colab = localStorage.getItem('colaboradorActivo');
  usuarioId = colab ? JSON.parse(colab).id : null;
} catch (err) {
  console.error('Error leyendo colaboradorActivo:', err);
}

export function formatearTiempo(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s/60)).padStart(2, '0');
  const ss = String(s%60).padStart(2, '0');
  return `${mm}:${ss}`;
}
function _key(carroId, numero){ return `${carroId}:${numero}`; }

// ⛔ NUEVO: Detiene SOLAMENTE los temporizadores por artículo que estén corriendo
async function _detenerMedicionArticulosEnCurso(carroId) {
  const idStr = String(carroId);

  // A) Timers vivos en memoria
  for (const [k, t] of Array.from(temporizadores.entries())) {
    if (!k.startsWith(idStr + ':')) continue;
    const numero = k.split(':')[1];

    // 👉 Solo si está corriendo (si no, no tocamos nada)
    if (!t || !t.running) continue;

    try {
      t.running = false;
      if (t.interval) { try { clearInterval(t.interval); } catch {} }
      const startMs = t.start || Date.now();
      const elapsed = Math.max(0, Date.now() - startMs);

      // Snapshot
      _updateArtSnap(carroId, numero, { running: false, start: null, elapsed });

      // UI
      let btn = null;
      document.querySelectorAll('.btn-temporizador-articulo').forEach(b => {
        if (String(b.dataset.numero) === String(numero)) btn = b;
      });
      if (btn) {
        _showElapsedOnButton(btn, elapsed);
        btn.classList.remove('running');
        btn.classList.add('finished');
      }

      // Backend
      try {
        await _postFirstAvailable(
          `/carro/${carroId}/articulo/${encodeURIComponent(numero)}/finalizar`,
          { usuarioId },
          { elapsedMs: elapsed }
        );
      } catch (e) {
        console.error('[Auto-stop E3] No se pudo registrar fin de artículo', numero, e);
      }
    } catch (e) {
      console.error('[Auto-stop E3] Error deteniendo artículo', numero, e);
    }
  }

  // B) Casos rehidratados: “running” solo en snapshot (sin intervalo en RAM)
  const snap = _loadArt(carroId) || {};
  for (const numero of Object.keys(snap)) {
    const s = snap[numero];

    // 👉 Solo si figura corriendo y tiene start
    if (!s || !s.running || !s.start) continue;

    try {
      const elapsed = Math.max(0, Date.now() - s.start);

      _updateArtSnap(carroId, numero, { running: false, start: null, elapsed });

      let btn = null;
      document.querySelectorAll('.btn-temporizador-articulo').forEach(b => {
        if (String(b.dataset.numero) === String(numero)) btn = b;
      });
      if (btn) {
        _showElapsedOnButton(btn, elapsed);
        btn.classList.remove('running');
        btn.classList.add('finished');
      }

      try {
        await _postFirstAvailable(
          `/carro/${carroId}/articulo/${encodeURIComponent(numero)}/finalizar`,
          { usuarioId },
          { elapsedMs: elapsed }
        );
      } catch (e) {
        console.error('[Auto-stop E3] (snapshot) No se pudo registrar fin de artículo', numero, e);
      }
    } catch (e) {
      console.error('[Auto-stop E3] (snapshot) Error deteniendo artículo', numero, e);
    }
  }
}


function _showElapsedOnButton(btn, elapsedMs, etiqueta='') {
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('finished');
  const t = formatearTiempo(elapsedMs);
  btn.textContent = `✅ ${t}${etiqueta ? ` ${etiqueta}` : ''}`;
  btn.title = `Tiempo total${etiqueta ? ` (${etiqueta})` : ''}: ${t}`;
}
function _showElapsedOnBadge(el, elapsedMs, etiqueta='') {
  if (!el) return;
  const t = formatearTiempo(elapsedMs);
  el.textContent = `✅ ${t}${etiqueta ? ` ${etiqueta}` : ''}`;
  el.classList.add('finished');
  el.title = `Tiempo total${etiqueta ? ` (${etiqueta})` : ''}: ${t}`;
}

/* ──────────────────────────────────────────────────────────────
   UI helpers (ticks y show/hide)
   ────────────────────────────────────────────────────────────── */
function _tickEtapa1(carroId) {
  const st = _ensure(carroId)[1];
  const btn = document.getElementById('btn-etapa1');
  if (!btn || !st.start) return;
  btn.textContent = `⏹️ ${formatearTiempo(Date.now() - st.start)} (Etapa 1)`;
}
function _tickEtapa2(carroId) {
  const st = _ensure(carroId)[2];
  const badge = document.getElementById('badge-etapa2');
  if (!badge || !st.start) return;
  badge.textContent = `⏱ ${formatearTiempo(Date.now() - st.start)} (Etapa 2)`;
}
function _tickEtapa3(carroId) {
  const st = _ensure(carroId)[3];
  const btn = document.getElementById('btn-etapa3');
  if (!btn || !st.start) return;
  btn.textContent = `⏹️ ${formatearTiempo(Date.now() - st.start)} (Etapa 3)`;
}

function _showEtapa1(show){ const b = document.getElementById('btn-etapa1'); if (b) b.style.display = show ? 'inline-block' : 'none'; }
function _showEtapa2(show){ const b = document.getElementById('badge-etapa2'); if (b) b.style.display = show ? 'inline-block' : 'none'; }
export function showEtapa3Button(show){ const b = document.getElementById('btn-etapa3'); if (b) b.style.display = show ? 'inline-block' : 'none'; }


// ⛔ NUEVO: habilita/inhabilita botones por artículo según etapa actual
function _aplicarBloqueoArticulosPorEtapa(carroId) {
  const getEtapa = (typeof getEtapaCarro === 'function') ? getEtapaCarro : window.__GET_ETAPA_FALLBACK__;
  const etapa = getEtapa?.(carroId) ?? 1;
  const bloquear = etapa === 1;

  document.querySelectorAll('.btn-temporizador-articulo').forEach(btn => {
    // no tocar botones ya finalizados
    const estaFinalizado = btn.classList.contains('finished');
    if (estaFinalizado) return;

    btn.disabled = bloquear;
    btn.classList.toggle('bloqueado', bloquear);
    btn.title = bloquear ? 'Bloqueado en Etapa 1' : '';
  });
}

/* ──────────────────────────────────────────────────────────────
   HTTP helper (?usuarioId=)
   ────────────────────────────────────────────────────────────── */
async function _postEtapa(urlBase, uid) {
  const res = await fetch(`${urlBase}?usuarioId=${encodeURIComponent(uid)}`, { method: 'POST' });
  if (!res.ok) throw new Error(`[${res.status}] ${await res.text()}`);
  try { return await res.json(); } catch { return {}; }
}

/* ──────────────────────────────────────────────────────────────
   API Etapas
   ────────────────────────────────────────────────────────────── */
export async function startEtapa1(carroId, uid){
  if (_carroBloqueado()) { alert('El carro ya fue preparado. No se puede reiniciar medición.'); return; }
  if (_etapaTerminada(carroId, 1)) { alert('Etapa 1 ya finalizada.'); return; }

 try {
    await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/1/iniciar`, uid);
    const s = _ensure(carroId)[1];
    s.running = true; s.start = Date.now();
    clearInterval(s.interval);
    s.interval = setInterval(()=>_tickEtapa1(carroId), 1000);
    _tickEtapa1(carroId);
    _showEtapa1(true);
    const btn = document.getElementById('btn-etapa1');
    if (btn) { btn.classList.add('running'); btn.classList.remove('finished'); btn.disabled = false; }
  } finally {
    // ⛔ NUEVO: marcar etapa 1 activa y bloquear botones por artículo
    setEtapaCarro(carroId, 1);
    _aplicarBloqueoArticulosPorEtapa(carroId);
  }
}



export async function stopEtapa1(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/1/finalizar`, uid);
  const s = _ensure(carroId)[1];
  const elapsedMs = s.start ? (Date.now() - s.start) : 0;
  s.running = false;
  clearInterval(s.interval);
  const btn = document.getElementById('btn-etapa1');
  if (btn) _showElapsedOnButton(btn, elapsedMs, '(Etapa 1)');
  if (btn) { btn.classList.remove('running'); btn.classList.add('finished'); }

  // ⛔ NUEVO: mantenemos etapa 1 hasta iniciar etapa 2 → sigue bloqueado
  setEtapaCarro(carroId, 1);
  _aplicarBloqueoArticulosPorEtapa(carroId);
}



export async function startEtapa2(carroId, uid){
  if (_carroBloqueado()) { alert('El carro ya fue preparado.'); return; }
  if (_etapaTerminada(carroId, 2)) { alert('Etapa 2 ya finalizada.'); return; }

  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/2/iniciar`, uid);
  const s = _ensure(carroId)[2];
  s.running = true; s.start = Date.now();
  clearInterval(s.interval);
  s.interval = setInterval(()=>_tickEtapa2(carroId), 1000);

  const badge = document.getElementById('badge-etapa2');
  if (badge){
    badge.style.display = 'inline-block';
    badge.classList.add('etapa-pill');
    badge.classList.remove('finished');
    badge.classList.add('running');
  }
  _tickEtapa2(carroId);

  // ⛔ NUEVO: pasamos a etapa 2 y desbloqueamos botones por artículo
  setEtapaCarro(carroId, 2);
  _aplicarBloqueoArticulosPorEtapa(carroId);
}
export async function stopEtapa2(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/2/finalizar`, uid);
  const s = _ensure(carroId)[2];
  const elapsedMs = s.start ? (Date.now() - s.start) : 0;
  s.running = false;
  clearInterval(s.interval);

  const badge = document.getElementById('badge-etapa2');
  if (badge){
    _showElapsedOnBadge(badge, elapsedMs, '(Etapa 2)');
    badge.style.display = 'inline-block';
    badge.classList.add('etapa-pill');
    badge.classList.remove('running');
    badge.classList.add('finished');
  }
}

export async function startEtapa3(carroId, uid){
  if (_carroBloqueado()) { alert('El carro ya fue preparado.'); return; }
  if (_etapaTerminada(carroId, 3)) { alert('Etapa 3 ya finalizada.'); return; }

  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/3/iniciar`, uid);

  // ⛔ NUEVO: detener SOLO los artículos que sigan corriendo
  await _detenerMedicionArticulosEnCurso(carroId);

  const s = _ensure(carroId)[3];
  s.running = true; s.start = Date.now();
  clearInterval(s.interval);
  s.interval = setInterval(()=>_tickEtapa3(carroId), 1000);
  _tickEtapa3(carroId);
  showEtapa3Button(true);
  const btn = document.getElementById('btn-etapa3');
  if (btn) { btn.classList.add('running'); btn.classList.remove('finished'); btn.disabled = false; }
}
export async function stopEtapa3(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/3/finalizar`, uid);
  const s = _ensure(carroId)[3];
  const elapsedMs = s.start ? (Date.now() - s.start) : 0;
  s.running = false;
  clearInterval(s.interval);
  const btn = document.getElementById('btn-etapa3');
  if (btn) _showElapsedOnButton(btn, elapsedMs, '(Etapa 3)');
  if (btn) { btn.classList.remove('running'); btn.classList.add('finished'); }
}

/* ──────────────────────────────────────────────────────────────
   Ocultar todo al salir del modo
   ────────────────────────────────────────────────────────────── */

 // 🔹 Oculta todo y corta intervalos cuando no hay carro seleccionado
export function clearTimersForNoCar() {
  try {
    const cid = window.carroIdGlobal || localStorage.getItem('carroActivo');
    if (cid && etapas.has(cid)) {
      const st = etapas.get(cid);
      [1, 2, 3].forEach(n => {
        if (st[n] && st[n].interval) clearInterval(st[n].interval);
        if (st[n]) { st[n].running = false; st[n].start = null; }
      });
    }
  } catch {}
  _hideAllTimers(); // oculta artículos + E1 + E2 + E3 + píldoras
}
   
function _hideAllTimers() {
  //botones por articulo
  document.querySelectorAll('.btn-temporizador-articulo')
   .forEach(b => b.style.display = 'none');
  
   //etapas
   _showEtapa1(false);
  _showEtapa2(false);
  showEtapa3Button(false);

  // 🔹 ocultar también las píldoras verdes
    [1,2,3].forEach(n => {
      const p = document.getElementById(`pill-etapa-${n}`);
      if (p) p.style.display = 'none';
    });
}

/* ──────────────────────────────────────────────────────────────
   Rehidratar UI desde snapshot (MOSTRAR badge-etapa2/btn-etapa3)
   ────────────────────────────────────────────────────────────── */
export function rehidratarDesdeEstado(carroId) {
  const snap = _load(carroId);

  // E1
  const s1 = snap[1] || {};
  const btn1 = document.getElementById('btn-etapa1');
  if (btn1) {
    if (s1.running && s1.start) {
      const st = _ensure(carroId)[1] = { running:true, start:s1.start, interval:null };
      clearInterval(st.interval);
      st.interval = setInterval(()=>_tickEtapa1(carroId), 1000);
      _showEtapa1(true);
      btn1.classList.add('running'); btn1.classList.remove('finished'); btn1.disabled = false;
      _tickEtapa1(carroId);
    } else if ((s1.elapsed||0) > 0) {
      _ensure(carroId)[1] = { running:false, start:null, interval:null };
      _showEtapa1(true);
      _showElapsedOnButton(btn1, s1.elapsed, '(Etapa 1)');
    } else {
      _showEtapa1(true);
      btn1.textContent = '⏱ 00:00 (Etapa 1)';
      btn1.classList.remove('running','finished'); btn1.disabled = false;
    }
  }

  // E2 → badge
  const s2 = snap[2] || {};
  const badge = document.getElementById('badge-etapa2');
  if (badge) {
    if (s2.running && s2.start) {
      const st = _ensure(carroId)[2] = { running:true, start:s2.start, interval:null };
      clearInterval(st.interval);
      st.interval = setInterval(()=>_tickEtapa2(carroId), 1000);
      badge.classList.add('running'); badge.classList.remove('finished');
      badge.style.display = 'inline-block';
      _tickEtapa2(carroId);
    } else if ((s2.elapsed||0) > 0) {
      _ensure(carroId)[2] = { running:false, start:null, interval:null };
      _showEtapa2(true);
      _showElapsedOnBadge(badge, s2.elapsed, '(Etapa 2)');
    } else {
      badge.textContent = '';
      badge.classList.remove('running','finished');
      badge.style.display = 'none';
    }
  }

  // E3 → botón
  const s3 = snap[3] || {};
  const btn3 = document.getElementById('btn-etapa3');
  if (btn3) {
    if (s3.running && s3.start) {
      const st = _ensure(carroId)[3] = { running:true, start:s3.start, interval:null };
      clearInterval(st.interval);
      st.interval = setInterval(()=>_tickEtapa3(carroId), 1000);
      showEtapa3Button(true);
      btn3.classList.add('running'); btn3.classList.remove('finished'); btn3.disabled = false;
      _tickEtapa3(carroId);
    } else if ((s3.elapsed||0) > 0) {
      _ensure(carroId)[3] = { running:false, start:null, interval:null };
      showEtapa3Button(true);
      _showElapsedOnButton(btn3, s3.elapsed, '(Etapa 3)');
    } else {
      showEtapa3Button(false);
      btn3.classList.remove('running','finished'); btn3.disabled = false;
    }
  }

  // Mantener coherencia con el botón global
  if (typeof syncTimerButtonsVisibility === 'function') {
    syncTimerButtonsVisibility();
  }
}

/* Rehidrata los botones .btn-temporizador-articulo según snapshot guardado*/
export function rehidratarArticulosDesdeEstado(carroId) {
  const snap = _loadArt(carroId);
  const modoActivo = !!(document.getElementById('btn-temporizador-global')?.classList.contains('activo'));

  document.querySelectorAll('.btn-temporizador-articulo').forEach(btn => {
    const numero = btn.dataset.numero;
    const s = snap[numero];

    // Por defecto
    btn.style.display = modoActivo ? 'inline-block' : 'none';

    if (!s) {
      btn.textContent = '⏱ Iniciar';
      btn.classList.remove('running', 'finished');
      btn.disabled = false;
      return;
    }

    const k = _key(carroId, numero);
    let t = temporizadores.get(k);

    if (s.running && s.start) {
      // Mostrar corriendo desde la hora persistida
      btn.classList.add('running');
      btn.classList.remove('finished');
      btn.disabled = false;

      t = t || { running:true, start:s.start, interval:null };
      t.running = true; t.start = s.start;
      clearInterval(t.interval);
      const actualizar = () => { btn.textContent = `⏹ ${formatearTiempo(Date.now() - t.start)} ×`; };
      actualizar();
      t.interval = setInterval(actualizar, 1000);
      temporizadores.set(k, t);
      return;
    }

    if ((s.elapsed || 0) > 0) {
      // Ya finalizado
      btn.classList.remove('running');
      btn.classList.add('finished');
      btn.disabled = true;
      btn.textContent = `✅ ${formatearTiempo(s.elapsed)}`;
      return;
    }

    // Nunca iniciado
    btn.classList.remove('running', 'finished');
    btn.disabled = false;
    btn.textContent = '⏱ Iniciar';
  });
   // ⛔ NUEVO: asegurar bloqueo/permiso según etapa actual
  _aplicarBloqueoArticulosPorEtapa(carroId);
}


/* ──────────────────────────────────────────────────────────────
   INIT + listeners
   ────────────────────────────────────────────────────────────── */
export function initTemporizadores() {
  if (_inicializado) return;
  _inicializado = true;

  // Botón global "Modo medición"
  document.addEventListener('click', async (e) => {
    if (!(e.target && e.target.id === 'btn-temporizador-global')) return;

    const botonGlobal = e.target;
    const activo = botonGlobal.classList.toggle('activo');
    botonGlobal.textContent = activo ? '🛑 Salir de medición' : '⏱ Modo medición';

    if (activo) {
      // Mostrar controles por artículo
      document.querySelectorAll('.btn-temporizador-articulo')
        .forEach(b => b.style.display = 'inline-block');

      const carroId = localStorage.getItem('carroActivo');
      _showEtapa1(!!carroId);

      if (carroId) {
        // Usuario (tolerante a JSON inválido)
        let colab = {};
        try { colab = JSON.parse(localStorage.getItem('colaboradorActivo') || '{}'); } catch {}
        const uid = colab?.id ?? '';

        // 1) Estado de ETAPAS
        try {
          const r = await fetch(
            `http://localhost:3002/api/tiempos/carro/${carroId}/etapas/estado?usuarioId=${encodeURIComponent(uid)}`
          );
          if (r.ok) {
            const est = await r.json();
            window.__carroBloqueadoPorPreparado = !!est.preparado;
            importarEstadoLocal(carroId, est);
          }
        } catch (_) { /* no romper UI */ }
        rehidratarDesdeEstado(carroId);
        syncTimerButtonsVisibility();
        // ⛔ Opcionalmente explícito (no necesario si agregaste en sync/rehidratar):
        _aplicarBloqueoArticulosPorEtapa(carroId);

        // 2) Estado de TEMPORIZADORES POR ARTÍCULO
        try {
          const r2 = await fetch(
            `http://localhost:3002/api/tiempos/carro/${carroId}/articulos/estado?usuarioId=${encodeURIComponent(uid)}`
          );
          if (r2.ok) {
            const lista = await r2.json();
            importarEstadoLocalArticulos(carroId, lista);
          }
        } catch (_) { /* no romper UI */ }
        rehidratarArticulosDesdeEstado(carroId);
        syncTimerButtonsVisibility();
      } else {
        // Sin carro activo, sólo actualizamos visibilidad general
        syncTimerButtonsVisibility();
      }
    } else {
      // Salir de modo medición: ocultar TODO
      _hideAllTimers();
      syncTimerButtonsVisibility();
    }
  });
}

  // Temporizador por artículo
  document.addEventListener('click', async (e) => {
    if (!e.target.classList.contains('btn-temporizador-articulo')) return;

    const btn = e.target;
    if (btn.disabled || btn.classList.contains('finished')) return; // ⛔ ya finalizado

    const numero  = btn.dataset.numero;
    const carroId = window.carroIdGlobal;
    if (!carroId || !numero) return;

     // ⛔ NUEVO: bloqueo duro si Etapa 1
  const esE1 = (typeof esEtapa1 === 'function') ? esEtapa1(carroId)
              : (window.__ES_ETAPA1_FALLBACK__?.(carroId) ?? true);
  if (esE1) {
    // Mostrá tu toast/modal si preferís
    alert('⛔ La medición por artículo está bloqueada durante la Etapa 1.');
    return;
  }


    // usa la misma lógica de “terminado” que en etapas, pero para artículos
    const sArt = (_loadArt(carroId) || {})[numero];
    if (sArt && !sArt.running && (sArt.elapsed || 0) > 0) {
      // Ya estaba finalizado (rehidratado desde el back) → no permitir reinicio
      _showElapsedOnButton(btn, sArt.elapsed);
      return;
    }

    const k = _key(carroId, numero);
    let t = temporizadores.get(k);

    // Iniciar
    if (!t || !t.running) {
      t = { running: true, start: Date.now(), interval: null };
      temporizadores.set(k, t);

        // 🔸 snapshot: marcamos corriendo (misma idea que etapas)
    _updateArtSnap(carroId, numero, { running: true, start: t.start, elapsed: 0 });

      const actualizar = () => {
        const ms = Date.now() - t.start;
        btn.textContent = `⏹ ${formatearTiempo(ms)} ×`;
      };
      actualizar();
      t.interval = setInterval(actualizar, 1000);
      btn.classList.add('running');

      try {
        await _postFirstAvailable(
          `/carro/${carroId}/articulo/${encodeURIComponent(numero)}/iniciar`,
          { usuarioId }
        );
      } catch (err) {
        console.error('No se pudo registrar inicio de artículo:', err);
      }
      return;
    }

    // Detener
    if (t.running) {
      t.running = false;
      clearInterval(t.interval);
      const elapsed = Date.now() - t.start;

      // 🔸 snapshot: guardamos final (como en etapas)
    _updateArtSnap(carroId, numero, { running: false, start: null, elapsed });

    _showElapsedOnButton(btn, elapsed);
    btn.classList.remove('running');
    btn.classList.add('finished');

      try {
        await _postFirstAvailable(
          `/carro/${carroId}/articulo/${encodeURIComponent(numero)}/finalizar`,
          { usuarioId },
          { elapsedMs: elapsed }
        );
      } catch (err) {
        console.error('No se pudo registrar fin de artículo:', err);
      }
    }
  });

  // Toggle Etapa 1
  document.addEventListener('click', async (e)=>{
    if (!(e.target && e.target.id === 'btn-etapa1')) return;

    const carroId = localStorage.getItem('carroActivo');
    const colabStr = localStorage.getItem('colaboradorActivo');
    const uid = colabStr ? JSON.parse(colabStr).id : null;
    if (!carroId || !uid) return;

    try {
      const s = _ensure(carroId)[1];
      if (s.running) await stopEtapa1(carroId, uid);
      else           await startEtapa1(carroId, uid);
    } catch(err) {
      console.error(err);
      alert(`No se pudo alternar la Etapa 1.\n${err.message || ''}`);
    }
  });

  // Toggle Etapa 3 (pausa/reanudar)
  document.addEventListener('click', async (e)=>{
    if (!(e.target && e.target.id === 'btn-etapa3')) return;

    const carroId = localStorage.getItem('carroActivo');
    const colabStr = localStorage.getItem('colaboradorActivo');
    const uid = colabStr ? JSON.parse(colabStr).id : null;
    if (!carroId || !uid) return;

    try {
      const s = _ensure(carroId)[3];
      if (s.running) await stopEtapa3(carroId, uid);
      else           await startEtapa3(carroId, uid);
    } catch(err) {
      console.error(err);
      alert(`No se pudo alternar la Etapa 3.\n${err.message || ''}`);
    }
  });


/* ──────────────────────────────────────────────────────────────
   Visibilidad tras render
   ────────────────────────────────────────────────────────────── */

export function syncTimerButtonsVisibility() {
  const botonGlobal = document.getElementById('btn-temporizador-global');
  const activo = botonGlobal && botonGlobal.classList.contains('activo');

  // Si Modo medición NO está activo → ocultar todo
  if (!activo) {
    _hideAllTimers();
    return;
  }

  // Si Modo medición está activo PERO NO hay carro seleccionado → ocultar todo
  // ⚠️ Modo activo pero SIN carro seleccionado → ocultar todo
  const carroId = (window.carroIdGlobal && String(window.carroIdGlobal)) || localStorage.getItem('carroActivo');
  if (!carroId) {
    _hideAllTimers();
    return;
  }

  // ⏱ por artículo
  document.querySelectorAll('.btn-temporizador-articulo')
    .forEach(b => b.style.display = 'inline-block');

  // Etapa 1 (visible si hay carro)
  _showEtapa1(true);

  // Etapa 2 (visible si está corriendo o si quedó finalizada)
  {
    const s2 = _ensure(carroId)[2];
    const badge = document.getElementById('badge-etapa2');
    if (badge) {
      const running  = !!(s2 && s2.running);
      const finished = badge.classList.contains('finished');
      const show = running || finished;
      _showEtapa2(show);
      if (!show) badge.textContent = '';
    }
  }

  // Etapa 3 (visible si está corriendo o si quedó finalizada)
  {
    const b3 = document.getElementById('btn-etapa3');
    if (b3) {
      const show3 = b3.classList.contains('running') || b3.classList.contains('finished');
      showEtapa3Button(show3);
    }
  }

  // Píldoras verdes (mostrar solo si hay carro seleccionado)
  [1,2,3].forEach(n => {
    const pill = document.getElementById(`pill-etapa-${n}`);
    if (pill) pill.style.display = 'inline-block';
  });
 // ⛔ NUEVO: asegurar bloqueo/permiso según etapa actual
  _aplicarBloqueoArticulosPorEtapa(carroId);

}


/*Limpieza de temporizadores al eliminar el carro*/

// Limpia todo lo relacionado a un carro: intervalos, storage y UI
export function clearTimersForCarro(carroId) {
  if (!carroId) return;
  const idStr = String(carroId);

  // 1) Parar intervalos de ETAPAS y olvidar estado en memoria
  const st = etapas.get(idStr);
  if (st) {
    [1,2,3].forEach(n => {
      const s = st[n];
      if (s && s.interval) { try { clearInterval(s.interval); } catch {} }
    });
    etapas.delete(idStr);
  }

  // 2) Parar intervalos de ARTÍCULOS y olvidar estado en memoria
  for (const [k, t] of Array.from(temporizadores.entries())) {
    if (k.startsWith(idStr + ':')) {
      if (t && t.interval) { try { clearInterval(t.interval); } catch {} }
      temporizadores.delete(k);
    }
  }

  // 3) Borrar snapshots persistidos
  try { localStorage.removeItem(`timers_carro_${idStr}`); } catch {}
  try { localStorage.removeItem(`timers_articulos_${idStr}`); } catch {}

  // 4) Resetear UI (ocultar todo y devolver textos por defecto)
  _hideAllTimers();

  const b1 = document.getElementById('btn-etapa1');
  if (b1) { b1.textContent = '00:00 (Etapa 1)'; b1.classList.remove('running','finished'); b1.disabled = false; }
  const b2 = document.getElementById('badge-etapa2');
  if (b2) { b2.textContent = ''; b2.classList.remove('running','finished'); }
  const b3 = document.getElementById('btn-etapa3');
  if (b3) { b3.textContent = '00:00 (Etapa 3)'; b3.classList.remove('running','finished'); b3.disabled = false; }

  [1,2,3].forEach(n => {
    const p = document.getElementById(`pill-etapa-${n}`);
    if (p) {
      p.style.display = 'none';
      p.classList.remove('running','finished');
      p.textContent = `00:00 (Etapa ${n})`;
    }
  });

  // 5) Botones de artículo
  document.querySelectorAll('.btn-temporizador-articulo').forEach(btn => {
    btn.classList.remove('running','finished');
    btn.disabled = false;
    btn.style.display = 'none';
    btn.textContent = '⏱ Iniciar';
  });

  // 6) Forzar reevaluación de visibilidad por si el botón global sigue activo
  if (typeof syncTimerButtonsVisibility === 'function') {
    syncTimerButtonsVisibility();
  } else if (window.syncTimerButtonsVisibility) {
    window.syncTimerButtonsVisibility();
  }
}




