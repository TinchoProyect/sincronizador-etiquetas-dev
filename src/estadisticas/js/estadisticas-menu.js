/// /estadisticas/js/estadisticas-menu.js

(function () {
  const KEY_STORAGE = 'estadisticas.lastKey';
  const $menuTiempos = document.getElementById('stats-menu-tiempos');
  const $menuGraficos = document.getElementById('stats-menu-graficos');
  const $sections = Array.from(document.querySelectorAll('[data-section]'));
  
  let currentKey = null; // ⬅️ estado de selección actual (o null si nada visible)





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


// ⬇️ Reutilizable: engancha click + teclado en cualquier menú que le pases
  function attachMenuListeners(menuEl) {
    if (!menuEl) return;

    menuEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.stats-menu__item');
      if (!btn || !menuEl.contains(btn)) return; // asegura que el botón pertenezca a este menú
      const key = btn.dataset.key;
      if (!key) return;
      activate(key);
    });

    menuEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const btn = e.target.closest('.stats-menu__item');
      if (!btn || !menuEl.contains(btn)) return;
      e.preventDefault();
      const key = btn.dataset.key;
      if (!key) return;
      activate(key);
    });
  }

  // Enganchamos ambos menús (si existen en el DOM)
  attachMenuListeners($menuTiempos);
  attachMenuListeners($menuGraficos);
  

 


  // Init: NO activar nada, NO cargar nada (solo ocultar)
  
  document.addEventListener('DOMContentLoaded', () => {
    hideAll();

    // Si querés arrancar mostrando la última elegida automáticamente,
    // descomentá estas 2 líneas:
    // const last = localStorage.getItem(KEY_STORAGE);
    // if (last) activate(last);
  });

})();