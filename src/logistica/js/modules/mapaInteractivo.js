/**
 * Módulo de Mapa Interactivo
 * Gestión del mapa con pin-drop para selección de ubicación
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
     * Inicializar mapa en un contenedor
     * @param {string} containerId - ID del contenedor HTML
     * @param {Object} opciones - Opciones de inicialización
     */
    async inicializar(containerId, opciones = {}) {
        const {
            lat = -26.8241,  // Tucumán por defecto
            lng = -65.2226,
            zoom = 15,
            draggable = true
        } = opciones;
        
        try {
            // Verificar que Google Maps esté cargado
            if (typeof google === 'undefined' || !google.maps) {
                throw new Error('Google Maps no está cargado');
            }
            
            const container = document.getElementById(containerId);
            if (!container) {
                throw new Error(`Contenedor ${containerId} no encontrado`);
            }
            
            // Crear mapa
            this.map = new google.maps.Map(container, {
                center: { lat, lng },
                zoom: zoom,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                zoomControl: true
            });
            
            // Crear marker draggable
            this.marker = new google.maps.Marker({
                position: { lat, lng },
                map: this.map,
                draggable: draggable,
                title: 'Arrastra para seleccionar ubicación',
                animation: google.maps.Animation.DROP
            });
            
            // Inicializar geocoder
            this.geocoder = new google.maps.Geocoder();
            
            // Guardar coordenadas iniciales
            this.coordenadas = { lat, lng };
            
            // Event listener para drag del marker
            this.marker.addListener('dragend', (event) => {
                this.actualizarCoordenadas(
                    event.latLng.lat(),
                    event.latLng.lng()
                );
            });
            
            // Event listener para click en el mapa
            this.map.addListener('click', (event) => {
                this.moverMarker(
                    event.latLng.lat(),
                    event.latLng.lng()
                );
            });
            
            console.log('[MAPA] Mapa inicializado correctamente');
            
            return true;
            
        } catch (error) {
            console.error('[MAPA] Error al inicializar:', error);
            throw error;
        }
    }
    
    /**
     * Mover marker a una nueva posición
     * @param {number} lat - Latitud
     * @param {number} lng - Longitud
     */
    moverMarker(lat, lng) {
        if (!this.marker) return;
        
        const position = { lat, lng };
        this.marker.setPosition(position);
        this.map.panTo(position);
        
        this.actualizarCoordenadas(lat, lng);
    }
    
    /**
     * Actualizar coordenadas y ejecutar callbacks
     * @param {number} lat - Latitud
     * @param {number} lng - Longitud
     */
    async actualizarCoordenadas(lat, lng) {
        this.coordenadas = { lat, lng };
        
        console.log('[MAPA] Coordenadas actualizadas:', this.coordenadas);
        
        // Callback de coordenadas
        if (this.onCoordenadasChange) {
            this.onCoordenadasChange(lat, lng);
        }
        
        // Reverse geocoding automático
        try {
            const direccion = await this.reverseGeocode(lat, lng);
            
            if (direccion && this.onDireccionChange) {
                this.onDireccionChange(direccion);
            }
        } catch (error) {
            console.warn('[MAPA] Error en reverse geocoding:', error);
        }
    }
    
    /**
     * Reverse Geocoding: Obtener dirección desde coordenadas
     * @param {number} lat - Latitud
     * @param {number} lng - Longitud
     * @returns {Promise<Object>} Datos de la dirección
     */
    async reverseGeocode(lat, lng) {
        if (!this.geocoder) {
            throw new Error('Geocoder no inicializado');
        }
        
        return new Promise((resolve, reject) => {
            this.geocoder.geocode(
                { location: { lat, lng } },
                (results, status) => {
                    if (status === 'OK' && results[0]) {
                        const result = results[0];
                        
                        // Extraer componentes de la dirección
                        const componentes = this.extraerComponentes(result.address_components);
                        
                        const direccion = {
                            direccion_completa: result.formatted_address,
                            calle: componentes.route || '',
                            numero: componentes.street_number || '',
                            localidad: componentes.locality || componentes.administrative_area_level_2 || '',
                            provincia: componentes.administrative_area_level_1 || '',
                            codigo_postal: componentes.postal_code || '',
                            pais: componentes.country || 'Argentina'
                        };
                        
                        console.log('[MAPA] Reverse geocoding exitoso:', direccion);
                        resolve(direccion);
                        
                    } else {
                        console.warn('[MAPA] Reverse geocoding falló:', status);
                        reject(new Error(`Geocoding falló: ${status}`));
                    }
                }
            );
        });
    }
    
    /**
     * Extraer componentes de dirección de Google Maps
     * @param {Array} addressComponents - Componentes de Google Maps
     * @returns {Object} Componentes extraídos
     */
    extraerComponentes(addressComponents) {
        const componentes = {};
        
        addressComponents.forEach(component => {
            const types = component.types;
            
            if (types.includes('street_number')) {
                componentes.street_number = component.long_name;
            }
            if (types.includes('route')) {
                componentes.route = component.long_name;
            }
            if (types.includes('locality')) {
                componentes.locality = component.long_name;
            }
            if (types.includes('administrative_area_level_2')) {
                componentes.administrative_area_level_2 = component.long_name;
            }
            if (types.includes('administrative_area_level_1')) {
                componentes.administrative_area_level_1 = component.long_name;
            }
            if (types.includes('postal_code')) {
                componentes.postal_code = component.long_name;
            }
            if (types.includes('country')) {
                componentes.country = component.long_name;
            }
        });
        
        return componentes;
    }
    
    /**
     * Geocoding: Obtener coordenadas desde dirección
     * @param {string} direccion - Dirección a geocodificar
     * @returns {Promise<Object>} Coordenadas
     */
    async geocode(direccion) {
        if (!this.geocoder) {
            throw new Error('Geocoder no inicializado');
        }
        
        return new Promise((resolve, reject) => {
            this.geocoder.geocode(
                { address: direccion + ', Argentina' },
                (results, status) => {
                    if (status === 'OK' && results[0]) {
                        const location = results[0].geometry.location;
                        const coordenadas = {
                            lat: location.lat(),
                            lng: location.lng()
                        };
                        
                        console.log('[MAPA] Geocoding exitoso:', coordenadas);
                        resolve(coordenadas);
                        
                    } else {
                        console.warn('[MAPA] Geocoding falló:', status);
                        reject(new Error(`Geocoding falló: ${status}`));
                    }
                }
            );
        });
    }
    
    /**
     * Centrar mapa en una dirección
     * @param {string} direccion - Dirección a buscar
     */
    async centrarEnDireccion(direccion) {
        try {
            const coordenadas = await this.geocode(direccion);
            this.moverMarker(coordenadas.lat, coordenadas.lng);
            return coordenadas;
        } catch (error) {
            console.error('[MAPA] Error al centrar en dirección:', error);
            throw error;
        }
    }
    
    /**
     * Obtener coordenadas actuales
     * @returns {Object} Coordenadas {lat, lng}
     */
    obtenerCoordenadas() {
        return { ...this.coordenadas };
    }
    
    /**
     * Posicionar marcador en coordenadas específicas (para edición)
     * @param {number} lat - Latitud
     * @param {number} lng - Longitud
     */
    posicionarMarcador(lat, lng) {
        if (!this.map || !this.marker) {
            console.warn('[MAPA] Mapa no inicializado');
            return;
        }
        
        const position = { lat, lng };
        
        // Mover marcador
        this.marker.setPosition(position);
        
        // Centrar mapa
        this.map.setCenter(position);
        this.map.setZoom(16);
        
        // Actualizar coordenadas internas
        this.coordenadas = { lat, lng };
        
        // Disparar callback
        if (this.onCoordenadasChange) {
            this.onCoordenadasChange(lat, lng);
        }
        
        // Hacer reverse geocoding
        this.reverseGeocode(lat, lng).catch(err => {
            console.warn('[MAPA] Error en reverse geocoding:', err);
        });
        
        console.log('[MAPA] Marcador posicionado en:', lat, lng);
    }
    
    /**
     * Destruir mapa y limpiar recursos
     */
    destruir() {
        if (this.marker) {
            this.marker.setMap(null);
            this.marker = null;
        }
        
        if (this.map) {
            this.map = null;
        }
        
        this.geocoder = null;
        this.coordenadas = { lat: null, lng: null };
        this.onCoordenadasChange = null;
        this.onDireccionChange = null;
        
        console.log('[MAPA] Mapa destruido');
    }
}

// Exportar para uso global
window.MapaInteractivo = MapaInteractivo;
