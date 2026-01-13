/**
 * ============================================================================
 * MÓDULO: CONFIGURACIÓN DE PERIODOS (V4-STYLED)
 * ============================================================================
 * 
 * Gestiona la configuración de periodos y filtros globales.
 * Soporta 3 modos de operación:
 * A) Filtro Rápido (Solo Inicio -> Hasta Hoy)
 * B) Filtro Global (Inicio - Fin -> Rango específico)
 * C) Columna Personalizada (Agrega columna sin filtrar tabla)
 * 
 * @author Sistema LAMDA
 * @version 2.1.0
 */

class PeriodosConfig {
    constructor(dataFetcher, getTiposMovimiento, onPeriodosChange, onFiltroGlobalChange) {
        this.dataFetcher = dataFetcher;
        this.getTiposMovimiento = getTiposMovimiento;
        this.onPeriodosChange = onPeriodosChange;       // Callback para Modos C (Columnas)
        this.onFiltroGlobalChange = onFiltroGlobalChange; // Callback para Modos A/B (Filtros Globales)

        this.periodos = [];
        this.nextId = 1;

        // Estado UI
        this.mode = 'filter'; // 'filter' (A/B) or 'column' (C)

        // Elementos del DOM
        this.accordionHeader = null;
        this.accordionContent = null;
        this.periodosLista = null;
    }

    /**
     * Inicializar el módulo
     */
    init() {
        console.log('📅 [PERIODOS-CONFIG] Inicializando módulo V2.1...');

        // 1. Obtener contenedores base
        this.accordionHeader = document.getElementById('accordion-periodos-header');
        this.accordionContent = document.getElementById('accordion-periodos-content');
        this.periodosLista = document.getElementById('periodos-lista');

        if (!this.accordionHeader || !this.accordionContent) {
            console.error('❌ [PERIODOS-CONFIG] Elementos base no encontrados');
            return;
        }

        // 2. Inyectar nueva estructura de controles
        this.injectControls();

        // 3. Configurar listeners
        this.setupEventListeners();

        console.log('✅ [PERIODOS-CONFIG] Módulo inicializado');
    }

    /**
     * Inyectar HTML de controles con Estilos Locales
     */
    injectControls() {
        // Buscamos el contenedor de formulario existente o lo limpiamos
        let formContainer = this.accordionContent.querySelector('.periodo-form');
        if (!formContainer) {
            formContainer = document.createElement('div');
            formContainer.className = 'periodo-form';
            // Safer to just prepend
            this.accordionContent.prepend(formContainer);
        }

        // Inyectamos estilos locales (Scoped-ish)
        const styles = `
            <style>
                .periodo-form {
                    padding: 15px;
                    background-color: #f9f9f9;
                    border-bottom: 1px solid #eee;
                }
                .p-mode-selector {
                    display: flex;
                    gap: 15px;
                    margin-bottom: 15px;
                    padding-bottom: 10px;
                    border-bottom: 1px solid #e0e0e0;
                }
                .p-radio-group {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    cursor: pointer;
                    font-size: 0.9rem;
                    color: var(--text-primary);
                }
                .p-row {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 10px;
                }
                .p-col {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                }
                .p-label {
                    font-size: 0.8rem;
                    font-weight: 600;
                    color: var(--text-secondary);
                    margin-bottom: 4px;
                }
                .p-input, .p-select {
                    padding: 8px;
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    font-size: 0.9rem;
                    width: 100%;
                    box-sizing: border-box; /* Critical for layout */
                }
                .p-hint {
                    font-size: 0.75rem;
                    color: #888;
                    text-align: center;
                    margin-top: 5px;
                    display: block;
                }
                .hidden {
                    display: none !important;
                }
                .btn-action-primary {
                    background-color: var(--primary-color);
                    color: white;
                    border: none;
                    padding: 10px;
                    width: 100%;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: 600;
                    transition: background 0.2s;
                }
                .btn-action-primary:hover {
                    background-color: var(--primary-dark);
                }
                .btn-action-success {
                    background-color: var(--success-color); /* Green */
                    color: white; 
                    border: none;
                    padding: 10px;
                    width: 100%;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: 600;
                    transition: background 0.2s;
                }
                .btn-action-success:hover {
                    background-color: #219653;
                }
            </style>
        `;

        formContainer.innerHTML = styles + `
            <!-- SELECTOR DE MODO -->
            <div class="p-mode-selector">
                <label class="p-radio-group">
                    <input type="radio" name="periodoMode" id="modeFilter" value="filter" checked>
                    <span>Filtro Tabla (Global)</span>
                </label>
                <label class="p-radio-group">
                    <input type="radio" name="periodoMode" id="modeColumn" value="column">
                    <span>Nueva Columna</span>
                </label>
            </div>

            <!-- FILAS DE INPUTS -->
            
            <!-- Fila 1: Nombre -->
            <div class="p-row" id="groupNombre">
                <div class="p-col">
                    <label class="p-label" id="lbl-nombre">Nombre (Opcional)</label>
                    <input type="text" class="p-input" id="periodo-nombre" placeholder="Ej: Enero 2024">
                </div>
            </div>

            <!-- Fila 2: Fechas -->
            <div class="p-row">
                <div class="p-col">
                    <label class="p-label">Desde *</label>
                    <input type="date" class="p-input" id="periodo-fecha-inicio">
                </div>
                <div class="p-col">
                    <label class="p-label">Hasta</label>
                    <input type="date" class="p-input" id="periodo-fecha-fin">
                </div>
            </div>

            <!-- Fila 3: Métrica (Solo Columna) -->
            <div class="p-row hidden" id="groupMetric">
                <div class="p-col">
                    <label class="p-label">Dato a mostrar</label>
                    <select class="p-select" id="periodo-metrica">
                        <option value="balance">⚖️ Balance Neto (Producido)</option>
                        <option value="ingresos">📥 Ingresos</option>
                        <option value="salidas">📤 Salidas</option>
                        <option value="ajustes_pos">➕ Ajustes Positivos</option>
                        <option value="ajustes_neg">➖ Ajustes Negativos</option>
                    </select>
                </div>
            </div>

            <!-- Botón Acción -->
            <div class="p-row" style="margin-top: 10px;">
                <div class="p-col">
                    <button class="btn-action-primary" id="btn-accion-periodo">
                        Aplicar Filtro
                    </button>
                    <small class="p-hint" id="hint-text">
                        Si "Hasta" está vacío, filtra hasta hoy.
                    </small>
                </div>
            </div>
        `;

        // Referencias a elementos
        this.radioFilter = document.getElementById('modeFilter');
        this.radioColumn = document.getElementById('modeColumn');
        this.inputNombre = document.getElementById('periodo-nombre');
        this.lblNombre = document.getElementById('lbl-nombre');
        this.inputFechaInicio = document.getElementById('periodo-fecha-inicio');
        this.inputFechaFin = document.getElementById('periodo-fecha-fin');
        this.selectMetrica = document.getElementById('periodo-metrica');
        this.groupMetric = document.getElementById('groupMetric');
        this.btnAccion = document.getElementById('btn-accion-periodo');
        this.hintText = document.getElementById('hint-text');
    }

    /**
     * Configurar Listeners
     */
    setupEventListeners() {
        // Toggle Acordeón
        this.accordionHeader.addEventListener('click', () => {
            this.accordionHeader.classList.toggle('active');
            this.accordionContent.classList.toggle('active');
        });

        // Cambio de Modo
        const handleModeChange = () => {
            this.mode = this.radioFilter.checked ? 'filter' : 'column';
            this.updateUIForMode();
        };
        this.radioFilter.addEventListener('change', handleModeChange);
        this.radioColumn.addEventListener('change', handleModeChange);

        // Botón Acción
        this.btnAccion.addEventListener('click', () => this.ejecutarAccion());
    }

    /**
     * Actualizar UI según modo seleccionado
     */
    updateUIForMode() {
        if (this.mode === 'filter') {
            // === MODO FILTRO (A/B) ===
            this.groupMetric.classList.add('hidden');

            this.lblNombre.textContent = "Nombre del Filtro (Opcional)";
            this.inputNombre.placeholder = "Ej: Primer Semestre";

            this.btnAccion.textContent = "Aplicar Filtro Global";
            this.btnAccion.className = 'btn-action-primary'; // Blue styling

            this.hintText.textContent = 'Si "Hasta" está vacío, filtra hasta la fecha actual.';
            this.hintText.classList.remove('hidden');

        } else {
            // === MODO COLUMNA (C) ===
            this.groupMetric.classList.remove('hidden');

            this.lblNombre.textContent = "Nombre de Columna *";
            this.inputNombre.placeholder = "Ej: Comparativa Enero";

            this.btnAccion.textContent = "Agregar Columna";
            this.btnAccion.className = 'btn-action-success'; // Green styling

            this.hintText.classList.add('hidden');
        }
    }

    /**
     * Ejecutar acción principal
     */
    async ejecutarAccion() {
        const nombre = this.inputNombre.value.trim();
        const inicio = this.inputFechaInicio.value;
        const fin = this.inputFechaFin.value;

        if (!inicio) {
            alert('⚠️ Debes seleccionar al menos una Fecha de Inicio.');
            return;
        }

        if (this.mode === 'filter') {
            // === MODO A/B: FILTRO GLOBAL ===
            const descripcion = nombre || (fin ? `${this.formatearFechaCorta(inicio)} - ${this.formatearFechaCorta(fin)}` : `Desde ${this.formatearFechaCorta(inicio)}`);

            console.log(`📅 [PERIODOS] Aplicando Filtro Global: ${descripcion}`);

            if (this.onFiltroGlobalChange) {
                this.onFiltroGlobalChange({
                    desde: inicio,
                    hasta: fin || null,
                    descripcion: descripcion
                });
            }

            // Opcional: Colapsar acordeón al aplicar
            // this.accordionHeader.classList.remove('active');
            // this.accordionContent.classList.remove('active');

        } else {
            // === MODO C: NUEVA COLUMNA ===
            if (!fin) {
                alert('⚠️ Para columnas, se requiere fecha de inicio y fin.');
                return;
            }
            if (!nombre) {
                alert('⚠️ Ponle un nombre corto a la columna (ej: "S1").');
                return;
            }

            await this.agregarColumnaPersonalizada(nombre, inicio, fin);
        }
    }

    /**
     * Lógica para agregar columna personalizada (Modo C)
     */
    async agregarColumnaPersonalizada(nombre, inicio, fin) {
        const metrica = this.selectMetrica.value;
        const metricaTexto = this.selectMetrica.options[this.selectMetrica.selectedIndex].text;
        // Limpiamos emojis del texto para el header
        const cleanMetricaLabel = metricaTexto.replace(/⚖️|📥|📤|➕|➖/g, '').trim();

        // Estado UI: Cargando
        const originalText = this.btnAccion.textContent;
        this.btnAccion.disabled = true;
        this.btnAccion.textContent = 'Cargando...';

        try {
            // 1. Obtener datos (fetch backend)
            // Usamos null en tipos para traer todo y filtrar en memoria si fuese necesario,
            // pero DataFetcher ya filtra si se lo pasamos.
            const tiposMovimiento = this.getTiposMovimiento ? this.getTiposMovimiento() : null;

            const respuesta = await this.dataFetcher.obtenerProduccionPorPeriodo(inicio, fin, tiposMovimiento);

            // 2. Crear objeto Periodo/Columna
            const nuevaColumna = {
                id: this.nextId++,
                nombre: `${nombre} (${cleanMetricaLabel})`,
                fechaInicio: inicio,
                fechaFin: fin,
                datos: respuesta.data,
                metricaObjetivo: metrica,
                seleccionado: true,
                esColumnaCustom: true
            };

            this.periodos.push(nuevaColumna);
            this.renderPeriodoItem(nuevaColumna);

            // 3. Notificar cambios
            if (this.onPeriodosChange) {
                this.onPeriodosChange(this.periodos);
            }

            // Reset Form
            this.inputNombre.value = '';
            console.log(`✅ [PERIODOS] Columna agregada: ${nuevaColumna.nombre}`);

        } catch (error) {
            console.error('Error al agregar columna:', error);
            alert('Error: ' + error.message);
        } finally {
            this.btnAccion.disabled = false;
            this.btnAccion.textContent = originalText;
        }
    }

    /**
     * Renderizar item en la lista (para poder borrarlo)
     */
    renderPeriodoItem(periodo) {
        const div = document.createElement('div');
        div.className = 'periodo-item';
        div.dataset.id = periodo.id;
        div.innerHTML = `
            <div class="periodo-info">
                <strong>${periodo.nombre}</strong><br>
                <small>${this.formatearFechaCorta(periodo.fechaInicio)} - ${this.formatearFechaCorta(periodo.fechaFin)}</small>
            </div>
            <button class="btn-eliminar-periodo" title="Eliminar columna">×</button>
        `;

        // Listener borrar
        div.querySelector('button').addEventListener('click', () => {
            this.eliminarPeriodo(periodo.id);
        });

        this.periodosLista.appendChild(div);
    }

    eliminarPeriodo(id) {
        if (!confirm('¿Eliminar esta columna comparativa?')) return;

        this.periodos = this.periodos.filter(p => p.id !== id);
        this.periodosLista.querySelector(`[data-id="${id}"]`)?.remove();

        if (this.onPeriodosChange) {
            this.onPeriodosChange(this.periodos);
        }
    }

    formatearFechaCorta(f) {
        if (!f) return '-';
        // Asume YYYY-MM-DD
        const parts = f.split('-');
        if (parts.length < 3) return f;
        return `${parts[2]}/${parts[1]}/${parts[0].slice(2)}`; // DD/MM/YY
    }

    getPeriodosSeleccionados() {
        return this.periodos.filter(p => p.seleccionado);
    }
}

window.PeriodosConfig = PeriodosConfig;
