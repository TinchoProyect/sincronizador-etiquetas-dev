const getLimit = (id) => parseInt(document.getElementById(id)?.value || '10', 10);


async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function cargarArtUltimos() {
  const { data } = await fetchJSON('/api/estadisticas/articulos/ultimos?limit=15');
  // TODO: render tabla “Últimos medidos”
}

async function cargarArtResumen() {
  const params = new URLSearchParams({ limit: 15 /*, desde, hasta */ });
  const { data } = await fetchJSON('/api/estadisticas/articulos/resumen?' + params.toString());
  // TODO: render tarjetas o tabla con seg_por_ud, tiempo_total_seg, ultima_medicion, etc.
}

document.addEventListener('DOMContentLoaded', () => {
  cargarArtUltimos();
  cargarArtResumen();
});

//nuevo
// src/estadisticas/js/main.js

// ---------- helpers DOM ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------- helpers formato ----------
function pad(n) { return String(n).padStart(2, '0'); }

function secondsToHMS(s = 0) {
  const sign = s < 0 ? '-' : '';
  s = Math.abs(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${sign}${h}:${pad(m)}:${pad(sec)}` : `${sign}${m}:${pad(sec)}`;
}

function fmtDateTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  // Mostrar local (fecha + hora corta)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function fmtDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleDateString();
}

// ---------- API base ----------
const API = '/api/estadisticas';

// Construye query string solo con params no vacíos
function qsParams(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  });
  return p.toString() ? `?${p.toString()}` : '';
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- Filtros ----------
function getFilters() {
  const desde = $('#f-desde')?.value || '';
  const hasta = $('#f-hasta')?.value || '';
  return { desde, hasta };
}

function setToday() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = pad(today.getMonth() + 1);
  const dd = pad(today.getDate());
  $('#f-desde').value = `${yyyy}-${mm}-${dd}`;
  $('#f-hasta').value = `${yyyy}-${mm}-${dd}`;
}

// ---------- Render: Carros ----------
async function loadCarros() {
  const { desde, hasta } = getFilters();
  const limit = getLimit('limit-carros');
  const url = `${API}/carros${qsParams({ desde, hasta, limit })}`;

  const card = $('#carros-card');
  const tbody = $('#carros-table tbody');
  tbody.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;

  try {
    const { ok, data } = await getJson(url);
    if (!ok) throw new Error('Respuesta no OK');

    if (!data.length) {
      $('#carros-cant').textContent = '0';
      $('#carros-prom').textContent = '–';
      tbody.innerHTML = `<tr><td colspan="5">Sin datos</td></tr>`;
      return;
    }

    // promedio duración
    const total = data.reduce((acc, r) => acc + (Number(r.duracion_total_seg) || 0), 0);
    const avg = total / data.length;

    $('#carros-cant').textContent = data.length;
    $('#carros-prom').textContent = secondsToHMS(avg);

    // filas
    tbody.innerHTML = data.map(r => {
      const etapasCount = r.etapas_count ?? (Array.isArray(r.etapas) ? r.etapas.length : 0);
      return `
        <tr>
          <td>${fmtDate(r.fecha_produccion)}</td>
          <td>${r.carro_id}</td>
          <td>${r.tipo_carro ?? '–'}</td>
          <td>${etapasCount}</td>
          <td>${secondsToHMS(Number(r.duracion_total_seg) || 0)}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('carros error', err);
    tbody.innerHTML = `<tr><td colspan="5">Error al cargar</td></tr>`;
  }
}

// ---------- Render: Artículos (últimos) ----------
async function loadArticulosUltimos() {
  const { desde, hasta } = getFilters();
  const limit = getLimit('limit-ultimos');
  const url = `${API}/articulos/ultimos${qsParams({ desde, hasta, limit })}`;

  const tbody = $('#ultimos-table tbody');
  if (!tbody) return; // por si la sección está comentada
  tbody.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;

  try {
    const { ok, data } = await getJson(url);
    if (!ok) throw new Error('Respuesta no OK');

    $('#ultimos-cant').textContent = data.length;

    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="5">Sin datos</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${fmtDateTime(r.timestamp_medicion)}</td>
        <td>${r.carro_id}</td>
        <td>${r.articulo} <small class="muted">(${r.articulo_numero})</small></td>
        <td>${r.cantidad}</td>
        <td>${secondsToHMS(r.duracion_seg)}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('ultimos error', err);
    tbody.innerHTML = `<tr><td colspan="5">Error al cargar</td></tr>`;
  }
}

// ---------- Render: Artículos (resumen) ----------
async function loadArticulosResumen() {
   const { desde, hasta } = getFilters();
  const limit = getLimit('limit-resumen');
  const url = `${API}/articulos/resumen${qsParams({ desde, hasta, limit })}`;

  const tbody = $('#resumen-table tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;

  try {
    const { ok, data } = await getJson(url);
    if (!ok) throw new Error('Respuesta no OK');

    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="5">Sin datos</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${r.articulo} <small class="muted">(${r.articulo_numero})</small></td>
        <td>${r.cantidad_total}</td>
        <td>${secondsToHMS(r.seg_por_ud)}</td>
        <td>${secondsToHMS(r.tiempo_total_seg)}</td>
        <td>${fmtDateTime(r.ultima_medicion)}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('resumen error', err);
    tbody.innerHTML = `<tr><td colspan="5">Error al cargar</td></tr>`;
  }
}

// ---------- Init ----------
function wireEvents() {
  $('#filtros')?.addEventListener('submit', (e) => {
    e.preventDefault();
    refreshAll();
  });

  $('#btn-hoy')?.addEventListener('click', () => {
    setToday();
    refreshAll();
  });

  $('#btn-limpiar')?.addEventListener('click', () => {
    $('#f-desde').value = '';
    $('#f-hasta').value = '';
    refreshAll();
  });
  ['limit-carros','limit-ultimos','limit-resumen'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => {
    // recargamos solo la sección afectada
    if (id === 'limit-carros') loadCarros();
    if (id === 'limit-ultimos') loadArticulosUltimos();
    if (id === 'limit-resumen') loadArticulosResumen();
  });
});

}

async function refreshAll() {
  await Promise.all([
    loadCarros(),
    loadArticulosUltimos(),
    loadArticulosResumen(),
  ]);
}

document.addEventListener('DOMContentLoaded', async () => {
  wireEvents();
  // opcional: setToday(); // si querés iniciar la vista en "hoy"
  refreshAll();
});
