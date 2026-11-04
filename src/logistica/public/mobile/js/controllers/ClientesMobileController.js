/**
 * Controlador de Clientes Búnker Móvil (LAMDA Móvil)
 * Archivo: ClientesMobileController.js
 * Gestiona el directorio móvil de clientes, alta/edición, validaciones fiscales ARCA (Módulo 11),
 * máscaras de teléfono argentino, multidomicilios con GPS nativo, contactos dinámicos y portal B2B.
 */

const PREFIJOS_3 = new Set([
    '220', '221', '223', '230', '237', '249', '260', '261', '263', '264',
    '266', '280', '291', '294', '297', '298', '299', '336', '341', '342',
    '343', '345', '348', '351', '353', '358', '362', '370', '376', '379',
    '380', '381', '383', '385', '387', '388'
]);

const DOMINIOS_COMUNES = [
    'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 
    'yahoo.com.ar', 'outlook.com.ar', 'live.com.ar', 'icloud.com'
];

const ClientesMobileController = {
    // Estado del Directorio
    clientes: [],
    clientesFiltrados: [],
    busquedaQuery: '',
    filtroSoloDeudores: false,
    cargandoListado: false,

    // Estado del Formulario Alta/Edición
    clienteIdEdicion: null,
    contactosWhatsapp: [],
    contactosEmail: [],
    domiciliosMemoria: [],
    domicilioEnEdicionIndex: null,
    cargandoArca: false,
    timerLomasAutocomplete: null,
    abortControllerLomas: null,

    // =========================================================
    // 1. INICIALIZACIÓN
    // =========================================================
    async initDirectorio() {
        console.log('📱 [CLIENTES-MÓVIL] Inicializando directorio...');
        this.bindDirectorioEvents();
        await this.cargarClientes();
    },

    async initFormulario() {
        console.log('📱 [CLIENTES-MÓVIL] Inicializando formulario...');
        const params = new URLSearchParams(window.location.search);
        const editId = params.get('id');

        this.bindFormularioEvents();

        if (editId) {
            this.clienteIdEdicion = editId;
            await this.cargarFichaParaEditar(editId);
        } else {
            this.clienteIdEdicion = null;
            await this.inicializarFormularioNuevo();
        }
    },

    // =========================================================
    // 2. MÁSCARA TELEFÓNICA ARGENTINA INTELIGENTE
    // =========================================================
    cleanInputForFormatting(str) {
        if (!str) return '';
        let cleaned = str.replace(/[^\d+]/g, '');
        if (cleaned.startsWith('+549')) cleaned = cleaned.substring(4);
        else if (cleaned.startsWith('+54')) cleaned = cleaned.substring(3);
        else if (cleaned.startsWith('549')) cleaned = cleaned.substring(3);
        else if (cleaned.startsWith('54')) cleaned = cleaned.substring(2);
        if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
        if (cleaned.startsWith('15')) cleaned = cleaned.substring(2);
        return cleaned.replace(/\D/g, '');
    },

    formatArgentinePhone(cleanDigits) {
        if (!cleanDigits) return '';
        let base = cleanDigits;

        if (base.startsWith('11')) {
            const area = base.substring(0, 2);
            const sub = base.substring(2);
            if (sub.length > 4) return `(${area}) ${sub.substring(0, 4)}-${sub.substring(4, 8)}`;
            if (sub.length > 0) return `(${area}) ${sub}`;
            return `(${area})`;
        } else {
            let prefixLength = 4;
            if (base.length >= 3 && PREFIJOS_3.has(base.substring(0, 3))) {
                prefixLength = 3;
            }
            const area = base.substring(0, prefixLength);
            const sub = base.substring(prefixLength);

            if (prefixLength === 3) {
                if (sub.length > 3) return `(${area}) ${sub.substring(0, 3)}-${sub.substring(3, 7)}`;
                if (sub.length > 0) return `(${area}) ${sub}`;
                if (area.length > 0) return `(${area})`;
            } else {
                if (sub.length > 2) return `(${area}) ${sub.substring(0, 2)}-${sub.substring(2, 6)}`;
                if (sub.length > 0) return `(${area}) ${sub}`;
                if (area.length > 0) return `(${area})`;
            }
        }
        return base;
    },

    serializarTelefonoInternacional(rawInput) {
        let clean = this.cleanInputForFormatting(rawInput);
        if (!clean) return '';
        if (clean.length === 10) return '549' + clean;
        if (clean.startsWith('54') && !clean.startsWith('549')) return '549' + clean.substring(2);
        if (clean.startsWith('549')) return clean;
        return '549' + clean;
    },

    // =========================================================
    // 3. VALIDADOR FISCAL CUIT (MÓDULO 11)
    // =========================================================
    validarCuit(cuit) {
        if (!cuit) return true;
        const raw = cuit.replace(/[^0-9]/g, '');
        if (raw.length === 0) return true;
        if (raw.length !== 11) return false;

        const cuitPre = raw.substring(0, 2);
        const cuitDig = parseInt(raw.substring(10, 11), 10);
        const validPrefixes = ['20', '23', '24', '27', '30', '33', '34'];
        if (!validPrefixes.includes(cuitPre)) return false;

        const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
        let sum = 0;
        for (let i = 0; i < 10; i++) {
            sum += parseInt(raw[i], 10) * weights[i];
        }
        let calculated = 11 - (sum % 11);
        if (calculated === 11) calculated = 0;
        if (calculated === 10) return false;

        return calculated === cuitDig;
    },

    validarYMostrarCuit() {
        const input = document.getElementById('txt-cuit');
        const helper = document.getElementById('helper-cuit');
        const btnArca = document.getElementById('btn-consultar-arca');
        if (!input) return true;

        const val = input.value.trim();
        const raw = val.replace(/[^0-9]/g, '');

        if (!val) {
            input.classList.remove('input-valid', 'input-invalid');
            if (helper) { helper.innerText = 'Identificación tributaria de 11 dígitos.'; helper.className = 'form-helper'; }
            if (btnArca) btnArca.disabled = true;
            return true;
        }

        const esValido = this.validarCuit(val);

        if (!esValido || raw.length !== 11) {
            input.classList.remove('input-valid');
            input.classList.add('input-invalid');
            if (helper) {
                helper.innerText = '❌ CUIT inválido (Módulo 11)';
                helper.className = 'form-helper text-danger';
            }
            if (btnArca) btnArca.disabled = true;
            return false;
        } else {
            input.classList.remove('input-invalid');
            input.classList.add('input-valid');
            if (helper) {
                helper.innerText = '✅ CUIT matemáticamente válido';
                helper.className = 'form-helper text-success';
            }
            if (btnArca) btnArca.disabled = false;
            return true;
        }
    },

    // =========================================================
    // 4. CONSULTA EN VIVO A ARCA / AFIP
    // =========================================================
    async consultarArca() {
        const inputCuit = document.getElementById('txt-cuit');
        const btnArca = document.getElementById('btn-consultar-arca');
        if (!inputCuit) return;

        const cuitLimpio = inputCuit.value.replace(/[^0-9]/g, '').trim();
        if (cuitLimpio.length !== 11 || !this.validarCuit(cuitLimpio)) {
            Swal.fire('Atención', 'Ingrese un CUIT/CUIL válido de 11 dígitos antes de consultar.', 'warning');
            return;
        }

        this.cargandoArca = true;
        if (btnArca) {
            btnArca.disabled = true;
            btnArca.innerHTML = '<span class="loader-mini"></span> Consultando...';
        }

        try {
            const res = await fetch('/api/logistica/bunker/clientes/consultar-arca', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cuit_cuil: cuitLimpio })
            });
            const result = await res.json();

            if (!result.success) {
                throw new Error(result.error || 'No se pudieron recuperar datos de ARCA.');
            }

            const datos = result.data;

            // Autocompletar campos
            const txtRazon = document.getElementById('txt-razon');
            const txtNombre = document.getElementById('txt-nombre');
            const selCondicion = document.getElementById('sel-condicion-iva');
            const txtDomFiscal = document.getElementById('txt-domicilio-fiscal');
            const txtProvincia = document.getElementById('txt-provincia');
            const txtEstado = document.getElementById('txt-estado-clave');
            const txtCatMonotributo = document.getElementById('txt-categoria-monotributo');
            const txtActividad = document.getElementById('txt-actividad-principal');

            if (txtRazon) txtRazon.value = datos.razon_social || '';
            if (txtNombre && !txtNombre.value.trim()) txtNombre.value = datos.razon_social || '';
            if (selCondicion && datos.condicion_iva) selCondicion.value = datos.condicion_iva;
            if (txtDomFiscal && datos.domicilio_fiscal) txtDomFiscal.value = datos.domicilio_fiscal;
            if (txtProvincia && datos.provincia) txtProvincia.value = datos.provincia;
            if (txtEstado) txtEstado.value = datos.estado_clave || 'ACTIVO';
            if (txtCatMonotributo) txtCatMonotributo.value = datos.categoria_monotributo || 'N/A';
            if (txtActividad) txtActividad.value = datos.actividad_principal || 'N/A';

            if (datos.advertencia_fiscal) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Datos Recuperados con Advertencia',
                    html: `
                        <p style="font-size: 14px; margin-bottom: 10px;">
                            <strong>${datos.razon_social || 'Contribuyente'}</strong> (${datos.condicion_iva})
                        </p>
                        <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px; border-radius: 4px; text-align: left; font-size: 12px; color: #92400e;">
                            ⚠️ ${datos.advertencia_fiscal}
                        </div>
                    `,
                    confirmButtonColor: '#6b21a8'
                });
            } else {
                Swal.fire({
                    icon: 'success',
                    title: 'Datos Recuperados de ARCA',
                    text: `${datos.razon_social || 'Contribuyente identificado'} (${datos.condicion_iva || 'Sin condición'})`,
                    timer: 2000,
                    showConfirmButton: false
                });
            }

        } catch (e) {
            console.error('Error consultando ARCA:', e);
            Swal.fire('Error de Consulta ARCA', e.message, 'error');
        } finally {
            this.cargandoArca = false;
            if (btnArca) {
                btnArca.disabled = false;
                btnArca.innerHTML = '⚡ Consultar ARCA';
            }
            this.validarYMostrarCuit();
        }
    },

    // =========================================================
    // 5. AUTOCOMPLETE LOMAS SOFT & SUGERENCIA LEGACY
    // =========================================================
    setupLomasSoftTypeahead() {
        const inputLomas = document.getElementById('txt-lomas-id');
        const sugerenciasCont = document.getElementById('lomas-sugerencias-container');
        const btnClear = document.getElementById('btn-clear-lomas');
        if (!inputLomas || !sugerenciasCont) return;

        inputLomas.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (btnClear) btnClear.style.display = query.length > 0 ? 'inline-block' : 'none';

            clearTimeout(this.timerLomasAutocomplete);
            if (this.abortControllerLomas) {
                this.abortControllerLomas.abort();
                this.abortControllerLomas = null;
            }

            if (query.length < 1) {
                sugerenciasCont.style.display = 'none';
                sugerenciasCont.innerHTML = '';
                return;
            }

            this.timerLomasAutocomplete = setTimeout(async () => {
                sugerenciasCont.style.display = 'block';
                sugerenciasCont.innerHTML = '<div class="sugerencia-msg">🔍 Buscando en Lomas Soft...</div>';

                try {
                    this.abortControllerLomas = new AbortController();
                    const [resLomas, resBunker] = await Promise.all([
                        fetch(`/api/presupuestos/clientes/sugerencias?q=${encodeURIComponent(query)}`, { signal: this.abortControllerLomas.signal }),
                        fetch(`/api/logistica/bunker/clientes`, { signal: this.abortControllerLomas.signal })
                    ]);

                    const dataLomas = await resLomas.json();
                    const dataBunker = await resBunker.json();

                    const bunkerAsociados = {};
                    if (dataBunker.success && Array.isArray(dataBunker.data)) {
                        dataBunker.data.forEach(b => {
                            if (b.lomas_soft_id) {
                                bunkerAsociados[String(b.lomas_soft_id).padStart(4, '0')] = b;
                            }
                        });
                    }

                    if (dataLomas.success && Array.isArray(dataLomas.data) && dataLomas.data.length > 0) {
                        sugerenciasCont.innerHTML = '';
                        dataLomas.data.slice(0, 8).forEach(cli => {
                            const idPad = String(cli.id).padStart(4, '0');
                            const asociado = bunkerAsociados[idPad];
                            const esElMismo = asociado && String(asociado.id) === String(this.clienteIdEdicion);

                            const item = document.createElement('div');
                            item.className = 'sugerencia-item';
                            item.innerHTML = `
                                <div style="display:flex; align-items:center; gap:0.5rem; flex:1; min-width:0;">
                                    <span class="badge-code-purple">${idPad}</span>
                                    <span class="text-truncate" style="font-weight:700; color:#f8fafc; font-size:0.88rem;">${cli.nombre}</span>
                                </div>
                                ${asociado && !esElMismo ? `<span class="badge-assigned">Asociado</span>` : ''}
                            `;

                            item.onclick = () => {
                                inputLomas.value = idPad;
                                sugerenciasCont.style.display = 'none';
                                if (btnClear) btnClear.style.display = 'inline-block';

                                // Si los campos están vacíos, autocompletar nombre
                                const txtNombre = document.getElementById('txt-nombre');
                                const txtRazon = document.getElementById('txt-razon');
                                if (txtNombre && !txtNombre.value.trim()) txtNombre.value = cli.nombre || '';
                                if (txtRazon && !txtRazon.value.trim()) txtRazon.value = cli.nombre || '';
                                if (cli.condicion_iva) {
                                    const selCond = document.getElementById('sel-condicion-iva');
                                    if (selCond) selCond.value = cli.condicion_iva;
                                }
                            };

                            sugerenciasCont.appendChild(item);
                        });
                    } else {
                        sugerenciasCont.innerHTML = '<div class="sugerencia-msg">Sin coincidencias externas</div>';
                    }
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error('Error buscando clientes Lomas:', err);
                    sugerenciasCont.innerHTML = '<div class="sugerencia-msg text-danger">Error de búsqueda</div>';
                }
            }, 250);
        });

        if (btnClear) {
            btnClear.onclick = () => {
                inputLomas.value = '';
                btnClear.style.display = 'none';
                sugerenciasCont.style.display = 'none';
                inputLomas.focus();
            };
        }
    },

    async sugerirCodigoLegacyDisponible() {
        const inputLomas = document.getElementById('txt-lomas-id');
        if (!inputLomas || inputLomas.value.trim()) return;

        try {
            const res = await fetch('/api/logistica/bunker/clientes/sugerir-legacy');
            const data = await res.json();
            if (data.success && data.codigoSugerido) {
                inputLomas.value = data.codigoSugerido;
                const btnClear = document.getElementById('btn-clear-lomas');
                if (btnClear) btnClear.style.display = 'inline-block';
            }
        } catch (e) {
            console.error('Error al sugerir código legacy:', e);
        }
    },

    // =========================================================
    // 6. CONTACTOS DINÁMICOS WHATSAPP
    // =========================================================
    renderWhatsappCards() {
        const container = document.getElementById('whatsapp-cards-container');
        if (!container) return;
        container.innerHTML = '';

        if (this.contactosWhatsapp.length === 0) {
            this.contactosWhatsapp.push({ id: `wa_${Date.now()}`, numero: '', nombre: '', cargo: '', enviar_alerta: true });
        }

        this.contactosWhatsapp.forEach((contacto, idx) => {
            const card = document.createElement('div');
            card.className = 'contact-card-mobile';

            card.innerHTML = `
                <div class="contact-card-header">
                    <span style="font-size:0.8rem; font-weight:800; color:#34d399;">📱 Contacto WhatsApp #${idx + 1}</span>
                    ${this.contactosWhatsapp.length > 1 ? `<button type="button" class="btn-remove-card" onclick="ClientesMobileController.eliminarContactoWhatsapp(${idx})">✕</button>` : ''}
                </div>
                <div class="contact-card-body">
                    <div style="display:flex; gap:0.4rem;">
                        <input type="text" class="wizard-input-mobile wa-name" placeholder="Nombre (ej: Carlos)" value="${contacto.nombre || ''}" style="flex:1;">
                        <input type="text" class="wizard-input-mobile wa-role" placeholder="Cargo (ej: Titular)" value="${contacto.cargo || ''}" style="flex:1;">
                    </div>
                    <div style="margin-top:0.4rem;">
                        <input type="tel" class="wizard-input-mobile wa-phone" placeholder="Teléfono (ej: 221 547-4324)" value="${this.formatArgentinePhone(this.cleanInputForFormatting(contacto.numero || ''))}">
                    </div>
                    <label class="checkbox-label-mobile" style="margin-top:0.45rem;">
                        <input type="checkbox" class="wa-alerta" ${contacto.enviar_alerta !== false ? 'checked' : ''}>
                        <span>Enviar Alerta de Entrega Logística 📦</span>
                    </label>
                </div>
            `;

            const inputPhone = card.querySelector('.wa-phone');
            inputPhone.addEventListener('input', (e) => {
                let clean = this.cleanInputForFormatting(e.target.value);
                e.target.value = this.formatArgentinePhone(clean);
                contacto.numero = clean;
            });

            card.querySelector('.wa-name').addEventListener('input', (e) => contacto.nombre = e.target.value);
            card.querySelector('.wa-role').addEventListener('input', (e) => contacto.cargo = e.target.value);
            card.querySelector('.wa-alerta').addEventListener('change', (e) => contacto.enviar_alerta = e.target.checked);

            container.appendChild(card);
        });
    },

    agregarContactoWhatsapp() {
        this.contactosWhatsapp.push({ id: `wa_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`, numero: '', nombre: '', cargo: '', enviar_alerta: true });
        this.renderWhatsappCards();
    },

    eliminarContactoWhatsapp(idx) {
        if (this.contactosWhatsapp.length <= 1) return;
        this.contactosWhatsapp.splice(idx, 1);
        this.renderWhatsappCards();
    },

    // =========================================================
    // 7. CONTACTOS DINÁMICOS EMAIL
    // =========================================================
    renderEmailCards() {
        const container = document.getElementById('email-cards-container');
        if (!container) return;
        container.innerHTML = '';

        this.contactosEmail.forEach((contacto, idx) => {
            const card = document.createElement('div');
            card.className = 'contact-card-mobile';

            card.innerHTML = `
                <div class="contact-card-header">
                    <span style="font-size:0.8rem; font-weight:800; color:#60a5fa;">✉️ Correo de Facturación #${idx + 1}</span>
                    <button type="button" class="btn-remove-card" onclick="ClientesMobileController.eliminarContactoEmail(${idx})">✕</button>
                </div>
                <div class="contact-card-body">
                    <div style="display:flex; gap:0.4rem;">
                        <input type="text" class="wizard-input-mobile mail-name" placeholder="Nombre (ej: Admin)" value="${contacto.nombre || ''}" style="flex:1;">
                        <input type="text" class="wizard-input-mobile mail-role" placeholder="Cargo (ej: Pagos)" value="${contacto.cargo || ''}" style="flex:1;">
                    </div>
                    <div style="margin-top:0.4rem; position:relative;">
                        <input type="email" class="wizard-input-mobile mail-address" list="email-domains-list" placeholder="correo@ejemplo.com" value="${contacto.email || ''}">
                    </div>
                </div>
            `;

            card.querySelector('.mail-name').addEventListener('input', (e) => contacto.nombre = e.target.value);
            card.querySelector('.mail-role').addEventListener('input', (e) => contacto.cargo = e.target.value);
            const inputMail = card.querySelector('.mail-address');
            inputMail.addEventListener('input', (e) => {
                contacto.email = e.target.value.trim();
                const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!contacto.email) {
                    inputMail.classList.remove('input-valid', 'input-invalid');
                } else if (regex.test(contacto.email)) {
                    inputMail.classList.remove('input-invalid');
                    inputMail.classList.add('input-valid');
                } else {
                    inputMail.classList.remove('input-valid');
                    inputMail.classList.add('input-invalid');
                }
            });

            container.appendChild(card);
        });
    },

    agregarContactoEmail() {
        this.contactosEmail.push({ id: `mail_${Date.now()}`, email: '', nombre: '', cargo: '', default_factura: true });
        this.renderEmailCards();
    },

    eliminarContactoEmail(idx) {
        this.contactosEmail.splice(idx, 1);
        this.renderEmailCards();
    },

    // =========================================================
    // 8. MULTIDOMICILIOS CON GPS NATIVO Y COMPOSICIÓN
    // =========================================================
    renderDomiciliosCards() {
        const container = document.getElementById('domicilios-cards-container');
        if (!container) return;
        container.innerHTML = '';

        if (this.domiciliosMemoria.length === 0) {
            container.innerHTML = '<div class="placeholder-msg" style="padding:1rem; font-size:0.85rem;">No hay domicilios de entrega registrados.</div>';
            return;
        }

        this.domiciliosMemoria.forEach((dom, idx) => {
            const card = document.createElement('div');
            card.className = `domicilio-card-mobile ${dom.es_predeterminado ? 'is-default' : ''}`;

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div style="min-width:0;">
                        <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                            <span style="font-weight:800; color:#f8fafc; font-size:0.95rem;">${dom.alias || 'Sucursal Principal'}</span>
                            ${dom.es_predeterminado ? '<span class="badge-predeterminado">⭐ Predeterminado</span>' : ''}
                        </div>
                        <p style="margin:0.25rem 0 0; font-size:0.85rem; color:#cbd5e1; line-height:1.3;">📍 ${dom.direccion || 'Sin dirección'}</p>
                        ${dom.latitud && dom.longitud ? `<span style="font-size:0.72rem; color:#34d399; font-weight:700;">📡 Coordenadas GPS fijadas</span>` : ''}
                    </div>
                    <div style="display:flex; gap:0.3rem;">
                        <button type="button" class="btn-action-dom" onclick="ClientesMobileController.abrirModalDomicilio(${idx})" title="Editar">✏️</button>
                        <button type="button" class="btn-action-dom text-danger" onclick="ClientesMobileController.eliminarDomicilio(${idx})" title="Eliminar">🗑️</button>
                    </div>
                </div>
            `;

            container.appendChild(card);
        });
    },

    mapaModalInstance: null,
    markerModalInstance: null,
    geocoderModalInstance: null,

    async inicializarMapaDomicilioModal(initialLat = null, initialLng = null) {
        const container = document.getElementById('mapa-domicilio-interactive');
        if (!container) return;

        // Cargar Google Maps SDK si no está presente
        if (!window.google || !window.google.maps) {
            container.innerHTML = '<div style="display:flex; height:100%; align-items:center; justify-content:center; color:#94a3b8; font-size:0.8rem;">⏳ Cargando Google Maps...</div>';
            try {
                const resConfig = await fetch('/api/logistica/config');
                const configData = await resConfig.json();
                const apiKey = configData.data?.googleMapsApiKey;

                if (!apiKey) throw new Error('API Key ausente en servidor');

                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
                    script.onload = () => {
                        let attempts = 0;
                        const checkInt = setInterval(() => {
                            attempts++;
                            if (window.google && window.google.maps && window.google.maps.Map) {
                                clearInterval(checkInt);
                                resolve();
                            } else if (attempts > 50) {
                                clearInterval(checkInt);
                                reject(new Error('Timeout cargando Google Maps'));
                            }
                        }, 100);
                    };
                    script.onerror = () => reject(new Error('Fallo al conectar con Google Maps'));
                    document.head.appendChild(script);
                });
            } catch (err) {
                console.error('Error cargando SDK de Mapas:', err);
                container.innerHTML = `<div style="color:#f87171; text-align:center; padding:1rem; font-size:0.8rem;">⚠️ ${err.message}</div>`;
                return;
            }
        }

        const defaultLat = -34.9205; // La Plata
        const defaultLng = -57.9536;
        const lat = (initialLat !== null && !isNaN(parseFloat(initialLat))) ? parseFloat(initialLat) : defaultLat;
        const lng = (initialLng !== null && !isNaN(parseFloat(initialLng))) ? parseFloat(initialLng) : defaultLng;
        const center = { lat, lng };

        if (!this.mapaModalInstance) {
            container.innerHTML = '';
            this.mapaModalInstance = new google.maps.Map(container, {
                center,
                zoom: (initialLat !== null) ? 16 : 14,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                zoomControl: true,
                mapTypeId: 'roadmap',
                gestureHandling: 'greedy'
            });

            this.geocoderModalInstance = new google.maps.Geocoder();

            this.markerModalInstance = new google.maps.Marker({
                position: center,
                map: this.mapaModalInstance,
                draggable: true,
                animation: google.maps.Animation.DROP,
                title: 'Ubicación de entrega'
            });

            this.markerModalInstance.addListener('dragend', () => {
                const pos = this.markerModalInstance.getPosition();
                this.actualizarCoordenadasDesdeMapa(pos.lat(), pos.lng());
            });

            this.mapaModalInstance.addListener('click', (e) => {
                const pos = e.latLng;
                this.markerModalInstance.setPosition(pos);
                this.actualizarCoordenadasDesdeMapa(pos.lat(), pos.lng());
            });
        } else {
            this.mapaModalInstance.setCenter(center);
            this.mapaModalInstance.setZoom((initialLat !== null) ? 16 : 14);
            this.markerModalInstance.setPosition(center);
        }

        if (initialLat !== null && initialLng !== null) {
            this.actualizarBadgeCoordenadas(lat, lng);
        } else {
            this.actualizarBadgeCoordenadas(null, null);
        }

        setTimeout(() => {
            if (this.mapaModalInstance && window.google && window.google.maps) {
                google.maps.event.trigger(this.mapaModalInstance, 'resize');
                this.mapaModalInstance.setCenter(center);
            }
        }, 200);
    },

    actualizarCoordenadasDesdeMapa(lat, lng) {
        const txtLat = document.getElementById('modal-dom-lat');
        const txtLng = document.getElementById('modal-dom-lng');
        if (txtLat) txtLat.value = lat.toFixed(6);
        if (txtLng) txtLng.value = lng.toFixed(6);
        this.actualizarBadgeCoordenadas(lat, lng);

        const statusGps = document.getElementById('status-gps-msg');
        if (statusGps) {
            statusGps.innerText = `📍 Marcador fijado en mapa (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
            statusGps.style.color = '#38bdf8';
        }
    },

    actualizarBadgeCoordenadas(lat, lng) {
        const badge = document.getElementById('badge-gps-coords');
        if (!badge) return;
        if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
            badge.innerText = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            badge.style.color = '#34d399';
        } else {
            badge.innerText = 'Sin coordenadas';
            badge.style.color = '#94a3b8';
        }
    },

    async geocodificarDireccionEnMapa() {
        const txtDir = document.getElementById('modal-dom-direccion');
        const calle = (document.getElementById('modal-dom-calle')?.value || '').trim();
        const num = (document.getElementById('modal-dom-num')?.value || '').trim();
        let query = (txtDir?.value || '').trim();

        if (!query && calle) {
            query = `${calle} ${num}`.trim();
        }

        if (!query) {
            Swal.fire('Atención', 'Ingrese la calle y número o la dirección completa para ubicar en el mapa.', 'warning');
            return;
        }

        const btnBuscar = document.getElementById('btn-buscar-mapa-dom');
        if (btnBuscar) {
            btnBuscar.disabled = true;
            btnBuscar.innerHTML = '🔍 Buscando...';
        }

        try {
            if (!this.geocoderModalInstance) {
                this.geocoderModalInstance = new google.maps.Geocoder();
            }

            const searchAddress = query.toLowerCase().includes('argentina') ? query : `${query}, Buenos Aires, Argentina`;

            this.geocoderModalInstance.geocode({ address: searchAddress }, (results, status) => {
                if (btnBuscar) {
                    btnBuscar.disabled = false;
                    btnBuscar.innerHTML = '🔍 Ubicar';
                }

                if (status === 'OK' && results && results[0]) {
                    const loc = results[0].geometry.location;
                    const lat = loc.lat();
                    const lng = loc.lng();

                    if (this.mapaModalInstance) {
                        this.mapaModalInstance.setCenter(loc);
                        this.mapaModalInstance.setZoom(17);
                    }
                    if (this.markerModalInstance) {
                        this.markerModalInstance.setPosition(loc);
                    }

                    this.actualizarCoordenadasDesdeMapa(lat, lng);

                    const statusGps = document.getElementById('status-gps-msg');
                    if (statusGps) {
                        statusGps.innerText = `✅ Encontrado: ${results[0].formatted_address}`;
                        statusGps.style.color = '#34d399';
                    }
                } else {
                    Swal.fire({
                        title: 'Dirección no encontrada automáticamente',
                        text: 'No se pudo geocodificar con precisión. Podés tocar el mapa o mover el pin marcador para fijar la ubicación exacta.',
                        icon: 'info',
                        background: '#1e293b',
                        color: '#f8fafc',
                        confirmButtonColor: '#7c3aed'
                    });
                }
            });
        } catch (e) {
            if (btnBuscar) {
                btnBuscar.disabled = false;
                btnBuscar.innerHTML = '🔍 Ubicar';
            }
            console.error('Error en geocodificación:', e);
        }
    },

    abrirModalDomicilio(index = null) {
        this.domicilioEnEdicionIndex = index;
        const modal = document.getElementById('modal-domicilio-mobile');
        const titulo = document.getElementById('modal-dom-titulo');
        if (!modal) return;

        const txtAlias = document.getElementById('modal-dom-alias');
        const txtCalle = document.getElementById('modal-dom-calle');
        const txtNum = document.getElementById('modal-dom-num');
        const txtEntre = document.getElementById('modal-dom-entre');
        const txtDireccion = document.getElementById('modal-dom-direccion');
        const txtLat = document.getElementById('modal-dom-lat');
        const txtLng = document.getElementById('modal-dom-lng');
        const chkDefault = document.getElementById('modal-dom-default');
        const statusGps = document.getElementById('status-gps-msg');
        if (statusGps) statusGps.innerText = '';

        let initialLat = null;
        let initialLng = null;

        if (index !== null && this.domiciliosMemoria[index]) {
            const dom = this.domiciliosMemoria[index];
            if (titulo) titulo.innerText = '✏️ Editar Domicilio';
            if (txtAlias) txtAlias.value = dom.alias || '';
            if (txtCalle) txtCalle.value = dom.calle || '';
            if (txtNum) txtNum.value = dom.numero || '';
            if (txtEntre) txtEntre.value = dom.entre_calles || '';
            if (txtDireccion) txtDireccion.value = dom.direccion || '';
            if (txtLat) txtLat.value = dom.latitud || '';
            if (txtLng) txtLng.value = dom.longitud || '';
            if (chkDefault) chkDefault.checked = !!dom.es_predeterminado;
            if (dom.latitud && dom.longitud) {
                initialLat = parseFloat(dom.latitud);
                initialLng = parseFloat(dom.longitud);
            }
        } else {
            if (titulo) titulo.innerText = '➕ Nuevo Domicilio de Entrega';
            if (txtAlias) txtAlias.value = this.domiciliosMemoria.length === 0 ? 'Sucursal Principal' : `Sucursal ${this.domiciliosMemoria.length + 1}`;
            if (txtCalle) txtCalle.value = '';
            if (txtNum) txtNum.value = '';
            if (txtEntre) txtEntre.value = '';
            if (txtDireccion) txtDireccion.value = '';
            if (txtLat) txtLat.value = '';
            if (txtLng) txtLng.value = '';
            if (chkDefault) chkDefault.checked = this.domiciliosMemoria.length === 0;
        }

        modal.classList.add('active');
        this.inicializarMapaDomicilioModal(initialLat, initialLng);
    },

    cerrarModalDomicilio() {
        const modal = document.getElementById('modal-domicilio-mobile');
        if (modal) modal.classList.remove('active');
        this.domicilioEnEdicionIndex = null;
    },

    componerDireccionModal() {
        const calle = (document.getElementById('modal-dom-calle')?.value || '').trim();
        const num = (document.getElementById('modal-dom-num')?.value || '').trim();
        const entre = (document.getElementById('modal-dom-entre')?.value || '').trim();
        const txtDireccion = document.getElementById('modal-dom-direccion');

        if (!txtDireccion) return;
        let parts = [];
        if (calle) parts.push(calle);
        if (num) parts.push(num);
        if (entre) parts.push(`(e/ ${entre})`);

        if (parts.length > 0) {
            txtDireccion.value = parts.join(' ');
        }
    },

    async capturarUbicacionGpsActual() {
        const btnGps = document.getElementById('btn-capturar-gps');
        const txtLat = document.getElementById('modal-dom-lat');
        const txtLng = document.getElementById('modal-dom-lng');
        const statusGps = document.getElementById('status-gps-msg');

        if (!navigator.geolocation) {
            Swal.fire('GPS no soportado', 'Tu navegador o dispositivo no soporta geolocalización.', 'error');
            return;
        }

        if (btnGps) {
            btnGps.disabled = true;
            btnGps.innerHTML = '🛰️ Obteniendo señal GPS...';
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (txtLat) txtLat.value = lat.toFixed(6);
                if (txtLng) txtLng.value = lng.toFixed(6);
                if (statusGps) {
                    statusGps.innerText = `✅ Ubicación fijada: ${lat.toFixed(4)}, ${lng.toFixed(4)} (Precisión: ±${Math.round(pos.coords.accuracy)}m)`;
                    statusGps.style.color = '#34d399';
                }
                if (btnGps) {
                    btnGps.disabled = false;
                    btnGps.innerHTML = '🛰️ Usar mi Ubicación Actual (GPS)';
                }

                if (this.mapaModalInstance) {
                    const loc = { lat, lng };
                    this.mapaModalInstance.setCenter(loc);
                    this.mapaModalInstance.setZoom(17);
                    if (this.markerModalInstance) {
                        this.markerModalInstance.setPosition(loc);
                    }
                }
                this.actualizarBadgeCoordenadas(lat, lng);
            },
            (err) => {
                console.error('Error GPS:', err);
                if (statusGps) {
                    statusGps.innerText = '⚠️ No se pudo obtener la ubicación (active el GPS de su teléfono).';
                    statusGps.style.color = '#f59e0b';
                }
                if (btnGps) {
                    btnGps.disabled = false;
                    btnGps.innerHTML = '🛰️ Usar mi Ubicación Actual (GPS)';
                }
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    },

    guardarDomicilioModal() {
        const alias = (document.getElementById('modal-dom-alias')?.value || '').trim();
        const calle = (document.getElementById('modal-dom-calle')?.value || '').trim();
        const num = (document.getElementById('modal-dom-num')?.value || '').trim();
        const entre = (document.getElementById('modal-dom-entre')?.value || '').trim();
        const direccion = (document.getElementById('modal-dom-direccion')?.value || '').trim();
        const lat = document.getElementById('modal-dom-lat')?.value || null;
        const lng = document.getElementById('modal-dom-lng')?.value || null;
        const esDefault = document.getElementById('modal-dom-default')?.checked || false;

        if (!alias || !direccion) {
            Swal.fire('Campos obligatorios', 'Debe ingresar al menos un Alias y la Dirección de entrega.', 'warning');
            return;
        }

        const domObj = {
            alias,
            calle,
            numero: num,
            entre_calles: entre,
            direccion,
            latitud: lat ? parseFloat(lat) : null,
            longitud: lng ? parseFloat(lng) : null,
            es_predeterminado: esDefault
        };

        if (esDefault) {
            this.domiciliosMemoria.forEach(d => d.es_predeterminado = false);
        }

        if (this.domicilioEnEdicionIndex !== null && this.domiciliosMemoria[this.domicilioEnEdicionIndex]) {
            this.domiciliosMemoria[this.domicilioEnEdicionIndex] = {
                ...this.domiciliosMemoria[this.domicilioEnEdicionIndex],
                ...domObj
            };
        } else {
            if (this.domiciliosMemoria.length === 0) domObj.es_predeterminado = true;
            this.domiciliosMemoria.push(domObj);
        }

        this.cerrarModalDomicilio();
        this.renderDomiciliosCards();
    },

    eliminarDomicilio(idx) {
        this.domiciliosMemoria.splice(idx, 1);
        if (this.domiciliosMemoria.length > 0 && !this.domiciliosMemoria.some(d => d.es_predeterminado)) {
            this.domiciliosMemoria[0].es_predeterminado = true;
        }
        this.renderDomiciliosCards();
    },

    // =========================================================
    // 9. ALTA Y GUARDADO COMPLETO DE CLIENTE
    // =========================================================
    async inicializarFormularioNuevo() {
        const titleEl = document.getElementById('form-cliente-title');
        if (titleEl) titleEl.innerText = '➕ Alta de Cliente';

        const params = new URLSearchParams(window.location.search);
        const fromProspectoId = params.get('fromProspecto');
        const nombreParam = params.get('nombre');
        const direccionParam = params.get('direccion');
        const zonaParam = params.get('zona');
        const telefonoParam = params.get('telefono');
        const contactoParam = params.get('contacto');
        const rolParam = params.get('rol');

        if (fromProspectoId) {
            this.fromProspectoId = fromProspectoId;
            if (titleEl) titleEl.innerText = '🚀 Conversión de Prospecto a Cliente';
        } else {
            this.fromProspectoId = null;
        }

        if (nombreParam) {
            const inputNombre = document.getElementById('txt-nombre');
            const inputRazon = document.getElementById('txt-razon');
            if (inputNombre) inputNombre.value = nombreParam;
            if (inputRazon) inputRazon.value = nombreParam;
        }

        if (telefonoParam) {
            this.contactosWhatsapp = [{
                id: `wa_${Date.now()}`,
                numero: telefonoParam,
                nombre: contactoParam || nombreParam || '',
                cargo: rolParam || 'Contacto',
                enviar_alerta: true
            }];
        } else {
            this.contactosWhatsapp = [{ id: `wa_${Date.now()}`, numero: '', nombre: '', cargo: '', enviar_alerta: true }];
        }

        this.contactosEmail = [];

        if (direccionParam) {
            this.domiciliosMemoria = [{
                id: `dom_${Date.now()}`,
                alias: 'Local Principal',
                direccion: direccionParam,
                localidad: zonaParam || '',
                provincia: 'Buenos Aires',
                es_predeterminado: true,
                activo: true
            }];
        } else {
            this.domiciliosMemoria = [];
        }

        this.renderWhatsappCards();
        this.renderEmailCards();
        this.renderDomiciliosCards();

        await this.sugerirCodigoLegacyDisponible();
    },

    async cargarFichaParaEditar(id) {
        const titleEl = document.getElementById('form-cliente-title');
        if (titleEl) titleEl.innerText = '✏️ Editar Cliente';

        try {
            const res = await fetch(`/api/logistica/bunker/clientes/${id}`);
            const data = await res.json();
            if (!data.success || !data.data) throw new Error(data.error || 'Cliente no encontrado');

            const c = data.data;

            document.getElementById('txt-codigo').value = c.codigo_bunker_cliente || '';
            document.getElementById('txt-nombre').value = c.cliente_nombre || '';
            document.getElementById('txt-razon').value = c.razon_social || '';
            document.getElementById('txt-lomas-id').value = c.lomas_soft_id || '';
            document.getElementById('txt-cuit').value = c.cuit_cuil || '';
            document.getElementById('sel-condicion-iva').value = c.condicion_iva || '';
            document.getElementById('txt-domicilio-fiscal').value = c.domicilio_fiscal || '';
            document.getElementById('txt-provincia').value = c.provincia || '';
            document.getElementById('txt-estado-clave').value = c.estado_clave || '';
            document.getElementById('txt-categoria-monotributo').value = c.categoria_monotributo || '';
            document.getElementById('txt-actividad-principal').value = c.actividad_principal || '';
            document.getElementById('txt-email-portal').value = c.email_portal || '';
            document.getElementById('txt-email-portal-nombre').value = c.email_portal_nombre || '';
            document.getElementById('txt-email-portal-cargo').value = c.email_portal_cargo || '';

            // Cargar banner de saldo C/C (interactivo para abrir detalle integral y enviar PDF)
            const bannerSaldo = document.getElementById('banner-saldo-edicion');
            const lblSaldoVal = document.getElementById('lbl-edicion-saldo-valor');
            const lblSaldoSub = document.getElementById('lbl-edicion-saldo-sub');
            if (bannerSaldo && lblSaldoVal) {
                this.clienteEnEdicionObj = c;
                const saldoNum = parseFloat(c.saldo || 0);
                const formatted = `$ ${Math.abs(saldoNum).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                if (saldoNum > 0) {
                    lblSaldoVal.innerText = formatted;
                    lblSaldoVal.style.color = '#f87171';
                    if (lblSaldoSub) {
                        lblSaldoSub.innerText = '⚠️ Saldo Deudor · 🔍 Ver detalle / PDF ❯';
                        lblSaldoSub.style.color = '#fca5a5';
                    }
                } else if (saldoNum < 0) {
                    lblSaldoVal.innerText = `-${formatted}`;
                    lblSaldoVal.style.color = '#38bdf8';
                    if (lblSaldoSub) {
                        lblSaldoSub.innerText = '⭐ Saldo a Favor · 🔍 Ver detalle / PDF ❯';
                        lblSaldoSub.style.color = '#7dd3fc';
                    }
                } else {
                    lblSaldoVal.innerText = '$ 0,00';
                    lblSaldoVal.style.color = '#34d399';
                    if (lblSaldoSub) {
                        lblSaldoSub.innerText = '✅ Cuenta al Día · 🔍 Ver detalle / PDF ❯';
                        lblSaldoSub.style.color = '#6ee7b7';
                    }
                }
                bannerSaldo.style.display = 'flex';
                bannerSaldo.style.cursor = 'pointer';
                bannerSaldo.onclick = (ev) => this.abrirDetalleSaldoYPoliticasMobile(c.id, ev);
            }

            // Cargar WhatsApp
            this.contactosWhatsapp = [];
            if (c.whatsapp_facturas) {
                try {
                    const parsed = JSON.parse(c.whatsapp_facturas);
                    if (Array.isArray(parsed)) this.contactosWhatsapp = parsed;
                } catch (e) {
                    this.contactosWhatsapp = [{ numero: c.whatsapp_facturas, nombre: '', cargo: '', enviar_alerta: true }];
                }
            }
            this.renderWhatsappCards();

            // Cargar Email
            this.contactosEmail = [];
            if (c.email_facturas) {
                try {
                    const parsed = JSON.parse(c.email_facturas);
                    if (Array.isArray(parsed)) this.contactosEmail = parsed;
                } catch (e) {
                    this.contactosEmail = [{ email: c.email_facturas, nombre: '', cargo: '', default_factura: true }];
                }
            }
            this.renderEmailCards();

            // Cargar Domicilios
            try {
                const resDom = await fetch(`/api/logistica/domicilios/cliente/${id}`);
                const dataDom = await resDom.json();
                if (dataDom.success && Array.isArray(dataDom.data)) {
                    this.domiciliosMemoria = dataDom.data;
                }
            } catch (e) {
                console.error('Error cargando domicilios:', e);
            }
            this.renderDomiciliosCards();

            this.validarYMostrarCuit();

        } catch (e) {
            console.error('Error cargando cliente para edición:', e);
            Swal.fire('Error', 'No se pudo cargar la ficha del cliente: ' + e.message, 'error').then(() => {
                window.location.href = 'clientes.html';
            });
        }
    },

    async guardarClienteFormulario(confirmarExcepcionCuit = false) {
        const nombre = (document.getElementById('txt-nombre')?.value || '').trim();
        const razon = (document.getElementById('txt-razon')?.value || '').trim();
        const codigo = (document.getElementById('txt-codigo')?.value || '').trim();
        const lomasId = (document.getElementById('txt-lomas-id')?.value || '').trim();
        const cuit = (document.getElementById('txt-cuit')?.value || '').trim();
        const condicion = document.getElementById('sel-condicion-iva')?.value || null;
        const domFiscal = (document.getElementById('txt-domicilio-fiscal')?.value || '').trim();
        const provincia = (document.getElementById('txt-provincia')?.value || '').trim();
        const estadoClave = (document.getElementById('txt-estado-clave')?.value || '').trim();
        const catMonotributo = (document.getElementById('txt-categoria-monotributo')?.value || '').trim();
        const actividad = (document.getElementById('txt-actividad-principal')?.value || '').trim();
        const emailPortal = (document.getElementById('txt-email-portal')?.value || '').trim();
        const emailPortalNombre = (document.getElementById('txt-email-portal-nombre')?.value || '').trim();
        const emailPortalCargo = (document.getElementById('txt-email-portal-cargo')?.value || '').trim();

        if (!nombre || !razon) {
            Swal.fire('Campos requeridos', 'Por favor complete el Nombre Comercial y la Razón Social.', 'warning');
            return;
        }

        if (cuit && !this.validarCuit(cuit)) {
            Swal.fire('CUIT Inválido', 'El CUIT ingresado no es válido según algoritmo oficial Módulo 11.', 'warning');
            return;
        }

        // Sanitizar contactos de WhatsApp
        const waFiltrados = this.contactosWhatsapp
            .filter(w => w.numero && w.numero.trim())
            .map(w => ({
                id: w.id || `cont_${Date.now()}`,
                numero: this.serializarTelefonoInternacional(w.numero),
                nombre: (w.nombre || '').trim(),
                cargo: (w.cargo || '').trim(),
                enviar_alerta: w.enviar_alerta !== false
            }));

        // Sanitizar emails
        const emailFiltrados = this.contactosEmail
            .filter(m => m.email && m.email.trim())
            .map(m => ({
                id: m.id || `mail_${Date.now()}`,
                email: m.email.trim(),
                nombre: (m.nombre || '').trim(),
                cargo: (m.cargo || '').trim(),
                default_factura: m.default_factura !== false
            }));

        const esEdicion = !!this.clienteIdEdicion;
        const payload = {
            codigo_bunker_cliente: esEdicion ? codigo : null,
            cliente_nombre: nombre,
            razon_social: razon,
            lomas_soft_id: lomasId || null,
            cuit_cuil: cuit || null,
            condicion_iva: condicion || null,
            domicilio_fiscal: domFiscal || null,
            provincia: provincia || null,
            estado_clave: estadoClave || null,
            categoria_monotributo: catMonotributo || null,
            actividad_principal: actividad || null,
            whatsapp_facturas: waFiltrados.length > 0 ? JSON.stringify(waFiltrados) : null,
            email_facturas: emailFiltrados.length > 0 ? JSON.stringify(emailFiltrados) : null,
            canal_envio_preferido: 'whatsapp',
            email_portal: emailPortal || null,
            email_portal_nombre: emailPortalNombre || null,
            email_portal_cargo: emailPortalCargo || null,
            confirmarCuitDuplicado: confirmarExcepcionCuit,
            domicilios: !esEdicion ? this.domiciliosMemoria : undefined
        };

        const btnGuardar = document.getElementById('btn-guardar-cliente-mobile');
        if (btnGuardar) {
            btnGuardar.disabled = true;
            btnGuardar.innerHTML = '<span class="loader-mini"></span> Guardando...';
        }

        const url = esEdicion ? `/api/logistica/bunker/clientes/${this.clienteIdEdicion}` : `/api/logistica/bunker/clientes`;
        const method = esEdicion ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!data.success) {
                if (res.status === 409 && data.code === 'CUIT_DUPLICADO') {
                    if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.innerHTML = '💾 Guardar Cliente'; }

                    const confirm = await Swal.fire({
                        title: '¿Confirmar excepción de CUIT?',
                        text: `El CUIT "${cuit}" ya está registrado para "${data.clienteNombre}". ¿Desea guardarlo de todas formas como excepción?`,
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonColor: '#7c3aed',
                        cancelButtonColor: '#ef4444',
                        confirmButtonText: 'Sí, guardar excepción',
                        cancelButtonText: 'Cancelar'
                    });

                    if (confirm.isConfirmed) {
                        return this.guardarClienteFormulario(true);
                    }
                    return;
                }

                throw new Error(data.error || 'Error al persistir el cliente.');
            }

            // Si es edición y hay domicilios modificados, guardarlos por endpoint de domicilios
            if (esEdicion && this.domiciliosMemoria.length > 0) {
                for (const dom of this.domiciliosMemoria) {
                    if (!dom.id && dom.direccion) {
                        await fetch('/api/logistica/domicilios', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id_cliente: this.clienteIdEdicion,
                                ...dom
                            })
                        });
                    }
                }
            }

            // Si proviene de la conversión de un prospecto de calle, marcar como CONVERTIDO
            if (this.fromProspectoId && data.data && data.data.id) {
                try {
                    await fetch(`/api/logistica/prospectos/${this.fromProspectoId}/convertir`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ bunker_cliente_id: data.data.id })
                    });
                    console.log(`[PROSPECTO] Prospecto #${this.fromProspectoId} marcado como CONVERTIDO a Cliente #${data.data.id}`);
                } catch (convErr) {
                    console.error('[PROSPECTO] Error asociando conversión:', convErr);
                }
            }

            Swal.fire({
                icon: 'success',
                title: esEdicion ? 'Cliente Actualizado' : (this.fromProspectoId ? '¡Prospecto Convertido a Cliente!' : 'Cliente Registrado'),
                text: `${data.data.cliente_nombre} (${data.data.codigo_bunker_cliente || 'Guardado'})`,
                timer: 2000,
                showConfirmButton: false
            }).then(() => {
                window.location.href = 'clientes.html';
            });

        } catch (err) {
            console.error('Error guardando cliente:', err);
            Swal.fire('Error al Guardar', err.message, 'error');
        } finally {
            if (btnGuardar) {
                btnGuardar.disabled = false;
                btnGuardar.innerHTML = '💾 Guardar Cliente';
            }
        }
    },

    // =========================================================
    // 10. LISTADO Y DIRECTORIO MÓVIL (clientes.html)
    // =========================================================
    async cargarClientes() {
        const container = document.getElementById('lista-clientes-mobile');
        if (container) {
            container.innerHTML = '<div class="loader-spinner" style="margin:2.5rem auto; width:36px; height:36px;"></div><p style="text-align:center; color:#94a3b8; font-size:0.9rem;">Cargando cartera de clientes...</p>';
        }

        try {
            const [resCli, resSalv] = await Promise.allSettled([
                fetch('/api/logistica/bunker/clientes').then(r => r.json()),
                fetch('/api/logistica/bunker/cuentas-corrientes/salvavidas/dashboard-sombra').then(r => r.json())
            ]);

            const data = resCli.status === 'fulfilled' ? resCli.value : null;
            const salvData = resSalv.status === 'fulfilled' ? resSalv.value : null;
            this.financiacionClientesMap = (salvData && salvData.success && salvData.data && salvData.data.clientes_financiacion_map)
                ? salvData.data.clientes_financiacion_map
                : {};

            if (data && data.success && Array.isArray(data.data)) {
                this.clientes = data.data.map(c => {
                    const cod = String(c.codigo_bunker_cliente || '').trim();
                    c.salvavidas_info = this.financiacionClientesMap[cod] || null;
                    return c;
                });
                this.filtrarClientesDirectorio();
            } else {
                if (container) container.innerHTML = '<div class="placeholder-msg">No se encontraron clientes registrados.</div>';
            }
        } catch (e) {
            console.error('Error cargando clientes:', e);
            if (container) container.innerHTML = '<div class="placeholder-msg text-danger">Error de conexión al cargar clientes.</div>';
        }
    },

    filtrarClientesDirectorio() {
        const qClean = (this.busquedaQuery || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const terms = qClean.split(/\s+/).filter(Boolean);

        let res = this.clientes;

        if (this.filtroSoloDeudores) {
            res = res.filter(c => parseFloat(c.saldo || 0) > 0);
        }

        if (terms.length > 0) {
            res = res.filter(c => {
                let waText = '';
                if (c.whatsapp_facturas) {
                    try {
                        const parsed = typeof c.whatsapp_facturas === 'string' && c.whatsapp_facturas.startsWith('[') ? JSON.parse(c.whatsapp_facturas) : [];
                        waText = parsed.map(w => `${w.nombre || ''} ${w.cargo || ''} ${w.numero || ''}`).join(' ');
                    } catch(e) {
                        waText = String(c.whatsapp_facturas);
                    }
                }
                let mailText = '';
                if (c.email_facturas) {
                    try {
                        const parsed = typeof c.email_facturas === 'string' && c.email_facturas.startsWith('[') ? JSON.parse(c.email_facturas) : [];
                        mailText = parsed.map(m => `${m.nombre || ''} ${m.cargo || ''} ${m.email || ''}`).join(' ');
                    } catch(e) {
                        mailText = String(c.email_facturas);
                    }
                }
                const corpus = [
                    c.cliente_nombre || '',
                    c.razon_social || '',
                    c.codigo_bunker_cliente || '',
                    c.lomas_soft_id || '',
                    c.cuit_cuil || '',
                    c.domicilio_fiscal || '',
                    c.provincia || '',
                    c.email_portal || '',
                    c.email_portal_nombre || '',
                    c.email_portal_cargo || '',
                    waText,
                    mailText
                ].join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                return terms.every(t => corpus.includes(t));
            });
        }

        this.clientesFiltrados = res;
        this.renderDirectorio();
    },

    renderDirectorio() {
        const container = document.getElementById('lista-clientes-mobile');
        const counterEl = document.getElementById('contador-clientes-mobile');
        if (!container) return;

        if (counterEl) {
            counterEl.innerText = `${this.clientesFiltrados.length} cliente${this.clientesFiltrados.length === 1 ? '' : 's'}`;
        }

        if (this.clientesFiltrados.length === 0) {
            container.innerHTML = '<div class="placeholder-msg">No se encontraron clientes con el criterio de búsqueda.</div>';
            return;
        }

        container.innerHTML = '';

        this.clientesFiltrados.forEach(c => {
            const card = document.createElement('div');
            card.className = 'cliente-card-mobile';

            const saldo = parseFloat(c.saldo || 0);
            const isRI = (c.condicion_iva || '').toLowerCase().includes('inscripto');

            let saldoColor = '#34d399'; // Verde / Al día
            let saldoBg = 'rgba(52, 211, 153, 0.12)';
            let saldoBorder = 'rgba(52, 211, 153, 0.25)';
            let saldoTexto = `$ ${Math.abs(saldo).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            if (saldo > 0) {
                saldoColor = '#f87171'; // Rojo / Deuda
                saldoBg = 'rgba(248, 113, 113, 0.15)';
                saldoBorder = 'rgba(248, 113, 113, 0.3)';
            } else if (saldo < 0) {
                saldoColor = '#38bdf8'; // Celeste / A favor
                saldoBg = 'rgba(56, 189, 248, 0.15)';
                saldoBorder = 'rgba(56, 189, 248, 0.3)';
                saldoTexto = `-${saldoTexto}`;
            }

            const infoFin = c.salvavidas_info || null;
            const modoFin = infoFin?.modo_switch || (c.salvavidas_modo ? String(c.salvavidas_modo).toUpperCase() : 'ACTIVO');
            const finCalcConIva = Number(infoFin?.financiacion_calculada_con_iva || 0);
            let pillFinanciacionHtml = '';
            if (modoFin === 'EXCLUIDO') {
                pillFinanciacionHtml = `<span style="display:inline-block; margin-top:0.25rem; font-size:0.6rem; font-weight:800; color:#94a3b8; background:rgba(148,163,184,0.12); border:1px solid rgba(148,163,184,0.28); padding:0.12rem 0.45rem; border-radius:999px;">⚪ Financ. Apagada (0%)</span>`;
            } else if (modoFin === 'SOMBRA') {
                if (finCalcConIva > 0) {
                    pillFinanciacionHtml = `<span style="display:inline-block; margin-top:0.25rem; font-size:0.6rem; font-weight:800; color:#fbbf24; background:rgba(245,158,11,0.12); border:1px dashed rgba(245,158,11,0.45); padding:0.12rem 0.45rem; border-radius:999px; opacity:0.8;" title="Financiación en Modo Sombra (Informativo)">🌓 Sombra: +${this.formatearMonedaMobile(finCalcConIva)} c/IVA</span>`;
                } else {
                    pillFinanciacionHtml = `<span style="display:inline-block; margin-top:0.25rem; font-size:0.6rem; font-weight:800; color:#fcd34d; background:rgba(245,158,11,0.1); border:1px dashed rgba(245,158,11,0.35); padding:0.12rem 0.45rem; border-radius:999px; opacity:0.75;">🌓 Modo Sombra</span>`;
                }
            } else {
                if (finCalcConIva > 0) {
                    pillFinanciacionHtml = `<span style="display:inline-block; margin-top:0.25rem; font-size:0.62rem; font-weight:900; color:#34d399; background:rgba(16,185,129,0.18); border:1px solid rgba(16,185,129,0.45); padding:0.14rem 0.48rem; border-radius:999px; box-shadow:0 1px 4px rgba(16,185,129,0.2);">🛡️ Activo: +${this.formatearMonedaMobile(finCalcConIva)} c/IVA</span>`;
                } else {
                    pillFinanciacionHtml = `<span style="display:inline-block; margin-top:0.25rem; font-size:0.6rem; font-weight:800; color:#6ee7b7; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.28); padding:0.12rem 0.45rem; border-radius:999px;">🛡️ Financ. Activa</span>`;
                }
            }

            card.innerHTML = `
                <div class="cliente-card-top">
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                            <span class="badge-code-purple">${c.codigo_bunker_cliente || 'S/C'}</span>
                            ${c.lomas_soft_id ? `<span class="badge-code-gray">Legacy: ${c.lomas_soft_id}</span>` : ''}
                            <h3 class="cliente-card-title text-truncate">${c.cliente_nombre}</h3>
                        </div>
                        <p class="cliente-card-razon text-truncate">🏛️ ${c.razon_social || 'Sin razón social'}</p>
                        <div style="display:flex; align-items:center; gap:0.4rem; margin-top:0.35rem; flex-wrap:wrap;">
                            ${c.cuit_cuil ? `<span style="font-size:0.72rem; color:#94a3b8; font-weight:700;">CUIT: ${c.cuit_cuil}</span>` : ''}
                            <span class="cliente-iva-pill ${isRI ? 'is-ri' : 'is-cf'}">${c.condicion_iva || 'Consumidor Final'}</span>
                        </div>
                    </div>
                    <div style="text-align:right; flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end;">
                        <span style="display:block; font-size:0.62rem; color:#94a3b8; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:0.2rem;">
                            Saldo Cta Cte
                        </span>
                        <button type="button" onclick="ClientesMobileController.abrirDetalleSaldoYPoliticasMobile('${c.id}', event)" title="Ver composición del saldo, políticas y enviar informe PDF" style="font-family:inherit; cursor:pointer; text-align:right; background:${saldoBg}; border:1px solid ${saldoBorder}; padding:0.25rem 0.6rem; border-radius:0.55rem; display:inline-flex; flex-direction:column; align-items:flex-end; gap:0.1rem; transition:transform 0.15s ease, box-shadow 0.15s ease; box-shadow:0 2px 6px rgba(0,0,0,0.2);">
                            <span style="font-size:0.94rem; font-weight:900; color:${saldoColor}; white-space:nowrap; letter-spacing:-0.01em; line-height:1.15;">
                                ${saldoTexto}
                            </span>
                            <span style="font-size:0.6rem; font-weight:800; color:#cbd5e1; white-space:nowrap; opacity:0.92;">
                                🔍 Detalle / PDF ❯
                            </span>
                        </button>
                        ${pillFinanciacionHtml}
                    </div>
                </div>

                <div class="cliente-card-actions">
                    <button class="btn-card-action btn-action-pedido" onclick="ClientesMobileController.crearPedidoCliente('${c.codigo_bunker_cliente || c.lomas_soft_id || c.id}')" title="Crear Pedido de Venta">
                        🛒 Pedido
                    </button>
                    <button class="btn-card-action btn-action-cotizar" onclick="ClientesMobileController.cotizarPreciosCliente('${c.codigo_bunker_cliente || c.id}')" title="Cotizar y Enviar Precios">
                        🏷️ Cotizar
                    </button>
                    <button class="btn-card-action" onclick="ClientesMobileController.abrirModalAccionesRapidas('${c.id}')" title="Más Acciones">
                        ⚙️ Más
                    </button>
                    <a href="crear-cliente-movil.html?id=${c.id}" class="btn-card-action" title="Editar Ficha">
                        ✏️ Editar
                    </a>
                </div>
            `;

            container.appendChild(card);
        });
    },

    crearPedidoCliente(clienteId) {
        window.location.href = `crear-presupuesto-movil.html?clienteId=${encodeURIComponent(clienteId)}`;
    },

    cotizarPreciosCliente(clienteId) {
        window.location.href = `cotizar-precios-movil.html?clienteId=${encodeURIComponent(clienteId)}`;
    },

    cotizarCliente(clienteId) {
        this.crearPedidoCliente(clienteId);
    },

    abrirModalAccionesRapidas(clienteId) {
        const c = this.clientes.find(x => x.id == clienteId);
        if (!c) return;

        let wpNumero = '';
        if (c.whatsapp_facturas) {
            try {
                const parsed = JSON.parse(c.whatsapp_facturas);
                if (Array.isArray(parsed) && parsed.length > 0) wpNumero = parsed[0].numero;
            } catch (e) {
                wpNumero = c.whatsapp_facturas;
            }
        }

        Swal.fire({
            title: `<div style="color:#f8fafc; font-size:1.15rem; font-weight:800;">⚙️ ${c.cliente_nombre}</div>`,
            background: '#1e293b',
            color: '#f8fafc',
            html: `
                <div style="display:flex; flex-direction:column; gap:0.6rem; text-align:left; margin-top:0.5rem;">
                    <button class="btn-modal-link" style="background:linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color:white; padding:0.7rem 1rem; border-radius:0.75rem; font-weight:800; border:none; cursor:pointer; display:flex; align-items:center; gap:0.5rem;" onclick="Swal.close(); ClientesMobileController.abrirDetalleSaldoYPoliticasMobile('${c.id}')">
                        💳 Ver Detalle de Saldo, Políticas y Enviar PDF
                    </button>
                    ${wpNumero ? `
                        <a href="https://wa.me/${wpNumero.replace(/\D/g,'')}" target="_blank" class="btn-modal-link" style="background:#059669; color:white; padding:0.65rem 1rem; border-radius:0.75rem; font-weight:700; text-decoration:none; display:flex; align-items:center; gap:0.5rem;">
                            💬 Abrir WhatsApp Directo (${wpNumero})
                        </a>
                    ` : ''}
                    <button class="btn-modal-link" style="background:#7c3aed; color:white; padding:0.65rem 1rem; border-radius:0.75rem; font-weight:700; border:none; cursor:pointer; display:flex; align-items:center; gap:0.5rem;" onclick="Swal.close(); ClientesMobileController.abrirModalListasBunker('${c.id}')">
                        🏷️ Asignar Lista Búnker
                    </button>
                    <button class="btn-modal-link" style="background:#0d9488; color:white; padding:0.65rem 1rem; border-radius:0.75rem; font-weight:700; border:none; cursor:pointer; display:flex; align-items:center; gap:0.5rem;" onclick="Swal.close(); ClientesMobileController.generarEnsobradoEfectivo('${c.id}')">
                        📦 Generar Ensobrado de Efectivo (QR / Link)
                    </button>
                    <button class="btn-modal-link" style="background:#2563eb; color:white; padding:0.65rem 1rem; border-radius:0.75rem; font-weight:700; border:none; cursor:pointer; display:flex; align-items:center; gap:0.5rem;" onclick="Swal.close(); ClientesMobileController.invitarPortalB2B('${c.id}')">
                        ✉️ Invitar al Portal B2B
                    </button>
                </div>
            `,
            showConfirmButton: false,
            showCloseButton: true
        });
    },

    // =========================================================
    // 10.B DETALLE INTEGRAL DE SALDO, POLÍTICAS Y ENVÍO PDF MÓVIL
    // =========================================================
    formatearMonedaMobile(val) {
        const num = Number(val);
        const safe = Number.isFinite(num) ? num : 0;
        const sign = safe < 0 ? '-' : '';
        return `${sign}$ ${Math.abs(safe).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },

    formatearFechaCortaMobile(fechaRaw, diasSumar = 0) {
        if (!fechaRaw) return null;
        try {
            const str = String(fechaRaw).trim();
            const d = str.length === 10 ? new Date(str + 'T12:00:00') : new Date(str);
            if (isNaN(d.getTime())) return null;
            if (diasSumar) d.setDate(d.getDate() + diasSumar);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        } catch (e) {
            return null;
        }
    },

    construirBloquePoliticaFinanciacionWAMobile(salvavidasInfo) {
        const reglas = salvavidasInfo?.reglas_aplicadas || {};
        const comodinesDisp = reglas.cortesias_disponibles_anio !== undefined
            ? reglas.cortesias_disponibles_anio
            : (reglas.comodines_disponibles !== undefined ? reglas.comodines_disponibles : 3);
        const comodinesMax = reglas.cupo_cortesias_anual || reglas.comodines_anuales_max || 3;
        return (
            `\n\n🛡️ *ESQUEMA DE FINANCIACIÓN LAMDA (4 ETAPAS) Y PAGOS PARCIALES:*\n` +
            `• *1. Compromiso Habitual (Días 1 a 7):* Plazo normal de pago desde la entrega (0% interés y sin usar comodín).\n` +
            `• *2. +3 Días de Gracia Natural (Días 8 a 10):* Tolerancia automática por demoras bancarias o fin de semana (0% interés y *NO consume comodín*).\n` +
            `• *3. Comodín Trimestral (Días 11 a 14):* Contás con *1 comodín cada 3 meses* (${comodinesMax} al año; hoy tenés *${comodinesDisp}/${comodinesMax} disponibles*) para extender el plazo hasta el Día 14 con *0% de interés*.\n` +
            `• *4. Financiación Salvavidas (Día 15+):* Superado el Día 14 (o sin comodines), se activa el Salvavidas del *3% mensual + IVA (0,1% diario + IVA desde el Día 1 de entrega)* sobre el saldo pendiente, manteniendo tu cuenta activa para nuevos pedidos.\n` +
            `• *Pagos Parciales Libres:* Podés abonar entregas parciales en cualquier momento; se descuentan de la factura más antigua y reducen el interés diario futuro.`
        );
    },

    construirBloquePoliticaListaWAMobile(politicaInfo, c) {
        const listaNombre = politicaInfo?.lista_nombre || (Array.isArray(c?.listas_precios) && c.listas_precios[0]?.nombre) || 'Mayorista Asignada';
        const listaId = politicaInfo?.lista_id || (Array.isArray(c?.listas_precios) && c.listas_precios[0]?.id) || null;
        const tramos = Array.isArray(politicaInfo?.politica?.tramos) ? politicaInfo.politica.tramos : [];
        const primerTramo = tramos[0] || { monto_minimo: 250000, porcentaje_descuento: 5 };
        const pctDto = Number(primerTramo.porcentaje_descuento || 5).toLocaleString('es-AR', { maximumFractionDigits: 1 });
        const montoMin = this.formatearMonedaMobile(primerTramo.monto_minimo || 250000);

        return (
            `\n\n🏷️ *POLÍTICA COMERCIAL DE TU LISTA (${listaId ? `Lista #${listaId} - ` : ''}${listaNombre}):*\n` +
            `• *Precio Mayorista Mantenido:* Conservás tu lista asignada sin exigencia de compra mínima mensual.\n` +
            `• *Bonificación por Volumen (${pctDto}% OFF):* En compras superiores a *${montoMin}*, requisito excluyente tener la *Cuenta Corriente al día (Saldo $ 0,00)*.\n` +
            `• *Ofertas Promocionales:* Exclusivas para cuentas sin deuda vencida (Saldo $ 0,00).\n` +
            `• *Medios de Pago:* Transferencia Galicia (*Alias: LAMDA.SER.MARTIN* | *CBU: 0070373230004007844141*), Depósito Efectivo 24hs Cajeros Galicia (*CTA: 4007844-1 373-4*) o Efectivo Ensobrado.`
        );
    },

    async cambiarModoFinanciacionMobile(codigoBunker, clienteId, nuevoModo) {
        if (!codigoBunker || !nuevoModo) return;
        try {
            const res = await fetch(`/api/logistica/bunker/cuentas-corrientes/salvavidas/configuracion-cliente/${encodeURIComponent(codigoBunker)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ salvavidas_modo: nuevoModo })
            });
            const json = await res.json();
            if (!res.ok || !json.success) {
                throw new Error(json.error || 'No se pudo actualizar el modo de financiación.');
            }
            const cli = (this.clientes || []).find(x => String(x.id) === String(clienteId) || String(x.codigo_bunker_cliente) === String(codigoBunker));
            if (cli) {
                cli.salvavidas_modo = nuevoModo;
                if (cli.salvavidas_info) {
                    cli.salvavidas_info.modo_switch = nuevoModo;
                } else {
                    cli.salvavidas_info = { modo_switch: nuevoModo };
                }
            }
            if (this.financiacionClientesMap && this.financiacionClientesMap[codigoBunker]) {
                this.financiacionClientesMap[codigoBunker].modo_switch = nuevoModo;
            }
            this.renderDirectorio();
            await this.abrirDetalleSaldoYPoliticasMobile(clienteId);
        } catch (err) {
            console.error('Error al cambiar modo de financiación móvil:', err);
            Swal.fire({
                icon: 'error',
                title: 'Error al cambiar modo',
                text: err.message || 'No se pudo actualizar el modo de financiación.',
                background: '#1e293b',
                color: '#f8fafc',
                confirmButtonColor: '#7c3aed'
            });
        }
    },

    cerrarDetalleSaldoMobile(fromPopState = false) {
        const overlay = document.getElementById('cc-mobile-fullscreen-overlay');
        if (overlay) {
            overlay.remove();
        }
        document.body.style.overflow = '';
        if (this._ccPopStateHandler) {
            window.removeEventListener('popstate', this._ccPopStateHandler);
            this._ccPopStateHandler = null;
        }
        if (!fromPopState && window.history.state && window.history.state.ccMobileFullscreen) {
            try { window.history.back(); } catch (e) { /* ignore */ }
        }
    },

    async abrirDetalleSaldoYPoliticasMobile(clienteId, event = null) {
        if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
            event.preventDefault();
        }

        let c = (this.clientes || []).find(x => String(x.id) === String(clienteId) || String(x.codigo_bunker_cliente) === String(clienteId));
        if (!c && this.clienteEnEdicionObj && String(this.clienteEnEdicionObj.id) === String(clienteId)) {
            c = this.clienteEnEdicionObj;
        }

        const existingOverlay = document.getElementById('cc-mobile-fullscreen-overlay');
        if (!existingOverlay) {
            Swal.fire({
                title: 'Consultando Cuenta Corriente...',
                html: '<div style="font-size:0.95rem; color:#94a3b8;">Calculando composición de comprobantes, fechas clave y políticas...</div>',
                background: '#1e293b',
                color: '#f8fafc',
                allowOutsideClick: false,
                showConfirmButton: false,
                didOpen: () => Swal.showLoading()
            });
        }

        try {
            if (!c) {
                const resCli = await fetch(`/api/logistica/bunker/clientes/${encodeURIComponent(clienteId)}`);
                const dataCli = await resCli.json();
                if (!dataCli.success || !dataCli.data) throw new Error('No se encontró la ficha del cliente.');
                c = dataCli.data;
            }

            const codigoBunker = c.codigo_bunker_cliente;
            let ccId = c.cuenta_corriente_id || null;

            if (!ccId && codigoBunker) {
                const resCuentas = await fetch(`/api/logistica/bunker/cuentas-corrientes?cliente=${encodeURIComponent(codigoBunker)}`);
                const dataCuentas = await resCuentas.json();
                if (dataCuentas.success && Array.isArray(dataCuentas.data) && dataCuentas.data.length > 0) {
                    ccId = dataCuentas.data[0].id;
                    c.cuenta_corriente_id = ccId;
                    if (dataCuentas.data[0].saldo !== undefined) c.saldo = dataCuentas.data[0].saldo;
                } else {
                    // Abrir cuenta corriente automáticamente si no existía
                    const resCrearCC = await fetch('/api/logistica/bunker/cuentas-corrientes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ codigo_bunker_cliente: codigoBunker, moneda: 'ARS' })
                    });
                    const dataCrearCC = await resCrearCC.json();
                    if (dataCrearCC.success && dataCrearCC.data) {
                        ccId = dataCrearCC.data.id;
                        c.cuenta_corriente_id = ccId;
                    }
                }
            }

            // Consultas en paralelo: Simulación Salvavidas, Composición FIFO, Política de Lista y Mensaje WA predeterminado
            const [salvRes, compRes, polRes, msgRes] = await Promise.all([
                ccId ? fetch(`/api/logistica/bunker/cuentas-corrientes/${ccId}/salvavidas-simulacion`).then(r => r.json()).catch(() => null) : Promise.resolve(null),
                ccId ? fetch(`/api/logistica/bunker/cuentas-corrientes/${ccId}/composicion-saldo`).then(r => r.json()).catch(() => null) : Promise.resolve(null),
                codigoBunker ? fetch(`/api/presupuestos/politicas/cliente/${encodeURIComponent(codigoBunker)}`).then(r => r.json()).catch(() => null) : Promise.resolve(null),
                ccId ? fetch(`/api/logistica/bunker/cuentas-corrientes/${ccId}/whatsapp/mensaje-predeterminado?detallar_balance=true&desde_ultimo_cero=true&modo_corte=ultimo_cero`).then(r => r.json()).catch(() => null) : Promise.resolve(null)
            ]);

            if (typeof Swal !== 'undefined' && Swal.isVisible()) {
                Swal.close();
            }

            const salvavidasInfo = (salvRes && salvRes.success && salvRes.data) ? salvRes.data : (msgRes?.salvavidas || null);
            const composicionInfo = (compRes && compRes.success && compRes.data) ? compRes.data : (msgRes?.composicion || null);
            const politicaInfo = (polRes && polRes.success && polRes.data) ? polRes.data : null;

            const saldoContable = salvavidasInfo && salvavidasInfo.saldo_contable_real !== undefined
                ? Number(salvavidasInfo.saldo_contable_real)
                : Number(c.saldo || 0);
            const reglas = salvavidasInfo?.reglas_aplicadas || {};
            const modoSwitch = reglas.modo_switch || (reglas.habilitado === false ? 'EXCLUIDO' : (c.salvavidas_modo ? String(c.salvavidas_modo).toUpperCase() : 'ACTIVO'));

            const finCalcNeta = Number(salvavidasInfo?.financiacion_calculada_neta ?? salvavidasInfo?.financiacion_neta_total ?? salvavidasInfo?.financiacion_total ?? 0);
            const finCalcIva = Number(salvavidasInfo?.financiacion_calculada_iva ?? salvavidasInfo?.financiacion_iva_total ?? salvavidasInfo?.financiacion_iva ?? 0);
            const finCalcConIva = Number(salvavidasInfo?.financiacion_calculada_con_iva ?? salvavidasInfo?.financiacion_total_con_iva ?? (finCalcNeta + finCalcIva));

            const interesNeto = modoSwitch === 'ACTIVO' ? finCalcNeta : 0;
            const interesIva = modoSwitch === 'ACTIVO' ? finCalcIva : 0;
            const interesTotalConIva = modoSwitch === 'ACTIVO' ? finCalcConIva : 0;

            const tieneSalvavidasActivo = modoSwitch === 'ACTIVO' && saldoContable > 0 && interesTotalConIva > 0;
            const tieneSalvavidasSombra = modoSwitch === 'SOMBRA' && saldoContable > 0 && finCalcConIva > 0;
            const totalConsolidadoReal = tieneSalvavidasActivo
                ? Number(salvavidasInfo?.saldo_total_proyectado_con_iva ?? (saldoContable + interesTotalConIva))
                : saldoContable;
            const totalSimuladoSombra = Number((saldoContable + finCalcConIva).toFixed(2));

            const comodinesDisp = reglas.cortesias_disponibles_anio !== undefined
                ? reglas.cortesias_disponibles_anio
                : (reglas.comodines_disponibles !== undefined ? reglas.comodines_disponibles : 3);
            const comodinesMax = reglas.cupo_cortesias_anual || reglas.comodines_anuales_max || 3;

            // Determinar badge de etapa general
            const estadoGen = salvavidasInfo?.estado_general || (saldoContable <= 0 ? 'AL_DIA' : 'COMPROMISO');
            let badgeEstadoTexto = '✅ Cuenta al Día (Sin deuda)';
            let badgeEstadoBg = 'rgba(16, 185, 129, 0.18)';
            let badgeEstadoColor = '#34d399';
            let badgeEstadoBorder = 'rgba(52, 211, 153, 0.35)';

            if (saldoContable < 0) {
                badgeEstadoTexto = '⭐ Saldo a Favor del Cliente';
                badgeEstadoBg = 'rgba(56, 189, 248, 0.18)';
                badgeEstadoColor = '#38bdf8';
                badgeEstadoBorder = 'rgba(56, 189, 248, 0.35)';
            } else if (saldoContable > 0) {
                if (modoSwitch === 'EXCLUIDO') {
                    badgeEstadoTexto = '⚪ Financiación Apagada (Excluido del programa · 0% interés)';
                    badgeEstadoBg = 'rgba(148, 163, 184, 0.16)';
                    badgeEstadoColor = '#cbd5e1';
                    badgeEstadoBorder = 'rgba(148, 163, 184, 0.35)';
                } else if (tieneSalvavidasSombra) {
                    badgeEstadoTexto = '🌓 Modo Sombra (Informativo · Sin aplicación efectiva en saldo)';
                    badgeEstadoBg = 'rgba(245, 158, 11, 0.16)';
                    badgeEstadoColor = '#fde68a';
                    badgeEstadoBorder = 'rgba(245, 158, 11, 0.45)';
                } else if (tieneSalvavidasActivo || estadoGen === 'FINANCIACION_ACTIVA') {
                    badgeEstadoTexto = '🛡️ Etapa 4: Salvavidas Activo (Día 15+ · 3% mens. + IVA)';
                    badgeEstadoBg = 'rgba(239, 68, 68, 0.2)';
                    badgeEstadoColor = '#fca5a5';
                    badgeEstadoBorder = 'rgba(248, 113, 113, 0.45)';
                } else if (estadoGen === 'COMODIN_ACTIVO') {
                    badgeEstadoTexto = '🎟️ Etapa 3: Comodín Trimestral Activo (Días 11 a 14 · 0% int.)';
                    badgeEstadoBg = 'rgba(245, 158, 11, 0.2)';
                    badgeEstadoColor = '#fcd34d';
                    badgeEstadoBorder = 'rgba(251, 191, 36, 0.45)';
                } else if (estadoGen === 'GRACIA_NATURAL') {
                    badgeEstadoTexto = '⏳ Etapa 2: +3d Gracia Natural (Días 8 a 10 · 0% int. sin comodín)';
                    badgeEstadoBg = 'rgba(56, 189, 248, 0.18)';
                    badgeEstadoColor = '#7dd3fc';
                    badgeEstadoBorder = 'rgba(56, 189, 248, 0.4)';
                } else {
                    badgeEstadoTexto = '🟢 Etapa 1: Compromiso Habitual (Días 1 a 7 · 0% interés)';
                    badgeEstadoBg = 'rgba(16, 185, 129, 0.18)';
                    badgeEstadoColor = '#6ee7b7';
                    badgeEstadoBorder = 'rgba(52, 211, 153, 0.4)';
                }
            }

            // Construir listado de comprobantes abiertos (¿De qué es este saldo?)
            const capas = (salvavidasInfo && Array.isArray(salvavidasInfo.capas_simuladas) && salvavidasInfo.capas_simuladas.length > 0)
                ? salvavidasInfo.capas_simuladas
                : ((composicionInfo && Array.isArray(composicionInfo.capas)) ? composicionInfo.capas : []);

            // Calcular resumen de días para mostrar entre paréntesis junto al Servicio de Financiación arriba de todo
            const capasEnFinanciacion = capas.filter(cs =>
                cs.ventana_codigo === 'ASISTENCIA_FORMALIZADA' ||
                cs.estado_financiacion === 'FINANCIACION_ACTIVA' ||
                Number(cs.interes_financiacion_con_iva ?? cs.interes_devengado_con_iva ?? cs.interes_financiacion ?? 0) > 0
            );
            const diasFinArr = (capasEnFinanciacion.length > 0 ? capasEnFinanciacion : capas)
                .map(cs => cs.antiguedad_dias !== undefined && cs.antiguedad_dias !== null ? Number(cs.antiguedad_dias) : (cs.dias_transcurridos !== undefined && cs.dias_transcurridos !== null ? Number(cs.dias_transcurridos) : null))
                .filter(d => d !== null && !Number.isNaN(d));

            let diasParentesisTexto = '';
            if (diasFinArr.length === 1) {
                diasParentesisTexto = `${diasFinArr[0]} días`;
            } else if (diasFinArr.length === 2) {
                diasParentesisTexto = `${diasFinArr[0]}d y ${diasFinArr[1]}d`;
            } else if (diasFinArr.length > 2) {
                diasParentesisTexto = `máx. ${Math.max(...diasFinArr)} días · ${diasFinArr.length} comp.`;
            } else if (salvavidasInfo?.antiguedad_max_dias) {
                diasParentesisTexto = `${salvavidasInfo.antiguedad_max_dias} días`;
            }

            let comprobantesHtml = '';
            if (saldoContable <= 0 || capas.length === 0) {
                comprobantesHtml = `
                    <div style="background:#0f172a; border:1px solid #334155; border-radius:0.85rem; padding:1rem; text-align:center; color:#cbd5e1; font-size:0.98rem;">
                        ${saldoContable > 0
                            ? `El saldo de <strong style="color:#f8fafc;">${this.formatearMonedaMobile(saldoContable)}</strong> proviene de saldo inicial / movimientos previos unificados.`
                            : `✅ No registrás facturas ni presupuestos pendientes de pago.`}
                    </div>
                `;
            } else {
                comprobantesHtml = capas.map(cs => {
                    const compNombre = cs.comprobante_nombre || cs.descripcion || 'Comprobante';
                    const montoPend = Number(cs.capital_pendiente ?? cs.monto_pendiente ?? 0);
                    const montoOrig = Number(cs.monto_original ?? montoPend);
                    const tuvoPagoParcial = montoOrig > montoPend + 0.5;
                    const dias = cs.antiguedad_dias !== undefined && cs.antiguedad_dias !== null
                        ? cs.antiguedad_dias
                        : (cs.dias_transcurridos !== null && cs.dias_transcurridos !== undefined ? cs.dias_transcurridos : null);
                    const canal = cs.canal_entrega === 'REPARTO' ? '🚚 Reparto' : '🏭 Depósito';
                    const movId = cs.movimiento_id || null;

                    const pCeroBase = cs.punto_cero || cs.fecha_punto_cero || cs.fecha_facturacion;
                    const fDia1 = this.formatearFechaCortaMobile(pCeroBase, 0);
                    const fDia7 = this.formatearFechaCortaMobile(cs.fecha_vto_compromiso || cs.fecha_vencimiento_7d) || this.formatearFechaCortaMobile(pCeroBase, 7);
                    const fDia10 = this.formatearFechaCortaMobile(cs.fecha_vto_gracia_natural || cs.fecha_fin_gracia_10d) || this.formatearFechaCortaMobile(pCeroBase, 10);
                    const fDia14 = this.formatearFechaCortaMobile(cs.fecha_vto_comodin || cs.fecha_vencimiento_comodin_14d) || this.formatearFechaCortaMobile(pCeroBase, 14);

                    let estLabel = '';
                    let borderLeftColor = '#10b981';
                    let badgeColor = '#34d399';

                    const esAsistFormal = cs.ventana_codigo === 'ASISTENCIA_FORMALIZADA' || cs.estado_financiacion === 'FINANCIACION_ACTIVA';
                    const esComodin = cs.ventana_codigo === 'ASISTENCIA_CORTESIA' || cs.estado_financiacion === 'COMODIN_ACTIVO';
                    const esGracia = cs.ventana_codigo === 'GRACIA_NATURAL' || cs.estado_financiacion === 'GRACIA_NATURAL' || (dias !== null && dias > 7 && dias <= 10);

                    if (esAsistFormal) {
                        const intNeto = Number(cs.interes_financiacion ?? cs.interes_devengado_neto ?? cs.interes_devengado ?? 0);
                        const intIva = Number(cs.iva_financiacion ?? cs.interes_devengado_iva ?? (intNeto * 0.21));
                        const intTot = Number(cs.interes_financiacion_con_iva ?? cs.interes_devengado_con_iva ?? (intNeto + intIva));
                        if (modoSwitch === 'EXCLUIDO') {
                            estLabel = `⚪ (${dias} días) · Financiación Apagada (Excluido · 0% interés)`;
                            borderLeftColor = '#64748b';
                            badgeColor = '#cbd5e1';
                        } else if (modoSwitch === 'SOMBRA') {
                            estLabel = `🌓 (${dias} días) · En Sombra (+${this.formatearMonedaMobile(intNeto)} + IVA ${this.formatearMonedaMobile(intIva)} = +${this.formatearMonedaMobile(intTot)})`;
                            borderLeftColor = '#f59e0b';
                            badgeColor = '#fde68a';
                        } else {
                            estLabel = `🛡️ (${dias} días) · Financiación Activa (+${this.formatearMonedaMobile(intNeto)} + IVA ${this.formatearMonedaMobile(intIva)} = +${this.formatearMonedaMobile(intTot)})`;
                            borderLeftColor = '#ef4444';
                            badgeColor = '#fca5a5';
                        }
                    } else if (esComodin) {
                        estLabel = `🎟️ (${dias}/14 días) · Comodín Trimestral Activo (0% interés)`;
                        borderLeftColor = '#f59e0b';
                        badgeColor = '#fcd34d';
                    } else if (esGracia) {
                        estLabel = `⏳ (${dias}/10 días) · +3d Gracia Natural (0% interés · NO usa comodín)`;
                        borderLeftColor = '#0ea5e9';
                        badgeColor = '#7dd3fc';
                    } else {
                        estLabel = `🟢 (${dias !== null ? `${dias}/7 días` : 'En plazo'}) · Compromiso Habitual (0% interés)`;
                        borderLeftColor = '#10b981';
                        badgeColor = '#6ee7b7';
                    }

                    return `
                        <div style="background:#0f172a; border:1px solid #334155; border-left:5px solid ${borderLeftColor}; border-radius:0.8rem; padding:0.85rem 0.9rem; margin-bottom:0.65rem;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                                <div style="min-width:0; flex:1;">
                                    <div style="font-size:1.05rem; font-weight:900; color:#f8fafc; word-break:break-word; line-height:1.25;">
                                        ${compNombre}
                                    </div>
                                    <div style="font-size:0.85rem; color:#cbd5e1; margin-top:0.2rem;">
                                        ${canal} · <strong style="color:#fbbf24;">${dias !== null ? `${dias} días` : 'En plazo'}</strong> ${tuvoPagoParcial ? `· <span style="color:#38bdf8; font-weight:800;">Saldo Parcial (Orig: ${this.formatearMonedaMobile(montoOrig)})</span>` : '· 100% pendiente'}
                                    </div>
                                </div>
                                <div style="text-align:right; flex-shrink:0;">
                                    <div style="font-size:1.22rem; font-weight:900; color:#f8fafc;">
                                        ${this.formatearMonedaMobile(montoPend)}
                                    </div>
                                    ${movId ? `
                                        <a href="/api/logistica/bunker/cuentas-corrientes/movimientos/${movId}/pdf" target="_blank" style="display:inline-block; margin-top:0.25rem; font-size:0.82rem; font-weight:800; color:#c084fc; text-decoration:none; background:rgba(192,132,252,0.14); padding:0.2rem 0.55rem; border-radius:0.4rem; border:1px solid rgba(192,132,252,0.35);">
                                            📄 Ver Comp.
                                        </a>
                                    ` : ''}
                                </div>
                            </div>
                            <div style="margin-top:0.55rem; padding:0.4rem 0.55rem; background:rgba(255,255,255,0.03); border-radius:0.45rem; font-size:0.9rem; font-weight:800; color:${badgeColor}; line-height:1.3;">
                                ${estLabel}
                            </div>
                            ${fDia1 ? `
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.35rem 0.6rem; margin-top:0.55rem; padding-top:0.5rem; border-top:1px dashed rgba(255,255,255,0.12); font-size:0.84rem; color:#cbd5e1;">
                                    <div>📦 <span style="color:#94a3b8;">Entrega (Día 1):</span> <strong style="color:#f8fafc;">${fDia1}</strong></div>
                                    <div>🟢 <span style="color:#94a3b8;">Compromiso (7d):</span> <strong style="color:#6ee7b7;">${fDia7 || '-'}</strong></div>
                                    <div>⏳ <span style="color:#94a3b8;">+3d Gracia (10d):</span> <strong style="color:#7dd3fc;">${fDia10 || '-'}</strong></div>
                                    <div>🎟️ <span style="color:#94a3b8;">Tope Comodín (14d):</span> <strong style="color:#fcd34d;">${fDia14 || '-'}</strong></div>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('');
            }

            // Historial de comodines usados en el año (si existen)
            const comodinesHist = Array.isArray(salvavidasInfo?.comodines_historial) ? salvavidasInfo.comodines_historial : [];
            let comodinesHistHtml = '';
            if (comodinesHist.length > 0) {
                comodinesHistHtml = `
                    <div style="background:rgba(245, 158, 11, 0.12); border:1px solid rgba(245, 158, 11, 0.35); border-radius:0.75rem; padding:0.65rem 0.8rem; margin-top:0.5rem; font-size:0.88rem; color:#fde68a;">
                        <div style="font-weight:800; margin-bottom:0.25rem;">🎟️ Comodines Trimestrales utilizados este año (${comodinesHist.length}/${comodinesMax}):</div>
                        ${comodinesHist.map(ch => `
                            <div style="color:#fef3c7; font-size:0.84rem; margin-top:0.15rem;">• <strong>${ch.comprobante_nombre || 'Comprobante'}</strong> (${ch.estado === 'ACTIVO' ? `En curso · Día ${ch.dias_ciclo}/14` : `Cerrado en ${ch.dias_ciclo}d`})</div>
                        `).join('')}
                    </div>
                `;
            }

            // Datos de Lista de Precios asignada y su Política Comercial
            const listaNombre = politicaInfo?.lista_nombre || (Array.isArray(c.listas_precios) && c.listas_precios[0]?.nombre) || 'Mayorista Asignada';
            const listaId = politicaInfo?.lista_id || (Array.isArray(c.listas_precios) && c.listas_precios[0]?.id) || null;
            const tramos = Array.isArray(politicaInfo?.politica?.tramos) ? politicaInfo.politica.tramos : [];
            const primerTramo = tramos[0] || { monto_minimo: 250000, porcentaje_descuento: 5 };
            const pctDto = Number(primerTramo.porcentaje_descuento || 5).toLocaleString('es-AR', { maximumFractionDigits: 1 });
            const montoMin = this.formatearMonedaMobile(primerTramo.monto_minimo || 250000);

            // Parsear contactos WhatsApp existentes
            let wpContacts = [];
            if (c.whatsapp_facturas) {
                try {
                    const parsed = JSON.parse(c.whatsapp_facturas);
                    if (Array.isArray(parsed)) wpContacts = parsed.filter(w => w && w.numero);
                } catch (e) {
                    if (typeof c.whatsapp_facturas === 'string' && c.whatsapp_facturas.trim()) {
                        wpContacts = c.whatsapp_facturas.split(',').map(n => ({
                            numero: n.trim(),
                            nombre: c.cliente_nombre || 'Titular',
                            cargo: '',
                            enviar_alerta: true,
                            default_resumen: true
                        })).filter(w => w.numero);
                    }
                }
            }

            const wpContactsHtml = wpContacts.length > 0 ? wpContacts.map((w, idx) => {
                const rawDigits = String(w.numero || '').replace(/\D/g, '');
                const clean10 = this.cleanInputForFormatting(rawDigits);
                const prettyPhone = this.formatArgentinePhone(clean10) || w.numero;
                const isChecked = (w.default_resumen !== false && w.enviar_alerta !== false) || idx === 0;
                return `
                    <label style="display:flex; align-items:center; gap:0.65rem; background:#0f172a; border:1px solid #334155; border-radius:0.7rem; padding:0.65rem 0.8rem; cursor:pointer; margin-bottom:0.45rem;">
                        <input type="checkbox" class="cc-mob-wa-chk" value="${rawDigits}" ${isChecked ? 'checked' : ''} style="width:1.3rem; height:1.3rem; accent-color:#10b981; flex-shrink:0;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:0.95rem; font-weight:800; color:#f8fafc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                ${w.nombre || `Contacto #${idx + 1}`} ${w.cargo ? `<span style="font-size:0.76rem; background:rgba(56,189,248,0.15); color:#38bdf8; padding:0.1rem 0.4rem; border-radius:0.3rem; margin-left:0.25rem;">${w.cargo}</span>` : ''}
                            </div>
                            <div style="font-size:0.88rem; color:#34d399; font-weight:700; margin-top:0.1rem;">🇦🇷 +54 9 ${prettyPhone}</div>
                        </div>
                    </label>
                `;
            }).join('') : `
                <div style="font-size:0.9rem; color:#94a3b8; background:#0f172a; border:1px dashed #334155; border-radius:0.7rem; padding:0.75rem; text-align:center; margin-bottom:0.5rem;">
                    No hay números guardados en la ficha. Ingresá el número abajo con máscara automática:
                </div>
            `;

            // Mensaje predeterminado base
            let baseWaMsg = (msgRes && msgRes.success && msgRes.mensajeTexto)
                ? msgRes.mensajeTexto.replace('[SALDO_PLACEHOLDER]', this.formatearMonedaMobile(totalConsolidadoReal))
                : (
                    `Hola *${c.cliente_nombre || 'Cliente'}*, te compartimos el resumen actualizado de tu Cuenta Corriente en *LAMDA*:\n\n` +
                    `💳 *Saldo Total Consolidado: ${this.formatearMonedaMobile(totalConsolidadoReal)}*\n` +
                    (tieneSalvavidasActivo ? `_(Capital comprobantes: ${this.formatearMonedaMobile(saldoContable)} + Salvavidas 3% + IVA: ${this.formatearMonedaMobile(interesTotalConIva)})_\n` : '') +
                    `\n🔗 *Portal de Pedidos y Cuenta Corriente:*\nhttps://portal-lamda-b2b.idadesarrollo.workers.dev/`
                );

            const bloquePolFin = this.construirBloquePoliticaFinanciacionWAMobile(salvavidasInfo);
            const bloquePolLista = this.construirBloquePoliticaListaWAMobile(politicaInfo, c);

            // Construir bloque visual de SERVICIO DE FINANCIACIÓN separado con días entre paréntesis
            let bloqueFinanciacionSeparadoHtml = '';
            if (tieneSalvavidasActivo) {
                bloqueFinanciacionSeparadoHtml = `
                    <div style="background:rgba(239, 68, 68, 0.14); border:1px solid rgba(248, 113, 113, 0.45); border-radius:0.75rem; padding:0.7rem 0.85rem;">
                        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:0.5rem; flex-wrap:wrap;">
                            <div style="font-size:0.88rem; font-weight:900; color:#fca5a5; text-transform:uppercase; letter-spacing:0.02em;">
                                🛡️ Financiación ${diasParentesisTexto ? `<span style="color:#fde047; font-size:0.96rem;">(${diasParentesisTexto})</span>` : '(Activa)'}
                            </div>
                            <div style="font-size:1.5rem; font-weight:900; color:#fbbf24; letter-spacing:-0.02em; line-height:1.15;">
                                + ${this.formatearMonedaMobile(interesTotalConIva)}
                            </div>
                        </div>
                        <div style="font-size:0.86rem; color:#fecaca; font-weight:700; margin-top:0.25rem; line-height:1.3;">
                            Salvavidas 3% mensual (0,1%/día): Neto <strong>${this.formatearMonedaMobile(interesNeto)}</strong> + IVA 21% (<strong>${this.formatearMonedaMobile(interesIva)}</strong>)
                        </div>
                    </div>
                `;
            } else if (tieneSalvavidasSombra) {
                bloqueFinanciacionSeparadoHtml = `
                    <div style="background:rgba(245, 158, 11, 0.12); border:1px dashed rgba(251, 191, 36, 0.55); border-radius:0.75rem; padding:0.7rem 0.85rem;">
                        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:0.5rem; flex-wrap:wrap;">
                            <div style="font-size:0.88rem; font-weight:900; color:#fde68a; text-transform:uppercase; letter-spacing:0.02em;">
                                🌓 Financiación en Sombra ${diasParentesisTexto ? `<span style="color:#fef08a; font-size:0.96rem;">(${diasParentesisTexto})</span>` : ''}
                            </div>
                            <div style="font-size:1.4rem; font-weight:900; color:#fde68a; letter-spacing:-0.02em; line-height:1.15;">
                                + ${this.formatearMonedaMobile(finCalcConIva)}
                            </div>
                        </div>
                        <div style="font-size:0.85rem; color:#fef3c7; font-weight:700; margin-top:0.25rem; line-height:1.3;">
                            Modo Informativo (no suma al exigible hoy) · Neto ${this.formatearMonedaMobile(finCalcNeta)} + IVA ${this.formatearMonedaMobile(finCalcIva)}
                        </div>
                    </div>
                `;
            } else if (modoSwitch === 'EXCLUIDO' && saldoContable > 0) {
                bloqueFinanciacionSeparadoHtml = `
                    <div style="background:rgba(148, 163, 184, 0.1); border:1px solid rgba(148, 163, 184, 0.3); border-radius:0.75rem; padding:0.65rem 0.85rem; display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                        <div style="font-size:0.86rem; font-weight:900; color:#cbd5e1; text-transform:uppercase;">
                            ⚪ Financiación ${diasParentesisTexto ? `(${diasParentesisTexto})` : ''} · Apagada
                        </div>
                        <div style="font-size:1.3rem; font-weight:900; color:#94a3b8;">
                            $ 0,00 (0%)
                        </div>
                    </div>
                `;
            } else {
                bloqueFinanciacionSeparadoHtml = `
                    <div style="background:rgba(16, 185, 129, 0.1); border:1px solid rgba(52, 211, 153, 0.3); border-radius:0.75rem; padding:0.65rem 0.85rem; display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                        <div style="font-size:0.86rem; font-weight:900; color:#6ee7b7; text-transform:uppercase;">
                            🟢 Financiación ${diasParentesisTexto ? `(${diasParentesisTexto})` : '(En plazo)'}
                        </div>
                        <div style="font-size:1.3rem; font-weight:900; color:#34d399;">
                            $ 0,00 (0% int.)
                        </div>
                    </div>
                `;
            }

            const savedZoomScale = Number(localStorage.getItem('lamda_cc_mob_zoom') || 1);

            let overlay = document.getElementById('cc-mobile-fullscreen-overlay');
            const prevScrollTop = overlay ? (overlay.querySelector('#cc-mob-scroll-body')?.scrollTop || 0) : 0;
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'cc-mobile-fullscreen-overlay';
                overlay.style.cssText = 'position:fixed; inset:0; width:100vw; height:100dvh; background:#0f172a; color:#f8fafc; z-index:9500; display:flex; flex-direction:column; overflow:hidden;';
                document.body.appendChild(overlay);
                document.body.style.overflow = 'hidden';

                // Soporte botón Atrás físico de Android
                if (!window.history.state || !window.history.state.ccMobileFullscreen) {
                    try { window.history.pushState({ ccMobileFullscreen: true }, ''); } catch (e) { /* ignore */ }
                }
                if (this._ccPopStateHandler) {
                    window.removeEventListener('popstate', this._ccPopStateHandler);
                }
                this._ccPopStateHandler = () => {
                    this.cerrarDetalleSaldoMobile(true);
                };
                window.addEventListener('popstate', this._ccPopStateHandler);
            }

            overlay.innerHTML = `
                <!-- CABECERA FIJA PANTALLA COMPLETA (SIN ESPACIO VACÍO ARRIBA) -->
                <div style="background:linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border-bottom:1px solid rgba(124, 58, 237, 0.4); padding:0.65rem 0.85rem; flex-shrink:0; display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
                    <div style="display:flex; align-items:center; gap:0.55rem; min-width:0; flex:1;">
                        <button type="button" id="btn-cc-mob-back" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.18); color:#f8fafc; border-radius:0.6rem; padding:0.35rem 0.65rem; font-size:1.1rem; font-weight:900; cursor:pointer; flex-shrink:0; line-height:1;">
                            ‹
                        </button>
                        <div style="min-width:0; flex:1;">
                            <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                                <span style="background:#7c3aed; color:#fff; font-size:0.78rem; font-weight:900; padding:0.15rem 0.5rem; border-radius:0.35rem;">${codigoBunker || 'S/C'}</span>
                                <span style="font-size:1.15rem; font-weight:900; color:#f8fafc; line-height:1.2; word-break:break-word;">${c.cliente_nombre}</span>
                            </div>
                            <div style="font-size:0.8rem; color:#cbd5e1; font-weight:600; margin-top:0.15rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                🏛️ ${c.razon_social || c.cliente_nombre} · 🏷️ ${listaId ? `Lista #${listaId} (${listaNombre})` : listaNombre}
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:0.4rem; flex-shrink:0;">
                        <button type="button" id="btn-cc-mob-zoom-font" title="Agrandar tamaño de letra" style="background:rgba(56, 189, 248, 0.16); border:1px solid rgba(56, 189, 248, 0.45); color:#38bdf8; border-radius:0.55rem; padding:0.4rem 0.6rem; font-size:0.85rem; font-weight:900; cursor:pointer;">
                            🔍 A+
                        </button>
                        <button type="button" id="btn-cc-mob-close" title="Cerrar" style="background:rgba(239, 68, 68, 0.18); border:1px solid rgba(248, 113, 113, 0.45); color:#fca5a5; border-radius:0.55rem; padding:0.4rem 0.7rem; font-size:1rem; font-weight:900; cursor:pointer; line-height:1;">
                            ✕
                        </button>
                    </div>
                </div>

                <!-- CUERPO SCROLLABLE PANTALLA COMPLETA -->
                <div id="cc-mob-scroll-body" style="flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:0.85rem 0.9rem 3.5rem; display:flex; flex-direction:column; gap:0.9rem; zoom:${savedZoomScale};">

                    <!-- 1. TARJETA PRINCIPAL CON CAPITAL Y FINANCIACIÓN SEPARADOS EN LETRA GRANDE -->
                    <div style="background:linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%); border:1.5px solid ${saldoContable > 0 ? 'rgba(248, 113, 113, 0.5)' : 'rgba(52, 211, 153, 0.45)'}; border-radius:1rem; padding:0.95rem; display:flex; flex-direction:column; gap:0.65rem; box-shadow:0 8px 24px rgba(0,0,0,0.35);">

                        <!-- BLOQUE A: CAPITAL DE COMPROBANTES -->
                        <div style="background:rgba(15, 23, 42, 0.85); border:1px solid #334155; border-radius:0.75rem; padding:0.7rem 0.85rem; display:flex; justify-content:space-between; align-items:baseline; gap:0.5rem; flex-wrap:wrap;">
                            <div style="font-size:0.88rem; font-weight:900; color:#cbd5e1; text-transform:uppercase; letter-spacing:0.03em;">
                                📄 Capital (Facturas)
                            </div>
                            <div style="font-size:1.55rem; font-weight:900; color:#f8fafc; letter-spacing:-0.02em; line-height:1.15;">
                                ${this.formatearMonedaMobile(saldoContable)}
                            </div>
                        </div>

                        <!-- BLOQUE B: SERVICIO DE FINANCIACIÓN CON CANTIDAD DE DÍAS ENTRE PARÉNTESIS -->
                        ${bloqueFinanciacionSeparadoHtml}

                        <!-- BLOQUE C: SALDO TOTAL CONSOLIDADO -->
                        <div style="background:${saldoContable > 0 ? 'rgba(239, 68, 68, 0.16)' : 'rgba(16, 185, 129, 0.14)'}; border:1.5px solid ${saldoContable > 0 ? 'rgba(248, 113, 113, 0.55)' : 'rgba(52, 211, 153, 0.45)'}; border-radius:0.8rem; padding:0.8rem 0.9rem;">
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                                <div style="font-size:0.84rem; font-weight:900; text-transform:uppercase; letter-spacing:0.03em; color:${saldoContable > 0 ? '#fecaca' : '#a7f3d0'};">
                                    ${tieneSalvavidasActivo ? '🚨 Total a Pagar (Capital + Financiación c/IVA)' : '💳 Saldo Total Exigible Hoy'}
                                </div>
                                <span style="display:inline-block; background:rgba(245, 158, 11, 0.18); border:1px solid rgba(251, 191, 36, 0.45); color:#fcd34d; font-size:0.8rem; font-weight:800; padding:0.2rem 0.55rem; border-radius:0.45rem;">
                                    🎟️ Comodines: ${comodinesDisp}/${comodinesMax} disp.
                                </span>
                            </div>
                            <div style="font-size:1.95rem; font-weight:900; color:${saldoContable > 0 ? '#f87171' : (saldoContable < 0 ? '#38bdf8' : '#34d399')}; letter-spacing:-0.02em; line-height:1.15; margin-top:0.25rem;">
                                ${this.formatearMonedaMobile(totalConsolidadoReal)}
                            </div>
                            ${tieneSalvavidasSombra ? `
                                <div style="margin-top:0.35rem; padding-top:0.35rem; border-top:1px dashed rgba(251, 191, 36, 0.35); font-size:0.92rem; font-weight:800; color:#fde68a;">
                                    🌓 Total Simulado con Financiación c/IVA: <strong>${this.formatearMonedaMobile(totalSimuladoSombra)}</strong>
                                </div>
                            ` : ''}
                        </div>

                        <!-- SWITCH DE 3 POSICIONES GRANDE Y CÓMODO -->
                        ${codigoBunker ? `
                            <div style="padding:0.65rem 0.75rem; background:rgba(15,23,42,0.85); border:1px solid #334155; border-radius:0.75rem;">
                                <div style="font-size:0.82rem; font-weight:900; color:#cbd5e1; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.45rem;">
                                    🛡️ Programa de Financiación (Switch del Cliente):
                                </div>
                                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; background:#0f172a; border:1px solid #334155; border-radius:0.65rem; padding:3px; gap:4px;">
                                    <button type="button" onclick="ClientesMobileController.cambiarModoFinanciacionMobile('${codigoBunker}', '${c.id}', 'EXCLUIDO')" style="border:none; cursor:pointer; font-family:inherit; font-size:0.88rem; font-weight:900; padding:0.5rem 0.3rem; border-radius:0.5rem; transition:all 0.15s ease; ${modoSwitch === 'EXCLUIDO' ? 'background:#475569; color:#ffffff; box-shadow:0 2px 6px rgba(0,0,0,0.4);' : 'background:transparent; color:#94a3b8;'}">
                                        ⚪ Apagado
                                    </button>
                                    <button type="button" onclick="ClientesMobileController.cambiarModoFinanciacionMobile('${codigoBunker}', '${c.id}', 'SOMBRA')" style="border:none; cursor:pointer; font-family:inherit; font-size:0.88rem; font-weight:900; padding:0.5rem 0.3rem; border-radius:0.5rem; transition:all 0.15s ease; ${modoSwitch === 'SOMBRA' ? 'background:rgba(245,158,11,0.25); border:1px dashed #fbbf24; color:#fde68a;' : 'background:transparent; color:#94a3b8;'}">
                                        🌓 Sombra
                                    </button>
                                    <button type="button" onclick="ClientesMobileController.cambiarModoFinanciacionMobile('${codigoBunker}', '${c.id}', 'ACTIVO')" style="border:none; cursor:pointer; font-family:inherit; font-size:0.88rem; font-weight:900; padding:0.5rem 0.3rem; border-radius:0.5rem; transition:all 0.15s ease; ${modoSwitch === 'ACTIVO' ? 'background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:#ffffff; box-shadow:0 2px 8px rgba(16,185,129,0.45);' : 'background:transparent; color:#94a3b8;'}">
                                        🛡️ Activo
                                    </button>
                                </div>
                            </div>
                        ` : ''}

                        <!-- BADGE DE ETAPA ACTUAL -->
                        <div style="background:${badgeEstadoBg}; border:1px solid ${badgeEstadoBorder}; color:${badgeEstadoColor}; font-size:0.88rem; font-weight:800; padding:0.45rem 0.75rem; border-radius:0.55rem; text-align:center;">
                            ${badgeEstadoTexto}
                        </div>
                    </div>

                    <!-- 2. DESGLOSE DE COMPROBANTES: ¿DE QUÉ ES ESTE SALDO? -->
                    <div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.55rem;">
                            <span style="font-size:0.96rem; font-weight:900; color:#f8fafc; text-transform:uppercase; letter-spacing:0.03em;">
                                🧾 ¿De qué es este saldo? (${capas.length})
                            </span>
                            <span style="font-size:0.8rem; color:#94a3b8; font-weight:700;">Imputación FIFO</span>
                        </div>
                        ${comprobantesHtml}
                        ${comodinesHistHtml}
                    </div>

                    <!-- 3. POLÍTICAS VINCULADAS A LA CUENTA Y LISTA (DESPLEGABLES EN LETRA GRANDE) -->
                    <details style="background:#1e293b; border:1px solid #334155; border-radius:0.85rem; padding:0.8rem 0.9rem;">
                        <summary style="cursor:pointer; font-weight:900; font-size:0.95rem; color:#38bdf8; list-style:none; display:flex; justify-content:space-between; align-items:center;">
                            <span>🛡️ Políticas de Cuenta, 4 Etapas y Lista (${listaNombre})</span>
                            <span style="font-size:0.85rem; color:#cbd5e1;">Ver ▾</span>
                        </summary>
                        <div style="margin-top:0.75rem; display:flex; flex-direction:column; gap:0.65rem; font-size:0.9rem; line-height:1.45; color:#e2e8f0;">
                            <div style="background:#0f172a; border-left:4px solid #10b981; padding:0.65rem 0.75rem; border-radius:0.5rem;">
                                <div style="font-weight:900; color:#f8fafc; margin-bottom:0.35rem; font-size:0.95rem;">⏱️ Esquema de Financiación LAMDA (4 Etapas):</div>
                                <div style="margin-bottom:0.3rem;">🟢 <strong>1. Días 1 a 7 (Compromiso):</strong> Plazo habitual desde la entrega (0% interés, sin usar comodín).</div>
                                <div style="margin-bottom:0.3rem;">⏳ <strong>2. Días 8 a 10 (+3d Gracia Natural):</strong> Tolerancia automática por bancos/fin de semana (0% interés y <strong>NO consume comodín</strong>).</div>
                                <div style="margin-bottom:0.3rem;">🎟️ <strong>3. Días 11 a 14 (Comodín Trimestral):</strong> 1 comodín cada 3 meses (${comodinesMax}/año; hoy tiene <strong>${comodinesDisp}/${comodinesMax} disp.</strong>) hasta el Día 14 con <strong>0% de interés</strong>.</div>
                                <div style="margin-bottom:0.3rem;">🛡️ <strong>4. Día 15+ (Salvavidas 3%):</strong> 3% mensual + IVA (0,1%/día + IVA desde el Día 1 de entrega) sobre el saldo impago, manteniendo la cuenta activa.</div>
                                <div style="color:#a7f3d0; font-weight:700; margin-top:0.3rem;">💸 Pagos Parciales Libres: Puede abonar entregas parciales cuando desee; descuentan de la factura más antigua y reducen el interés diario futuro.</div>
                            </div>

                            <div style="background:#0f172a; border-left:4px solid #c084fc; padding:0.65rem 0.75rem; border-radius:0.5rem;">
                                <div style="font-weight:900; color:#f8fafc; margin-bottom:0.35rem; font-size:0.95rem;">🏷️ Política de su Lista (${listaId ? `Lista #${listaId} - ` : ''}${listaNombre}):</div>
                                <div style="margin-bottom:0.25rem;">• <strong>Precio Mayorista Mantenido:</strong> Conserva su lista sin exigencia de compra mínima mensual.</div>
                                <div style="margin-bottom:0.25rem;">• <strong>Bonificación por Volumen (${pctDto}% OFF):</strong> En compras superiores a <strong>${montoMin}</strong>, requisito excluyente tener la <strong>Cuenta al Día (Saldo $ 0,00)</strong>.</div>
                                <div>• <strong>Ofertas Promocionales:</strong> Exclusivas para cuentas al día (Saldo $ 0,00).</div>
                            </div>

                            <div style="background:#0f172a; border-left:4px solid #38bdf8; padding:0.65rem 0.75rem; border-radius:0.5rem;">
                                <div style="font-weight:900; color:#f8fafc; margin-bottom:0.35rem; font-size:0.95rem;">🏦 Medios de Pago Habilitados:</div>
                                <div style="margin-bottom:0.35rem;">• <strong>Transferencia Galicia:</strong> Alias <code style="color:#38bdf8; font-weight:800;">LAMDA.SER.MARTIN</code> | CBU <code style="color:#38bdf8; font-weight:800;">0070373230004007844141</code></div>
                                <div style="display:flex; gap:0.5rem; margin-bottom:0.4rem;">
                                    <button type="button" id="btn-cc-mob-copy-alias" style="flex:1; background:#334155; color:#f8fafc; border:none; border-radius:0.5rem; padding:0.45rem; font-size:0.85rem; font-weight:800; cursor:pointer;">📋 Copiar Alias</button>
                                    <button type="button" id="btn-cc-mob-copy-cbu" style="flex:1; background:#334155; color:#f8fafc; border:none; border-radius:0.5rem; padding:0.45rem; font-size:0.85rem; font-weight:800; cursor:pointer;">📋 Copiar CBU</button>
                                </div>
                                <div style="margin-bottom:0.2rem;">• <strong>Depósito Efectivo 24hs (Cajeros Galicia):</strong> CTA <code style="color:#fcd34d;">4007844-1 373-4</code></div>
                                <div>• <strong>Efectivo Ensobrado:</strong> Con QR / aviso previo.</div>
                            </div>
                        </div>
                    </details>

                    <!-- 4. PREVISUALIZAR / DESCARGAR PDF Y ENVIAR POR WHATSAPP -->
                    <div style="background:#1e293b; border:1.5px solid rgba(124, 58, 237, 0.45); border-radius:0.95rem; padding:0.9rem;">
                        <div style="font-size:0.95rem; font-weight:900; color:#c084fc; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.6rem;">
                            📄 Informe PDF y Envío al Cliente
                        </div>

                        <!-- Opciones del PDF -->
                        <div style="display:flex; flex-wrap:wrap; gap:0.45rem; margin-bottom:0.7rem;">
                            <label style="display:inline-flex; align-items:center; gap:0.35rem; background:#0f172a; border:1px solid #334155; padding:0.4rem 0.65rem; border-radius:0.5rem; font-size:0.84rem; font-weight:800; color:#e2e8f0; cursor:pointer;">
                                <input type="checkbox" id="cc-mob-chk-balance" checked style="width:1.1rem; height:1.1rem; accent-color:#7c3aed;">
                                ⏳ Detallar 4 Etapas
                            </label>
                            <label style="display:inline-flex; align-items:center; gap:0.35rem; background:#0f172a; border:1px solid #334155; padding:0.4rem 0.65rem; border-radius:0.5rem; font-size:0.84rem; font-weight:800; color:#e2e8f0; cursor:pointer;">
                                <input type="checkbox" id="cc-mob-chk-detallado" checked style="width:1.1rem; height:1.1rem; accent-color:#7c3aed;">
                                📄 Con Ítems de Facturas
                            </label>
                            <label style="display:inline-flex; align-items:center; gap:0.35rem; background:#0f172a; border:1px solid #334155; padding:0.4rem 0.65rem; border-radius:0.5rem; font-size:0.84rem; font-weight:800; color:#e2e8f0; cursor:pointer;">
                                <input type="checkbox" id="cc-mob-chk-ultimo-cero" checked style="width:1.1rem; height:1.1rem; accent-color:#7c3aed;">
                                ✂️ Desde último Saldo $0
                            </label>
                        </div>

                        <!-- Botones para abrir PDF en el teléfono -->
                        <div style="display:flex; gap:0.5rem; margin-bottom:0.85rem;">
                            <button type="button" id="btn-cc-mob-abrir-pdf" style="flex:2; background:#2563eb; color:#ffffff; border:none; border-radius:0.65rem; padding:0.7rem 0.75rem; font-size:0.92rem; font-weight:900; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:0.4rem;">
                                📄 Abrir / Ver PDF Cuenta Cte.
                            </button>
                            <button type="button" id="btn-cc-mob-abrir-pdf-pol" style="flex:1; background:#0284c7; color:#ffffff; border:none; border-radius:0.65rem; padding:0.7rem 0.55rem; font-size:0.86rem; font-weight:900; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:0.3rem;">
                                📘 PDF Políticas
                            </button>
                        </div>

                        <!-- Destinatarios WhatsApp configurados -->
                        <div style="font-size:0.9rem; font-weight:900; color:#10b981; margin-bottom:0.45rem;">
                            📱 Destinatarios de WhatsApp del Cliente:
                        </div>
                        <div id="cc-mob-wa-list">
                            ${wpContactsHtml}
                        </div>

                        <!-- Cargar otro teléfono con máscara argentina -->
                        <div style="background:#0f172a; border:1px solid #334155; border-radius:0.75rem; padding:0.7rem; margin-top:0.5rem;">
                            <label style="display:block; font-size:0.86rem; font-weight:800; color:#cbd5e1; margin-bottom:0.4rem;">
                                ➕ Enviar a otro número (con máscara automática):
                            </label>
                            <div style="display:flex; align-items:center; background:#1e293b; border:1px solid #475569; border-radius:0.6rem; overflow:hidden;">
                                <span style="padding:0.55rem 0.65rem; background:rgba(255,255,255,0.05); color:#34d399; font-weight:800; font-size:0.9rem; border-right:1px solid #334155; white-space:nowrap;">
                                    🇦🇷 +54 9
                                </span>
                                <input type="tel" id="cc-mob-input-nuevo-tel" placeholder="(221) 547-4324" maxlength="16" style="flex:1; background:transparent; border:none; color:#f8fafc; padding:0.55rem 0.7rem; font-size:1rem; font-weight:800; outline:none; min-width:0;">
                            </div>
                            <div style="display:flex; gap:0.4rem; align-items:center; margin-top:0.5rem;">
                                <input type="text" id="cc-mob-input-nuevo-nombre" placeholder="Nombre de contacto (opcional)" style="flex:1; background:#1e293b; border:1px solid #334155; border-radius:0.5rem; color:#f8fafc; padding:0.5rem 0.65rem; font-size:0.88rem; outline:none;">
                            </div>
                            <label style="display:flex; align-items:center; gap:0.45rem; margin-top:0.5rem; font-size:0.84rem; color:#cbd5e1; cursor:pointer;">
                                <input type="checkbox" id="cc-mob-chk-guardar-tel" checked style="width:1.1rem; height:1.1rem; accent-color:#10b981;">
                                <span>💾 Guardar este nuevo número en la ficha del cliente</span>
                            </label>
                        </div>

                        <!-- Checkboxes para anexar explicación de políticas en el texto de WhatsApp -->
                        <div style="margin-top:0.65rem; background:rgba(16, 185, 129, 0.1); border:1px solid rgba(16, 185, 129, 0.3); border-radius:0.7rem; padding:0.65rem 0.75rem;">
                            <div style="font-size:0.84rem; font-weight:900; color:#6ee7b7; margin-bottom:0.4rem;">
                                📝 Incluir en el mensaje escrito de WhatsApp:
                            </div>
                            <label style="display:flex; align-items:center; gap:0.45rem; font-size:0.86rem; color:#e2e8f0; cursor:pointer; margin-bottom:0.35rem;">
                                <input type="checkbox" id="cc-mob-chk-anexo-fin" checked style="width:1.1rem; height:1.1rem; accent-color:#10b981;">
                                <span>🛡️ Explicación de las 4 Etapas y Pagos Parciales</span>
                            </label>
                            <label style="display:flex; align-items:center; gap:0.45rem; font-size:0.86rem; color:#e2e8f0; cursor:pointer;">
                                <input type="checkbox" id="cc-mob-chk-anexo-lista" checked style="width:1.1rem; height:1.1rem; accent-color:#10b981;">
                                <span>🏷️ Política de su Lista (${listaNombre}) y Medios de Pago</span>
                            </label>
                        </div>

                        <!-- Textarea del mensaje -->
                        <div style="margin-top:0.65rem;">
                            <label style="display:block; font-size:0.8rem; font-weight:800; color:#cbd5e1; text-transform:uppercase; margin-bottom:0.3rem;">
                                Mensaje que acompaña al PDF (Editable):
                            </label>
                            <textarea id="cc-mob-wa-textarea" rows="6" style="width:100%; box-sizing:border-box; background:#0f172a; border:1px solid #334155; border-radius:0.65rem; color:#f8fafc; padding:0.65rem; font-size:0.9rem; font-family:inherit; line-height:1.4; resize:vertical;"></textarea>
                        </div>

                        <!-- Botón Principal Enviar PDF por WhatsApp -->
                        <button type="button" id="btn-cc-mob-enviar-wa" style="width:100%; margin-top:0.75rem; background:linear-gradient(135deg, #059669 0%, #10b981 100%); color:#ffffff; border:none; border-radius:0.75rem; padding:0.85rem 1rem; font-size:1.02rem; font-weight:900; cursor:pointer; box-shadow:0 4px 12px rgba(16, 185, 129, 0.35); display:flex; align-items:center; justify-content:center; gap:0.45rem;">
                            📲 Enviar PDF + Detalle por WhatsApp
                        </button>
                        <div id="cc-mob-wa-feedback" style="display:none; margin-top:0.55rem; padding:0.55rem 0.7rem; border-radius:0.55rem; font-size:0.88rem; font-weight:800; text-align:center;"></div>
                    </div>

                </div>
            `;

            const scrollBody = document.getElementById('cc-mob-scroll-body');
            if (scrollBody && prevScrollTop > 0) {
                scrollBody.scrollTop = prevScrollTop;
            }

            // Botones Cerrar / Volver y Zoom de letra
            const btnBack = document.getElementById('btn-cc-mob-back');
            const btnClose = document.getElementById('btn-cc-mob-close');
            const btnZoom = document.getElementById('btn-cc-mob-zoom-font');
            if (btnBack) btnBack.onclick = () => this.cerrarDetalleSaldoMobile();
            if (btnClose) btnClose.onclick = () => this.cerrarDetalleSaldoMobile();
            if (btnZoom && scrollBody) {
                const scales = [1, 1.15, 1.3];
                let currentScale = Number(localStorage.getItem('lamda_cc_mob_zoom') || 1);
                btnZoom.innerText = currentScale > 1.2 ? '🔍 A-' : (currentScale > 1.05 ? '🔍 A++' : '🔍 A+');
                btnZoom.onclick = () => {
                    const idx = scales.findIndex(s => Math.abs(s - currentScale) < 0.05);
                    currentScale = scales[(idx + 1) % scales.length];
                    localStorage.setItem('lamda_cc_mob_zoom', String(currentScale));
                    scrollBody.style.zoom = String(currentScale);
                    btnZoom.innerText = currentScale > 1.2 ? '🔍 A-' : (currentScale > 1.05 ? '🔍 A++' : '🔍 A+');
                };
            }

            // 1. Copiar Alias / CBU
            const btnCopyAlias = document.getElementById('btn-cc-mob-copy-alias');
            if (btnCopyAlias) {
                btnCopyAlias.onclick = () => {
                    navigator.clipboard.writeText('LAMDA.SER.MARTIN');
                    btnCopyAlias.innerText = '✅ Alias Copiado';
                    setTimeout(() => { btnCopyAlias.innerText = '📋 Copiar Alias'; }, 2000);
                };
            }
            const btnCopyCbu = document.getElementById('btn-cc-mob-copy-cbu');
            if (btnCopyCbu) {
                btnCopyCbu.onclick = () => {
                    navigator.clipboard.writeText('0070373230004007844141');
                    btnCopyCbu.innerText = '✅ CBU Copiado';
                    setTimeout(() => { btnCopyCbu.innerText = '📋 Copiar CBU'; }, 2000);
                };
            }

            // 2. Máscara inteligente de entrada para el teléfono nuevo
            const inputNuevoTel = document.getElementById('cc-mob-input-nuevo-tel');
            if (inputNuevoTel) {
                inputNuevoTel.addEventListener('input', (ev) => {
                    const clean = this.cleanInputForFormatting(ev.target.value);
                    ev.target.value = this.formatArgentinePhone(clean);
                });
            }

            // 3. Sincronización del mensaje editable con los checkboxes de políticas
            const textareaWa = document.getElementById('cc-mob-wa-textarea');
            const chkAnexoFin = document.getElementById('cc-mob-chk-anexo-fin');
            const chkAnexoLista = document.getElementById('cc-mob-chk-anexo-lista');

            const recomponerMensajeWa = () => {
                if (!textareaWa) return;
                let msg = baseWaMsg;
                if (chkAnexoFin && chkAnexoFin.checked) {
                    msg += bloquePolFin;
                }
                if (chkAnexoLista && chkAnexoLista.checked) {
                    msg += bloquePolLista;
                }
                textareaWa.value = msg;
            };

            if (chkAnexoFin) chkAnexoFin.addEventListener('change', recomponerMensajeWa);
            if (chkAnexoLista) chkAnexoLista.addEventListener('change', recomponerMensajeWa);
            recomponerMensajeWa();

            // 4. Botones de apertura de PDF
            const buildPdfQuery = () => {
                const detBal = document.getElementById('cc-mob-chk-balance')?.checked !== false;
                const detItems = document.getElementById('cc-mob-chk-detallado')?.checked !== false;
                const ultCero = document.getElementById('cc-mob-chk-ultimo-cero')?.checked !== false;
                const p = new URLSearchParams();
                p.set('inline', '1');
                p.set('detallar_balance', detBal ? 'true' : 'false');
                if (detItems) p.set('detallado', 'true');
                if (ultCero) {
                    p.set('desde_ultimo_cero', 'true');
                    p.set('modo_corte', 'ultimo_cero');
                } else {
                    p.set('modo_corte', 'todo');
                }
                return p.toString();
            };

            const btnAbrirPdf = document.getElementById('btn-cc-mob-abrir-pdf');
            if (btnAbrirPdf) {
                btnAbrirPdf.onclick = () => {
                    if (!ccId) return;
                    window.open(`/api/logistica/bunker/cuentas-corrientes/${ccId}/reporte-pdf?${buildPdfQuery()}`, '_blank');
                };
            }

            const btnAbrirPdfPol = document.getElementById('btn-cc-mob-abrir-pdf-pol');
            if (btnAbrirPdfPol) {
                btnAbrirPdfPol.onclick = () => {
                    if (!ccId) return;
                    window.open(`/api/logistica/bunker/cuentas-corrientes/${ccId}/reporte-pdf?tipo_doc=politicas_financiacion&inline=1`, '_blank');
                };
            }

            // 5. Envío del PDF + Mensaje por WhatsApp
            const btnEnviarWa = document.getElementById('btn-cc-mob-enviar-wa');
            const feedbackEl = document.getElementById('cc-mob-wa-feedback');

            if (btnEnviarWa) {
                btnEnviarWa.onclick = async () => {
                    if (!ccId) return;

                    const checkedNums = Array.from(document.querySelectorAll('.cc-mob-wa-chk:checked'))
                        .map(el => el.value.trim())
                        .filter(Boolean);

                    const rawNuevoTel = (inputNuevoTel?.value || '').trim();
                    const cleanNuevo10 = this.cleanInputForFormatting(rawNuevoTel);
                    let serializedNuevoTel = '';

                    if (rawNuevoTel.length > 0) {
                        if (cleanNuevo10.length < 10) {
                            if (feedbackEl) {
                                feedbackEl.style.display = 'block';
                                feedbackEl.style.background = 'rgba(239, 68, 68, 0.2)';
                                feedbackEl.style.color = '#fca5a5';
                                feedbackEl.innerText = '⚠️ El número nuevo debe tener 10 dígitos (código de área + número, ej: 221 547-4324).';
                            }
                            inputNuevoTel.focus();
                            return;
                        }
                        serializedNuevoTel = `549${cleanNuevo10}`;
                        if (!checkedNums.includes(serializedNuevoTel)) {
                            checkedNums.push(serializedNuevoTel);
                        }
                    }

                    if (checkedNums.length === 0) {
                        if (feedbackEl) {
                            feedbackEl.style.display = 'block';
                            feedbackEl.style.background = 'rgba(245, 158, 11, 0.2)';
                            feedbackEl.style.color = '#fcd34d';
                            feedbackEl.innerText = '⚠️ Seleccioná al menos un contacto o ingresá un número de WhatsApp.';
                        }
                        return;
                    }

                    const detBal = document.getElementById('cc-mob-chk-balance')?.checked !== false;
                    const detItems = document.getElementById('cc-mob-chk-detallado')?.checked !== false;
                    const ultCero = document.getElementById('cc-mob-chk-ultimo-cero')?.checked !== false;
                    const guardarNuevo = document.getElementById('cc-mob-chk-guardar-tel')?.checked !== false;
                    const nuevoNombre = (document.getElementById('cc-mob-input-nuevo-nombre')?.value || '').trim();
                    const mensajeFinal = (textareaWa?.value || '').trim();

                    btnEnviarWa.disabled = true;
                    const originalBtnHtml = btnEnviarWa.innerHTML;
                    btnEnviarWa.innerHTML = '⏳ Generando PDF y enviando por WhatsApp...';
                    if (feedbackEl) feedbackEl.style.display = 'none';

                    try {
                        // Si ingresó un número nuevo y marcó guardarlo en la ficha del cliente
                        if (serializedNuevoTel && guardarNuevo && c.id) {
                            const yaExiste = wpContacts.some(w => String(w.numero || '').replace(/\D/g, '') === serializedNuevoTel);
                            if (!yaExiste) {
                                const nuevaListaWa = [
                                    ...wpContacts,
                                    {
                                        id: `wa_${Date.now()}`,
                                        numero: serializedNuevoTel,
                                        nombre: nuevoNombre || c.cliente_nombre || 'Contacto Móvil',
                                        cargo: 'WhatsApp',
                                        enviar_alerta: true,
                                        default_resumen: true
                                    }
                                ];
                                const jsonWa = JSON.stringify(nuevaListaWa);
                                await fetch(`/api/logistica/bunker/clientes/${c.id}/whatsapp-contacts`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ whatsapp_facturas: jsonWa })
                                });
                                c.whatsapp_facturas = jsonWa;
                                wpContacts = nuevaListaWa;
                            }
                        }

                        const qParams = new URLSearchParams();
                        if (detItems) qParams.set('detallado', 'true');
                        if (ultCero) qParams.set('desde_ultimo_cero', 'true');
                        qParams.set('modo_corte', ultCero ? 'ultimo_cero' : 'todo');
                        qParams.set('detallar_balance', detBal ? 'true' : 'false');

                        const resEnvio = await fetch(`/api/logistica/bunker/cuentas-corrientes/${ccId}/whatsapp?${qParams.toString()}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                destinatarios: checkedNums.join(', '),
                                mensajeTexto: mensajeFinal,
                                detallado: detItems ? 'true' : 'false',
                                desde_ultimo_cero: ultCero,
                                modo_corte: ultCero ? 'ultimo_cero' : 'todo',
                                detallar_balance: detBal
                            })
                        });
                        const dataEnvio = await resEnvio.json();
                        if (!resEnvio.ok || !dataEnvio.success) {
                            throw new Error(dataEnvio.message || dataEnvio.error || 'No se pudo despachar el WhatsApp.');
                        }

                        if (feedbackEl) {
                            feedbackEl.style.display = 'block';
                            feedbackEl.style.background = 'rgba(16, 185, 129, 0.2)';
                            feedbackEl.style.color = '#6ee7b7';
                            feedbackEl.innerText = `✅ Informe PDF y detalle enviado con éxito a: ${checkedNums.join(', ')}`;
                        }
                        btnEnviarWa.innerHTML = '✅ ¡Enviado por WhatsApp!';
                        setTimeout(() => {
                            btnEnviarWa.disabled = false;
                            btnEnviarWa.innerHTML = originalBtnHtml;
                        }, 3000);
                    } catch (errEnv) {
                        console.error('Error enviando resumen C/C desde móvil:', errEnv);
                        if (feedbackEl) {
                            feedbackEl.style.display = 'block';
                            feedbackEl.style.background = 'rgba(239, 68, 68, 0.2)';
                            feedbackEl.style.color = '#fca5a5';
                            feedbackEl.innerText = `❌ Error: ${errEnv.message || 'No se pudo enviar por WhatsApp.'}`;
                        }
                        btnEnviarWa.disabled = false;
                        btnEnviarWa.innerHTML = originalBtnHtml;
                    }
                };
            }

        } catch (err) {
            console.error('Error abriendo detalle de saldo móvil:', err);
            Swal.fire({
                icon: 'error',
                title: 'Error al consultar Cuenta Corriente',
                text: err.message || 'No se pudo obtener el detalle del saldo.',
                background: '#1e293b',
                color: '#f8fafc',
                confirmButtonColor: '#7c3aed'
            });
        }
    },


    async generarEnsobradoEfectivo(clienteId) {
        const c = this.clientes.find(x => x.id == clienteId);
        if (!c) return;

        const saldoNum = parseFloat(c.saldo || 0);
        const defaultMonto = saldoNum > 0 ? saldoNum : '';
        
        let defaultTel = '';
        if (c.whatsapp_facturas) {
            try {
                const parsed = JSON.parse(c.whatsapp_facturas);
                if (Array.isArray(parsed) && parsed.length > 0) defaultTel = parsed[0].numero;
            } catch(e) {
                defaultTel = c.whatsapp_facturas;
            }
        }

        let defaultEmail = '';
        if (c.email_facturas) {
            try {
                const parsed = JSON.parse(c.email_facturas);
                if (Array.isArray(parsed) && parsed.length > 0) defaultEmail = parsed[0].email;
            } catch(e) {
                defaultEmail = c.email_facturas;
            }
        }

        const formattedSaldo = `$ ${Math.abs(saldoNum).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const { value: formValues } = await Swal.fire({
            title: `<div style="color:#f8fafc; font-size:1.15rem; font-weight:800;">📦 Generar Ensobrado de Efectivo</div>`,
            background: '#1e293b',
            color: '#f8fafc',
            html: `
                <div style="text-align:left; font-size:0.85rem; color:#cbd5e1; margin-bottom:0.75rem;">
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#0f172a; padding:0.6rem 0.85rem; border-radius:0.65rem; border:1px solid rgba(255,255,255,0.08); margin-bottom:0.75rem;">
                        <div>
                            <div style="font-weight:800; color:#f8fafc; font-size:0.92rem;">${c.cliente_nombre}</div>
                            <div style="font-size:0.72rem; color:#94a3b8;">Cód: ${c.codigo_bunker_cliente || 'S/C'}</div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:0.62rem; color:#94a3b8; font-weight:800; text-transform:uppercase;">Saldo C/C</div>
                            <div style="font-size:0.95rem; font-weight:900; color:${saldoNum > 0 ? '#f87171' : (saldoNum < 0 ? '#38bdf8' : '#34d399')};">
                                ${saldoNum < 0 ? '-' : ''}${formattedSaldo}
                            </div>
                        </div>
                    </div>

                    <label style="display:block; font-size:0.75rem; font-weight:700; color:#cbd5e1; margin-bottom:0.25rem;">
                        💵 Monto a Solicitar / Ensobrar ($) <span style="color:#ef4444;">*</span>
                    </label>
                    <input type="number" id="swal-monto-ensobrado" class="wizard-input-mobile" placeholder="Ej: 50000" value="${defaultMonto}" style="width:100%; margin-bottom:0.65rem; box-sizing:border-box;">

                    <label style="display:block; font-size:0.75rem; font-weight:700; color:#cbd5e1; margin-bottom:0.25rem;">
                        👤 Nombre Contacto / Encargado (Opcional)
                    </label>
                    <input type="text" id="swal-nombre-colab" class="wizard-input-mobile" placeholder="Nombre o titular del comercio" value="${c.cliente_nombre || ''}" style="width:100%; margin-bottom:0.65rem; box-sizing:border-box;">

                    <label style="display:block; font-size:0.75rem; font-weight:700; color:#cbd5e1; margin-bottom:0.25rem;">
                        💬 WhatsApp de Destino (Opcional)
                    </label>
                    <input type="tel" id="swal-tel-colab" class="wizard-input-mobile" placeholder="Ej: 5492216615746" value="${defaultTel}" style="width:100%; margin-bottom:0.65rem; box-sizing:border-box;">

                    <label style="display:block; font-size:0.75rem; font-weight:700; color:#cbd5e1; margin-bottom:0.25rem;">
                        📝 Concepto / Observaciones (Opcional)
                    </label>
                    <input type="text" id="swal-obs-ensobrado" class="wizard-input-mobile" placeholder="Ej: Pago de saldo / Factura" style="width:100%; box-sizing:border-box;">
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '⚡ Generar Enlace & QR',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#0d9488',
            cancelButtonColor: '#64748b',
            focusConfirm: false,
            preConfirm: () => {
                const monto = parseFloat(document.getElementById('swal-monto-ensobrado').value);
                if (!monto || monto <= 0) {
                    Swal.showValidationMessage('Por favor ingresá un monto válido mayor a $0.');
                    return false;
                }
                return {
                    monto: monto,
                    nombre: document.getElementById('swal-nombre-colab').value.trim(),
                    tel: document.getElementById('swal-tel-colab').value.trim(),
                    obs: document.getElementById('swal-obs-ensobrado').value.trim()
                };
            }
        });

        if (!formValues) return;

        try {
            Swal.fire({
                title: 'Generando Sobre & QR...',
                background: '#1e293b',
                color: '#f8fafc',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            const res = await fetch('/api/logistica/pagos-efectivo/crear-sobre-derivado', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cliente_id: c.codigo_bunker_cliente || c.id,
                    monto_declarado: formValues.monto,
                    colaborador_nombre: formValues.nombre,
                    colaborador_telefono: formValues.tel,
                    observaciones: formValues.obs,
                    derivado_por: 'Chofer / Móvil LAMDA'
                })
            });

            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Error al generar sobre de ensobrado.');
            }

            const urlEnsobrado = data.url_ensobrado;
            const codigoSobre = data.codigo_sobre;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(urlEnsobrado)}`;
            const montoFormateado = formValues.monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            const mensajeWA = 
                `📦 *SOLICITUD DE ENSOBRADO DE EFECTIVO - LAMDA*\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🏢 *Cliente:* ${c.cliente_nombre}\n` +
                `💵 *Monto Solicitado:* $ ${montoFormateado}\n` +
                `🏷️ *Código de Sobre:* ${codigoSobre}\n\n` +
                `👉 Para cargar el conteo de billetes y fotos del sobre sellado, ingresá acá:\n` +
                `${urlEnsobrado}\n\n` +
                `_Al completar el formulario, el sobre queda registrado para su retiro._`;

            const linkWA = `https://wa.me/${formValues.tel ? formValues.tel.replace(/\D/g, '') : ''}?text=${encodeURIComponent(mensajeWA)}`;

            Swal.fire({
                title: `<div style="color:#34d399; font-size:1.15rem; font-weight:900;">📦 Sobre Generado: ${codigoSobre}</div>`,
                background: '#1e293b',
                color: '#f8fafc',
                html: `
                    <div style="text-align:center;">
                        <div style="font-size:0.85rem; color:#94a3b8; margin-bottom:0.75rem;">
                            Cliente: <strong style="color:#f8fafc;">${c.cliente_nombre}</strong> • Monto: <strong style="color:#34d399;">$ ${montoFormateado}</strong>
                        </div>

                        <!-- Código QR Escaneable -->
                        <div style="display:inline-block; background:#ffffff; padding:0.65rem; border-radius:0.85rem; box-shadow:0 4px 15px rgba(0,0,0,0.3); margin-bottom:0.6rem;">
                            <img src="${qrUrl}" alt="QR Ensobrado" style="width:190px; height:190px; display:block;" />
                        </div>

                        <div style="font-size:0.72rem; color:#cbd5e1; margin-bottom:0.9rem;">
                            📱 Escaneá el código QR en pantalla o compartí el enlace directo:
                        </div>

                        <!-- Acciones de Compartir -->
                        <div style="display:flex; flex-direction:column; gap:0.5rem; text-align:left;">
                            <a href="${linkWA}" target="_blank" class="btn-modal-link" style="background:#059669; color:white; padding:0.65rem 1rem; border-radius:0.75rem; font-weight:700; text-decoration:none; display:flex; align-items:center; justify-content:center; gap:0.5rem;">
                                💬 Enviar Solicitud por WhatsApp
                            </a>

                            <div style="display:flex; gap:0.4rem;">
                                <button type="button" id="btn-copy-ensobrado-link" class="btn-modal-link" style="flex:1; background:#334155; color:#f8fafc; padding:0.55rem 0.75rem; border-radius:0.65rem; font-weight:700; border:none; cursor:pointer; font-size:0.8rem; display:flex; align-items:center; justify-content:center; gap:0.35rem;">
                                    📋 Copiar Enlace
                                </button>
                                <a href="${urlEnsobrado}" target="_blank" class="btn-modal-link" style="flex:1; background:#1e293b; border:1px solid #475569; color:#cbd5e1; padding:0.55rem 0.75rem; border-radius:0.65rem; font-weight:700; text-decoration:none; font-size:0.8rem; display:flex; align-items:center; justify-content:center; gap:0.35rem;">
                                    🌐 Abrir Enlace
                                </a>
                            </div>
                        </div>
                    </div>
                `,
                showConfirmButton: true,
                confirmButtonText: 'Listo',
                confirmButtonColor: '#0d9488',
                didOpen: () => {
                    const btnCopy = document.getElementById('btn-copy-ensobrado-link');
                    if (btnCopy) {
                        btnCopy.onclick = () => {
                            navigator.clipboard.writeText(urlEnsobrado);
                            btnCopy.innerText = '✅ ¡Enlace Copiado!';
                            btnCopy.style.background = '#059669';
                            setTimeout(() => {
                                btnCopy.innerText = '📋 Copiar Enlace';
                                btnCopy.style.background = '#334155';
                            }, 2500);
                        };
                    }
                }
            });

        } catch (err) {
            console.error('Error generando ensobrado:', err);
            Swal.fire('Error', err.message, 'error');
        }
    },

    async abrirModalListasBunker(clienteId) {
        const c = this.clientes.find(x => x.id == clienteId);
        if (!c) return;

        try {
            const res = await fetch('/api/logistica/bunker/listas');
            const data = await res.json();
            const listas = (data.success && Array.isArray(data.data)) ? data.data : [
                { id: 1, nombre: 'Lista Nico' },
                { id: 2, nombre: 'Berisso' },
                { id: 3, nombre: 'Matias' },
                { id: 5, nombre: 'Dietetica' },
                { id: 6, nombre: 'Consumidor Final' },
                { id: 7, nombre: 'Gastronomicos' }
            ];

            const listasAsignadas = (c.listas_precios || []).map(lp => lp.id);

            const optionsHtml = listas.map(l => {
                const isChecked = listasAsignadas.includes(l.id);
                return `
                    <label style="display:flex; align-items:center; gap:0.75rem; padding:0.65rem 0.75rem; background:#0f172a; border:1px solid ${isChecked ? '#7c3aed' : '#334155'}; border-radius:0.65rem; margin-bottom:0.45rem; cursor:pointer; transition:all 0.2s;">
                        <input type="checkbox" name="lista-bunker-chk" value="${l.id}" ${isChecked ? 'checked' : ''} style="width:1.25rem; height:1.25rem; accent-color:#7c3aed;">
                        <div style="flex:1;">
                            <span style="font-weight:800; color:#f8fafc; font-size:0.92rem; display:block;">${l.nombre}</span>
                            <span style="font-size:0.7rem; color:#94a3b8;">Lista Comercial #${l.id}</span>
                        </div>
                    </label>
                `;
            }).join('');

            const { value: confirmed } = await Swal.fire({
                title: `<div style="color:#c084fc; font-weight:900; font-size:1.15rem;">🏷️ Asignar Lista Búnker</div>`,
                html: `
                    <div style="text-align:left; font-size:0.85rem; color:#cbd5e1; margin-bottom:0.75rem;">
                        Seleccioná las listas de precios aplicables a <strong style="color:#f8fafc;">${c.cliente_nombre}</strong>:
                    </div>
                    <div style="text-align:left; max-height:280px; overflow-y:auto; padding-right:2px;">${optionsHtml}</div>
                `,
                background: '#1e293b',
                color: '#f8fafc',
                showCancelButton: true,
                confirmButtonText: 'Guardar Listas',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: '#7c3aed',
                cancelButtonColor: '#475569',
                preConfirm: () => {
                    const checkboxes = document.querySelectorAll('input[name="lista-bunker-chk"]:checked');
                    return Array.from(checkboxes).map(chk => parseInt(chk.value, 10));
                }
            });

            if (confirmed) {
                const putRes = await fetch(`/api/logistica/bunker/clientes/${clienteId}/listas`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ listaIds: confirmed })
                });
                const putData = await putRes.json();
                if (putData.success) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Listas actualizadas',
                        background: '#1e293b',
                        color: '#f8fafc',
                        timer: 1500,
                        showConfirmButton: false
                    });
                    await this.cargarClientes();
                } else {
                    throw new Error(putData.error);
                }
            }
        } catch (e) {
            console.error('Error configurando listas:', e);
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: e.message || 'No se pudieron asignar las listas.',
                background: '#1e293b',
                color: '#f8fafc'
            });
        }
    },

    async invitarPortalB2B(clienteId) {
        const c = this.clientes.find(x => x.id == clienteId);
        if (!c) {
            Swal.fire('Error', 'Cliente no encontrado.', 'error');
            return;
        }

        const nombre = c.cliente_nombre || c.razon_social || 'Cliente';

        // Obtener contactos WhatsApp
        let wpContacts = [];
        if (c.whatsapp_facturas) {
            try {
                const parsed = JSON.parse(c.whatsapp_facturas);
                if (Array.isArray(parsed)) wpContacts = parsed.filter(w => w.numero);
                else if (typeof c.whatsapp_facturas === 'string' && c.whatsapp_facturas.trim()) {
                    wpContacts = [{ numero: c.whatsapp_facturas.trim(), nombre: nombre, cargo: 'Titular' }];
                }
            } catch (e) {
                if (typeof c.whatsapp_facturas === 'string' && c.whatsapp_facturas.trim()) {
                    wpContacts = [{ numero: c.whatsapp_facturas.trim(), nombre: nombre, cargo: 'Titular' }];
                }
            }
        }

        // Obtener contactos Email
        let emailContacts = [];
        if (c.email_portal) {
            emailContacts.push({ email: c.email_portal.trim(), nombre: c.email_portal_nombre || nombre, cargo: c.email_portal_cargo || 'Portal B2B' });
        }
        if (c.email_facturas) {
            try {
                const parsed = JSON.parse(c.email_facturas);
                if (Array.isArray(parsed)) {
                    parsed.forEach(e => {
                        if (e.email && !emailContacts.some(x => x.email.toLowerCase() === e.email.trim().toLowerCase())) {
                            emailContacts.push(e);
                        }
                    });
                } else if (typeof c.email_facturas === 'string' && c.email_facturas.trim()) {
                    if (!emailContacts.some(x => x.email.toLowerCase() === c.email_facturas.trim().toLowerCase())) {
                        emailContacts.push({ email: c.email_facturas.trim(), nombre: nombre, cargo: 'Facturación' });
                    }
                }
            } catch (e) {
                if (typeof c.email_facturas === 'string' && c.email_facturas.trim()) {
                    if (!emailContacts.some(x => x.email.toLowerCase() === c.email_facturas.trim().toLowerCase())) {
                        emailContacts.push({ email: c.email_facturas.trim(), nombre: nombre, cargo: 'Facturación' });
                    }
                }
            }
        }

        const hasWp = wpContacts.length > 0;
        const hasEmail = emailContacts.length > 0;
        const defaultCanal = hasWp ? 'whatsapp' : (hasEmail ? 'email' : 'whatsapp');

        const modalHtml = `
            <div style="text-align:left; font-size:0.88rem; color:#cbd5e1; display:flex; flex-direction:column; gap:0.75rem;">
                <div>
                    <label style="font-weight:800; color:#f8fafc; font-size:0.82rem; display:block; margin-bottom:0.4rem;">1. Canal de Envío:</label>
                    <div style="display:flex; gap:1.2rem; background:#0f172a; padding:0.6rem 0.8rem; border-radius:0.75rem; border:1px solid rgba(255,255,255,0.08);">
                        <label style="cursor:pointer; display:flex; align-items:center; gap:0.4rem; font-weight:700; color:#f8fafc; font-size:0.88rem;">
                            <input type="radio" name="canal-invite-mobile" value="whatsapp" ${defaultCanal === 'whatsapp' ? 'checked' : ''} style="accent-color:#7c3aed; width:17px; height:17px;">
                            <span>📱 WhatsApp</span>
                        </label>
                        <label style="cursor:pointer; display:flex; align-items:center; gap:0.4rem; font-weight:700; color:#f8fafc; font-size:0.88rem;">
                            <input type="radio" name="canal-invite-mobile" value="email" ${defaultCanal === 'email' ? 'checked' : ''} style="accent-color:#7c3aed; width:17px; height:17px;">
                            <span>✉️ Email / Correo</span>
                        </label>
                    </div>
                </div>

                <div>
                    <label style="font-weight:800; color:#f8fafc; font-size:0.82rem; display:block; margin-bottom:0.35rem;">2. Destinatario:</label>
                    <select id="select-destinatario-mobile" class="wizard-input-mobile" style="font-size:0.88rem;"></select>
                    <input type="text" id="input-destinatario-manual-mobile" class="wizard-input-mobile" placeholder="Ingresar destino manual..." style="display:none; margin-top:0.4rem; font-size:0.85rem;">
                </div>

                <div>
                    <label style="font-weight:800; color:#f8fafc; font-size:0.82rem; display:block; margin-bottom:0.35rem;">3. Mensaje:</label>
                    <textarea id="textarea-mensaje-mobile" class="wizard-input-mobile" style="height:70px; font-size:0.82rem; line-height:1.35; resize:none;"></textarea>
                    <small style="color:#94a3b8; font-size:0.72rem; display:block; margin-top:0.25rem;">
                        * <code>[Codigo_Activacion]</code> y <code>[Enlace_Al_Portal]</code> se generarán automáticamente.
                    </small>
                </div>
            </div>
        `;

        const result = await Swal.fire({
            title: `<span style="color:#7c3aed; font-size:1.15rem; font-weight:800;">Invitar al Portal B2B</span>`,
            html: modalHtml,
            background: '#1e293b',
            color: '#f8fafc',
            showCancelButton: true,
            confirmButtonText: '🚀 Enviar Invitación',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#7c3aed',
            cancelButtonColor: '#475569',
            didOpen: () => {
                const selectEl = document.getElementById('select-destinatario-mobile');
                const manualInput = document.getElementById('input-destinatario-manual-mobile');
                const radios = document.getElementsByName('canal-invite-mobile');
                const textareaEl = document.getElementById('textarea-mensaje-mobile');

                const getContactName = () => {
                    if (selectEl.value === '__manual__') return nombre;
                    const opt = selectEl.options[selectEl.selectedIndex];
                    if (!opt) return nombre;
                    const match = opt.text.match(/\(([^)]+)\)/);
                    if (match) {
                        return match[1].split(' - ')[0].trim();
                    }
                    return nombre;
                };

                const updateMessageText = () => {
                    const cName = getContactName();
                    textareaEl.value = `Hola ${cName}, te paso el link del portal para que te loguees. Tu código de activación es: [Codigo_Activacion]. Entrá acá: [Enlace_Al_Portal]`;
                };

                const updateSelect = (canal) => {
                    selectEl.innerHTML = '';
                    if (canal === 'whatsapp') {
                        if (wpContacts.length > 0) {
                            wpContacts.forEach(w => {
                                const opt = document.createElement('option');
                                opt.value = w.numero;
                                opt.text = `[WhatsApp] ${w.numero} ${w.nombre ? `(${w.nombre}${w.cargo ? ` - ${w.cargo}` : ''})` : ''}`;
                                selectEl.appendChild(opt);
                            });
                        }
                        const optManual = document.createElement('option');
                        optManual.value = '__manual__';
                        optManual.text = '➕ Ingresar otro número...';
                        selectEl.appendChild(optManual);
                    } else {
                        if (emailContacts.length > 0) {
                            emailContacts.forEach(m => {
                                const opt = document.createElement('option');
                                opt.value = m.email;
                                opt.text = `[Email] ${m.email} ${m.nombre ? `(${m.nombre}${m.cargo ? ` - ${m.cargo}` : ''})` : ''}`;
                                selectEl.appendChild(opt);
                            });
                        }
                        const optManual = document.createElement('option');
                        optManual.value = '__manual__';
                        optManual.text = '➕ Ingresar otro correo...';
                        selectEl.appendChild(optManual);
                    }

                    manualInput.style.display = (selectEl.value === '__manual__') ? 'block' : 'none';
                    manualInput.placeholder = (canal === 'whatsapp') ? 'Número de WhatsApp (ej: 2215474324)' : 'Correo electrónico (ej: cliente@gmail.com)';
                    updateMessageText();
                };

                radios.forEach(radio => {
                    radio.addEventListener('change', (e) => {
                        updateSelect(e.target.value);
                    });
                });

                selectEl.addEventListener('change', () => {
                    manualInput.style.display = (selectEl.value === '__manual__') ? 'block' : 'none';
                    if (selectEl.value === '__manual__') manualInput.focus();
                    updateMessageText();
                });

                updateSelect(defaultCanal);
            },
            preConfirm: () => {
                const checkedRadio = document.querySelector('input[name="canal-invite-mobile"]:checked');
                const canal = checkedRadio ? checkedRadio.value : 'whatsapp';
                const selectVal = document.getElementById('select-destinatario-mobile')?.value || '';
                const manualVal = (document.getElementById('input-destinatario-manual-mobile')?.value || '').trim();
                const mensajeTexto = (document.getElementById('textarea-mensaje-mobile')?.value || '').trim();

                const destinoFinal = (selectVal === '__manual__') ? manualVal : selectVal;

                if (!destinoFinal) {
                    Swal.showValidationMessage('Debe seleccionar o ingresar un destinatario válido.');
                    return false;
                }

                if (!mensajeTexto) {
                    Swal.showValidationMessage('El mensaje no puede estar vacío.');
                    return false;
                }

                return {
                    cliente_id: c.codigo_bunker_cliente || c.lomas_soft_id || String(c.id),
                    canal,
                    destino: destinoFinal,
                    mensajeTexto
                };
            }
        });

        if (result.isConfirmed && result.value) {
            Swal.fire({
                title: 'Enviando Invitación...',
                html: 'Generando acceso y procesando envío...',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            try {
                const res = await fetch('/api/logistica/b2b-onboarding/invitar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(result.value)
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    throw new Error(data.message || data.error || 'Error al procesar la invitación.');
                }

                const inviteData = data.data || {};
                const token = inviteData.token || inviteData.codigoActivacion || '';
                const link = inviteData.link || inviteData.url || inviteData.enlace || '';
                const destinoNum = (result.value.canal === 'whatsapp') ? result.value.destino.replace(/\D/g, '') : '';
                const textoMensaje = (inviteData.mensaje || result.value.mensajeTexto || '')
                    .replace(/\[Codigo_Activacion\]/g, token ? token.substring(0, 6) : '')
                    .replace(/\[Enlace_Al_Portal\]/g, link);

                let successHtml = `
                    <div style="text-align:left; font-size:0.88rem; color:#cbd5e1;">
                        <p style="color:#34d399; font-weight:800; font-size:0.95rem; margin-top:0;">✅ Invitación generada exitosamente</p>
                        ${token ? `<p style="margin:0.35rem 0;"><b>Código de activación:</b> <span class="badge-code-purple" style="font-size:0.85rem;">${token.substring(0, 6)}</span></p>` : ''}
                        <p style="margin:0.35rem 0;"><b>Destinatario:</b> ${result.value.destino} (${result.value.canal.toUpperCase()})</p>
                        ${result.value.canal === 'whatsapp' && destinoNum ? `
                            <div style="margin-top:0.85rem;">
                                <a href="https://wa.me/${destinoNum}?text=${encodeURIComponent(textoMensaje)}" target="_blank" class="btn-modal-link" style="background:#059669; color:white;">
                                    💬 Abrir WhatsApp con el Cliente
                                </a>
                            </div>
                        ` : `
                            <p style="color:#60a5fa; font-size:0.8rem; margin-top:0.5rem;">📨 Correo electrónico despachado correctamente.</p>
                        `}
                    </div>
                `;

                Swal.fire({
                    title: '¡Invitación Lista!',
                    html: successHtml,
                    background: '#1e293b',
                    color: '#f8fafc',
                    showConfirmButton: true,
                    confirmButtonText: 'Listo',
                    confirmButtonColor: '#7c3aed'
                });

            } catch (err) {
                console.error('Error enviando invitación:', err);
                Swal.fire('Error', err.message || 'No se pudo generar la invitación.', 'error');
            }
        }
    },

    // =========================================================
    // 11. BINDING DE EVENTOS
    // =========================================================
    bindDirectorioEvents() {
        const inputSearch = document.getElementById('buscar-cliente-mobile-input');
        if (inputSearch) {
            inputSearch.addEventListener('input', (e) => {
                this.busquedaQuery = e.target.value;
                const btnClear = document.getElementById('btn-clear-search');
                if (btnClear) btnClear.style.display = this.busquedaQuery.length > 0 ? 'inline-block' : 'none';
                this.filtrarClientesDirectorio();
            });
        }

        const btnClear = document.getElementById('btn-clear-search');
        if (btnClear) {
            btnClear.addEventListener('click', () => {
                if (inputSearch) {
                    inputSearch.value = '';
                    inputSearch.focus();
                }
                btnClear.style.display = 'none';
                this.busquedaQuery = '';
                this.filtrarClientesDirectorio();
            });
        }

        const btnFiltroDeuda = document.getElementById('btn-toggle-filtro-deuda');
        if (btnFiltroDeuda) {
            btnFiltroDeuda.addEventListener('click', () => {
                this.filtroSoloDeudores = !this.filtroSoloDeudores;
                btnFiltroDeuda.classList.toggle('active', this.filtroSoloDeudores);
                this.filtrarClientesDirectorio();
            });
        }
    },

    bindFormularioEvents() {
        const txtCuit = document.getElementById('txt-cuit');
        if (txtCuit) {
            txtCuit.addEventListener('input', () => this.validarYMostrarCuit());
            txtCuit.addEventListener('blur', () => this.validarYMostrarCuit());
        }

        const btnArca = document.getElementById('btn-consultar-arca');
        if (btnArca) {
            btnArca.addEventListener('click', () => this.consultarArca());
        }

        const btnAddWa = document.getElementById('btn-add-whatsapp-mobile');
        if (btnAddWa) {
            btnAddWa.addEventListener('click', () => this.agregarContactoWhatsapp());
        }

        const btnAddMail = document.getElementById('btn-add-email-mobile');
        if (btnAddMail) {
            btnAddMail.addEventListener('click', () => this.agregarContactoEmail());
        }

        const btnAddDom = document.getElementById('btn-add-domicilio-mobile');
        if (btnAddDom) {
            btnAddDom.addEventListener('click', () => this.abrirModalDomicilio());
        }

        // Auto composición de dirección en modal de domicilio
        ['modal-dom-calle', 'modal-dom-num', 'modal-dom-entre'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.componerDireccionModal());
        });

        const btnBuscarMap = document.getElementById('btn-buscar-mapa-dom');
        if (btnBuscarMap) {
            btnBuscarMap.addEventListener('click', () => this.geocodificarDireccionEnMapa());
        }

        const btnGps = document.getElementById('btn-capturar-gps');
        if (btnGps) {
            btnGps.addEventListener('click', () => this.capturarUbicacionGpsActual());
        }

        const btnGuardarDom = document.getElementById('btn-guardar-dom-modal');
        if (btnGuardarDom) {
            btnGuardarDom.addEventListener('click', () => this.guardarDomicilioModal());
        }

        const btnCerrarDom = document.getElementById('btn-cerrar-dom-modal');
        if (btnCerrarDom) {
            btnCerrarDom.addEventListener('click', () => this.cerrarModalDomicilio());
        }

        const btnGuardarCliente = document.getElementById('btn-guardar-cliente-mobile');
        if (btnGuardarCliente) {
            btnGuardarCliente.addEventListener('click', (e) => {
                e.preventDefault();
                this.guardarClienteFormulario();
            });
        }

        this.setupLomasSoftTypeahead();
    }
};

window.ClientesMobileController = ClientesMobileController;
