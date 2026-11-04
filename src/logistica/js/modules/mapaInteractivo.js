/**
 * Módulo de Mapa Interactivo (Estándar Módulo Logística)
 * Replicación exacta del motor cartográfico y geolocalizador de DomiciliosUI.js
 */

class MapaInteractivo {
    constructor() {
        this.map = null;
        this.marker = null;
        this.geocoder = null;
        this.coordenadas = { lat: null, lng: null };
        this.onCoordenadasChange = null;
        this.onDireccionChange = null;
    }
    
    /**
     * Inicializar mapa en un contenedor usando el motor de Google Maps Logística
     * @param {string} containerId - ID del contenedor HTML
     * @param {Object} opciones - Opciones de inicialización
     */
    async inicializar(containerId, opciones = {}) {
        const {
            lat = -34.9205, // La Plata Centro por defecto
            lng = -57.9536,
            zoom = 15,
            draggable = true
        } = opciones;
        
        try {
            if (typeof google === 'undefined' || !google.maps) {
                console.warn('[MAPA-LOGISTICA] Google Maps SDK no está disponible en este momento');
                return;
            }
            
            const container = document.getElementById(containerId);
            if (!container) return;
            
            const center = { lat, lng };
            
            this.map = new google.maps.Map(container, {
                center: center,
                zoom: zoom,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                zoomControl: true,
                mapTypeId: 'roadmap',
                gestureHandling: 'greedy'
            });
            
            this.geocoder = new google.maps.Geocoder();
            
            this.marker = new google.maps.Marker({
                position: center,
                map: this.map,
                draggable: draggable,
                animation: google.maps.Animation.DROP,
                title: 'Ubicación de entrega'
            });
            
            this.coordenadas = { lat, lng };
            
            if (draggable) {
                this.marker.addListener('dragend', () => {
                    const pos = this.marker.getPosition();
                    this.actualizarCoordenadas(pos.lat(), pos.lng());
                });
                
                this.map.addListener('click', (e) => {
                    const pos = e.latLng;
                    this.marker.setPosition(pos);
                    this.actualizarCoordenadas(pos.lat(), pos.lng());
                });
            }
            
            console.log('[MAPA-LOGISTICA] Mapa estándar de Logística inicializado correctamente');
        } catch (err) {
            console.error('[MAPA-LOGISTICA] Error al inicializar mapa:', err);
        }
    }

    actualizarCoordenadas(lat, lng) {
        this.coordenadas = { lat, lng };
        if (this.onCoordenadasChange) {
            this.onCoordenadasChange(lat, lng);
        }
    }
    
    /**
     * Geocoding: Obtener coordenadas desde dirección mediante el Geocoder estándar de Google
     * @param {string} direccion - Dirección a geocodificar
     * @returns {Promise<Object|null>} Coordenadas o null
     */
    async geocode(direccion) {
        if (!this.geocoder || !direccion) return null;
        
        return new Promise((resolve) => {
            const query = direccion.trim().toLowerCase().includes('argentina') ? direccion.trim() : `${direccion.trim()}, Argentina`;
            
            this.geocoder.geocode({ address: query }, (results, status) => {
                if (status === 'OK' && results && results[0]) {
                    const loc = results[0].geometry.location;
                    const coords = { lat: loc.lat(), lng: loc.lng() };
                    
                    if (this.map && this.marker) {
                        this.map.panTo(coords);
                        this.marker.setPosition(coords);
                        this.actualizarCoordenadas(coords.lat, coords.lng);
                    }
                    console.log('[MAPA-LOGISTICA] Geocodificación exitosa:', coords);
                    resolve(coords);
                } else {
                    console.log('[MAPA-LOGISTICA] Geocodificación sin resultados directos (status:', status, ')');
                    resolve(null);
                }
            });
        });
    }

    /**
     * Reverse Geocoding: Obtener componentes de dirección a partir de lat/lng
     * @param {number} lat - Latitud
     * @param {number} lng - Longitud
     * @returns {Promise<Object|null>} Componentes de dirección o null
     */
    async reverseGeocode(lat, lng) {
        if (!this.geocoder || !lat || !lng) return null;
        
        return new Promise((resolve) => {
            this.geocoder.geocode({ location: { lat, lng } }, (results, status) => {
                if (status === 'OK' && results && results[0]) {
                    const res = results[0];
                    let calle = '', numero = '', localidad = '', provincia = '';
                    
                    if (res.address_components) {
                        res.address_components.forEach(comp => {
                            if (comp.types.includes('route')) calle = comp.long_name;
                            if (comp.types.includes('street_number')) numero = comp.short_name;
                            if (comp.types.includes('locality')) localidad = comp.long_name;
                            if (comp.types.includes('administrative_area_level_1')) provincia = comp.long_name;
                        });
                    }
                    
                    const direccionStr = `${calle} ${numero}`.trim() || res.formatted_address.split(',')[0];
                    const resultado = {
                        direccion_completa: res.formatted_address,
                        calle: direccionStr,
                        localidad,
                        provincia
                    };
                    
                    if (this.onDireccionChange) {
                        this.onDireccionChange(resultado);
                    }
                    
                    resolve(resultado);
                } else {
                    resolve(null);
                }
            });
        });
    }
}

if (typeof window !== 'undefined') {
    window.MapaInteractivo = MapaInteractivo;
}
