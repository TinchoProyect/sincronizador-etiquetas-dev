(function () {
    'use strict';

    const DEFAULT_CENTER = { lat: -34.9205, lng: -57.9536 }; // La Plata

    const state = {
        token: '',
        solicitud: null,
        step: 1,
        mapaReady: false,
        map: null,
        capaCalle: null,
        capaSatelite: null,
        capaSateliteEtiquetas: null,
        modoCapa: 'calle',
        reverseTimer: null,
        searchTimer: null,
        geoSeleccionado: false,
        sinMapaFallback: false,
        lat: null,
        lng: null,
        precisionMetros: null,
        tipoLugar: '',
        aliasAutoFilled: true,
        horarioMode: 'none',
        enviando: false
    };

    const $ = (id) => document.getElementById(id);

    function escHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function extraerTokenDeUrl() {
        const pathParts = (window.location.pathname || '').split('/').filter(Boolean);
        const idx = pathParts.indexOf('mi-domicilio');
        if (idx >= 0 && pathParts[idx + 1]) {
            return pathParts[idx + 1].trim();
        }
        const sp = new URLSearchParams(window.location.search || '');
        return (sp.get('token') || '').trim();
    }

    function mostrarVista(nombre) {
        ['view-loading', 'view-estado-bloqueado', 'view-completada', 'view-wizard'].forEach(id => {
            $(id)?.classList.add('hidden');
        });
        $(nombre)?.classList.remove('hidden');

        const enWizard = nombre === 'view-wizard';
        $('wizard-footer')?.classList.toggle('hidden', !enWizard);
        $('step-badge')?.classList.toggle('hidden', !enWizard);
        $('progress-track')?.classList.toggle('hidden', !enWizard);
        if (!enWizard) {
            $('btn-step-back')?.classList.add('hidden');
        }
    }

    function renderBloqueado(icono, titulo, desc) {
        $('estado-bloqueado-icon').textContent = icono;
        $('estado-bloqueado-titulo').textContent = titulo;
        $('estado-bloqueado-desc').textContent = desc;
        mostrarVista('view-estado-bloqueado');
    }

    function renderComprobante(comp, clienteNombre) {
        if (clienteNombre) {
            $('comp-saludo').textContent = `Gracias ${clienteNombre}, ya guardamos tu domicilio de entrega para tus próximos pedidos de LAMDA.`;
        }
        const horarioTxt = (comp?.horario_atencion_desde || comp?.horario_atencion_hasta)
            ? `${comp.horario_atencion_desde || '--:--'} a ${comp.horario_atencion_hasta || '--:--'}`
            : 'Sin restricción horaria';
        const gpsTxt = (comp?.latitud !== null && comp?.latitud !== undefined && comp?.longitud !== null && comp?.longitud !== undefined)
            ? `Fijado (${Number(comp.latitud).toFixed(5)}, ${Number(comp.longitud).toFixed(5)})`
            : 'Carga por dirección escrita';

        $('comp-resumen-box').innerHTML = `
            <div><strong>🏷️ Alias:</strong> ${escHtml(comp?.alias || 'Domicilio de Entrega')}</div>
            <div><strong>📍 Dirección:</strong> ${escHtml(comp?.direccion || '—')}</div>
            <div><strong>🏙️ Localidad:</strong> ${escHtml([comp?.localidad, comp?.provincia].filter(Boolean).join(', ') || '—')}</div>
            <div><strong>🗺️ Ubicación mapa:</strong> ${escHtml(gpsTxt)}</div>
            <div><strong>🕒 Horario:</strong> ${escHtml(horarioTxt)}</div>
            ${comp?.instrucciones_entrega ? `<div><strong>📝 Referencias:</strong> ${escHtml(comp.instrucciones_entrega)}</div>` : ''}
        `;
        mostrarVista('view-completada');
    }

    function componerDireccionPreview() {
        const calle = ($('inp-calle')?.value || '').trim();
        const sinNum = Boolean($('chk-sin-numero')?.checked);
        const numero = sinNum ? '' : ($('inp-numero')?.value || '').trim();
        const entre = ($('inp-entre-calles')?.value || '').trim();
        const piso = ($('inp-piso-depto')?.value || '').trim();

        if (!calle) return '—';
        let txt = calle;
        if (numero) txt += ` N° ${numero}`;
        else if (sinNum) txt += ' S/N';
        if (entre) txt += ` e/ ${entre}`;
        if (piso) txt += ` (${piso})`;
        return txt;
    }

    function obtenerHorariosSeleccionados() {
        if (state.horarioMode === 'none') return { desde: null, hasta: null };
        if (state.horarioMode === 'custom') {
            return {
                desde: ($('inp-hora-desde')?.value || '').trim() || null,
                hasta: ($('inp-hora-hasta')?.value || '').trim() || null
            };
        }
        const chipActivo = document.querySelector('#chips-horario .dom-chip.active');
        return {
            desde: chipActivo?.dataset?.desde || null,
            hasta: chipActivo?.dataset?.hasta || null
        };
    }

    function esPasoActualValido() {
        if (state.step === 1) {
            return Boolean(state.geoSeleccionado && state.lat !== null && state.lng !== null);
        }
        if (state.step === 2) {
            const alias = ($('inp-alias')?.value || '').trim();
            const calle = ($('inp-calle')?.value || '').trim();
            const sinNum = Boolean($('chk-sin-numero')?.checked);
            const num = ($('inp-numero')?.value || '').trim();
            const loc = ($('inp-localidad')?.value || '').trim();
            return Boolean(alias.length >= 2 && calle.length >= 2 && (sinNum || num.length >= 1) && loc.length >= 2);
        }
        if (state.step === 3) {
            return !state.enviando;
        }
        return false;
    }

    function actualizarBotonSiguiente() {
        const btn = $('btn-step-next');
        if (!btn) return;
        btn.disabled = !esPasoActualValido();

        if (state.step === 1) {
            btn.classList.remove('is-confirm');
            btn.textContent = 'Confirmar punto y continuar →';
        } else if (state.step === 2) {
            btn.classList.remove('is-confirm');
            btn.textContent = 'Continuar →';
        } else {
            btn.classList.add('is-confirm');
            btn.textContent = state.enviando ? '⏳ Guardando domicilio...' : '✅ Confirmar y Guardar Domicilio';
        }
    }

    function renderResumenPaso3() {
        const alias = ($('inp-alias')?.value || '').trim();
        const dir = componerDireccionPreview();
        const loc = ($('inp-localidad')?.value || '').trim();
        const prov = ($('inp-provincia')?.value || '').trim();
        const { desde, hasta } = obtenerHorariosSeleccionados();
        const inst = ($('inp-instrucciones')?.value || '').trim();
        const tel = ($('inp-telefono-recibe')?.value || '').trim();

        const gpsTxt = (state.lat !== null && state.lng !== null && !state.sinMapaFallback)
            ? `Pin fijado (${state.lat.toFixed(5)}, ${state.lng.toFixed(5)})${state.precisionMetros ? ` · ±${state.precisionMetros}m` : ''}`
            : 'Sin mapa (dirección escrita)';

        const horarioTxt = (desde || hasta)
            ? `${desde || '--:--'} a ${hasta || '--:--'}`
            : 'Sin preferencia horaria';

        $('step-3-summary-body').innerHTML = `
            <div><strong>🏷️ Lugar:</strong> ${escHtml(alias)}</div>
            <div><strong>📍 Dirección:</strong> ${escHtml(dir)}</div>
            <div><strong>🏙️ Localidad:</strong> ${escHtml([loc, prov].filter(Boolean).join(', '))}</div>
            <div><strong>🗺️ Mapa / GPS:</strong> ${escHtml(gpsTxt)}</div>
            <div><strong>🕒 Horario:</strong> ${escHtml(horarioTxt)}</div>
            ${tel ? `<div><strong>📞 Teléfono:</strong> ${escHtml(tel)}</div>` : ''}
            ${inst ? `<div><strong>📝 Referencias:</strong> ${escHtml(inst)}</div>` : ''}
        `;
    }

    function irAPaso(nuevoPaso) {
        state.step = nuevoPaso;
        [1, 2, 3].forEach(n => {
            $(`step-${n}`)?.classList.toggle('hidden', n !== nuevoPaso);
        });

        $('step-badge').textContent = `Paso ${nuevoPaso} de 3`;
        $('progress-fill').style.width = `${(nuevoPaso / 3) * 100}%`;
        $('btn-step-back')?.classList.toggle('hidden', nuevoPaso === 1);

        if (nuevoPaso === 1 && state.map) {
            setTimeout(() => state.map.invalidateSize(), 80);
        }
        if (nuevoPaso === 2) {
            $('lbl-preview-direccion').textContent = componerDireccionPreview();
        }
        if (nuevoPaso === 3) {
            renderResumenPaso3();
        }

        actualizarBotonSiguiente();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function parsearDireccionLegacyEnCampos(direccionRaw) {
        const txt = String(direccionRaw || '').trim();
        if (!txt) return { calle: '', numero: '', entre: '' };
        let entre = '';
        let base = txt;
        const mEntre = /\(?e\/\s*([^)]+)\)?/i.exec(base);
        if (mEntre) {
            entre = mEntre[1].trim();
            base = base.replace(mEntre[0], '').trim();
        }
        base = base.split(',')[0].trim();
        const mNum = /^(.*?)\s+(?:N°|Nro\.?|#)?\s*(\d+[A-Za-z]?)$/i.exec(base);
        if (mNum) {
            return { calle: mNum[1].trim(), numero: mNum[2].trim(), entre };
        }
        return { calle: base, numero: '', entre };
    }

    function aplicarDatosReverseGeocoder(geo) {
        if (!geo) return;
        const inpCalle = $('inp-calle');
        const inpNum = $('inp-numero');
        const inpLoc = $('inp-localidad');
        const inpProv = $('inp-provincia');
        const inpCp = $('inp-cp');

        if (geo.calle && inpCalle && (!inpCalle.value.trim() || inpCalle.dataset.auto === '1')) {
            inpCalle.value = geo.calle;
            inpCalle.dataset.auto = '1';
        }
        if (geo.altura && inpNum && (!inpNum.value.trim() || inpNum.dataset.auto === '1')) {
            inpNum.value = geo.altura;
            inpNum.dataset.auto = '1';
        }
        const locVal = geo.localidad || geo.partido || '';
        if (locVal && inpLoc && (!inpLoc.value.trim() || inpLoc.dataset.auto === '1')) {
            inpLoc.value = locVal;
            inpLoc.dataset.auto = '1';
        }
        if (geo.provincia && inpProv && (!inpProv.value.trim() || inpProv.dataset.auto === '1')) {
            inpProv.value = geo.provincia;
            inpProv.dataset.auto = '1';
        }
        if (geo.codigo_postal && inpCp && (!inpCp.value.trim() || inpCp.dataset.auto === '1')) {
            inpCp.value = geo.codigo_postal;
            inpCp.dataset.auto = '1';
        }

        if (geo.display_name) {
            $('map-pin-info').textContent = `📍 Pin en: ${geo.display_name}`;
        }
        $('lbl-preview-direccion').textContent = componerDireccionPreview();
        actualizarBotonSiguiente();
    }

    async function ejecutarReverseGeocoding(lat, lng) {
        try {
            const res = await fetch(`/api/public/domicilio/${encodeURIComponent(state.token)}/geocodificar-inverso?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
            const data = await res.json();
            if (res.ok && data.ok) {
                aplicarDatosReverseGeocoder(data);
            }
        } catch (err) {
            console.warn('Reverse geocoding omitido:', err);
        }
    }

    function fijarCoordenadasEnMapa(lat, lng, { zoom = null, precision = null, marcarSeleccionado = true, reverse = true, pan = true } = {}) {
        state.lat = Number(lat);
        state.lng = Number(lng);
        if (precision !== null && precision !== undefined) {
            state.precisionMetros = Math.round(Number(precision));
        }
        if (marcarSeleccionado) {
            state.geoSeleccionado = true;
            state.sinMapaFallback = false;
        }
        if (state.map && pan) {
            state.map.setView([state.lat, state.lng], zoom || state.map.getZoom(), { animate: true });
        }
        $('map-pin-info').textContent = `📍 Pin fijado (${state.lat.toFixed(5)}, ${state.lng.toFixed(5)})`;
        if (reverse) {
            clearTimeout(state.reverseTimer);
            state.reverseTimer = setTimeout(() => {
                ejecutarReverseGeocoding(state.lat, state.lng);
            }, 450);
        }
        actualizarBotonSiguiente();
    }

    function cambiarCapaMapa(modo) {
        state.modoCapa = modo;
        $('btn-capa-calle')?.classList.toggle('active', modo === 'calle');
        $('btn-capa-satelite')?.classList.toggle('active', modo === 'satelite');
        if (!state.map || !state.capaCalle || !state.capaSatelite) return;

        if (modo === 'satelite') {
            if (state.map.hasLayer(state.capaCalle)) state.map.removeLayer(state.capaCalle);
            if (!state.map.hasLayer(state.capaSatelite)) state.capaSatelite.addTo(state.map);
            if (state.capaSateliteEtiquetas && !state.map.hasLayer(state.capaSateliteEtiquetas)) {
                state.capaSateliteEtiquetas.addTo(state.map);
            }
        } else {
            if (state.map.hasLayer(state.capaSatelite)) state.map.removeLayer(state.capaSatelite);
            if (state.capaSateliteEtiquetas && state.map.hasLayer(state.capaSateliteEtiquetas)) {
                state.map.removeLayer(state.capaSateliteEtiquetas);
            }
            if (!state.map.hasLayer(state.capaCalle)) state.capaCalle.addTo(state.map);
        }
    }

    function inicializarMapaLeaflet(latInicial, lngInicial, yaTieneCoords = false) {
        const container = $('leaflet-map-canvas');
        if (!container) return;

        if (!window.L) {
            container.innerHTML = `<div class="dom-map-loading" style="padding:16px; text-align:center;">No se pudo cargar el visor de mapa. Usá el botón "cargar dirección escrita" de abajo.</div>`;
            return;
        }

        container.innerHTML = '';
        const zoomInicial = yaTieneCoords ? 17 : 13;
        state.map = window.L.map(container, {
            center: [latInicial, lngInicial],
            zoom: zoomInicial,
            zoomControl: true
        });

        state.capaCalle = window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        });

        state.capaSatelite = window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '&copy; Esri'
        });

        state.capaSateliteEtiquetas = window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        });

        state.capaCalle.addTo(state.map);

        state.map.on('moveend', () => {
            const center = state.map.getCenter();
            fijarCoordenadasEnMapa(center.lat, center.lng, {
                pan: false,
                reverse: true,
                marcarSeleccionado: true
            });
        });

        state.map.on('click', (e) => {
            if (e && e.latlng) {
                fijarCoordenadasEnMapa(e.latlng.lat, e.latlng.lng, {
                    zoom: Math.max(state.map.getZoom(), 17),
                    pan: true,
                    reverse: true,
                    marcarSeleccionado: true
                });
            }
        });

        state.mapaReady = true;
        if (yaTieneCoords) {
            state.lat = latInicial;
            state.lng = lngInicial;
            state.geoSeleccionado = true;
            $('map-pin-info').textContent = `📍 Punto actual (${latInicial.toFixed(5)}, ${lngInicial.toFixed(5)}). Movelo si querés ajustarlo.`;
        }
        actualizarBotonSiguiente();
    }

    function solicitarUbicacionGps() {
        const btn = $('btn-usar-gps');
        const pill = $('gps-status-pill');
        if (!navigator.geolocation) {
            pill.textContent = 'Tu navegador no soporta GPS. Buscá tu calle arriba o mové el mapa.';
            pill.className = 'dom-gps-pill is-warn';
            pill.classList.remove('hidden');
            return;
        }

        btn.disabled = true;
        $('btn-gps-label').textContent = 'Obteniendo señal GPS...';
        pill.classList.add('hidden');

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                btn.disabled = false;
                btn.classList.add('is-ok');
                $('btn-gps-label').textContent = 'Ubicación GPS fijada (podés ajustar el pin)';

                const acc = Math.round(pos.coords.accuracy || 0);
                pill.textContent = `✅ GPS capturado${acc > 0 ? ` (precisión ±${acc} m)` : ''}`;
                pill.className = 'dom-gps-pill is-ok';
                pill.classList.remove('hidden');

                fijarCoordenadasEnMapa(pos.coords.latitude, pos.coords.longitude, {
                    zoom: 18,
                    precision: acc,
                    marcarSeleccionado: true,
                    reverse: true,
                    pan: true
                });
            },
            (err) => {
                btn.disabled = false;
                $('btn-gps-label').textContent = 'Reintentar ubicación actual (GPS)';
                let msg = 'No pudimos obtener tu ubicación.';
                if (err.code === 1) msg = 'Permiso de ubicación denegado. Podés buscar tu calle o mover el pin en el mapa.';
                else if (err.code === 2) msg = 'No se detectó señal GPS. Buscá tu calle arriba o cargá la dirección escrita.';
                else if (err.code === 3) msg = 'El GPS demoró demasiado. Probá buscar tu calle arriba.';

                pill.textContent = `⚠️ ${msg}`;
                pill.className = 'dom-gps-pill is-warn';
                pill.classList.remove('hidden');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    async function buscarDireccionEnMapa(queryRaw) {
        const q = String(queryRaw || $('inp-buscar-mapa')?.value || '').trim();
        const dropdown = $('search-results-dropdown');
        if (q.length < 3) {
            dropdown?.classList.add('hidden');
            return;
        }

        dropdown.innerHTML = '<div class="dom-search-item">🔍 Buscando dirección...</div>';
        dropdown.classList.remove('hidden');

        try {
            const res = await fetch(`/api/public/domicilio/${encodeURIComponent(state.token)}/geocodificar?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            const resultados = Array.isArray(data.resultados) ? data.resultados : [];

            if (resultados.length === 0) {
                dropdown.innerHTML = '<div class="dom-search-item">Sin coincidencias exactas. Probá agregando localidad o mové el pin en el mapa.</div>';
                return;
            }

            dropdown.innerHTML = '';
            resultados.forEach(item => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'dom-search-item';
                btn.innerHTML = `
                    <strong>${escHtml(item.display_name)}</strong>
                    <small>${item.fuente === 'nominatim' ? 'OpenStreetMap' : 'GeoRef Argentina'}</small>
                `;
                btn.onclick = () => {
                    dropdown.classList.add('hidden');
                    $('inp-buscar-mapa').value = item.display_name;

                    if (item.calle) {
                        $('inp-calle').value = item.calle;
                        $('inp-calle').dataset.auto = '0';
                    }
                    if (item.altura) {
                        $('inp-numero').value = item.altura;
                        $('inp-numero').dataset.auto = '0';
                    }
                    if (item.localidad || item.partido) {
                        $('inp-localidad').value = item.localidad || item.partido;
                        $('inp-localidad').dataset.auto = '0';
                    }
                    if (item.provincia) {
                        $('inp-provincia').value = item.provincia;
                        $('inp-provincia').dataset.auto = '0';
                    }

                    fijarCoordenadasEnMapa(item.lat, item.lng, {
                        zoom: item.altura ? 17 : 15,
                        marcarSeleccionado: true,
                        reverse: !item.calle,
                        pan: true
                    });
                    $('map-pin-info').textContent = `📍 Pin en: ${item.display_name}`;
                };
                dropdown.appendChild(btn);
            });
        } catch (err) {
            dropdown.innerHTML = '<div class="dom-search-item">No pudimos consultar el buscador. Mové el mapa manualmente.</div>';
        }
    }

    async function enviarConfirmacion() {
        if (state.enviando) return;
        const errBox = $('submit-error-box');
        errBox?.classList.add('hidden');

        state.enviando = true;
        actualizarBotonSiguiente();

        const { desde, hasta } = obtenerHorariosSeleccionados();
        const sinNum = Boolean($('chk-sin-numero')?.checked);

        const payload = {
            alias: ($('inp-alias')?.value || '').trim(),
            tipo_lugar: state.tipoLugar || null,
            calle: ($('inp-calle')?.value || '').trim(),
            numero: sinNum ? '' : ($('inp-numero')?.value || '').trim(),
            sin_numero: sinNum,
            entre_calles: ($('inp-entre-calles')?.value || '').trim(),
            piso_depto: ($('inp-piso-depto')?.value || '').trim(),
            localidad: ($('inp-localidad')?.value || '').trim(),
            provincia: ($('inp-provincia')?.value || '').trim() || 'Buenos Aires',
            codigo_postal: ($('inp-cp')?.value || '').trim() || null,
            horario_atencion_desde: desde,
            horario_atencion_hasta: hasta,
            instrucciones_entrega: ($('inp-instrucciones')?.value || '').trim() || null,
            telefono_contacto: ($('inp-telefono-recibe')?.value || '').trim() || null,
            latitud: state.sinMapaFallback ? null : state.lat,
            longitud: state.sinMapaFallback ? null : state.lng,
            gps_precision_metros: state.sinMapaFallback ? null : state.precisionMetros,
            sin_mapa_fallback: state.sinMapaFallback
        };

        try {
            const res = await fetch(`/api/public/domicilio/${encodeURIComponent(state.token)}/confirmar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'No se pudo guardar el domicilio.');
            }
            renderComprobante(data.comprobante || data.domicilio, state.solicitud?.cliente_nombre);
        } catch (err) {
            errBox.textContent = err.message || 'Ocurrió un error al guardar. Reintentá.';
            errBox.classList.remove('hidden');
            state.enviando = false;
            actualizarBotonSiguiente();
        }
    }

    function bindEventos() {
        $('btn-usar-gps')?.addEventListener('click', solicitarUbicacionGps);
        $('btn-capa-calle')?.addEventListener('click', () => cambiarCapaMapa('calle'));
        $('btn-capa-satelite')?.addEventListener('click', () => cambiarCapaMapa('satelite'));

        $('btn-buscar-mapa')?.addEventListener('click', () => buscarDireccionEnMapa());
        $('inp-buscar-mapa')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                buscarDireccionEnMapa();
            }
        });
        $('inp-buscar-mapa')?.addEventListener('input', (e) => {
            clearTimeout(state.searchTimer);
            const val = e.target.value.trim();
            if (val.length < 4) {
                $('search-results-dropdown')?.classList.add('hidden');
                return;
            }
            state.searchTimer = setTimeout(() => buscarDireccionEnMapa(val), 450);
        });

        document.addEventListener('click', (e) => {
            const box = document.querySelector('.dom-search-box');
            if (box && !box.contains(e.target)) {
                $('search-results-dropdown')?.classList.add('hidden');
            }
        });

        $('btn-fallback-sin-mapa')?.addEventListener('click', () => {
            state.sinMapaFallback = true;
            state.geoSeleccionado = false;
            irAPaso(2);
        });

        // Tipo de lugar chips
        document.querySelectorAll('#chips-tipo-lugar .dom-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#chips-tipo-lugar .dom-chip').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                state.tipoLugar = btn.dataset.tipo || '';
                const inpAlias = $('inp-alias');
                if (inpAlias && (!inpAlias.value.trim() || state.aliasAutoFilled)) {
                    inpAlias.value = btn.dataset.alias || '';
                    state.aliasAutoFilled = true;
                }
                actualizarBotonSiguiente();
            });
        });

        $('inp-alias')?.addEventListener('input', () => {
            state.aliasAutoFilled = false;
            actualizarBotonSiguiente();
        });

        $('chk-sin-numero')?.addEventListener('change', (e) => {
            const checked = Boolean(e.target.checked);
            const inpNum = $('inp-numero');
            if (inpNum) {
                inpNum.disabled = checked;
                if (checked) inpNum.value = '';
            }
            $('req-numero')?.classList.toggle('hidden', checked);
            $('lbl-preview-direccion').textContent = componerDireccionPreview();
            actualizarBotonSiguiente();
        });

        ['inp-calle', 'inp-numero', 'inp-entre-calles', 'inp-piso-depto', 'inp-localidad', 'inp-provincia', 'inp-cp'].forEach(id => {
            $(id)?.addEventListener('input', (e) => {
                e.target.dataset.auto = '0';
                $('lbl-preview-direccion').textContent = componerDireccionPreview();
                actualizarBotonSiguiente();
            });
        });

        // Chips de horario
        document.querySelectorAll('#chips-horario .dom-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#chips-horario .dom-chip').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                state.horarioMode = btn.dataset.mode || 'none';
                $('box-horario-custom')?.classList.toggle('hidden', state.horarioMode !== 'custom');
                renderResumenPaso3();
            });
        });

        ['inp-hora-desde', 'inp-hora-hasta', 'inp-instrucciones', 'inp-telefono-recibe'].forEach(id => {
            $(id)?.addEventListener('input', renderResumenPaso3);
        });

        $('btn-step-back')?.addEventListener('click', () => {
            if (state.step > 1) irAPaso(state.step - 1);
        });

        $('btn-step-next')?.addEventListener('click', () => {
            if (!esPasoActualValido()) return;
            if (state.step === 1) irAPaso(2);
            else if (state.step === 2) irAPaso(3);
            else if (state.step === 3) enviarConfirmacion();
        });
    }

    async function init() {
        bindEventos();
        state.token = extraerTokenDeUrl();
        if (!state.token) {
            renderBloqueado('🔗', 'Enlace inválido', 'No se encontró un identificador válido en la dirección web.');
            return;
        }

        try {
            const res = await fetch(`/api/public/domicilio/${encodeURIComponent(state.token)}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok || !data.solicitud) {
                renderBloqueado('⚠️', 'Enlace no disponible', data.error || 'Este enlace no existe o fue eliminado.');
                return;
            }

            const sol = data.solicitud;
            state.solicitud = sol;

            if (sol.estado === 'COMPLETADA') {
                renderComprobante(sol.comprobante, sol.cliente_nombre);
                return;
            }
            if (sol.estado === 'REVOCADA') {
                renderBloqueado('🚫', 'Enlace deshabilitado', 'Este enlace fue revocado por el equipo de LAMDA.');
                return;
            }
            if (sol.estado === 'EXPIRADA') {
                renderBloqueado('⏳', 'Enlace vencido', 'Este enlace venció luego de 7 días sin uso.');
                return;
            }

            // Cargar wizard activo
            $('lbl-saludo-cliente').textContent = `Hola ${sol.cliente_nombre} 👋`;
            if (sol.modo === 'ACTUALIZAR_EXISTENTE' && sol.domicilio_objetivo) {
                $('lbl-subtitulo-modo').textContent = `Revisá o corregí la ubicación de "${sol.domicilio_objetivo.alias || 'tu domicilio'}" en el mapa.`;
            } else {
                $('lbl-subtitulo-modo').textContent = 'Indicá en el mapa el punto exacto donde entregamos tu pedido.';
            }

            if (sol.nota_operador) {
                const noteEl = $('box-nota-operador');
                noteEl.textContent = `📝 Nota de LAMDA: ${sol.nota_operador}`;
                noteEl.classList.remove('hidden');
            }

            if (sol.modo === 'ALTA_NUEVA' && Array.isArray(sol.alias_existentes) && sol.alias_existentes.length > 0) {
                const boxEx = $('box-alias-existentes');
                boxEx.innerHTML = `Ya tenés cargado: <strong>${escHtml(sol.alias_existentes.join(', '))}</strong>. Estás sumando un nuevo punto de entrega.`;
                boxEx.classList.remove('hidden');
            }

            let latIni = DEFAULT_CENTER.lat;
            let lngIni = DEFAULT_CENTER.lng;
            let yaTieneCoords = false;

            if (sol.modo === 'ACTUALIZAR_EXISTENTE' && sol.domicilio_objetivo) {
                const dObj = sol.domicilio_objetivo;
                if (dObj.alias) {
                    $('inp-alias').value = dObj.alias;
                    state.aliasAutoFilled = false;
                }
                if (dObj.tipo_lugar) {
                    state.tipoLugar = dObj.tipo_lugar;
                    document.querySelectorAll('#chips-tipo-lugar .dom-chip').forEach(c => {
                        c.classList.toggle('active', c.dataset.tipo === dObj.tipo_lugar);
                    });
                }
                const parsed = parsearDireccionLegacyEnCampos(dObj.direccion);
                if (parsed.calle) { $('inp-calle').value = parsed.calle; $('inp-calle').dataset.auto = '0'; }
                if (parsed.numero) { $('inp-numero').value = parsed.numero; $('inp-numero').dataset.auto = '0'; }
                if (parsed.entre) $('inp-entre-calles').value = parsed.entre;
                if (dObj.localidad) { $('inp-localidad').value = dObj.localidad; $('inp-localidad').dataset.auto = '0'; }
                if (dObj.provincia) { $('inp-provincia').value = dObj.provincia; $('inp-provincia').dataset.auto = '0'; }
                if (dObj.codigo_postal) $('inp-cp').value = dObj.codigo_postal;
                if (dObj.instrucciones_entrega) $('inp-instrucciones').value = dObj.instrucciones_entrega;
                if (dObj.telefono_contacto) $('inp-telefono-recibe').value = dObj.telefono_contacto;
                if (dObj.horario_atencion_desde || dObj.horario_atencion_hasta) {
                    state.horarioMode = 'custom';
                    document.querySelectorAll('#chips-horario .dom-chip').forEach(c => {
                        c.classList.toggle('active', c.dataset.mode === 'custom');
                    });
                    $('box-horario-custom')?.classList.remove('hidden');
                    if (dObj.horario_atencion_desde) $('inp-hora-desde').value = dObj.horario_atencion_desde;
                    if (dObj.horario_atencion_hasta) $('inp-hora-hasta').value = dObj.horario_atencion_hasta;
                }
                if (Number.isFinite(dObj.latitud) && Number.isFinite(dObj.longitud)) {
                    latIni = dObj.latitud;
                    lngIni = dObj.longitud;
                    yaTieneCoords = true;
                }
            }

            mostrarVista('view-wizard');
            irAPaso(1);
            inicializarMapaLeaflet(latIni, lngIni, yaTieneCoords);
        } catch (err) {
            console.error('Error cargando solicitud:', err);
            renderBloqueado('⚠️', 'Error de conexión', 'No pudimos cargar el formulario. Verificá tu conexión e intentá nuevamente.');
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
