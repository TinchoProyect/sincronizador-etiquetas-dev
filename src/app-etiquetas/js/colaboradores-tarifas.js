const API_BASE = '/api';
let selectedColaboradorId = null;
let currentTab = 'horas'; // 'horas' o 'rendimiento'
let articulosCargados = [];
let articulosActivosOperario = []; // Artículos con tarifa activa para el operario seleccionado

// Formateador de moneda argentina
const currencyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

// Formateador de fecha y hora local
function formatFecha(fechaStr) {
  if (!fechaStr) return '-';
  const date = new Date(fechaStr);
  if (isNaN(date.getTime())) return fechaStr;
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  const hr = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${d}/${m}/${y} ${hr}:${min} hs`;
}

document.addEventListener('DOMContentLoaded', () => {
  cargarColaboradoresTarifas();
  configurarFormulario();
  configurarTabs();
  cargarArticulosSelector();
});

/**
 * Configura los botones de selección de Pestaña
 */
function configurarTabs() {
  const btnHoras = document.getElementById('tab-btn-horas');
  const btnRendimiento = document.getElementById('tab-btn-rendimiento');
  const tabHoras = document.getElementById('container-tab-horas');
  const tabRendimiento = document.getElementById('container-tab-rendimiento');

  btnHoras.addEventListener('click', () => {
    currentTab = 'horas';
    btnHoras.classList.add('active');
    btnRendimiento.classList.remove('active');
    tabHoras.style.display = 'block';
    tabRendimiento.style.display = 'none';
    
    // Cambiar visualización del historial
    document.getElementById('tabla-historial').style.display = selectedColaboradorId ? 'table' : 'none';
    document.getElementById('tabla-historial-rendimiento').style.display = 'none';
    
    if (selectedColaboradorId) {
      cargarHistorialTarifas(selectedColaboradorId);
    }
  });

  btnRendimiento.addEventListener('click', () => {
    currentTab = 'rendimiento';
    btnRendimiento.classList.add('active');
    btnHoras.classList.remove('active');
    tabRendimiento.style.display = 'block';
    tabHoras.style.display = 'none';
    
    // Cambiar visualización del historial
    document.getElementById('tabla-historial').style.display = 'none';
    document.getElementById('tabla-historial-rendimiento').style.display = selectedColaboradorId ? 'table' : 'none';
    
    if (selectedColaboradorId) {
      cargarHistorialRendimiento(selectedColaboradorId);
    }
  });
}

/**
 * Carga la lista de artículos y activa el buscador interactivo
 */
async function cargarArticulosSelector() {
  try {
    const res = await fetch(`${API_BASE}/usuarios/articulos/produccion`);
    if (res.ok) {
      articulosCargados = await res.json();
      configurarBuscadorArticulos();
    }
  } catch (err) {
    console.error('Error al cargar artículos para selector:', err);
  }
}

/**
 * Configura los eventos del input predictivo de artículos
 */
function configurarBuscadorArticulos() {
  const buscador = document.getElementById('articulo-buscador');
  const hiddenInput = document.getElementById('tarifa-rendimiento-articulo');
  const clearBtn = document.getElementById('btn-clear-articulo');
  const resultadosDiv = document.getElementById('dropdown-resultados');

  function filtrarResultados(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      resultadosDiv.style.display = 'none';
      clearBtn.style.display = 'none';
      return;
    }

    clearBtn.style.display = 'block';

    const filtrados = articulosCargados.filter(art => 
      art.numero.toLowerCase().includes(q) || 
      art.nombre.toLowerCase().includes(q)
    );

    resultadosDiv.innerHTML = '';

    if (filtrados.length === 0) {
      resultadosDiv.innerHTML = '<div class="dropdown-no-results">No se encontraron artículos.</div>';
      resultadosDiv.style.display = 'block';
      return;
    }

    filtrados.forEach(art => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      
      const yaActivo = articulosActivosOperario.includes(art.numero);
      if (yaActivo) {
        item.style.opacity = '0.55';
        item.style.cursor = 'not-allowed';
        item.style.pointerEvents = 'none';
        item.innerHTML = `
          <strong>${art.numero} <span style="color:#d97706; font-size:0.85em; font-weight:normal; margin-left:8px;">(Ya activo)</span></strong>
          <span>${art.nombre}</span>
        `;
      } else {
        item.innerHTML = `
          <strong>${art.numero}</strong>
          <span>${art.nombre}</span>
        `;
        item.addEventListener('click', () => {
          buscador.value = `${art.numero} - ${art.nombre}`;
          hiddenInput.value = art.numero;
          resultadosDiv.style.display = 'none';
        });
      }
      resultadosDiv.appendChild(item);
    });

    resultadosDiv.style.display = 'block';
  }

  buscador.addEventListener('input', (e) => {
    hiddenInput.value = ''; // Resetear hasta que elijan uno
    filtrarResultados(e.target.value);
  });

  buscador.addEventListener('focus', () => {
    if (buscador.value && !hiddenInput.value) {
      filtrarResultados(buscador.value);
    } else if (!hiddenInput.value) {
      // Mostrar primeros 15 por defecto
      renderTodosLosArticulos();
    }
  });

  function renderTodosLosArticulos() {
    resultadosDiv.innerHTML = '';
    const primeros = articulosCargados.slice(0, 15);
    primeros.forEach(art => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      
      const yaActivo = articulosActivosOperario.includes(art.numero);
      if (yaActivo) {
        item.style.opacity = '0.55';
        item.style.cursor = 'not-allowed';
        item.style.pointerEvents = 'none';
        item.innerHTML = `
          <strong>${art.numero} <span style="color:#d97706; font-size:0.85em; font-weight:normal; margin-left:8px;">(Ya activo)</span></strong>
          <span>${art.nombre}</span>
        `;
      } else {
        item.innerHTML = `
          <strong>${art.numero}</strong>
          <span>${art.nombre}</span>
        `;
        item.addEventListener('click', () => {
          buscador.value = `${art.numero} - ${art.nombre}`;
          hiddenInput.value = art.numero;
          resultadosDiv.style.display = 'none';
          clearBtn.style.display = 'block';
        });
      }
      resultadosDiv.appendChild(item);
    });
    resultadosDiv.style.display = 'block';
  }

  clearBtn.addEventListener('click', () => {
    buscador.value = '';
    hiddenInput.value = '';
    resultadosDiv.style.display = 'none';
    clearBtn.style.display = 'none';
  });

  // Cerrar dropdown al hacer click fuera
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchable-dropdown-container')) {
      resultadosDiv.style.display = 'none';
      // Limpiar input si no seleccionó un SKU válido
      if (!hiddenInput.value) {
        buscador.value = '';
        clearBtn.style.display = 'none';
      }
    }
  });
}

/**
 * Carga todos los colaboradores activos y sus tarifas vigentes desde la API
 */
async function cargarColaboradoresTarifas() {
  const tbody = document.getElementById('tbody-colaboradores');
  try {
    const res = await fetch(`${API_BASE}/usuarios/tarifas`);
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}`);
    }
    const colaboradores = await res.json();
    tbody.innerHTML = '';

    if (colaboradores.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No se encontraron colaboradores activos.</td></tr>';
      return;
    }

    colaboradores.forEach(c => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.dataset.id = c.usuario_id;
      
      const tarifaVigente = c.valor_hora !== null 
        ? `<strong style="color: #047857;">${currencyFormatter.format(parseFloat(c.valor_hora))}</strong>` 
        : '<span style="color: #94a3b8; font-style: italic;">Sin asignar</span>';
        
      const fechaVigencia = c.fecha_desde 
        ? formatFecha(c.fecha_desde) 
        : '-';

      tr.innerHTML = `
        <td><strong>${c.nombre_completo}</strong></td>
        <td><code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${c.usuario}</code></td>
        <td style="text-align: right;">${tarifaVigente}</td>
        <td>${fechaVigencia}</td>
      `;

      // Evento al hacer click en la fila del colaborador
      tr.addEventListener('click', () => seleccionarColaborador(c, tr));

      tbody.appendChild(tr);

      // Si este colaborador estaba previamente seleccionado, volver a marcarlo
      if (selectedColaboradorId === c.usuario_id) {
        tr.classList.add('selected');
      }
    });
  } catch (error) {
    console.error('Error al cargar colaboradores:', error);
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="empty-state" style="color: #ef4444;">
          <i class="fa-solid fa-triangle-exclamation"></i> Error al cargar datos del servidor.
        </td>
      </tr>
    `;
  }
}

/**
 * Selecciona un colaborador y carga sus detalles de edición e historial
 */
async function seleccionarColaborador(colaborador, trElement) {
  const filas = document.querySelectorAll('#tbody-colaboradores tr');
  filas.forEach(f => f.classList.remove('selected'));

  trElement.classList.add('selected');
  selectedColaboradorId = colaborador.usuario_id;

  document.getElementById('no-seleccionado-msg').style.display = 'none';
  document.getElementById('gestion-tarifa-container').style.display = 'block';

  document.getElementById('colaborador-id').value = colaborador.usuario_id;
  document.getElementById('colaborador-nombre').textContent = colaborador.nombre_completo;
  document.getElementById('colaborador-usuario').innerHTML = `<i class="fa-solid fa-user"></i> Usuario: <code>${colaborador.usuario}</code>`;

  // Rellenar input de tarifa hora
  const inputTarifa = document.getElementById('tarifa-valor');
  inputTarifa.value = colaborador.valor_hora !== null ? parseFloat(colaborador.valor_hora) : '';

  // Limpiar buscador de artículos
  const buscador = document.getElementById('articulo-buscador');
  const hiddenInput = document.getElementById('tarifa-rendimiento-articulo');
  const clearBtn = document.getElementById('btn-clear-articulo');
  if (buscador) buscador.value = '';
  if (hiddenInput) hiddenInput.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  
  document.getElementById('tarifa-rendimiento-valor').value = '';
  document.getElementById('tarifa-rendimiento-unidad').value = 'kg';

  // Gatillar carga de historial según pestaña activa
  if (currentTab === 'horas') {
    document.getElementById('tabla-historial').style.display = 'table';
    document.getElementById('tabla-historial-rendimiento').style.display = 'none';
    await cargarHistorialTarifas(colaborador.usuario_id);
  } else {
    document.getElementById('tabla-historial').style.display = 'none';
    document.getElementById('tabla-historial-rendimiento').style.display = 'table';
    await cargarHistorialRendimiento(colaborador.usuario_id);
  }
}

/**
 * Carga el historial de tarifas por hora
 */
async function cargarHistorialTarifas(usuarioId) {
  const tableHistorial = document.getElementById('tabla-historial');
  const tbodyHistorial = document.getElementById('tbody-historial');
  const emptyMsg = document.getElementById('historial-empty-msg');

  try {
    const res = await fetch(`${API_BASE}/usuarios/${usuarioId}/tarifas/historial`);
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    
    const historial = await res.json();
    tbodyHistorial.innerHTML = '';

    if (historial.length === 0) {
      emptyMsg.textContent = 'Sin historial de tarifas registrado.';
      emptyMsg.style.display = 'block';
      tableHistorial.style.display = 'none';
      return;
    }

    emptyMsg.style.display = 'none';
    tableHistorial.style.display = 'table';

    historial.forEach(h => {
      const tr = document.createElement('tr');
      const badgeClass = h.activo ? 'vigente' : 'historico';
      const badgeText = h.activo ? 'Vigente' : 'Histórico';
      const badgeHtml = `<span class="tarifa-badge ${badgeClass}">${badgeText}</span>`;

      tr.innerHTML = `
        <td style="font-weight: 600; text-align: right;">${currencyFormatter.format(parseFloat(h.valor_hora))}</td>
        <td>${formatFecha(h.fecha_desde)}</td>
        <td>${formatFecha(h.fecha_hasta)}</td>
        <td style="text-align: center;">${badgeHtml}</td>
      `;
      tbodyHistorial.appendChild(tr);
    });
  } catch (error) {
    console.error('Error al cargar historial:', error);
    tbodyHistorial.innerHTML = '';
    emptyMsg.style.display = 'block';
    tableHistorial.style.display = 'none';
  }
}

/**
 * Carga el historial de tarifas por rendimiento
 */
async function cargarHistorialRendimiento(usuarioId) {
  const table = document.getElementById('tabla-historial-rendimiento');
  const tbody = document.getElementById('tbody-historial-rendimiento');
  const emptyMsg = document.getElementById('historial-empty-msg');

  try {
    const res = await fetch(`${API_BASE}/usuarios/${usuarioId}/tarifas/rendimiento/historial`);
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

    const historial = await res.json();
    tbody.innerHTML = '';

    // Almacenar los artículos que ya tienen una tarifa activa para este operario
    articulosActivosOperario = historial
      .filter(h => h.activo)
      .map(h => h.articulo_numero);

    if (historial.length === 0) {
      emptyMsg.textContent = 'Sin historial de tarifas de rendimiento registrado.';
      emptyMsg.style.display = 'block';
      table.style.display = 'none';
      return;
    }

    emptyMsg.style.display = 'none';
    table.style.display = 'table';

    historial.forEach(h => {
      const tr = document.createElement('tr');
      const badgeClass = h.activo ? 'vigente' : 'historico';
      const badgeText = h.activo ? 'Vigente' : 'Histórico';
      const badgeHtml = `<span class="tarifa-badge ${badgeClass}">${badgeText}</span>`;
      
      let actionBtn = `<button type="button" class="btn-nueva-tarifa" onclick="prepararNuevaTarifa('${h.articulo_numero}', '${h.articulo_nombre ? h.articulo_nombre.replace(/'/g, "\\'") : ''}', '${h.unidad_medida}')"><i class="fa-solid fa-plus"></i> Nueva Tarifa</button>`;
      if (h.activo) {
        actionBtn += ` <button type="button" class="btn-desactivar" onclick="desactivarTarifaRendimiento('${h.articulo_numero}')"><i class="fa-solid fa-ban"></i> Inactivar</button>`;
      }

      tr.innerHTML = `
        <td><strong>${h.articulo_numero}</strong><br><small style="color:#64748b;">${h.articulo_nombre || ''}</small></td>
        <td style="font-weight: 600; text-align: right;">${currencyFormatter.format(parseFloat(h.valor_por_unidad))}</td>
        <td style="text-align: center;"><code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;">${h.unidad_medida}</code></td>
        <td>${formatFecha(h.fecha_desde)}</td>
        <td>${formatFecha(h.fecha_hasta)}</td>
        <td style="text-align: center;">${badgeHtml}</td>
        <td style="text-align: center;">${actionBtn}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error al cargar historial rendimiento:', error);
    tbody.innerHTML = '';
    emptyMsg.style.display = 'block';
    table.style.display = 'none';
  }
}

/**
 * Desactiva una tarifa de rendimiento activa
 */
window.desactivarTarifaRendimiento = async function(articuloNumero) {
  if (!selectedColaboradorId) return;
  
  const result = await Swal.fire({
    title: '¿Desactivar Tarifa?',
    text: `¿Está seguro de que desea inactivar la tarifa de rendimiento para el artículo ${articuloNumero}?`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'Sí, desactivar',
    cancelButtonText: 'Cancelar'
  });

  if (result.isConfirmed) {
    try {
      const res = await fetch(`${API_BASE}/usuarios/${selectedColaboradorId}/tarifas/rendimiento/desactivar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articulo_numero: articuloNumero })
      });
      if (res.ok) {
        Swal.fire({
          icon: 'success',
          title: 'Tarifa Desactivada',
          text: 'La tarifa de rendimiento ha sido dada de baja del historial activo.',
          timer: 2000,
          showConfirmButton: false
        });
        await cargarHistorialRendimiento(selectedColaboradorId);
      } else {
        const err = await res.json();
        throw new Error(err.error);
      }
    } catch (err) {
      Swal.fire('Error', err.message, 'error');
    }
  }
};

/**
 * Precarga el artículo de la fila en el formulario, limpia la tarifa anterior y enfoca el campo de valor
 */
window.prepararNuevaTarifa = function(articuloNumero, articuloNombre, unidadMedida) {
  const buscador = document.getElementById('articulo-buscador');
  const hiddenInput = document.getElementById('tarifa-rendimiento-articulo');
  const clearBtn = document.getElementById('btn-clear-articulo');
  const valInput = document.getElementById('tarifa-rendimiento-valor');
  const unidadSelect = document.getElementById('tarifa-rendimiento-unidad');
  
  if (buscador) {
    buscador.value = articuloNombre ? `${articuloNumero} - ${articuloNombre}` : articuloNumero;
  }
  if (hiddenInput) {
    hiddenInput.value = articuloNumero;
  }
  if (clearBtn) {
    clearBtn.style.display = 'block';
  }
  if (unidadSelect) {
    unidadSelect.value = unidadMedida || 'kg';
  }
  
  if (valInput) {
    valInput.value = '';
    valInput.focus();
  }
};

/**
 * Configura los eventos de los formularios de tarifas
 */
function configurarFormulario() {
  const formHoras = document.getElementById('form-actualizar-tarifa');
  const formRendimiento = document.getElementById('form-actualizar-tarifa-rendimiento');

  // Submit Tarifa Hora
  formHoras.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuarioId = document.getElementById('colaborador-id').value;
    const valorHora = parseFloat(document.getElementById('tarifa-valor').value);
    const colaboradorNombre = document.getElementById('colaborador-nombre').textContent;

    try {
      const btn = document.getElementById('btn-guardar-tarifa');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

      const res = await fetch(`${API_BASE}/usuarios/${usuarioId}/tarifas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor_hora: valorHora })
      });

      const result = await res.json();
      if (res.ok) {
        Swal.fire({
          icon: 'success',
          title: 'Tarifa Hora Guardada',
          text: `Tarifa de hora de ${currencyFormatter.format(valorHora)} asignada correctamente.`,
          timer: 2000,
          showConfirmButton: false
        });
        await cargarColaboradoresTarifas();
        await cargarHistorialTarifas(usuarioId);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error', text: error.message });
    } finally {
      const btn = document.getElementById('btn-guardar-tarifa');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar Tarifa Hora';
    }
  });

  // Submit Tarifa Rendimiento
  formRendimiento.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usuarioId = document.getElementById('colaborador-id').value;
    const articulo = document.getElementById('tarifa-rendimiento-articulo').value;
    const valor = parseFloat(document.getElementById('tarifa-rendimiento-valor').value);
    const unidad = document.getElementById('tarifa-rendimiento-unidad').value;

    if (!articulo) {
      Swal.fire({
        icon: 'error',
        title: 'Selección Inválida',
        text: 'Por favor, busque y seleccione un artículo de la lista predictiva.'
      });
      return;
    }

    try {
      const btn = document.getElementById('btn-guardar-tarifa-rendimiento');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

      const res = await fetch(`${API_BASE}/usuarios/${usuarioId}/tarifas/rendimiento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articulo_numero: articulo,
          valor_por_unidad: valor,
          unidad_medida: unidad
        })
      });

      const result = await res.json();
      if (res.ok) {
        Swal.fire({
          icon: 'success',
          title: 'Tarifa Rendimiento Guardada',
          text: 'Se ha registrado la tarifa de rendimiento para el artículo especificado.',
          timer: 2000,
          showConfirmButton: false
        });
        
        // Limpiar buscador
        document.getElementById('articulo-buscador').value = '';
        document.getElementById('tarifa-rendimiento-articulo').value = '';
        document.getElementById('btn-clear-articulo').style.display = 'none';
        document.getElementById('tarifa-rendimiento-valor').value = '';
        
        await cargarHistorialRendimiento(usuarioId);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Error', text: error.message });
    } finally {
      const btn = document.getElementById('btn-guardar-tarifa-rendimiento');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar Tarifa Rendimiento';
    }
  });
}
