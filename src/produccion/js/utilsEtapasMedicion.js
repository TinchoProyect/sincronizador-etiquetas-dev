// ✅ utilsEtapasMedicion.js  ── NUEVO
// Persistimos la etapa por carro en localStorage y lanzamos un evento para el UI.
export function setEtapaCarro(carroId, etapa) {
  const k = `carro:${carroId}:etapa`;
  localStorage.setItem(k, String(etapa));
  window.dispatchEvent(new CustomEvent('carro:etapa-cambio', { detail: { carroId, etapa } }));
}

export function getEtapaCarro(carroId) {
  const k = `carro:${carroId}:etapa`;
  const v = Number(localStorage.getItem(k));
  return Number.isFinite(v) && (v === 1 || v === 2) ? v : 1; // default Etapa 1
}


export const esEtapa1 = (carroId) => getEtapaCarro(carroId) === 1;
export const esEtapa2 = (carroId) => getEtapaCarro(carroId) === 2;
