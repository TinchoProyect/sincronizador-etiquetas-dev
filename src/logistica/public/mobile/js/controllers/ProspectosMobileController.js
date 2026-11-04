/**
 * Controlador de Prospectos Móvil (LAMDA Móvil)
 * Archivo: ProspectosMobileController.js
 * Módulo de Preventa y Prospección en Calle / Mostrador
 * Incluye Radar Georreferenciado Leaflet, Despacho Inteligente de Catálogo WhatsApp y Embudo Móvil.
 */

const ProspectosMobileController = {
    prospectos: [],
    prospectosFiltrados: [],
    zonas: [],
    listasPrecios: [],
    filtroZona: '',
    filtroEstado: '',
    filtroOrigen: 'CALLE', // 'CALLE' | 'RADAR_WEB' | 'TODOS'
    filtroNicho: '',
    filtroSoloHoy: false,
    filtroSoloRuta: false,
    rutaIds: [],
    rubrosSeleccionadosModal: new Set(['Dietética']),
    rubroOtroActivoModal: false,
    modoAltaActual: 'visita', // 'visita' | 'pin'
    busquedaQuery: '',
    vistaActual: 'lista', // 'lista' | 'mapa' | 'funnel'
    cargando: false,

    // Instancias de Mapa Leaflet
    mapaLeaflet: null,
    markersLayer: null,
    userLocationMarker: null,

    // Instancias de Flatpickr (Almanaque y Horario Dinámico)
    flatpickrAlta: null,
    flatpickrReagendar: null,

    // =========================================================
    // MÁSCARA Y FORMATEO DE TELÉFONOS (ARGENTINA)
    // =========================================================
    formatearTelefono(raw) {
        if (!raw) return '';
        let digits = String(raw).replace(/\D/g, '');
        // Quitar código país si fue ingresado
        if (digits.startsWith('549')) digits = digits.slice(3);
        else if (digits.startsWith('54')) digits = digits.slice(2);
        // Quitar 0 inicial si fue ingresado
        if (digits.startsWith('0')) digits = digits.slice(1);
        // Quitar 15 si se ingresó después del código de área
        if (digits.length > 10 && digits.includes('15')) {
            const idx = digits.indexOf('15');
            if (idx === 2 || idx === 3 || idx === 4) {
                digits = digits.slice(0, idx) + digits.slice(idx + 2);
            }
        }
        // Limitar a los 10 dígitos útiles estándar de Argentina
        if (digits.length > 10) digits = digits.slice(0, 10);
        if (digits.length <= 2) return digits;

        // AMBA / CABA (11 + 8 dígitos) -> 11 5555-4444
        if (digits.startsWith('11')) {
            if (digits.length <= 6) return digits.slice(0, 2) + ' ' + digits.slice(2);
            return digits.slice(0, 2) + ' ' + digits.slice(2, 6) + '-' + digits.slice(6);
        }

        // Prefijos de 4 dígitos comunes (ej: 2227, 2346, etc.)
        const pareceCod4 = (digits.length > 6 && (digits.startsWith('222') || digits.startsWith('224') || digits.startsWith('234') || digits.startsWith('235') || digits.startsWith('298')));
        if (pareceCod4) {
            if (digits.length <= 4) return digits;
            if (digits.length <= 6) return digits.slice(0, 4) + ' ' + digits.slice(4);
            return digits.slice(0, 4) + ' ' + digits.slice(4, 6) + '-' + digits.slice(6);
        }

        // Por defecto: Código de área de 3 dígitos (ej: 221, 223, 341, 351, 261) + 7 dígitos -> 221 661-5746
        if (digits.length <= 3) return digits;
        if (digits.length <= 6) return digits.slice(0, 3) + ' ' + digits.slice(3);
        return digits.slice(0, 3) + ' ' + digits.slice(3, 6) + '-' + digits.slice(6);
    },

    aplicarMascaraTelefono(inputElem) {
        if (!inputElem) return;
        inputElem.setAttribute('type', 'tel');
        inputElem.setAttribute('inputmode', 'numeric');
        inputElem.setAttribute('placeholder', 'Ej: 221 661-5746');
        const formatear = () => {
            const val = inputElem.value;
            const fmt = this.formatearTelefono(val);
            if (val !== fmt) {
                inputElem.value = fmt;
            }
        };
        inputElem.addEventListener('input', formatear);
        inputElem.addEventListener('keyup', formatear);
        inputElem.addEventListener('change', formatear);
        inputElem.addEventListener('blur', formatear);
        if (inputElem.value) formatear();
    },

    // =========================================================
    // GESTIÓN DE RUBROS RÁPIDOS Y MULTI-SELECCIÓN (LOCALSTORAGE)
    // =========================================================
    obtenerRubros() {
        const DEFAULT_RUBROS = ['Dietética', 'Autoservicio', 'Verdulería', 'Panadería', 'Productor Helados', 'Fiambrería', 'Gastronomía', 'Almacén'];
        try {
            const stored = localStorage.getItem('lamda_rubros_preventa');
            if (stored) {
                let arr = JSON.parse(stored);
                if (Array.isArray(arr) && arr.length > 0) {
                    if (!localStorage.getItem('lamda_rubros_v3_migrated')) {
                        ['Autoservicio', 'Verdulería', 'Productor Helados', 'Fiambrería'].forEach(nuevo => {
                            if (!arr.some(x => x.toLowerCase() === nuevo.toLowerCase())) {
                                arr.push(nuevo);
                            }
                        });
                        localStorage.setItem('lamda_rubros_preventa', JSON.stringify(arr));
                        localStorage.setItem('lamda_rubros_v3_migrated', '1');
                    }
                    return arr;
                }
            }
        } catch (e) {
            console.error('[PROSPECTOS] Error leyendo rubros:', e);
        }
        return DEFAULT_RUBROS;
    },

    guardarRubros(lista) {
        try {
            localStorage.setItem('lamda_rubros_preventa', JSON.stringify(lista));
        } catch (e) {
            console.error('[PROSPECTOS] Error guardando rubros:', e);
        }
    },

    renderPillsRubros(rubroSeleccionado = null, prefijo = 'modal') {
        const container = document.getElementById(`${prefijo}-rubros-container`);
        if (!container) return;
        const rubros = this.obtenerRubros();

        if (rubroSeleccionado !== null) {
            this.rubrosSeleccionadosModal = new Set();
            this.rubroOtroActivoModal = false;
            const partes = String(rubroSeleccionado)
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);

            const otrosCustom = [];
            partes.forEach(p => {
                const match = rubros.find(r => r.toLowerCase() === p.toLowerCase());
                if (match) {
                    this.rubrosSeleccionadosModal.add(match);
                } else if (p.toUpperCase() === 'OTRO') {
                    this.rubroOtroActivoModal = true;
                } else {
                    this.rubroOtroActivoModal = true;
                    otrosCustom.push(p);
                }
            });

            if (this.rubrosSeleccionadosModal.size === 0 && !this.rubroOtroActivoModal) {
                this.rubrosSeleccionadosModal.add(rubros[0] || 'Dietética');
            }

            const customInputInit = document.getElementById(`${prefijo}-rubro-custom`);
            if (customInputInit && otrosCustom.length > 0) {
                customInputInit.value = otrosCustom.join(', ');
            }
        } else if (!this.rubrosSeleccionadosModal || (this.rubrosSeleccionadosModal.size === 0 && !this.rubroOtroActivoModal)) {
            this.rubrosSeleccionadosModal = new Set([rubros[0] || 'Dietética']);
        }

        let html = '';
        rubros.forEach(r => {
            const active = this.rubrosSeleccionadosModal.has(r) ? 'active' : '';
            html += `
                <button type="button" class="pill-select ${active}" onclick="ProspectosMobileController.seleccionarRubroPill('${r.replace(/'/g, "\\'")}', '${prefijo}')">
                    ${active ? '✓ ' : ''}${r}
                </button>
            `;
        });

        const activeOtro = this.rubroOtroActivoModal ? 'active' : '';
        html += `
            <button type="button" class="pill-select ${activeOtro}" onclick="ProspectosMobileController.seleccionarRubroOtro('${prefijo}')">
                ✏️ Otro...
            </button>
        `;

        container.innerHTML = html;

        const customBox = document.getElementById(`${prefijo}-rubro-custom-box`);
        if (customBox) {
            customBox.style.display = this.rubroOtroActivoModal ? 'block' : 'none';
        }
        this.sincronizarInputRubros(prefijo);
    },

    seleccionarRubroPill(rubro, prefijo = 'modal') {
        if (!this.rubrosSeleccionadosModal) {
            this.rubrosSeleccionadosModal = new Set();
        }
        if (this.rubrosSeleccionadosModal.has(rubro)) {
            // Permitir desmarcar si hay otro seleccionado o si "Otro" está activo
            if (this.rubrosSeleccionadosModal.size > 1 || this.rubroOtroActivoModal) {
                this.rubrosSeleccionadosModal.delete(rubro);
            }
        } else {
            this.rubrosSeleccionadosModal.add(rubro);
        }
        this.renderPillsRubros(undefined, prefijo);
    },

    seleccionarRubroOtro(prefijo = 'modal') {
        this.rubroOtroActivoModal = !this.rubroOtroActivoModal;
        if (!this.rubroOtroActivoModal && (!this.rubrosSeleccionadosModal || this.rubrosSeleccionadosModal.size === 0)) {
            const rubros = this.obtenerRubros();
            this.rubrosSeleccionadosModal = new Set([rubros[0] || 'Dietética']);
        }
        this.renderPillsRubros(undefined, prefijo);
        if (this.rubroOtroActivoModal) {
            const customInput = document.getElementById(`${prefijo}-rubro-custom`);
            setTimeout(() => customInput?.focus(), 80);
        }
    },

    sincronizarInputRubros(prefijo = 'modal') {
        const hiddenInput = document.getElementById(`${prefijo}-rubro-input`);
        const customInput = document.getElementById(`${prefijo}-rubro-custom`);
        const lista = Array.from(this.rubrosSeleccionadosModal || []);
        if (this.rubroOtroActivoModal) {
            const valCustom = customInput ? customInput.value.trim() : '';
            if (valCustom) lista.push(valCustom);
        }
        const finalStr = lista.length > 0 ? lista.join(', ') : 'Dietética';
        if (hiddenInput) hiddenInput.value = finalStr;
        return finalStr;
    },

    toggleDetallesDomicilio(prefijo = 'modal') {
        const box = document.getElementById(`${prefijo}-detalles-domicilio-box`);
        const btn = document.getElementById(`btn-toggle-detalles-${prefijo}`);
        if (!box) return;
        const isHidden = box.style.display === 'none' || !box.style.display;
        box.style.display = isHidden ? 'flex' : 'none';
        if (btn) {
            btn.innerHTML = isHidden 
                ? '<span>➖ Ocultar ampliación de domicilio</span>' 
                : '<span>➕ Ampliar datos de domicilio (N°, e/ calles, piso/depto)</span>';
        }
    },

    async abrirModalAdministrarRubros() {
        const renderChips = () => {
            const list = this.obtenerRubros();
            if (list.length === 0) {
                return '<div style="color: #94a3b8; font-size: 0.8rem; text-align: center; padding: 10px;">No hay rubros activos.</div>';
            }
            return list.map((r, idx) => `
                <div class="rubro-chip-manage" id="chip-manage-${idx}">
                    <span>${r}</span>
                    <button type="button" class="rubro-chip-del-btn" onclick="ProspectosMobileController.eliminarRubroPreset('${r.replace(/'/g, "\\'")}')" title="Quitar opción">✕</button>
                </div>
            `).join('');
        };

        await Swal.fire({
            title: '⚙️ Rubros Rápidos',
            html: `
                <div style="text-align: left; font-size: 0.85rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 0.75rem;">
                    <p style="margin: 0; color: #94a3b8; font-size: 0.78rem;">
                        Tocá <b>✕</b> para quitar rubros que no uses (ej: Gimnasio) o agregá nuevos botones rápidos para agilizar la carga en la calle.
                    </p>

                    <div>
                        <label style="font-size: 0.72rem; font-weight: 800; color: #fdba74; display: block; margin-bottom: 0.35rem;">
                            Rubros activos actualmente:
                        </label>
                        <div id="swal-rubros-chips-list" style="display: flex; gap: 0.4rem; flex-wrap: wrap; max-height: 140px; overflow-y: auto; padding: 8px; background: rgba(0,0,0,0.25); border-radius: 8px; border: 1px solid #334155;">
                            ${renderChips()}
                        </div>
                    </div>

                    <div>
                        <label style="font-size: 0.72rem; font-weight: 800; color: #f8fafc; display: block; margin-bottom: 0.25rem;">
                            ➕ Agregar nuevo rubro rápido:
                        </label>
                        <div style="display: flex; gap: 0.4rem;">
                            <input id="swal-nuevo-rubro-input" class="wizard-input-mobile" placeholder="Ej: Herboristería" style="font-size: 0.85rem; flex: 1;">
                            <button type="button" onclick="ProspectosMobileController.agregarNuevoRubroPreset()" style="background: #ea580c; color: white; border: none; border-radius: 0.6rem; padding: 0.4rem 0.75rem; font-weight: 800; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">
                                ➕ Sumar
                            </button>
                        </div>
                    </div>

                    <div style="display: flex; justify-content: flex-end; margin-top: 0.25rem;">
                        <button type="button" onclick="ProspectosMobileController.restaurarRubrosPorDefecto()" style="background: none; border: none; color: #94a3b8; font-size: 0.72rem; cursor: pointer; text-decoration: underline;">
                            ↺ Restaurar lista por defecto
                        </button>
                    </div>
                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            confirmButtonText: 'Listo',
            confirmButtonColor: '#ea580c'
        });

        this.renderPillsRubros();
    },

    eliminarRubroPreset(rubro) {
        let rubros = this.obtenerRubros();
        rubros = rubros.filter(r => r.toLowerCase() !== rubro.toLowerCase());
        this.guardarRubros(rubros);

        const container = document.getElementById('swal-rubros-chips-list');
        if (container) {
            container.innerHTML = rubros.map((r, idx) => `
                <div class="rubro-chip-manage" id="chip-manage-${idx}">
                    <span>${r}</span>
                    <button type="button" class="rubro-chip-del-btn" onclick="ProspectosMobileController.eliminarRubroPreset('${r.replace(/'/g, "\\'")}')" title="Quitar opción">✕</button>
                </div>
            `).join('');
        }
        this.renderPillsRubros();
    },

    agregarNuevoRubroPreset() {
        const input = document.getElementById('swal-nuevo-rubro-input');
        const val = input ? input.value.trim() : '';
        if (!val) return;

        let rubros = this.obtenerRubros();
        if (!rubros.some(r => r.toLowerCase() === val.toLowerCase())) {
            rubros.push(val);
            this.guardarRubros(rubros);
        }
        if (input) input.value = '';

        const container = document.getElementById('swal-rubros-chips-list');
        if (container) {
            container.innerHTML = rubros.map((r, idx) => `
                <div class="rubro-chip-manage" id="chip-manage-${idx}">
                    <span>${r}</span>
                    <button type="button" class="rubro-chip-del-btn" onclick="ProspectosMobileController.eliminarRubroPreset('${r.replace(/'/g, "\\'")}')" title="Quitar opción">✕</button>
                </div>
            `).join('');
        }
        this.renderPillsRubros(val);
    },

    restaurarRubrosPorDefecto() {
        const DEFAULT_RUBROS = ['Dietética', 'Autoservicio', 'Almacén', 'Fiambrería', 'Panadería', 'Kiosco', 'Gastronomía'];
        this.guardarRubros(DEFAULT_RUBROS);
        const container = document.getElementById('swal-rubros-chips-list');
        if (container) {
            container.innerHTML = DEFAULT_RUBROS.map((r, idx) => `
                <div class="rubro-chip-manage" id="chip-manage-${idx}">
                    <span>${r}</span>
                    <button type="button" class="rubro-chip-del-btn" onclick="ProspectosMobileController.eliminarRubroPreset('${r.replace(/'/g, "\\'")}')" title="Quitar opción">✕</button>
                </div>
            `).join('');
        }
        this.renderPillsRubros();
    },

    // =========================================================
    // HOJA DE RUTA DE VISITAS EN CALLE (LOCALSTORAGE)
    // =========================================================
    cargarRutaLocal() {
        try {
            const raw = localStorage.getItem('lamda_ruta_visitas_preventa');
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                    this.rutaIds = arr.map(Number).filter(Boolean);
                    return;
                }
            }
        } catch (e) {
            console.error('[PROSPECTOS] Error leyendo ruta local:', e);
        }
        this.rutaIds = [];
    },

    guardarRutaLocal() {
        try {
            localStorage.setItem('lamda_ruta_visitas_preventa', JSON.stringify(this.rutaIds));
        } catch (e) {
            console.error('[PROSPECTOS] Error guardando ruta local:', e);
        }
        this.actualizarUIEstadoRuta();
    },

    estaEnRuta(id) {
        return this.rutaIds.includes(Number(id));
    },

    toggleEnRuta(id) {
        const numId = Number(id);
        if (this.estaEnRuta(numId)) {
            this.rutaIds = this.rutaIds.filter(x => x !== numId);
            if (this.rutaIds.length === 0 && this.filtroSoloRuta) {
                this.filtroSoloRuta = false;
            }
        } else {
            this.rutaIds.push(numId);
        }
        this.guardarRutaLocal();
        this.aplicarFiltros();
    },

    toggleFiltroRuta() {
        this.filtroSoloRuta = !this.filtroSoloRuta;
        this.actualizarUIEstadoRuta();
        this.aplicarFiltros();
    },

    limpiarRuta() {
        this.rutaIds = [];
        this.filtroSoloRuta = false;
        this.guardarRutaLocal();
        this.aplicarFiltros();
    },

    actualizarUIEstadoRuta() {
        // Filtrar solo IDs que sigan activos en el listado cargado
        if (this.prospectos && this.prospectos.length > 0) {
            const idsActivos = new Set(this.prospectos.map(p => Number(p.id)));
            this.rutaIds = this.rutaIds.filter(id => idsActivos.has(Number(id)));
        }
        const count = this.rutaIds.length;
        const lblRutaTab = document.getElementById('lbl-count-ruta-tab');
        if (lblRutaTab) {
            lblRutaTab.innerText = count > 0 ? `(${count})` : '';
        }
        const btnRuta = document.getElementById('btn-filtro-ruta');
        if (btnRuta) {
            btnRuta.innerHTML = count > 0 ? `🚗 Ruta (${count})` : '🚗 Ruta';
            if (this.filtroSoloRuta) {
                btnRuta.classList.add('active-pill');
            } else {
                btnRuta.classList.remove('active-pill');
            }
        }
        const banner = document.getElementById('banner-ruta-activa');
        const lblCount = document.getElementById('lbl-banner-ruta-count');
        if (banner) {
            if (count > 0) {
                banner.style.display = 'flex';
                if (lblCount) lblCount.innerText = `${count} ${count === 1 ? 'comercio marcado para visitar' : 'comercios marcados en tu ruta'}`;
            } else {
                banner.style.display = 'none';
            }
        }
    },

    abrirRutaGoogleMaps() {
        const itemsRuta = this.prospectos.filter(p => this.estaEnRuta(p.id));
        if (itemsRuta.length === 0) {
            Swal.fire({
                icon: 'info',
                title: 'Ruta vacía',
                text: 'Tocá el botón "🚗 +Ruta" en las tarjetas o en el mapa para elegir los comercios a visitar.',
                background: '#1e293b',
                color: '#fff'
            });
            return;
        }

        const paradas = itemsRuta.map(p => {
            if (p.latitud && p.longitud) {
                return `${parseFloat(p.latitud)},${parseFloat(p.longitud)}`;
            }
            if (p.direccion) {
                return encodeURIComponent(`${p.direccion}, ${p.zona || p.localidad || 'La Plata'}, Argentina`);
            }
            return null;
        }).filter(Boolean);

        if (paradas.length === 0) {
            Swal.fire({
                icon: 'warning',
                title: 'Sin coordenadas ni dirección',
                text: 'Los comercios seleccionados no tienen ubicación GPS ni calle cargada.',
                background: '#1e293b',
                color: '#fff'
            });
            return;
        }

        const destinoFinal = paradas[paradas.length - 1];
        const intermedios = paradas.slice(0, -1);
        let url = `https://www.google.com/maps/dir/?api=1&destination=${destinoFinal}&travelmode=driving`;
        if (intermedios.length > 0) {
            url += `&waypoints=${intermedios.join('|')}`;
        }
        window.open(url, '_blank');
    },

    // =========================================================
    // ENVIAR CONTACTOS SELECCIONADOS A HOJA DE RUTA OFICIAL
    // =========================================================
    async abrirModalEnviarAHojaDeRuta(idsForzados = null) {
        const idsSeleccionados = Array.isArray(idsForzados) && idsForzados.length > 0
            ? idsForzados
            : this.rutaIds;

        const items = this.prospectos.filter(p => idsSeleccionados.includes(Number(p.id)));
        if (items.length === 0) {
            Swal.fire({
                icon: 'info',
                title: 'Seleccioná comercios primero',
                text: 'Tocá "🚗 +Ruta" en las tarjetas o en los pines del mapa para elegir qué locales querés visitar hoy.',
                background: '#1e293b',
                color: '#fff'
            });
            return;
        }

        Swal.fire({
            title: 'Buscando Hojas de Ruta...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading(),
            background: '#1e293b',
            color: '#fff'
        });

        let rutasActivas = [];
        let choferes = [];
        try {
            const res = await fetch('/api/logistica/prospectos/rutas-disponibles');
            const json = await res.json();
            if (json.success) {
                rutasActivas = json.rutas || [];
                choferes = json.choferes || [];
            }
        } catch (e) {
            console.warn('[PROSPECTOS] Error consultando rutas disponibles:', e);
        }

        const sesionLocal = (() => {
            try { return JSON.parse(localStorage.getItem('sesion_chofer') || sessionStorage.getItem('sesion_chofer') || '{}'); }
            catch (_) { return {}; }
        })();
        const choferDefaultId = sesionLocal.id || (choferes[0]?.id || 1);
        const fechaHoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
        const zonasUnicas = [...new Set(items.map(p => p.zona).filter(Boolean))];
        const nombreSugerido = zonasUnicas.length > 0
            ? `Preventa ${zonasUnicas.slice(0, 2).join(' / ')} (${fechaHoy})`
            : `Preventa en Calle (${fechaHoy})`;

        const conContacto = items.filter(p => (p.telefono_whatsapp && p.telefono_whatsapp.replace(/\D/g, '').length >= 8) || p.email).length;

        const opcionesRutasHtml = rutasActivas.map(r => `
            <option value="${r.id}">
                ${r.estado === 'EN_CAMINO' ? '🟢' : '🟡'} ${r.nombre_ruta} (${r.total_paradas} paradas - ${r.chofer_nombre || 'Sin chofer'})
            </option>
        `).join('');

        const opcionesChoferesHtml = choferes.map(c => `
            <option value="${c.id}" ${Number(c.id) === Number(choferDefaultId) ? 'selected' : ''}>
                🚗 ${c.nombre_completo}
            </option>
        `).join('');

        const usarExistenteDefault = rutasActivas.length > 0;

        const { value: formRuta } = await Swal.fire({
            title: '🛣️ Enviar a Logística / Ruta',
            html: `
                <div style="text-align: left; font-size: 0.84rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 0.7rem;">
                    <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid #334155; border-radius: 0.65rem; padding: 0.55rem 0.65rem;">
                        <div style="font-size: 0.76rem; font-weight: 800; color: #fdba74; margin-bottom: 0.3rem;">
                            🎯 ${items.length} ${items.length === 1 ? 'contacto seleccionado' : 'contactos seleccionados'} para visitar:
                        </div>
                        <div style="max-height: 95px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.76rem;">
                            ${items.map(p => {
                                const tieneWa = (p.telefono_whatsapp || '').replace(/\D/g, '').length >= 8;
                                return `<div style="display:flex; justify-content:space-between; gap:4px;">
                                    <span class="text-truncate">• <b>${p.nombre_fantasia}</b> (${p.zona || 'S/Z'})</span>
                                    <span style="color:${tieneWa ? '#34d399' : '#94a3b8'}; font-size:0.7rem; flex-shrink:0;">
                                        ${tieneWa ? '📱 Aviso auto' : (p.email ? '✉️ Email' : '🚶 En frío')}
                                    </span>
                                </div>`;
                            }).join('')}
                        </div>
                    </div>

                    <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                        ${rutasActivas.length > 0 ? `
                            <button type="button" id="btn-modo-existente" style="flex:1; padding:0.45rem 0.35rem; border-radius:0.55rem; border:1px solid #38bdf8; background:rgba(2,132,199,0.25); color:#fff; font-weight:800; font-size:0.73rem; cursor:pointer; white-space:nowrap;">
                                📋 Ruta Activa
                            </button>
                        ` : ''}
                        <button type="button" id="btn-modo-nueva" style="flex:1; padding:0.45rem 0.35rem; border-radius:0.55rem; border:1px solid ${usarExistenteDefault ? '#475569' : '#f97316'}; background:${usarExistenteDefault ? '#0f172a' : 'rgba(234,88,12,0.25)'}; color:${usarExistenteDefault ? '#94a3b8' : '#fff'}; font-weight:800; font-size:0.73rem; cursor:pointer; white-space:nowrap;">
                            ➕ Ruta Nueva
                        </button>
                        <button type="button" id="btn-modo-pool" style="flex:1; padding:0.45rem 0.35rem; border-radius:0.55rem; border:1px solid #475569; background:#0f172a; color:#94a3b8; font-weight:800; font-size:0.73rem; cursor:pointer; white-space:nowrap;">
                            📥 Pool Logística
                        </button>
                    </div>

                    ${rutasActivas.length > 0 ? `
                        <div id="box-ruta-existente">
                            <label style="font-size: 0.72rem; font-weight: 800; color: #94a3b8; display: block; margin-bottom: 4px;">Seleccioná la Hoja de Ruta donde querés intercalar estas visitas:</label>
                            <select id="swal-select-id-ruta" class="wizard-input-mobile" style="font-size: 0.84rem; font-weight: 700;">
                                ${opcionesRutasHtml}
                            </select>
                        </div>
                    ` : ''}

                    <div id="box-ruta-nueva" style="display: ${usarExistenteDefault ? 'none' : 'flex'}; flex-direction: column; gap: 0.5rem;">
                        <div>
                            <label style="font-size: 0.72rem; font-weight: 800; color: #94a3b8; display: block; margin-bottom: 3px;">Nombre de la Nueva Hoja de Ruta:</label>
                            <input type="text" id="swal-input-nombre-ruta" class="wizard-input-mobile" value="${nombreSugerido}" style="font-size: 0.85rem; font-weight: 700;">
                        </div>
                        <div>
                            <label style="font-size: 0.72rem; font-weight: 800; color: #94a3b8; display: block; margin-bottom: 3px;">Asignar a Chofer / Vendedor:</label>
                            <select id="swal-select-chofer-ruta" class="wizard-input-mobile" style="font-size: 0.84rem;">
                                ${opcionesChoferesHtml}
                            </select>
                        </div>
                    </div>

                    <div id="box-solo-pool" style="display: none; background: rgba(13, 148, 136, 0.14); border: 1px solid rgba(20, 184, 166, 0.45); border-radius: 0.6rem; padding: 0.55rem 0.65rem; font-size: 0.76rem; color: #ccfbf1; line-height: 1.4;">
                        📥 <b>Enviar solo al Pool de Logística:</b> Los contactos quedarán disponibles en la pestaña <b>🎯 Contactos</b> del Pool de Logística (sin mezclarse con facturación) para arrastrarlos a una ruta cuando armes el despacho.
                    </div>

                    <div style="background: rgba(16, 185, 129, 0.12); border-left: 3px solid #10b981; border-radius: 0.5rem; padding: 0.5rem 0.6rem; font-size: 0.74rem; color: #d1fae5; line-height: 1.35;">
                        💬 <b>Aviso automático al Iniciar Ruta:</b> ${conContacto > 0 ? `Los <b>${conContacto}</b> comercios con teléfono/mail recibirán automáticamente un mensaje corto presentando a LAMDA y avisando que hoy pasarás a saludarlos.` : `Cuando inicies la Hoja de Ruta, si algún comercio tiene WhatsApp o mail cargado, el sistema le enviará un saludo corto de presentación automáticamente.`}
                    </div>
                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: '🛣️ Confirmar Envío',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#ea580c',
            didOpen: () => {
                this._modoDestinoLogistica = usarExistenteDefault ? 'EXISTENTE' : 'NUEVA';
                const btnEx = document.getElementById('btn-modo-existente');
                const btnNu = document.getElementById('btn-modo-nueva');
                const btnPo = document.getElementById('btn-modo-pool');
                const boxEx = document.getElementById('box-ruta-existente');
                const boxNu = document.getElementById('box-ruta-nueva');
                const boxPo = document.getElementById('box-solo-pool');

                const setModo = (modo) => {
                    this._modoDestinoLogistica = modo;
                    if (boxEx) boxEx.style.display = modo === 'EXISTENTE' ? 'block' : 'none';
                    if (boxNu) boxNu.style.display = modo === 'NUEVA' ? 'flex' : 'none';
                    if (boxPo) boxPo.style.display = modo === 'POOL' ? 'block' : 'none';

                    if (btnEx) {
                        btnEx.style.background = modo === 'EXISTENTE' ? 'rgba(2,132,199,0.25)' : '#0f172a';
                        btnEx.style.borderColor = modo === 'EXISTENTE' ? '#38bdf8' : '#475569';
                        btnEx.style.color = modo === 'EXISTENTE' ? '#fff' : '#94a3b8';
                    }
                    if (btnNu) {
                        btnNu.style.background = modo === 'NUEVA' ? 'rgba(234,88,12,0.25)' : '#0f172a';
                        btnNu.style.borderColor = modo === 'NUEVA' ? '#f97316' : '#475569';
                        btnNu.style.color = modo === 'NUEVA' ? '#fff' : '#94a3b8';
                    }
                    if (btnPo) {
                        btnPo.style.background = modo === 'POOL' ? 'rgba(13,148,136,0.3)' : '#0f172a';
                        btnPo.style.borderColor = modo === 'POOL' ? '#14b8a6' : '#475569';
                        btnPo.style.color = modo === 'POOL' ? '#fff' : '#94a3b8';
                    }
                };

                if (btnEx) btnEx.addEventListener('click', () => setModo('EXISTENTE'));
                if (btnNu) btnNu.addEventListener('click', () => setModo('NUEVA'));
                if (btnPo) btnPo.addEventListener('click', () => setModo('POOL'));
            },
            preConfirm: () => {
                const modo = this._modoDestinoLogistica || (usarExistenteDefault ? 'EXISTENTE' : 'NUEVA');
                return {
                    ids_prospectos: items.map(p => p.id),
                    solo_pool: modo === 'POOL',
                    crear_nueva_ruta: modo === 'NUEVA',
                    id_ruta: modo === 'EXISTENTE' ? document.getElementById('swal-select-id-ruta')?.value : null,
                    nombre_ruta: document.getElementById('swal-input-nombre-ruta')?.value,
                    id_chofer: document.getElementById('swal-select-chofer-ruta')?.value || choferDefaultId
                };
            }
        });

        if (!formRuta) return;

        try {
            const res = await fetch('/api/logistica/prospectos/enviar-a-ruta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formRuta)
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const rutaIdDestino = json.data?.id_ruta;
            if (rutaIdDestino) {
                sessionStorage.setItem('activeRouteId', String(rutaIdDestino));
            }

            this.limpiarRuta();
            await this.cargarProspectos();

            if (formRuta.solo_pool) {
                await Swal.fire({
                    icon: 'success',
                    title: '📥 Enviados al Pool de Logística',
                    html: `<div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.45;">${json.message}<br><br>Los encontrás en la pestaña <b>🎯 Contactos</b> del Pool de Logística listos para asignar a una ruta.</div>`,
                    background: '#1e293b',
                    color: '#fff',
                    confirmButtonColor: '#0d9488',
                    confirmButtonText: 'Entendido'
                });
                return;
            }

            const irRes = await Swal.fire({
                icon: 'success',
                title: '🛣️ ¡Incorporados a la Hoja de Ruta!',
                html: `
                    <div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.45;">
                        ${json.message}<br><br>
                        Desde la <b>Hoja de Ruta</b> podés acomodar el orden en el mapa junto con los pedidos y tocar <b>"🚀 Iniciar Ruta"</b> para salir y disparar el saludo de presentación.
                    </div>
                `,
                background: '#1e293b',
                color: '#fff',
                showCancelButton: true,
                confirmButtonText: '🛣️ Abrir Hoja de Ruta Ahora',
                cancelButtonText: 'Seguir en Preventa',
                confirmButtonColor: '#059669'
            });

            if (irRes.isConfirmed) {
                window.location.href = 'ruta.html';
            }
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1e293b', color: '#fff' });
        }
    },

    // =========================================================
    // BUSCADOR ACTIVO EN INTERNET POR RUBRO Y ZONA
    // =========================================================
    async abrirModalBuscadorWeb() {
        const { value: paramsBusqueda } = await Swal.fire({
            title: '🔎 Buscar Comercios en Internet',
            html: `
                <div style="text-align: left; font-size: 0.84rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 0.65rem;">
                    <p style="margin: 0; font-size: 0.78rem; color: #94a3b8;">
                        Elegí qué característica o rubro específico querés relevar hoy en internet y en qué zona:
                    </p>
                    <div>
                        <label style="font-size: 0.73rem; font-weight: 800; color: #fdba74; display: block; margin-bottom: 3px;">🏷️ Característica / Rubro a buscar:</label>
                        <select id="swal-web-categoria" class="wizard-input-mobile" style="font-size: 0.85rem; font-weight: 700;">
                            <option value="fiambreria">🧀 Fiambrerías, Queserías y Almacenes</option>
                            <option value="dietetica">🥜 Dietéticas y Casas Naturales</option>
                            <option value="panaderia">🥖 Panaderías y Confiterías (Productores)</option>
                            <option value="heladeria">🍦 Heladerías Artesanales (Productores)</option>
                            <option value="supermercado">🛒 Autoservicios y Supermercados</option>
                            <option value="verduleria">🥦 Verdulerías y Fruterías</option>
                            <option value="gastronomia">🍕 Gastronomía, Pastas y Restó</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.73rem; font-weight: 800; color: #7dd3fc; display: block; margin-bottom: 3px;">📍 Zona de influencia:</label>
                        <select id="swal-web-zona" class="wizard-input-mobile" style="font-size: 0.85rem; font-weight: 700;">
                            <option value="Berisso" ${this.filtroZona === 'Berisso' ? 'selected' : ''}>📍 Berisso</option>
                            <option value="Ensenada" ${this.filtroZona === 'Ensenada' ? 'selected' : ''}>📍 Ensenada</option>
                            <option value="La Plata Centro" ${(!this.filtroZona || this.filtroZona === 'La Plata Centro') ? 'selected' : ''}>📍 La Plata Casco Urbano</option>
                            <option value="Los Hornos" ${this.filtroZona === 'Los Hornos' ? 'selected' : ''}>📍 Los Hornos</option>
                            <option value="Tolosa / Ringuelet" ${this.filtroZona === 'Tolosa / Ringuelet' ? 'selected' : ''}>📍 Tolosa / Ringuelet</option>
                            <option value="Gonnet / City Bell" ${this.filtroZona === 'Gonnet / City Bell' ? 'selected' : ''}>📍 Gonnet / City Bell</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.72rem; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 3px;">🔍 Palabra clave específica (opcional):</label>
                        <input type="text" id="swal-web-query" class="wizard-input-mobile" placeholder="Ej: Fiambrería, Panadería, Dietética..." style="font-size: 0.84rem;">
                    </div>
                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: '🔎 Buscar en Web Ahora',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#0284c7',
            preConfirm: () => ({
                categoria: document.getElementById('swal-web-categoria').value,
                zona: document.getElementById('swal-web-zona').value,
                query_libre: document.getElementById('swal-web-query').value.trim()
            })
        });

        if (!paramsBusqueda) return;

        Swal.fire({
            title: 'Relevando comercios en la web...',
            html: `<div style="font-size:0.82rem; color:#94a3b8;">Buscando locales georreferenciados en <b>${paramsBusqueda.zona}</b>...</div>`,
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading(),
            background: '#1e293b',
            color: '#fff'
        });

        try {
            const res = await fetch('/api/logistica/prospectos/buscar-web', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(paramsBusqueda)
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const encontrados = (json.data || []).filter(x => !x.ya_cargado);
            if (encontrados.length === 0) {
                Swal.fire({
                    icon: 'info',
                    title: 'Sin comercios nuevos en esa búsqueda',
                    text: 'Todos los locales encontrados para ese rubro y zona ya están en tu Radar o probá con otra zona/rubro.',
                    background: '#1e293b',
                    color: '#fff'
                });
                return;
            }

            const listaHtml = encontrados.map((c, idx) => `
                <label style="display: flex; align-items: flex-start; gap: 0.55rem; padding: 0.55rem; border-bottom: 1px solid #334155; cursor: pointer; text-align: left;">
                    <input type="checkbox" class="chk-web-cand" data-idx="${idx}" checked style="margin-top: 3px; width: 18px; height: 18px; accent-color: #0284c7; flex-shrink: 0;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 800; color: #f8fafc; font-size: 0.85rem;">${c.nombre_fantasia}</div>
                        <div style="font-size: 0.74rem; color: #7dd3fc;">📍 ${c.direccion} • ${c.zona}</div>
                        ${c.telefono_whatsapp ? `<div style="font-size: 0.73rem; color: #34d399; font-weight:700;">📱 ${c.telefono_whatsapp}</div>` : ''}
                        ${c.web_redes ? `<div style="font-size: 0.71rem; color: #38bdf8;">🌐 ${c.web_redes}</div>` : ''}
                    </div>
                </label>
            `).join('');

            const selRes = await Swal.fire({
                title: `🌐 ${encontrados.length} Comercios Encontrados`,
                html: `
                    <div style="text-align: left; font-size: 0.8rem; color: #cbd5e1;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
                            <span>Tildá los que quieras incorporar:</span>
                            <div style="display:flex; gap:6px;">
                                <button type="button" id="btn-web-todos" style="background:#334155; color:#fff; border:none; border-radius:4px; padding:2px 7px; font-size:0.7rem; cursor:pointer;">Todos</button>
                                <button type="button" id="btn-web-ninguno" style="background:#334155; color:#fff; border:none; border-radius:4px; padding:2px 7px; font-size:0.7rem; cursor:pointer;">Ninguno</button>
                            </div>
                        </div>
                        <div style="max-height: 250px; overflow-y: auto; border: 1px solid #334155; border-radius: 0.65rem; background: #0f172a;">
                            ${listaHtml}
                        </div>
                    </div>
                `,
                background: '#1e293b',
                color: '#fff',
                showCancelButton: true,
                showDenyButton: true,
                confirmButtonText: '🛣️ Importar y Armar Ruta',
                denyButtonText: '📥 Solo Guardar en Radar',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#ea580c',
                denyButtonColor: '#0284c7',
                didOpen: () => {
                    document.getElementById('btn-web-todos')?.addEventListener('click', () => {
                        document.querySelectorAll('.chk-web-cand').forEach(el => el.checked = true);
                    });
                    document.getElementById('btn-web-ninguno')?.addEventListener('click', () => {
                        document.querySelectorAll('.chk-web-cand').forEach(el => el.checked = false);
                    });
                },
                preConfirm: () => {
                    const idxs = Array.from(document.querySelectorAll('.chk-web-cand:checked')).map(el => Number(el.dataset.idx));
                    return { items: idxs.map(i => encontrados[i]).filter(Boolean), armarRuta: true };
                },
                preDeny: () => {
                    const idxs = Array.from(document.querySelectorAll('.chk-web-cand:checked')).map(el => Number(el.dataset.idx));
                    return { items: idxs.map(i => encontrados[i]).filter(Boolean), armarRuta: false };
                }
            });

            const payload = selRes.value;
            if (!payload || !payload.items || payload.items.length === 0) return;

            const impRes = await fetch('/api/logistica/prospectos/importar-web', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ comercios: payload.items })
            });
            const impJson = await impRes.json();
            if (!impJson.success) throw new Error(impJson.error);

            const nuevosIds = (impJson.data || []).map(x => Number(x.id));
            await this.cargarProspectos();

            if (payload.armarRuta && nuevosIds.length > 0) {
                nuevosIds.forEach(id => {
                    if (!this.rutaIds.includes(id)) this.rutaIds.push(id);
                });
                this.guardarRutaLocal();
                this.actualizarUIEstadoRuta();
                await this.abrirModalEnviarAHojaDeRuta(nuevosIds);
            } else {
                this.irATabPrincipal('RADAR_WEB');
                Swal.fire({
                    toast: true,
                    position: 'top',
                    icon: 'success',
                    title: `${nuevosIds.length} comercios sumados al Radar`,
                    timer: 2200,
                    showConfirmButton: false,
                    background: '#0f172a',
                    color: '#fff'
                });
            }
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error en búsqueda web', text: e.message, background: '#1e293b', color: '#fff' });
        }
    },

    seccionActiva: 'HUB', // 'HUB' | 'DETECTADOS' | 'MARCAR_CALLE' | 'CONFIG_RUTAS'
    configRutasDias: { nodos: [], rutas_zona: [], cronograma: [] },
    filtroRutaZonaId: '',
    filtroDiaTurno: '',
    rutasSeleccionadasPaso1: new Set(),
    diasTurnosSeleccionadosPaso2: new Set(),
    clientesDomicilios: [],
    capasMapa: {
        nodos: true,      // 🏠 Casa y 🏭 Depósito
        calle: true,      // 🚶 Contactos marcados en calle
        web: true,        // 🌐 Contactos detectados vía web
        clientes: false   // ⭐ Clientes actuales de LAMDA
    },

    async init() {
        console.log('🎯 [CONTACTO-CALLE] Inicializando módulo reorganizado en 3 pilares...');
        this.cargarRutaLocal();
        this.bindEvents();
        this.aplicarMascaraTelefono(document.getElementById('calle-telefono'));
        await Promise.all([
            this.cargarConfigRutasDias(),
            this.cargarZonas(),
            this.cargarMetricas(),
            this.cargarListasPrecios(),
            this.cargarProspectos(),
            this.cargarClientesDomicilios()
        ]);
        this.actualizarUIEstadoRuta();
        this.actualizarHubPrincipal();
    },

    async cargarClientesDomicilios() {
        try {
            const res = await fetch('/api/logistica/domicilios');
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
                this.clientesDomicilios = json.data.filter(d => d.activo !== false && d.latitud && d.longitud);
                const lblCli = document.getElementById('lbl-capa-clientes');
                if (lblCli) lblCli.innerText = `Clientes (${this.clientesDomicilios.length})`;
            }
        } catch (e) {
            console.error('[CONTACTO-CALLE] Error cargando domicilios de clientes para el mapa:', e);
        }
    },

    bindEvents() {
        const inputBuscar = document.getElementById('buscar-prospecto-input');
        const btnClear = document.getElementById('btn-clear-prospecto-search');

        if (inputBuscar) {
            inputBuscar.addEventListener('input', (e) => {
                this.busquedaQuery = e.target.value.trim().toLowerCase();
                if (btnClear) btnClear.style.display = this.busquedaQuery ? 'block' : 'none';
                this.aplicarFiltros();
            });
        }

        if (btnClear) {
            btnClear.addEventListener('click', () => {
                if (inputBuscar) {
                    inputBuscar.value = '';
                    inputBuscar.focus();
                }
                this.busquedaQuery = '';
                btnClear.style.display = 'none';
                this.aplicarFiltros();
            });
        }
    },

    // =========================================================
    // CONMUTADOR DE VISTAS Y PESTAÑAS PRINCIPALES
    // =========================================================
    irATabPrincipal(tab) {
        if (tab === 'CALLE') {
            this.filtroOrigen = 'CALLE';
            this.filtroSoloRuta = false;
            document.getElementById('header-titulo-seccion').innerText = 'Vía Territorio';
            this.cambiarVista('lista');
            this.aplicarFiltros();
        } else if (tab === 'RADAR_WEB') {
            this.filtroOrigen = 'RADAR_WEB';
            this.filtroSoloRuta = false;
            document.getElementById('header-titulo-seccion').innerText = 'Vía Web';
            this.cambiarVista('lista');
            this.aplicarFiltros();
        } else if (tab === 'MAPA' || tab === 'TODOS') {
            this.filtroOrigen = 'TODOS';
            this.filtroSoloRuta = false;
            document.getElementById('header-titulo-seccion').innerText = 'Mapa Geográfico';
            document.getElementById('contador-prospectos-mobile').innerText = 'Explorador visual dinámico';
            this.cambiarVista('mapa');
            this.aplicarFiltros();
        }
    },

    cambiarVista(vista) {
        this.vistaActual = vista;

        const headerListado = document.getElementById('header-listado-detectados');
        const vistaLista = document.getElementById('vista-lista-mobile');
        const vistaMapa = document.getElementById('vista-mapa-mobile');
        const vistaFunnel = document.getElementById('vista-funnel-mobile');

        // Cuando se abre el Mapa, ocultar todo el encabezado de listado para dejar solo el mapa limpio
        if (headerListado) headerListado.style.display = vista === 'lista' ? 'block' : 'none';
        if (vistaLista) vistaLista.style.display = vista === 'lista' ? 'block' : 'none';
        if (vistaMapa) vistaMapa.style.display = vista === 'mapa' ? 'block' : 'none';
        if (vistaFunnel) vistaFunnel.style.display = vista === 'funnel' ? 'block' : 'none';

        if (vista !== 'mapa' && vistaMapa) {
            vistaMapa.classList.remove('mapa-general-fullscreen');
        }

        if (vista === 'mapa') {
            setTimeout(() => {
                this.initOrUpdateMapa(true);
            }, 100);
        } else if (vista === 'funnel') {
            this.renderFunnelMobile();
        }
    },

    togglePanelFiltros() {
        const panel = document.getElementById('panel-filtros-avanzados');
        const btn = document.getElementById('btn-toggle-filtros');
        if (!panel) return;
        const isOpen = panel.style.display !== 'none';
        panel.style.display = isOpen ? 'none' : 'flex';
        if (btn) {
            if (!isOpen) btn.classList.add('active-filter');
            else if (!this.tieneFiltrosActivos()) btn.classList.remove('active-filter');
        }
    },

    tieneFiltrosActivos() {
        return Boolean(this.filtroZona || this.filtroNicho || this.filtroEstado || this.filtroSoloHoy || this.filtroOrigen === 'TODOS');
    },

    onSelectEstadoMenu(val) {
        if (val === 'VER_EMBUDO') {
            this.cambiarVista('funnel');
            return;
        }
        if (val === 'VER_TODO') {
            this.filtroOrigen = 'TODOS';
            this.filtroEstado = '';
            this.filtroSoloHoy = false;
            if (this.vistaActual === 'funnel') this.cambiarVista('lista');
            this.aplicarFiltros();
            return;
        }
        if (val === 'AGENDA_HOY') {
            this.filtroSoloHoy = true;
            this.filtroEstado = '';
            if (this.vistaActual === 'funnel') this.cambiarVista('lista');
            this.aplicarFiltros();
            return;
        }
        this.filtroSoloHoy = false;
        this.filtroEstado = val || '';
        if (this.vistaActual === 'funnel') this.cambiarVista('lista');
        this.aplicarFiltros();
    },

    limpiarTodosLosFiltros() {
        this.filtroZona = '';
        this.filtroNicho = '';
        this.filtroEstado = '';
        this.filtroSoloHoy = false;
        const selZona = document.getElementById('select-filtro-zona');
        const selNicho = document.getElementById('select-filtro-nicho');
        const selEstado = document.getElementById('select-filtro-estado');
        if (selZona) selZona.value = '';
        if (selNicho) selNicho.value = '';
        if (selEstado) selEstado.value = '';
        if (this.vistaActual === 'funnel') this.cambiarVista('lista');
        this.aplicarFiltros();
    },

    renderChipsFiltrosActivos() {
        const bar = document.getElementById('chips-filtros-activos');
        const btnFiltros = document.getElementById('btn-toggle-filtros');
        const badgeCount = document.getElementById('badge-count-filtros');
        const chips = [];

        if (this.filtroZona) {
            chips.push({ label: `📍 ${this.filtroZona}`, clear: () => { this.filtroZona = ''; const s = document.getElementById('select-filtro-zona'); if (s) s.value = ''; this.aplicarFiltros(); } });
        }
        if (this.filtroNicho) {
            chips.push({ label: `🏷️ ${this.filtroNicho}`, clear: () => { this.filtroNicho = ''; const s = document.getElementById('select-filtro-nicho'); if (s) s.value = ''; this.aplicarFiltros(); } });
        }
        if (this.filtroSoloHoy) {
            chips.push({ label: `⭐ Agenda Hoy`, clear: () => { this.filtroSoloHoy = false; const s = document.getElementById('select-filtro-estado'); if (s) s.value = ''; this.aplicarFiltros(); } });
        }
        if (this.filtroEstado) {
            chips.push({ label: `📌 ${this.filtroEstado}`, clear: () => { this.filtroEstado = ''; const s = document.getElementById('select-filtro-estado'); if (s) s.value = ''; this.aplicarFiltros(); } });
        }

        if (badgeCount) {
            if (chips.length > 0) {
                badgeCount.style.display = 'inline-block';
                badgeCount.innerText = chips.length;
                btnFiltros?.classList.add('active-filter');
            } else {
                badgeCount.style.display = 'none';
                const panel = document.getElementById('panel-filtros-avanzados');
                if (panel && panel.style.display === 'none') {
                    btnFiltros?.classList.remove('active-filter');
                }
            }
        }

        if (!bar) return;
        if (chips.length === 0) {
            bar.style.display = 'none';
            bar.innerHTML = '';
            return;
        }

        bar.style.display = 'flex';
        bar.innerHTML = chips.map((c, idx) => `
            <span class="active-filter-chip" data-chip-idx="${idx}">
                ${c.label} <span style="opacity:0.8; font-weight:900;">✕</span>
            </span>
        `).join('');

        bar.querySelectorAll('.active-filter-chip').forEach(el => {
            const idx = Number(el.dataset.chipIdx);
            el.addEventListener('click', () => chips[idx]?.clear());
        });
    },

    // =========================================================
    // CARGA DE METRICAS, ZONAS Y LISTAS DE PRECIOS
    // =========================================================
    async cargarMetricas() {
        try {
            const res = await fetch('/api/logistica/prospectos/metricas');
            const json = await res.json();
            if (json.success && json.data) {
                const m = json.data;
                const vHoy = parseInt(m.visitas_hoy || 0);
                const vAtr = parseInt(m.visitas_atrasadas || 0);
                const totalPend = vHoy + vAtr;

                const btnHoy = document.getElementById('btn-filtro-agenda-hoy');
                if (btnHoy && totalPend > 0) {
                    btnHoy.innerHTML = `⭐ Agenda (${totalPend})`;
                    btnHoy.classList.add('has-pending');
                }
            }
        } catch (e) {
            console.error('[PROSPECTOS] Error cargando métricas:', e);
        }
    },

    async cargarZonas() {
        try {
            const res = await fetch('/api/logistica/prospectos/zonas');
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
                this.zonas = json.data;
                this.renderSelectorZonas();
            }
        } catch (e) {
            console.error('[PROSPECTOS] Error cargando zonas:', e);
        }
    },

    async cargarListasPrecios() {
        try {
            const res = await fetch('/api/logistica/bunker/listas');
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
                this.listasPrecios = json.data.filter(l => l.activa !== false);
            }
        } catch (e) {
            console.error('[PROSPECTOS] Error cargando listas de precios:', e);
        }
    },

    renderSelectorZonas() {
        const selectZona = document.getElementById('select-filtro-zona');
        if (selectZona) {
            let opts = `<option value="">📍 Todas las Zonas</option>`;
            this.zonas.forEach(z => {
                const sel = this.filtroZona === z ? 'selected' : '';
                opts += `<option value="${z}" ${sel}>📍 ${z}</option>`;
            });
            selectZona.innerHTML = opts;
        }
    },

    seleccionarZona(zona) {
        this.filtroZona = zona || '';
        this.aplicarFiltros();
    },

    seleccionarOrigen(origen) {
        if (origen === 'RADAR_WEB') {
            this.irATabPrincipal('RADAR_WEB');
        } else if (origen === 'CALLE') {
            this.irATabPrincipal('CALLE');
        } else {
            this.filtroOrigen = origen;
            this.aplicarFiltros();
        }
    },

    seleccionarNicho(nicho) {
        this.filtroNicho = nicho || '';
        this.aplicarFiltros();
    },

    esVisitaCallePropia(p) {
        // Es de "Mis Visitas" si fue cargado en calle/mostrador, o si ya está en la Hoja de Ruta, o si ya fue visitado/contactado
        if (p.origen_contacto !== 'RADAR_WEB') return true;
        if (this.estaEnRuta(p.id)) return true;
        if (p.estado && p.estado !== 'POR_VISITAR') return true;
        return false;
    },

    actualizarContadoresOrigen() {
        const totalCalle = this.prospectos.filter(p => p.origen_contacto !== 'RADAR_WEB' && p.origen_contacto !== 'CLIENTE_ACTIVO').length;
        const totalRadar = this.prospectos.filter(p => p.origen_contacto === 'RADAR_WEB').length;
        const lblCalle = document.getElementById('lbl-count-calle');
        const lblRadar = document.getElementById('lbl-count-radar');
        if (lblCalle) lblCalle.innerText = `(${totalCalle})`;
        if (lblRadar) lblRadar.innerText = `(${totalRadar})`;
        const hubCalle = document.getElementById('hub-count-territorio');
        const hubWeb = document.getElementById('hub-count-web');
        if (hubCalle) hubCalle.innerText = `(${totalCalle} ${totalCalle === 1 ? 'contacto' : 'contactos'})`;
        if (hubWeb) hubWeb.innerText = `(${totalRadar} detectados)`;
        const mapCalle = document.getElementById('lbl-capa-calle');
        const mapWeb = document.getElementById('lbl-capa-web');
        if (mapCalle) mapCalle.innerText = `Calle (${totalCalle})`;
        if (mapWeb) mapWeb.innerText = `Web (${totalRadar})`;
    },

    abrirStreetView(id) {
        const p = this.prospectos.find(x => Number(x.id) === Number(id));
        if (!p) return;
        if (p.latitud && p.longitud) {
            const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${parseFloat(p.latitud)},${parseFloat(p.longitud)}`;
            window.open(url, '_blank');
        } else if (p.direccion) {
            const q = encodeURIComponent(`${p.direccion}, ${p.zona || p.localidad || 'La Plata'}, Argentina`);
            window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank');
        }
    },

    verFichaVisualProspecto(id) {
        const p = this.prospectos.find(x => Number(x.id) === Number(id));
        if (!p) return;
        const enRuta = this.estaEnRuta(p.id);
        const esProductor = (p.rubro || '').toLowerCase().includes('productor') || (p.notas || '').toLowerCase().includes('productor');
        const streetViewUrl = (p.latitud && p.longitud)
            ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${parseFloat(p.latitud)},${parseFloat(p.longitud)}`
            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.direccion || p.nombre_fantasia}, ${p.zona || 'La Plata'}`)}`;
        const mapsDirUrl = (p.latitud && p.longitud)
            ? `https://www.google.com/maps/dir/?api=1&destination=${parseFloat(p.latitud)},${parseFloat(p.longitud)}`
            : streetViewUrl;

        Swal.fire({
            title: p.nombre_fantasia,
            html: `
                <div style="text-align: left; font-size: 0.85rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 0.65rem;">
                    ${p.imagen_url ? `
                        <div style="position: relative; border-radius: 0.75rem; overflow: hidden; border: 1px solid #334155; max-height: 170px;">
                            <img src="${p.imagen_url}" alt="${p.nombre_fantasia}" style="width: 100%; height: 165px; object-fit: cover; display: block;">
                            <div style="position: absolute; bottom: 8px; right: 8px; display: flex; gap: 6px;">
                                <a href="${streetViewUrl}" target="_blank" style="background: rgba(15, 23, 42, 0.9); color: #38bdf8; border: 1px solid #38bdf8; border-radius: 0.5rem; padding: 0.3rem 0.6rem; font-size: 0.74rem; font-weight: 800; text-decoration: none;">
                                    🏛️ Ver Fachada 360° (Street View)
                                </a>
                            </div>
                        </div>
                    ` : ''}

                    <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                        <span class="badge-prospecto-cod">${p.codigo_prospecto}</span>
                        <span class="badge-rubro">${p.rubro || 'Comercio'}</span>
                        ${p.zona ? `<span class="badge-zona">📍 ${p.zona}</span>` : ''}
                        ${esProductor ? `<span class="badge-productor-bulto">🏭 Productor (Cajas Cerradas)</span>` : ''}
                    </div>

                    <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid #334155; border-radius: 0.65rem; padding: 0.55rem; display: flex; flex-direction: column; gap: 0.3rem;">
                        <div>📍 <b>Dirección:</b> ${p.direccion || 'Sin especificar'} (${p.localidad || p.zona || 'Gran La Plata'})</div>
                        ${p.contacto_nombre ? `<div>👤 <b>Contacto:</b> ${p.contacto_nombre} (${p.contacto_rol || 'Contacto'})</div>` : ''}
                        ${p.telefono_whatsapp ? `<div>📱 <b>Teléfono:</b> <span style="color:#34d399; font-weight:800;">${this.formatearTelefono(p.telefono_whatsapp)}</span></div>` : ''}
                        ${p.web_redes ? `<div>🌐 <b>Web / Redes:</b> <span style="color:#38bdf8;">${p.web_redes}</span></div>` : ''}
                    </div>

                    ${p.notas ? `
                        <div style="background: rgba(234, 88, 12, 0.12); border-left: 3px solid #ea580c; border-radius: 0.5rem; padding: 0.55rem; font-size: 0.8rem; color: #f1f5f9; line-height: 1.4;">
                            ${p.notas}
                        </div>
                    ` : ''}

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.45rem; margin-top: 0.2rem;">
                        <a href="${streetViewUrl}" target="_blank" style="background: #334155; color: #f8fafc; border: 1px solid #475569; border-radius: 0.6rem; padding: 0.5rem; font-size: 0.78rem; font-weight: 800; text-align: center; text-decoration: none;">
                            🏛️ Ver Fachada Calle
                        </a>
                        <a href="${mapsDirUrl}" target="_blank" style="background: #0284c7; color: #ffffff; border: none; border-radius: 0.6rem; padding: 0.5rem; font-size: 0.78rem; font-weight: 800; text-align: center; text-decoration: none;">
                            🗺️ Cómo Llegar (GPS)
                        </a>
                    </div>
                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: enRuta ? '✅ Quitar de Hoja de Ruta' : '🚗 Sumar a Hoja de Ruta',
            cancelButtonText: 'Cerrar',
            confirmButtonColor: enRuta ? '#475569' : '#0284c7'
        }).then(res => {
            if (res.isConfirmed) {
                this.toggleEnRuta(p.id);
            }
        });
    },

    toggleFiltroAgendaHoy() {
        this.filtroSoloHoy = !this.filtroSoloHoy;
        this.aplicarFiltros();
    },

    seleccionarEstado(estado) {
        this.filtroEstado = this.filtroEstado === estado ? '' : estado;
        this.aplicarFiltros();
    },

    async cargarProspectos() {
        this.cargando = true;
        const container = document.getElementById('lista-prospectos-mobile');
        if (container && this.vistaActual === 'lista') {
            container.innerHTML = `
                <div style="padding: 2.5rem 1rem; text-align: center;">
                    <div class="loader-spinner" style="margin: 0 auto 0.75rem; width: 28px; height: 28px;"></div>
                    <p style="font-size: 0.85rem; color: #94a3b8;">Cargando red de prospectos en calle...</p>
                </div>
            `;
        }

        try {
            const res = await fetch('/api/logistica/prospectos?limit=500');
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
                this.prospectos = json.data;
                this.actualizarContadoresOrigen();
                this.aplicarFiltros();
            } else {
                throw new Error(json.error || 'Error al listar prospectos');
            }
        } catch (e) {
            console.error('[PROSPECTOS] Error:', e);
            if (container) {
                container.innerHTML = `
                    <div style="padding: 2rem 1rem; text-align: center; color: #f87171;">
                        <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">⚠️ No se pudo cargar el listado</p>
                        <p style="font-size: 0.8rem; color: #94a3b8;">${e.message}</p>
                        <button onclick="ProspectosMobileController.cargarProspectos()" style="margin-top: 1rem; background: #334155; border: none; color: white; padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: 700;">Reintentar</button>
                    </div>
                `;
            }
        } finally {
            this.cargando = false;
        }
    },

    aplicarFiltros(ajustarMapaBounds = false) {
        this.actualizarContadoresOrigen();
        this.renderChipsFiltrosActivos();
        let resultado = [...this.prospectos];

        // 0. Excluir las filas de visitas a Clientes Activos de las pestañas de prospección (se ven en la capa ⭐ Clientes del mapa)
        if (!this.filtroSoloRuta) {
            resultado = resultado.filter(p => p.origen_contacto !== 'CLIENTE_ACTIVO');
        }

        // 0b. Filtro de Capa de Origen (Separación clara Vía Territorio vs Vía Web)
        if (!this.filtroSoloRuta && !this.busquedaQuery) {
            if (this.filtroOrigen === 'CALLE') {
                resultado = resultado.filter(p => p.origen_contacto !== 'RADAR_WEB');
            } else if (this.filtroOrigen === 'RADAR_WEB') {
                resultado = resultado.filter(p => p.origen_contacto === 'RADAR_WEB');
            }
        }

        // 0a. Filtro por Ruta/Zona Lineal (si eligió NINGUNA, solo oculta las rutas del mapa sin vaciar los contactos)
        if (this.filtroRutaZonaId && this.filtroRutaZonaId !== 'NINGUNA') {
            const rIdNum = Number(this.filtroRutaZonaId);
            resultado = resultado.filter(p => {
                const info = this.obtenerRutasYDiasDeProspecto(p);
                return info.rutasIds.includes(rIdNum);
            });
        }

        // 0b-dia. Filtro por Día de la Semana y Turno (Mañana / Tarde)
        if (this.filtroDiaTurno) {
            const tokenBuscado = this.filtroDiaTurno === 'HOY_ACTUAL' ? this.obtenerTokenDiaTurnoActual() : this.filtroDiaTurno;
            resultado = resultado.filter(p => {
                const info = this.obtenerRutasYDiasDeProspecto(p);
                return info.diasTurnosTokens.includes(tokenBuscado);
            });
        }

        // 0b. Filtro por Nicho / Rubro
        if (this.filtroNicho) {
            const nLower = this.filtroNicho.toLowerCase();
            resultado = resultado.filter(p => (p.rubro || '').toLowerCase().includes(nLower));
        }

        // 1. Filtro por Zona
        if (this.filtroZona) {
            resultado = resultado.filter(p => (p.zona || '').toLowerCase() === this.filtroZona.toLowerCase());
        }

        // 2. Filtro por Estado
        if (this.filtroEstado) {
            resultado = resultado.filter(p => (p.estado || '').toUpperCase() === this.filtroEstado.toUpperCase());
        }

        // 3. Filtro Agenda de Hoy / Atrasadas
        if (this.filtroSoloHoy) {
            const hoy = new Date().toISOString().split('T')[0];
            resultado = resultado.filter(p => {
                if (!p.fecha_revisita) return false;
                const fRev = new Date(p.fecha_revisita).toISOString().split('T')[0];
                return fRev <= hoy && p.estado !== 'CONVERTIDO' && p.estado !== 'DESCARTADO';
            });
        }

        // 3b. Filtro Hoja de Ruta activa
        if (this.filtroSoloRuta) {
            resultado = resultado.filter(p => this.estaEnRuta(p.id));
        }

        // 4. Búsqueda de Texto (Universal LAMDA)
        if (this.busquedaQuery) {
            const terminos = this.busquedaQuery.split(/\s+/).filter(Boolean);
            resultado = resultado.filter(p => {
                const str = [
                    p.nombre_fantasia,
                    p.contacto_nombre,
                    p.direccion,
                    p.zona,
                    p.localidad,
                    p.telefono_whatsapp,
                    p.rubro,
                    p.codigo_prospecto,
                    p.web_redes,
                    p.notas
                ].filter(Boolean).join(' ').toLowerCase();
                return terminos.every(t => str.includes(t));
            });
        }

        this.prospectosFiltrados = resultado;

        if (this.vistaActual === 'lista') {
            this.renderListado();
        } else if (this.vistaActual === 'mapa') {
            this.initOrUpdateMapa(ajustarMapaBounds);
        } else if (this.vistaActual === 'funnel') {
            this.renderFunnelMobile();
        }
    },

    // =========================================================
    // VISTA 1: RENDERIZADO DEL LISTADO MÓVIL COMPACTO
    // =========================================================
    renderListado() {
        const container = document.getElementById('lista-prospectos-mobile');
        const contadorEl = document.getElementById('contador-prospectos-mobile');
        if (!container) return;

        if (contadorEl) {
            const etiquetaOrigen = this.filtroSoloRuta
                ? 'en Hoja de Ruta'
                : (this.filtroOrigen === 'CALLE' ? 'en Mis Visitas' : (this.filtroOrigen === 'RADAR_WEB' ? 'en Radar Web' : 'en total'));
            contadorEl.innerText = `${this.prospectosFiltrados.length} comercios ${etiquetaOrigen}`;
        }

        if (this.prospectosFiltrados.length === 0) {
            const sugerirRadar = (this.filtroOrigen === 'CALLE' || this.filtroSoloRuta) && this.prospectos.some(p => p.origen_contacto === 'RADAR_WEB');
            container.innerHTML = `
                <div style="background: #1e293b; border: 1px dashed rgba(255,255,255,0.15); border-radius: 1rem; padding: 2.2rem 1rem; text-align: center; margin-top: 0.75rem;">
                    <div style="font-size: 2rem; margin-bottom: 0.4rem;">🎯</div>
                    <h3 style="font-size: 1rem; color: #f8fafc; font-weight: 800; margin: 0 0 0.4rem;">${this.filtroSoloRuta ? 'Tu Hoja de Ruta está vacía' : 'No hay comercios en esta vista'}</h3>
                    <p style="font-size: 0.78rem; color: #94a3b8; max-width: 290px; margin: 0 auto 1rem;">
                        ${sugerirRadar
                            ? 'Tenés 24 comercios y productores preseleccionados en la pestaña "🌐 Radar" listos para explorar o sumar a tu ruta.'
                            : 'Probá cambiando los filtros o la búsqueda.'}
                    </p>
                    <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
                        ${sugerirRadar ? `
                            <button type="button" onclick="ProspectosMobileController.irATabPrincipal('RADAR_WEB')" style="background: #0284c7; color: white; border: none; padding: 0.6rem 1rem; font-size: 0.82rem; font-weight: 800; border-radius: 0.7rem; cursor: pointer;">
                                🌐 Explorar Radar (24)
                            </button>
                        ` : ''}
                        <button type="button" onclick="ProspectosMobileController.abrirModalAlta()" style="background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%); color: white; border: none; padding: 0.6rem 1rem; font-size: 0.82rem; font-weight: 800; border-radius: 0.7rem; cursor: pointer;">
                            ➕ Nueva Visita
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        const hoyStr = new Date().toISOString().split('T')[0];

        let html = '';
        this.prospectosFiltrados.forEach(p => {
            const badgeEstado = this.obtenerBadgeEstado(p.estado);
            const rubrosArr = (p.rubro || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            const rubroBadge = rubrosArr.map(r => `<span class="badge-rubro">${r}</span>`).join('');
            const esRadar = p.origen_contacto === 'RADAR_WEB';
            const esProductor = (p.rubro || '').toLowerCase().includes('productor') || (p.notas || '').toLowerCase().includes('cliente productor');
            const productorBadge = esProductor
                ? `<span class="badge-productor-bulto">🏭 Bulto</span>`
                : '';
            const hojaRutaBadge = p.id_ruta
                ? `<span style="font-size:0.65rem; font-weight:800; background:rgba(16,185,129,0.2); color:#6ee7b7; border:1px solid rgba(16,185,129,0.45); padding:1px 6px; border-radius:999px;">🛣️ ${p.ruta_nombre || 'En Hoja de Ruta'}</span>`
                : (p.en_pool_logistica
                    ? `<span onclick="ProspectosMobileController.cambiarPoolLogisticaRapido(${p.id}, false)" title="Tocar para retirar del Pool de Logística" style="font-size:0.65rem; font-weight:800; background:rgba(13,148,136,0.25); color:#5eead4; border:1px solid rgba(20,184,166,0.5); padding:1px 6px; border-radius:999px; cursor:pointer;">📥 En Pool Logística ✕</span>`
                    : '');
            const origenBadge = esRadar
                ? `<span style="font-size:0.65rem; font-weight:800; background:rgba(2,132,199,0.2); color:#7dd3fc; border:1px solid rgba(56,189,248,0.4); padding:1px 6px; border-radius:6px;">🌐 Web</span>`
                : (p.entramos_local || p.contacto_nombre
                    ? `<span style="font-size:0.65rem; font-weight:800; background:rgba(16,185,129,0.18); color:#6ee7b7; border:1px solid rgba(16,185,129,0.4); padding:1px 6px; border-radius:6px;">🚪 Entré al local</span>`
                    : `<span style="font-size:0.65rem; font-weight:800; background:rgba(234,88,12,0.18); color:#fdba74; border:1px solid rgba(249,115,22,0.4); padding:1px 6px; border-radius:6px;">🚶 Relevado afuera</span>`);

            const infoRutasDias = this.obtenerRutasYDiasDeProspecto(p);
            const badgesRutasZonaHtml = infoRutasDias.rutasObjetos.map(rz => `
                <span onclick="ProspectosMobileController.abrirModalVincularRutaDia(${p.id})" style="font-size:0.66rem; font-weight:800; background:rgba(15,23,42,0.9); color:#f8fafc; border:1px solid ${rz.color || '#10b981'}; border-left:4px solid ${rz.color || '#10b981'}; padding:1px 6px; border-radius:5px; cursor:pointer;">
                    🛣️ ${rz.nombre}
                </span>
            `).join('');
            const badgesDiasTurnosHtml = infoRutasDias.etiquetasDiasTurnos.length > 0
                ? `<span onclick="ProspectosMobileController.abrirModalVincularRutaDia(${p.id})" style="font-size:0.65rem; font-weight:800; background:rgba(250,204,21,0.14); color:#fde047; border:1px solid rgba(250,204,21,0.35); padding:1px 6px; border-radius:5px; cursor:pointer;">🗓️ ${infoRutasDias.etiquetasDiasTurnos.join(' • ')}</span>`
                : `<span onclick="ProspectosMobileController.abrirModalVincularRutaDia(${p.id})" style="font-size:0.65rem; font-weight:700; background:rgba(255,255,255,0.05); color:#94a3b8; border:1px dashed #475569; padding:1px 6px; border-radius:5px; cursor:pointer;">＋ Asignar Ruta/Día</span>`;

            const enRuta = this.estaEnRuta(p.id);

            // Check agenda
            let agendaHtml = '';
            if (p.fecha_revisita) {
                const f = new Date(p.fecha_revisita);
                const fIso = f.toISOString().split('T')[0];
                const horaStr = f.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const fechaStr = f.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
                const esHoy = fIso === hoyStr;
                const esAtrasada = fIso < hoyStr && p.estado !== 'CONVERTIDO';

                let estiloAgenda = 'background: rgba(255,255,255,0.06); color: #cbd5e1;';
                let tagAgenda = '📅';
                if (esHoy) {
                    estiloAgenda = 'background: rgba(234,179,8,0.2); color: #facc15; border: 1px solid rgba(234,179,8,0.4); font-weight: 800;';
                    tagAgenda = '⭐ ¡HOY!';
                } else if (esAtrasada) {
                    estiloAgenda = 'background: rgba(239,68,68,0.2); color: #fca5a5; border: 1px solid rgba(239,68,68,0.4); font-weight: 800;';
                    tagAgenda = '⚠️ Atrasada';
                }

                agendaHtml = `
                    <div style="margin-top: 0.4rem; padding: 0.3rem 0.55rem; border-radius: 0.5rem; font-size: 0.73rem; display: flex; align-items: center; justify-content: space-between; ${estiloAgenda}">
                        <span>${tagAgenda} Volver: <b>${fechaStr} ${horaStr}hs</b></span>
                        <button type="button" onclick="ProspectosMobileController.abrirModalReagendar(${p.id})" style="background: none; border: none; color: inherit; text-decoration: underline; font-size: 0.7rem; cursor: pointer; padding: 0;">Cambiar</button>
                    </div>
                `;
            }

            const waPhone = (p.telefono_whatsapp || '').replace(/[^\d]/g, '');
            const tieneWa = waPhone.length >= 8;

            html += `
                <div class="prospecto-card" id="card-prospecto-${p.id}">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.55rem;">
                        ${p.imagen_url ? `
                            <img src="${p.imagen_url}" alt="${p.nombre_fantasia}" class="prospecto-thumb" onclick="ProspectosMobileController.verFichaVisualProspecto(${p.id})" title="Ver ficha completa y fachada">
                        ` : ''}
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; align-items: center; gap: 0.28rem; flex-wrap: wrap; margin-bottom: 0.2rem;">
                                <span class="badge-prospecto-cod">${p.codigo_prospecto}</span>
                                ${origenBadge}
                                ${rubroBadge}
                                ${productorBadge}
                                ${hojaRutaBadge}
                            </div>
                            <h3 class="prospecto-titulo text-truncate" onclick="ProspectosMobileController.verFichaVisualProspecto(${p.id})" style="cursor: pointer;">${p.nombre_fantasia}</h3>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.25rem; flex-shrink: 0;">
                            ${badgeEstado}
                        </div>
                    </div>

                    <!-- Contacto y Ubicación Compactos -->
                    <div style="margin-top: 0.4rem; font-size: 0.78rem; color: #94a3b8; display: flex; flex-direction: column; gap: 0.18rem;">
                        ${p.direccion ? `
                            <div style="display: flex; align-items: center; gap: 0.3rem; color: #f1f5f9;">
                                <span>📍</span>
                                <span class="text-truncate">${p.direccion}${p.zona ? ` • <b style="color:#7dd3fc;">${p.zona}</b>` : ''}</span>
                            </div>
                        ` : ''}

                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
                            ${p.contacto_nombre ? `
                                <div style="display: flex; align-items: center; gap: 0.3rem; color: #cbd5e1;">
                                    <span>👤</span>
                                    <b>${p.contacto_nombre}</b>
                                    <span style="font-size: 0.68rem; color: #94a3b8;">(${p.contacto_rol || 'Contacto'})</span>
                                </div>
                            ` : (p.web_redes ? `
                                <div style="display: flex; align-items: center; gap: 0.3rem; color: #38bdf8; font-size: 0.72rem;">
                                    <span>🌐</span>
                                    <span>${p.web_redes}</span>
                                </div>
                            ` : '<div></div>')}

                            ${p.telefono_whatsapp ? `
                                <div style="display: flex; align-items: center; gap: 0.25rem; color: #34d399; font-weight: 700;">
                                    <span>📱</span>
                                    <span>${this.formatearTelefono(p.telefono_whatsapp)}</span>
                                </div>
                            ` : ''}
                        </div>

                        ${p.notas ? `
                            <div class="notas-clamp-2" onclick="ProspectosMobileController.verFichaVisualProspecto(${p.id})" title="Tocar para leer nota completa" style="margin-top: 0.2rem; font-size: 0.73rem; color: #cbd5e1; background: rgba(0,0,0,0.28); padding: 0.35rem 0.55rem; border-radius: 0.45rem; border-left: 2px solid ${esProductor ? '#f59e0b' : '#ea580c'}; line-height: 1.32;">
                                💡 <i>${p.notas}</i>
                            </div>
                        ` : ''}
                    </div>

                    <div style="margin-top: 0.38rem; display: flex; gap: 0.3rem; flex-wrap: wrap; align-items: center;">
                        ${badgesRutasZonaHtml}
                        ${badgesDiasTurnosHtml}
                    </div>

                    ${agendaHtml}

                    <!-- Barra Limpia de 4 Acciones (100% contenida en pantalla) -->
                    <div class="prospecto-actions-bar">
                        <button type="button" class="btn-action-prospecto btn-action-ruta ${(p.en_pool_logistica || p.id_ruta) ? 'en-ruta' : ''}" onclick="ProspectosMobileController.cambiarPoolLogisticaRapido(${p.id}, ${!(p.en_pool_logistica || p.id_ruta)})" style="${(p.en_pool_logistica || p.id_ruta) ? 'background:#0d9488; border-color:#14b8a6; color:#fff;' : 'border-color:rgba(20,184,166,0.5); color:#5eead4;'}">
                            <span>${(p.en_pool_logistica || p.id_ruta) ? '✅' : '📥'}</span> <span>${p.id_ruta ? 'En Ruta' : (p.en_pool_logistica ? 'En Pool' : 'a Logística')}</span>
                        </button>

                        <button type="button" class="btn-action-prospecto" onclick="ProspectosMobileController.abrirModalVincularRutaDia(${p.id})" style="border-color:rgba(16,185,129,0.35); color:#6ee7b7;">
                            <span>🗓️</span> <span>Ruta/Día</span>
                        </button>

                        ${tieneWa ? `
                            <button type="button" class="btn-action-prospecto btn-action-wa" onclick="ProspectosMobileController.abrirModalDespachoWhatsApp(${p.id})">
                                <span>💬</span> <span>WhatsApp</span>
                            </button>
                        ` : `
                            <button type="button" class="btn-action-prospecto" onclick="ProspectosMobileController.abrirModalEditar(${p.id})">
                                <span>✏️</span> <span>Cargar N°</span>
                            </button>
                        `}

                        <button type="button" class="btn-action-prospecto" onclick="ProspectosMobileController.abrirModalMenu(${p.id})">
                            <span>⚙️</span> <span>Menú</span>
                        </button>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        this.actualizarUIEstadoRuta();
    },

    obtenerBadgeEstado(estado) {
        switch (estado) {
            case 'POR_VISITAR':
                return '<span class="badge-status status-por-visitar">📌 Por Visitar</span>';
            case 'CONTACTO_INICIAL':
                return '<span class="badge-status status-inicial">🔵 Inicial</span>';
            case 'LISTA_ENVIADA':
                return '<span class="badge-status status-enviada">🟢 Lista Enviada</span>';
            case 'VISITA_AGENDADA':
                return '<span class="badge-status status-agendada">🟡 Agendado</span>';
            case 'EN_NEGOCIACION':
                return '<span class="badge-status status-negociacion">🟣 Negociación</span>';
            case 'CONVERTIDO':
                return '<span class="badge-status status-convertido">🚀 Cliente</span>';
            case 'DESCARTADO':
                return '<span class="badge-status status-descartado">⚪ Descartado</span>';
            default:
                return `<span class="badge-status status-inicial">${estado}</span>`;
        }
    },

    // =========================================================
    // VISTA 2: EXPLORADOR DE MAPA GEOGRÁFICO CON CAPAS DINÁMICAS
    // =========================================================
    toggleCapaMapa(capa) {
        if (!this.capasMapa) {
            this.capasMapa = { nodos: true, calle: true, web: true, clientes: false };
        }
        this.capasMapa[capa] = !this.capasMapa[capa];

        const btnNodos = document.getElementById('btn-capa-nodos');
        const btnCalle = document.getElementById('btn-capa-calle');
        const btnWeb = document.getElementById('btn-capa-web');
        const btnClientes = document.getElementById('btn-capa-clientes');

        btnNodos?.classList.toggle('active-nodos', Boolean(this.capasMapa.nodos));
        btnCalle?.classList.toggle('active-calle', Boolean(this.capasMapa.calle));
        btnWeb?.classList.toggle('active-web', Boolean(this.capasMapa.web));
        btnClientes?.classList.toggle('active-clientes', Boolean(this.capasMapa.clientes));

        // Redibujar sin mover el zoom actual para que la comparación visual sea inmediata
        this.initOrUpdateMapa(false);
    },

    initOrUpdateMapa(ajustarBounds = true) {
        const container = document.getElementById('mapa-prospectos-mobile');
        if (!container) return;

        let recienCreado = false;
        if (!this.mapaLeaflet) {
            this.mapaLeaflet = L.map('mapa-prospectos-mobile', {
                zoomControl: true,
                attributionControl: false
            }).setView([-34.90, -57.95], 12);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19
            }).addTo(this.mapaLeaflet);

            this.markersLayer = L.layerGroup().addTo(this.mapaLeaflet);
            recienCreado = true;
        } else {
            this.mapaLeaflet.invalidateSize();
        }

        this.markersLayer.clearLayers();
        const bounds = [];

        // 1. CAPAS DE CONTACTOS: 🚶 Vía Territorio (Calle) y 🌐 Vía Web (independientes)
        const contactosParaMapa = (this.prospectosFiltrados || []).filter(p => {
            if (!p.latitud || !p.longitud) return false;
            if (p.origen_contacto === 'CLIENTE_ACTIVO') return false;
            const esWeb = p.origen_contacto === 'RADAR_WEB';
            if (esWeb && !this.capasMapa?.web) return false;
            if (!esWeb && !this.capasMapa?.calle) return false;
            return true;
        });

        contactosParaMapa.forEach(p => {
            const lat = parseFloat(p.latitud);
            const lng = parseFloat(p.longitud);
            bounds.push([lat, lng]);

            const esWeb = p.origen_contacto === 'RADAR_WEB';
            const enRutaPin = this.estaEnRuta(p.id);
            const enLogisticaPin = Boolean(p.en_pool_logistica || p.id_ruta);
            const markerColor = enLogisticaPin
                ? '#0d9488'
                : (enRutaPin ? '#10b981' : (esWeb ? '#0284c7' : '#ea580c'));
            const pinEmoji = p.id_ruta ? '🛣️' : (p.en_pool_logistica ? '📥' : (enRutaPin ? '🚗' : (esWeb ? '🌐' : '🚶')));

            const markerIcon = L.divIcon({
                className: 'custom-pin-marker',
                html: `
                    <div style="background-color: ${markerColor}; width: 30px; height: 30px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; box-shadow: ${enLogisticaPin ? '0 0 0 3px rgba(20,184,166,0.55), ' : ''}0 3px 8px rgba(0,0,0,0.5); border: 2px solid #ffffff;">
                        <span style="transform: rotate(45deg); font-size: 13px; color: white;">${pinEmoji}</span>
                    </div>
                `,
                iconSize: [30, 30],
                iconAnchor: [15, 30],
                popupAnchor: [0, -30]
            });

            const marker = L.marker([lat, lng], { icon: markerIcon });
            const googleNavUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
            const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;

            const estadoLogisticaBanner = p.id_ruta
                ? `<div style="background:rgba(16,185,129,0.22); border:1px solid #10b981; color:#6ee7b7; font-size:0.7rem; font-weight:800; padding:3px 7px; border-radius:5px; margin-bottom:5px;">🛣️ EN HOJA DE RUTA: ${p.ruta_nombre || '#' + p.id_ruta}</div>`
                : (p.en_pool_logistica
                    ? `<div style="background:rgba(13,148,136,0.25); border:1px solid #14b8a6; color:#5eead4; font-size:0.7rem; font-weight:800; padding:3px 7px; border-radius:5px; margin-bottom:5px;">📥 EN POOL DE LOGÍSTICA (Listo p/ Ruta)</div>`
                    : '');

            const popupHtml = `
                <div style="min-width: 235px; max-width: 270px; font-family: inherit; font-size: 0.82rem; color: #f8fafc; padding: 4px;">
                    ${p.imagen_url ? `
                        <img src="${p.imagen_url}" alt="${p.nombre_fantasia}" style="width: 100%; height: 90px; object-fit: cover; border-radius: 6px; margin-bottom: 6px; border: 1px solid #334155;">
                    ` : ''}
                    <div style="font-size: 0.69rem; color: ${esWeb ? '#7dd3fc' : '#fdba74'}; font-weight: 800; margin-bottom: 2px;">
                        ${esWeb ? '🌐 VÍA WEB' : '🚶 VÍA TERRITORIO'} • ${p.rubro || 'Comercio'}
                    </div>
                    <h4 style="margin: 0 0 4px; font-size: 0.95rem; font-weight: 900; color: #ffffff;">${p.nombre_fantasia}</h4>
                    <div style="color: #94a3b8; font-size: 0.74rem; margin-bottom: 5px;">
                        📍 ${p.direccion || 'Sin dirección'}${p.zona ? ` • <b style="color:#7dd3fc;">${p.zona}</b>` : ''}
                    </div>
                    ${estadoLogisticaBanner}
                    ${p.notas ? `<div style="font-size: 0.71rem; color: #cbd5e1; background: rgba(0,0,0,0.3); padding: 4px 6px; border-radius: 4px; margin-bottom: 6px; max-height: 70px; overflow-y: auto;">💡 ${p.notas}</div>` : ''}
                    
                    <!-- Acción Determinista Principal hacia Logística -->
                    <div style="display: flex; gap: 4px; margin-top: 6px;">
                        ${enLogisticaPin ? `
                            <button type="button" onclick="ProspectosMobileController.cambiarPoolLogisticaRapido(${p.id}, false)" style="flex: 1.3; background: #b91c1c; color: white; border: 1px solid #f87171; padding: 6px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 800; cursor: pointer;">
                                ↩️ Quitar de Logística
                            </button>
                            <button type="button" onclick="ProspectosMobileController.abrirModalEnviarAHojaDeRuta([${p.id}])" style="flex: 1; background: #0f766e; color: white; border: 1px solid #2dd4bf; padding: 6px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 800; cursor: pointer;">
                                🛣️ Ruta...
                            </button>
                        ` : `
                            <button type="button" onclick="ProspectosMobileController.cambiarPoolLogisticaRapido(${p.id}, true)" style="flex: 1.5; background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); color: white; border: 1px solid #2dd4bf; padding: 6px 8px; border-radius: 6px; font-size: 0.73rem; font-weight: 900; cursor: pointer; box-shadow: 0 2px 6px rgba(13,148,136,0.4);">
                                📥 Enviar a Pool Logística
                            </button>
                            <button type="button" onclick="ProspectosMobileController.abrirModalEnviarAHojaDeRuta([${p.id}])" style="flex: 1; background: #1e293b; color: #5eead4; border: 1px solid #14b8a6; padding: 6px 7px; border-radius: 6px; font-size: 0.71rem; font-weight: 800; cursor: pointer;">
                                🛣️ A Ruta...
                            </button>
                        `}
                    </div>

                    <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 5px;">
                        <button type="button" onclick="ProspectosMobileController.toggleEnRuta(${p.id})" style="flex: 1; background: ${enRutaPin ? '#059669' : '#334155'}; color: white; border: 1px solid #38bdf8; padding: 4px 6px; border-radius: 6px; font-size: 0.69rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
                            ${enRutaPin ? '✅ Selec.' : '🚗 +Selec.'}
                        </button>
                        <a href="${streetViewUrl}" target="_blank" style="flex: 1; background: #475569; color: white; padding: 4px 6px; border-radius: 6px; text-decoration: none; font-size: 0.69rem; font-weight: 800; text-align: center; white-space: nowrap;">
                            🏛️ Fachada
                        </a>
                        <button type="button" onclick="ProspectosMobileController.abrirModalUbicarContactoEnMapa(${p.id})" style="flex: 1; background: #475569; color: #fde047; border: 1px solid #facc15; padding: 4px 6px; border-radius: 6px; font-size: 0.69rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
                            📌 Mover
                        </button>
                        <a href="${googleNavUrl}" target="_blank" style="flex: 1; background: #0369a1; color: white; padding: 4px 6px; border-radius: 6px; text-decoration: none; font-size: 0.69rem; font-weight: 800; text-align: center; white-space: nowrap;">
                            📍 Ir
                        </a>
                    </div>
                </div>
            `;

            marker.bindPopup(popupHtml);
            this.markersLayer.addLayer(marker);
        });

        // 2. CAPA DE CLIENTES ACTUALES DE LAMDA (⭐ Clientes ON / OFF)
        if (this.capasMapa?.clientes && Array.isArray(this.clientesDomicilios)) {
            this.clientesDomicilios.forEach(cli => {
                const cLat = parseFloat(cli.latitud);
                const cLng = parseFloat(cli.longitud);
                if (isNaN(cLat) || isNaN(cLng)) return;
                bounds.push([cLat, cLng]);

                const nombreCli = cli.cliente_nombre || cli.alias || `Cliente #${cli.id_cliente}`;
                const subAlias = (cli.alias && cli.cliente_nombre && cli.alias.toLowerCase() !== cli.cliente_nombre.toLowerCase())
                    ? ` (${cli.alias})`
                    : '';

                const visitaCli = this.obtenerVisitaActivaDeCliente(cli);
                const enLogisticaCli = Boolean(visitaCli && (visitaCli.en_pool_logistica || visitaCli.id_ruta));

                const cliIcon = L.divIcon({
                    className: 'cliente-activo-pin',
                    html: `
                        <div style="background: ${enLogisticaCli ? 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)' : 'linear-gradient(135deg, #9333ea 0%, #6b21a8 100%)'}; width: 30px; height: 30px; border-radius: 999px; display: flex; align-items: center; justify-content: center; box-shadow: ${enLogisticaCli ? '0 0 0 4px rgba(16,185,129,0.55), ' : ''}0 3px 10px rgba(147,51,234,0.65); border: 2px solid #fde047;">
                            <span style="font-size: 13px;">${enLogisticaCli ? '📥' : '⭐'}</span>
                        </div>
                    `,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15],
                    popupAnchor: [0, -15]
                });

                const mCli = L.marker([cLat, cLng], { icon: cliIcon });
                const navCliUrl = `https://www.google.com/maps/dir/?api=1&destination=${cLat},${cLng}`;

                const bannerEstadoCli = visitaCli?.id_ruta
                    ? `<div style="margin-top:5px; background:rgba(16,185,129,0.22); border:1px solid #10b981; color:#6ee7b7; font-size:0.7rem; font-weight:800; padding:3px 7px; border-radius:5px;">🛣️ EN HOJA DE RUTA: ${visitaCli.ruta_nombre || '#' + visitaCli.id_ruta} (Visita s/pedido)</div>`
                    : (visitaCli?.en_pool_logistica
                        ? `<div style="margin-top:5px; background:rgba(13,148,136,0.25); border:1px solid #14b8a6; color:#5eead4; font-size:0.7rem; font-weight:800; padding:3px 7px; border-radius:5px;">📥 EN POOL DE LOGÍSTICA (Visita s/pedido)</div>`
                        : '');

                mCli.bindPopup(`
                    <div style="min-width: 225px; max-width: 265px; font-size: 0.8rem; color: #f8fafc; padding: 4px;">
                        <div style="font-size: 0.68rem; font-weight: 900; color: #e9d5ff; background: rgba(147,51,234,0.28); border: 1px solid #c084fc; display: inline-block; padding: 1px 6px; border-radius: 999px; margin-bottom: 4px;">
                            ⭐ CLIENTE ACTIVO LAMDA
                        </div>
                        <div style="font-size: 0.94rem; font-weight: 900; color: #ffffff;">${nombreCli}${subAlias}</div>
                        <div style="color: #cbd5e1; font-size: 0.74rem; margin-top: 3px;">
                            📍 ${cli.direccion || 'Sin dirección'}${cli.localidad ? ` • <b style="color:#fde047;">${cli.localidad}</b>` : ''}
                        </div>
                        ${cli.telefono_contacto ? `<div style="color:#34d399; font-size:0.74rem; font-weight:800; margin-top:3px;">📱 ${this.formatearTelefono(cli.telefono_contacto)}</div>` : ''}
                        ${cli.instrucciones_entrega ? `<div style="color:#94a3b8; font-size:0.7rem; margin-top:3px;">💬 ${cli.instrucciones_entrega}</div>` : ''}
                        ${bannerEstadoCli}
                        ${visitaCli?.notas && enLogisticaCli ? `<div style="color:#cbd5e1; font-size:0.7rem; background:rgba(0,0,0,0.3); padding:3px 6px; border-radius:4px; margin-top:4px;">💡 ${visitaCli.notas}</div>` : ''}

                        <div style="display: flex; flex-direction: column; gap: 5px; margin-top: 8px;">
                            ${enLogisticaCli ? `
                                <div style="display: flex; gap: 4px;">
                                    <button type="button" onclick="ProspectosMobileController.enviarClienteActivoAPoolRapido(${cli.id}, false)" style="flex: 1.2; background: #b91c1c; color: #fff; border: 1px solid #f87171; padding: 6px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 800; cursor: pointer;">
                                        ↩️ Quitar de Logística
                                    </button>
                                    <button type="button" onclick="ProspectosMobileController.abrirModalVisitaClienteActivo(${cli.id})" style="flex: 1; background: #0f766e; color: #fff; border: 1px solid #2dd4bf; padding: 6px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 800; cursor: pointer;">
                                        🛣️ Ruta / Nota...
                                    </button>
                                </div>
                            ` : `
                                <button type="button" onclick="ProspectosMobileController.enviarClienteActivoAPoolRapido(${cli.id}, true)" style="width: 100%; background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); color: #ffffff; border: 1px solid #2dd4bf; padding: 7px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 900; cursor: pointer; box-shadow: 0 2px 8px rgba(13,148,136,0.45);">
                                    📥 Enviar a Pool Logística (Visita s/pedido)
                                </button>
                                <button type="button" onclick="ProspectosMobileController.abrirModalVisitaClienteActivo(${cli.id})" style="width: 100%; background: #1e293b; color: #5eead4; border: 1px solid #14b8a6; padding: 5px 8px; border-radius: 6px; font-size: 0.71rem; font-weight: 800; cursor: pointer;">
                                    🛣️ Asignar directo a Hoja de Ruta / Nota...
                                </button>
                            `}
                            <a href="${navCliUrl}" target="_blank" style="display:block; background:#7e22ce; color:#fff; text-align:center; padding:5px 8px; border-radius:6px; text-decoration:none; font-size:0.72rem; font-weight:800;">
                                📍 Cómo llegar al Cliente
                            </a>
                        </div>
                    </div>
                `);
                this.markersLayer.addLayer(mCli);
            });
        }

        // 3. CAPA DE NODOS DE CABECERA: 🏠 Mi Casa y 🏭 Depósito LAMDA (ON / OFF)
        if (this.capasMapa?.nodos) {
            const nodos = this.configRutasDias?.nodos || [];
            nodos.forEach(n => {
                if (!n.latitud || !n.longitud) return;
                const nLat = parseFloat(n.latitud);
                const nLng = parseFloat(n.longitud);
                bounds.push([nLat, nLng]);
                const nIcon = L.divIcon({
                    className: 'nodo-cabecera-pin',
                    html: `<div style="background:#0f172a; color:#fff; border:2.5px solid #10b981; border-radius:999px; width:34px; height:34px; display:flex; align-items:center; justify-content:center; font-size:17px; box-shadow:0 4px 10px rgba(0,0,0,0.65);">${n.icono || '🏠'}</div>`,
                    iconSize: [34, 34],
                    iconAnchor: [17, 17]
                });
                const mNodo = L.marker([nLat, nLng], { icon: nIcon, draggable: true });
                mNodo.on('dragend', async (ev) => {
                    const pos = ev.target.getLatLng();
                    await this.guardarUbicacionRapidaNodo(n, pos.lat, pos.lng);
                });
                mNodo.bindPopup(`
                    <div style="font-size:0.82rem; color:#f8fafc; padding:4px;">
                        <div style="font-weight:900; color:#34d399; font-size:0.9rem;">${n.icono || '🏠'} ${n.nombre}</div>
                        <div style="color:#cbd5e1; font-size:0.75rem; margin-top:2px;">${n.direccion || 'Punto de salida / regreso'}</div>
                        <button type="button" onclick="ProspectosMobileController.abrirModalEditarNodo(${n.id})" style="margin-top:6px; width:100%; background:#059669; color:#fff; border:1px solid #10b981; border-radius:5px; padding:5px 8px; font-size:0.74rem; font-weight:800; cursor:pointer;">🗺️ Reubicar en Mapa</button>
                    </div>
                `);
                this.markersLayer.addLayer(mNodo);
            });
        }

        // 4. CAPA DE RUTAS Y SUPERFICIES DE INFLUENCIA (Todas | Ninguna | Una Ruta sola)
        if (this.filtroRutaZonaId !== 'NINGUNA') {
            const rutasZona = this.configRutasDias?.rutas_zona || [];
            const cronograma = this.configRutasDias?.cronograma || [];
            const tokenTurnoActivo = this.filtroDiaTurno
                ? (this.filtroDiaTurno === 'HOY_ACTUAL' ? this.obtenerTokenDiaTurnoActual() : this.filtroDiaTurno)
                : '';

            rutasZona.forEach(rz => {
                // Si eligió ver 1 ruta específica, mostrar solo esa
                if (this.filtroRutaZonaId && Number(this.filtroRutaZonaId) !== Number(rz.id)) return;

                // Si eligió un Turno (ej: Lun Mañana) y está en "Todas las Rutas", mostrar solo las rutas de ese turno
                if (!this.filtroRutaZonaId && tokenTurnoActivo) {
                    const [dBusc, tBusc] = tokenTurnoActivo.split('_');
                    const perteneceATurno = cronograma.some(
                        c => Number(c.ruta_zona_id) === Number(rz.id) && Number(c.dia_semana) === Number(dBusc) && c.turno === tBusc
                    );
                    if (!perteneceATurno) return;
                }

                const colorRz = rz.color || '#ea580c';
                if (rz.nodo_salida_lat && rz.nodo_salida_lng && rz.nodo_llegada_lat && rz.nodo_llegada_lng) {
                    const pts = [[parseFloat(rz.nodo_salida_lat), parseFloat(rz.nodo_salida_lng)]];
                    if (Array.isArray(rz.waypoints_json)) {
                        rz.waypoints_json.forEach(wp => {
                            if (wp.lat && wp.lng) pts.push([parseFloat(wp.lat), parseFloat(wp.lng)]);
                        });
                    }
                    pts.push([parseFloat(rz.nodo_llegada_lat), parseFloat(rz.nodo_llegada_lng)]);

                    let polyCoords = [];
                    if (Array.isArray(rz.poligono_json) && rz.poligono_json.length >= 3) {
                        polyCoords = rz.poligono_json
                            .filter(v => v && v.lat && v.lng)
                            .map(v => [parseFloat(v.lat), parseFloat(v.lng)]);
                    } else if (pts.length >= 2) {
                        const generado = this.generarPoligonoBufferDeCamino(
                            pts.map(p => ({ lat: p[0], lng: p[1] })),
                            Number(rz.ancho_metros) || 350
                        );
                        polyCoords = generado.map(v => [v.lat, v.lng]);
                    }

                    const popupRutaHtml = `
                        <div style="font-size:0.8rem; color:#f8fafc; min-width:190px;">
                            <b style="color:${colorRz}; font-size:0.88rem;">🛣️ ${rz.nombre}</b><br>
                            <span style="font-size:0.72rem; color:#cbd5e1;">Ancho base: ~${rz.ancho_metros || 350}m • ${rz.calles_involucradas || 'Superficie activa'}</span>
                            <button type="button" onclick="ProspectosMobileController.abrirModalEditarRutaZona(${rz.id})" style="margin-top:6px; width:100%; background:#ea580c; color:#fff; border:none; border-radius:5px; padding:5px 8px; font-size:0.73rem; font-weight:800; cursor:pointer;">
                                ✋ Editar Ruta / Deformar Superficie
                            </button>
                        </div>
                    `;

                    if (polyCoords.length >= 3) {
                        polyCoords.forEach(c => bounds.push(c));
                        const surfacePoly = L.polygon(polyCoords, {
                            color: colorRz,
                            weight: 2,
                            opacity: 0.78,
                            fillColor: colorRz,
                            fillOpacity: 0.16
                        });
                        surfacePoly.bindPopup(popupRutaHtml);
                        this.markersLayer.addLayer(surfacePoly);
                    }

                    const poly = L.polyline(pts, {
                        color: colorRz,
                        weight: 3,
                        opacity: 0.85,
                        dashArray: '7, 7'
                    });
                    poly.bindPopup(popupRutaHtml);
                    this.markersLayer.addLayer(poly);
                }
            });
        }

        if ((ajustarBounds || recienCreado) && bounds.length > 0) {
            this.mapaLeaflet.fitBounds(bounds, { padding: [32, 32], maxZoom: 15 });
        }
    },

    toggleFullscreenMapaGeneral() {
        const container = document.getElementById('vista-mapa-mobile');
        const btn = document.getElementById('btn-toggle-fullscreen-mapa');
        if (!container) return;
        const activo = container.classList.toggle('mapa-general-fullscreen');
        if (btn) {
            btn.innerHTML = activo ? '🗗 Achicar' : '⛶ Maximizar';
            btn.style.background = activo
                ? 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)'
                : 'linear-gradient(135deg, #059669 0%, #047857 100%)';
        }
        setTimeout(() => {
            if (this.mapaLeaflet) {
                this.mapaLeaflet.invalidateSize();
            }
        }, 120);
    },

    getMarkerHexColor(estado) {
        switch (estado) {
            case 'POR_VISITAR': return '#f97316';     // Naranja brillante (Pin por visitar)
            case 'VISITA_AGENDADA': return '#eab308'; // Amarillo
            case 'LISTA_ENVIADA': return '#10b981';   // Verde
            case 'CONTACTO_INICIAL': return '#3b82f6';// Azul
            case 'EN_NEGOCIACION': return '#a855f7';  // Violeta
            case 'CONVERTIDO': return '#059669';      // Esmeralda
            case 'DESCARTADO': return '#94a3b8';      // Gris
            default: return '#ea580c';
        }
    },

    localizarUsuarioEnMapa() {
        if (!navigator.geolocation) {
            Swal.fire({ icon: 'warning', title: 'GPS no soportado', background: '#1e293b', color: '#fff' });
            return;
        }

        Swal.fire({
            title: 'Obteniendo GPS...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading(),
            background: '#1e293b',
            color: '#fff',
            timer: 2000
        });

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                Swal.close();
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;

                if (!this.mapaLeaflet) this.initOrUpdateMapa();

                if (this.userLocationMarker) {
                    this.userLocationMarker.setLatLng([lat, lng]);
                } else {
                    const userIcon = L.divIcon({
                        className: 'user-pin',
                        html: '<div class="user-gps-pulse" title="Tu posición actual"></div>',
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });
                    this.userLocationMarker = L.marker([lat, lng], { icon: userIcon }).addTo(this.mapaLeaflet);
                    this.userLocationMarker.bindPopup('<b>📍 Estás Acá</b><br>Radio de Preventa en vivo.');
                }

                this.mapaLeaflet.setView([lat, lng], 15);
                this.userLocationMarker.openPopup();
            },
            (err) => {
                Swal.close();
                Swal.fire({
                    icon: 'warning',
                    title: 'Sin señal GPS',
                    text: 'Verificá que el GPS del celular esté activado y con permisos concedidos.',
                    background: '#1e293b',
                    color: '#fff'
                });
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    },

    // =========================================================
    // VISTA 3: EMBUDO COMERCIAL MÓVIL (FUNNEL DE CONVERSIÓN)
    // =========================================================
    renderFunnelMobile() {
        const containerSteps = document.getElementById('funnel-steps-mobile');
        const containerZonas = document.getElementById('funnel-zonas-mobile');
        if (!containerSteps) return;

        const total = this.prospectos.length;
        const conLista = this.prospectos.filter(p => ['LISTA_ENVIADA', 'VISITA_AGENDADA', 'EN_NEGOCIACION', 'CONVERTIDO'].includes(p.estado)).length;
        const conAgenda = this.prospectos.filter(p => ['VISITA_AGENDADA', 'EN_NEGOCIACION', 'CONVERTIDO'].includes(p.estado)).length;
        const convertidos = this.prospectos.filter(p => p.estado === 'CONVERTIDO').length;

        const pctLista = total > 0 ? Math.round((conLista / total) * 100) : 0;
        const pctAgenda = total > 0 ? Math.round((conAgenda / total) * 100) : 0;
        const pctConvertidos = total > 0 ? Math.round((convertidos / total) * 100) : 0;

        containerSteps.innerHTML = `
            <div class="funnel-mobile-step" style="border-left: 5px solid #3b82f6;">
                <div class="funnel-mobile-bg" style="width: 100%; background: #3b82f6;"></div>
                <div>
                    <div style="font-size: 0.85rem; font-weight: 800; color: #f8fafc;">1️⃣ Contactados</div>
                    <div style="font-size: 0.72rem; color: #94a3b8;">Base de comercios visitados</div>
                </div>
                <div style="text-align: right; font-size: 1.15rem; font-weight: 900; color: #60a5fa;">
                    ${total} <span style="font-size: 0.75rem; color: #94a3b8;">(100%)</span>
                </div>
            </div>

            <div class="funnel-mobile-step" style="border-left: 5px solid #10b981;">
                <div class="funnel-mobile-bg" style="width: ${pctLista}%; background: #10b981;"></div>
                <div>
                    <div style="font-size: 0.85rem; font-weight: 800; color: #f8fafc;">2️⃣ Lista Enviada</div>
                    <div style="font-size: 0.72rem; color: #94a3b8;">Catálogo PDF despachado</div>
                </div>
                <div style="text-align: right; font-size: 1.15rem; font-weight: 900; color: #34d399;">
                    ${conLista} <span style="font-size: 0.75rem; color: #34d399;">(${pctLista}%)</span>
                </div>
            </div>

            <div class="funnel-mobile-step" style="border-left: 5px solid #eab308;">
                <div class="funnel-mobile-bg" style="width: ${pctAgenda}%; background: #eab308;"></div>
                <div>
                    <div style="font-size: 0.85rem; font-weight: 800; color: #f8fafc;">3️⃣ Visitas Agendadas</div>
                    <div style="font-size: 0.72rem; color: #94a3b8;">Seguimiento programado</div>
                </div>
                <div style="text-align: right; font-size: 1.15rem; font-weight: 900; color: #facc15;">
                    ${conAgenda} <span style="font-size: 0.75rem; color: #facc15;">(${pctAgenda}%)</span>
                </div>
            </div>

            <div class="funnel-mobile-step" style="border-left: 5px solid #059669; background: rgba(5, 150, 105, 0.12);">
                <div class="funnel-mobile-bg" style="width: ${pctConvertidos}%; background: #059669;"></div>
                <div>
                    <div style="font-size: 0.85rem; font-weight: 900; color: #34d399;">🚀 Clientes Cerrados</div>
                    <div style="font-size: 0.72rem; color: #6ee7b7;">Promovidos a clientes formales</div>
                </div>
                <div style="text-align: right; font-size: 1.15rem; font-weight: 900; color: #34d399;">
                    ${convertidos} <span style="font-size: 0.75rem; color: #34d399;">(${pctConvertidos}%)</span>
                </div>
            </div>
        `;

        // Ranking de Zonas
        const zonasMap = {};
        this.prospectos.forEach(p => {
            const z = p.zona || 'Sin Zona';
            if (!zonasMap[z]) zonasMap[z] = { total: 0, convertidos: 0 };
            zonasMap[z].total++;
            if (p.estado === 'CONVERTIDO') zonasMap[z].convertidos++;
        });

        const ranking = Object.entries(zonasMap)
            .map(([zona, data]) => ({ zona, ...data }))
            .sort((a, b) => b.total - a.total);

        if (ranking.length === 0) {
            containerZonas.innerHTML = '<p style="color: #94a3b8; font-size: 0.8rem;">No hay prospectos cargados.</p>';
            return;
        }

        const maxTotal = ranking[0].total || 1;
        let htmlZonas = '';
        ranking.forEach(r => {
            const fillPct = Math.round((r.total / maxTotal) * 100);
            htmlZonas += `
                <div class="zone-bar-mobile">
                    <div style="width: 105px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #cbd5e1;">
                        📍 ${r.zona}
                    </div>
                    <div class="zone-track-mobile">
                        <div class="zone-fill-mobile" style="width: ${fillPct}%;"></div>
                    </div>
                    <div style="font-weight: 800; width: 70px; text-align: right; color: #f8fafc;">
                        ${r.total} <span style="font-size: 0.72rem; color: #34d399;">(${r.convertidos} 🚀)</span>
                    </div>
                </div>
            `;
        });

        containerZonas.innerHTML = htmlZonas;
    },

    // =========================================================
    // MODAL DE CARGA RÁPIDA IN SITU (SIMPLIFICADO EN 2 MODOS)
    // =========================================================
    async abrirModalAlta(modoInicial = 'visita') {
        const sesion = (typeof obtenerSesion === 'function') ? obtenerSesion() : null;
        const usuarioActual = sesion ? (sesion.nombre || sesion.usuario || 'operador') : 'calle';
        this.modoAltaActual = modoInicial;

        const opcionesListasHtml = this.listasPrecios.map(l => `
            <option value="${l.id}" ${l.nombre.toLowerCase().includes('dietetica') ? 'selected' : ''}>
                📋 ${l.nombre}
            </option>
        `).join('');

        const { value: formValues } = await Swal.fire({
            title: '🎯 Preventa en Calle',
            html: `
                <div style="text-align: left; font-size: 0.88rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 0.65rem;">
                    
                    <!-- Selector de Modo: Entré al Local vs Puntear al Pasar -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; background: #0f172a; padding: 0.3rem; border-radius: 0.75rem; border: 1px solid #334155;">
                        <button type="button" id="btn-modo-visita" onclick="ProspectosMobileController.cambiarModoAlta('visita')" style="background: #ea580c; color: #fff; border: none; border-radius: 0.55rem; padding: 0.45rem 0.4rem; font-size: 0.78rem; font-weight: 800; cursor: pointer; transition: all 0.15s;">
                            🤝 Entré al Local
                        </button>
                        <button type="button" id="btn-modo-pin" onclick="ProspectosMobileController.cambiarModoAlta('pin')" style="background: transparent; color: #94a3b8; border: none; border-radius: 0.55rem; padding: 0.45rem 0.4rem; font-size: 0.78rem; font-weight: 800; cursor: pointer; transition: all 0.15s;">
                            📌 Puntear al Pasar
                        </button>
                    </div>

                    <!-- Banner GPS Automático -->
                    <div style="background: rgba(234, 88, 12, 0.12); border: 1px dashed #ea580c; border-radius: 0.75rem; padding: 0.5rem 0.65rem; display: flex; align-items: center; justify-content: space-between; gap: 0.4rem;">
                        <div style="min-width: 0; flex: 1;">
                            <div style="font-size: 0.72rem; font-weight: 800; color: #fdba74;">📍 Ubicación GPS Automática</div>
                            <div id="gps-status-lbl" style="font-size: 0.7rem; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Detectando ubicación actual...</div>
                        </div>
                        <button type="button" id="btn-capturar-gps" onclick="ProspectosMobileController.capturarUbicacionGps(false)" style="background: #334155; color: #f8fafc; border: 1px solid #475569; border-radius: 0.5rem; padding: 0.3rem 0.55rem; font-size: 0.7rem; font-weight: 700; cursor: pointer; flex-shrink: 0;">
                            🔄 GPS
                        </button>
                    </div>

                    <input type="hidden" id="modal-lat" value="">
                    <input type="hidden" id="modal-lng" value="">

                    <!-- Nombre de Fantasía / Cartel -->
                    <div>
                        <label id="lbl-modal-nombre" style="font-size: 0.75rem; font-weight: 800; color: #f8fafc; display: block; margin-bottom: 0.2rem;">
                            Cartel / Nombre del Local <span style="color:#ef4444;">*</span>
                        </label>
                        <input id="modal-nombre" class="wizard-input-mobile" placeholder="Ej: La Triestina / Autoservicio" style="font-size: 0.95rem; font-weight: 700;">
                    </div>

                    <!-- Multi-Rubro Rápido -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                            <label style="font-size: 0.74rem; font-weight: 800; color: #cbd5e1; margin: 0;">
                                Rubro(s) <span style="font-weight: 600; color: #94a3b8; font-size: 0.68rem;">(podés tocar más de uno)</span>
                            </label>
                            <button type="button" onclick="ProspectosMobileController.abrirModalAdministrarRubros()" style="background: none; border: none; color: #fdba74; font-size: 0.7rem; font-weight: 700; cursor: pointer; padding: 0; text-decoration: underline;">
                                ⚙️ Rubros
                            </button>
                        </div>
                        <div id="modal-rubros-container" style="display: flex; gap: 0.35rem; flex-wrap: wrap;"></div>
                        <div id="modal-rubro-custom-box" style="display: none; margin-top: 0.35rem;">
                            <input id="modal-rubro-custom" class="wizard-input-mobile" placeholder="✏️ Otro rubro (ej: Herboristería, Repostería...)" oninput="ProspectosMobileController.sincronizarInputRubros('modal')" style="font-size: 0.82rem; border-color: #ea580c;">
                        </div>
                        <input type="hidden" id="modal-rubro-input" value="Dietética">
                    </div>

                    <!-- BLOQUE MOSTRADOR (Solo visible en modo 'visita') -->
                    <div id="bloque-visita-mostrador" style="display: flex; flex-direction: column; gap: 0.6rem; background: rgba(15, 23, 42, 0.55); border: 1px solid rgba(255,255,255,0.07); border-radius: 0.75rem; padding: 0.6rem;">
                        <div style="display: flex; gap: 0.4rem;">
                            <div style="flex: 1.8;">
                                <label style="font-size: 0.72rem; font-weight: 800; color: #f8fafc; display: block; margin-bottom: 0.18rem;">¿Con quién hablar? (Contacto)</label>
                                <input id="modal-contacto" class="wizard-input-mobile" placeholder="Ej: Lucía">
                            </div>
                            <div style="flex: 1.2;">
                                <label style="font-size: 0.72rem; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 0.18rem;">Rol / Sector</label>
                                <select id="modal-rol" class="wizard-input-mobile" style="font-size: 0.78rem; padding: 0.5rem 0.25rem;">
                                    <option value="ENCARGADO" selected>Encargado/a</option>
                                    <option value="DUEÑO">Dueño/a</option>
                                    <option value="FIAMBRERIA">Fiambrería</option>
                                    <option value="CAJERO">Cajero/a</option>
                                    <option value="REPOSITOR">Repositor/a</option>
                                    <option value="EMPLEADO">Mostrador</option>
                                    <option value="OTRO">Otro</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label style="font-size: 0.75rem; font-weight: 800; color: #34d399; display: block; margin-bottom: 0.18rem;">
                                📱 WhatsApp (Para enviar presentación / lista)
                            </label>
                            <input id="modal-telefono" type="tel" class="wizard-input-mobile" placeholder="Ej: 221 351-1988">
                        </div>

                        <div>
                            <label style="font-size: 0.7rem; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 0.15rem;">
                                💬 ¿Te atendió otra persona en mostrador? <span style="font-weight: 400;">(Opcional)</span>
                            </label>
                            <input id="modal-atendio-mostrador" class="wizard-input-mobile" placeholder="Ej: Chica de fiambrería (me pasó el N° de Lucía)" style="font-size: 0.8rem; padding: 0.4rem 0.55rem;">
                        </div>
                    </div>

                    <!-- Notas rápidas -->
                    <div>
                        <label style="font-size: 0.72rem; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 0.18rem;">
                            💡 Notas rápidas (Horarios, qué ofrecen, qué buscar)
                        </label>
                        <textarea id="modal-notas" class="wizard-input-mobile" rows="2" placeholder="Ej: Lucía está arriba / ocupada. Pasar más temprano. Tienen dietética al lado." style="font-size: 0.82rem;"></textarea>
                    </div>

                    <!-- Checkbox para sumar a Hoja de Ruta -->
                    <label style="display: flex; align-items: center; gap: 0.5rem; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 0.6rem; padding: 0.45rem 0.6rem; cursor: pointer;">
                        <input type="checkbox" id="modal-sumar-ruta" style="accent-color: #0284c7; width: 16px; height: 16px;">
                        <span style="font-size: 0.76rem; font-weight: 700; color: #7dd3fc;">🚗 Dejar marcado en mi Hoja de Ruta para visitar</span>
                    </label>

                    <!-- Opciones Secundarias Plegadas (Agenda, Dirección Manual y Lista) -->
                    <div id="bloque-opciones-secundarias-wrapper">
                        <button type="button" id="btn-toggle-secundarias-alta" onclick="ProspectosMobileController.toggleOpcionesSecundariasAlta()" style="width: 100%; background: rgba(30, 41, 59, 0.9); border: 1px dashed #475569; color: #fdba74; border-radius: 0.6rem; padding: 0.45rem 0.6rem; font-size: 0.74rem; font-weight: 700; cursor: pointer; text-align: left; display: flex; justify-content: space-between; align-items: center;">
                            <span>➕ Agenda de revisita, Dirección manual y Lista</span>
                            <span id="icono-toggle-secundarias">▼</span>
                        </button>

                        <div id="box-opciones-secundarias-alta" style="display: none; flex-direction: column; gap: 0.6rem; margin-top: 0.45rem; padding: 0.6rem; background: rgba(15, 23, 42, 0.65); border: 1px solid #334155; border-radius: 0.7rem;">
                            
                            <!-- Agenda Rápida -->
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
                                    <label style="font-size: 0.73rem; font-weight: 800; color: #facc15; margin: 0;">
                                        📅 ¿Cuándo volver o contactar?
                                    </label>
                                </div>
                                <div style="display: flex; gap: 0.3rem; margin-bottom: 0.4rem; overflow-x: auto;">
                                    <button type="button" class="pill-select" onclick="ProspectosMobileController.setAgendaRapida('manana_temprano')">Mañana 9:30hs</button>
                                    <button type="button" class="pill-select" onclick="ProspectosMobileController.setAgendaRapida('manana')">Mañana 11hs</button>
                                    <button type="button" class="pill-select" onclick="ProspectosMobileController.setAgendaRapida('3dias')">En 3 días</button>
                                    <button type="button" class="pill-select" onclick="ProspectosMobileController.setAgendaRapida('semana')">Próx. Semana</button>
                                </div>
                                <div style="position: relative;">
                                    <input id="modal-fecha-agenda" type="text" class="wizard-input-mobile" placeholder="📅 Elegir día y hora en almanaque..." readonly style="font-size: 0.82rem; font-weight: 700; color: #f8fafc; background: #0f172a; border: 1px solid #facc15; cursor: pointer; padding-left: 2.1rem;">
                                    <span style="position: absolute; left: 9px; top: 50%; transform: translateY(-50%); font-size: 1rem; pointer-events: none;">📆</span>
                                    <button type="button" id="btn-limpiar-fecha-alta" onclick="ProspectosMobileController.limpiarFechaAgenda('alta')" title="Quitar fecha" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #94a3b8; font-size: 1rem; cursor: pointer; display: none;">✕</button>
                                </div>
                            </div>

                            <!-- Dirección y Zona (Autocompletadas por GPS pero editables) -->
                            <div style="display: flex; gap: 0.4rem;">
                                <div style="flex: 2;">
                                    <label style="font-size: 0.7rem; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 0.15rem;">Dirección (Calle y N°)</label>
                                    <input id="modal-direccion" class="wizard-input-mobile" placeholder="Autocompletado por GPS">
                                </div>
                                <div style="flex: 1;">
                                    <label style="font-size: 0.7rem; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 0.15rem;">Zona / Localidad</label>
                                    <input id="modal-zona" class="wizard-input-mobile" placeholder="Ej: Berisso" list="zonas-datalist">
                                    <datalist id="zonas-datalist">
                                        ${this.zonas.map(z => `<option value="${z}">`).join('')}
                                    </datalist>
                                </div>
                            </div>

                            <!-- Ampliar domicilio -->
                            <div>
                                <button type="button" id="btn-toggle-detalles-modal" onclick="ProspectosMobileController.toggleDetallesDomicilio('modal')" style="background: none; border: none; color: #94a3b8; font-size: 0.7rem; font-weight: 700; cursor: pointer; padding: 0; text-decoration: underline;">
                                    <span>➕ Entre calles / Piso / Local</span>
                                </button>
                                <div id="modal-detalles-domicilio-box" style="display: none; flex-direction: column; gap: 0.35rem; margin-top: 0.3rem;">
                                    <div style="display: flex; gap: 0.4rem;">
                                        <input id="modal-altura" class="wizard-input-mobile" placeholder="Altura (Ej: 1259)" style="flex: 1; font-size: 0.78rem;">
                                        <input id="modal-piso-depto" class="wizard-input-mobile" placeholder="Local / Piso" style="flex: 1; font-size: 0.78rem;">
                                    </div>
                                    <input id="modal-entre-calles" class="wizard-input-mobile" placeholder="Entre calles (Ej: e/ 14 e Industria)" style="font-size: 0.78rem;">
                                </div>
                            </div>

                            <!-- Lista de Precios Búnker -->
                            ${this.listasPrecios.length > 0 ? `
                                <div>
                                    <label style="font-size: 0.7rem; font-weight: 800; color: #cbd5e1; display: block; margin-bottom: 0.15rem;">
                                        🏷️ Lista de Precios Sugerida
                                    </label>
                                    <select id="modal-lista-id" class="wizard-input-mobile" style="font-size: 0.82rem;">
                                        ${opcionesListasHtml}
                                    </select>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                </div>
            `,
            background: '#1e293b',
            color: '#f8fafc',
            showCancelButton: true,
            confirmButtonText: '💾 Guardar y Enviar Lista',
            cancelButtonText: 'Cancelar',
            showDenyButton: true,
            denyButtonText: '💾 Solo Guardar',
            confirmButtonColor: '#059669',
            denyButtonColor: '#ea580c',
            cancelButtonColor: '#475569',
            didOpen: () => {
                this.renderPillsRubros('Dietética', 'modal');
                this.aplicarMascaraTelefono(document.getElementById('modal-telefono'));
                this.cambiarModoAlta(this.modoAltaActual || 'visita');
                // Capturar GPS automáticamente al abrir para ahorrar un toque en la calle
                this.capturarUbicacionGps(true);

                const inputAgenda = document.getElementById('modal-fecha-agenda');
                if (inputAgenda && typeof flatpickr !== 'undefined') {
                    this.flatpickrAlta = flatpickr(inputAgenda, {
                        locale: (window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.es) ? window.flatpickr.l10ns.es : 'es',
                        enableTime: true,
                        time_24hr: true,
                        dateFormat: "Y-m-d H:i",
                        altInput: true,
                        altInputClass: "wizard-input-mobile",
                        altFormat: "D d/m/Y - H:i \\h\\s",
                        minuteIncrement: 15,
                        defaultHour: 10,
                        defaultMinute: 0,
                        minDate: "today",
                        theme: "dark",
                        disableMobile: true,
                        onChange: (selectedDates) => {
                            const btnLimpiar = document.getElementById('btn-limpiar-fecha-alta');
                            if (btnLimpiar) btnLimpiar.style.display = selectedDates.length ? 'block' : 'none';
                        }
                    });
                }
            },
            preConfirm: () => this.recolectarDatosModalAlta(usuarioActual, true),
            preDeny: () => this.recolectarDatosModalAlta(usuarioActual, false)
        });

        if (formValues) {
            await this.guardarNuevoProspecto(formValues);
        }
    },

    cambiarModoAlta(modo) {
        this.modoAltaActual = modo;
        const btnVisita = document.getElementById('btn-modo-visita');
        const btnPin = document.getElementById('btn-modo-pin');
        const bloqueMostrador = document.getElementById('bloque-visita-mostrador');
        const lblNombre = document.getElementById('lbl-modal-nombre');
        const inputNombre = document.getElementById('modal-nombre');
        const chkRuta = document.getElementById('modal-sumar-ruta');
        const btnConfirm = Swal.getConfirmButton();
        const btnDeny = Swal.getDenyButton();

        if (modo === 'pin') {
            if (btnPin) {
                btnPin.style.background = '#d97706';
                btnPin.style.color = '#ffffff';
            }
            if (btnVisita) {
                btnVisita.style.background = 'transparent';
                btnVisita.style.color = '#94a3b8';
            }
            if (bloqueMostrador) bloqueMostrador.style.display = 'none';
            if (lblNombre) lblNombre.innerHTML = 'Cartel / Referencia Rápida <span style="color:#ef4444;">*</span>';
            if (inputNombre) inputNombre.placeholder = 'Ej: Autoservicio esq. 164 / Dietética nueva';
            if (chkRuta) chkRuta.checked = true;
            if (btnConfirm) btnConfirm.style.display = 'none';
            if (btnDeny) {
                btnDeny.innerHTML = '📌 Guardar Pin (Por Visitar)';
                btnDeny.style.background = '#d97706';
            }
        } else {
            if (btnVisita) {
                btnVisita.style.background = '#ea580c';
                btnVisita.style.color = '#ffffff';
            }
            if (btnPin) {
                btnPin.style.background = 'transparent';
                btnPin.style.color = '#94a3b8';
            }
            if (bloqueMostrador) bloqueMostrador.style.display = 'flex';
            if (lblNombre) lblNombre.innerHTML = 'Cartel / Nombre del Local <span style="color:#ef4444;">*</span>';
            if (inputNombre) inputNombre.placeholder = 'Ej: La Triestina';
            if (btnConfirm) btnConfirm.style.display = 'inline-block';
            if (btnDeny) {
                btnDeny.innerHTML = '💾 Solo Guardar';
                btnDeny.style.background = '#ea580c';
            }
        }
    },

    toggleOpcionesSecundariasAlta() {
        const box = document.getElementById('box-opciones-secundarias-alta');
        const icon = document.getElementById('icono-toggle-secundarias');
        if (!box) return;
        const oculto = box.style.display === 'none';
        box.style.display = oculto ? 'flex' : 'none';
        if (icon) icon.innerText = oculto ? '▲' : '▼';
    },

    recolectarDatosModalAlta(usuarioActual, enviarWa) {
        const nombre = document.getElementById('modal-nombre')?.value.trim();
        if (!nombre) {
            Swal.showValidationMessage('Escribí el nombre del cartel o una referencia del local.');
            return false;
        }

        const rubroFinal = this.sincronizarInputRubros('modal') || 'Dietética';
        const fechaAgenda = this.flatpickrAlta ? this.flatpickrAlta.input.value : (document.getElementById('modal-fecha-agenda')?.value || null);

        let dirBase = document.getElementById('modal-direccion')?.value.trim() || '';
        const altVal = document.getElementById('modal-altura')?.value.trim();
        const entreVal = document.getElementById('modal-entre-calles')?.value.trim();
        const pisoVal = document.getElementById('modal-piso-depto')?.value.trim();

        if (altVal && !dirBase.includes(altVal)) {
            dirBase = `${dirBase} ${altVal}`.trim();
        }
        if (entreVal) {
            dirBase = `${dirBase} (${entreVal.toLowerCase().startsWith('e/') ? entreVal : 'e/ ' + entreVal})`.trim();
        }
        if (pisoVal) {
            dirBase = `${dirBase} [${pisoVal}]`.trim();
        }

        const atendioMostrador = document.getElementById('modal-atendio-mostrador')?.value.trim();
        let notasFinal = document.getElementById('modal-notas')?.value.trim() || '';
        if (atendioMostrador && this.modoAltaActual !== 'pin') {
            notasFinal = notasFinal
                ? `[Atendió en local: ${atendioMostrador}] ${notasFinal}`
                : `[Atendió en local: ${atendioMostrador}]`;
        }

        const esPin = this.modoAltaActual === 'pin';
        const sumarRuta = Boolean(document.getElementById('modal-sumar-ruta')?.checked);

        return {
            nombre_fantasia: nombre,
            rubro: rubroFinal,
            lista_precios_sugerida_id: document.getElementById('modal-lista-id')?.value || null,
            direccion: dirBase,
            zona: document.getElementById('modal-zona')?.value.trim(),
            latitud: document.getElementById('modal-lat')?.value,
            longitud: document.getElementById('modal-lng')?.value,
            contacto_nombre: esPin ? '' : (document.getElementById('modal-contacto')?.value.trim() || ''),
            contacto_rol: esPin ? 'ENCARGADO' : (document.getElementById('modal-rol')?.value || 'ENCARGADO'),
            telefono_whatsapp: esPin ? '' : (document.getElementById('modal-telefono')?.value.trim() || ''),
            fecha_revisita: fechaAgenda || null,
            estado: esPin ? 'POR_VISITAR' : (fechaAgenda ? 'VISITA_AGENDADA' : 'VISITADO'),
            notas: notasFinal,
            origen_contacto: 'CALLE',
            creado_por: usuarioActual,
            enviar_wa: esPin ? false : enviarWa,
            sumar_a_ruta: sumarRuta
        };
    },

    togglePill(btn, inputId, valor) {
        const parent = btn.parentElement;
        parent.querySelectorAll('.pill-select').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const input = document.getElementById(inputId);
        if (input) input.value = valor;
    },

    setAgendaRapida(tipo) {
        const now = new Date();
        if (tipo === 'manana_temprano') {
            now.setDate(now.getDate() + 1);
            now.setHours(9, 30, 0, 0);
        } else if (tipo === 'manana') {
            now.setDate(now.getDate() + 1);
            now.setHours(11, 0, 0, 0);
        } else if (tipo === '3dias') {
            now.setDate(now.getDate() + 3);
            now.setHours(15, 0, 0, 0);
        } else if (tipo === 'semana') {
            now.setDate(now.getDate() + 7);
            now.setHours(10, 0, 0, 0);
        }

        if (this.flatpickrAlta) {
            this.flatpickrAlta.setDate(now, true);
            const btnLimpiar = document.getElementById('btn-limpiar-fecha-alta');
            if (btnLimpiar) btnLimpiar.style.display = 'block';
        } else if (this.flatpickrReagendar) {
            this.flatpickrReagendar.setDate(now, true);
            const btnLimpiar = document.getElementById('btn-limpiar-fecha-reagendar');
            if (btnLimpiar) btnLimpiar.style.display = 'block';
        } else {
            const input = document.getElementById('modal-fecha-agenda') || document.getElementById('swal-reagendar-fecha');
            if (input) {
                const tzOffset = now.getTimezoneOffset() * 60000;
                input.value = (new Date(now - tzOffset)).toISOString().slice(0, 16);
            }
        }
    },

    limpiarFechaAgenda(tipo) {
        if (tipo === 'alta' && this.flatpickrAlta) {
            this.flatpickrAlta.clear();
            const btnLimpiar = document.getElementById('btn-limpiar-fecha-alta');
            if (btnLimpiar) btnLimpiar.style.display = 'none';
        } else if (tipo === 'reagendar' && this.flatpickrReagendar) {
            this.flatpickrReagendar.clear();
            const btnLimpiar = document.getElementById('btn-limpiar-fecha-reagendar');
            if (btnLimpiar) btnLimpiar.style.display = 'none';
        }
    },

    capturarUbicacionGps(silencioso = false) {
        const lbl = document.getElementById('gps-status-lbl');
        const btn = document.getElementById('btn-capturar-gps');
        if (!navigator.geolocation) {
            if (lbl) lbl.innerText = 'GPS no soportado en este navegador.';
            return;
        }

        if (lbl) lbl.innerText = 'Obteniendo coordenadas GPS...';
        if (btn) btn.disabled = true;

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const latEl = document.getElementById('modal-lat');
                const lngEl = document.getElementById('modal-lng');
                if (latEl) latEl.value = lat;
                if (lngEl) lngEl.value = lng;
                if (lbl) lbl.innerText = `✅ GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;

                try {
                    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
                    const data = await r.json();
                    if (data && data.address) {
                        const calle = data.address.road || data.address.pedestrian || '';
                        const altura = data.address.house_number || '';
                        const barrio = data.address.suburb || data.address.neighbourhood || data.address.city || data.address.town || '';

                        const inputDir = document.getElementById('modal-direccion');
                        const inputAltura = document.getElementById('modal-altura');
                        const inputZona = document.getElementById('modal-zona');

                        if (inputDir && (!inputDir.value || !silencioso) && calle) {
                            inputDir.value = altura ? `${calle.trim()} ${altura.trim()}` : calle.trim();
                        }
                        if (inputAltura && !inputAltura.value && altura) {
                            inputAltura.value = altura.trim();
                        }
                        if (inputZona && (!inputZona.value || !silencioso) && barrio) {
                            inputZona.value = barrio;
                        }
                        const resumenDir = [calle, altura].filter(Boolean).join(' ');
                        if (lbl) {
                            lbl.innerText = resumenDir
                                ? `✅ ${resumenDir}${barrio ? ` (${barrio})` : ''}`
                                : `✅ Coordenadas GPS listas`;
                        }
                    }
                } catch (e) {
                    console.log('[GPS] Geocodificación inversa omitida:', e);
                }
                if (btn) btn.disabled = false;
            },
            (err) => {
                console.warn('[GPS] Error capturando posición:', err);
                if (lbl) lbl.innerText = 'Sin señal GPS automática (podés tocar 🔄 GPS).';
                if (btn) btn.disabled = false;
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    },

    async guardarNuevoProspecto(datos) {
        Swal.fire({
            title: 'Guardando...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading(),
            background: '#1e293b',
            color: '#fff'
        });

        try {
            if (datos.fecha_revisita && datos.estado !== 'POR_VISITAR') {
                datos.estado = 'VISITA_AGENDADA';
            }

            const res = await fetch('/api/logistica/prospectos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Error al guardar');

            const nuevo = json.data;

            // Si marcó sumar a selección de ruta, lo agregamos
            if (datos.sumar_a_ruta && nuevo && nuevo.id) {
                const nid = Number(nuevo.id);
                if (!this.rutaIds.includes(nid)) this.rutaIds.push(nid);
                this.guardarRutaLocal();
            }

            Swal.close();

            await Promise.all([
                this.cargarMetricas(),
                this.cargarZonas(),
                this.cargarProspectos()
            ]);

            // Si pidió enviar WhatsApp inmediato
            if (datos.enviar_wa && nuevo.telefono_whatsapp) {
                this.abrirModalDespachoWhatsApp(nuevo);
            } else {
                Swal.fire({
                    toast: true,
                    position: 'top',
                    icon: 'success',
                    title: datos.estado === 'POR_VISITAR'
                        ? `📌 ${nuevo.nombre_fantasia} punteado para visitar`
                        : `¡${nuevo.nombre_fantasia} registrado! (${nuevo.codigo_prospecto})`,
                    timer: 2800,
                    showConfirmButton: false,
                    background: '#0f172a',
                    color: '#fff'
                });
            }

        } catch (e) {
            Swal.fire({
                icon: 'error',
                title: 'Error al registrar',
                text: e.message,
                background: '#1e293b',
                color: '#fff'
            });
        }
    },

    // =========================================================
    // FASE 6: CATÁLOGO PDF & DESPACHO WHATSAPP INTELIGENTE MÓVIL
    // =========================================================
    generarTextoPlantillaWa(prospecto, tipo = 'hablamos_mostrador') {
        const nombreDest = prospecto.contacto_nombre ? ` ${prospecto.contacto_nombre}` : '';
        const localNombre = prospecto.nombre_fantasia || 'el comercio';
        if (tipo === 'pasaron_numero') {
            return `Hola${nombreDest}, ¿cómo estás? Te escribe Martín de *LAMDA* (elaboradores y distribuidores mayoristas de frutos secos, granolas, barritas y cereales).

Hoy pasé por *${localNombre}* y en el local me pasaron tu número para ponerme en contacto con vos.

Te dejo adjunto nuestro catálogo y lista de precios mayorista en PDF para cuando puedas pegarle una mirada. Quedo a tu disposición por cualquier consulta. ¡Muchas gracias!`;
        }
        return `Hola${nombreDest}, ¿cómo estás? Soy Martín de *LAMDA*.

Como conversamos recién en *${localNombre}*, te comparto por acá nuestra lista de precios y catálogo mayorista en PDF para que lo revises con tranquilidad.

Quedo a tu total disposición por cualquier pedido o consulta. ¡Muchas gracias!`;
    },

    cambiarPlantillaMensajeWa(tipo) {
        const p = this.prospectoWaActual;
        if (!p) return;
        const txt = document.getElementById('swal-mobile-msg');
        if (txt) {
            txt.value = this.generarTextoPlantillaWa(p, tipo);
        }
        const btnPasaron = document.getElementById('btn-tpl-pasaron');
        const btnHablamos = document.getElementById('btn-tpl-hablamos');
        if (btnPasaron && btnHablamos) {
            if (tipo === 'pasaron_numero') {
                btnPasaron.classList.add('active');
                btnHablamos.classList.remove('active');
            } else {
                btnHablamos.classList.add('active');
                btnPasaron.classList.remove('active');
            }
        }
    },

    async abrirModalDespachoWhatsApp(pIdOrObj) {
        const p = typeof pIdOrObj === 'object' ? pIdOrObj : this.prospectos.find(x => x.id === pIdOrObj);
        if (!p) return;
        this.prospectoWaActual = p;

        let phone = (p.telefono_whatsapp || '').replace(/[^\d]/g, '');
        if (!phone) {
            Swal.fire({
                icon: 'warning',
                title: 'Sin teléfono',
                text: 'Este comercio no tiene registrado un número de WhatsApp.',
                background: '#1e293b',
                color: '#fff'
            });
            return;
        }

        // Formato internacional Argentina
        if (!phone.startsWith('54')) {
            phone = phone.startsWith('9') ? '54' + phone : '549' + phone;
        }

        const opcionesListas = this.listasPrecios.map(l => `
            <option value="${l.id}" ${(p.lista_precios_sugerida_id && Number(p.lista_precios_sugerida_id) === Number(l.id)) || l.nombre.toLowerCase().includes('dietetica') ? 'selected' : ''}>
                📋 ${l.nombre}
            </option>
        `).join('');

        // Si en las notas dice "Atendió en local" o "pasó el número", preseleccionar la plantilla "Me pasaron tu N°"
        const notasLower = (p.notas || '').toLowerCase();
        const usarPlantillaPasaron = notasLower.includes('atendió') || notasLower.includes('pasó') || notasLower.includes('pasaron');
        const tipoPlantillaInicial = usarPlantillaPasaron ? 'pasaron_numero' : 'hablamos_mostrador';
        const mensajePorDefecto = this.generarTextoPlantillaWa(p, tipoPlantillaInicial);

        this.nivelesDespachoSeleccionados = new Set([
            'familia', 'principal', 'variedad', 'tratamiento', 
            'conformacion', 'definicion', 'calibre', 'uso', 
            'color', 'procedencia', 'nom_fantasia', 'tamano'
        ]);

        const { value: confirmacion } = await Swal.fire({
            title: `💬 Enviar Presentación y Lista`,
            html: `
                <div style="text-align: left; font-size: 0.85rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 0.6rem;">
                    
                    <div>
                        <label style="font-weight: 700; font-size: 0.72rem; color: #94a3b8;">WhatsApp de ${p.contacto_nombre || p.nombre_fantasia}:</label>
                        <input id="swal-cotiz-phone" class="wizard-input-mobile" value="${this.formatearTelefono(p.telefono_whatsapp || '')}" placeholder="Ej: 221 351-1988" style="margin-top: 2px; color: #34d399; font-weight: 800;">
                    </div>

                    <!-- Selector de Lista de Precios Búnker -->
                    <div>
                        <label style="font-weight: 800; font-size: 0.72rem; color: #fdba74;">📋 Lista de Precios Oficial Adjunta:</label>
                        <select id="swal-mobile-sel-lista" class="wizard-input-mobile" style="margin-top: 2px; font-weight: 700; border-color: #ea580c;">
                            ${opcionesListas || '<option value="5">📋 Lista Dietética</option>'}
                        </select>
                    </div>

                    <!-- Plantillas Rápidas de Presentación -->
                    <div>
                        <label style="font-weight: 800; font-size: 0.72rem; color: #f8fafc; display: block; margin-bottom: 0.25rem;">
                            ✨ Modo de Presentación (1 toque):
                        </label>
                        <div style="display: flex; gap: 0.35rem; margin-bottom: 0.35rem;">
                            <button type="button" id="btn-tpl-pasaron" class="pill-select ${tipoPlantillaInicial === 'pasaron_numero' ? 'active' : ''}" onclick="ProspectosMobileController.cambiarPlantillaMensajeWa('pasaron_numero')" style="flex: 1; text-align: center; padding: 0.4rem 0.3rem;">
                                🤝 Me pasaron tu N°
                            </button>
                            <button type="button" id="btn-tpl-hablamos" class="pill-select ${tipoPlantillaInicial === 'hablamos_mostrador' ? 'active' : ''}" onclick="ProspectosMobileController.cambiarPlantillaMensajeWa('hablamos_mostrador')" style="flex: 1; text-align: center; padding: 0.4rem 0.3rem;">
                                💬 Hablamos recién
                            </button>
                        </div>
                        <textarea id="swal-mobile-msg" class="wizard-input-mobile" rows="5" style="font-size: 0.8rem; line-height: 1.35;">${mensajePorDefecto}</textarea>
                    </div>

                    <!-- Parámetros Avanzados del Catálogo Plegados -->
                    <details style="background: rgba(0,0,0,0.25); border: 1px solid #334155; border-radius: 0.65rem; padding: 0.45rem 0.55rem;">
                        <summary style="font-size: 0.72rem; font-weight: 800; color: #94a3b8; cursor: pointer;">
                            ⚙️ Ajustes avanzados del PDF (IVA, columnas y niveles)
                        </summary>
                        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
                            <div style="display: flex; gap: 0.4rem;">
                                <div style="flex: 1;">
                                    <label style="font-size: 0.68rem; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 2px;">Tratamiento de IVA</label>
                                    <select id="swal-cotiz-iva" class="wizard-input-mobile" style="font-size: 0.78rem; padding: 0.35rem 0.4rem;">
                                        <option value="con_iva" selected>Con IVA (Finales)</option>
                                        <option value="sin_iva">Sin IVA (Netos)</option>
                                    </select>
                                </div>
                                <div style="flex: 1;">
                                    <label style="font-size: 0.68rem; font-weight: 700; color: #cbd5e1; display: block; margin-bottom: 2px;">Precios a Mostrar</label>
                                    <select id="swal-cotiz-modo-precio" class="wizard-input-mobile" style="font-size: 0.78rem; padding: 0.35rem 0.4rem;">
                                        <option value="ambos" selected>Ambos (Kilo + Bulto)</option>
                                        <option value="kilo">Solo Kilo</option>
                                        <option value="bulto">Solo Bulto / Ud</option>
                                    </select>
                                </div>
                            </div>

                            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid #334155; border-radius: 0.65rem; padding: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <label style="font-size: 0.7rem; font-weight: 800; color: #f8fafc; margin: 0;">📦 Niveles de Agrupamiento:</label>
                                    <span id="swal-chips-status" style="font-size: 0.65rem; color: #38bdf8; font-weight: 700;">Todos Activos</span>
                                </div>
                                <div id="swal-chips-agrupamiento" style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
                                    <button type="button" class="btn-chip-mobile" data-cat="restablecer" onclick="ProspectosMobileController.onMobileLimpiarNivelesAgrupamiento()" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #475569; background: #334155; color: #cbd5e1;">📋 Plana</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="familia" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('familia')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1.5px solid #f59e0b; background: linear-gradient(135deg, #7e22ce 0%, #d97706 100%); color: #ffffff;">🌾 Familia</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="principal" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('principal')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #0284c7; background: #0284c7; color: #ffffff;">🌽 Principal</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="variedad" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('variedad')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #a855f7; background: #7e22ce; color: #ffffff;">🏷️ Variedad</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="tratamiento" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('tratamiento')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #a855f7; background: #7e22ce; color: #ffffff;">🏷️ Tratamiento</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="conformacion" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('conformacion')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #a855f7; background: #7e22ce; color: #ffffff;">🏷️ Conformación</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="definicion" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('definicion')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #a855f7; background: #7e22ce; color: #ffffff;">🏷️ Definición</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="calibre" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('calibre')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #a855f7; background: #7e22ce; color: #ffffff;">🏷️ Calibre</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="uso" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('uso')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #a855f7; background: #7e22ce; color: #ffffff;">🏷️ Uso</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="color" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('color')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #a855f7; background: #7e22ce; color: #ffffff;">🏷️ Color</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="procedencia" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('procedencia')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #a855f7; background: #7e22ce; color: #ffffff;">🏷️ Procedencia</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="nom_fantasia" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('nom_fantasia')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #a855f7; background: #7e22ce; color: #ffffff;">🏷️ Fantasía</button>
                                    <button type="button" class="btn-chip-mobile" data-cat="tamano" onclick="ProspectosMobileController.onMobileToggleNivelAgrupamiento('tamano')" style="font-size: 0.68rem; padding: 3px 6px; border-radius: 5px; font-weight: 700; cursor: pointer; border: 1px solid #a855f7; background: #7e22ce; color: #ffffff;">🏷️ Tamaño</button>
                                </div>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                                <label style="display: flex; align-items: center; gap: 7px; font-size: 0.74rem; color: #e2e8f0; cursor: pointer;">
                                    <input type="checkbox" id="swal-cotiz-hijos" checked style="accent-color: #ea580c; width: 15px; height: 15px;">
                                    <span>Incluir presentaciones fraccionadas (Hijas ↳)</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 7px; font-size: 0.74rem; color: #e2e8f0; cursor: pointer;">
                                    <input type="checkbox" id="swal-cotiz-col-iva" checked style="accent-color: #ea580c; width: 15px; height: 15px;">
                                    <span>Incluir columna con % de IVA</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 7px; font-size: 0.74rem; color: #e2e8f0; cursor: pointer;">
                                    <input type="checkbox" id="swal-cotiz-ofertas" checked style="accent-color: #ea580c; width: 15px; height: 15px;">
                                    <span>⭐ Resaltar ofertas vigentes</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 7px; font-size: 0.74rem; color: #e2e8f0; cursor: pointer;">
                                    <input type="checkbox" id="swal-cotiz-mixes" checked style="accent-color: #ea580c; width: 15px; height: 15px;">
                                    <span>Mostrar detalle de composición en mixes</span>
                                </label>
                            </div>
                        </div>
                    </details>

                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: '🚀 Enviar Presentación + PDF',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#059669',
            cancelButtonColor: '#475569',
            didOpen: () => {
                this.aplicarMascaraTelefono(document.getElementById('swal-cotiz-phone'));
                this.renderMobileChipsState();
            },
            preConfirm: () => {
                const listaId = document.getElementById('swal-mobile-sel-lista')?.value;
                const msg = document.getElementById('swal-mobile-msg')?.value.trim();
                const phoneInput = document.getElementById('swal-cotiz-phone')?.value.trim();
                if (!listaId) {
                    Swal.showValidationMessage('Debe seleccionar una lista de precios.');
                    return false;
                }
                const niveles = Array.from(this.nivelesDespachoSeleccionados || []);
                return {
                    listaId: Number(listaId),
                    telefono: phoneInput || p.telefono_whatsapp,
                    mensaje: msg || mensajePorDefecto,
                    modoIVA: document.getElementById('swal-cotiz-iva')?.value || 'con_iva',
                    modoPrecio: document.getElementById('swal-cotiz-modo-precio')?.value || 'ambos',
                    agrupamiento: niveles.length === 0 ? 'plana' : (niveles.length >= 12 ? 'todos' : niveles),
                    mostrarHijos: document.getElementById('swal-cotiz-hijos')?.checked ?? true,
                    ocultarColumnaIVA: !(document.getElementById('swal-cotiz-col-iva')?.checked ?? true),
                    destacarOfertas: document.getElementById('swal-cotiz-ofertas')?.checked ?? true,
                    mostrarComposicionMixes: document.getElementById('swal-cotiz-mixes')?.checked ?? true
                };
            }
        });

        if (confirmacion) {
            Swal.fire({
                title: 'Despachando por WhatsApp...',
                html: '<span style="font-size: 0.82rem; color: #94a3b8;">Generando catálogo oficial PDF y enviando vía WhatsApp desde la central de LAMDA...</span>',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading(),
                background: '#1e293b',
                color: '#fff'
            });

            try {
                const nivelesAgrupar = confirmacion.agrupamiento === 'plana' 
                    ? [] 
                    : (confirmacion.agrupamiento === 'todos' ? 'todos' : (Array.isArray(confirmacion.agrupamiento) ? confirmacion.agrupamiento : confirmacion.agrupamiento.split(',')));

                const payload = {
                    telefono: confirmacion.telefono,
                    lista_id: confirmacion.listaId,
                    modo_iva: confirmacion.modoIVA,
                    modo_precio: confirmacion.modoPrecio,
                    agrupar_por_atributo: nivelesAgrupar,
                    mostrar_hijos: confirmacion.mostrarHijos,
                    ocultar_columna_iva: confirmacion.ocultarColumnaIVA,
                    destacar_ofertas: confirmacion.destacarOfertas,
                    mostrar_composicion_mixes: confirmacion.mostrarComposicionMixes,
                    bonificacion_volumen: true,
                    mensajeTexto: confirmacion.mensaje
                };

                const resWp = await fetch(`/api/logistica/prospectos/${p.id}/enviar-catalogo-whatsapp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const dataWp = await resWp.json().catch(() => ({}));
                if (!resWp.ok || !dataWp.success) {
                    throw new Error(dataWp.error || 'Error al despachar el catálogo por WhatsApp');
                }

                // Actualizar estado a LISTA_ENVIADA en memoria y en UI
                p.estado = 'LISTA_ENVIADA';
                p.lista_precios_sugerida_id = confirmacion.listaId;
                if (confirmacion.telefono) p.telefono_whatsapp = confirmacion.telefono;
                if (this.vistaActual === 'lista') this.renderListado();
                this.cargarMetricas();

                await Swal.fire({
                    icon: 'success',
                    title: '¡Catálogo Enviado!',
                    html: `
                        <div style="text-align: left; font-size: 0.85rem; color: #cbd5e1; line-height: 1.5;">
                            <p>El catálogo oficial PDF y tu mensaje fueron despachados con éxito desde la <b>Central LAMDA</b> a:</p>
                            <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px; padding: 10px; margin: 0.75rem 0; font-weight: 700; color: #34d399; font-size: 0.95rem; text-align: center;">
                                📱 ${confirmacion.telefono} (${p.nombre_fantasia})
                            </div>
                            <p style="font-size: 0.78rem; color: #94a3b8;">El estado del prospecto se actualizó automáticamente a <b style="color: #60a5fa;">LISTA ENVIADA</b>.</p>
                        </div>
                    `,
                    background: '#1e293b',
                    color: '#fff',
                    confirmButtonColor: '#059669',
                    confirmButtonText: 'Genial, continuar'
                });

            } catch (errWp) {
                console.error('❌ [WHATSAPP] Error enviando catálogo:', errWp);
                Swal.fire({
                    icon: 'error',
                    title: 'Error de Envío',
                    text: errWp.message || 'No se pudo despachar el mensaje por WhatsApp. Verifique la conexión en Facturación.',
                    background: '#1e293b',
                    color: '#fff',
                    confirmButtonColor: '#ea580c'
                });
            }
        }
    },

    onMobileToggleNivelAgrupamiento(catKey) {
        if (!this.nivelesDespachoSeleccionados) {
            this.nivelesDespachoSeleccionados = new Set();
        }
        if (this.nivelesDespachoSeleccionados.has(catKey)) {
            this.nivelesDespachoSeleccionados.delete(catKey);
        } else {
            this.nivelesDespachoSeleccionados.add(catKey);
        }
        this.renderMobileChipsState();
    },

    onMobileLimpiarNivelesAgrupamiento() {
        if (!this.nivelesDespachoSeleccionados) {
            this.nivelesDespachoSeleccionados = new Set();
        }
        this.nivelesDespachoSeleccionados.clear();
        this.renderMobileChipsState();
    },

    renderMobileChipsState() {
        const set = this.nivelesDespachoSeleccionados || new Set();
        const chips = document.querySelectorAll('.btn-chip-mobile');
        const statusEl = document.getElementById('swal-chips-status');

        if (statusEl) {
            if (set.size === 0) {
                statusEl.innerText = 'Lista Plana (Sin Banners)';
                statusEl.style.color = '#94a3b8';
            } else if (set.size >= 12) {
                statusEl.innerText = 'Todos Activos (Por Defecto)';
                statusEl.style.color = '#38bdf8';
            } else {
                statusEl.innerText = `${set.size} Niveles Activos`;
                statusEl.style.color = '#a855f7';
            }
        }

        chips.forEach(btn => {
            const cat = btn.getAttribute('data-cat');
            if (cat === 'restablecer') {
                if (set.size === 0) {
                    btn.style.background = '#475569';
                    btn.style.color = '#ffffff';
                    btn.style.borderColor = '#94a3b8';
                } else {
                    btn.style.background = '#334155';
                    btn.style.color = '#cbd5e1';
                    btn.style.borderColor = '#475569';
                }
            } else {
                const isActive = set.has(cat);
                if (isActive) {
                    if (cat === 'familia') {
                        btn.style.background = 'linear-gradient(135deg, #7e22ce 0%, #d97706 100%)';
                        btn.style.color = '#ffffff';
                        btn.style.borderColor = '#f59e0b';
                    } else if (cat === 'principal') {
                        btn.style.background = '#0284c7';
                        btn.style.color = '#ffffff';
                        btn.style.borderColor = '#38bdf8';
                    } else {
                        btn.style.background = '#7e22ce';
                        btn.style.color = '#ffffff';
                        btn.style.borderColor = '#a855f7';
                    }
                } else {
                    btn.style.background = 'rgba(30, 41, 59, 0.7)';
                    btn.style.color = '#94a3b8';
                    btn.style.borderColor = '#475569';
                }
            }
        });
    },

    enviarWhatsApp(prospectoId) {
        this.abrirModalDespachoWhatsApp(prospectoId);
    },

    abrirCotizador(prospectoId) {
        const p = this.prospectos.find(x => x.id === prospectoId);
        if (!p) return;
        const url = `cotizar-precios-movil.html?clienteId=prospecto&prospectoId=${p.id}&nombre=${encodeURIComponent(p.nombre_fantasia)}&telefono=${encodeURIComponent(p.telefono_whatsapp || '')}`;
        window.location.href = url;
    },

    async abrirModalReagendar(prospectoId) {
        const p = this.prospectos.find(x => x.id === prospectoId);
        if (!p) return;

        const { value: formValues } = await Swal.fire({
            title: `📅 Agendar Visita - ${p.nombre_fantasia}`,
            html: `
                <div style="text-align: left; font-size: 0.85rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 0.65rem;">
                    <p style="margin: 0; color: #94a3b8; font-size: 0.78rem;">Programá cuándo tenés que volver al comercio o llamar:</p>
                    
                    <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 0.75rem; padding: 0.6rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                            <label style="font-size: 0.75rem; font-weight: 800; color: #facc15; margin: 0;">
                                📅 Fecha y Hora de Visita
                            </label>
                            <span style="font-size: 0.68rem; color: #94a3b8;">Almanaque + Horario</span>
                        </div>
                        <div style="display: flex; gap: 0.3rem; margin-bottom: 0.45rem; overflow-x: auto;">
                            <button type="button" class="pill-select" onclick="ProspectosMobileController.setAgendaRapida('manana')">Mañana 11hs</button>
                            <button type="button" class="pill-select" onclick="ProspectosMobileController.setAgendaRapida('3dias')">En 3 días 15hs</button>
                            <button type="button" class="pill-select" onclick="ProspectosMobileController.setAgendaRapida('semana')">Próx. Semana 10hs</button>
                        </div>
                        <div style="position: relative;">
                            <input id="swal-reagendar-fecha" type="text" class="wizard-input-mobile" placeholder="📅 Tocá para abrir almanaque y hora..." readonly style="font-size: 0.88rem; font-weight: 700; color: #f8fafc; background: #0f172a; border: 1.5px solid #facc15; cursor: pointer; padding-left: 2.3rem;">
                            <span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 1.15rem; pointer-events: none;">📆</span>
                            <button type="button" id="btn-limpiar-fecha-reagendar" onclick="ProspectosMobileController.limpiarFechaAgenda('reagendar')" title="Quitar fecha" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #94a3b8; font-size: 1.1rem; cursor: pointer; ${p.fecha_revisita ? 'display: block;' : 'display: none;'}">✕</button>
                        </div>
                    </div>
                    
                    <div>
                        <label style="font-size: 0.75rem; font-weight: 800; color: #cbd5e1; display: block; margin-bottom: 0.25rem;">Notas de seguimiento</label>
                        <textarea id="swal-reagendar-notas" class="wizard-input-mobile" rows="2" placeholder="Ej: Pedir por el encargado de compras">${p.notas || ''}</textarea>
                    </div>
                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Agenda',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#ea580c',
            cancelButtonColor: '#475569',
            didOpen: () => {
                const inputAgenda = document.getElementById('swal-reagendar-fecha');
                if (inputAgenda && typeof flatpickr !== 'undefined') {
                    this.flatpickrReagendar = flatpickr(inputAgenda, {
                        locale: (window.flatpickr && window.flatpickr.l10ns && window.flatpickr.l10ns.es) ? window.flatpickr.l10ns.es : 'es',
                        enableTime: true,
                        time_24hr: true,
                        dateFormat: "Y-m-d H:i",
                        altInput: true,
                        altInputClass: "wizard-input-mobile",
                        altFormat: "D d/m/Y - H:i \\h\\s",
                        minuteIncrement: 15,
                        defaultDate: p.fecha_revisita ? new Date(p.fecha_revisita) : null,
                        minDate: "today",
                        theme: "dark",
                        disableMobile: true,
                        onChange: (selectedDates) => {
                            const btnLimpiar = document.getElementById('btn-limpiar-fecha-reagendar');
                            if (btnLimpiar) btnLimpiar.style.display = selectedDates.length ? 'block' : 'none';
                        }
                    });
                }
            },
            preConfirm: () => {
                const f = this.flatpickrReagendar ? this.flatpickrReagendar.input.value : document.getElementById('swal-reagendar-fecha')?.value;
                if (!f) {
                    Swal.showValidationMessage('Debe seleccionar fecha y hora.');
                    return false;
                }
                return {
                    fecha_revisita: f,
                    notas: document.getElementById('swal-reagendar-notas')?.value.trim()
                };
            }
        });

        if (formValues) {
            try {
                const res = await fetch(`/api/logistica/prospectos/${p.id}/estado`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        estado: 'VISITA_AGENDADA',
                        fecha_revisita: formValues.fecha_revisita,
                        notas: formValues.notas
                    })
                });
                const json = await res.json();
                if (!json.success) throw new Error(json.error);

                Swal.fire({
                    toast: true,
                    position: 'top',
                    icon: 'success',
                    title: '¡Agenda actualizada!',
                    timer: 2000,
                    showConfirmButton: false,
                    background: '#0f172a',
                    color: '#fff'
                });

                await Promise.all([this.cargarMetricas(), this.cargarProspectos()]);
            } catch (e) {
                Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1e293b', color: '#fff' });
            }
        }
    },

    async abrirModalMenu(prospectoId) {
        const p = this.prospectos.find(x => x.id === prospectoId);
        if (!p) return;

        const enRuta = this.estaEnRuta(p.id);

        const opcionesMenu = {
            'FICHA': '📋 Ver Ficha Completa y Notas',
            'ENVIAR_HOJA_RUTA': '🛣️ Enviar a Hoja de Ruta / Pool Logística',
            'TOGGLE_POOL_LOGISTICA': p.en_pool_logistica ? '↩️ Retirar del Pool de Logística' : '📥 Enviar al Pool de Logística',
            'EDITAR': '✏️ Editar Datos / Teléfono',
            'COTIZAR': '🏷️ Cotizar Precios Libre',
            'RUTA_TOGGLE': enRuta ? '🚗 Quitar de Selección Rápida' : '🚗 Sumar a Selección Rápida',
            'AGENDAR': '📅 Agendar / Reagendar Visita'
        };

        if (p.estado !== 'CONVERTIDO') {
            opcionesMenu['CONVERTIR'] = '🚀 Pasar a Cliente Oficial';
        }

        Object.assign(opcionesMenu, {
            'POR_VISITAR': '📌 Estado: Por Visitar',
            'CONTACTO_INICIAL': '🔵 Estado: Contacto Inicial',
            'LISTA_ENVIADA': '🟢 Estado: Lista Enviada',
            'EN_NEGOCIACION': '🟣 Estado: En Negociación',
            'DESCARTADO': '⚪ Estado: Descartado',
            'ELIMINAR': '🗑️ Eliminar Comercio'
        });

        const { value: seleccion } = await Swal.fire({
            title: p.nombre_fantasia,
            input: 'select',
            inputOptions: opcionesMenu,
            inputPlaceholder: 'Seleccioná una acción...',
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: 'Continuar',
            cancelButtonText: 'Cerrar',
            confirmButtonColor: '#ea580c'
        });

        if (seleccion === 'FICHA') {
            this.verFichaVisualProspecto(p.id);
        } else if (seleccion === 'ENVIAR_HOJA_RUTA') {
            this.abrirModalEnviarAHojaDeRuta([Number(p.id)]);
        } else if (seleccion === 'TOGGLE_POOL_LOGISTICA') {
            await this.cambiarPoolLogisticaRapido(p.id, !p.en_pool_logistica);
        } else if (seleccion === 'EDITAR') {
            this.abrirModalEditar(p.id);
        } else if (seleccion === 'COTIZAR') {
            this.abrirCotizador(p.id);
        } else if (seleccion === 'CONVERTIR') {
            this.convertirACliente(p.id);
        } else if (seleccion === 'RUTA_TOGGLE') {
            this.toggleEnRuta(p.id);
        } else if (seleccion === 'AGENDAR') {
            this.abrirModalReagendar(p.id);
        } else if (seleccion === 'ELIMINAR') {
            this.eliminarProspecto(p.id, p.nombre_fantasia);
        } else if (seleccion) {
            await this.cambiarEstadoRapido(p.id, seleccion);
        }
    },

    obtenerVisitaActivaDeCliente(cli) {
        if (!cli || !Array.isArray(this.prospectos)) return null;
        const domId = Number(cli.id);
        const cliId = Number(cli.id_cliente);
        const nomNorm = String(cli.cliente_nombre || cli.alias || '').trim().toLowerCase();
        return this.prospectos.find(p => {
            if (p.origen_contacto !== 'CLIENTE_ACTIVO') return false;
            if (domId && Number(p.cliente_domicilio_id) === domId) return true;
            if (cliId && Number(p.cliente_activo_id) === cliId) return true;
            if (nomNorm && String(p.nombre_fantasia || '').trim().toLowerCase() === nomNorm) return true;
            return false;
        }) || null;
    },

    async enviarClienteActivoAPoolRapido(idDomicilio, enPool = true) {
        try {
            const cli = (this.clientesDomicilios || []).find(c => Number(c.id) === Number(idDomicilio));
            if (!cli) return;
            const nombreCli = cli.cliente_nombre || cli.alias || `Cliente #${cli.id_cliente}`;
            const res = await fetch('/api/logistica/prospectos/visita-cliente-activo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id_cliente: cli.id_cliente,
                    id_domicilio: cli.id,
                    cliente_nombre: nombreCli,
                    alias: cli.alias,
                    direccion: cli.direccion,
                    localidad: cli.localidad,
                    latitud: cli.latitud,
                    longitud: cli.longitud,
                    telefono_contacto: cli.telefono_contacto,
                    accion: enPool ? 'ENVIAR_POOL' : 'QUITAR_POOL'
                })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            await this.cargarProspectos();
            Swal.fire({
                toast: true,
                position: 'top',
                icon: 'success',
                title: json.message || (enPool ? `📥 "${nombreCli}" enviado al Pool de Logística` : `↩️ "${nombreCli}" retirado del Pool de Logística`),
                timer: 2400,
                showConfirmButton: false,
                background: '#0f172a',
                color: '#fff'
            });
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1e293b', color: '#fff' });
        }
    },

    async abrirModalVisitaClienteActivo(idDomicilio) {
        const cli = (this.clientesDomicilios || []).find(c => Number(c.id) === Number(idDomicilio));
        if (!cli) return;
        const nombreCli = cli.cliente_nombre || cli.alias || `Cliente #${cli.id_cliente}`;
        const visitaExistente = this.obtenerVisitaActivaDeCliente(cli);

        let rutasActivas = [];
        let choferes = [];
        try {
            const resR = await fetch('/api/logistica/prospectos/rutas-disponibles');
            const jsonR = await resR.json();
            if (jsonR.success) {
                rutasActivas = jsonR.rutas || [];
                choferes = jsonR.choferes || [];
            }
        } catch (_) {}

        const sesionLocal = (() => {
            try { return JSON.parse(localStorage.getItem('sesion_chofer') || sessionStorage.getItem('sesion_chofer') || '{}'); }
            catch (_) { return {}; }
        })();
        const choferDefaultId = sesionLocal.id || (choferes[0]?.id || 1);
        const fechaHoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

        const opcionesRutasHtml = rutasActivas.map(r => `
            <option value="${r.id}">
                ${r.estado === 'EN_CAMINO' ? '🟢' : '🟡'} ${r.nombre_ruta} (${r.total_paradas} paradas - ${r.chofer_nombre || 'Sin chofer'})
            </option>
        `).join('');

        const opcionesChoferesHtml = choferes.map(c => `
            <option value="${c.id}" ${Number(c.id) === Number(choferDefaultId) ? 'selected' : ''}>
                🚗 ${c.nombre_completo}
            </option>
        `).join('');

        const { value: formCli } = await Swal.fire({
            title: `⭐ Visita a Cliente: ${nombreCli}`,
            html: `
                <div style="text-align: left; font-size: 0.83rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 0.65rem;">
                    <div style="background: rgba(13, 148, 136, 0.14); border: 1px solid rgba(20, 184, 166, 0.45); border-radius: 0.6rem; padding: 0.55rem 0.65rem;">
                        <div style="font-size: 0.78rem; font-weight: 800; color: #5eead4;">
                            📍 ${cli.direccion || 'Sin dirección'} ${cli.localidad ? `• ${cli.localidad}` : ''}
                        </div>
                        <div style="font-size: 0.73rem; color: #ccfbf1; margin-top: 3px;">
                            🤝 <b>Visita de servicio / contacto sin pedido activo:</b> No genera factura ni movimiento de mercadería; al liquidar la ruta solo registra que pasaste por el cliente.
                        </div>
                    </div>

                    <div>
                        <label style="font-size: 0.74rem; font-weight: 800; color: #f8fafc; display: block; margin-bottom: 3px;">📝 Motivo / Nota para la visita (opcional):</label>
                        <input type="text" id="swal-cli-visita-nota" class="wizard-input-mobile" value="${(visitaExistente?.notas || '⭐ Visita comercial / servicio a Cliente Activo (sin pedido previo)').replace(/"/g, '&quot;')}" placeholder="Ej: Pasar a saludar y ver si necesitan reposición..." style="font-size: 0.83rem;">
                    </div>

                    <div>
                        <label style="font-size: 0.74rem; font-weight: 800; color: #f8fafc; display: block; margin-bottom: 4px;">🎯 ¿Dónde querés enviarlo?</label>
                        <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                            <button type="button" id="btn-cli-modo-pool" style="flex:1; padding:0.45rem 0.35rem; border-radius:0.55rem; border:1px solid #14b8a6; background:rgba(13,148,136,0.3); color:#fff; font-weight:800; font-size:0.73rem; cursor:pointer;">
                                📥 Pool Logística
                            </button>
                            ${rutasActivas.length > 0 ? `
                                <button type="button" id="btn-cli-modo-existente" style="flex:1; padding:0.45rem 0.35rem; border-radius:0.55rem; border:1px solid #475569; background:#0f172a; color:#94a3b8; font-weight:800; font-size:0.73rem; cursor:pointer;">
                                    📋 Ruta Activa
                                </button>
                            ` : ''}
                            <button type="button" id="btn-cli-modo-nueva" style="flex:1; padding:0.45rem 0.35rem; border-radius:0.55rem; border:1px solid #475569; background:#0f172a; color:#94a3b8; font-weight:800; font-size:0.73rem; cursor:pointer;">
                                ➕ Ruta Nueva
                            </button>
                        </div>
                    </div>

                    <div id="box-cli-ruta-existente" style="display: none;">
                        <label style="font-size: 0.72rem; font-weight: 800; color: #94a3b8; display: block; margin-bottom: 4px;">Seleccioná la Hoja de Ruta:</label>
                        <select id="swal-cli-id-ruta" class="wizard-input-mobile" style="font-size: 0.84rem; font-weight: 700;">
                            ${opcionesRutasHtml}
                        </select>
                    </div>

                    <div id="box-cli-ruta-nueva" style="display: none; flex-direction: column; gap: 0.45rem;">
                        <div>
                            <label style="font-size: 0.72rem; font-weight: 800; color: #94a3b8; display: block; margin-bottom: 3px;">Nombre de la Nueva Ruta:</label>
                            <input type="text" id="swal-cli-nombre-ruta" class="wizard-input-mobile" value="Visitas / Reparto (${fechaHoy})" style="font-size: 0.84rem; font-weight: 700;">
                        </div>
                        <div>
                            <label style="font-size: 0.72rem; font-weight: 800; color: #94a3b8; display: block; margin-bottom: 3px;">Chofer / Vendedor:</label>
                            <select id="swal-cli-chofer-ruta" class="wizard-input-mobile" style="font-size: 0.84rem;">
                                ${opcionesChoferesHtml}
                            </select>
                        </div>
                    </div>
                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: '📥 Confirmar Envío a Logística',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#0d9488',
            didOpen: () => {
                this._modoCliDestino = 'POOL';
                const bPo = document.getElementById('btn-cli-modo-pool');
                const bEx = document.getElementById('btn-cli-modo-existente');
                const bNu = document.getElementById('btn-cli-modo-nueva');
                const xEx = document.getElementById('box-cli-ruta-existente');
                const xNu = document.getElementById('box-cli-ruta-nueva');

                const setModo = (m) => {
                    this._modoCliDestino = m;
                    if (xEx) xEx.style.display = m === 'EXISTENTE' ? 'block' : 'none';
                    if (xNu) xNu.style.display = m === 'NUEVA' ? 'flex' : 'none';
                    if (bPo) {
                        bPo.style.background = m === 'POOL' ? 'rgba(13,148,136,0.3)' : '#0f172a';
                        bPo.style.borderColor = m === 'POOL' ? '#14b8a6' : '#475569';
                        bPo.style.color = m === 'POOL' ? '#fff' : '#94a3b8';
                    }
                    if (bEx) {
                        bEx.style.background = m === 'EXISTENTE' ? 'rgba(2,132,199,0.25)' : '#0f172a';
                        bEx.style.borderColor = m === 'EXISTENTE' ? '#38bdf8' : '#475569';
                        bEx.style.color = m === 'EXISTENTE' ? '#fff' : '#94a3b8';
                    }
                    if (bNu) {
                        bNu.style.background = m === 'NUEVA' ? 'rgba(234,88,12,0.25)' : '#0f172a';
                        bNu.style.borderColor = m === 'NUEVA' ? '#f97316' : '#475569';
                        bNu.style.color = m === 'NUEVA' ? '#fff' : '#94a3b8';
                    }
                };
                if (bPo) bPo.addEventListener('click', () => setModo('POOL'));
                if (bEx) bEx.addEventListener('click', () => setModo('EXISTENTE'));
                if (bNu) bNu.addEventListener('click', () => setModo('NUEVA'));
            },
            preConfirm: () => {
                const m = this._modoCliDestino || 'POOL';
                return {
                    id_cliente: cli.id_cliente,
                    id_domicilio: cli.id,
                    cliente_nombre: nombreCli,
                    alias: cli.alias,
                    direccion: cli.direccion,
                    localidad: cli.localidad,
                    latitud: cli.latitud,
                    longitud: cli.longitud,
                    telefono_contacto: cli.telefono_contacto,
                    notas: document.getElementById('swal-cli-visita-nota')?.value.trim(),
                    accion: m === 'POOL' ? 'ENVIAR_POOL' : 'ASIGNAR_RUTA',
                    crear_nueva_ruta: m === 'NUEVA',
                    id_ruta: m === 'EXISTENTE' ? document.getElementById('swal-cli-id-ruta')?.value : null,
                    nombre_ruta: document.getElementById('swal-cli-nombre-ruta')?.value,
                    id_chofer: document.getElementById('swal-cli-chofer-ruta')?.value || choferDefaultId
                };
            }
        });

        if (!formCli) return;

        try {
            const res = await fetch('/api/logistica/prospectos/visita-cliente-activo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formCli)
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            if (json.ruta?.id) {
                sessionStorage.setItem('activeRouteId', String(json.ruta.id));
            }

            await this.cargarProspectos();

            const irRes = await Swal.fire({
                icon: 'success',
                title: formCli.accion === 'ENVIAR_POOL' ? '📥 Cliente en Pool de Logística' : '🛣️ Cliente Asignado a Ruta',
                html: `<div style="font-size: 0.84rem; color: #cbd5e1; line-height: 1.45;">${json.message}</div>`,
                background: '#1e293b',
                color: '#fff',
                showCancelButton: true,
                confirmButtonText: '🛣️ Ir a Hoja de Ruta',
                cancelButtonText: 'Seguir en el Mapa',
                confirmButtonColor: '#0d9488'
            });
            if (irRes.isConfirmed) {
                window.location.href = 'ruta.html';
            }
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1e293b', color: '#fff' });
        }
    },

    async cambiarPoolLogisticaRapido(prospectoId, enPool) {
        try {
            const res = await fetch(`/api/logistica/prospectos/${prospectoId}/pool-logistica`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ en_pool_logistica: Boolean(enPool) })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            await this.cargarProspectos();
            Swal.fire({
                toast: true,
                position: 'top',
                icon: 'success',
                title: json.message || (enPool ? '📥 Enviado al Pool de Logística' : '↩️ Retirado del Pool de Logística'),
                timer: 2000,
                showConfirmButton: false,
                background: '#0f172a',
                color: '#fff'
            });
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1e293b', color: '#fff' });
        }
    },

    async cambiarEstadoRapido(prospectoId, nuevoEstado) {
        try {
            const res = await fetch(`/api/logistica/prospectos/${prospectoId}/estado`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: nuevoEstado })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);
            await Promise.all([this.cargarMetricas(), this.cargarProspectos()]);
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1e293b', color: '#fff' });
        }
    },

    async eliminarProspecto(prospectoId, nombreFantasia = '') {
        const p = this.prospectos.find(x => x.id === prospectoId);
        const nombre = nombreFantasia || (p ? p.nombre_fantasia : '');
        const titulo = nombre ? `¿Eliminar a "${nombre}"?` : '¿Eliminar prospecto?';

        const confirm = await Swal.fire({
            title: titulo,
            text: 'Esta acción dará de baja este comercio del listado y de la agenda.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '🗑️ Sí, eliminar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#475569',
            background: '#1e293b',
            color: '#fff'
        });

        if (confirm.isConfirmed) {
            try {
                const res = await fetch(`/api/logistica/prospectos/${prospectoId}`, { method: 'DELETE' });
                const json = await res.json();
                if (!json.success) throw new Error(json.error || 'Error al eliminar');

                Swal.fire({
                    toast: true,
                    position: 'top',
                    icon: 'success',
                    title: 'Comercio eliminado',
                    timer: 2000,
                    showConfirmButton: false,
                    background: '#0f172a',
                    color: '#fff'
                });

                await Promise.all([this.cargarMetricas(), this.cargarProspectos()]);
            } catch (e) {
                Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1e293b', color: '#fff' });
            }
        }
    },

    async abrirModalEditar(prospectoId) {
        const p = this.prospectos.find(x => x.id === prospectoId);
        if (!p) return;

        const opcionesListas = this.listasPrecios.map(l => `
            <option value="${l.id}" ${(p.lista_precios_sugerida_id && Number(p.lista_precios_sugerida_id) === Number(l.id)) ? 'selected' : ''}>
                ${l.nombre}
            </option>
        `).join('');

        const { value: formValues } = await Swal.fire({
            title: `✏️ Editar - ${p.codigo_prospecto}`,
            html: `
                <div style="text-align: left; font-size: 0.85rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 0.55rem;">
                    <div>
                        <label style="font-size:0.72rem; font-weight:800; color:#fff;">Nombre / Cartel *</label>
                        <input id="edit-nombre" class="wizard-input-mobile" value="${p.nombre_fantasia || ''}">
                    </div>
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                            <label style="font-size:0.72rem; font-weight:800; color:#cbd5e1;">Rubro(s) <span style="font-weight:400; color:#94a3b8; font-size:0.68rem;">(podés marcar varios)</span></label>
                        </div>
                        <div id="edit-rubros-container" style="display: flex; gap: 0.35rem; flex-wrap: wrap;"></div>
                        <div id="edit-rubro-custom-box" style="display: none; margin-top: 0.35rem;">
                            <input id="edit-rubro-custom" class="wizard-input-mobile" placeholder="✏️ Otro rubro..." oninput="ProspectosMobileController.sincronizarInputRubros('edit')" style="font-size: 0.82rem; border-color: #ea580c;">
                        </div>
                        <input type="hidden" id="edit-rubro-input" value="${p.rubro || 'Dietética'}">
                    </div>
                    <div style="display:flex; gap:0.4rem;">
                        <div style="flex:1.8;">
                            <label style="font-size:0.72rem; font-weight:700;">Dirección</label>
                            <input id="edit-direccion" class="wizard-input-mobile" value="${p.direccion || ''}">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:0.72rem; font-weight:700;">Zona</label>
                            <input id="edit-zona" class="wizard-input-mobile" value="${p.zona || ''}">
                        </div>
                    </div>

                    <!-- Botón y Caja Ampliable de Domicilio en Edición -->
                    <div style="margin-top: -0.2rem;">
                        <button type="button" id="btn-toggle-detalles-edit" onclick="ProspectosMobileController.toggleDetallesDomicilio('edit')" style="background: none; border: none; color: #fdba74; font-size: 0.72rem; font-weight: 700; cursor: pointer; padding: 2px 0; text-decoration: underline; display: flex; align-items: center; gap: 4px;">
                            <span>➕ Ampliar datos de domicilio (N°, e/ calles, piso/depto)</span>
                        </button>
                        <div id="edit-detalles-domicilio-box" style="display: none; background: rgba(0,0,0,0.25); border: 1px dashed #64748b; border-radius: 0.6rem; padding: 0.5rem; margin-top: 0.35rem; flex-direction: column; gap: 0.4rem;">
                            <div style="display: flex; gap: 0.4rem;">
                                <div style="flex: 1;">
                                    <label style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 0.15rem;">Altura / N°</label>
                                    <input id="edit-altura" class="wizard-input-mobile" placeholder="Ej: 1450" style="font-size: 0.8rem; padding: 0.4rem 0.5rem;">
                                </div>
                                <div style="flex: 1.2;">
                                    <label style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 0.15rem;">Piso / Depto / Local</label>
                                    <input id="edit-piso-depto" class="wizard-input-mobile" placeholder="Ej: Local 2" style="font-size: 0.8rem; padding: 0.4rem 0.5rem;">
                                </div>
                            </div>
                            <div>
                                <label style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; display: block; margin-bottom: 0.15rem;">Entre Calles (e/ ... y ...)</label>
                                <input id="edit-entre-calles" class="wizard-input-mobile" placeholder="Ej: e/ 485 y 486" style="font-size: 0.8rem; padding: 0.4rem 0.5rem;">
                            </div>
                        </div>
                    </div>

                    ${this.listasPrecios.length > 0 ? `
                        <div>
                            <label style="font-size:0.72rem; font-weight:700;">Lista de Precios Sugerida</label>
                            <select id="edit-lista" class="wizard-input-mobile">
                                <option value="">-- Sin Definir --</option>
                                ${opcionesListas}
                            </select>
                        </div>
                    ` : ''}
                    <div style="display:flex; gap:0.4rem;">
                        <div style="flex:1.8;">
                            <label style="font-size:0.72rem; font-weight:700;">Contacto</label>
                            <input id="edit-contacto" class="wizard-input-mobile" value="${p.contacto_nombre || ''}">
                        </div>
                        <div style="flex:1.2;">
                            <label style="font-size:0.72rem; font-weight:700;">Rol / Sector</label>
                            <select id="edit-rol" class="wizard-input-mobile" style="font-size:0.8rem;">
                                <option value="DUEÑO" ${p.contacto_rol === 'DUEÑO' ? 'selected' : ''}>Dueño/a</option>
                                <option value="ENCARGADO" ${p.contacto_rol === 'ENCARGADO' ? 'selected' : ''}>Encargado/a</option>
                                <option value="FIAMBRERIA" ${p.contacto_rol === 'FIAMBRERIA' ? 'selected' : ''}>Fiambrería</option>
                                <option value="CAJERO" ${p.contacto_rol === 'CAJERO' ? 'selected' : ''}>Cajero/a</option>
                                <option value="REPOSITOR" ${p.contacto_rol === 'REPOSITOR' ? 'selected' : ''}>Repositor/a</option>
                                <option value="EMPLEADO" ${p.contacto_rol === 'EMPLEADO' ? 'selected' : ''}>Mostrador</option>
                                <option value="OTRO" ${p.contacto_rol === 'OTRO' ? 'selected' : ''}>Otro</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label style="font-size:0.72rem; font-weight:800; color:#34d399;">WhatsApp</label>
                        <input id="edit-telefono" class="wizard-input-mobile" value="${this.formatearTelefono(p.telefono_whatsapp || '')}" placeholder="Ej: 221 351-1988">
                    </div>
                    <div style="display:flex; gap:0.4rem;">
                        <div style="flex:1;">
                            <label style="font-size:0.7rem; font-weight:700; color:#94a3b8;">🌐 Instagram / Web</label>
                            <input id="edit-web-redes" class="wizard-input-mobile" value="${p.web_redes || ''}" placeholder="@instagram o web" style="font-size:0.78rem;">
                        </div>
                        <div style="flex:1;">
                            <label style="font-size:0.7rem; font-weight:700; color:#94a3b8;">🖼️ URL Foto / Fachada</label>
                            <input id="edit-imagen-url" class="wizard-input-mobile" value="${p.imagen_url || ''}" placeholder="https://..." style="font-size:0.78rem;">
                        </div>
                    </div>
                    <div>
                        <label style="font-size:0.72rem; font-weight:700;">Notas</label>
                        <textarea id="edit-notas" class="wizard-input-mobile" rows="3">${p.notas || ''}</textarea>
                    </div>
                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Cambios',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#ea580c',
            didOpen: () => {
                this.renderPillsRubros(p.rubro || 'Dietética', 'edit');
                this.aplicarMascaraTelefono(document.getElementById('edit-telefono'));
            },
            preConfirm: () => {
                const nombre = document.getElementById('edit-nombre')?.value.trim();
                if (!nombre) {
                    Swal.showValidationMessage('El nombre es obligatorio.');
                    return false;
                }

                const rubroFinal = this.sincronizarInputRubros('edit') || 'Dietética';

                let dirBase = document.getElementById('edit-direccion')?.value.trim() || '';
                const altVal = document.getElementById('edit-altura')?.value.trim();
                const entreVal = document.getElementById('edit-entre-calles')?.value.trim();
                const pisoVal = document.getElementById('edit-piso-depto')?.value.trim();

                if (altVal && !dirBase.includes(altVal)) {
                    dirBase = `${dirBase} ${altVal}`.trim();
                }
                if (entreVal) {
                    dirBase = `${dirBase} (${entreVal.toLowerCase().startsWith('e/') ? entreVal : 'e/ ' + entreVal})`.trim();
                }
                if (pisoVal) {
                    dirBase = `${dirBase} [${pisoVal}]`.trim();
                }

                const telNuevo = document.getElementById('edit-telefono')?.value.trim();
                const estadoActualizado = (p.estado === 'POR_VISITAR' && telNuevo && !p.telefono_whatsapp)
                    ? 'CONTACTO_INICIAL'
                    : p.estado;

                return {
                    nombre_fantasia: nombre,
                    rubro: rubroFinal,
                    zona: document.getElementById('edit-zona')?.value.trim(),
                    direccion: dirBase,
                    lista_precios_sugerida_id: document.getElementById('edit-lista')?.value || null,
                    contacto_nombre: document.getElementById('edit-contacto')?.value.trim(),
                    contacto_rol: document.getElementById('edit-rol')?.value,
                    telefono_whatsapp: telNuevo,
                    web_redes: document.getElementById('edit-web-redes')?.value.trim(),
                    imagen_url: document.getElementById('edit-imagen-url')?.value.trim(),
                    estado: estadoActualizado,
                    notas: document.getElementById('edit-notas')?.value.trim()
                };
            }
        });

        if (formValues) {
            try {
                const res = await fetch(`/api/logistica/prospectos/${p.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formValues)
                });
                const json = await res.json();
                if (!json.success) throw new Error(json.error);
                await this.cargarProspectos();
            } catch (e) {
                Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1e293b', color: '#fff' });
            }
        }
    },

    // =========================================================
    // CONVERTIR A CLIENTE FORMAL
    // =========================================================
    async convertirACliente(prospectoId) {
        const p = this.prospectos.find(x => x.id === prospectoId);
        if (!p) return;

        const confirm = await Swal.fire({
            title: '🚀 Convertir a Cliente',
            html: `
                <div style="text-align: left; font-size: 0.85rem; color: #cbd5e1; line-height: 1.5;">
                    <p>Vas a pasar a <b>${p.nombre_fantasia}</b> al sistema oficial de clientes.</p>
                    <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px; padding: 10px; margin: 0.75rem 0;">
                        ✅ Se pre-cargarán: Nombre, Teléfono WhatsApp, Domicilio y Contacto.<br>
                        🏛️ En el siguiente paso podrás consultar su <b>CUIT en ARCA</b> para facturar y generar la ruta de entrega.
                    </div>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Continuar al Alta Oficial',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#059669',
            cancelButtonColor: '#475569',
            background: '#1e293b',
            color: '#fff'
        });

        if (confirm.isConfirmed) {
            const params = new URLSearchParams({
                fromProspecto: p.id,
                nombre: p.nombre_fantasia,
                direccion: p.direccion || '',
                zona: p.zona || '',
                telefono: p.telefono_whatsapp || '',
                contacto: p.contacto_nombre || '',
                rol: p.contacto_rol || ''
            });
            window.location.href = `crear-cliente-movil.html?${params.toString()}`;
        }
    }
,

    // =========================================================
    // NAVEGACIÓN ENTRE EL HUB PRINCIPAL Y LOS 3 PILARES
    // =========================================================
    volverAlMenuPrincipal() {
        this.seccionActiva = 'HUB';
        document.getElementById('vista-hub-calle').style.display = 'flex';
        document.getElementById('seccion-contactos-detectados').style.display = 'none';
        document.getElementById('seccion-marcar-calle').style.display = 'none';
        document.getElementById('seccion-config-rutas-dias').style.display = 'none';
        document.getElementById('btn-volver-hub-calle').style.display = 'none';
        document.getElementById('header-titulo-seccion').innerText = 'Contacto Calle';
        document.getElementById('contador-prospectos-mobile').innerText = 'Menú Principal';
        this.actualizarHubPrincipal();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    abrirSeccionDetectados(modo = 'CALLE') {
        this.seccionActiva = 'DETECTADOS';
        document.getElementById('vista-hub-calle').style.display = 'none';
        document.getElementById('seccion-contactos-detectados').style.display = 'block';
        document.getElementById('seccion-marcar-calle').style.display = 'none';
        document.getElementById('seccion-config-rutas-dias').style.display = 'none';
        document.getElementById('btn-volver-hub-calle').style.display = 'inline-flex';
        document.getElementById('header-titulo-seccion').innerText = 'Contactos Detectados';
        this.irATabPrincipal(modo);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    abrirSeccionMarcarEnCalle() {
        this.seccionActiva = 'MARCAR_CALLE';
        document.getElementById('vista-hub-calle').style.display = 'none';
        document.getElementById('seccion-contactos-detectados').style.display = 'none';
        document.getElementById('seccion-marcar-calle').style.display = 'block';
        document.getElementById('seccion-config-rutas-dias').style.display = 'none';
        document.getElementById('btn-volver-hub-calle').style.display = 'inline-flex';
        document.getElementById('header-titulo-seccion').innerText = 'Marcar en Calle';
        document.getElementById('contador-prospectos-mobile').innerText = 'Paso 1: Relevamiento en calle';

        // Resetear campos del Paso 1 y Paso 2
        document.getElementById('calle-paso-1-container').style.display = 'block';
        document.getElementById('calle-paso-2-container').style.display = 'none';
        document.getElementById('calle-nombre-negocio').value = '';
        document.getElementById('calle-direccion').value = '';
        document.getElementById('calle-nota-afuera').value = '';
        document.getElementById('calle-contacto-nombre').value = '';
        document.getElementById('calle-telefono').value = '';
        document.getElementById('calle-notas-adentro').value = '';

        // Autoseleccionar rutas activas en el turno de hoy por defecto
        this.rutasSeleccionadasPaso1 = new Set();
        const tokenHoy = this.obtenerTokenDiaTurnoActual();
        const [dHoy, tHoy] = tokenHoy.split('_');
        (this.configRutasDias?.cronograma || []).forEach(c => {
            if (Number(c.dia_semana) === Number(dHoy) && c.turno === tHoy) {
                this.rutasSeleccionadasPaso1.add(Number(c.ruta_zona_id));
            }
        });

        this.diasTurnosSeleccionadosPaso2 = new Set();
        this.renderPillsRubros('Autoservicio', 'calle');
        this.renderPillsRutasZonaPaso1();
        this.renderPillsDiasTurnosPaso2();
        this.renderSelectListasPaso2();
        this.capturarGpsPaso1();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    abrirSeccionConfigRutasDias() {
        this.seccionActiva = 'CONFIG_RUTAS';
        document.getElementById('vista-hub-calle').style.display = 'none';
        document.getElementById('seccion-contactos-detectados').style.display = 'none';
        document.getElementById('seccion-marcar-calle').style.display = 'none';
        document.getElementById('seccion-config-rutas-dias').style.display = 'block';
        document.getElementById('btn-volver-hub-calle').style.display = 'inline-flex';
        document.getElementById('header-titulo-seccion').innerText = 'Rutas y Días';
        document.getElementById('contador-prospectos-mobile').innerText = 'Casa ↔ Depósito • 7 Días (M/T)';

        this.renderSeccionConfigRutasDias();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // =========================================================
    // LÓGICA DE NODOS, RUTAS/ZONAS LINEALES Y CRONOGRAMA 7 DÍAS
    // =========================================================
    DIAS_NOMBRES: {
        1: 'Lunes',
        2: 'Martes',
        3: 'Miércoles',
        4: 'Jueves',
        5: 'Viernes',
        6: 'Sábado',
        7: 'Domingo'
    },

    DIAS_CORTOS: {
        1: 'Lun',
        2: 'Mar',
        3: 'Mié',
        4: 'Jue',
        5: 'Vie',
        6: 'Sáb',
        7: 'Dom'
    },

    obtenerTokenDiaTurnoActual() {
        const now = new Date();
        const jsDay = now.getDay(); // 0=Dom, 1=Lun...
        const dia = jsDay === 0 ? 7 : jsDay;
        const turno = now.getHours() < 14 ? 'MANANA' : 'TARDE';
        return `${dia}_${turno}`;
    },

    formatearTokenDiaTurno(token) {
        const [d, t] = String(token || '').split('_');
        const diaNom = this.DIAS_CORTOS[Number(d)] || 'Día';
        const turnoNom = t === 'TARDE' ? 'Tarde' : 'Mañana';
        return `${diaNom} ${turnoNom}`;
    },

    async cargarConfigRutasDias() {
        try {
            const res = await fetch('/api/logistica/prospectos/config-rutas-dias');
            const json = await res.json();
            if (json.success && json.data) {
                this.configRutasDias = json.data;
                this.renderSelectFiltroRutasZona();
                this.actualizarHubPrincipal();
            }
        } catch (e) {
            console.error('[CONTACTO-CALLE] Error cargando config rutas/días:', e);
        }
    },

    actualizarHubPrincipal() {
        this.actualizarContadoresOrigen();

        // Actualizar banner del Turno de Hoy en el Hub
        const tokenHoy = this.obtenerTokenDiaTurnoActual();
        const [diaStr, turnoStr] = tokenHoy.split('_');
        const nombreDia = this.DIAS_NOMBRES[Number(diaStr)] || 'Hoy';
        const nombreTurno = turnoStr === 'TARDE' ? '🌇 Tarde' : '🌅 Mañana';

        const lblDia = document.getElementById('lbl-hub-dia-turno-hoy');
        const lblRutas = document.getElementById('lbl-hub-rutas-hoy');
        const btnVerHoy = document.getElementById('btn-hub-ver-hoy');

        const asignadasHoy = (this.configRutasDias?.cronograma || []).filter(
            c => Number(c.dia_semana) === Number(diaStr) && c.turno === turnoStr
        );

        if (lblDia) lblDia.innerText = `🗓️ ${nombreDia} (${nombreTurno}):`;
        if (lblRutas) {
            if (asignadasHoy.length > 0) {
                lblRutas.innerHTML = asignadasHoy.map(a => `<b style="color:#6ee7b7;">${a.ruta_zona_nombre}</b>`).join(' + ');
                if (btnVerHoy) btnVerHoy.style.display = 'inline-block';
            } else {
                lblRutas.innerHTML = `<span style="color:#94a3b8;">Sin Ruta/Zona asignada aún para este turno</span>`;
                if (btnVerHoy) btnVerHoy.style.display = 'none';
            }
        }

        // Actualizar banner de seleccionados para Hoja de Ruta en el Hub
        const bannerRutaHub = document.getElementById('hub-banner-ruta-seleccionada');
        const lblRutaHub = document.getElementById('lbl-hub-ruta-count');
        if (bannerRutaHub) {
            if (this.rutaIds && this.rutaIds.length > 0) {
                bannerRutaHub.style.display = 'flex';
                if (lblRutaHub) lblRutaHub.innerText = `${this.rutaIds.length} ${this.rutaIds.length === 1 ? 'contacto listo' : 'contactos listos'} para enviar a Hoja de Ruta`;
            } else {
                bannerRutaHub.style.display = 'none';
            }
        }
    },

    verContactosDelTurnoActual() {
        const tokenHoy = this.obtenerTokenDiaTurnoActual();
        this.filtroDiaTurno = tokenHoy;
        const sel = document.getElementById('select-filtro-dia-turno');
        const selMap = document.getElementById('mapa-select-turno');
        if (sel) sel.value = tokenHoy;
        if (selMap) selMap.value = tokenHoy;
        this.abrirSeccionDetectados('MAPA');
    },

    renderSelectFiltroRutasZona() {
        const rutas = this.configRutasDias?.rutas_zona || [];
        let html = `<option value="" ${!this.filtroRutaZonaId ? 'selected' : ''}>🛣️ Todas las Rutas</option>`;
        html += `<option value="NINGUNA" ${this.filtroRutaZonaId === 'NINGUNA' ? 'selected' : ''}>🚫 Ninguna Ruta</option>`;
        rutas.forEach(rz => {
            const selected = String(this.filtroRutaZonaId) === String(rz.id) ? 'selected' : '';
            html += `<option value="${rz.id}" ${selected}>🛣️ ${rz.nombre}</option>`;
        });
        const selList = document.getElementById('select-filtro-ruta-zona');
        const selMap = document.getElementById('mapa-select-ruta');
        if (selList) selList.innerHTML = html;
        if (selMap) selMap.innerHTML = html;
    },

    seleccionarFiltroRutaZona(val) {
        this.filtroRutaZonaId = val || '';
        const selList = document.getElementById('select-filtro-ruta-zona');
        const selMap = document.getElementById('mapa-select-ruta');
        if (selList && selList.value !== this.filtroRutaZonaId) selList.value = this.filtroRutaZonaId;
        if (selMap && selMap.value !== this.filtroRutaZonaId) selMap.value = this.filtroRutaZonaId;
        this.aplicarFiltros();
    },

    seleccionarFiltroDiaTurno(val) {
        this.filtroDiaTurno = val || '';
        const selList = document.getElementById('select-filtro-dia-turno');
        const selMap = document.getElementById('mapa-select-turno');
        if (selList && selList.value !== this.filtroDiaTurno) selList.value = this.filtroDiaTurno;
        if (selMap && selMap.value !== this.filtroDiaTurno) selMap.value = this.filtroDiaTurno;
        this.aplicarFiltros();
    },

    seleccionarVisiblesParaHojaDeRuta() {
        if (!this.prospectosFiltrados || this.prospectosFiltrados.length === 0) {
            Swal.fire({ icon: 'info', title: 'Sin contactos en vista', text: 'No hay contactos visibles en este filtro.', background: '#1e293b', color: '#fff' });
            return;
        }
        const ids = this.prospectosFiltrados.map(p => Number(p.id));
        ids.forEach(id => {
            if (!this.rutaIds.includes(id)) this.rutaIds.push(id);
        });
        this.guardarRutaLocal();
        this.abrirModalEnviarAHojaDeRuta(ids);
    },

    /**
     * Genera automáticamente una superficie alargada (polígono de influencia) alrededor de un camino lineal
     * compuesto por [{lat, lng}, ...], con subdivisión intermedia para permitir deformar bordes por tramos.
     */
    generarPoligonoBufferDeCamino(puntosCamino, anchoMetros = 350) {
        if (!Array.isArray(puntosCamino) || puntosCamino.length < 2) return [];
        const METROS_POR_LAT = 111320;
        const METROS_POR_LNG = 91300; // Aprox a latitud -34.9° (La Plata)
        const radio = Math.max(60, Number(anchoMetros) || 350);

        // 1. Subdividir segmentos largos cada ~650 metros para que haya manijas (vértices) cómodas para deformar bordes
        const puntosDensos = [];
        for (let i = 0; i < puntosCamino.length - 1; i++) {
            const pA = { lat: parseFloat(puntosCamino[i].lat), lng: parseFloat(puntosCamino[i].lng) };
            const pB = { lat: parseFloat(puntosCamino[i + 1].lat), lng: parseFloat(puntosCamino[i + 1].lng) };
            if (isNaN(pA.lat) || isNaN(pA.lng) || isNaN(pB.lat) || isNaN(pB.lng)) continue;

            puntosDensos.push(pA);
            const dx = (pB.lng - pA.lng) * METROS_POR_LNG;
            const dy = (pB.lat - pA.lat) * METROS_POR_LAT;
            const dist = Math.hypot(dx, dy);
            const pasos = Math.min(5, Math.max(1, Math.floor(dist / 650)));
            for (let s = 1; s < pasos; s++) {
                const t = s / pasos;
                puntosDensos.push({
                    lat: pA.lat + (pB.lat - pA.lat) * t,
                    lng: pA.lng + (pB.lng - pA.lng) * t
                });
            }
        }
        const ultimo = puntosCamino[puntosCamino.length - 1];
        if (ultimo && !isNaN(parseFloat(ultimo.lat)) && !isNaN(parseFloat(ultimo.lng))) {
            puntosDensos.push({ lat: parseFloat(ultimo.lat), lng: parseFloat(ultimo.lng) });
        }
        if (puntosDensos.length < 2) return [];

        // 2. Calcular normales izquierda y derecha en cada vértice del camino
        const ladoIzq = [];
        const ladoDer = [];

        for (let i = 0; i < puntosDensos.length; i++) {
            let nx = 0, ny = 0;

            if (i > 0) {
                const dx1 = (puntosDensos[i].lng - puntosDensos[i - 1].lng) * METROS_POR_LNG;
                const dy1 = (puntosDensos[i].lat - puntosDensos[i - 1].lat) * METROS_POR_LAT;
                const len1 = Math.hypot(dx1, dy1) || 1;
                nx += -dy1 / len1;
                ny += dx1 / len1;
            }
            if (i < puntosDensos.length - 1) {
                const dx2 = (puntosDensos[i + 1].lng - puntosDensos[i].lng) * METROS_POR_LNG;
                const dy2 = (puntosDensos[i + 1].lat - puntosDensos[i].lat) * METROS_POR_LAT;
                const len2 = Math.hypot(dx2, dy2) || 1;
                nx += -dy2 / len2;
                ny += dx2 / len2;
            }

            const nLen = Math.hypot(nx, ny) || 1;
            nx = (nx / nLen) * radio;
            ny = (ny / nLen) * radio;

            // Cabecera de salida y llegada: extender media cápsula hacia atrás/adelante
            let extX = 0, extY = 0;
            if (i === 0) {
                const dx0 = (puntosDensos[1].lng - puntosDensos[0].lng) * METROS_POR_LNG;
                const dy0 = (puntosDensos[1].lat - puntosDensos[0].lat) * METROS_POR_LAT;
                const l0 = Math.hypot(dx0, dy0) || 1;
                extX = -(dx0 / l0) * (radio * 0.45);
                extY = -(dy0 / l0) * (radio * 0.45);
            } else if (i === puntosDensos.length - 1) {
                const dxN = (puntosDensos[i].lng - puntosDensos[i - 1].lng) * METROS_POR_LNG;
                const dyN = (puntosDensos[i].lat - puntosDensos[i - 1].lat) * METROS_POR_LAT;
                const lN = Math.hypot(dxN, dyN) || 1;
                extX = (dxN / lN) * (radio * 0.45);
                extY = (dyN / lN) * (radio * 0.45);
            }

            ladoIzq.push({
                lat: Number((puntosDensos[i].lat + (ny + extY) / METROS_POR_LAT).toFixed(6)),
                lng: Number((puntosDensos[i].lng + (nx + extX) / METROS_POR_LNG).toFixed(6))
            });
            ladoDer.push({
                lat: Number((puntosDensos[i].lat + (-ny + extY) / METROS_POR_LAT).toFixed(6)),
                lng: Number((puntosDensos[i].lng + (-nx + extX) / METROS_POR_LNG).toFixed(6))
            });
        }

        return [...ladoIzq, ...ladoDer.reverse()];
    },

    /**
     * Algoritmo Ray-Casting para saber si un punto (lat, lng) cae dentro de un polígono [{lat, lng}, ...]
     */
    estaPuntoDentroDePoligono(lat, lng, poligono) {
        if (!lat || !lng || !Array.isArray(poligono) || poligono.length < 3) return false;
        const y = parseFloat(lat);
        const x = parseFloat(lng);
        if (isNaN(y) || isNaN(x)) return false;

        let adentro = false;
        for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
            const yi = parseFloat(poligono[i].lat), xi = parseFloat(poligono[i].lng);
            const yj = parseFloat(poligono[j].lat), xj = parseFloat(poligono[j].lng);
            const intersecta = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
            if (intersecta) adentro = !adentro;
        }
        return adentro;
    },

    /**
     * Resuelve para un prospecto dado:
     * - Sus Rutas/Zonas asignadas (explícitas en rutas_zona_ids, o porque su coordenada cae dentro de la superficie poligonal, o por calle)
     * - Los Días y Turnos (Mañana/Tarde) habilitados (heredados de sus Rutas/Zonas en el cronograma + puntuales)
     */
    obtenerRutasYDiasDeProspecto(p) {
        const rutasDisponibles = this.configRutasDias?.rutas_zona || [];
        const cronograma = this.configRutasDias?.cronograma || [];

        const rIdsSet = new Set();
        if (Array.isArray(p.rutas_zona_ids)) {
            p.rutas_zona_ids.map(Number).filter(Boolean).forEach(id => rIdsSet.add(id));
        } else if (typeof p.rutas_zona_ids === 'string') {
            try {
                JSON.parse(p.rutas_zona_ids).map(Number).filter(Boolean).forEach(id => rIdsSet.add(id));
            } catch (_) {}
        }

        // Inclusión geométrica automática si el punto cae dentro del polígono de influencia de alguna Ruta/Zona
        if (p.latitud && p.longitud) {
            rutasDisponibles.forEach(rz => {
                if (Array.isArray(rz.poligono_json) && rz.poligono_json.length >= 3) {
                    if (this.estaPuntoDentroDePoligono(p.latitud, p.longitud, rz.poligono_json)) {
                        rIdsSet.add(Number(rz.id));
                    }
                }
            });
        }

        // Fallback por coincidencia de calle si aún no tiene ruta_zona asignada
        if (rIdsSet.size === 0 && p.direccion) {
            const dirLower = p.direccion.toLowerCase();
            rutasDisponibles.forEach(rz => {
                if (!rz.calles_involucradas) return;
                const calles = rz.calles_involucradas.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length >= 4);
                if (calles.some(calle => dirLower.includes(calle))) {
                    rIdsSet.add(Number(rz.id));
                }
            });
        }

        const rIds = Array.from(rIdsSet);

        const rutasObjetos = rutasDisponibles.filter(rz => rIds.includes(Number(rz.id)));

        // Días y turnos heredados del cronograma de esas Rutas/Zonas
        const tokensSet = new Set();
        cronograma.forEach(c => {
            if (rIds.includes(Number(c.ruta_zona_id))) {
                tokensSet.add(`${c.dia_semana}_${c.turno}`);
            }
        });

        // Sumar días y turnos puntuales del prospecto
        let puntuales = [];
        if (Array.isArray(p.dias_turnos_puntuales)) {
            puntuales = p.dias_turnos_puntuales;
        } else if (typeof p.dias_turnos_puntuales === 'string') {
            try { puntuales = JSON.parse(p.dias_turnos_puntuales); } catch (_) {}
        }
        puntuales.forEach(tok => {
            if (tok) tokensSet.add(String(tok));
        });

        const diasTurnosTokens = Array.from(tokensSet);
        const etiquetasDiasTurnos = diasTurnosTokens.map(t => this.formatearTokenDiaTurno(t));

        return {
            rutasIds: rIds,
            rutasObjetos,
            diasTurnosTokens,
            etiquetasDiasTurnos
        };
    },

    // =========================================================
    // PILAR 2: MARCAR CONTACTO EN CALLE (PASO 1 AFUERA / PASO 2 ADENTRO)
    // =========================================================
    capturarGpsPaso1() {
        const statusEl = document.getElementById('calle-gps-status');
        if (!navigator.geolocation) {
            if (statusEl) statusEl.innerText = '⚠️ El navegador no tiene permiso de GPS.';
            return;
        }
        if (statusEl) statusEl.innerText = '📡 Buscando señal satelital del celular...';

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                document.getElementById('calle-lat').value = lat.toFixed(6);
                document.getElementById('calle-lng').value = lng.toFixed(6);
                if (statusEl) {
                    statusEl.innerHTML = `<span style="color:#34d399; font-weight:800;">✅ Punto GPS fijado (${lat.toFixed(4)}, ${lng.toFixed(4)})</span>`;
                }

                // Geocodificación reversa automática para completar la calle donde está parado
                try {
                    const nomRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
                    if (nomRes.ok) {
                        const nomData = await nomRes.json();
                        const addr = nomData.address || {};
                        const calle = addr.road || addr.pedestrian || '';
                        const altura = addr.house_number || '';
                        const barrio = addr.suburb || addr.neighbourhood || addr.city_district || addr.town || addr.city || '';
                        const dirArmada = [calle, altura].filter(Boolean).join(' ');
                        const inputDir = document.getElementById('calle-direccion');
                        if (inputDir && !inputDir.value.trim() && dirArmada) {
                            inputDir.value = barrio ? `${dirArmada} (${barrio})` : dirArmada;
                        }
                    }
                } catch (_) {}
            },
            () => {
                if (statusEl) {
                    statusEl.innerHTML = `<span style="color:#facc15;">⚠️ GPS no disponible (podés escribir la calle manualmente)</span>`;
                }
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    },

    renderPillsRutasZonaPaso1() {
        const container = document.getElementById('calle-rutas-zona-pills');
        if (!container) return;
        const rutas = this.configRutasDias?.rutas_zona || [];
        if (rutas.length === 0) {
            container.innerHTML = `<span style="font-size:0.75rem; color:#94a3b8;">Aún no definiste Rutas/Zonas. Podés crearlas en el menú 3.</span>`;
            return;
        }
        container.innerHTML = rutas.map(rz => {
            const active = this.rutasSeleccionadasPaso1.has(Number(rz.id));
            return `
                <button type="button" onclick="ProspectosMobileController.toggleRutaZonaPaso1(${rz.id})" class="pill-select ${active ? 'active' : ''}" style="${active ? `background:${rz.color || '#059669'}; border-color:${rz.color || '#10b981'}; color:#fff;` : ''}">
                    ${active ? '✓ ' : '🛣️ '}${rz.nombre}
                </button>
            `;
        }).join('');
    },

    toggleRutaZonaPaso1(id) {
        const numId = Number(id);
        if (this.rutasSeleccionadasPaso1.has(numId)) {
            this.rutasSeleccionadasPaso1.delete(numId);
        } else {
            this.rutasSeleccionadasPaso1.add(numId);
        }
        this.renderPillsRutasZonaPaso1();
    },

    renderPillsDiasTurnosPaso2() {
        const container = document.getElementById('calle-dias-turnos-pills');
        if (!container) return;
        const opciones = [
            { tok: '1_MANANA', lbl: 'Lun Mañana' }, { tok: '1_TARDE', lbl: 'Lun Tarde' },
            { tok: '2_MANANA', lbl: 'Mar Mañana' }, { tok: '2_TARDE', lbl: 'Mar Tarde' },
            { tok: '3_MANANA', lbl: 'Mié Mañana' }, { tok: '3_TARDE', lbl: 'Mié Tarde' },
            { tok: '4_MANANA', lbl: 'Jue Mañana' }, { tok: '4_TARDE', lbl: 'Jue Tarde' },
            { tok: '5_MANANA', lbl: 'Vie Mañana' }, { tok: '5_TARDE', lbl: 'Vie Tarde' },
            { tok: '6_MANANA', lbl: 'Sáb Mañana' }
        ];
        container.innerHTML = opciones.map(o => {
            const active = this.diasTurnosSeleccionadosPaso2.has(o.tok);
            return `
                <button type="button" onclick="ProspectosMobileController.toggleDiaTurnoPaso2('${o.tok}')" class="pill-select ${active ? 'active' : ''}" style="font-size:0.71rem; padding:0.3rem 0.55rem;">
                    ${active ? '✓ ' : ''}${o.lbl}
                </button>
            `;
        }).join('');
    },

    toggleDiaTurnoPaso2(tok) {
        if (this.diasTurnosSeleccionadosPaso2.has(tok)) {
            this.diasTurnosSeleccionadosPaso2.delete(tok);
        } else {
            this.diasTurnosSeleccionadosPaso2.add(tok);
        }
        this.renderPillsDiasTurnosPaso2();
    },

    renderSelectListasPaso2() {
        const sel = document.getElementById('calle-lista-precios-id');
        if (!sel) return;
        sel.innerHTML = (this.listasPrecios || []).map(l => `
            <option value="${l.id}" ${Number(l.id) === 5 || l.nombre.toLowerCase().includes('dietetica') ? 'selected' : ''}>
                📋 ${l.nombre}
            </option>
        `).join('');
    },

    irAPaso2AdentroDelLocal() {
        const nombre = document.getElementById('calle-nombre-negocio')?.value.trim();
        if (!nombre) {
            Swal.fire({
                icon: 'warning',
                title: 'Falta el nombre o referencia del negocio',
                text: 'Escribí el nombre del cartel o una referencia rápida antes de pasar a cargar los datos de atención.',
                background: '#1e293b',
                color: '#fff'
            });
            return;
        }
        const dir = document.getElementById('calle-direccion')?.value.trim() || 'Ubicación GPS';
        const rubro = this.sincronizarInputRubros('calle');
        document.getElementById('calle-paso2-resumen-negocio').innerHTML = `🏪 <b>${nombre}</b> <span style="color:#94a3b8; font-weight:600;">(${rubro} • ${dir})</span>`;
        document.getElementById('calle-paso-1-container').style.display = 'none';
        document.getElementById('calle-paso-2-container').style.display = 'block';
        document.getElementById('contador-prospectos-mobile').innerText = 'Paso 2: Datos adentro del local';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    volverAPaso1Vereda() {
        document.getElementById('calle-paso-2-container').style.display = 'none';
        document.getElementById('calle-paso-1-container').style.display = 'block';
        document.getElementById('contador-prospectos-mobile').innerText = 'Paso 1: Relevamiento en calle';
    },

    async guardarContactoCallePaso1SoloAfuera() {
        const nombre = document.getElementById('calle-nombre-negocio')?.value.trim();
        if (!nombre) {
            Swal.fire({ icon: 'warning', title: 'Nombre requerido', text: 'Poné el nombre del negocio o referencia visual (ej: Dietética esquina 31).', background: '#1e293b', color: '#fff' });
            return;
        }
        const payload = {
            origen_contacto: 'CALLE',
            nombre_fantasia: nombre,
            direccion: document.getElementById('calle-direccion')?.value.trim() || null,
            latitud: document.getElementById('calle-lat')?.value || null,
            longitud: document.getElementById('calle-lng')?.value || null,
            rubro: this.sincronizarInputRubros('calle') || 'Comercio',
            notas: document.getElementById('calle-nota-afuera')?.value.trim() || null,
            estado: 'POR_VISITAR',
            entramos_local: false,
            rutas_zona_ids: Array.from(this.rutasSeleccionadasPaso1),
            dias_turnos_puntuales: [],
            lista_precios_sugerida_id: 5
        };

        try {
            const res = await fetch('/api/logistica/prospectos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            await this.cargarProspectos();
            await Swal.fire({
                icon: 'success',
                title: '📍 Punto Marcado en Calle',
                text: `"${nombre}" quedó guardado en tus Contactos Vía Territorio para pasar a visitarlo.`,
                timer: 2000,
                showConfirmButton: false,
                background: '#1e293b',
                color: '#fff'
            });
            this.volverAlMenuPrincipal();
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1e293b', color: '#fff' });
        }
    },

    async guardarContactoCallePaso2Completo() {
        const nombre = document.getElementById('calle-nombre-negocio')?.value.trim();
        if (!nombre) {
            this.volverAPaso1Vereda();
            return;
        }
        const notaAfuera = document.getElementById('calle-nota-afuera')?.value.trim();
        const notaAdentro = document.getElementById('calle-notas-adentro')?.value.trim();
        const notasCombinadas = [notaAfuera, notaAdentro].filter(Boolean).join(' | ') || null;
        const telefono = document.getElementById('calle-telefono')?.value.trim() || null;
        const enviarListaWa = document.getElementById('calle-enviar-lista-wa')?.checked && telefono && telefono.replace(/\D/g, '').length >= 8;
        const listaId = document.getElementById('calle-lista-precios-id')?.value || 5;

        const payload = {
            origen_contacto: 'CALLE',
            nombre_fantasia: nombre,
            direccion: document.getElementById('calle-direccion')?.value.trim() || null,
            latitud: document.getElementById('calle-lat')?.value || null,
            longitud: document.getElementById('calle-lng')?.value || null,
            rubro: this.sincronizarInputRubros('calle') || 'Comercio',
            contacto_nombre: document.getElementById('calle-contacto-nombre')?.value.trim() || null,
            contacto_rol: document.getElementById('calle-contacto-rol')?.value || 'ENCARGADO',
            telefono_whatsapp: telefono,
            notas: notasCombinadas,
            estado: enviarListaWa ? 'LISTA_ENVIADA' : 'CONTACTO_INICIAL',
            entramos_local: true,
            rutas_zona_ids: Array.from(this.rutasSeleccionadasPaso1),
            dias_turnos_puntuales: Array.from(this.diasTurnosSeleccionadosPaso2),
            lista_precios_sugerida_id: listaId
        };

        Swal.fire({
            title: 'Guardando visita...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading(),
            background: '#1e293b',
            color: '#fff'
        });

        try {
            const res = await fetch('/api/logistica/prospectos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error);

            const nuevoProspecto = json.data;

            if (enviarListaWa && nuevoProspecto?.id) {
                try {
                    await fetch(`/api/logistica/prospectos/${nuevoProspecto.id}/enviar-catalogo-whatsapp`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            telefono: telefono,
                            lista_id: listaId,
                            nombre_contacto: payload.contacto_nombre || nombre
                        })
                    });
                } catch (errWa) {
                    console.warn('[CONTACTO-CALLE] Error enviando catálogo automático:', errWa);
                }
            }

            await this.cargarProspectos();
            await Swal.fire({
                icon: 'success',
                title: enviarListaWa ? '✅ Visita Guardada y Lista PDF Enviada' : '✅ Visita Guardada en Territorio',
                text: `Se registró el contacto con ${payload.contacto_nombre || nombre} correctamente.`,
                timer: 2300,
                showConfirmButton: false,
                background: '#1e293b',
                color: '#fff'
            });
            this.abrirSeccionDetectados('CALLE');
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1e293b', color: '#fff' });
        }
    },

    // =========================================================
    // PILAR 3: CONFIGURACIÓN DE NODOS, RUTAS/ZONAS Y 7 DÍAS (M/T)
    // =========================================================
    renderSeccionConfigRutasDias() {
        this.renderConfigNodos();
        this.renderConfigRutasZona();
        this.renderConfigCronograma7Dias();
    },

    async guardarUbicacionRapidaNodo(nodo, lat, lng) {
        let dirDetectada = nodo.direccion;
        try {
            const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
            if (r.ok) {
                const d = await r.json();
                const road = d.address?.road || d.address?.pedestrian || '';
                const num = d.address?.house_number || '';
                const suburb = d.address?.suburb || d.address?.neighbourhood || d.address?.town || '';
                const base = [road, num].filter(Boolean).join(' ');
                if (base) dirDetectada = suburb ? `${base}, ${suburb}` : base;
            }
        } catch (_) {}

        const res = await fetch('/api/logistica/prospectos/nodos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: nodo.id,
                nombre: nodo.nombre,
                icono: nodo.icono,
                direccion: dirDetectada,
                latitud: lat,
                longitud: lng
            })
        });
        const json = await res.json();
        if (json.success && json.config) {
            this.configRutasDias = json.config;
            this.renderSeccionConfigRutasDias();
            this.initOrUpdateMapa();
            Swal.fire({ toast: true, position: 'top', icon: 'success', title: `${nodo.icono || '📍'} ${nodo.nombre} movido a ${dirDetectada || 'nueva ubicación'}`, timer: 2200, showConfirmButton: false, background: '#0f172a', color: '#fff' });
        }
    },

    async abrirModalUbicarContactoEnMapa(prospectoId) {
        const p = this.prospectos.find(x => Number(x.id) === Number(prospectoId));
        if (!p) return;
        const initLat = p.latitud ? parseFloat(p.latitud) : -34.92145;
        const initLng = p.longitud ? parseFloat(p.longitud) : -57.95453;
        let mapP = null;
        let markerP = null;

        const actualizarPin = async (lat, lng, centrar = false) => {
            document.getElementById('swal-prosp-lat').value = lat.toFixed(6);
            document.getElementById('swal-prosp-lng').value = lng.toFixed(6);
            if (markerP) markerP.setLatLng([lat, lng]);
            if (centrar && mapP) mapP.setView([lat, lng], 16);
            try {
                const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
                if (r.ok) {
                    const d = await r.json();
                    const road = d.address?.road || '';
                    const num = d.address?.house_number || '';
                    const dirArmada = [road, num].filter(Boolean).join(' ');
                    if (dirArmada) document.getElementById('swal-prosp-dir').value = dirArmada;
                }
            } catch (_) {}
        };

        const { value: form } = await Swal.fire({
            title: `📌 Ubicar ${p.nombre_fantasia}`,
            width: '96vw',
            html: `
                <div style="text-align:left; font-size:0.82rem; color:#cbd5e1; display:flex; flex-direction:column; gap:0.5rem;">
                    <div style="font-size:0.74rem; color:#fdba74; font-weight:800;">👆 Tocá el mapa o arrastrá el pin hasta la cuadra exacta:</div>
                    <div id="swal-prosp-mapa-canvas" style="width:100%; height:52dvh; min-height:330px; border-radius:0.75rem; border:2px solid #ea580c; overflow:hidden; background:#0f172a;"></div>
                    <div>
                        <label style="font-size:0.71rem; font-weight:800;">📍 Dirección:</label>
                        <input id="swal-prosp-dir" class="wizard-input-mobile" value="${p.direccion || ''}" style="font-size:0.82rem;">
                    </div>
                    <input type="hidden" id="swal-prosp-lat" value="${initLat}">
                    <input type="hidden" id="swal-prosp-lng" value="${initLng}">
                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Ubicación',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#ea580c',
            didOpen: () => {
                setTimeout(() => {
                    mapP = L.map('swal-prosp-mapa-canvas').setView([initLat, initLng], 16);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapP);
                    markerP = L.marker([initLat, initLng], { draggable: true }).addTo(mapP);
                    mapP.on('click', (e) => actualizarPin(e.latlng.lat, e.latlng.lng, false));
                    markerP.on('dragend', (e) => {
                        const pos = e.target.getLatLng();
                        actualizarPin(pos.lat, pos.lng, false);
                    });
                }, 120);
            },
            preConfirm: () => ({
                direccion: document.getElementById('swal-prosp-dir')?.value.trim() || p.direccion,
                latitud: document.getElementById('swal-prosp-lat')?.value,
                longitud: document.getElementById('swal-prosp-lng')?.value
            })
        });

        if (!form) return;
        await fetch(`/api/logistica/prospectos/${p.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form)
        });
        await this.cargarProspectos();
    },

    renderConfigNodos() {
        const container = document.getElementById('config-lista-nodos');
        if (!container) return;
        const nodos = this.configRutasDias?.nodos || [];
        if (nodos.length === 0) {
            container.innerHTML = `<div style="font-size:0.78rem; color:#94a3b8;">Cargando nodos...</div>`;
            return;
        }
        container.innerHTML = nodos.map(n => `
            <div class="nodo-card-item">
                <div style="display:flex; align-items:center; gap:0.6rem; min-width:0; flex:1;" onclick="ProspectosMobileController.abrirModalEditarNodo(${n.id})">
                    <div style="font-size:1.45rem; flex-shrink:0;">${n.icono || '📍'}</div>
                    <div style="min-width:0; flex:1; cursor:pointer;">
                        <div style="font-weight:900; font-size:0.88rem; color:#f8fafc;">${n.nombre}</div>
                        <div class="text-truncate" style="font-size:0.74rem; color:#94a3b8;">📍 ${n.direccion || 'Tocá "🗺️ Ubicar en Mapa" para marcar dónde queda'}</div>
                    </div>
                </div>
                <div style="display:flex; gap:0.3rem; flex-shrink:0;">
                    <button type="button" onclick="ProspectosMobileController.abrirModalEditarNodo(${n.id})" style="background:linear-gradient(135deg, #059669 0%, #047857 100%); border:1px solid #10b981; color:#ffffff; border-radius:0.55rem; padding:0.4rem 0.65rem; font-size:0.74rem; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:0.25rem; box-shadow:0 2px 6px rgba(5,150,105,0.3);">
                        🗺️ Ubicar en Mapa
                    </button>
                    <button type="button" onclick="ProspectosMobileController.fijarGpsNodoActual(${n.id})" title="Usar el GPS de donde estoy parado ahora" style="background:rgba(2,132,199,0.2); border:1px solid #38bdf8; color:#7dd3fc; border-radius:0.55rem; padding:0.4rem 0.5rem; font-size:0.72rem; font-weight:800; cursor:pointer;">
                        📡
                    </button>
                </div>
            </div>
        `).join('');
    },

    async fijarGpsNodoActual(nodoId) {
        const nodo = (this.configRutasDias?.nodos || []).find(n => Number(n.id) === Number(nodoId));
        if (!nodo) return;
        if (!navigator.geolocation) {
            Swal.fire({ icon: 'warning', title: 'GPS no disponible', background: '#1e293b', color: '#fff' });
            return;
        }
        Swal.fire({ title: `Tomando GPS para ${nodo.nombre}...`, allowOutsideClick: false, didOpen: () => Swal.showLoading(), background: '#1e293b', color: '#fff' });
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                let dirDetectada = nodo.direccion;
                try {
                    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
                    if (r.ok) {
                        const d = await r.json();
                        const road = d.address?.road || '';
                        const num = d.address?.house_number || '';
                        if (road) dirDetectada = [road, num].filter(Boolean).join(' ');
                    }
                } catch (_) {}

                const res = await fetch('/api/logistica/prospectos/nodos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: nodo.id,
                        nombre: nodo.nombre,
                        icono: nodo.icono,
                        direccion: dirDetectada,
                        localidad: nodo.localidad || 'La Plata',
                        latitud: lat,
                        longitud: lng
                    })
                });
                const json = await res.json();
                if (json.success && json.config) {
                    this.configRutasDias = json.config;
                    this.renderSeccionConfigRutasDias();
                }
                Swal.fire({ icon: 'success', title: `📍 ${nodo.nombre} actualizado`, text: `Coordenadas fijadas en ${dirDetectada || 'tu posición actual'}.`, timer: 1800, showConfirmButton: false, background: '#1e293b', color: '#fff' });
            },
            () => {
                Swal.fire({ icon: 'warning', title: 'No se pudo obtener el GPS', text: 'Podés tocar ✏️ para ingresar la dirección manualmente.', background: '#1e293b', color: '#fff' });
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    },

    async abrirModalEditarNodo(nodoId = null) {
        const nodo = nodoId ? (this.configRutasDias?.nodos || []).find(n => Number(n.id) === Number(nodoId)) : null;
        const initLat = (nodo && nodo.latitud) ? parseFloat(nodo.latitud) : -34.92145;
        const initLng = (nodo && nodo.longitud) ? parseFloat(nodo.longitud) : -57.95453;
        const iconoActual = nodo?.icono || '📍';

        let mapPicker = null;
        let markerPicker = null;

        const actualizarPuntoElegido = async (lat, lng, centrar = false) => {
            const latIn = document.getElementById('swal-nodo-lat');
            const lngIn = document.getElementById('swal-nodo-lng');
            if (latIn) latIn.value = lat.toFixed(6);
            if (lngIn) lngIn.value = lng.toFixed(6);

            if (markerPicker) {
                markerPicker.setLatLng([lat, lng]);
            }
            if (centrar && mapPicker) {
                mapPicker.setView([lat, lng], 16);
            }

            const statusLbl = document.getElementById('swal-nodo-map-status');
            if (statusLbl) statusLbl.innerHTML = '<span style="color:#38bdf8;">⏳ Detectando calle del punto marcado...</span>';

            try {
                const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
                if (r.ok) {
                    const d = await r.json();
                    const road = d.address?.road || d.address?.pedestrian || '';
                    const num = d.address?.house_number || '';
                    const suburb = d.address?.suburb || d.address?.neighbourhood || d.address?.town || d.address?.city || '';
                    const dirArmada = [road, num].filter(Boolean).join(' ');
                    const dirFinal = dirArmada ? (suburb ? `${dirArmada}, ${suburb}` : dirArmada) : (d.display_name ? d.display_name.split(',').slice(0, 2).join(',') : '');
                    const inputDir = document.getElementById('swal-nodo-dir');
                    if (inputDir && dirFinal) {
                        inputDir.value = dirFinal;
                    }
                    if (statusLbl) {
                        statusLbl.innerHTML = `<span style="color:#34d399; font-weight:800;">✅ Punto ubicado en: ${dirFinal || 'Mapa'}</span>`;
                    }
                }
            } catch (_) {
                if (statusLbl) statusLbl.innerHTML = '<span style="color:#34d399;">✅ Punto marcado en el mapa</span>';
            }
        };

        const { value: form } = await Swal.fire({
            title: nodo ? `🗺️ Ubicar ${nodo.icono || ''} ${nodo.nombre}` : '🗺️ Nuevo Punto en el Mapa',
            width: '96vw',
            html: `
                <div style="text-align:left; font-size:0.82rem; color:#cbd5e1; display:flex; flex-direction:column; gap:0.5rem;">
                    
                    <div style="display:grid; grid-template-columns:58px 1fr; gap:0.4rem;">
                        <div>
                            <label style="font-size:0.7rem; font-weight:800; color:#94a3b8;">Ícono</label>
                            <input id="swal-nodo-icono" class="wizard-input-mobile" value="${iconoActual}" style="text-align:center; font-size:1.1rem; padding:0.38rem;">
                        </div>
                        <div>
                            <label style="font-size:0.7rem; font-weight:800; color:#94a3b8;">Nombre del Punto *</label>
                            <input id="swal-nodo-nombre" class="wizard-input-mobile" value="${nodo?.nombre || ''}" placeholder="Ej: Mi Casa / Depósito LAMDA" style="font-weight:800; padding:0.38rem 0.55rem;">
                        </div>
                    </div>

                    <!-- Buscador de calle para ir rápido en el mapa -->
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:0.65rem; padding:0.45rem;">
                        <label style="font-size:0.7rem; font-weight:800; color:#7dd3fc; display:block; margin-bottom:4px;">
                            🔍 Buscar calle o esquina para acercar el mapa:
                        </label>
                        <div style="display:flex; gap:0.35rem;">
                            <input id="swal-nodo-buscar-calle" class="wizard-input-mobile" placeholder="Ej: Calle 64 y 122, La Plata" style="font-size:0.8rem; padding:0.38rem 0.55rem; flex:1;">
                            <button type="button" id="btn-swal-buscar-calle" style="background:#0284c7; color:white; border:none; border-radius:0.5rem; padding:0.38rem 0.65rem; font-size:0.75rem; font-weight:800; cursor:pointer; white-space:nowrap;">
                                🔍 Ir
                            </button>
                            <button type="button" id="btn-swal-mi-gps" title="Ubicar donde estoy parado ahora" style="background:#334155; color:#38bdf8; border:1px solid #38bdf8; border-radius:0.5rem; padding:0.38rem 0.55rem; font-size:0.75rem; font-weight:800; cursor:pointer;">
                                📡
                            </button>
                        </div>
                    </div>

                    <!-- MAPA INTERACTIVO PARA TOCAR O ARRASTRAR EL PIN -->
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-size:0.73rem; font-weight:900; color:#fdba74;">👆 Tocá el mapa donde queda exactamente:</span>
                        </div>
                        <div id="swal-nodo-mapa-canvas" style="width:100%; height:50dvh; min-height:320px; border-radius:0.75rem; border:2px solid #10b981; overflow:hidden; background:#0f172a;"></div>
                        <div id="swal-nodo-map-status" style="font-size:0.72rem; color:#94a3b8; margin-top:4px; text-align:center;">
                            Mové el mapa y tocá sobre la cuadra exacta para clavar el pin.
                        </div>
                    </div>

                    <!-- Dirección resultante (editable por si quiere agregar timbre/referencia) -->
                    <div>
                        <label style="font-size:0.71rem; font-weight:800; color:#cbd5e1;">📍 Dirección / Referencia del Punto:</label>
                        <input id="swal-nodo-dir" class="wizard-input-mobile" value="${nodo?.direccion || ''}" placeholder="Se completa al tocar el mapa o escribila acá..." style="font-size:0.82rem; padding:0.4rem 0.55rem;">
                    </div>

                    <input type="hidden" id="swal-nodo-lat" value="${initLat}">
                    <input type="hidden" id="swal-nodo-lng" value="${initLng}">
                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Ubicación',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#059669',
            didOpen: () => {
                setTimeout(() => {
                    const mapEl = document.getElementById('swal-nodo-mapa-canvas');
                    if (!mapEl || typeof L === 'undefined') return;

                    mapPicker = L.map('swal-nodo-mapa-canvas', {
                        zoomControl: true,
                        attributionControl: false
                    }).setView([initLat, initLng], 15);

                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        maxZoom: 19
                    }).addTo(mapPicker);

                    const pinIcon = L.divIcon({
                        className: 'nodo-picker-pin',
                        html: `<div style="background:#059669; color:#fff; border:3px solid #fff; border-radius:999px; width:38px; height:38px; display:flex; align-items:center; justify-content:center; font-size:20px; box-shadow:0 4px 12px rgba(0,0,0,0.65);">${iconoActual}</div>`,
                        iconSize: [38, 38],
                        iconAnchor: [19, 19]
                    });

                    markerPicker = L.marker([initLat, initLng], {
                        icon: pinIcon,
                        draggable: true
                    }).addTo(mapPicker);

                    // Al tocar cualquier parte del mapa, mover el pin ahí mismo
                    mapPicker.on('click', (e) => {
                        actualizarPuntoElegido(e.latlng.lat, e.latlng.lng, false);
                    });

                    // Al arrastrar el pin con el dedo
                    markerPicker.on('dragend', (e) => {
                        const pos = e.target.getLatLng();
                        actualizarPuntoElegido(pos.lat, pos.lng, false);
                    });

                    // Buscador de calle dentro del modal
                    const ejecutarBusquedaCalle = async () => {
                        const q = document.getElementById('swal-nodo-buscar-calle')?.value.trim();
                        if (!q) return;
                        const statusLbl = document.getElementById('swal-nodo-map-status');
                        if (statusLbl) statusLbl.innerHTML = '<span style="color:#38bdf8;">🔍 Buscando dirección en el mapa...</span>';
                        try {
                            const queryCompleta = q.toLowerCase().includes('plata') || q.toLowerCase().includes('berisso') || q.toLowerCase().includes('ensenada') || q.toLowerCase().includes('gonnet')
                                ? `${q}, Buenos Aires, Argentina`
                                : `${q}, La Plata, Buenos Aires, Argentina`;
                            const resNom = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(queryCompleta)}`);
                            const arrNom = await resNom.json();
                            if (Array.isArray(arrNom) && arrNom.length > 0) {
                                const foundLat = parseFloat(arrNom[0].lat);
                                const foundLng = parseFloat(arrNom[0].lon);
                                actualizarPuntoElegido(foundLat, foundLng, true);
                            } else {
                                if (statusLbl) statusLbl.innerHTML = '<span style="color:#facc15;">⚠️ No encontramos esa calle exacta, mové el mapa con el dedo y tocá el punto.</span>';
                            }
                        } catch (_) {}
                    };

                    document.getElementById('btn-swal-buscar-calle')?.addEventListener('click', ejecutarBusquedaCalle);
                    document.getElementById('swal-nodo-buscar-calle')?.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Enter') {
                            ev.preventDefault();
                            ejecutarBusquedaCalle();
                        }
                    });

                    // Botón Mi GPS dentro del modal
                    document.getElementById('btn-swal-mi-gps')?.addEventListener('click', () => {
                        if (!navigator.geolocation) return;
                        const statusLbl = document.getElementById('swal-nodo-map-status');
                        if (statusLbl) statusLbl.innerHTML = '<span style="color:#38bdf8;">📡 Buscando tu ubicación GPS...</span>';
                        navigator.geolocation.getCurrentPosition(
                            (pos) => actualizarPuntoElegido(pos.coords.latitude, pos.coords.longitude, true),
                            () => {
                                if (statusLbl) statusLbl.innerHTML = '<span style="color:#facc15;">⚠️ Sin señal GPS, tocá el punto directamente en el mapa.</span>';
                            },
                            { enableHighAccuracy: true, timeout: 8000 }
                        );
                    });
                }, 120);
            },
            preConfirm: () => {
                const nombre = document.getElementById('swal-nodo-nombre')?.value.trim();
                if (!nombre) {
                    Swal.showValidationMessage('El nombre del punto es obligatorio.');
                    return false;
                }
                return {
                    id: nodo?.id || null,
                    icono: document.getElementById('swal-nodo-icono')?.value.trim() || '📍',
                    nombre,
                    direccion: document.getElementById('swal-nodo-dir')?.value.trim() || null,
                    latitud: document.getElementById('swal-nodo-lat')?.value.trim() || null,
                    longitud: document.getElementById('swal-nodo-lng')?.value.trim() || null
                };
            }
        });

        if (!form) return;
        const res = await fetch('/api/logistica/prospectos/nodos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form)
        });
        const json = await res.json();
        if (json.success && json.config) {
            this.configRutasDias = json.config;
            this.renderSeccionConfigRutasDias();
            if (this.vistaActual === 'mapa' && this.mapaLeaflet) {
                this.initOrUpdateMapa();
            }
            Swal.fire({
                toast: true,
                position: 'top',
                icon: 'success',
                title: `📍 ${form.nombre} ubicado en el mapa`,
                timer: 2000,
                showConfirmButton: false,
                background: '#0f172a',
                color: '#fff'
            });
        }
    },

    renderConfigRutasZona() {
        const container = document.getElementById('config-lista-rutas-zona');
        if (!container) return;
        const rutas = this.configRutasDias?.rutas_zona || [];
        const crono = this.configRutasDias?.cronograma || [];

        if (rutas.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:1.2rem; color:#94a3b8; font-size:0.8rem; border:1px dashed #334155; border-radius:0.8rem;">
                    Aún no definiste Rutas/Zonas lineales. Tocá <b>"➕ Nueva Ruta/Zona"</b> para crear tu primer recorrido entre Casa y Depósito.
                </div>
            `;
            return;
        }

        container.innerHTML = rutas.map(rz => {
            const turnosAsignados = crono
                .filter(c => Number(c.ruta_zona_id) === Number(rz.id))
                .map(c => this.formatearTokenDiaTurno(`${c.dia_semana}_${c.turno}`));

            const cantContactos = this.prospectos.filter(p => {
                const info = this.obtenerRutasYDiasDeProspecto(p);
                return info.rutasIds.includes(Number(rz.id));
            }).length;

            return `
                <div class="corredor-card-item" style="border-left-color: ${rz.color || '#ea580c'};">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                        <div>
                            <div style="font-weight:900; font-size:0.95rem; color:#f8fafc;">🛣️ ${rz.nombre}</div>
                            <div style="font-size:0.75rem; color:#34d399; font-weight:700; margin-top:2px;">
                                ${rz.nodo_salida_icono || '🏠'} ${rz.nodo_salida_nombre || 'Salida'} ➔ ${rz.nodo_llegada_icono || '🏭'} ${rz.nodo_llegada_nombre || 'Llegada'}
                            </div>
                        </div>
                        <span style="background:rgba(255,255,255,0.07); color:#f8fafc; font-size:0.7rem; font-weight:800; padding:2px 8px; border-radius:999px;">
                            ${cantContactos} ${cantContactos === 1 ? 'contacto' : 'contactos'}
                        </span>
                    </div>

                    ${rz.calles_involucradas ? `
                        <div style="margin-top:0.4rem; font-size:0.76rem; color:#cbd5e1; background:rgba(255,255,255,0.04); padding:0.35rem 0.55rem; border-radius:0.5rem;">
                            📍 <b>Calles / Trayecto:</b> ${rz.calles_involucradas}
                        </div>
                    ` : ''}

                    <div style="margin-top:0.45rem; display:flex; gap:0.3rem; flex-wrap:wrap; align-items:center;">
                        ${turnosAsignados.length > 0
                            ? turnosAsignados.map(t => `<span style="font-size:0.68rem; font-weight:800; background:rgba(250,204,21,0.16); color:#fde047; border:1px solid rgba(250,204,21,0.35); padding:2px 7px; border-radius:6px;">🗓️ ${t}</span>`).join('')
                            : `<span style="font-size:0.7rem; color:#94a3b8;">Sin días asignados aún</span>`}
                    </div>

                    <div style="margin-top:0.6rem; display:flex; gap:0.35rem;">
                        <button type="button" onclick="ProspectosMobileController.verContactosDeRutaZona(${rz.id})" style="flex:1; background:rgba(2,132,199,0.2); border:1px solid #38bdf8; color:#7dd3fc; border-radius:0.5rem; padding:0.38rem; font-size:0.74rem; font-weight:800; cursor:pointer;">
                            👁️ Ver Contactos (${cantContactos})
                        </button>
                        <button type="button" onclick="ProspectosMobileController.abrirModalEditarRutaZona(${rz.id})" style="background:linear-gradient(135deg, #ea580c 0%, #c2410c 100%); border:1px solid #fb923c; color:#ffffff; border-radius:0.5rem; padding:0.38rem 0.65rem; font-size:0.74rem; font-weight:800; cursor:pointer;">
                            🗺️ Editar en Mapa
                        </button>
                        <button type="button" onclick="ProspectosMobileController.eliminarRutaZonaConfirm(${rz.id})" style="background:rgba(239,68,68,0.16); border:1px solid rgba(239,68,68,0.35); color:#fca5a5; border-radius:0.5rem; padding:0.38rem 0.55rem; font-size:0.74rem; font-weight:800; cursor:pointer;">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    verContactosDeRutaZona(rutaZonaId) {
        this.filtroRutaZonaId = String(rutaZonaId);
        this.filtroDiaTurno = '';
        this.renderSelectFiltroRutasZona();
        const selDia = document.getElementById('select-filtro-dia-turno');
        const selMapDia = document.getElementById('mapa-select-turno');
        if (selDia) selDia.value = '';
        if (selMapDia) selMapDia.value = '';
        this.abrirSeccionDetectados('MAPA');
    },

    // =========================================================
    // EDITOR DE RUTA LINEAL Y SUPERFICIE DEFORMABLE (PANTALLA COMPLETA 100%)
    // =========================================================
    editorRutaMap: null,
    editorRutaLayers: null,
    editorRutaState: {
        id: null,
        modo: 'CAMINO', // 'CAMINO' | 'BORDES'
        anchoMetros: 350,
        waypoints: [],   // [{lat, lng}, ...]
        poligono: [],    // [{lat, lng}, ...]
        deformadoManual: false
    },

    abrirModalEditarRutaZona(rutaId = null) {
        const rz = rutaId ? (this.configRutasDias?.rutas_zona || []).find(x => Number(x.id) === Number(rutaId)) : null;
        const nodos = this.configRutasDias?.nodos || [];
        const crono = this.configRutasDias?.cronograma || [];

        const salidaDefault = rz?.nodo_salida_id || nodos[0]?.id || '';
        const llegadaDefault = rz?.nodo_llegada_id || nodos[1]?.id || nodos[0]?.id || '';

        const selSalida = document.getElementById('editor-ruta-salida');
        const selLlegada = document.getElementById('editor-ruta-llegada');
        if (selSalida) {
            selSalida.innerHTML = nodos.map(n => `<option value="${n.id}" ${Number(n.id) === Number(salidaDefault) ? 'selected' : ''}>${n.icono || '🏠'} ${n.nombre}</option>`).join('');
        }
        if (selLlegada) {
            selLlegada.innerHTML = nodos.map(n => `<option value="${n.id}" ${Number(n.id) === Number(llegadaDefault) ? 'selected' : ''}>${n.icono || '🏭'} ${n.nombre}</option>`).join('');
        }

        const inNombre = document.getElementById('editor-ruta-nombre');
        if (inNombre) inNombre.value = rz?.nombre || '';

        const inCalles = document.getElementById('editor-ruta-calles');
        if (inCalles) inCalles.value = rz?.calles_involucradas || '';

        const selColor = document.getElementById('editor-ruta-color');
        if (selColor) selColor.value = rz?.color || '#ea580c';

        // Grilla de Lunes a Domingo (Mañana y Tarde) dentro del drawer
        const tokensActivos = new Set(
            crono.filter(c => rz && Number(c.ruta_zona_id) === Number(rz.id)).map(c => `${c.dia_semana}_${c.turno}`)
        );
        const grillaDiasEl = document.getElementById('editor-ruta-grilla-dias');
        if (grillaDiasEl) {
            let grillaChecksHtml = '';
            for (let d = 1; d <= 7; d++) {
                const mTok = `${d}_MANANA`;
                const tTok = `${d}_TARDE`;
                grillaChecksHtml += `
                    <div style="display:flex; align-items:center; justify-content:space-between; padding:4px 8px; border-bottom:1px solid #334155; font-size:0.75rem;">
                        <b style="width:76px; color:#f8fafc;">${this.DIAS_NOMBRES[d]}</b>
                        <label style="display:flex; align-items:center; gap:4px; cursor:pointer; color:#fde047;">
                            <input type="checkbox" class="chk-editor-rz-diaturno" value="${mTok}" ${tokensActivos.has(mTok) ? 'checked' : ''} style="accent-color:#ea580c; width:16px; height:16px;">
                            <span>🌅 Mañana</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:4px; cursor:pointer; color:#7dd3fc;">
                            <input type="checkbox" class="chk-editor-rz-diaturno" value="${tTok}" ${tokensActivos.has(tTok) ? 'checked' : ''} style="accent-color:#0284c7; width:16px; height:16px;">
                            <span>🌇 Tarde</span>
                        </label>
                    </div>
                `;
            }
            grillaDiasEl.innerHTML = grillaChecksHtml;
        }

        // Inicializar estado geométrico
        const waypointsInit = Array.isArray(rz?.waypoints_json)
            ? rz.waypoints_json.filter(w => w && w.lat && w.lng).map(w => ({ lat: parseFloat(w.lat), lng: parseFloat(w.lng) }))
            : [];
        const poligonoInit = Array.isArray(rz?.poligono_json)
            ? rz.poligono_json.filter(v => v && v.lat && v.lng).map(v => ({ lat: parseFloat(v.lat), lng: parseFloat(v.lng) }))
            : [];
        const anchoInit = Number(rz?.ancho_metros) || 350;

        this.editorRutaState = {
            id: rz?.id || null,
            modo: 'CAMINO',
            anchoMetros: anchoInit,
            waypoints: waypointsInit,
            poligono: poligonoInit,
            deformadoManual: poligonoInit.length >= 3
        };

        // Actualizar pills de ancho
        document.querySelectorAll('.ancho-pill-btn').forEach(btn => {
            btn.classList.toggle('active', Number(btn.dataset.ancho) === anchoInit);
        });

        // Mostrar modal fullscreen (100vw x 100dvh)
        const modalEl = document.getElementById('modal-fullscreen-ruta-editor');
        if (modalEl) modalEl.style.display = 'flex';
        const drawerEl = document.getElementById('drawer-config-datos-ruta');
        if (drawerEl) drawerEl.style.display = rz ? 'none' : 'block';

        this.cambiarModoEditorRuta('CAMINO', false);

        setTimeout(() => {
            if (!this.editorRutaMap) {
                this.editorRutaMap = L.map('mapa-editor-ruta-fullscreen', {
                    zoomControl: true,
                    attributionControl: false
                }).setView([-34.90, -57.95], 13);

                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19
                }).addTo(this.editorRutaMap);

                this.editorRutaLayers = L.layerGroup().addTo(this.editorRutaMap);

                // Al tocar el mapa en modo CAMINO: insertar waypoint en el tramo más cercano
                this.editorRutaMap.on('click', (e) => {
                    if (this.editorRutaState.modo === 'CAMINO') {
                        this.insertarWaypointEnCamino(e.latlng.lat, e.latlng.lng);
                    }
                });
            } else {
                this.editorRutaMap.invalidateSize();
            }

            if (this.editorRutaState.poligono.length < 3) {
                this.regenerarFranjaAutomaticaEditor(false);
            } else {
                this.renderizarCapasEditorRuta(true);
            }
        }, 120);
    },

    cerrarEditorRutaFullscreen() {
        const modalEl = document.getElementById('modal-fullscreen-ruta-editor');
        if (modalEl) modalEl.style.display = 'none';
    },

    toggleDrawerConfigRuta() {
        const drawerEl = document.getElementById('drawer-config-datos-ruta');
        if (!drawerEl) return;
        const visible = drawerEl.style.display !== 'none';
        drawerEl.style.display = visible ? 'none' : 'block';
        setTimeout(() => {
            if (this.editorRutaMap) this.editorRutaMap.invalidateSize();
        }, 80);
    },

    obtenerPuntosCaminoCompletoEditor() {
        const nodos = this.configRutasDias?.nodos || [];
        const salidaId = document.getElementById('editor-ruta-salida')?.value;
        const llegadaId = document.getElementById('editor-ruta-llegada')?.value;
        const nSalida = nodos.find(n => Number(n.id) === Number(salidaId)) || nodos[0];
        const nLlegada = nodos.find(n => Number(n.id) === Number(llegadaId)) || nodos[1] || nodos[0];

        const puntos = [];
        if (nSalida && nSalida.latitud && nSalida.longitud) {
            puntos.push({ lat: parseFloat(nSalida.latitud), lng: parseFloat(nSalida.longitud), esCabecera: true, nodo: nSalida });
        }
        (this.editorRutaState.waypoints || []).forEach(wp => {
            puntos.push({ lat: parseFloat(wp.lat), lng: parseFloat(wp.lng), esCabecera: false });
        });
        if (nLlegada && nLlegada.latitud && nLlegada.longitud) {
            puntos.push({ lat: parseFloat(nLlegada.latitud), lng: parseFloat(nLlegada.longitud), esCabecera: true, nodo: nLlegada });
        }
        return puntos;
    },

    onCambioNodosCabeceraEditor() {
        this.regenerarFranjaAutomaticaEditor(true);
    },

    cambiarModoEditorRuta(nuevoModo, reRender = true) {
        this.editorRutaState.modo = nuevoModo;
        const btnCamino = document.getElementById('btn-modo-editor-camino');
        const btnBordes = document.getElementById('btn-modo-editor-bordes');
        const ctrlCamino = document.getElementById('controles-modo-camino');
        const ctrlBordes = document.getElementById('controles-modo-bordes');
        const hintEl = document.getElementById('editor-ruta-floating-hint');

        if (nuevoModo === 'CAMINO') {
            btnCamino?.classList.add('active-camino');
            btnBordes?.classList.remove('active-bordes');
            if (ctrlCamino) ctrlCamino.style.display = 'flex';
            if (ctrlBordes) ctrlBordes.style.display = 'none';
            if (hintEl) {
                hintEl.style.borderColor = 'rgba(56, 189, 248, 0.5)';
                hintEl.innerHTML = '🛣️ <b>Modo 1 (Camino):</b> Tocá el mapa por donde doblás. La superficie se arma sola.';
            }
        } else {
            btnCamino?.classList.remove('active-camino');
            btnBordes?.classList.add('active-bordes');
            if (ctrlCamino) ctrlCamino.style.display = 'none';
            if (ctrlBordes) ctrlBordes.style.display = 'flex';
            if (hintEl) {
                hintEl.style.borderColor = 'rgba(249, 115, 22, 0.65)';
                hintEl.innerHTML = '✋ <b>Modo 2 (Deformar):</b> Arrastrá los puntos 🟠 para ensanchar o angostar cualquier parte.';
            }
            if (this.editorRutaState.poligono.length < 3) {
                this.regenerarFranjaAutomaticaEditor(false);
            }
        }

        if (reRender) {
            this.renderizarCapasEditorRuta(false);
        }
    },

    seleccionarAnchoBufferEditor(anchoMetros) {
        this.editorRutaState.anchoMetros = Number(anchoMetros) || 350;
        document.querySelectorAll('.ancho-pill-btn').forEach(btn => {
            btn.classList.toggle('active', Number(btn.dataset.ancho) === this.editorRutaState.anchoMetros);
        });
        this.regenerarFranjaAutomaticaEditor(false);
    },

    insertarWaypointEnCamino(lat, lng) {
        const pts = this.obtenerPuntosCaminoCompletoEditor();
        if (pts.length < 2) {
            this.editorRutaState.waypoints.push({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
        } else {
            // Insertar el nuevo punto en el segmento más cercano para que sea intuitivo tocar cualquier parte del camino
            let mejorIndice = this.editorRutaState.waypoints.length;
            let menorDist = Infinity;

            for (let i = 0; i < pts.length - 1; i++) {
                const d = this.distanciaPuntoASegmento(
                    lat, lng,
                    pts[i].lat, pts[i].lng,
                    pts[i + 1].lat, pts[i + 1].lng
                );
                if (d < menorDist) {
                    menorDist = d;
                    mejorIndice = i;
                }
            }
            this.editorRutaState.waypoints.splice(mejorIndice, 0, {
                lat: Number(lat.toFixed(6)),
                lng: Number(lng.toFixed(6))
            });
        }
        this.regenerarFranjaAutomaticaEditor(false);
    },

    distanciaPuntoASegmento(py, px, ay, ax, by, bx) {
        const dx = bx - ax;
        const dy = by - ay;
        if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    },

    deshacerUltimoWaypointEditor() {
        if (this.editorRutaState.waypoints.length > 0) {
            this.editorRutaState.waypoints.pop();
            this.regenerarFranjaAutomaticaEditor(false);
        }
    },

    regenerarFranjaAutomaticaEditor(ajustarZoom = false) {
        const puntosCamino = this.obtenerPuntosCaminoCompletoEditor();
        this.editorRutaState.poligono = this.generarPoligonoBufferDeCamino(
            puntosCamino,
            this.editorRutaState.anchoMetros
        );
        this.editorRutaState.deformadoManual = false;
        this.renderizarCapasEditorRuta(ajustarZoom);
    },

    renderizarCapasEditorRuta(ajustarZoom = false) {
        if (!this.editorRutaMap || !this.editorRutaLayers) return;
        this.editorRutaLayers.clearLayers();

        const colorRuta = document.getElementById('editor-ruta-color')?.value || '#ea580c';
        const puntosCamino = this.obtenerPuntosCaminoCompletoEditor();
        const poligono = this.editorRutaState.poligono || [];
        const bounds = [];

        // 1. Dibujar el Polígono de Superficie Alargada
        let surfacePolygonLayer = null;
        if (poligono.length >= 3) {
            const latlngsPoly = poligono.map(v => {
                bounds.push([v.lat, v.lng]);
                return [v.lat, v.lng];
            });
            surfacePolygonLayer = L.polygon(latlngsPoly, {
                color: colorRuta,
                weight: this.editorRutaState.modo === 'BORDES' ? 3 : 2,
                opacity: 0.9,
                fillColor: colorRuta,
                fillOpacity: 0.22
            });
            this.editorRutaLayers.addLayer(surfacePolygonLayer);
        }

        // 2. Dibujar la Línea Central de la Ruta (Salida -> Esquinas -> Llegada)
        if (puntosCamino.length >= 2) {
            const latlngsLine = puntosCamino.map(p => {
                bounds.push([p.lat, p.lng]);
                return [p.lat, p.lng];
            });
            const lineLayer = L.polyline(latlngsLine, {
                color: '#38bdf8',
                weight: 4,
                opacity: 0.85,
                dashArray: '8, 8'
            });
            this.editorRutaLayers.addLayer(lineLayer);
        }

        // 3. Dibujar los Contactos en el mapa (Resaltando en VERDE BRILLANTE los que quedan adentro de la superficie)
        let cantAdentro = 0;
        this.prospectos.forEach(p => {
            if (!p.latitud || !p.longitud) return;
            const lat = parseFloat(p.latitud);
            const lng = parseFloat(p.longitud);
            const estaAdentro = this.estaPuntoDentroDePoligono(lat, lng, poligono);
            if (estaAdentro) cantAdentro++;

            const iconHtml = estaAdentro
                ? `<div style="background:#10b981; color:#fff; width:26px; height:26px; border-radius:999px; border:2px solid #fff; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; box-shadow:0 0 10px rgba(16,185,129,0.9);">✓</div>`
                : `<div style="background:#334155; color:#94a3b8; width:20px; height:20px; border-radius:999px; border:1.5px solid #64748b; display:flex; align-items:center; justify-content:center; font-size:10px; opacity:0.8;">•</div>`;

            const mProsp = L.marker([lat, lng], {
                icon: L.divIcon({
                    className: 'editor-prosp-pin',
                    html: iconHtml,
                    iconSize: estaAdentro ? [26, 26] : [20, 20],
                    iconAnchor: estaAdentro ? [13, 13] : [10, 10]
                })
            });
            mProsp.bindPopup(`
                <div style="font-size:0.78rem; color:#f8fafc;">
                    <b>${p.nombre_fantasia}</b><br>
                    <span style="color:#94a3b8;">${p.direccion || ''}</span><br>
                    <b style="color:${estaAdentro ? '#34d399' : '#facc15'};">
                        ${estaAdentro ? '✅ Adentro de esta Ruta/Superficie' : '⚪ Afuera de la superficie (estirá el borde 🟠 si querés incluirlo)'}
                    </b>
                </div>
            `);
            this.editorRutaLayers.addLayer(mProsp);
        });

        const badgeAdentro = document.getElementById('editor-ruta-badge-adentro');
        if (badgeAdentro) {
            badgeAdentro.innerText = `🎯 ${cantAdentro} adentro`;
        }

        // 4. Dibujar Nodos de Cabecera (Salida y Llegada)
        puntosCamino.filter(p => p.esCabecera && p.nodo).forEach(p => {
            const n = p.nodo;
            const nIcon = L.divIcon({
                className: 'editor-nodo-cabecera',
                html: `<div style="background:#0f172a; color:#fff; border:2px solid #10b981; border-radius:999px; width:34px; height:34px; display:flex; align-items:center; justify-content:center; font-size:18px; box-shadow:0 4px 10px rgba(0,0,0,0.65);">${n.icono || '🏠'}</div>`,
                iconSize: [34, 34],
                iconAnchor: [17, 17]
            });
            this.editorRutaLayers.addLayer(L.marker([p.lat, p.lng], { icon: nIcon }));
        });

        // 5. Segun el Modo Activo:
        //    - Modo CAMINO: Mostrar esquinas (waypoints) azules arrastrables
        //    - Modo BORDES: Mostrar manijas naranjas (🟠) en cada vértice del polígono + manijas intermedias (➕) para deformar
        if (this.editorRutaState.modo === 'CAMINO') {
            this.editorRutaState.waypoints.forEach((wp, idx) => {
                const wpIcon = L.divIcon({
                    className: 'editor-wp-handle',
                    html: `<div style="background:#0284c7; color:#fff; border:2px solid #fff; border-radius:999px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; box-shadow:0 3px 8px rgba(0,0,0,0.5);">${idx + 1}</div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });
                const mWp = L.marker([wp.lat, wp.lng], { icon: wpIcon, draggable: true });
                mWp.on('dragend', (ev) => {
                    const pos = ev.target.getLatLng();
                    this.editorRutaState.waypoints[idx] = {
                        lat: Number(pos.lat.toFixed(6)),
                        lng: Number(pos.lng.toFixed(6))
                    };
                    this.regenerarFranjaAutomaticaEditor(false);
                });
                mWp.on('click', (ev) => {
                    L.DomEvent.stopPropagation(ev);
                    this.editorRutaState.waypoints.splice(idx, 1);
                    this.regenerarFranjaAutomaticaEditor(false);
                });
                this.editorRutaLayers.addLayer(mWp);
            });
        } else if (this.editorRutaState.modo === 'BORDES' && poligono.length >= 3) {
            // Vértices principales (🟠 arrastrables para ensanchar o angostar)
            poligono.forEach((vert, vIdx) => {
                const vIcon = L.divIcon({
                    className: 'editor-poly-vertex',
                    html: `<div style="background:#ea580c; border:2.5px solid #ffffff; border-radius:999px; width:22px; height:22px; box-shadow:0 2px 8px rgba(0,0,0,0.65);"></div>`,
                    iconSize: [22, 22],
                    iconAnchor: [11, 11]
                });
                const mVert = L.marker([vert.lat, vert.lng], { icon: vIcon, draggable: true });

                mVert.on('drag', (ev) => {
                    const pos = ev.target.getLatLng();
                    this.editorRutaState.poligono[vIdx] = {
                        lat: Number(pos.lat.toFixed(6)),
                        lng: Number(pos.lng.toFixed(6))
                    };
                    if (surfacePolygonLayer) {
                        surfacePolygonLayer.setLatLngs(this.editorRutaState.poligono.map(v => [v.lat, v.lng]));
                    }
                });

                mVert.on('dragend', (ev) => {
                    const pos = ev.target.getLatLng();
                    this.editorRutaState.poligono[vIdx] = {
                        lat: Number(pos.lat.toFixed(6)),
                        lng: Number(pos.lng.toFixed(6))
                    };
                    this.editorRutaState.deformadoManual = true;
                    this.renderizarCapasEditorRuta(false);
                });

                // Si toca un vértice naranja y hay suficientes puntos, permite quitarlo para simplificar el borde
                mVert.on('click', (ev) => {
                    L.DomEvent.stopPropagation(ev);
                    if (this.editorRutaState.poligono.length > 4) {
                        this.editorRutaState.poligono.splice(vIdx, 1);
                        this.editorRutaState.deformadoManual = true;
                        this.renderizarCapasEditorRuta(false);
                    }
                });

                this.editorRutaLayers.addLayer(mVert);

                // Punto medio (+) entre este vértice y el siguiente para agregar un nuevo quiebre en el borde al arrastrarlo
                const sigIdx = (vIdx + 1) % poligono.length;
                const sigVert = poligono[sigIdx];
                const midLat = Number(((vert.lat + sigVert.lat) / 2).toFixed(6));
                const midLng = Number(((vert.lng + sigVert.lng) / 2).toFixed(6));

                const midIcon = L.divIcon({
                    className: 'editor-poly-midpoint',
                    html: `<div style="background:rgba(15,23,42,0.85); color:#fdba74; border:1.5px dashed #fb923c; border-radius:999px; width:18px; height:18px; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900;">+</div>`,
                    iconSize: [18, 18],
                    iconAnchor: [9, 9]
                });
                const mMid = L.marker([midLat, midLng], { icon: midIcon, draggable: true });
                mMid.on('dragend', (ev) => {
                    const pos = ev.target.getLatLng();
                    this.editorRutaState.poligono.splice(vIdx + 1, 0, {
                        lat: Number(pos.lat.toFixed(6)),
                        lng: Number(pos.lng.toFixed(6))
                    });
                    this.editorRutaState.deformadoManual = true;
                    this.renderizarCapasEditorRuta(false);
                });
                mMid.on('click', (ev) => {
                    L.DomEvent.stopPropagation(ev);
                    this.editorRutaState.poligono.splice(vIdx + 1, 0, { lat: midLat, lng: midLng });
                    this.editorRutaState.deformadoManual = true;
                    this.renderizarCapasEditorRuta(false);
                });
                this.editorRutaLayers.addLayer(mMid);
            });
        }

        if (ajustarZoom && bounds.length > 0) {
            this.editorRutaMap.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
        }
    },

    async guardarRutaZonaDesdeEditor() {
        const nombre = document.getElementById('editor-ruta-nombre')?.value.trim();
        if (!nombre) {
            Swal.fire({
                icon: 'warning',
                title: 'Falta el nombre de la Ruta / Zona',
                text: 'Escribí un nombre arriba de todo (ej: Corredor Av. 31 o Ruta Norte).',
                background: '#1e293b',
                color: '#fff'
            });
            document.getElementById('editor-ruta-nombre')?.focus();
            return;
        }

        const poligono = this.editorRutaState.poligono || [];
        const idsContactosAdentro = this.prospectos
            .filter(p => p.latitud && p.longitud && this.estaPuntoDentroDePoligono(p.latitud, p.longitud, poligono))
            .map(p => Number(p.id));

        const dias_turnos = Array.from(document.querySelectorAll('.chk-editor-rz-diaturno:checked')).map(el => el.value);

        const payload = {
            id: this.editorRutaState.id || null,
            nombre,
            color: document.getElementById('editor-ruta-color')?.value || '#ea580c',
            nodo_salida_id: document.getElementById('editor-ruta-salida')?.value || null,
            nodo_llegada_id: document.getElementById('editor-ruta-llegada')?.value || null,
            calles_involucradas: document.getElementById('editor-ruta-calles')?.value.trim() || null,
            ancho_metros: this.editorRutaState.anchoMetros || 350,
            waypoints_json: this.editorRutaState.waypoints || [],
            poligono_json: poligono,
            dias_turnos,
            ids_contactos_adentro: idsContactosAdentro
        };

        try {
            const res = await fetch('/api/logistica/prospectos/rutas-zona', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Error guardando la Ruta/Zona');

            if (json.config) {
                this.configRutasDias = json.config;
            }
            this.cerrarEditorRutaFullscreen();
            await this.cargarProspectos();
            this.renderSelectFiltroRutasZona();
            this.renderSeccionConfigRutasDias();
            this.actualizarHubPrincipal();

            Swal.fire({
                toast: true,
                position: 'top',
                icon: 'success',
                title: `🛣️ "${nombre}" guardada (${idsContactosAdentro.length} contactos adentro)`,
                timer: 2600,
                showConfirmButton: false,
                background: '#0f172a',
                color: '#fff'
            });
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.message, background: '#1e293b', color: '#fff' });
        }
    },

    async eliminarRutaZonaConfirm(id) {
        const rz = (this.configRutasDias?.rutas_zona || []).find(x => Number(x.id) === Number(id));
        if (!rz) return;
        const conf = await Swal.fire({
            icon: 'warning',
            title: `¿Eliminar "${rz.nombre}"?`,
            text: 'Se quitará del cronograma semanal (los contactos no se borran).',
            showCancelButton: true,
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#ef4444',
            background: '#1e293b',
            color: '#fff'
        });
        if (!conf.isConfirmed) return;
        const res = await fetch(`/api/logistica/prospectos/rutas-zona/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.success && json.config) {
            this.configRutasDias = json.config;
            this.renderSelectFiltroRutasZona();
            this.renderSeccionConfigRutasDias();
        }
    },

    renderConfigCronograma7Dias() {
        const container = document.getElementById('config-grilla-7-dias');
        if (!container) return;
        const crono = this.configRutasDias?.cronograma || [];

        let html = '';
        for (let dia = 1; dia <= 7; dia++) {
            const rutasManana = crono.filter(c => Number(c.dia_semana) === dia && c.turno === 'MANANA');
            const rutasTarde = crono.filter(c => Number(c.dia_semana) === dia && c.turno === 'TARDE');

            const tokenM = `${dia}_MANANA`;
            const tokenT = `${dia}_TARDE`;

            const cantM = this.prospectos.filter(p => this.obtenerRutasYDiasDeProspecto(p).diasTurnosTokens.includes(tokenM)).length;
            const cantT = this.prospectos.filter(p => this.obtenerRutasYDiasDeProspecto(p).diasTurnosTokens.includes(tokenT)).length;

            html += `
                <div class="dia-cronograma-card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                        <span style="font-weight:900; font-size:0.92rem; color:#f8fafc;">📅 ${this.DIAS_NOMBRES[dia]}</span>
                        <span style="font-size:0.7rem; color:#94a3b8;">Mañana y Tarde</span>
                    </div>

                    <!-- Subdivisión MAÑANA -->
                    <div class="turno-row">
                        <div style="min-width:0; flex:1;">
                            <div style="font-size:0.75rem; font-weight:800; color:#fde047; margin-bottom:3px;">🌅 Mañana</div>
                            <div style="display:flex; gap:0.3rem; flex-wrap:wrap;">
                                ${rutasManana.length > 0
                                    ? rutasManana.map(r => `<span style="font-size:0.72rem; font-weight:800; background:rgba(234,88,12,0.18); color:#fdba74; border:1px solid rgba(249,115,22,0.4); padding:2px 7px; border-radius:6px;">🛣️ ${r.ruta_zona_nombre}</span>`).join('')
                                    : `<span style="font-size:0.72rem; color:#64748b;">Sin ruta asignada</span>`}
                            </div>
                        </div>
                        <div style="display:flex; gap:0.3rem; align-items:center; flex-shrink:0;">
                            ${cantM > 0 ? `
                                <button type="button" onclick="ProspectosMobileController.verContactosDeDiaTurno('${tokenM}')" style="background:rgba(16,185,129,0.2); border:1px solid #10b981; color:#6ee7b7; border-radius:0.45rem; padding:0.3rem 0.5rem; font-size:0.7rem; font-weight:800; cursor:pointer;">
                                    👁️ ${cantM}
                                </button>
                            ` : ''}
                            <button type="button" onclick="ProspectosMobileController.abrirModalAsignarRutasADiaTurno(${dia}, 'MANANA')" style="background:#334155; border:1px solid #475569; color:#f8fafc; border-radius:0.45rem; padding:0.3rem 0.55rem; font-size:0.71rem; font-weight:800; cursor:pointer;">
                                ＋ Ruta
                            </button>
                        </div>
                    </div>

                    <!-- Subdivisión TARDE -->
                    <div class="turno-row">
                        <div style="min-width:0; flex:1;">
                            <div style="font-size:0.75rem; font-weight:800; color:#7dd3fc; margin-bottom:3px;">🌇 Tarde</div>
                            <div style="display:flex; gap:0.3rem; flex-wrap:wrap;">
                                ${rutasTarde.length > 0
                                    ? rutasTarde.map(r => `<span style="font-size:0.72rem; font-weight:800; background:rgba(2,132,199,0.2); color:#7dd3fc; border:1px solid rgba(56,189,248,0.4); padding:2px 7px; border-radius:6px;">🛣️ ${r.ruta_zona_nombre}</span>`).join('')
                                    : `<span style="font-size:0.72rem; color:#64748b;">Sin ruta asignada</span>`}
                            </div>
                        </div>
                        <div style="display:flex; gap:0.3rem; align-items:center; flex-shrink:0;">
                            ${cantT > 0 ? `
                                <button type="button" onclick="ProspectosMobileController.verContactosDeDiaTurno('${tokenT}')" style="background:rgba(16,185,129,0.2); border:1px solid #10b981; color:#6ee7b7; border-radius:0.45rem; padding:0.3rem 0.5rem; font-size:0.7rem; font-weight:800; cursor:pointer;">
                                    👁️ ${cantT}
                                </button>
                            ` : ''}
                            <button type="button" onclick="ProspectosMobileController.abrirModalAsignarRutasADiaTurno(${dia}, 'TARDE')" style="background:#334155; border:1px solid #475569; color:#f8fafc; border-radius:0.45rem; padding:0.3rem 0.55rem; font-size:0.71rem; font-weight:800; cursor:pointer;">
                                ＋ Ruta
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    },

    verContactosDeDiaTurno(tokenDiaTurno) {
        this.filtroDiaTurno = tokenDiaTurno;
        this.filtroRutaZonaId = '';
        this.renderSelectFiltroRutasZona();
        const selDia = document.getElementById('select-filtro-dia-turno');
        const selMapDia = document.getElementById('mapa-select-turno');
        if (selDia) selDia.value = tokenDiaTurno;
        if (selMapDia) selMapDia.value = tokenDiaTurno;
        this.abrirSeccionDetectados('MAPA');
    },

    async abrirModalAsignarRutasADiaTurno(dia, turno) {
        const rutas = this.configRutasDias?.rutas_zona || [];
        if (rutas.length === 0) {
            this.abrirModalEditarRutaZona(null);
            return;
        }
        const crono = this.configRutasDias?.cronograma || [];
        const activasIds = new Set(
            crono.filter(c => Number(c.dia_semana) === Number(dia) && c.turno === turno).map(c => Number(c.ruta_zona_id))
        );

        const checksHtml = rutas.map(rz => `
            <label style="display:flex; align-items:flex-start; gap:0.55rem; padding:0.6rem; border-bottom:1px solid #334155; cursor:pointer; text-align:left;">
                <input type="checkbox" class="chk-crono-rz" value="${rz.id}" ${activasIds.has(Number(rz.id)) ? 'checked' : ''} style="margin-top:3px; width:18px; height:18px; accent-color:#ea580c;">
                <div>
                    <div style="font-weight:800; color:#f8fafc; font-size:0.86rem;">🛣️ ${rz.nombre}</div>
                    <div style="font-size:0.73rem; color:#94a3b8;">${rz.calles_involucradas || 'Trayecto Casa ↔ Depósito'}</div>
                </div>
            </label>
        `).join('');

        const { value: idsElegidos } = await Swal.fire({
            title: `🗓️ ${this.DIAS_NOMBRES[dia]} • ${turno === 'TARDE' ? '🌇 Tarde' : '🌅 Mañana'}`,
            html: `
                <div style="text-align:left; font-size:0.82rem; color:#cbd5e1;">
                    <p style="margin:0 0 0.5rem; color:#94a3b8;">Tildá qué Ruta(s) / Zona(s) lineales realizás en este turno:</p>
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:0.65rem; max-height:240px; overflow-y:auto;">
                        ${checksHtml}
                    </div>
                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Turno',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#059669',
            preConfirm: () => Array.from(document.querySelectorAll('.chk-crono-rz:checked')).map(el => Number(el.value))
        });

        if (!idsElegidos) return;
        const res = await fetch('/api/logistica/prospectos/cronograma', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dia_semana: dia,
                turno,
                ruta_zona_ids: idsElegidos
            })
        });
        const json = await res.json();
        if (json.success && json.data) {
            this.configRutasDias = json.data;
            this.renderSeccionConfigRutasDias();
            this.actualizarHubPrincipal();
        }
    },

    /**
     * Modal rápido para vincular un contacto existente a una o más Rutas/Zonas y/o Días-Turnos
     */
    async abrirModalVincularRutaDia(prospectoId) {
        const p = this.prospectos.find(x => Number(x.id) === Number(prospectoId));
        if (!p) return;

        const rutas = this.configRutasDias?.rutas_zona || [];
        const crono = this.configRutasDias?.cronograma || [];
        const infoActual = this.obtenerRutasYDiasDeProspecto(p);
        const rIdsActivos = new Set(infoActual.rutasIds);

        let puntualesActivos = new Set();
        if (Array.isArray(p.dias_turnos_puntuales)) {
            p.dias_turnos_puntuales.forEach(t => puntualesActivos.add(String(t)));
        }

        const rutasHtml = rutas.map(rz => {
            const diasDeEstaRuta = crono
                .filter(c => Number(c.ruta_zona_id) === Number(rz.id))
                .map(c => this.formatearTokenDiaTurno(`${c.dia_semana}_${c.turno}`))
                .join(', ');
            return `
                <label style="display:flex; align-items:flex-start; gap:0.55rem; padding:0.55rem; border-bottom:1px solid #334155; cursor:pointer;">
                    <input type="checkbox" class="chk-vinc-rz" value="${rz.id}" ${rIdsActivos.has(Number(rz.id)) ? 'checked' : ''} style="margin-top:3px; width:18px; height:18px; accent-color:#10b981;">
                    <div style="flex:1;">
                        <div style="font-weight:800; color:#f8fafc; font-size:0.84rem;">🛣️ ${rz.nombre}</div>
                        <div style="font-size:0.71rem; color:#94a3b8;">${rz.calles_involucradas || ''}</div>
                        ${diasDeEstaRuta ? `<div style="font-size:0.7rem; color:#fde047; font-weight:700;">🗓️ Días de esta ruta: ${diasDeEstaRuta}</div>` : ''}
                    </div>
                </label>
            `;
        }).join('');

        let diasPuntualesHtml = '';
        for (let d = 1; d <= 6; d++) {
            const mTok = `${d}_MANANA`;
            const tTok = `${d}_TARDE`;
            diasPuntualesHtml += `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:3px 6px; border-bottom:1px solid #334155; font-size:0.74rem;">
                    <b style="width:70px; color:#cbd5e1;">${this.DIAS_NOMBRES[d]}</b>
                    <label style="display:flex; align-items:center; gap:4px; cursor:pointer; color:#fde047;">
                        <input type="checkbox" class="chk-vinc-dt" value="${mTok}" ${puntualesActivos.has(mTok) ? 'checked' : ''}> Mañana
                    </label>
                    <label style="display:flex; align-items:center; gap:4px; cursor:pointer; color:#7dd3fc;">
                        <input type="checkbox" class="chk-vinc-dt" value="${tTok}" ${puntualesActivos.has(tTok) ? 'checked' : ''}> Tarde
                    </label>
                </div>
            `;
        }

        const { value: payload } = await Swal.fire({
            title: `🛣️ Ruta/Zona y Día • ${p.nombre_fantasia}`,
            html: `
                <div style="text-align:left; font-size:0.8rem; color:#cbd5e1; display:flex; flex-direction:column; gap:0.65rem;">
                    <div>
                        <label style="font-size:0.73rem; font-weight:800; color:#6ee7b7; display:block; margin-bottom:4px;">1. Vincular a Ruta(s) / Zona(s) Lineal(es):</label>
                        <div style="background:#0f172a; border:1px solid #334155; border-radius:0.65rem; max-height:165px; overflow-y:auto;">
                            ${rutasHtml || '<div style="padding:10px; color:#94a3b8;">No hay rutas creadas.</div>'}
                        </div>
                    </div>

                    <div>
                        <label style="font-size:0.72rem; font-weight:800; color:#fde047; display:block; margin-bottom:4px;">2. O fijar Día y Turno puntual (Mañana / Tarde):</label>
                        <div style="background:#0f172a; border:1px solid #334155; border-radius:0.65rem; max-height:150px; overflow-y:auto;">
                            ${diasPuntualesHtml}
                        </div>
                    </div>
                </div>
            `,
            background: '#1e293b',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: '💾 Guardar Vinculación',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#059669',
            preConfirm: () => ({
                rutas_zona_ids: Array.from(document.querySelectorAll('.chk-vinc-rz:checked')).map(el => Number(el.value)),
                dias_turnos_puntuales: Array.from(document.querySelectorAll('.chk-vinc-dt:checked')).map(el => el.value)
            })
        });

        if (!payload) return;
        const res = await fetch(`/api/logistica/prospectos/${p.id}/rutas-zona`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) {
            await this.cargarProspectos();
        }
    }
};

window.ProspectosMobileController = ProspectosMobileController;
