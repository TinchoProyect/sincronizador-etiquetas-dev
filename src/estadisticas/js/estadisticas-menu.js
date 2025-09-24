/// /estadisticas/js/estadisticas-menu.js
(function () {
  const KEY_STORAGE = 'estadisticas.lastKey';
  const $menu = document.getElementById('stats-menu');
  const $sections = Array.from(document.querySelectorAll('[data-section]'));

  function hideAll() {
    $sections.forEach(sec => (sec.style.display = 'none'));
  }

  function activate(key) {
    // marcar botón activo
    document.querySelectorAll('.stats-menu__item').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.key === key);
    });

    // mostrar solo la sección elegida
    hideAll();
    const sec = document.querySelector(`[data-section="${key}"]`);
    if (sec) sec.style.display = '';

    // cargar dinámico SOLO al seleccionar
    if (key === 'carros' && typeof window.cargarCarros === 'function') window.cargarCarros();
    if (key === 'ultimos' && typeof window.cargarUltimos === 'function') window.cargarUltimos();
    if (key === 'resumen' && typeof window.cargarResumen === 'function') window.cargarResumen();
    // tiempos: no carga nada por defecto

    localStorage.setItem(KEY_STORAGE, key);
  }

  // Click en menú → activar y cargar
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

  // Init: NO activar nada, NO cargar nada (solo ocultar secciones)
  document.addEventListener('DOMContentLoaded', () => {
    hideAll();

    // Si querés “preseleccionar” visualmente el último sin cargar, descomentá:
    // const last = localStorage.getItem(KEY_STORAGE);
    // if (last) {
    //   document
    //     .querySelector(`.stats-menu__item[data-key="${last}"]`)
    //     ?.classList.add('is-active'); // sin mostrar sección ni llamar loader
    // }
  });
})();
