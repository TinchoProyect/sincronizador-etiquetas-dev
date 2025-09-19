'use strict';

// ========== Helpers DOM ==========
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ========== Helpers formato ==========
const pad = (n) => String(n).padStart(2, '0');

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
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function fmtDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleDateString();
}

// Etapas: busca una etapa por número y devuelve tiempos/duración
function etapaInfo(etapas, num) {
  const e = (etapas || []).find(x => Number(x.etapa_num) === Number(num));
  if (!e) return { durSeg: null, ini: null, fin: null };
  let durSeg = e.duracion_seg ?? null;
  if ((durSeg == null || isNaN(durSeg)) && e.inicio && e.fin) {
    durSeg = Math.max(0, Math.floor((new Date(e.fin) - new Date(e.inicio)) / 1000));
  }
  return { durSeg, ini: e.inicio ?? null, fin: e.fin ?? null };
}

// ========== API base ==========
const API = '/api/estadisticas';

function qsParams(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  });
  return p.toString() ? `?${p.toString()}` : '';
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ========== Filtros ==========
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

// ÚNICA definición de getLimit
const getLimit = (id) => {
  const el = document.getElementById(id);
  const v = el ? Number(el.value) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 10;
};

// ========== Render: Carros ==========
async function loadCarros() {
  const { desde, hasta } = getFilters();
  const limit = getLimit('limit-carros');
  const url = `${API}/carros${qsParams({ desde, hasta, limit })}`;

  const tbody = $('#carros-table tbody');
  tbody.innerHTML = `<tr><td colspan="7">Cargando...</td></tr>`;

  const setText = (sel, value) => {
  const el = document.querySelector(sel);
  if (el) el.textContent = value;
};


  try {
    const { ok, data } = await getJson(url);
    if (!ok) throw new Error('Respuesta no OK');

      if (!data.length) {
          setText('#carros-cant', '0');
          setText('#carros-prom', '–');
          tbody.innerHTML = `<tr><td colspan="7">Sin datos</td></tr>`;
          return;
      }

    const total = data.reduce((acc, r) => acc + (Number(r.duracion_total_seg) || 0), 0);
    const avg = total / data.length;
     setText('#carros-cant', String(data.length));
     setText('#carros-prom', secondsToHMS(avg));

    tbody.innerHTML = data.map(r => {
      const e1 = etapaInfo(r.etapas, 1);
      const e2 = etapaInfo(r.etapas, 2);
      const e3 = etapaInfo(r.etapas, 3);
      const etapasCount = r.etapas_count ?? (Array.isArray(r.etapas) ? r.etapas.length : 0);

      const cellEtapa = (seg) => {
        const txt = seg == null ? '–' : secondsToHMS(seg);
        const cls = seg == null ? 'muted' : 'mono';
        return `<td class="${cls}">${txt}</td>`;
      };

      return `
        <tr>
          <td>${fmtDate(r.fecha_produccion)}</td>
          <td>${r.carro_id}</td>
          <td>${etapasCount}</td>
          ${cellEtapa(e1.durSeg)}
          ${cellEtapa(e2.durSeg)}
          ${cellEtapa(e3.durSeg)}
          <td class="mono">${secondsToHMS(Number(r.duracion_total_seg) || 0)}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('carros error', err);
    tbody.innerHTML = `<tr><td colspan="7">Error al cargar</td></tr>`;
  }
}

// ========== Render: Artículos (últimos) ==========
async function loadArticulosUltimos() {
  const { desde, hasta } = getFilters();
  const limit = getLimit('limit-ultimos');
  const url = `${API}/articulos/ultimos${qsParams({ desde, hasta, limit })}`;

  const tbody = $('#ultimos-table tbody');
  if (!tbody) return;
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

// ========== Render: Artículos (resumen) ==========
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

// ========== Init ==========
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

  ['limit-carros', 'limit-ultimos', 'limit-resumen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (id === 'limit-carros')  loadCarros();
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

document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  refreshAll();
});
