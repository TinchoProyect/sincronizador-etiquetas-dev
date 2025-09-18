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
