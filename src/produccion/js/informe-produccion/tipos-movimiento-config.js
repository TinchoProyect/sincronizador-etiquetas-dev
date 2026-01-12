/**
 * ============================================================================
 * MÓDULO: CONFIGURACIÓN DE TIPOS DE MOVIMIENTO
 * ============================================================================
 * 
 * Gestiona la selección de tipos de movimiento para filtrar los datos
 * del informe de producción interna.
 * 
 * Funcionalidades:
 * - Checkboxes para seleccionar tipos de movimiento (Inc. Ajustes + y -)
 * - Configuración de Balance Neto personalizado
 * - Comunicación con módulo principal para actualizar datos
 * 
 * @author Sistema LAMDA
 * @version 2.0.0
 */

class TiposMovimientoConfig {
    constructor(onTiposChange, onBalanceConfigChange) {
        this.onTiposChange = onTiposChange; // Callback para notificar cambios de filtros
        this.onBalanceConfigChange = onBalanceConfigChange; // Callback para configuración de balance

        // 1. FILTROS DE MOVIMIENTO (Controlan qué columnas se ven)
        // Nota: 'valor' es lo que se envía al backend. Ajuste (+) y (-) envían lo mismo, el backend devuelve todo, el frontend filtra columnas.
        this.tiposDisponibles = [
            { id: 'salidas', nombre: 'Salidas', valor: 'salida a ventas', checked: true },
            { id: 'ingresos', nombre: 'Ingresos', valor: 'ingreso a producción', checked: true },
            { id: 'ajustes_pos', nombre: 'Ajustes (+)', valor: 'registro de ajuste', checked: false },
            { id: 'ajustes_neg', nombre: 'Ajustes (-)', valor: 'registro de ajuste', checked: false }
        ];

        // 2. CONFIGURACIÓN DE BALANCE (Qué se suma/resta)
        this.balanceConfig = {
            mostrar: false,
            componentes: {
                ingresos: true,     // Suma
                salidas: true,      // Resta
                ajustes_pos: true,  // Suma
                ajustes_neg: true   // Resta
            }
        };

        // Elementos del DOM
        this.accordionHeader = null;
        this.accordionContent = null;
        this.checkboxesContainer = null;
    }

    /**
     * Inicializar el módulo
     */
    init() {
        console.log('🔍 [TIPOS-MOVIMIENTO] Inicializando módulo V4...');

        // Obtener elementos del DOM
        this.accordionHeader = document.getElementById('accordion-tipos-header');
        this.accordionContent = document.getElementById('accordion-tipos-content');
        this.checkboxesContainer = document.getElementById('tipos-checkboxes');

        if (!this.accordionHeader || !this.accordionContent || !this.checkboxesContainer) {
            console.error('❌ [TIPOS-MOVIMIENTO] No se encontraron elementos necesarios');
            return;
        }

        // Renderizar todo
        this.renderizarUI();

        // Configurar event listeners globales delegados (más eficiente)
        this.setupEventListeners();

        console.log('✅ [TIPOS-MOVIMIENTO] Módulo inicializado');
    }

    /**
     * Renderizar la UI completa
     */
    renderizarUI() {
        this.checkboxesContainer.innerHTML = '';

        // --- SECCIÓN 1: FILTROS DE MOVIMIENTO ---
        const filtrosHeader = document.createElement('div');
        filtrosHeader.className = 'menu-section-title';
        filtrosHeader.style.padding = '5px 10px';
        filtrosHeader.textContent = 'FILTRAR COLUMNAS';
        this.checkboxesContainer.appendChild(filtrosHeader);

        this.tiposDisponibles.forEach(tipo => {
            const row = this.crearCheckboxRow(
                `tipo-${tipo.id}`,
                tipo.nombre,
                tipo.checked,
                'tipo-movimiento',
                { tipoId: tipo.id }
            );
            this.checkboxesContainer.appendChild(row);
        });

        // Separador
        const hr = document.createElement('hr');
        hr.style.margin = '15px 0 10px 0';
        hr.style.border = '0';
        hr.style.borderTop = '1px solid var(--border-color)';
        this.checkboxesContainer.appendChild(hr);

        this.emiteEstadoInicial(); // Emitir estado inicial con defaults

        // --- SECCIÓN 2: CONFIGURADOR DE BALANCE ---
        const balanceHeader = document.createElement('div');
        balanceHeader.className = 'menu-section-title';
        balanceHeader.style.padding = '5px 10px';
        balanceHeader.style.color = 'var(--primary-color)';
        balanceHeader.textContent = 'CONFIGURAR BALANCE';
        this.checkboxesContainer.appendChild(balanceHeader);

        // Toggle Principal (Activar Balance)
        const toggleBalance = this.crearCheckboxRow(
            'check-balance-main',
            'Mostrar Columna de Balance',
            this.balanceConfig.mostrar,
            'balance-main',
            {},
            true // Bold
        );
        this.checkboxesContainer.appendChild(toggleBalance);

        // Sub-opciones (Indentadas)
        const componentesContainer = document.createElement('div');
        componentesContainer.id = 'balance-components';
        componentesContainer.style.paddingLeft = '20px';
        componentesContainer.style.display = this.balanceConfig.mostrar ? 'block' : 'none';

        // Checkboxes de composición
        const comps = [
            { key: 'ingresos', label: '(+) Ingresos' },
            { key: 'salidas', label: '(-) Salidas' },
            { key: 'ajustes_pos', label: '(+) Ajustes (+)' },
            { key: 'ajustes_neg', label: '(-) Ajustes (-)' }
        ];

        comps.forEach(c => {
            const compRow = this.crearCheckboxRow(
                `balance-comp-${c.key}`,
                c.label,
                this.balanceConfig.componentes[c.key],
                'balance-comp',
                { compKey: c.key }
            );
            componentesContainer.appendChild(compRow);
        });

        this.checkboxesContainer.appendChild(componentesContainer);
    }

    /**
     * Helper para crear filas de checkbox
     */
    crearCheckboxRow(id, label, checked, className, dataAttrs = {}, isBold = false) {
        const div = document.createElement('div');
        div.className = 'checkbox-item';

        let dataStr = '';
        for (const [k, v] of Object.entries(dataAttrs)) {
            dataStr += ` data-${k}="${v}"`;
        }

        div.innerHTML = `
            <label class="checkbox-label" style="${isBold ? 'font-weight:700; color:var(--primary-color);' : ''}">
                <input type="checkbox" id="${id}" class="${className}" ${checked ? 'checked' : ''} ${dataStr}>
                <span>${label}</span>
            </label>
        `;
        return div;
    }

    /**
     * Configurar Listeners
     */
    setupEventListeners() {
        // Acordeón
        this.accordionHeader.addEventListener('click', () => {
            this.accordionHeader.classList.toggle('active');
            this.accordionContent.classList.toggle('active');
        });

        // Delegación de eventos para checkboxes
        this.checkboxesContainer.addEventListener('change', (e) => {
            const target = e.target;

            if (target.classList.contains('tipo-movimiento')) {
                this.handleTipoChange(target);
            } else if (target.classList.contains('balance-main')) {
                this.handleBalanceMainChange(target);
            } else if (target.classList.contains('balance-comp')) {
                this.handleBalanceCompChange(target);
            }
        });
    }

    /**
     * Manejadores de eventos
     */
    handleTipoChange(checkbox) {
        const tipoId = checkbox.dataset.tipoId;
        const tipo = this.tiposDisponibles.find(t => t.id === tipoId);
        if (tipo) tipo.checked = checkbox.checked; // Fix: tipo, not type

        // Validar: Al menos uno seleccionado? No estricto, pero recomendable.
        // Recopilar valores únicos para backend
        // Ajustes (+) y (-) usan el mismo valor de backend 'registro de ajuste'.
        // Solo necesitamos enviarlo una vez si alguno de los dos está activo.

        const backendTipos = new Set();
        this.tiposDisponibles.filter(t => t.checked).forEach(t => backendTipos.add(t.valor));

        const tiposArray = Array.from(backendTipos);

        if (tiposArray.length === 0) {
            // alert('Se recomienda seleccionar al menos un tipo.');
        }

        // Notificar cambios: Enviamos AMBOS: la lista de valores backend Y el estado detallado de UI
        // El main.js usará valores backend para fetch, y TableManager usará estado UI para columnas.
        if (this.onTiposChange) {
            this.onTiposChange({
                backendValues: tiposArray,
                uiState: this.tiposDisponibles.reduce((acc, t) => { acc[t.id] = t.checked; return acc; }, {})
            });
        }
    }

    handleBalanceMainChange(checkbox) {
        this.balanceConfig.mostrar = checkbox.checked;
        const container = document.getElementById('balance-components');
        if (container) container.style.display = checkbox.checked ? 'block' : 'none';

        this.notificarBalanceChange();
    }

    handleBalanceCompChange(checkbox) {
        const key = checkbox.dataset.compKey;
        this.balanceConfig.componentes[key] = checkbox.checked;
        this.notificarBalanceChange();
    }

    notificarBalanceChange() {
        if (this.onBalanceConfigChange) {
            this.onBalanceConfigChange(this.balanceConfig);
        }
    }

    // -- API Pública para Main.js --

    getTiposSeleccionados() {
        // Compatibilidad con fetcher existente
        const uniqueValues = new Set();
        this.tiposDisponibles.filter(t => t.checked).forEach(t => uniqueValues.add(t.valor));
        return Array.from(uniqueValues);
    }

    // Método legacy para compatibilidad
    getNombresSeleccionados() {
        return this.tiposDisponibles
            .filter(tipo => tipo.checked)
            .map(tipo => tipo.nombre);
    }

    getUIState() {
        return this.tiposDisponibles.reduce((acc, t) => { acc[t.id] = t.checked; return acc; }, {});
    }

    /**
     * Sincronizar desde TableManager
     */
    setExternalState(tipoId, checked) {
        const tipo = this.tiposDisponibles.find(t => t.id === tipoId);
        if (tipo && tipo.checked !== checked) {
            tipo.checked = checked;
            // Actualizar checkbox DOM si existe
            const checkbox = document.querySelector(`input[data-tipo-id="${tipoId}"]`);
            if (checkbox) checkbox.checked = checked;

            // 🔥 CRITICO: Disparar la lógica de cambio real (fetch de datos)
            // porque si oculto columna -> desmarco -> quiero dejar de traer datos (opcional)
            // O al menos, quiero que el sistema sepa que cambió el filtro.
            // Para evitar loops, usaremos handleTipoChange pero Main debe romper el loop si ya es igual.
            // Pero Main llama a TableManager.
            // TableManager tiene isUpdating.
            // Así que es SEGURO llamar a handleTipoChange aqui.
            this.handleTipoChange({ dataset: { tipoId }, checked });
        }
    }

    emiteEstadoInicial() {
        // Emitir tipos default
        const backendTipos = new Set();
        this.tiposDisponibles.filter(t => t.checked).forEach(t => backendTipos.add(t.valor));
        const tiposArray = Array.from(backendTipos);

        if (this.onTiposChange) {
            this.onTiposChange({
                backendValues: tiposArray,
                uiState: this.getUIState()
            });
        }

        // Emitir balance default
        this.notificarBalanceChange();
    }
}

// Exportar para uso global
window.TiposMovimientoConfig = TiposMovimientoConfig;
