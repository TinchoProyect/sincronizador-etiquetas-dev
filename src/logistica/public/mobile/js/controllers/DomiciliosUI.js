/**
 * Controlador de Gestión de Domicilios ABM para PWA
 * Gestiona la selección, visualización y edición en contexto del Mobile-First Wizard.
 */

window.DomiciliosUI = {

    clienteActivoId: null,
    domicilios: [],
    mapa: null,
    marcador: null,
    geocoder: null,
    geocodeTimeoutId: null,

    /**
     * Inyección del HTML Nativo (Portable a cualquier vista PWA)
     */
    initHtml: function() {
        if (document.getElementById('modal-domicilios')) return; // Ya existe

        const modalHtml = `
            <style id="domicilios-ui-css">
                #modal-domicilios.hidden { display: none !important; }
                #modal-domicilios .hidden { display: none !important; }
                #modal-domicilios .wizard-input, #modal-domicilios .wizard-textarea {
                    width: 100%; padding: 0.75rem; border: 2px solid #e2e8f0;
                    border-radius: 0.5rem; font-size: 1rem; background-color: #f8fafc;
                    box-sizing: border-box; font-family: inherit;
                }
                #modal-domicilios .wizard-input:focus, #modal-domicilios .wizard-textarea:focus {
                    outline: none; border-color: #3b82f6; background-color: white;
                }
                #modal-domicilios .input-group { margin-bottom: 1rem; width: 100%; }
            </style>
            <!-- MODAL ABM DOMICILIOS -->
            <div id="modal-domicilios" class="wizard-modal hidden" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: white; padding-bottom: max(env(safe-area-inset-bottom), 1rem);">
                <div class="wizard-modal-content" style="height: 100vh; display: flex; flex-direction: column; background: white; border-radius: 0;">
                    <div class="wizard-modal-header" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                        <h3 style="margin: 0; color: #0f172a; font-size: 1.1rem; font-weight: 700;">📍 Mis Domicilios</h3>
                        <button class="btn-icon" onclick="DomiciliosUI.cerrarModal()" style="background: none; border: none; font-size: 1.5rem; color: #64748b; font-weight: bold;">✕</button>
                    </div>
                    
                    <!-- VISTA 1: Lista de Domicilios -->
                    <div id="vista-lista-domicilios" style="flex: 1; overflow-y: auto; padding: 1rem; background: white; position: relative;">
                        <div id="contenedor-domicilios-lista" style="display: flex; flex-direction: column; gap: 0.75rem;">
                            <p style="text-align: center; color: #64748b; padding: 2rem 0; font-size: 0.9rem;">Cargando domicilios...</p>
                        </div>
                        <div style="height: 80px;"></div> <!-- Spacer -->
                    </div>
                    
                    <div id="footer-lista-domicilios" style="padding: 1rem; border-top: 1px solid #e2e8f0; background: white; position: absolute; bottom: 0; width: 100%; box-shadow: 0 -4px 6px -1px rgba(0, 0, 0, 0.05);">
                        <button onclick="DomiciliosUI.mostrarFormulario()" style="width: 100%; background: #10b981; color: white; font-weight: 700; font-size: 1.1rem; padding: 1rem; border-radius: 12px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.4);">
                            ➕ Nuevo Domicilio
                        </button>
                    </div>

                    <!-- VISTA 2: Formulario de Alta/Edición -->
                    <div id="vista-form-domicilio" class="hidden" style="flex: 1; overflow-y: auto; padding: 1rem; background: white; display: flex; flex-direction: column; gap: 1rem; padding-bottom: 2rem;">
                        <button onclick="DomiciliosUI.mostrarLista()" style="background: none; border: none; color: #3b82f6; font-weight: 600; text-align: left; padding: 0.5rem 0; display: inline-flex; align-items: center; gap: 0.25rem;">← Volver al listado</button>
                        <h3 id="titulo-form-domicilio" style="margin: 0; color: #0f172a; font-size: 1.2rem; font-weight: 800;">Nuevo Domicilio</h3>
                        
                        <button id="btn-gps-dom" onclick="DomiciliosUI.obtenerUbicacionGPS()" style="background: #e0f2fe; color: #0284c7; font-weight: 700; font-size: 1rem; padding: 1rem; border-radius: 12px; border: 1px solid #bae6fd; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin-top: 0.5rem;">
                            🎯 Usar mi Ubicación Actual
                        </button>
                        
                        <div id="mapa-movil-container" class="hidden" style="height: 250px; min-height: 250px; flex-shrink: 0; width: 100%; border-radius: 12px; overflow: hidden; border: 1px solid #cbd5e1; position: relative; background-color: #f1f5f9;">
                            <div id="mapa-movil" style="width: 100%; height: 100%;"></div>
                            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -100%); pointer-events: none; z-index: 1000; text-shadow: 0 2px 4px rgba(0,0,0,0.3); font-size: 2.5rem; margin-top: 10px;">📍</div>
                        </div>
                        
                        <input type="hidden" id="dom-id">
                        <input type="hidden" id="dom-lat">
                        <input type="hidden" id="dom-lng">
                        
                        <div class="input-group">
                            <label style="font-weight: 600; color: #334155; font-size: 0.85rem;">Alias (Identificador Corto)</label>
                            <input type="text" id="dom-alias" class="wizard-input" placeholder="Ej: Obra Centro, Galpón, Casa...">
                        </div>
                        <div class="input-group">
                            <label style="font-weight: 600; color: #334155; font-size: 0.85rem;">Dirección Física</label>
                            <input type="text" id="dom-direccion" class="wizard-input" placeholder="Ej: Calle 7 1234">
                        </div>
                        <div class="input-group" style="display: flex; gap: 0.75rem;">
                            <div style="flex: 1;">
                                <label style="font-weight: 600; color: #334155; font-size: 0.85rem;">Localidad</label>
                                <input type="text" id="dom-localidad" class="wizard-input" placeholder="La Plata">
                            </div>
                            <div style="flex: 1;">
                                <label style="font-weight: 600; color: #334155; font-size: 0.85rem;">Provincia</label>
                                <input type="text" id="dom-provincia" class="wizard-input" placeholder="Buenos Aires">
                            </div>
                        </div>
                        <div class="input-group">
                            <label style="font-weight: 600; color: #334155; font-size: 0.85rem;">Instrucciones de Entrega (Opcional)</label>
                            <textarea id="dom-obs" class="wizard-textarea" rows="2" placeholder="Tocar timbre izquierdo, dejar en guardia..."></textarea>
                        </div>
                        
                        <button id="btn-guardar-dom" onclick="DomiciliosUI.guardarDomicilio()" style="background: #2563eb; color: white; font-weight: 700; padding: 1rem; border-radius: 12px; border: none; cursor: pointer; margin-top: 1.5rem; font-size: 1.1rem; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.4);">
                            💾 Guardar Domicilio
                        </button>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    /**
     * Punto de Entrada UI
     */
    abrirModalABM: function(clienteId = null) {
        this.initHtml();
        
        // Flexibilidad para recibir IDs por parámetro (desde ruta.html) o desde variables globales (Wizard)
        if (clienteId) {
            this.clienteActivoId = clienteId;
        } else if (window.WizardController && window.WizardController.cart && window.WizardController.cart.cliente && window.WizardController.cart.cliente.id) {
            this.clienteActivoId = window.WizardController.cart.cliente.id;
        } else {
            Swal.fire('Atención', 'Debe seleccionar un cliente primero', 'warning');
            return;
        }

        // Mostrar Modal Principal
        document.getElementById('modal-domicilios').classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Lock background scroll
        
        // Mostrar Lista primero
        this.mostrarLista();
        
        // Cargar Datos
        this.fetchDomicilios();
    },

    cerrarModal: function() {
        document.getElementById('modal-domicilios').classList.add('hidden');
        document.body.style.overflow = '';
    },

    /**
     * Cambio de Vistas del Sub-Modal
     */
    mostrarLista: function() {
        document.getElementById('vista-lista-domicilios').classList.remove('hidden');
        document.getElementById('footer-lista-domicilios').classList.remove('hidden');
        document.getElementById('vista-form-domicilio').classList.add('hidden');
        // Reset form
        this.limpiarFormulario();
    },

    mostrarFormulario: function(domicilio = null) {
        document.getElementById('vista-lista-domicilios').classList.add('hidden');
        document.getElementById('footer-lista-domicilios').classList.add('hidden');
        document.getElementById('vista-form-domicilio').classList.remove('hidden');

        if (domicilio) {
            // Edición
            document.getElementById('titulo-form-domicilio').textContent = 'Editar Domicilio';
            document.getElementById('dom-id').value = domicilio.id;
            document.getElementById('dom-alias').value = domicilio.alias || '';
            document.getElementById('dom-direccion').value = domicilio.direccion || '';
            document.getElementById('dom-localidad').value = domicilio.localidad || '';
            document.getElementById('dom-provincia').value = domicilio.provincia || 'Buenos Aires';
            document.getElementById('dom-obs').value = domicilio.instrucciones_entrega || '';
            document.getElementById('dom-lat').value = domicilio.latitud || '';
            document.getElementById('dom-lng').value = domicilio.longitud || '';
            
            // Si tiene mapa, renderizar pos, sino centro La Plata
            if(domicilio.latitud && domicilio.longitud) {
                this.inicializarMapa(parseFloat(domicilio.latitud), parseFloat(domicilio.longitud));
            } else {
                this.inicializarMapa(-34.9205, -57.9536); // La Plata Centro
            }
        } else {
            // Alta
            this.limpiarFormulario();
            document.getElementById('titulo-form-domicilio').textContent = 'Nuevo Domicilio';
            this.inicializarMapa(-34.9205, -57.9536); // Inicializar en La Plata Centro por defecto para paneo manual
        }
    },

    limpiarFormulario: function() {
        document.getElementById('dom-id').value = '';
        document.getElementById('dom-lat').value = '';
        document.getElementById('dom-lng').value = '';
        document.getElementById('dom-alias').value = '';
        document.getElementById('dom-direccion').value = '';
        document.getElementById('dom-localidad').value = '';
        document.getElementById('dom-provincia').value = 'Buenos Aires';
        document.getElementById('dom-obs').value = '';
        
        if (this.mapa) {
            this.mapa = null;
            this.marcador = null;
        }
    },

    /**
     * Conexión ABM
     */
    fetchDomicilios: async function() {
        try {
            document.getElementById('contenedor-domicilios-lista').innerHTML = '<p style="text-align:center; padding: 2rem;">Cargando domicilios...</p>';
            
            const response = await fetch(`/api/logistica/domicilios?id_cliente=${this.clienteActivoId}`);
            if(!response.ok) throw new Error('Error al obtener domicilios');
            const data = await response.json();
            
            this.domicilios = data.success ? data.data : [];
            this.renderizarLista();
            
        } catch (error) {
            console.error('Error:', error);
            document.getElementById('contenedor-domicilios-lista').innerHTML = `<p style="color:red; text-align:center">${error.message}</p>`;
        }
    },

    renderizarLista: function() {
        const contenedor = document.getElementById('contenedor-domicilios-lista');
        
        if (this.domicilios.length === 0) {
            contenedor.innerHTML = `
                <div style="text-align: center; padding: 3rem 1rem; color: #64748b; background: white; border-radius: 12px; border: 1px dashed #cbd5e1;">
                    <span style="font-size: 3rem; display: block; margin-bottom: 1rem;">🏚️</span>
                    <h4 style="margin: 0 0 0.5rem 0; color: #334155;">Sin Domicilios Guardados</h4>
                    <p style="margin: 0; font-size: 0.85rem;">Tocá en "Nuevo Domicilio" para crear uno.</p>
                </div>
            `;
            return;
        }

        contenedor.innerHTML = this.domicilios.map(dom => {
            const hasGPS = dom.latitud && dom.longitud;
            return `
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                    <div>
                        <span style="font-weight: 800; color: #0f172a; font-size: 1.05rem;">${dom.alias || 'Domicilio'}</span>
                        ${hasGPS ? '<span style="font-size: 0.7rem; background: #dcfce7; color: #166534; padding: 0.1rem 0.3rem; border-radius: 4px; border: 1px solid #bbf7d0; margin-left: 0.5rem;">GPS OK</span>' : ''}
                    </div>
                </div>
                
                <div style="color: #475569; font-size: 0.85rem; margin-bottom: 0.25rem;">
                    <strong>📍</strong> ${dom.direccion}
                </div>
                
                <div style="color: #64748b; font-size: 0.8rem; margin-bottom: 0.75rem;">
                    🏢 ${dom.localidad || 'S/N'}, ${dom.provincia || ''}
                </div>
                
                ${dom.instrucciones_entrega ? `<div style="background: #f8fafc; padding: 0.5rem; border-radius: 6px; font-size: 0.8rem; color: #475569; border-left: 3px solid #3b82f6; margin-bottom: 0.75rem;"><i>${dom.instrucciones_entrega}</i></div>` : ''}
                
                <div style="display: flex; gap: 0.5rem; justify-content: flex-end; border-top: 1px solid #f1f5f9; padding-top: 0.75rem; margin-top: 0.5rem;">
                    <button class="btn-icon" onclick='DomiciliosUI.mostrarFormulario(${JSON.stringify(dom).replace(/'/g, "&apos;")})' style="background: #f1f5f9; color: #3b82f6; border: none; padding: 0.5rem 1rem; border-radius: 6px; font-weight: bold; cursor: pointer;">
                        ✏️ Editar
                    </button>
                    ${dom.por_defecto ? '' : `
                    <button class="btn-icon" onclick="DomiciliosUI.eliminarDomicilio(${dom.id})" style="background: #fef2f2; color: #ef4444; border: none; padding: 0.5rem 1rem; border-radius: 6px; font-weight: bold; cursor: pointer;">
                        🗑️ Borrar
                    </button>
                    `}
                </div>
            </div>
            `;
        }).join('');
    },

    guardarDomicilio: async function() {
        const id = document.getElementById('dom-id').value;
        const alias = document.getElementById('dom-alias').value.trim();
        const direccion = document.getElementById('dom-direccion').value.trim();
        const localidad = document.getElementById('dom-localidad').value.trim();
        const provincia = document.getElementById('dom-provincia').value.trim();
        const obs = document.getElementById('dom-obs').value.trim();
        
        let lat = parseFloat(document.getElementById('dom-lat').value);
        let lng = parseFloat(document.getElementById('dom-lng').value);

        if (!alias) return Swal.fire('Error', 'Debe ingresar un Alias (Ej: Depósito, Obra, Local)', 'warning');
        if (!direccion && (!lat || !lng)) return Swal.fire('Error', 'Debe ingresar una Dirección o usar la Ubicación GPS', 'warning');

        // Si usaron GPS pero no hay dirección, la marcamos como GPS
        const direccionFinal = direccion || 'Ubicación Geolocalizada GPS';

        const payload = {
            id_cliente: this.clienteActivoId,
            alias: alias,
            direccion: direccionFinal,
            localidad: localidad,
            provincia: provincia,
            instrucciones_entrega: obs,
            latitud: isNaN(lat) ? null : lat,
            longitud: isNaN(lng) ? null : lng,
            coordenadas_validadas: (!isNaN(lat) && !isNaN(lng))
        };

        const esEdicion = !!id;
        const url = esEdicion ? `/api/logistica/domicilios/${id}` : `/api/logistica/domicilios`;
        const method = esEdicion ? 'PUT' : 'POST';

        try {
            Swal.fire({
                title: 'Guardando domicilio...',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            const req = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const res = await req.json();
            if(!res.success) throw new Error(res.error || 'Fallo API Domicilio');

            Swal.fire({
                title: '¡Guardado!',
                text: esEdicion ? 'El domicilio ha sido actualizado' : 'Nuevo domicilio guardado',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });

            this.mostrarLista();
            this.fetchDomicilios();

            // Sinergia con WizardController (Auto-seleccionar si queremos)
            // Ya que abrimos el Domicilios, al guardar y volver, la próxima vez que el presu requiera Domicilios (ej. en paso 3) estará actualizado

        } catch(error) {
            console.error('Error guardado:', error);
            Swal.fire('Error Servidor', error.message, 'error');
        }
    },

    eliminarDomicilio: async function(id) {
        Swal.fire({
            title: '¿Eliminar Domicilio?',
            text: "No podrás revertir esto ni recuperar pedidos anteriores con esta dirección exacta.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#94a3b8',
            confirmButtonText: 'Sí, borrar',
            cancelButtonText: 'Cancelar',
            reverseButtons: true
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    Swal.fire({
                        title: 'Eliminando...',
                        allowOutsideClick: false,
                        didOpen: () => { Swal.showLoading(); }
                    });
                    
                    const res = await fetch(`/api/logistica/domicilios/${id}`, { method: 'DELETE' });
                    const dat = await res.json();
                    
                    if(!dat.success) throw new Error(dat.error || 'No se puede eliminar');
                    
                    await this.fetchDomicilios();
                    Swal.fire('Eliminado', 'Domicilio borrado correctamente', 'success');
                } catch(e) {
                    Swal.fire('Error', e.message, 'error');
                }
            }
        });
    },

    /**
     * Motor de Cartografía y Táctil
     */
    obtenerUbicacionGPS: function() {
        if (!navigator.geolocation) {
            Swal.fire('Geo Incompatible', 'Tu navegador no permite Geoposicionamiento', 'error');
            return;
        }

        const btnGPS = document.getElementById('btn-gps-dom');
        btnGPS.innerHTML = '⏳ Obteniendo ubicación...';
        btnGPS.disabled = true;

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                document.getElementById('dom-lat').value = lat;
                document.getElementById('dom-lng').value = lng;
                
                this.inicializarMapa(lat, lng, true);
                
                btnGPS.innerHTML = '✅ GPS: Ubicación Exacta Fijada';
                btnGPS.style.background = '#dcfce7';
                btnGPS.style.color = '#166534';
                btnGPS.style.borderColor = '#bbf7d0';
                btnGPS.disabled = false;
            },
            (error) => {
                console.error("Geolocalización Error:", error);
                
                let msg = 'Error desconocido de Geoposicionamiento.';
                if(error.code === 1) msg = "Has denegado el permiso de GPS al celular.";
                if(error.code === 2) msg = "La red del celular no puede triangular tu posición.";
                if(error.code === 3) msg = "Se acabó el tiempo de espera del GPS (Posible falta de señal).";

                Swal.fire('Aviso', msg, 'warning');
                
                btnGPS.innerHTML = '🎯 Forzar Ubicación Actual';
                btnGPS.disabled = false;
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    },

    inicializarMapa: async function(lat, lng, attemptReverseGeocode = false) {
        document.getElementById('mapa-movil-container').classList.remove('hidden');
        
        // Forzar un Reflow del DOM (evita que Google Maps capture la pantalla anterior 0x0 px del display:none)
        document.getElementById('mapa-movil-container').offsetHeight;
        await new Promise(resolve => setTimeout(resolve, 50)); 
        
        // 1. Cargar Google Maps SDK si no está cargado.
        if (!window.google || !window.google.maps) {
            document.getElementById('mapa-movil').innerHTML = '<div style="display:flex; height:100%; align-items:center; justify-content:center; color:#64748b;">Cargando Cartografía...</div>';
            
            try {
                // Mismo bloque dinámico robusto que usamos en Escritorio
                const configResponse = await fetch('/api/logistica/config');
                const result = await configResponse.json();
                const apiKey = result.data.googleMapsApiKey;

                if (!apiKey) throw new Error('API Key ausente en el servidor');

                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
                    script.onload = () => {
                        let attempts = 0;
                        const checkGoogle = setInterval(() => {
                            attempts++;
                            if (window.google && window.google.maps && window.google.maps.Map) {
                                clearInterval(checkGoogle);
                                resolve();
                            } else if (attempts > 50) { // 5 segundos timeout
                                clearInterval(checkGoogle);
                                reject(new Error('Timeout inicializando Mapas de Google'));
                            }
                        }, 100);
                    };
                    script.onerror = () => reject(new Error('Fallo la conexión con Google Maps'));
                    document.head.appendChild(script);
                });
            } catch (err) {
                console.error("MAP FAIL:", err);
                document.getElementById('mapa-movil').innerHTML = `<div style="color:red; text-align:center; padding: 1rem;">${err.message}</div>`;
                return;
            }
        }

        const center = { lat, lng };

        if (!this.mapa) {
            this.mapa = new google.maps.Map(document.getElementById('mapa-movil'), {
                center: center,
                zoom: 17,
                disableDefaultUI: true, // App look
                zoomControl: true,
                mapTypeId: 'roadmap',
                gestureHandling: 'greedy' // El mapa consume los toques sin scrollear la página si es posible 
            });

            this.geocoder = new google.maps.Geocoder();

            // Escuchar el final del "paneo" o "arrastre" táctil para reposicionar el pin
            this.mapa.addListener('dragend', () => {
                const nuevaPos = this.mapa.getCenter();
                document.getElementById('dom-lat').value = nuevaPos.lat();
                document.getElementById('dom-lng').value = nuevaPos.lng();
                
                // Hacer Reverse Geocode cada vez que se reposiciona para auto-escribir la calle
                this.debouceReverseGeocode(nuevaPos);
            });
        } else {
            this.mapa.panTo(center);
            // Si el mapa ya existía y el modal estaba oculto, Google Maps se crashea visualmente si no emitimos el Resize.
            google.maps.event.trigger(this.mapa, 'resize');
            this.mapa.setCenter(center); // Re-centrar después del resize
        }

        // Auto reverse geocode inicial si viene del botón GPS
        if (attemptReverseGeocode) {
            this.ejecutarReverseGeocode(center);
        }
    },

    debouceReverseGeocode: function(latLng) {
        if(this.geocodeTimeoutId) clearTimeout(this.geocodeTimeoutId);
        this.geocodeTimeoutId = setTimeout(() => {
            this.ejecutarReverseGeocode(latLng);
        }, 1000); // Dar 1 seg desde que suelta el mapa antes de pedir API a Google
    },

    ejecutarReverseGeocode: function(latLng) {
        if (!this.geocoder) return;

        this.geocoder.geocode({ location: latLng }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const addr = results[0];
                let calle = '', numero = '', localidad = '', provincia = '';

                // Desglozar componentes precisos de Google
                addr.address_components.forEach(comp => {
                    if (comp.types.includes('route')) calle = comp.long_name;
                    if (comp.types.includes('street_number')) numero = comp.short_name;
                    if (comp.types.includes('locality')) localidad = comp.long_name;
                    if (comp.types.includes('administrative_area_level_1')) provincia = comp.long_name;
                });

                const direccionStr = `${calle} ${numero}`.trim() || addr.formatted_address.split(',')[0];
                
                // Solo auto-rellenamos si actualmente está vacío, o animamos sutilmente el cambio
                const dirInput = document.getElementById('dom-direccion');
                const locInput = document.getElementById('dom-localidad');

                if (dirInput.value.trim() === '' || dirInput.dataset.autoFilled === 'true') {
                    dirInput.value = direccionStr;
                    dirInput.dataset.autoFilled = 'true';
                }

                if (localidad && (locInput.value.trim() === '' || locInput.dataset.autoFilled === 'true')) {
                    locInput.value = localidad;
                    locInput.dataset.autoFilled = 'true';
                    document.getElementById('dom-provincia').value = provincia || 'Buenos Aires';
                }

                console.log("[MAP] Paridad Geométrica Auto-Completada");
            }
        });
    }

};
