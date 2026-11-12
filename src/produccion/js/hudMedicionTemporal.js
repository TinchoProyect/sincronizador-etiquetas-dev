/**
 * /js/hudMedicionTemporal.js
 * HUD Flotante para Medición de Métricas Temporales de Producción
 * 
 * - Arrastrable y dócil con boundary clamping (nunca se sale de pantalla)
 * - Minimizable a pastilla compacta
 * - No bloqueante (permite scrollear y ver ingredientes debajo)
 * - Timón de 3 Etapas Sincronizado con el Flujo Tradicional:
 *     Etapa 1: Preparación (Acarreo de insumos desde depósito a mesada)
 *              -> Botón "Carro listo para producir" (marca preparado y pasa a Etapa 2)
 *     Etapa 2: Producción Propiamente Dicha (Elaboración / Fraccionamiento)
 *              -> Botón "Imprimir Orden de Producción" integrado
 *              -> Botón "Asentar Producción y Pasar a Etiquetado" (asienta stock y pasa a Etapa 3)
 *     Etapa 3: Etiquetado, Guardado y Ajustes
 *              -> Botón "Imprimir Etiquetas con Lote"
 *              -> Botón "Guardado / Ajuste de Ingredientes"
 *              -> Botón "Finalizar Medición y Guardar Tiempos" (calcula prorrateo y guarda)
 * - Pausa/Reanudación acumulativa
 * - Rehidratación automática tras refresh
 */

class HudMedicionTemporal {
    constructor() {
        this.carroId = null;
        this.usuarioId = null;
        this.usuarioNombre = 'Operario';
        this.modoActivo = false;
        this.etapaActual = 0; // 0: no iniciada, 1: prep, 2: prod, 3: guardado, 4: finalizada
        this.carroAsentado = false;
        this.pausado = false;
        this.tiempoPausaMs = 0;
        this.acumuladoEtapaMs = 0;
        this.sincronizadoEnMs = Date.now();
        this.inicioTimestamp = null;
        this.timerInterval = null;
        this.minimizada = false;
        this.posicion = { x: null, y: null };
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this._ultimoCarroConsultadoFoto = null;
        this._modalFotoAbierto = false;

        this.init();
    }

    init() {
        this.leerColaborador();
        this.crearEstilos();
        this.crearElementoDOM();
        this.vincularEventosDrag();
        this.actualizarBotonToggleHeader();
    }

    leerColaborador() {
        try {
            const c = localStorage.getItem('colaboradorActivo');
            if (c) {
                const parsed = JSON.parse(c);
                this.usuarioId = parsed.id;
                this.usuarioNombre = parsed.nombre || parsed.nombre_completo || 'Operario';
            }
        } catch (e) {
            console.warn('[HUD-MEDICION] Error leyendo colaboradorActivo:', e);
        }
    }

    crearEstilos() {
        if (document.getElementById('hud-medicion-styles')) return;
        const style = document.createElement('style');
        style.id = 'hud-medicion-styles';
        style.textContent = `
            #hud-medicion-temporal {
                position: fixed;
                bottom: 24px;
                right: 24px;
                width: 350px;
                background: #1e293b;
                color: #f8fafc;
                border-radius: 12px;
                box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.1);
                z-index: 99999;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                user-select: none;
                transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s;
            }
            #hud-medicion-temporal.hud-minimizado {
                width: 240px;
            }
            #hud-medicion-temporal.hud-minimizado .hud-body {
                display: none;
            }
            .hud-header {
                padding: 10px 14px;
                background: #0f172a;
                border-top-left-radius: 12px;
                border-top-right-radius: 12px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: grab;
            }
            .hud-header:active {
                cursor: grabbing;
            }
            .hud-title {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                font-weight: 700;
                letter-spacing: 0.3px;
                color: #e2e8f0;
            }
            .hud-header-actions {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .hud-btn-icon {
                background: transparent;
                border: none;
                color: #94a3b8;
                cursor: pointer;
                padding: 4px 6px;
                border-radius: 4px;
                font-size: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.15s, color 0.15s;
            }
            .hud-btn-icon:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
            }
            .hud-body {
                padding: 14px;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .hud-stage-banner {
                padding: 8px 10px;
                border-radius: 8px;
                font-size: 12px;
                display: flex;
                flex-direction: column;
                gap: 2px;
                transition: background 0.2s;
            }
            .hud-stage-banner.stage-0 {
                background: rgba(148, 163, 184, 0.15);
                border-left: 4px solid #94a3b8;
                color: #cbd5e1;
            }
            .hud-stage-banner.stage-1 {
                background: rgba(234, 179, 8, 0.15);
                border-left: 4px solid #eab308;
                color: #fef08a;
            }
            .hud-stage-banner.stage-2 {
                background: rgba(59, 130, 246, 0.15);
                border-left: 4px solid #3b82f6;
                color: #bfdbfe;
            }
            .hud-stage-banner.stage-3 {
                background: rgba(168, 85, 247, 0.15);
                border-left: 4px solid #a855f7;
                color: #e9d5ff;
            }
            .hud-stage-banner.stage-4 {
                background: rgba(16, 185, 129, 0.15);
                border-left: 4px solid #10b981;
                color: #a7f3d0;
            }
            .hud-stage-title {
                font-weight: 700;
                font-size: 12px;
            }
            .hud-stage-desc {
                font-size: 11px;
                opacity: 0.9;
                line-height: 1.35;
            }
            .hud-timer-container {
                background: #090d16;
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 8px;
                padding: 10px;
                text-align: center;
            }
            .hud-timer-display {
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 32px;
                font-weight: 800;
                letter-spacing: 1px;
                color: #38bdf8;
                text-shadow: 0 0 12px rgba(56, 189, 248, 0.3);
            }
            .hud-timer-paused {
                color: #f59e0b !important;
                text-shadow: 0 0 12px rgba(245, 158, 11, 0.4) !important;
                animation: hudPulse 1.5s infinite;
            }
            @keyframes hudPulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.4; }
            }
            .hud-timer-sub {
                font-size: 10.5px;
                color: #64748b;
                margin-top: 2px;
            }
            .hud-btn-imprimir {
                width: 100%;
                padding: 9px 12px;
                color: #ffffff;
                border: none;
                border-radius: 8px;
                font-weight: 700;
                font-size: 12.5px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                transition: filter 0.15s, transform 0.1s;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
            }
            .hud-btn-imprimir:hover {
                filter: brightness(1.12);
            }
            .hud-btn-imprimir:active {
                transform: scale(0.98);
            }
            .hud-btn-orden {
                background: linear-gradient(135deg, #0284c7, #0369a1);
            }
            .hud-btn-lote {
                background: linear-gradient(135deg, #7c3aed, #6d28d9);
            }
            .hud-btn-guardado {
                background: linear-gradient(135deg, #059669, #047857);
            }
            .hud-main-action-btn {
                width: 100%;
                padding: 11px 16px;
                border: none;
                border-radius: 8px;
                font-weight: 700;
                font-size: 13.5px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                transition: background 0.2s, transform 0.1s;
                color: #ffffff;
            }
            .hud-main-action-btn:active {
                transform: scale(0.98);
            }
            .hud-btn-start {
                background: linear-gradient(135deg, #10b981, #059669);
            }
            .hud-btn-start:hover {
                background: linear-gradient(135deg, #059669, #047857);
            }
            .hud-btn-stage2 {
                background: linear-gradient(135deg, #3b82f6, #2563eb);
            }
            .hud-btn-stage2:hover {
                background: linear-gradient(135deg, #2563eb, #1d4ed8);
            }
            .hud-btn-stage3 {
                background: linear-gradient(135deg, #8b5cf6, #7c3aed);
            }
            .hud-btn-stage3:hover {
                background: linear-gradient(135deg, #7c3aed, #6d28d9);
            }
            .hud-btn-finish {
                background: linear-gradient(135deg, #10b981, #047857);
                box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
            }
            .hud-btn-finish:hover {
                background: linear-gradient(135deg, #059669, #047857);
            }
            .hud-btn-finish-ok {
                background: linear-gradient(135deg, #10b981, #059669) !important;
                color: white !important;
                cursor: pointer !important;
                box-shadow: 0 0 12px rgba(16, 185, 129, 0.4) !important;
            }
            .hud-btn-finish-ok:hover {
                background: linear-gradient(135deg, #059669, #047857) !important;
            }
            .hud-secondary-actions {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }
            .hud-sec-btn {
                padding: 7px 10px;
                background: #334155;
                color: #e2e8f0;
                border: none;
                border-radius: 6px;
                font-size: 11.5px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 5px;
                transition: background 0.15s;
            }
            .hud-sec-btn:hover {
                background: #475569;
            }
            .hud-sec-btn.btn-pausa-activa {
                background: #f59e0b;
                color: #000;
            }
            .hud-sec-btn.btn-cancelar:hover {
                background: #dc2626;
                color: white;
            }
            .hud-mini-indicator {
                display: none;
                padding: 6px 12px;
                align-items: center;
                justify-content: space-between;
                font-family: ui-monospace, monospace;
                font-size: 13px;
                font-weight: bold;
                color: #38bdf8;
                background: #090d16;
                border-bottom-left-radius: 12px;
                border-bottom-right-radius: 12px;
            }
            #hud-medicion-temporal.hud-minimizado .hud-mini-indicator {
                display: flex;
            }
        `;
        document.head.appendChild(style);
    }

    crearElementoDOM() {
        let el = document.getElementById('hud-medicion-temporal');
        if (el) el.remove();

        el = document.createElement('div');
        el.id = 'hud-medicion-temporal';
        el.style.display = 'none';

        el.innerHTML = `
            <div class="hud-header" id="hud-medicion-header">
                <div class="hud-title">
                    <span>⏱️ Métricas de Tiempo</span>
                    <span id="hud-badge-etapa" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.15); font-weight: normal;">Modo Espera</span>
                </div>
                <div class="hud-header-actions">
                    <button type="button" class="hud-btn-icon" id="hud-btn-minimize" title="Minimizar/Restaurar">➖</button>
                    <button type="button" class="hud-btn-icon" id="hud-btn-close-mode" title="Cerrar ventana">✖</button>
                </div>
            </div>

            <!-- Pastilla visible sólo cuando está minimizado -->
            <div class="hud-mini-indicator" id="hud-mini-indicator">
                <span id="hud-mini-etapa">E0</span>
                <span id="hud-mini-timer">00:00</span>
                <span id="hud-mini-pause-status" style="font-size: 11px;">▶️</span>
            </div>

            <div class="hud-body">
                <!-- Banner explicativo de la etapa -->
                <div class="hud-stage-banner stage-0" id="hud-stage-banner">
                    <span class="hud-stage-title" id="hud-stage-title">🎯 Listo para Medir</span>
                    <span class="hud-stage-desc" id="hud-stage-desc">Pulse el botón inferior para comenzar el alistamiento de insumos.</span>
                </div>

                <!-- Cronómetro Principal -->
                <div class="hud-timer-container">
                    <div class="hud-timer-display" id="hud-timer-clock">00:00</div>
                    <div class="hud-timer-sub" id="hud-timer-subtext">Tiempo neto transcurrido</div>
                </div>

                <!-- Botón rápido Imprimir Orden de Producción (visible en Etapa 2) -->
                <button type="button" class="hud-btn-imprimir hud-btn-orden" id="hud-btn-imprimir-orden" style="display: none;">
                    📄 Imprimir Orden de Producción
                </button>

                <!-- Botón rápido Imprimir Etiquetas con Lote (visible en Etapa 3) -->
                <button type="button" class="hud-btn-imprimir hud-btn-lote" id="hud-btn-imprimir-lote" style="display: none;">
                    🏷️ Imprimir Etiquetas con Lote
                </button>

                <!-- Botón rápido Guardado / Ajuste de Ingredientes (visible en Etapa 3) -->
                <button type="button" class="hud-btn-imprimir hud-btn-guardado" id="hud-btn-guardado-ingredientes" style="display: none;">
                    📦 Guardado / Ajuste Ingredientes
                </button>

                <!-- Botón Principal del Timón -->
                <button type="button" class="hud-main-action-btn hud-btn-start" id="hud-btn-main-action">
                    ▶️ Iniciar Preparación (Acarreo)
                </button>

                <!-- Botonera secundaria: Pausa y Cancelar -->
                <div class="hud-secondary-actions" id="hud-secondary-actions">
                    <button type="button" class="hud-sec-btn" id="hud-btn-pause">
                        ⏸️ Pausar
                    </button>
                    <button type="button" class="hud-sec-btn btn-cancelar" id="hud-btn-cancel">
                        ❌ Cancelar Medición
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(el);
        this.el = el;

        // Vínculos de botones
        document.getElementById('hud-btn-minimize').onclick = () => this.toggleMinimizar();
        document.getElementById('hud-btn-close-mode').onclick = () => this.ocultarHUD();
        document.getElementById('hud-btn-imprimir-orden').onclick = () => this.ejecutarImprimirOrden();
        document.getElementById('hud-btn-imprimir-lote').onclick = () => this.ejecutarImprimirLote();
        document.getElementById('hud-btn-guardado-ingredientes').onclick = () => this.ejecutarGuardadoIngredientes();
        document.getElementById('hud-btn-pause').onclick = () => this.togglePausa();
        document.getElementById('hud-btn-cancel').onclick = () => this.solicitarCancelar();
        document.getElementById('hud-btn-main-action').onclick = () => this.ejecutarAccionPrincipal();
    }

    vincularEventosDrag() {
        const header = document.getElementById('hud-medicion-header');
        if (!header) return;

        const onMouseDown = (e) => {
            if (e.target.closest('.hud-btn-icon')) return;

            this.isDragging = true;
            const rect = this.el.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;

            this.el.style.bottom = 'auto';
            this.el.style.right = 'auto';
            this.el.style.left = `${rect.left}px`;
            this.el.style.top = `${rect.top}px`;

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            if (!this.isDragging) return;

            let newX = e.clientX - this.dragOffset.x;
            let newY = e.clientY - this.dragOffset.y;

            const maxW = window.innerWidth - this.el.offsetWidth - 10;
            const maxH = window.innerHeight - this.el.offsetHeight - 10;

            newX = Math.max(10, Math.min(newX, maxW));
            newY = Math.max(10, Math.min(newY, maxH));

            this.el.style.left = `${newX}px`;
            this.el.style.top = `${newY}px`;
        };

        const onMouseUp = () => {
            this.isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        header.addEventListener('mousedown', onMouseDown);
    }

    toggleMinimizar() {
        this.minimizada = !this.minimizada;
        if (this.minimizada) {
            this.el.classList.add('hud-minimizado');
            document.getElementById('hud-btn-minimize').textContent = '➕';
        } else {
            this.el.classList.remove('hud-minimizado');
            document.getElementById('hud-btn-minimize').textContent = '➖';
        }
    }

    /**
     * Sincronizar y activar HUD con el carro actual
     */
    async activarParaCarro(carroId, opciones = {}) {
        if (!carroId) return;
        const cambioDeCarro = String(this.carroId) !== String(carroId);
        this.carroId = carroId;
        this.leerColaborador();

        if (cambioDeCarro && !opciones.silenciarModalFoto) {
            this._ultimoCarroConsultadoFoto = null;
        }

        try {
            const res = await fetch(`/api/tiempos/carro/${carroId}/estado-medicion?usuarioId=${this.usuarioId}`);
            if (!res.ok) throw new Error('No se pudo obtener estado de medición');
            const data = await res.json();

            // Si es carro externo, la medición de tiempos aplica únicamente a producción interna
            if (data.tipo_carro === 'externa') {
                const btnTopbar = document.getElementById('btn-topbar-modo-medicion');
                if (btnTopbar) btnTopbar.style.display = 'none';
                this.ocultarHUD();
                return;
            }

            this.modoActivo = !!data.modo_medicion;
            this.etapaActual = data.medicion_etapa_actual || 0;
            this.carroAsentado = !!data.asentado;
            this.pausado = !!data.medicion_pausada;
            this.tiempoPausaMs = Number(data.tiempo_pausa_ms || 0);
            this.acumuladoEtapaMs = Math.max(0, Number(data.etapa_actual_neto_ms || 0));
            this.sincronizadoEnMs = Date.now();

            // Sincronización inteligente con el estado físico tradicional:
            if (this.modoActivo) {
                if (data.asentado && this.etapaActual < 3) {
                    this.etapaActual = 3; // Ya fue asentado previamente: ubicar en etiquetado/guardado
                } else if (data.preparado && !data.asentado && this.etapaActual < 2) {
                    this.etapaActual = 2; // Ya fue preparado previamente: ubicar en producción directa
                }
            }

            if (this.etapaActual === 4) {
                // Medición ya finalizada: actualizar UI
                this.actualizarUIEtapa(data);
                // Si ya estaba finalizada antes de cargar, mantener oculta por defecto
                this.ocultarHUD();
            } else if (this.modoActivo) {
                this.mostrarHUD();
                this.actualizarUIEtapa(data);
                this.iniciarTickTimer();

                // Si el carro tiene una medición en curso (Etapas 1, 2 o 3) y fue dejada en pausa o proviene de una sesión anterior,
                // avisar al operario con la "Foto Temporal" y preguntarle si desea continuar o desechar la medición.
                const sesionConfirmada = sessionStorage.getItem(`medicionConfirmadaSesion_${carroId}`) === 'true';
                const requiereConsultaFoto = [1, 2, 3].includes(this.etapaActual) && (this.pausado || !sesionConfirmada) && this._ultimoCarroConsultadoFoto !== String(carroId);

                if (requiereConsultaFoto && !opciones.silenciarModalFoto && !this._modalFotoAbierto) {
                    this._ultimoCarroConsultadoFoto = String(carroId);
                    this.mostrarModalFotoTemporal(data);
                }
            } else {
                this.ocultarHUD();
            }

            this.actualizarBotonToggleHeader();
        } catch (err) {
            console.error('[HUD-MEDICION] Error al sincronizar:', err);
        }
    }

    /**
     * Al deseleccionar/cerrar el carro en la interfaz:
     * Si había una medición corriendo en vivo, la pone en pausa automáticamente para guardar la "Foto Temporal" en BD,
     * oculta el HUD y limpia la marca de sesión para que al volver a abrir el carro consulte si desea continuar o desechar.
     */
    async alDeseleccionarCarro() {
        const cId = this.carroId;
        if (cId) {
            sessionStorage.removeItem(`medicionConfirmadaSesion_${cId}`);
            if (this.modoActivo && [1, 2, 3].includes(this.etapaActual) && !this.pausado) {
                try {
                    await fetch(`/api/tiempos/carro/${cId}/pausa`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pausar: true, usuarioId: this.usuarioId })
                    });
                    console.log(`📸 [HUD-MEDICION] Foto temporal guardada automáticamente (Pausa activada) para Carro #${cId}`);
                } catch (e) {
                    console.warn('[HUD-MEDICION] No se pudo auto-pausar al deseleccionar carro:', e);
                }
            }
        }
        this._ultimoCarroConsultadoFoto = null;
        this.carroId = null;
        this.modoActivo = false;
        this.ocultarHUD();
        this.actualizarBotonToggleHeader();
    }

    /**
     * Modal de Retoma / Foto Temporal:
     * Informa que el carro tiene una medición iniciada y permite Continuar (congelando el tiempo de taller cerrado) o Desechar.
     */
    async mostrarModalFotoTemporal(data) {
        if (typeof Swal === 'undefined' || this._modalFotoAbierto) return;
        this._modalFotoAbierto = true;

        const nombresEtapa = {
            1: '🟡 Etapa 1: Preparación (Acarreo de Insumos)',
            2: '🔵 Etapa 2: Producción Propiamente Dicha',
            3: '🟣 Etapa 3: Etiquetado, Guardado y Ajustes'
        };
        const nombreEtapaActual = nombresEtapa[this.etapaActual] || `Etapa ${this.etapaActual}`;
        const tiempoEtapaStr = this.formatearMsHumano(this.acumuladoEtapaMs);
        const tiempoTotalStr = this.formatearMsHumano(Number(data.total_neto_acumulado_ms || this.acumuladoEtapaMs));
        const durE1Str = Number(data.etapa1_duracion_ms || 0) > 0 ? this.formatearMsHumano(Number(data.etapa1_duracion_ms)) : null;

        let fechaPausaStr = '';
        if (data.medicion_pausada && data.medicion_pausada_inicio) {
            try {
                fechaPausaStr = new Date(data.medicion_pausada_inicio).toLocaleString('es-AR', {
                    weekday: 'short',
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch (e) {}
        }

        try {
            const result = await Swal.fire({
                icon: 'info',
                title: `⏱️ Medición iniciada en Carro #${this.carroId}`,
                html: `
                    <div style="text-align: left; font-size: 13.5px; line-height: 1.5; background: #f8fafc; padding: 14px; border-radius: 10px; border: 1px solid #cbd5e1; color: #1e293b;">
                        <div style="margin-bottom: 8px; font-weight: 700; color: #0f172a;">
                            📸 Foto temporal guardada:
                        </div>
                        <div style="margin-bottom: 6px;">
                            • <strong>Etapa actual:</strong> ${nombreEtapaActual}
                        </div>
                        <div style="margin-bottom: 6px;">
                            • <strong>Tiempo neto en esta etapa:</strong> <span style="color: #0284c7; font-weight: 800; font-family: monospace; font-size: 14.5px;">${tiempoEtapaStr}</span>
                        </div>
                        ${this.etapaActual > 1 && durE1Str ? `
                        <div style="margin-bottom: 6px; color: #475569; font-size: 12.5px;">
                            • <strong>Etapa 1 (Preparación):</strong> ${durE1Str} &nbsp;|&nbsp; <strong>Total acumulado:</strong> ${tiempoTotalStr}
                        </div>` : ''}
                        ${fechaPausaStr ? `
                        <div style="margin-bottom: 4px; color: #b45309; font-size: 12.5px;">
                            • <strong>En pausa desde:</strong> ${fechaPausaStr}
                        </div>` : ''}
                    </div>
                    <p style="margin-top: 12px; margin-bottom: 0; font-size: 13.5px; color: #334155;">
                        ¿Querés <strong>continuar la medición</strong> desde donde quedó o <strong>desecharla</strong>?
                    </p>
                `,
                showDenyButton: true,
                showCancelButton: true,
                confirmButtonColor: '#10b981',
                denyButtonColor: '#dc2626',
                cancelButtonColor: '#64748b',
                confirmButtonText: '▶️ Continuar medición',
                denyButtonText: '🗑️ Desechar medición',
                cancelButtonText: '⏸️ Dejar en pausa por ahora',
                allowOutsideClick: false
            });

            if (result.isConfirmed) {
                // Continuar medición desde la foto temporal (congelando las horas en que estuvo cerrado)
                sessionStorage.setItem(`medicionConfirmadaSesion_${this.carroId}`, 'true');
                if (this.pausado) {
                    await fetch(`/api/tiempos/carro/${this.carroId}/pausa`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            pausar: false,
                            congelarPausa: true,
                            usuarioId: this.usuarioId
                        })
                    });
                }
                await this.activarParaCarro(this.carroId, { silenciarModalFoto: true });
            } else if (result.isDenied) {
                // Desechar medición sin afectar el carro
                await fetch(`/api/tiempos/carro/${this.carroId}/cancelar-medicion`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuarioId: this.usuarioId })
                });
                sessionStorage.removeItem(`medicionConfirmadaSesion_${this.carroId}`);
                this.modoActivo = false;
                this.etapaActual = 0;
                this.ocultarHUD();
                this.actualizarBotonToggleHeader();

                Swal.fire({
                    icon: 'info',
                    title: 'Medición desechada',
                    text: 'Se descartó el cronómetro de tiempos. El carro y sus artículos siguen listos para terminar de producir normalmente.',
                    timer: 2800,
                    showConfirmButton: false
                });
            } else {
                // Dejar en pausa por ahora: si no estaba en pausa en BD, ponerlo en pausa para congelar la foto temporal
                if (!this.pausado) {
                    await fetch(`/api/tiempos/carro/${this.carroId}/pausa`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pausar: true, usuarioId: this.usuarioId })
                    });
                }
                await this.activarParaCarro(this.carroId, { silenciarModalFoto: true });
            }
        } catch (err) {
            console.error('[HUD-MEDICION] Error en mostrarModalFotoTemporal:', err);
        } finally {
            this._modalFotoAbierto = false;
        }
    }

    mostrarHUD() {
        this.el.style.display = 'block';
    }

    ocultarHUD() {
        this.el.style.display = 'none';
        this.detenerTickTimer();
    }

    async toggleActivar() {
        const carroId = this.carroId || document.getElementById('workspace-container')?.dataset?.carroId || sessionStorage.getItem('carroActivo');
        if (!carroId) {
            Swal.fire({
                icon: 'info',
                title: 'Modo Medición',
                text: 'Selecciona o abre un carro de producción primero para activar la medición de tiempos.'
            });
            return;
        }
        this.carroId = carroId;

        // Si la medición ya finalizó (Etapa 4), alternar ver/ocultar ventana sin reiniciar
        if (this.etapaActual === 4) {
            if (this.el.style.display === 'none') {
                this.mostrarHUD();
            } else {
                this.ocultarHUD();
            }
            return;
        }

        // Si ya está activo en etapas 1, 2, 3: alternar visibilidad de la ventana (no destruye el cronómetro)
        if (this.modoActivo) {
            if (this.el.style.display === 'none') {
                this.mostrarHUD();
            } else {
                this.ocultarHUD();
            }
            return;
        }

        // Activar voluntariamente
        try {
            const res = await fetch(`/api/tiempos/carro/${carroId}/modo-medicion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activar: true, usuarioId: this.usuarioId })
            });

            if (!res.ok) throw new Error('Error al cambiar modo de medición');
            const data = await res.json();

            this.modoActivo = data.modo_medicion;
            if (this.modoActivo) {
                this.mostrarHUD();
                await this.activarParaCarro(carroId);
            } else {
                this.ocultarHUD();
            }

            this.actualizarBotonToggleHeader();
        } catch (e) {
            console.error('[HUD-MEDICION] Error en toggleActivar:', e);
            Swal.fire('Error', 'No se pudo conmutar el modo de medición', 'error');
        }
    }

    actualizarBotonToggleHeader() {
        const btnTopbar = document.getElementById('btn-topbar-modo-medicion');
        const btnLegacy = document.getElementById('btn-toggle-modo-medicion');
        const btnHeaderLegacy = document.getElementById('btn-header-modo-medicion');

        if (btnHeaderLegacy) {
            btnHeaderLegacy.remove();
        }
        if (btnLegacy) {
            btnLegacy.style.display = 'none';
        }

        if (btnTopbar) {
            btnTopbar.style.display = 'inline-flex';
            if (this.etapaActual === 4) {
                btnTopbar.className = 'topbar-btn-medicion completada';
                btnTopbar.innerHTML = '✅ Medición Guardada';
                btnTopbar.title = 'Métricas guardadas con éxito. Haz clic para ver u ocultar el panel.';
            } else if (this.modoActivo) {
                btnTopbar.className = 'topbar-btn-medicion activo';
                btnTopbar.innerHTML = '⏱️ Medición Activa';
                btnTopbar.title = 'Modo medición activado. Haz clic para ver u ocultar ventana.';
            } else {
                btnTopbar.className = 'topbar-btn-medicion';
                btnTopbar.innerHTML = '⏱️ Activar Modo Medición';
                btnTopbar.title = 'Activar medición voluntaria de tiempos para este carro';
            }
        }
    }

    /**
     * Actualiza textos, colores y botones según la etapa
     */
    actualizarUIEtapa(data) {
        const banner = document.getElementById('hud-stage-banner');
        const title = document.getElementById('hud-stage-title');
        const desc = document.getElementById('hud-stage-desc');
        const badge = document.getElementById('hud-badge-etapa');
        const btnMain = document.getElementById('hud-btn-main-action');
        const btnPause = document.getElementById('hud-btn-pause');
        const secActions = document.getElementById('hud-secondary-actions');
        const btnImprimirOrden = document.getElementById('hud-btn-imprimir-orden');
        const btnImprimirLote = document.getElementById('hud-btn-imprimir-lote');
        const btnGuardado = document.getElementById('hud-btn-guardado-ingredientes');
        const miniEtapa = document.getElementById('hud-mini-etapa');
        const timerSub = document.getElementById('hud-timer-subtext');

        banner.className = 'hud-stage-banner stage-' + this.etapaActual;

        // Actualizar botón de pausa
        if (this.pausado) {
            btnPause.innerHTML = '▶️ Reanudar';
            btnPause.classList.add('btn-pausa-activa');
            document.getElementById('hud-timer-clock').classList.add('hud-timer-paused');
            document.getElementById('hud-mini-pause-status').textContent = '⏸️';
        } else {
            btnPause.innerHTML = '⏸️ Pausar';
            btnPause.classList.remove('btn-pausa-activa');
            document.getElementById('hud-timer-clock').classList.remove('hud-timer-paused');
            document.getElementById('hud-mini-pause-status').textContent = '▶️';
        }

        switch (this.etapaActual) {
            case 0:
                badge.textContent = 'Espera';
                badge.style.background = '#64748b';
                title.textContent = '🎯 Listo para Iniciar Medición';
                desc.textContent = 'El carro ya está diseñado. Al dirigirse al depósito a buscar los insumos, pulse el botón para iniciar el cronómetro de preparación.';
                if (btnImprimirOrden) btnImprimirOrden.style.display = 'none';
                if (btnImprimirLote) btnImprimirLote.style.display = 'none';
                if (btnGuardado) btnGuardado.style.display = 'none';
                if (secActions) secActions.style.display = 'grid';
                btnMain.className = 'hud-main-action-btn hud-btn-start';
                btnMain.innerHTML = '▶️ Iniciar Preparación (Acarreo)';
                btnMain.disabled = false;
                miniEtapa.textContent = 'E0';
                timerSub.textContent = 'Cronómetro en espera';
                this.inicioTimestamp = null;
                break;

            case 1:
                badge.textContent = 'Etapa 1';
                badge.style.background = '#eab308';
                badge.style.color = '#000';
                title.textContent = '🟡 Etapa 1: Preparación (Acarreo de Insumos)';
                desc.textContent = 'Buscando insumos, herramientas y pesaje en mesada. Al tener todo listo en la mesa de producción, pulse Carro listo para producir.';
                if (btnImprimirOrden) btnImprimirOrden.style.display = 'none';
                if (btnImprimirLote) btnImprimirLote.style.display = 'none';
                if (btnGuardado) btnGuardado.style.display = 'none';
                if (secActions) secActions.style.display = 'grid';
                btnMain.className = 'hud-main-action-btn hud-btn-start';
                btnMain.innerHTML = '🟢 Carro listo para producir';
                btnMain.disabled = false;
                miniEtapa.textContent = 'E1: Prep';
                timerSub.textContent = 'Tiempo neto etapa preparación';
                this.inicioTimestamp = data.etapa1_inicio ? Date.parse(data.etapa1_inicio) : Date.now();
                break;

            case 2:
                badge.textContent = 'Etapa 2';
                badge.style.background = '#3b82f6';
                badge.style.color = '#fff';
                title.textContent = '🔵 Etapa 2: Producción Propiamente Dicha';
                desc.textContent = 'Elaborando, mezclando o fraccionando unidades. Puede imprimir la orden de producción. Al terminar de producir, pulse Asentar Producción.';
                if (btnImprimirOrden) btnImprimirOrden.style.display = 'flex';
                if (btnImprimirLote) btnImprimirLote.style.display = 'none';
                if (btnGuardado) btnGuardado.style.display = 'none';
                if (secActions) secActions.style.display = 'grid';
                btnMain.className = 'hud-main-action-btn hud-btn-stage3';
                btnMain.innerHTML = '🏁 Asentar Producción y Pasar a Etiquetado';
                btnMain.disabled = false;
                miniEtapa.textContent = 'E2: Prod';
                timerSub.textContent = 'Tiempo neto etapa producción';
                this.inicioTimestamp = data.etapa2_inicio ? Date.parse(data.etapa2_inicio) : Date.now();
                break;

            case 3:
                badge.textContent = 'Etapa 3';
                badge.style.background = '#a855f7';
                badge.style.color = '#fff';
                title.textContent = '🟣 Etapa 3: Etiquetado, Guardado y Ajustes';
                desc.textContent = 'Imprima etiquetas con lote, realice ajustes de sobrantes/faltantes y guarde todo en depósito. Al finalizar, pulse Guardar Tiempos.';
                if (btnImprimirOrden) btnImprimirOrden.style.display = 'none';
                if (btnImprimirLote) btnImprimirLote.style.display = 'flex';
                if (btnGuardado) btnGuardado.style.display = 'flex';
                if (secActions) secActions.style.display = 'grid';
                btnMain.className = 'hud-main-action-btn hud-btn-finish';
                btnMain.innerHTML = '🏁 Finalizar Medición y Guardar Tiempos';
                btnMain.disabled = false;
                miniEtapa.textContent = 'E3: Cierre';
                timerSub.textContent = 'Tiempo neto etapa etiquetado y guardado';
                this.inicioTimestamp = data.etapa3_inicio ? Date.parse(data.etapa3_inicio) : Date.now();
                break;

            case 4:
                badge.textContent = 'Completada';
                badge.style.background = '#10b981';
                badge.style.color = '#fff';
                title.textContent = '✅ Medición Completada';
                desc.textContent = 'Los tiempos reales y el prorrateo por unidad fueron guardados exitosamente.';
                if (btnImprimirOrden) btnImprimirOrden.style.display = 'none';
                if (btnImprimirLote) btnImprimirLote.style.display = 'none';
                if (btnGuardado) btnGuardado.style.display = 'none';
                if (secActions) secActions.style.display = 'none'; // Ocultar pausar y cancelar en completada
                btnMain.className = 'hud-main-action-btn hud-btn-finish-ok';
                btnMain.innerHTML = '🏁 Finalizar y Cerrar Ventana';
                btnMain.disabled = false;
                miniEtapa.textContent = 'Fin';
                timerSub.textContent = 'Tiempo neto total registrado';
                const durTotalMs = (Number(data.etapa1_duracion_ms || 0) + Number(data.etapa2_duracion_ms || 0) + Number(data.etapa3_duracion_ms || 0));
                const durFormatted = this.formatearMs(durTotalMs);
                document.getElementById('hud-timer-clock').textContent = durFormatted;
                document.getElementById('hud-mini-timer').textContent = durFormatted;
                break;
        }
    }

    /**
     * Disparo de impresión de orden de producción desde el HUD (Etapa 2)
     */
    ejecutarImprimirOrden() {
        if (typeof window.imprimirOrdenProduccion === 'function') {
            window.imprimirOrdenProduccion();
        } else {
            const btn = document.getElementById('imprimir-orden-produccion');
            if (btn) btn.click();
        }
    }

    /**
     * Disparo de impresión con lote desde el HUD (Etapa 3)
     */
    ejecutarImprimirLote() {
        const btnLote = document.getElementById('imprimir-etiquetas-lote');
        if (btnLote && btnLote.style.display !== 'none') {
            btnLote.click();
        } else if (typeof window.imprimirEtiquetasCarroConLote === 'function') {
            window.imprimirEtiquetasCarroConLote(this.carroId);
        } else {
            Swal.fire({
                icon: 'info',
                title: 'Impresión de Lote',
                text: 'La función de impresión con lote no está disponible en este momento o el carro aún no ha sido asentado.'
            });
        }
    }

    /**
     * Disparo de modal de guardado/ajuste de ingredientes desde el HUD (Etapa 3)
     */
    ejecutarGuardadoIngredientes() {
        const cId = this.carroId || sessionStorage.getItem('carroActivo');
        let uId = this.usuarioId;
        if (!uId) {
            try {
                const c = JSON.parse(localStorage.getItem('colaboradorActivo'));
                uId = c?.id;
            } catch (e) {}
        }
        if (typeof window.abrirModalGuardadoIngredientes === 'function') {
            window.abrirModalGuardadoIngredientes(cId, uId);
        } else {
            const btnGuardado = document.getElementById('guardado-ingredientes');
            if (btnGuardado && btnGuardado.style.display !== 'none') {
                btnGuardado.click();
            } else {
                Swal.fire({
                    icon: 'info',
                    title: 'Guardado de Ingredientes',
                    text: 'El guardado de ingredientes está disponible tras asentar la producción.'
                });
            }
        }
    }

    /**
     * El Timón: Acción principal de un clic según la etapa
     */
    async ejecutarAccionPrincipal() {
        if (!this.carroId) return;

        if (this.etapaActual === 0) {
            // El operario sale hacia el depósito: arrancar cronómetro de Etapa 1
            await this.avanzarEtapaBackend(1);

        } else if (this.etapaActual === 1) {
            // El operario terminó de acarrear y llegó a la mesa con todos los insumos:
            // 1. Marcar carro como preparado en el sistema tradicional
            let okPreparado = true;
            if (typeof window.marcarCarroPreparado === 'function') {
                try {
                    const resPrep = await window.marcarCarroPreparado(this.carroId);
                    if (resPrep === false) {
                        okPreparado = false;
                    }
                } catch (e) {
                    console.warn('[HUD-MEDICION] Aviso al marcar preparado estándar:', e);
                    okPreparado = false;
                }
            }
            // 2. Si marcarCarroPreparado no avanzó automáticamente la etapa, asegurar avance:
            if (okPreparado && this.etapaActual === 1) {
                await this.avanzarEtapaBackend(2);
            }

        } else if (this.etapaActual === 2) {
            // El operario terminó de producir/fraccionar en mesada:
            // 1. Asentar producción tradicional (descuenta stock central y genera lotes)
            if (typeof window.asentarProduccion === 'function') {
                try {
                    await window.asentarProduccion(this.carroId);
                    // Si el usuario confirmó el asentamiento, finalizarProduccion ejecuta
                    // y sincroniza automáticamente el avance a Etapa 3.
                } catch (e) {
                    console.warn('[HUD-MEDICION] Aviso al asentar desde HUD:', e);
                }
            } else if (this.etapaActual === 2) {
                await this.avanzarEtapaBackend(3);
            }

        } else if (this.etapaActual === 3) {
            // El operario terminó de etiquetar con lote, ajustar ingredientes y guardar:
            // Cerrar Etapa 3 y registrar prorrateo justo definitivo
            await this.avanzarEtapaBackend(4);

        } else if (this.etapaActual === 4) {
            // Clic en "🏁 Finalizar y Cerrar Ventana": Cierra el modal de forma limpia
            this.ocultarHUD();
            this.actualizarBotonToggleHeader();
        }
    }

    async avanzarEtapaBackend(targetEtapa) {
        if (this.etapaActual === targetEtapa && targetEtapa === 4) return;

        try {
            sessionStorage.setItem(`medicionConfirmadaSesion_${this.carroId}`, 'true');
            this._ultimoCarroConsultadoFoto = String(this.carroId);

            const res = await fetch(`/api/tiempos/carro/${this.carroId}/avanzar-etapa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    siguienteEtapa: targetEtapa,
                    usuarioId: this.usuarioId,
                    usuarioNombre: this.usuarioNombre
                })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            this.etapaActual = data.etapa_actual;

            // Si finalizó (Etapa 4), mostrar modal de felicitación con desglose matemático
            if (targetEtapa === 4 && data.prorrateo) {
                this.mostrarResumenFinalizacion(data.prorrateo);
            }

            await this.activarParaCarro(this.carroId, { silenciarModalFoto: true });
        } catch (e) {
            console.error('[HUD-MEDICION] Error al avanzar etapa:', e);
            Swal.fire('Error', e.message || 'No se pudo avanzar de etapa', 'error');
        }
    }

    mostrarResumenFinalizacion(prorrateo) {
        const minTot = prorrateo.totalMinutosNetos ? prorrateo.totalMinutosNetos.toFixed(1) : '0.0';
        const minUnit = prorrateo.minutosUnitariosTotal ? prorrateo.minutosUnitariosTotal.toFixed(2) : '0.00';
        const uTot = prorrateo.totalUnidades || 0;
        const arts = prorrateo.articulosCount || 0;

        Swal.fire({
            icon: 'success',
            title: '¡Métricas Registradas Exitosamente!',
            html: `
                <div style="text-align: left; font-size: 14px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <p style="margin: 0 0 6px 0;">⏱️ <strong>Tiempo Neto Total:</strong> ${minTot} minutos</p>
                    <p style="margin: 0 0 6px 0;">📦 <strong>Unidades Producidas:</strong> ${uTot} u (${arts} artículos)</p>
                    <p style="margin: 0 0 6px 0; color: #16a34a; font-size: 15px;">📊 <strong>Prorrateo Justo:</strong> <strong>${minUnit} min/unidad</strong></p>
                    <hr style="margin: 8px 0; border: none; border-top: 1px dashed #cbd5e1;">
                    <small style="color: #64748b;">Estas métricas ya están disponibles en el Gestor de Precios de Búnker para ser aplicadas a los costos de mano de obra.</small>
                </div>
            `,
            confirmButtonText: '🏁 Finalizar y Cerrar',
            confirmButtonColor: '#10b981'
        }).then(() => {
            this.ocultarHUD();
            this.actualizarBotonToggleHeader();
            if (typeof window.actualizarVisibilidadBotones === 'function') {
                window.actualizarVisibilidadBotones();
            }
        });
    }

    async togglePausa() {
        if (!this.carroId || this.etapaActual === 0 || this.etapaActual === 4) return;
        const nuevoEstado = !this.pausado;

        try {
            sessionStorage.setItem(`medicionConfirmadaSesion_${this.carroId}`, 'true');
            this._ultimoCarroConsultadoFoto = String(this.carroId);

            const res = await fetch(`/api/tiempos/carro/${this.carroId}/pausa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pausar: nuevoEstado, usuarioId: this.usuarioId })
            });

            if (!res.ok) throw new Error('Error al cambiar pausa');
            const data = await res.json();

            this.pausado = data.pausado;
            this.tiempoPausaMs = Number(data.tiempo_pausa_ms || 0);

            // Re-renderizar UI sin disparar el modal de foto temporal
            await this.activarParaCarro(this.carroId, { silenciarModalFoto: true });
        } catch (e) {
            console.error('[HUD-MEDICION] Error togglePausa:', e);
        }
    }

    async solicitarCancelar() {
        if (!this.carroId) {
            this.ocultarHUD();
            return;
        }

        // Si ya está completada (Etapa 4), no cancelar nada, simplemente cerrar la ventana
        if (this.etapaActual === 4) {
            this.ocultarHUD();
            this.actualizarBotonToggleHeader();
            return;
        }

        const result = await Swal.fire({
            title: '¿Cancelar medición de tiempo?',
            text: 'Se descartarán los cronómetros de este carro sin afectar sus ingredientes ni artículos.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'Sí, cancelar medición',
            cancelButtonText: 'Volver'
        });

        if (result.isConfirmed) {
            try {
                await fetch(`/api/tiempos/carro/${this.carroId}/cancelar-medicion`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuarioId: this.usuarioId })
                });

                sessionStorage.removeItem(`medicionConfirmadaSesion_${this.carroId}`);
                this.modoActivo = false;
                this.etapaActual = 0;
                this.ocultarHUD();
                this.actualizarBotonToggleHeader();

                Swal.fire('Medición Cancelada', 'El carro volvió a su estado normal de trabajo.', 'info');
            } catch (e) {
                console.error('[HUD-MEDICION] Error al cancelar medición:', e);
            }
        }
    }

    iniciarTickTimer() {
        this.detenerTickTimer();
        this.tick();
        this.timerInterval = setInterval(() => this.tick(), 1000);
    }

    detenerTickTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    tick() {
        const clock = document.getElementById('hud-timer-clock');
        const miniClock = document.getElementById('hud-mini-timer');
        if (!clock || !miniClock) return;

        if (this.etapaActual === 0 || !this.inicioTimestamp) {
            clock.textContent = '00:00';
            miniClock.textContent = '00:00';
            return;
        }

        if (this.etapaActual === 4) {
            return; // Ya finalizado
        }

        // Si está pausado, mostrar siempre la foto temporal exacta congelada (no 00:00)
        if (this.pausado) {
            const formattedPaused = this.formatearMs(this.acumuladoEtapaMs);
            clock.textContent = formattedPaused;
            miniClock.textContent = formattedPaused;
            return;
        }

        const transcurridoDesdeSync = Math.max(0, Date.now() - (this.sincronizadoEnMs || Date.now()));
        const diffMs = Math.max(0, this.acumuladoEtapaMs + transcurridoDesdeSync);
        const formatted = this.formatearMs(diffMs);
        clock.textContent = formatted;
        miniClock.textContent = formatted;
    }

    formatearMs(ms) {
        if (!ms || ms < 0) return '00:00';
        const totalSec = Math.floor(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    formatearMsHumano(ms) {
        if (!ms || ms <= 0) return '0 min 00 seg';
        const totalSec = Math.floor(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m} min ${String(s).padStart(2, '0')} seg`;
    }
}

// Inicializar y exponer instancia global
window.hudMedicion = new HudMedicionTemporal();
