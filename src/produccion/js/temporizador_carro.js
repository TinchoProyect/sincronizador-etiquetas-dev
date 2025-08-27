// /js/temporizador_carro.js  (ES module)
let _inicializado = false;

// ==== Fallback para APIs: prueba /api/tiempos y si no existe, /api/produccion ====
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
        body: data ? JSON.stringify(data) : undefined
      });
      if (res.ok) return res;
      if (res.status === 404) { lastErr = res; continue; } // probá el siguiente base
      const txt = await res.text();
      throw new Error(`${res.status} ${txt}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No se encontró endpoint en ningún base');
}
// ==== fin helper ====


/* ================== TEMPORIZADORES POR ARTÍCULO ================== */
const temporizadores = new Map(); // key => { running, start, interval }

let usuarioId = null;
try {
  const colab = localStorage.getItem('colaboradorActivo');
  usuarioId = colab ? JSON.parse(colab).id : null;
} catch (err) {
  console.error('Error leyendo colaboradorActivo:', err);
}

export function formatearTiempo(ms) {
  const s  = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
function _key(carroId, numero){ return `${carroId}:${numero}`; }

// === Helpers para pintar el tiempo final en el mismo botón ===
function _showElapsedOnButton(btn, elapsedMs, etiqueta = '') {
  if (!btn) return;
  btn.disabled = true;                 // lo dejamos bloqueado
  btn.classList.add('finished');       // por si querés estilizarlo en CSS
  const t = formatearTiempo(elapsedMs);
  btn.textContent = `✅ ${t}${etiqueta ? ` ${etiqueta}` : ''}`;
  btn.title = `Tiempo total${etiqueta ? ` (${etiqueta})` : ''}: ${t}`;
}

// Muestra el tiempo final en el badge (span) de la Etapa 2
function _showElapsedOnBadge(el, elapsedMs, etiqueta = '') {
  if (!el) return;
  const t = formatearTiempo(elapsedMs);
  el.textContent = `✅ ${t}${etiqueta ? ` ${etiqueta}` : ''}`;
  el.classList.add('finished');          // opcional, por si querés estilizar
  el.title = `Tiempo total${etiqueta ? ` (${etiqueta})` : ''}: ${t}`;
}


/* ================== ESTADO LOCAL DE ETAPAS (UI) ================== */
const etapas = new Map(); // carroId -> {1:{running,start,interval}, 2:{...}, 3:{...}}
function _ensure(carroId){
  if (!etapas.has(carroId)) etapas.set(carroId,{1:{},2:{},3:{}});
  return etapas.get(carroId);
}

/* ---------- UI helpers ---------- */
function _tickEtapa1(carroId){
  const st = _ensure(carroId)[1];
  const btn = document.getElementById('btn-etapa1');
  if (!btn || !st.start) return;
  btn.textContent = `⏹️ ${formatearTiempo(Date.now() - st.start)} (Etapa 1)`;
}
function _tickEtapa2(carroId){
  const st = _ensure(carroId)[2];
  const pill = document.getElementById('badge-etapa2');
  if (!pill || !st.start) return;
  pill.textContent = `⏱ ${formatearTiempo(Date.now() - st.start)} (Etapa 2)`;
}
function _tickEtapa3(carroId){
  const st = _ensure(carroId)[3];
  const btn = document.getElementById('btn-etapa3');
  if (!btn || !st.start) return;
  btn.textContent = `⏹️ ${formatearTiempo(Date.now() - st.start)} (Etapa 3)`;
}

/* ---------- Mostrar/ocultar ---------- */
function _showEtapa1(show){
  const b = document.getElementById('btn-etapa1');
  if (b) b.style.display = show ? 'inline-block' : 'none';
}
function _showEtapa2(show){
  const b = document.getElementById('badge-etapa2');
  if (b) b.style.display = show ? 'inline-block' : 'none';
}
export function showEtapa3Button(show){
  const b = document.getElementById('btn-etapa3');
  if (b) b.style.display = show ? 'inline-block' : 'none';
}

/* ================== HTTP helper (query ?usuarioId=) ================== */
async function _postEtapa(urlBase, uid){
  const res = await fetch(`${urlBase}?usuarioId=${encodeURIComponent(uid)}`, { method:'POST' });
  if (!res.ok) throw new Error(`[${res.status}] ${await res.text()}`);
  try { return await res.json(); } catch { return {}; }
}

/* ================== API ETAPAS ================== */
export async function startEtapa1(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/1/iniciar`, uid);
  const s = _ensure(carroId)[1];
  s.running = true; s.start = Date.now();
  clearInterval(s.interval);
  s.interval = setInterval(()=>_tickEtapa1(carroId), 1000);
  _tickEtapa1(carroId);
  _showEtapa1(true);
  const btn = document.getElementById('btn-etapa1');
  if (btn) { btn.classList.add('running'); btn.classList.remove('finished'); }
}
export async function stopEtapa1(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/1/finalizar`, uid);
 const s = _ensure(carroId)[1];
  const elapsedMs = s.start ? (Date.now() - s.start) : 0;

  s.running = false;
  clearInterval(s.interval);

  const btn = document.getElementById('btn-etapa1');
  // Mostrar el tiempo final en el botón (y dejarlo deshabilitado)
  if (btn) _showElapsedOnButton(btn, elapsedMs, '(Etapa 1)');
  if (btn) { btn.classList.remove('running'); btn.classList.add('finished'); }
}

export async function startEtapa2(carroId, uid){
  console.log('[MEDICION] startEtapa2', carroId, uid);
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/2/iniciar`, uid);


  const s = _ensure(carroId)[2];
  s.running = true; s.start = Date.now();
  clearInterval(s.interval);
  s.interval = setInterval(()=>_tickEtapa2(carroId), 1000);

  const pill = document.getElementById('badge-etapa2');
  if (pill){
    pill.style.display = 'inline-block';
    pill.classList.add('etapa-pill');
    pill.classList.remove('finished');
    pill.classList.add('running');
  }
  _tickEtapa2(carroId);
  }
export async function stopEtapa2(carroId, uid){
   console.log('[MEDICION] stopEtapa2', carroId, uid);
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/2/finalizar`, uid);

  const s = _ensure(carroId)[2];
  const elapsedMs = s.start ? (Date.now() - s.start) : 0;

  s.running = false;
  clearInterval(s.interval);

  const pill = document.getElementById('badge-etapa2');
  if (pill){
    const elapsed = s.start ? (Date.now() - s.start) : 0;
    pill.textContent = `✅ ${formatearTiempo(elapsed)} (Etapa 2)`;
    pill.style.display = 'inline-block';
    pill.classList.add('etapa-pill');
    pill.classList.remove('running');
    pill.classList.add('finished');   // 🔸 ahora queda opaca al detenerse
  }
}

export async function startEtapa3(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/3/iniciar`, uid);
  const s = _ensure(carroId)[3];
  s.running = true; s.start = Date.now();
  clearInterval(s.interval);
  s.interval = setInterval(()=>_tickEtapa3(carroId), 1000);
  _tickEtapa3(carroId);
  showEtapa3Button(true);
  const btn = document.getElementById('btn-etapa3');
  if (btn) { btn.classList.add('running'); btn.classList.remove('finished'); }
}
export async function stopEtapa3(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/3/finalizar`, uid);
  const s = _ensure(carroId)[3];
  const elapsedMs = s.start ? (Date.now() - s.start) : 0;

  s.running = false;
  clearInterval(s.interval);

  const btn = document.getElementById('btn-etapa3');
  // Mostrar el tiempo final en el botón (y dejarlo deshabilitado)
  if (btn) _showElapsedOnButton(btn, elapsedMs, '(Etapa 3)');
  if (btn) { btn.classList.remove('running'); btn.classList.add('finished'); 
  }
}

// Oculta **todos** los temporizadores de una: artículos + E1 + E2 + E3
function _hideAllTimers() {
  // botones por artículo
  document.querySelectorAll('.btn-temporizador-articulo')
    .forEach(b => b.style.display = 'none');

  // etapas
  _showEtapa1(false);
  _showEtapa2(false);
  showEtapa3Button(false);
}

/* ================== INICIALIZACIÓN Y LISTENERS ================== */
export function initTemporizadores() {
  if (_inicializado) return;
  _inicializado = true;

// Botón global "Modo medición"
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'btn-temporizador-global') {
    const botonGlobal = e.target;
    const activo = botonGlobal.classList.toggle('activo');
    botonGlobal.textContent = activo ? '🛑 Salir de medición' : '⏱ Modo medición';

    if (activo) {
      // Mostrar controles de artículo
      document.querySelectorAll('.btn-temporizador-articulo')
        .forEach(b => b.style.display = 'inline-block');

      // Etapa 1 solo si hay carro activo
      const carroId = localStorage.getItem('carroActivo');
      _showEtapa1(!!carroId);

      // E2/E3 se muestran cuando empiecen (startEtapa2/startEtapa3), aquí no hacemos nada
    } else {
      // 👉 Al salir del modo: ocultamos TODO
      _hideAllTimers();
    }
  }
});

  

  // Temporizador por artículo
  document.addEventListener('click', async (e) => {
    if (!e.target.classList.contains('btn-temporizador-articulo')) return;

    const btn = e.target;
    const numero  = btn.dataset.numero;
    const carroId = window.carroIdGlobal;
    if (!carroId || !numero) return;

    const k = _key(carroId, numero);
    let t = temporizadores.get(k);

    // Iniciar
    if (!t || !t.running) {
      t = { running: true, start: Date.now(), interval: null };
      temporizadores.set(k, t);

      const actualizar = () => {
        const ms = Date.now() - t.start;
        btn.textContent = `⏹ ${formatearTiempo(ms)} ×`;
      };
      actualizar();
      t.interval = setInterval(actualizar, 1000);
      btn.classList.add('running');

     // 🔗 Backend: INICIO (con fallback de base URL)
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

      btn.textContent = `✅ ${formatearTiempo(elapsed)}`;
      btn.classList.remove('running');
      btn.classList.add('finished');
      btn.disabled = true;

      // 🔗 Backend: FIN (con elapsedMs y fallback de base URL)
      try {
        await _postFirstAvailable(
          `/carro/${carroId}/articulo/${encodeURIComponent(numero)}/finalizar`,
          { usuarioId },
          { elapsedMs: elapsed } // podés pasar null si no querés enviar el elapsed
        );
      } catch (err) {
        console.error('No se pudo registrar fin de artículo:', err);
      }
    }
  });

  // Toggle Etapa 1
  document.addEventListener('click', async (e)=>{
    if (e.target && e.target.id === 'btn-etapa1') {
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
    }
  });

  // Toggle Etapa 3 (pausa/reanudar)
  document.addEventListener('click', async (e)=>{
    if (e.target && e.target.id === 'btn-etapa3') {
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
    }
  });
}

/* ================== VISIBILIDAD TRAS RENDER ================== */
export function syncTimerButtonsVisibility() {
  const botonGlobal = document.getElementById('btn-temporizador-global');
  const activo = botonGlobal && botonGlobal.classList.contains('activo');

  // ⏱ por artículo
  /*document.querySelectorAll('.btn-temporizador-articulo')
    .forEach(b => b.style.display = activo ? 'inline-block' : 'none');*/

  // Etapa 1 sólo si hay carro y está el modo activo
/* const carroId = localStorage.getItem('carroActivo');
  _showEtapa1(!!(activo && carroId));*/
  
  
  // Etapa 2: visible solo si está corriendo o si quedó finalizada
  if (!activo) {
    _hideAllTimers();       // 👉 si no está activo, ocultar todo siempre
    return;
  }

  // Si está activo:
  document.querySelectorAll('.btn-temporizador-articulo')
    .forEach(b => b.style.display = 'inline-block');

  const carroId = localStorage.getItem('carroActivo');
  _showEtapa1(!!carroId);

  // E2/E3 las muestran sus start/stop correspondientes
{
  const carroId = localStorage.getItem('carroActivo');
  const s2 = carroId ? _ensure(carroId)[2] : null;
  const badge = document.getElementById('badge-etapa2');

  if (badge) {
    const running  = !!(s2 && s2.running);
    const finished = badge.classList.contains('finished'); // set en stopEtapa2
    const show = running || finished;

    _showEtapa2(show);

    // Si no debe mostrarse, limpiamos texto para evitar "Etapa 2: 00:00"
    if (!show) {
      badge.textContent = '';
      // NO quitamos 'finished' aquí para que si terminó siga visible tras re-render.
      // (se limpia al volver a iniciar en startEtapa2)
    }
  }
}

  // Etapa 3 se oculta si no está corriendo
  showEtapa3Button(false);

  
}
