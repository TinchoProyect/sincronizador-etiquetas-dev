/// /estadisticas/js/estadisticas-menu.js

(function () {
  const KEY_STORAGE = 'estadisticas.lastKey';
  const $menu = document.getElementById('stats-menu');
  const $sections = Array.from(document.querySelectorAll('[data-section]'));
  
  //graficos de barras
  const graficosBtn = document.querySelector('#stats-menu .stats-menu__item[data-key="graficos"]');
  const graficosCard = document.getElementById('graficos-card');
  const graficosContent = document.getElementById('graficos-content');
  //fin graficos de barras constantes

  let currentKey = null; // ⬅️ estado de selección actual (o null si nada visible)

  //codigo graficos de barras
  if (!graficosBtn || !graficosCard || !graficosContent) {
    console.warn('[graficos] no se encontraron nodos necesarios');
    return;
  }

  let visible = false;        // estado de visibilidad
  let loaded  = false;        // si ya cargamos el contenido al menos una vez

  function renderGraficos() {
    // si querés regenerar cada vez, no uses el flag `loaded`
    const html = `
      <div class="card__header">
        <h3 class="card__title">Gráficos de barra piripipito</h3>
        <div class="badges">
          <label class="control">
            <span>Mostrar</span>
          </label>
        </div>
      </div>
      <!-- acá podrías agregar tus selects/filtros y el canvas -->
      <div id="grafico-barras-wrapper">
        <!-- contenido dinámico -->
        <p class="muted">Acá va el gráfico…</p>
      </div>
    `;
    graficosContent.innerHTML = html;

    // si tenés un loader de datos para el gráfico, llamalo acá:
    // await cargarSerieDeBarras();  // por ejemplo
  }

  graficosBtn.addEventListener('click', async () => {
    visible = !visible;

    // visual del botón activo
    graficosBtn.classList.toggle('is-active', visible);

    // mostrar / ocultar la tarjeta
    graficosCard.style.display = visible ? '' : 'none';

    // cargar UNA vez cuando se muestra por primera vez
    if (visible && !loaded) {
      try {
        renderGraficos();
        loaded = true;
      } catch (e) {
        console.error('[graficos] error al renderizar', e);
        graficosContent.innerHTML = `<p style="color:#b91c1c">Error al cargar gráficos</p>`;
      }
    }
  });
  //fin codigo graficos de barras

  function hideAll() {
    $sections.forEach(sec => (sec.style.display = 'none'));
    document.querySelectorAll('.stats-menu__item').forEach(btn => btn.classList.remove('is-active'));
  }

  function callLoaderFor(key) {
    if (key === 'carros'  && typeof window.loadCarros === 'function') return window.loadCarros();
    if (key === 'ultimos' && typeof window.loadArticulosUltimos === 'function') return window.loadArticulosUltimos();
    if (key === 'resumen' && typeof window.loadArticulosResumen === 'function') return window.loadArticulosResumen();
    if (key === 'graficos' && typeof window.loadGraficos === 'function') return window.loadGraficos();
    // tiempos no carga por defecto
  }

  function activate(key) {
    // TOGGLE: si vuelvo a clicar el mismo, oculto todo y deselecciono
    if (currentKey === key) {
      hideAll();
      currentKey = null;
      localStorage.removeItem(KEY_STORAGE);
      return;
    }

    // Mostrar sólo la sección elegida
    hideAll();
    const sec = document.querySelector(`[data-section="${key}"]`);
    const btn = document.querySelector(`.stats-menu__item[data-key="${key}"]`);
    if (sec) sec.style.display = '';
    if (btn) btn.classList.add('is-active');

    currentKey = key;
    localStorage.setItem(KEY_STORAGE, key);

    // Cargar dinámico SOLO al seleccionar
    callLoaderFor(key);
  }

  // Click en menú → activar (o toggle off)
  $menu?.addEventListener('click', e => {
    const btn = e.target.closest('.stats-menu__item');
    if (!btn) return;
    activate(btn.dataset.key);
  });

  // Accesible con teclado (Enter/Espacio)
  $menu?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const btn = e.target.closest('.stats-menu__item');
      if (btn) {
        e.preventDefault();
        activate(btn.dataset.key);
      }
    }
  });

  //Eventos de filtros y selects para que cargue solo la vista visible

  function wireEvents() {
  $('#filtros')?.addEventListener('submit', (e) => {
    e.preventDefault();
    reloadVisible();
  });

  $('#btn-hoy')?.addEventListener('click', () => {
    setToday();
    reloadVisible();
  });

  $('#btn-limpiar')?.addEventListener('click', () => {
    $('#f-desde').value = '';
    $('#f-hasta').value = '';
    reloadVisible();
  });

  ['limit-carros', 'limit-ultimos', 'limit-resumen'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      reloadVisible();
    });
  });
}


  // Init: NO activar nada, NO cargar nada (solo ocultar)
  
  document.addEventListener('DOMContentLoaded', () => {
    hideAll();

    // Si querés arrancar mostrando la última elegida automáticamente,
    // descomentá estas 2 líneas:
    // const last = localStorage.getItem(KEY_STORAGE);
    // if (last) activate(last);
  });
})();


