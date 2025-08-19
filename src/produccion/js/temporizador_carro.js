// /js/temporizador_carro.js  (ES module)
let _inicializado = false;

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
  const badge = document.getElementById('badge-etapa2');
  if (!badge || !st.start) return;
  badge.textContent = `Etapa 2: ${formatearTiempo(Date.now() - st.start)}`;
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
}
export async function stopEtapa1(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/1/finalizar`, uid);
  const s = _ensure(carroId)[1];
  s.running = false;
  clearInterval(s.interval);
  const btn = document.getElementById('btn-etapa1');
  if (btn) btn.textContent = '▶️ Iniciar etapa 1';
}

export async function startEtapa2(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/2/iniciar`, uid);
  const s = _ensure(carroId)[2];
  s.running = true; s.start = Date.now();
  clearInterval(s.interval);
  s.interval = setInterval(()=>_tickEtapa2(carroId), 1000);
  _tickEtapa2(carroId);
  _showEtapa2(true);
}
export async function stopEtapa2(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/2/finalizar`, uid);
  const s = _ensure(carroId)[2];
  s.running = false;
  clearInterval(s.interval);
  _showEtapa2(false);
}

export async function startEtapa3(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/3/iniciar`, uid);
  const s = _ensure(carroId)[3];
  s.running = true; s.start = Date.now();
  clearInterval(s.interval);
  s.interval = setInterval(()=>_tickEtapa3(carroId), 1000);
  _tickEtapa3(carroId);
  showEtapa3Button(true);
}
export async function stopEtapa3(carroId, uid){
  await _postEtapa(`http://localhost:3002/api/tiempos/carro/${carroId}/etapa/3/finalizar`, uid);
  const s = _ensure(carroId)[3];
  s.running = false;
  clearInterval(s.interval);
  const btn = document.getElementById('btn-etapa3');
  if (btn) btn.textContent = '▶️ Reanudar etapa 3';
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

      // Mostrar/ocultar ⏱ por artículo
      document.querySelectorAll('.btn-temporizador-articulo')
        .forEach(b => b.style.display = activo ? 'inline-block' : 'none');

      // Etapa 1 sólo en modo medición
      const carroId = localStorage.getItem('carroActivo');
      _showEtapa1(!!(activo && carroId));
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

      try {
        await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo/${encodeURIComponent(numero)}/iniciar?usuarioId=${usuarioId}`, {
          method: 'POST'
        });
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

      try {
        await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo/${encodeURIComponent(numero)}/finalizar?usuarioId=${usuarioId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ elapsedMs: elapsed })
        });
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
  document.querySelectorAll('.btn-temporizador-articulo')
    .forEach(b => b.style.display = activo ? 'inline-block' : 'none');

  // Etapa 1 sólo si hay carro y está el modo activo
  const carroId = localStorage.getItem('carroActivo');
  _showEtapa1(!!(activo && carroId));

  // Etapa 2 badge si venía corriendo (en esta versión se pierde al refrescar)
  _showEtapa2(false);

  // Etapa 3 se oculta si no está corriendo
  showEtapa3Button(false);
}
