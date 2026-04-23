// -------------------------------------------------------------
// CONTROLADOR DE ACOMODACIÓN (Google Maps + SortableJS) Fase 12
// -------------------------------------------------------------
let sortableInstance = null;
let currentMap = null;
let currentMarkers = [];
let currentPolyline = null;
let paradasTemporales = [];

window.abrirModalAcomodar = async () => {
    await cargarGoogleMapsMovil();
    document.getElementById('modal-acomodar-ruta').style.display = 'flex';
    paradasTemporales = [...agruparEntregasEnParadas(state.entregas)];
    renderizarListaCompacta();
    inicializarMapaAcomodar();
    iniciarSortable();
};

window.cerrarModalAcomodar = () => {
    document.getElementById('modal-acomodar-ruta').style.display = 'none';
};

window.guardarAcomodacion = async () => {
    const btn = document.getElementById('btn-guardar-acomodacion');
    btn.textContent = 'Guardando...';
    btn.disabled = true;

    const nuevoOrdenEntregas = paradasTemporales.flatMap(p => p.entregas);
    const nuevoOrdenIds = nuevoOrdenEntregas.map(e => parseInt(e.id_presupuesto));
    
    try {
        const res = await fetch(`${API_BASE_URL}/api/logistica/movil/rutas/${state.ruta.id}/reordenar`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${state.sesion.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ orden: nuevoOrdenIds })
        });
        const data = await res.json();
        if (data.success) {
            state.entregas = nuevoOrdenEntregas;
            renderizarEntregas();
            cerrarModalAcomodar();
        } else alert('Error al guardar: ' + data.error);
    } catch(err) { alert('Error de red al guardar ordenamiento.'); }
    finally {
        btn.textContent = '✅ Confirmar Orden';
        btn.disabled = false;
    }
};

async function cargarGoogleMapsMovil() {
    if (window.google && window.google.maps) return;
    try {
        const res = await fetch('/api/logistica/config');
        const data = await res.json();
        const apiKey = data.data?.googleMapsApiKey;
        if (!apiKey) return;
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
            script.onload = resolve;
            document.head.appendChild(script);
        });
    } catch(e) { console.error("[MAPA] Error cargando Maps", e); }
}

function inicializarMapaAcomodar() {
    if (!window.google) return;
    let lat = -34.6; let lng = -58.4;
    for (let p of paradasTemporales) {
        let d = p.entregas[0]?.domicilio;
        if (d && d.latitud && d.latitud !== 'null') { lat = parseFloat(d.latitud); lng = parseFloat(d.longitud); break; }
    }
    if (!currentMap) {
        currentMap = new google.maps.Map(document.getElementById('mapa-acomodar'), {
            center: { lat, lng }, zoom: 12, disableDefaultUI: true, zoomControl: true
        });
    }
    dibujarMapa();
}

function dibujarMapa() {
    if (!currentMap) return;
    currentMarkers.forEach(m => m.setMap(null)); currentMarkers = [];
    if (currentPolyline) currentPolyline.setMap(null);
    const path = []; const bounds = new google.maps.LatLngBounds();

    paradasTemporales.forEach((parada, index) => {
        const dom = parada.entregas[0]?.domicilio;
        if (dom && dom.latitud && dom.latitud !== 'null' && dom.longitud !== 'null') {
            const pos = { lat: parseFloat(dom.latitud), lng: parseFloat(dom.longitud) };
            path.push(pos); bounds.extend(pos);
            const marker = new google.maps.Marker({
                position: pos, map: currentMap,
                label: { text: (index + 1).toString(), color: 'white', fontWeight: 'bold' },
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 }
            });
            currentMarkers.push(marker);
        }
    });

    if (path.length > 1) {
        currentPolyline = new google.maps.Polyline({
            path: path, geodesic: true, strokeColor: '#2563eb', strokeOpacity: 0.8, strokeWeight: 4, map: currentMap
        });
    }
    if (path.length > 0) {
        currentMap.fitBounds(bounds);
        if (path.length === 1) currentMap.setZoom(15);
    }
}

function renderizarListaCompacta() {
    const list = document.getElementById('lista-acomodar');
    list.innerHTML = paradasTemporales.map((parada, index) => {
        const pE = parada.entregas[0];
        return `
            <div class="acomodar-item" data-key="${parada.key}" style="display: flex; align-items: center; padding: 14px; border-bottom: 1px solid #cbd5e1; background: white;">
                <div class="drag-handle" style="cursor: grab; padding-right: 16px; color: #94a3b8; font-size: 1.5rem;">☰</div>
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-weight: 800; color: #1e293b; font-size: 1rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                        <span style="background: #2563eb; color: white; padding: 3px 8px; border-radius: 6px; font-size: 0.85rem; margin-right: 8px; display: inline-block; width: 28px; text-align: center;">${index + 1}</span>
                        ${pE.cliente.nombre || 'Cliente #'+pE.cliente.id}
                    </div>
                    <div style="color: #64748b; font-size: 0.85rem; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        📍 ${pE.domicilio.direccion || 'Sin dirección registrada'}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function iniciarSortable() {
    const list = document.getElementById('lista-acomodar');
    if (sortableInstance) sortableInstance.destroy();
    if (typeof Sortable !== 'undefined') {
        sortableInstance = Sortable.create(list, {
            animation: 150, handle: '.drag-handle', ghostClass: 'sortable-ghost',
            onEnd: function (evt) {
                const item = paradasTemporales.splice(evt.oldIndex, 1)[0];
                paradasTemporales.splice(evt.newIndex, 0, item);
                dibujarMapa(); renderizarListaCompacta();
            }
        });
    }
}
