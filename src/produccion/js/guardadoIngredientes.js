let modal = null;
let tablaBody = null;
let btnImprimirTodas = null;
let btnGuardarAjustes = null;
let carroIdGlobal = null;
let usuarioIdGlobal = null;
let tipoCarroGlobal = null; // Nuevo: para controlar lógica condicional
let ingredientes = [];

export async function abrirModalGuardadoIngredientes(carroId, usuarioId) {
  console.log('\n🚀 [DIAGNÓSTICO] INICIANDO FUNCIÓN abrirModalGuardadoIngredientes');
  console.log('================================================================');
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('🔍 [GUARDADO] Parámetros recibidos:', {
    carroId: carroId,
    tipoCarroId: typeof carroId,
    usuarioId: usuarioId,
    tipoUsuarioId: typeof usuarioId
  });

  // PASO 1: Validar parámetros
  console.log('\n📋 PASO 1: Validando parámetros...');
  if (!carroId || !usuarioId) {
    console.error('❌ [GUARDADO] Faltan parámetros requeridos');
    console.error('❌ carroId:', carroId, '| usuarioId:', usuarioId);
    return;
  }
  console.log('✅ Parámetros válidos');

  carroIdGlobal = carroId;
  usuarioIdGlobal = usuarioId;
  console.log('✅ Variables globales asignadas');

  // PASO 2: Verificar si el modal ya existe
  console.log('\n📋 PASO 2: Verificando estado del modal...');
  console.log('🔍 Modal actual:', !!modal);
  console.log('🔍 Modal en DOM (por ID):', !!document.getElementById('modal-guardado-ingredientes'));

  if (!modal) {
    console.log('📋 Modal no existe, inicializando...');
    inicializarModal();
    console.log('✅ Modal inicializado');
  } else {
    console.log('✅ Modal ya existe, reutilizando');
  }

  // PASO 3: Verificar estado del modal después de inicialización
  console.log('\n📋 PASO 3: Verificando modal después de inicialización...');
  console.log('🔍 Modal object:', modal);
  console.log('🔍 Modal en DOM:', !!document.getElementById('modal-guardado-ingredientes'));

  if (modal) {
    const estilosComputados = window.getComputedStyle(modal);
    console.log('🔍 Estado inicial del modal:');
    console.log('   - display:', estilosComputados.display);
    console.log('   - visibility:', estilosComputados.visibility);
    console.log('   - opacity:', estilosComputados.opacity);
    console.log('   - z-index:', estilosComputados.zIndex);
    console.log('   - position:', estilosComputados.position);
  }

  // PASO 4: Cargar ingredientes
  console.log('\n📋 PASO 4: Cargando ingredientes...');
  try {
    await cargarIngredientes();
    console.log('✅ Ingredientes cargados correctamente');
  } catch (error) {
    console.error('❌ Error al cargar ingredientes:', error);
    return;
  }

  // PASO 5: Mostrar el modal
  console.log('\n📋 PASO 5: Mostrando el modal...');
  console.log('🔍 Estado ANTES de mostrar:');
  if (modal) {
    console.log('   - display antes:', window.getComputedStyle(modal).display);
    console.log('   - visibility antes:', window.getComputedStyle(modal).visibility);

    modal.style.display = 'block';

    console.log('🔍 Estado DESPUÉS de mostrar:');
    console.log('   - display después:', window.getComputedStyle(modal).display);
    console.log('   - visibility después:', window.getComputedStyle(modal).visibility);
    console.log('   - opacity después:', window.getComputedStyle(modal).opacity);
    console.log('   - z-index después:', window.getComputedStyle(modal).zIndex);

    // Verificación final después de un breve delay
    setTimeout(() => {
      const estilosFinales = window.getComputedStyle(modal);
      console.log('🔍 Estado FINAL del modal (después de 100ms):');
      console.log('   - display final:', estilosFinales.display);
      console.log('   - visibility final:', estilosFinales.visibility);
      console.log('   - opacity final:', estilosFinales.opacity);
      console.log('   - z-index final:', estilosFinales.zIndex);
      console.log('   - position final:', estilosFinales.position);
      console.log('   - top final:', estilosFinales.top);
      console.log('   - left final:', estilosFinales.left);
      console.log('   - width final:', estilosFinales.width);
      console.log('   - height final:', estilosFinales.height);
    }, 100);

    console.log('✅ [GUARDADO] Modal mostrado correctamente');
  } else {
    console.error('❌ Modal es null, no se puede mostrar');
  }

  console.log('================================================================\n');
}

function inicializarModal() {
  console.log('🔧 [GUARDADO] Inicializando modal');

  modal = document.createElement('div');
  modal.id = 'modal-guardado-ingredientes';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 90%; width: 1000px;">
      <div class="modal-header">
        <h2>📦 Guardado de Ingredientes</h2>
        <span class="close-modal" style="cursor: pointer; font-size: 24px;">&times;</span>
      </div>
      <div class="modal-body">
        <div class="acciones-globales" style="margin-bottom: 20px;">
          <button id="btn-imprimir-todas-etiquetas" class="btn btn-info">🏷️ Imprimir todas las etiquetas</button>
        </div>
        <div class="tabla-container" style="max-height: 400px; overflow-y: auto;">
          <table class="tabla-ingredientes-guardado" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #f8f9fa;">
                <th style="padding: 10px; border: 1px solid #ddd;">Sector</th>
                <th style="padding: 10px; border: 1px solid #ddd;">Ingrediente</th>
                <th style="padding: 10px; border: 1px solid #ddd;">Stock Actual (kg)</th>
                <th style="padding: 10px; border: 1px solid #ddd;">Ajuste Manual (kg)</th>
                <th style="padding: 10px; border: 1px solid #ddd;">Acciones</th>
              </tr>
            </thead>
            <tbody id="tabla-ingredientes-guardado-body"></tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer" style="margin-top: 20px; text-align: right;">
        <button id="btn-guardar-ajustes" class="btn btn-primary">💾 Guardar Ajustes</button>
        <button id="btn-cerrar-modal" class="btn btn-secondary">❌ Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  tablaBody = modal.querySelector('#tabla-ingredientes-guardado-body');
  btnImprimirTodas = modal.querySelector('#btn-imprimir-todas-etiquetas');
  btnGuardarAjustes = modal.querySelector('#btn-guardar-ajustes');
  const btnCerrar = modal.querySelector('#btn-cerrar-modal');
  const btnCerrarX = modal.querySelector('.close-modal');

  btnImprimirTodas.addEventListener('click', imprimirTodasEtiquetas);
  btnGuardarAjustes.addEventListener('click', guardarAjustes);
  btnCerrar.addEventListener('click', cerrarModal);
  btnCerrarX.addEventListener('click', cerrarModal);

  window.addEventListener('click', (e) => {
    if (e.target === modal) {
      cerrarModal();
    }
  });
}

function cerrarModal() {
  if (modal) {
    modal.style.display = 'none';
  }
}

async function cargarIngredientes() {
  try {
    console.log('📡 [GUARDADO] Cargando ingredientes consolidados...');
    const response = await fetch(`http://localhost:3002/api/produccion/carro/${carroIdGlobal}/ingredientes-consolidados?usuarioId=${usuarioIdGlobal}`);

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    ingredientes = data;
    tipoCarroGlobal = data.tipo_carro; // Guardar tipo de carro

    console.log(`✅ [GUARDADO] Ingredientes cargados: ${data.total_ingredientes}`);
    console.log(`info [GUARDADO] Tipo de carro: ${tipoCarroGlobal}`);
    renderizarTabla();
  } catch (error) {
    console.error('❌ [GUARDADO] Error al cargar ingredientes:', error);
    alert('Error al cargar ingredientes: ' + error.message);
  }
}

function renderizarTabla() {
  console.log('🎨 [GUARDADO] Renderizando tabla de ingredientes');

  if (!ingredientes.ingredientes || ingredientes.ingredientes.length === 0) {
    tablaBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">No hay ingredientes para mostrar</td></tr>';
    return;
  }

  tablaBody.innerHTML = '';

  ingredientes.ingredientes.forEach((ing, index) => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #ddd';

    const sectorNombre = ing.sector_nombre || 'Sin sector';
    // Mostrar letra del sector si existe: "G - Frutos Secos"
    const sectorDisplay = ing.sector_letra
      ? `<strong style="color: #2c3e50; font-size: 1.1em;">${ing.sector_letra}</strong> - ${sectorNombre}`
      : sectorNombre;

    const origenBadge = ing.origen === 'receta' ? '📋' : ing.origen === 'ingreso_manual' ? '✋' : '📋✋';

    // Lógica de Renderizado y Stock
    let stockMostrar = ing.stock_proyectado || ing.stock_actual; // Prioridad al proyectado
    let stockTooltip = 'Stock proyectado (Stock DB - Necesario)';
    let stockStyle = '';

    // Si backend no envía stock_proyectado (fallback), usar stock_actual
    if (ing.stock_proyectado !== undefined && ing.stock_proyectado !== null) {
      stockMostrar = ing.stock_proyectado;
      if (ing.stock_proyectado < 0) {
        stockStyle = 'color: #dc3545; font-weight: bold;'; // Rojo si es negativo
        stockTooltip += ' - ¡Stock Negativo!';
      }
    }

    tr.innerHTML = `
      <td style="padding: 8px; border: 1px solid #ddd;">${sectorDisplay}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">
        ${origenBadge} ${ing.nombre}
        <small style="display: block; color: #666;">${ing.unidad_medida}</small>
      </td>
      <td style="padding: 8px; border: 1px solid #ddd; text-align: right; ${stockStyle}" title="${stockTooltip}">${stockMostrar.toFixed(3)}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">
        <div class="ajuste-container" style="display: flex; align-items: center; gap: 8px;">
          <label style="display: flex; align-items: center; cursor: pointer; font-size: 12px;">
            <input type="checkbox" 
                   class="checkbox-ajuste" 
                   data-ingrediente-id="${ing.id}"
                   style="margin-right: 4px;">
            Ajustar
          </label>
          <input type="number" min="0" step="0.001" 
                 placeholder="${stockMostrar.toFixed(3)}"
                 value="${stockMostrar.toFixed(3)}"
                 data-id="${ing.id}" 
                 class="input-ajuste" 
                 style="width: 100px; padding: 4px; background-color: #f5f5f5;"
                 disabled
                 title="Valor sugerido: ${stockMostrar.toFixed(3)} (Stock Proyectado)">
        </div>
      </td>
      <td style="padding: 8px; border: 1px solid #ddd;">
        <button data-id="${ing.id}" 
                data-nombre="${ing.nombre}" 
                class="btn-imprimir-etiqueta btn btn-sm btn-info"
                style="padding: 4px 8px; font-size: 12px;">
          🏷️ Etiqueta
        </button>
      </td>
    `;

    tablaBody.appendChild(tr);
  });

  // Agregar event listeners a los botones de imprimir
  tablaBody.querySelectorAll('.btn-imprimir-etiqueta').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const nombre = btn.getAttribute('data-nombre');
      imprimirEtiqueta(id, nombre);
    });
  });

  // Agregar event listeners a los checkboxes de ajuste
  tablaBody.querySelectorAll('.checkbox-ajuste').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      toggleAjusteIngrediente(e.target);
    });
  });

  console.log(`✅ [GUARDADO] Tabla renderizada con ${ingredientes.ingredientes.length} ingredientes`);
}

async function imprimirEtiqueta(ingredienteId, nombre) {
  try {
    console.log(`🏷️ [GUARDADO] Imprimiendo etiqueta: ${nombre} (ID: ${ingredienteId})`);

    // 🔍 DIAGNÓSTICO: Buscar el código de barras y sector del ingrediente
    // Usamos toString() para asegurar coincidencia de tipos
    const ingredienteData = ingredientes.ingredientes?.find(ing => ing.id.toString() === ingredienteId.toString());

    // 1. Definir CÓDIGO (Prioridad: ingredienteData.codigo > ingredienteId)
    let codigoBarras = ingredienteId.toString();
    if (ingredienteData && ingredienteData.codigo) {
      codigoBarras = ingredienteData.codigo;
    }

    // 2. Definir NOMBRE (Prioridad: ingredienteData.nombre > parámetro nombre)
    let nombreFinal = nombre;
    if (ingredienteData && ingredienteData.nombre) {
      nombreFinal = ingredienteData.nombre;
    }

    // 3. Definir SECTOR (MOLDE EXACTO: src/produccion/js/ingresoManual.js)
    let sectorLetter = '';

    if (ingredienteData) {
      console.log(`🔍 [DEBUG SECTOR] Raw Data:`, {
        sector_id: ingredienteData.sector_id,
        sector_nombre: ingredienteData.sector_nombre,
        sector_descripcion: ingredienteData.sector_descripcion
      });

      // Lógica clonada de ingresoManual.js: 
      if (ingredienteData.sector_descripcion) {
        const match = ingredienteData.sector_descripcion.match(/"([^"]+)"/);
        if (match && match[1]) {
          sectorLetter = match[1];
          console.log(`✅ [DEBUG SECTOR] Letra encontrada en descripcion: ${sectorLetter}`);
        }
      }

      // Fallback: Si no hay descripcion o no tiene comillas, buscar en sector_nombre si es corto ("Sector A")
      // IMPORTANTE: Evitar "FRUTOS SECOS FRACCIONES"
      if (!sectorLetter && ingredienteData.sector_nombre) {
        const matchNombre = ingredienteData.sector_nombre.match(/Sector\s*["']?([A-Z0-9]{1,2})["']?/i);
        if (matchNombre && matchNombre[1]) {
          sectorLetter = matchNombre[1];
          console.log(`✅ [DEBUG SECTOR] Letra encontrada en nombre: ${sectorLetter}`);
        } else {
          // Último recurso: si el nombre es SOLO la letra (length <= 2)
          const clean = ingredienteData.sector_nombre.replace(/Sector\s*/i, '').replace(/["']/g, '').trim();
          if (clean.length <= 2) {
            sectorLetter = clean;
            console.log(`✅ [DEBUG SECTOR] Letra encontrada (clean): ${sectorLetter}`);
          }
        }
      }
    }

    if (!ingredienteData) {
      console.warn(`⚠️ [ETIQUETA-DEBUG] No se encontraron datos completos para ingrediente ${ingredienteId}`);
    }

    console.log(`🔍 [ETIQUETA-DEBUG] Datos finales para impresión:`);
    console.log(`- Nombre: ${nombreFinal}`);
    console.log(`- Código: ${codigoBarras}`);
    console.log(`- Sector: ${sectorLetter} (Original Nombre: ${ingredienteData?.sector_nombre}, Desc: ${ingredienteData?.sector_descripcion})`);

    // Llamar al endpoint de impresión con todos los datos requeridos
    const response = await fetch('http://localhost:3000/api/etiquetas/ingrediente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: nombreFinal,
        codigo: codigoBarras,
        sector: sectorLetter,   // ✅ Enviar letra del sector (o vacío si no se pudo extraer una válida)
        cantidad: 1             // ✅ Enviar cantidad = 1 (bulto)
      })
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }

    console.log(`✅ [GUARDADO] Etiqueta enviada a imprimir: ${nombreFinal} con código ${codigoBarras}`);
    alert(`✅ Etiqueta de "${nombreFinal}" enviada a imprimir correctamente\nCódigo: ${codigoBarras}\nSector: ${sectorLetter || 'N/A'}`);
  } catch (error) {
    console.error('❌ [GUARDADO] Error al imprimir etiqueta:', error);
    alert('❌ Error al imprimir etiqueta: ' + error.message);
  }
}

async function imprimirTodasEtiquetas() {
  if (!ingredientes.ingredientes || ingredientes.ingredientes.length === 0) {
    alert('No hay ingredientes para imprimir');
    return;
  }

  console.log(`🏷️ [GUARDADO] Imprimiendo todas las etiquetas (${ingredientes.ingredientes.length})`);

  let exitosas = 0;
  let errores = 0;

  for (const ing of ingredientes.ingredientes) {
    try {
      await imprimirEtiqueta(ing.id, ing.nombre);
      exitosas++;
      // Pequeña pausa entre impresiones para no saturar el servidor
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`❌ Error imprimiendo ${ing.nombre}:`, error);
      errores++;
    }
  }

  alert(`🏷️ Impresión completada:\n✅ Exitosas: ${exitosas}\n❌ Errores: ${errores}`);
}

// Función para habilitar/deshabilitar el input de ajuste según el checkbox
function toggleAjusteIngrediente(checkbox) {
  const ingredienteId = checkbox.getAttribute('data-ingrediente-id');
  const inputAjuste = checkbox.closest('tr').querySelector('.input-ajuste');

  if (checkbox.checked) {
    // Habilitar el input y cambiar estilos
    inputAjuste.disabled = false;
    inputAjuste.style.backgroundColor = '#ffffff';
    inputAjuste.focus();
    console.log(`✅ [AJUSTE] Habilitado ajuste para ingrediente ${ingredienteId}`);
  } else {
    // Deshabilitar el input, limpiar valor y cambiar estilos
    inputAjuste.disabled = true;
    inputAjuste.value = '';
    inputAjuste.style.backgroundColor = '#f5f5f5';
    console.log(`❌ [AJUSTE] Deshabilitado ajuste para ingrediente ${ingredienteId}`);
  }
}

async function guardarAjustes() {
  // Solo procesar ingredientes que tienen el checkbox marcado
  const checkboxesMarcados = tablaBody.querySelectorAll('.checkbox-ajuste:checked');
  const ajustes = [];

  console.log(`🔍 [GUARDADO] Procesando ${checkboxesMarcados.length} ingredientes seleccionados para ajuste`);

  checkboxesMarcados.forEach(checkbox => {
    const fila = checkbox.closest('tr');
    const inputAjuste = fila.querySelector('.input-ajuste');
    const ingredienteId = checkbox.getAttribute('data-ingrediente-id');
    const cantidad = parseFloat(inputAjuste.value);

    if (!isNaN(cantidad) && cantidad >= 0) {
      ajustes.push({
        articulo_numero: ingredienteId,
        usuario_id: usuarioIdGlobal,
        carro_id: carroIdGlobal, // 🔧 CORRECCIÓN: Incluir carro_id en el payload
        tipo: 'ajuste puntual',
        kilos: cantidad,
        cantidad: Math.abs(cantidad), // Para compatibilidad con el endpoint
        observacion: `Ajuste manual selectivo desde guardado de ingredientes - Carro #${carroIdGlobal}`
      });
      console.log(`📝 [GUARDADO] Agregado ajuste: Ingrediente ${ingredienteId} → ${cantidad}kg - Carro: ${carroIdGlobal}`);
    } else {
      console.warn(`⚠️ [GUARDADO] Valor inválido para ingrediente ${ingredienteId}: ${inputAjuste.value}`);
    }
  });

  if (ajustes.length === 0) {
    alert('ℹ️ No hay ajustes válidos para guardar.\n\n💡 Asegúrese de:\n• Marcar los checkboxes de los ingredientes a ajustar\n• Ingresar valores numéricos válidos');
    return;
  }

  // Mostrar confirmación con resumen
  const resumen = ajustes.map(a => `• Ingrediente ${a.articulo_numero}: ${a.kilos}kg`).join('\n');
  const confirmar = confirm(`🔄 ¿Confirmar ajustes selectivos?\n\n📊 Se ajustarán ${ajustes.length} ingredientes:\n\n${resumen}\n\n⚠️ Esta acción modificará el stock actual.`);

  if (!confirmar) {
    console.log('❌ [GUARDADO] Usuario canceló los ajustes');
    return;
  }

  try {
    console.log(`💾 [GUARDADO] Guardando ${ajustes.length} ajustes selectivos...`);

    const response = await fetch('http://localhost:3002/api/produccion/ingredientes-ajustes/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ajustes })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Error ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ [GUARDADO] Ajustes selectivos guardados:', result);

    alert(`✅ Ajustes selectivos guardados correctamente!\n\n📊 ${result.ajustes_aplicados} ingredientes actualizados\n🎯 Solo se modificaron los ingredientes seleccionados`);
    cerrarModal();
  } catch (error) {
    console.error('❌ [GUARDADO] Error al guardar ajustes selectivos:', error);
    alert('❌ Error al guardar ajustes: ' + error.message);
  }
}
