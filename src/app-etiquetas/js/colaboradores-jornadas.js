/**
 * Controlador para la interfaz de Control de Horarios y Liquidación de Colaboradores
 */

let colaboradoresDisponibles = [];
let jornadasCargadas = [];
let seleccionadosIds = new Set();

document.addEventListener('DOMContentLoaded', async () => {
  await cargarColaboradoresFiltro();
  
  // Si la URL contiene un usuario_id predeterminado (ej: desde cuenta corriente)
  const urlParams = new URLSearchParams(window.location.search);
  const paramUsuarioId = urlParams.get('usuario_id');
  if (paramUsuarioId) {
    const select = document.getElementById('filtro-colaborador');
    if (select) {
      select.value = paramUsuarioId;
      cambiarColaboradorFiltro();
    }
  } else {
    // Por defecto, mostrar las jornadas de todos los colaboradores
    await cargarJornadas();
  }
});

/**
 * Carga los colaboradores en el filtro desplegable y actualiza datos de CC
 */
async function cargarColaboradoresFiltro() {
  const select = document.getElementById('filtro-colaborador');
  if (!select) return;

  try {
    const res = await fetch('/api/colaboradores/jornadas/elegibles');
    if (!res.ok) throw new Error('Error al consultar colaboradores elegibles');
    
    colaboradoresDisponibles = await res.json();
    
    select.innerHTML = '<option value="">Todos los colaboradores</option>';
    colaboradoresDisponibles.forEach(c => {
      const option = document.createElement('option');
      option.value = c.usuario_id;
      const tarifaStr = parseFloat(c.valor_hora || 0) > 0 ? ` ($${parseFloat(c.valor_hora).toLocaleString('es-AR')}/h)` : '';
      option.textContent = `${c.nombre_completo} (${c.rol_nombre || 'Colaborador'})${tarifaStr}`;
      select.appendChild(option);
    });

    actualizarInfoCuentaCorriente();
  } catch (error) {
    console.error('Error al cargar colaboradores:', error);
    select.innerHTML = '<option value="">Error al cargar colaboradores</option>';
  }
}

/**
 * Evento al cambiar de colaborador en el filtro
 */
function cambiarColaboradorFiltro() {
  actualizarInfoCuentaCorriente();
  cargarJornadas();
}

/**
 * Actualiza la tarjeta KPI de Cuenta Corriente según el colaborador seleccionado
 */
function actualizarInfoCuentaCorriente() {
  const select = document.getElementById('filtro-colaborador');
  const ccSaldoEl = document.getElementById('kpi-cc-saldo');
  const ccInfoEl = document.getElementById('kpi-cc-info');
  if (!select || !ccSaldoEl || !ccInfoEl) return;

  const uId = select.value;
  if (!uId) {
    ccSaldoEl.textContent = 'Múltiples';
    ccSaldoEl.style.color = 'var(--dark-slate)';
    ccInfoEl.textContent = 'Filtro global de colaboradores';
    return;
  }

  const colaborador = colaboradoresDisponibles.find(c => String(c.usuario_id) === String(uId));
  if (colaborador && colaborador.codigo_bunker_cliente) {
    const saldo = parseFloat(colaborador.cuenta_corriente_saldo || 0);
    const saldoFormateado = `$${Math.abs(saldo).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    if (saldo < 0) {
      ccSaldoEl.textContent = `-${saldoFormateado}`;
      ccSaldoEl.style.color = '#15803d'; // A favor del cliente / colaborador
      ccInfoEl.innerHTML = `<strong>${colaborador.codigo_bunker_cliente}</strong>: Saldo a favor (Crédito)`;
    } else if (saldo > 0) {
      ccSaldoEl.textContent = saldoFormateado;
      ccSaldoEl.style.color = '#dc2626'; // Deuda
      ccInfoEl.innerHTML = `<strong>${colaborador.codigo_bunker_cliente}</strong>: Deuda pendiente`;
    } else {
      ccSaldoEl.textContent = '$0.00';
      ccSaldoEl.style.color = 'var(--dark-slate)';
      ccInfoEl.innerHTML = `<strong>${colaborador.codigo_bunker_cliente}</strong>: Al día`;
    }
  } else {
    ccSaldoEl.textContent = 'Sin CC';
    ccSaldoEl.style.color = '#64748b';
    ccInfoEl.textContent = 'Sin cuenta corriente vinculada';
  }
}

/**
 * Aplica filtros rápidos de fecha / estado
 */
function aplicarPeriodoRapido(tipo) {
  const btns = document.querySelectorAll('.btn-period');
  btns.forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');

  const hoy = new Date();
  const formatYMD = (d) => d.toISOString().split('T')[0];

  const desdeInput = document.getElementById('filtro-fecha-desde');
  const hastaInput = document.getElementById('filtro-fecha-hasta');
  const estadoSelect = document.getElementById('filtro-estado');

  if (tipo === 'hoy') {
    desdeInput.value = formatYMD(hoy);
    hastaInput.value = formatYMD(hoy);
    estadoSelect.value = '';
  } else if (tipo === 'semana') {
    const diaSemana = hoy.getDay();
    const distanciaLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() + distanciaLunes);
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);
    desdeInput.value = formatYMD(lunes);
    hastaInput.value = formatYMD(domingo);
    estadoSelect.value = '';
  } else if (tipo === 'mes') {
    const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    desdeInput.value = formatYMD(primerDia);
    hastaInput.value = formatYMD(ultimoDia);
    estadoSelect.value = '';
  } else if (tipo === 'pendientes') {
    desdeInput.value = '';
    hastaInput.value = '';
    estadoSelect.value = 'FINALIZADA';
  } else if (tipo === 'todos') {
    desdeInput.value = '';
    hastaInput.value = '';
    estadoSelect.value = '';
  }

  cargarJornadas();
}

/**
 * Carga el listado de jornadas desde el backend según los filtros activos
 */
async function cargarJornadas() {
  const tbody = document.getElementById('tbody-jornadas');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="11" class="empty-state">
        <i class="fa-solid fa-spinner fa-spin"></i> Cargando jornadas...
      </td>
    </tr>
  `;

  const usuarioId = document.getElementById('filtro-colaborador').value;
  const estado = document.getElementById('filtro-estado').value;
  const fechaDesde = document.getElementById('filtro-fecha-desde').value;
  const fechaHasta = document.getElementById('filtro-fecha-hasta').value;

  const params = new URLSearchParams();
  if (usuarioId) params.append('usuario_id', usuarioId);
  if (estado) params.append('estado', estado);
  if (fechaDesde) params.append('fecha_desde', `${fechaDesde} 00:00:00`);
  if (fechaHasta) params.append('fecha_hasta', `${fechaHasta} 23:59:59`);

  try {
    const res = await fetch(`/api/colaboradores/jornadas?${params.toString()}`);
    if (!res.ok) throw new Error('Error al cargar jornadas');

    jornadasCargadas = await res.json();
    seleccionadosIds.clear();
    actualizarBotonLiquidacion();

    if (jornadasCargadas.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" class="empty-state">
            <i class="fa-regular fa-calendar-xmark"></i>
            No se encontraron jornadas registradas para los filtros seleccionados.
          </td>
        </tr>
      `;
      actualizarKpis(0, 0, 0, 0);
      return;
    }

    let totalHoras = 0;
    let horasPendientes = 0;
    let montoPendiente = 0;
    let pendientesCount = 0;

    let html = '';
    jornadasCargadas.forEach(j => {
      const horasNum = parseFloat(j.horas_totales) || 0;
      const montoNum = parseFloat(j.monto_total) || 0;
      const esPendiente = j.estado === 'FINALIZADA';
      const esEnCurso = j.estado === 'EN_CURSO';

      totalHoras += horasNum;
      if (esPendiente) {
        horasPendientes += horasNum;
        montoPendiente += montoNum;
        pendientesCount++;
      }

      // Formatear Fecha
      const fechaObj = new Date(j.fecha_ingreso);
      const diaSemana = fechaObj.toLocaleDateString('es-AR', { weekday: 'short' });
      const fechaStr = fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const fechaFinal = `${diaSemana.toUpperCase()} ${fechaStr}`;

      // Formatear Horas
      const horaIngreso = fechaObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      const horaEgreso = j.fecha_egreso 
        ? new Date(j.fecha_egreso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) 
        : '<span style="color: #15803d; font-weight: bold;">En curso...</span>';

      // Formatear Tiempo
      const minutos = parseInt(j.minutos_totales) || 0;
      const hs = Math.floor(minutos / 60);
      const mins = minutos % 60;
      const tiempoDetalle = esEnCurso 
        ? '<span style="color: #15803d;">⏱️ Contando...</span>' 
        : `<strong>${horasNum.toFixed(2)} hs</strong> <span style="color: #64748b; font-size: 0.85em;">(${hs}h ${mins}m)</span>`;

      // Formatear Tarifa y Total
      const tarifaVal = parseFloat(j.valor_hora_aplicado || 0);
      const tarifaStr = tarifaVal > 0 ? `$${tarifaVal.toLocaleString('es-AR')}` : '-';
      const totalStr = montoNum > 0 ? `$${montoNum.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '-';

      // Badge Estado
      let badgeEstado = '';
      if (j.estado === 'EN_CURSO') {
        badgeEstado = `<span class="badge-estado badge-en-curso"><i class="fa-solid fa-spinner fa-spin"></i> En Curso</span>`;
      } else if (j.estado === 'FINALIZADA') {
        badgeEstado = `<span class="badge-estado badge-pendiente"><i class="fa-solid fa-clock"></i> Pendiente</span>`;
      } else if (j.estado === 'LIQUIDADA') {
        badgeEstado = `<span class="badge-estado badge-liquidada"><i class="fa-solid fa-check-double"></i> Liquidada</span>`;
      }

      // Detalle / CC Info
      let detalleCC = '';
      if (j.estado === 'LIQUIDADA' && j.movimiento_id) {
        detalleCC = `
          <span style="font-size: 0.8em; color: #7e22ce; font-weight: 600;" title="${j.movimiento_descripcion || ''}">
            🏦 Mov. CC #${j.movimiento_id}
          </span>
        `;
      } else if (j.observacion_ingreso || j.observacion_egreso) {
        const obs = [j.observacion_ingreso, j.observacion_egreso].filter(Boolean).join(' | ');
        detalleCC = `<span style="font-size: 0.8em; color: #64748b;" title="${obs}">${obs.length > 25 ? obs.substring(0, 25) + '...' : obs}</span>`;
      } else {
        detalleCC = '<span style="color: #cbd5e1;">-</span>';
      }

      // Checkbox para liquidar (solo si está pendiente)
      const checkboxHtml = esPendiente
        ? `<input type="checkbox" class="check-jornada" data-id="${j.id}" onchange="toggleSelectFila(this, ${j.id})">`
        : `<input type="checkbox" disabled style="opacity: 0.3;">`;

      // Acciones
      let accionesHtml = `
        <button type="button" class="btn-row-action" title="Editar jornada" onclick="abrirModalEdicion(${j.id})">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
      `;
      if (j.estado !== 'LIQUIDADA') {
        accionesHtml += `
          <button type="button" class="btn-row-action btn-row-delete" title="Eliminar jornada" onclick="eliminarJornada(${j.id})">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        `;
      }

      html += `
        <tr id="fila-jornada-${j.id}" class="${esPendiente ? 'fila-pendiente' : ''}">
          <td style="text-align: center;">${checkboxHtml}</td>
          <td><strong>${j.nombre_completo}</strong></td>
          <td>${fechaFinal}</td>
          <td>${horaIngreso}</td>
          <td>${horaEgreso}</td>
          <td>${tiempoDetalle}</td>
          <td>${tarifaStr}</td>
          <td><strong>${totalStr}</strong></td>
          <td>${badgeEstado}</td>
          <td>${detalleCC}</td>
          <td style="text-align: center; white-space: nowrap;">${accionesHtml}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    actualizarKpis(totalHoras, horasPendientes, montoPendiente, pendientesCount);

    const masterCheck = document.getElementById('check-select-all');
    if (masterCheck) masterCheck.checked = false;

  } catch (error) {
    console.error('Error al cargar jornadas:', error);
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="empty-state" style="color: #dc2626;">
          <i class="fa-solid fa-circle-exclamation"></i>
          Error al cargar los registros de jornadas.
        </td>
      </tr>
    `;
  }
}

/**
 * Actualiza los valores de las tarjetas KPIs
 */
function actualizarKpis(totalHoras, horasPendientes, montoPendiente, pendientesCount) {
  document.getElementById('kpi-horas-totales').textContent = `${totalHoras.toFixed(2)} hs`;
  document.getElementById('kpi-jornadas-count').textContent = `${jornadasCargadas.length} jornada(s) registradas`;

  document.getElementById('kpi-horas-pendientes').textContent = `${horasPendientes.toFixed(2)} hs`;
  document.getElementById('kpi-pendientes-count').textContent = `${pendientesCount} jornada(s) pendientes de liquidar`;

  document.getElementById('kpi-monto-pendiente').textContent = `$${montoPendiente.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Manejo de Selección de Jornadas
 */
function toggleSelectFila(checkbox, id) {
  const tr = document.getElementById(`fila-jornada-${id}`);
  if (checkbox.checked) {
    seleccionadosIds.add(id);
    if (tr) tr.classList.add('selected-row');
  } else {
    seleccionadosIds.delete(id);
    if (tr) tr.classList.remove('selected-row');
  }
  actualizarBotonLiquidacion();
}

function toggleSelectAll(masterCheckbox) {
  const checkboxes = document.querySelectorAll('.check-jornada:not(:disabled)');
  checkboxes.forEach(cb => {
    cb.checked = masterCheckbox.checked;
    const id = parseInt(cb.getAttribute('data-id'));
    const tr = document.getElementById(`fila-jornada-${id}`);
    if (masterCheckbox.checked) {
      seleccionadosIds.add(id);
      if (tr) tr.classList.add('selected-row');
    } else {
      seleccionadosIds.delete(id);
      if (tr) tr.classList.remove('selected-row');
    }
  });
  actualizarBotonLiquidacion();
}

function actualizarBotonLiquidacion() {
  const btn = document.getElementById('btn-liquidar-seleccion');
  const label = document.getElementById('label-seleccionados');
  const count = seleccionadosIds.size;

  if (label) {
    if (count === 0) {
      label.textContent = '0 jornadas seleccionadas';
    } else {
      // Calcular horas y monto de la selección
      let hsSum = 0;
      let montoSum = 0;
      seleccionadosIds.forEach(id => {
        const j = jornadasCargadas.find(item => item.id === id);
        if (j) {
          hsSum += parseFloat(j.horas_totales) || 0;
          montoSum += parseFloat(j.monto_total) || 0;
        }
      });
      label.innerHTML = `<strong>${count}</strong> seleccionadas: <strong>${hsSum.toFixed(2)} hs</strong> | <strong>$${montoSum.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong>`;
    }
  }

  if (btn) {
    btn.disabled = count === 0;
  }
}

/**
 * Diálogo interactivo para liquidar la selección a Cuenta Corriente
 */
async function confirmarLiquidacionSeleccion() {
  if (seleccionadosIds.size === 0) return;

  const idsArray = Array.from(seleccionadosIds);
  const seleccionadas = jornadasCargadas.filter(j => idsArray.includes(j.id));

  // Verificar que pertenezcan al mismo colaborador o agrupar
  const usuariosSet = new Set(seleccionadas.map(j => j.usuario_id));
  if (usuariosSet.size > 1) {
    Swal.fire({
      icon: 'warning',
      title: 'Múltiples colaboradores',
      text: 'Ha seleccionado jornadas de diferentes colaboradores. Por favor filtre por colaborador y liquide de forma individual para asentar con precisión en cada Cuenta Corriente.'
    });
    return;
  }

  const colaborador = seleccionadas[0];
  const totalHoras = seleccionadas.reduce((acc, j) => acc + (parseFloat(j.horas_totales) || 0), 0);
  const totalMonto = seleccionadas.reduce((acc, j) => acc + (parseFloat(j.monto_total) || 0), 0);

  // Verificar si tiene Cuenta Corriente activa vinculada
  if (!colaborador.codigo_bunker_cliente || !colaborador.cuenta_corriente_id) {
    Swal.fire({
      icon: 'error',
      title: 'Sin Cuenta Corriente',
      html: `El colaborador <strong>${colaborador.nombre_completo}</strong> no tiene una Cuenta Corriente activa vinculada en <strong>Clientes Búnker</strong>.<br><br>Para liquidar sus horas a Cuenta Corriente, asigne su usuario en la ficha del cliente.`
    });
    return;
  }

  const saldoActual = parseFloat(colaborador.cuenta_corriente_saldo || 0);
  const saldoProyectado = saldoActual - totalMonto; // El crédito resta la deuda

  const descPorDefecto = `Crédito por liquidación de ${totalHoras.toFixed(2)} hs en depósito (${seleccionadas.length} jornadas)`;

  const { value: formValues } = await Swal.fire({
    title: '💳 Liquidar Horas a Cuenta Corriente',
    width: '600px',
    html: `
      <div style="text-align: left; font-size: 0.95em;">
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
          <div style="font-size: 1.1em; font-weight: bold; color: #1e293b; margin-bottom: 10px;">
            👤 ${colaborador.nombre_completo} <span style="font-size: 0.85em; font-weight: normal; color: #64748b;">(Cliente ${colaborador.codigo_bunker_cliente})</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.9em; color: #475569; margin-bottom: 8px;">
            <div>📋 Jornadas a liquidar: <strong>${seleccionadas.length}</strong></div>
            <div>⏱️ Total de tiempo: <strong>${totalHoras.toFixed(2)} hs</strong></div>
            <div>🏦 Saldo CC Actual: <strong>$${saldoActual.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong></div>
            <div>✨ Saldo CC Resultante: <strong style="color: #15803d;">$${saldoProyectado.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong></div>
          </div>
          <div style="padding-top: 10px; border-top: 1px dashed #cbd5e1; font-size: 1.15em; font-weight: bold; color: #047857; text-align: right;">
            Monto a Acreditar: $${totalMonto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
          </div>
        </div>

        <div style="margin-bottom: 12px;">
          <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Concepto / Descripción del Movimiento en Cuenta Corriente:</label>
          <input id="swal-desc-liquidacion" type="text" value="${descPorDefecto}" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box; font-size: 0.95em;">
        </div>

        <div style="font-size: 0.85em; color: #64748b; background: #fefce8; border: 1px solid #fef08a; padding: 8px 12px; border-radius: 8px;">
          ⚠️ Esta operación asentará un movimiento contable tipo <strong>CRÉDITO</strong> por <strong>$${totalMonto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong> con comprobante <strong>CREDITO_HORAS</strong> y marcará las jornadas como LIQUIDADAS.
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '💾 Confirmar Liquidación',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#10b981',
    preConfirm: () => {
      const desc = document.getElementById('swal-desc-liquidacion').value;
      return { descripcion_personalizada: desc };
    }
  });

  if (formValues) {
    Swal.showLoading();
    try {
      const resp = await fetch('/api/colaboradores/jornadas/liquidar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jornada_ids: idsArray,
          descripcion_personalizada: formValues.descripcion_personalizada
        })
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || 'Error al procesar la liquidación');
      }

      await cargarColaboradoresFiltro();
      await cargarJornadas();

      Swal.fire({
        icon: 'success',
        title: '¡Liquidación Exitosa!',
        html: `
          Se acreditaron <strong>$${totalMonto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong> en la Cuenta Corriente de <strong>${colaborador.nombre_completo}</strong>.<br><br>
          Nuevo saldo de Cuenta Corriente: <strong>$${saldoProyectado.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong>.
        `,
        confirmButtonText: 'Aceptar'
      });
    } catch (error) {
      console.error('Error al liquidar:', error);
      Swal.fire({
        icon: 'error',
        title: 'Error en la liquidación',
        text: error.message || 'No se pudo liquidar a Cuenta Corriente.'
      });
    }
  }
}

/**
 * Modal para Carga Manual de Jornada Pasada
 */
async function abrirModalCargaManual() {
  if (colaboradoresDisponibles.length === 0) {
    Swal.fire('Atención', 'No hay colaboradores elegibles disponibles.', 'warning');
    return;
  }

  let optionsHtml = '';
  colaboradoresDisponibles.forEach((c, idx) => {
    const tarifa = parseFloat(c.valor_hora || 0) > 0 ? `$${parseFloat(c.valor_hora).toLocaleString('es-AR')}/h` : 'Sin tarifa';
    const selected = (c.usuario.toLowerCase().includes('matias') || idx === 0) ? 'selected' : '';
    optionsHtml += `<option value="${c.usuario_id}" ${selected}>${c.nombre_completo} (${tarifa})</option>`;
  });

  const hoyStr = new Date().toISOString().split('T')[0];

  const { value: formValues } = await Swal.fire({
    title: '➕ Cargar Jornada Pasada',
    html: `
      <div style="text-align: left; font-size: 0.95em;">
        <div style="margin-bottom: 12px;">
          <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Colaborador:</label>
          <select id="swal-manual-usuario" class="swal2-select" style="width: 100%; margin: 0; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1;">
            ${optionsHtml}
          </select>
        </div>

        <div style="margin-bottom: 12px;">
          <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Fecha de la Jornada:</label>
          <input id="swal-manual-fecha" type="date" value="${hoyStr}" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box;">
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div>
            <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Hora Ingreso:</label>
            <input id="swal-manual-ingreso" type="time" value="08:00" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box;">
          </div>
          <div>
            <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Hora Egreso:</label>
            <input id="swal-manual-egreso" type="time" value="12:00" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box;">
          </div>
        </div>

        <div>
          <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Motivo / Observaciones:</label>
          <input id="swal-manual-obs" type="text" placeholder="Ej: Registro manual por olvido de fichaje" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box;">
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '💾 Guardar Jornada',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#10b981',
    preConfirm: () => {
      const uId = document.getElementById('swal-manual-usuario').value;
      const fecha = document.getElementById('swal-manual-fecha').value;
      const ing = document.getElementById('swal-manual-ingreso').value;
      const eg = document.getElementById('swal-manual-egreso').value;
      const obs = document.getElementById('swal-manual-obs').value;

      if (!uId || !fecha || !ing || !eg) {
        Swal.showValidationMessage('Todos los campos son obligatorios');
        return false;
      }

      const timestampIngreso = `${fecha}T${ing}:00`;
      const timestampEgreso = `${fecha}T${eg}:00`;

      if (timestampEgreso <= timestampIngreso) {
        Swal.showValidationMessage('La hora de egreso debe ser posterior a la de ingreso');
        return false;
      }

      return {
        usuario_id: parseInt(uId),
        fecha_ingreso: timestampIngreso,
        fecha_egreso: timestampEgreso,
        observacion_ingreso: obs || 'Carga manual administrativa'
      };
    }
  });

  if (formValues) {
    Swal.showLoading();
    try {
      const resp = await fetch('/api/colaboradores/jornadas/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues)
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || 'Error al guardar jornada manual');
      }

      await cargarJornadas();
      Swal.fire({
        icon: 'success',
        title: '¡Jornada Registrada!',
        text: 'La jornada ha sido guardada en estado pendiente de liquidar.',
        timer: 2000,
        showConfirmButton: false
      });
    } catch (error) {
      console.error('Error al crear jornada manual:', error);
      Swal.fire('Error', error.message || 'No se pudo registrar la jornada manual.', 'error');
    }
  }
}

/**
 * Modal para Editar Jornada Existente
 */
async function abrirModalEdicion(jornadaId) {
  const jornada = jornadasCargadas.find(j => j.id === jornadaId);
  if (!jornada) return;

  if (jornada.estado === 'LIQUIDADA') {
    Swal.fire('No editable', 'Esta jornada ya fue liquidada a Cuenta Corriente y no puede ser modificada.', 'info');
    return;
  }

  const formatDateTimeLocal = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const valIngreso = formatDateTimeLocal(jornada.fecha_ingreso);
  const valEgreso = formatDateTimeLocal(jornada.fecha_egreso);

  const { value: formValues } = await Swal.fire({
    title: `✏️ Editar Jornada #${jornada.id}`,
    html: `
      <div style="text-align: left; font-size: 0.95em;">
        <div style="margin-bottom: 12px;">
          <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Colaborador:</label>
          <input type="text" value="${jornada.nombre_completo}" disabled style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; box-sizing: border-box;">
        </div>

        <div style="margin-bottom: 12px;">
          <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Fecha y Hora Ingreso:</label>
          <input id="swal-edit-ingreso" type="datetime-local" value="${valIngreso}" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box;">
        </div>

        <div style="margin-bottom: 12px;">
          <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Fecha y Hora Egreso:</label>
          <input id="swal-edit-egreso" type="datetime-local" value="${valEgreso}" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box;">
        </div>

        <div style="margin-bottom: 12px;">
          <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Tarifa por Hora ($):</label>
          <input id="swal-edit-tarifa" type="number" step="0.01" value="${parseFloat(jornada.valor_hora_aplicado || 0)}" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box;">
        </div>

        <div>
          <label style="display: block; font-weight: 600; margin-bottom: 5px; color: #334155;">Observaciones:</label>
          <input id="swal-edit-obs" type="text" value="${jornada.observacion_ingreso || ''}" placeholder="Observaciones..." style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box;">
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: '💾 Guardar Cambios',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#10b981',
    preConfirm: () => {
      const ing = document.getElementById('swal-edit-ingreso').value;
      const eg = document.getElementById('swal-edit-egreso').value;
      const tarifa = document.getElementById('swal-edit-tarifa').value;
      const obs = document.getElementById('swal-edit-obs').value;

      if (!ing) {
        Swal.showValidationMessage('Debe ingresar la fecha de ingreso');
        return false;
      }

      if (eg && new Date(eg) <= new Date(ing)) {
        Swal.showValidationMessage('La hora de egreso debe ser posterior a la de ingreso');
        return false;
      }

      return {
        fecha_ingreso: ing,
        fecha_egreso: eg || null,
        valor_hora_aplicado: parseFloat(tarifa) || 0,
        observacion_ingreso: obs
      };
    }
  });

  if (formValues) {
    Swal.showLoading();
    try {
      const resp = await fetch(`/api/colaboradores/jornadas/${jornadaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formValues)
      });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || 'Error al actualizar jornada');
      }

      await cargarJornadas();
      Swal.fire({
        icon: 'success',
        title: '¡Modificación Guardada!',
        timer: 1500,
        showConfirmButton: false
      });
    } catch (error) {
      console.error('Error al editar jornada:', error);
      Swal.fire('Error', error.message || 'No se pudo modificar la jornada.', 'error');
    }
  }
}

/**
 * Elimina una jornada si no ha sido liquidada
 */
async function eliminarJornada(jornadaId) {
  const jornada = jornadasCargadas.find(j => j.id === jornadaId);
  if (!jornada) return;

  if (jornada.estado === 'LIQUIDADA') {
    Swal.fire('No permitida', 'No se puede eliminar una jornada que ya fue liquidada a Cuenta Corriente.', 'warning');
    return;
  }

  const { isConfirmed } = await Swal.fire({
    title: '¿Eliminar registro de jornada?',
    text: `Se eliminará la jornada #${jornadaId} de ${jornada.nombre_completo}. Esta acción no se puede deshacer.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: '🗑️ Sí, eliminar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc2626'
  });

  if (isConfirmed) {
    Swal.showLoading();
    try {
      const resp = await fetch(`/api/colaboradores/jornadas/${jornadaId}`, { method: 'DELETE' });
      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || 'Error al eliminar jornada');
      }

      await cargarJornadas();
      Swal.fire('Eliminada', 'La jornada ha sido eliminada correctamente.', 'success');
    } catch (error) {
      console.error('Error al eliminar jornada:', error);
      Swal.fire('Error', error.message || 'No se pudo eliminar la jornada.', 'error');
    }
  }
}
