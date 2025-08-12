// /js/temporizador_carro.js  (ES module)
let _inicializado = false;

// Estado en memoria: un cronómetro por (carroId:articulo)
const temporizadores = new Map(); // key => { running, start, interval }


let usuarioId = null;
        try {
              const colab = localStorage.getItem('colaboradorActivo');
              usuarioId = colab ? JSON.parse(colab).id : null;
        } catch (err) {
             console.error('Error leyendo colaboradorActivo:', err);
        }

if (!usuarioId) {
  console.error('❌ usuarioId no encontrado. No se registrarán tiempos en backend.');
}

function key(carroId, numero) {
  return `${carroId}:${numero}`;
}

export function formatearTiempo(ms) {
  const s = Math.floor(ms / 1000);
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

/**
 * Idempotente: lo podés llamar varias veces; solo se engancha una vez.
 * - Maneja el botón global (#btn-temporizador-global) por delegación
 * - Maneja cada botón ⏱ (.btn-temporizador-articulo) por delegación
 */
export function initTemporizadores() {
  if (_inicializado) return;
  _inicializado = true;

  // Click en botón global (delegación)
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'btn-temporizador-global') {
      const botonGlobal = e.target;
      const estaActivo = botonGlobal.classList.toggle('activo');
      botonGlobal.textContent = estaActivo ? '🛑 Salir de medición' : '⏱ Modo medición';

      // Mostrar/ocultar los ⏱ por artículo
      document.querySelectorAll('.btn-temporizador-articulo')
        .forEach(b => b.style.display = estaActivo ? 'inline-block' : 'none');
    }
  });

  // Click en cada botón ⏱ (delegación)
  document.addEventListener('click', async (e) => {
    if (!e.target.classList.contains('btn-temporizador-articulo')) return;

    const btn = e.target;
    const numero = btn.dataset.numero;               // ⚠️ usar data-numero en el HTML
    const carroId = window.carroIdGlobal;            // ya lo usás en tu app
    if (!carroId || !numero) return;

    const k = key(carroId, numero);
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

      // 🔗 Backend: INICIO
            try {
                await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo/${encodeURIComponent(numero)}/iniciar?usuarioId=${usuarioId}`, {
                 method: 'POST'
            });
             } catch (err) {
                console.error('No se pudo registrar inicio:', err);
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

    // 🔗 Backend: FIN (con elapsedMs)
        try {
            await fetch(`http://localhost:3002/api/produccion/carro/${carroId}/articulo/${encodeURIComponent(numero)}/finalizar?usuarioId=${usuarioId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ elapsedMs: elapsed })
                });
            } catch (err) {
            console.error('No se pudo registrar fin:', err);
        }
    }
  });
}

/**
 * Llamalo SIEMPRE después de re-renderizar los artículos.
 * Muestra/oculta los ⏱ por artículo según el estado del botón global.
 */
export function syncTimerButtonsVisibility() {
  const botonGlobal = document.getElementById('btn-temporizador-global');
  if (!botonGlobal) return;
  const activo = botonGlobal.classList.contains('activo');
  document.querySelectorAll('.btn-temporizador-articulo')
    .forEach(b => b.style.display = activo ? 'inline-block' : 'none');
}
