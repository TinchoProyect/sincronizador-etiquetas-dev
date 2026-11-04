/**
 * Modelo de Prospectos Búnker (CRM Contacto Calle y Depósito)
 * Capa de acceso a datos para public.bunker_prospectos, nodos, rutas_zona y cronograma semanal.
 */

const { pool } = require('../config/database');

class ProspectosModel {
    /**
     * Generar el siguiente código legible para prospecto (ej: PROSP-001)
     */
    static async generarSiguienteCodigo() {
        try {
            const res = await pool.query(`SELECT nextval('public.seq_bunker_prospectos_cod') as num`);
            const num = res.rows[0].num;
            return `PROSP-${String(num).padStart(3, '0')}`;
        } catch (e) {
            const fallback = await pool.query(`SELECT COUNT(id) + 1 as num FROM public.bunker_prospectos`);
            return `PROSP-${String(fallback.rows[0].num).padStart(3, '0')}`;
        }
    }

    /**
     * Normalizar array JSON de enteros o strings
     */
    static _normalizarArrayJson(val, asInt = false) {
        if (!val) return [];
        let arr = val;
        if (typeof val === 'string') {
            try { arr = JSON.parse(val); } catch (_) { arr = []; }
        }
        if (!Array.isArray(arr)) return [];
        return asInt
            ? arr.map(x => parseInt(x, 10)).filter(x => !isNaN(x))
            : arr.map(x => String(x).trim()).filter(Boolean);
    }

    /**
     * Obtener prospectos con filtros avanzados
     */
    static async obtenerTodos({ search, zona, estado, origen, soloHoy, limit = 200, offset = 0 } = {}) {
        let query = `
            SELECT p.id, p.codigo_prospecto, p.origen_contacto, p.nombre_fantasia, p.rubro,
                   p.direccion, p.localidad, p.zona, p.latitud, p.longitud,
                   p.contacto_nombre, p.contacto_rol, p.telefono_whatsapp, p.email,
                   p.estado, p.fecha_revisita, p.notas, p.lista_precios_sugerida_id,
                   p.creado_por, p.convertido_cliente_id, p.convertido_at, p.activo,
                   p.imagen_url, p.web_redes, p.id_ruta, p.orden_entrega, p.estado_ruta, p.fecha_visita_ruta,
                   COALESCE(p.en_pool_logistica, false) as en_pool_logistica,
                   p.cliente_activo_id, p.cliente_domicilio_id,
                   COALESCE(p.rutas_zona_ids, '[]'::jsonb) as rutas_zona_ids,
                   COALESCE(p.dias_turnos_puntuales, '[]'::jsonb) as dias_turnos_puntuales,
                   COALESCE(p.entramos_local, false) as entramos_local,
                   p.created_at, p.updated_at,
                   lp.nombre as lista_precios_nombre,
                   c.cliente_nombre as cliente_convertido_nombre,
                   c.codigo_bunker_cliente as cliente_convertido_codigo,
                   r.nombre_ruta as ruta_nombre,
                   r.estado as ruta_estado
            FROM public.bunker_prospectos p
            LEFT JOIN public.bunker_listas_precios lp ON lp.id = p.lista_precios_sugerida_id
            LEFT JOIN public.bunker_clientes c ON c.id = p.convertido_cliente_id
            LEFT JOIN public.rutas r ON r.id = p.id_ruta
            WHERE p.activo = true
        `;
        const params = [];
        let pIndex = 1;

        if (search && search.trim() !== '') {
            const term = `%${search.trim().toLowerCase()}%`;
            query += ` AND (
                LOWER(p.nombre_fantasia) ILIKE $${pIndex}
                OR LOWER(COALESCE(p.contacto_nombre, '')) ILIKE $${pIndex}
                OR LOWER(COALESCE(p.direccion, '')) ILIKE $${pIndex}
                OR LOWER(COALESCE(p.zona, '')) ILIKE $${pIndex}
                OR LOWER(COALESCE(p.telefono_whatsapp, '')) ILIKE $${pIndex}
                OR LOWER(COALESCE(p.notas, '')) ILIKE $${pIndex}
                OR LOWER(p.codigo_prospecto) ILIKE $${pIndex}
            )`;
            params.push(term);
            pIndex++;
        }

        if (zona && zona.trim() !== '') {
            query += ` AND p.zona = $${pIndex}`;
            params.push(zona.trim());
            pIndex++;
        }

        if (estado && estado.trim() !== '') {
            query += ` AND p.estado = $${pIndex}`;
            params.push(estado.trim());
            pIndex++;
        }

        if (origen && origen.trim() !== '') {
            query += ` AND p.origen_contacto = $${pIndex}`;
            params.push(origen.trim());
            pIndex++;
        }

        if (soloHoy === true || soloHoy === 'true') {
            query += ` AND p.fecha_revisita IS NOT NULL 
                       AND p.fecha_revisita::date <= CURRENT_DATE 
                       AND p.estado NOT IN ('CONVERTIDO', 'DESCARTADO')`;
        }

        query += ` ORDER BY 
            CASE 
                WHEN p.estado = 'VISITA_AGENDADA' AND p.fecha_revisita::date <= CURRENT_DATE THEN 1
                WHEN p.estado = 'VISITA_AGENDADA' THEN 2
                WHEN p.estado = 'POR_VISITAR' THEN 3
                WHEN p.estado = 'CONTACTO_INICIAL' THEN 4
                WHEN p.estado = 'LISTA_ENVIADA' THEN 5
                WHEN p.estado = 'EN_NEGOCIACION' THEN 6
                ELSE 7
            END ASC,
            p.created_at DESC
            LIMIT $${pIndex} OFFSET $${pIndex + 1}`;

        params.push(limit, offset);

        const res = await pool.query(query, params);
        return res.rows;
    }

    /**
     * Obtener prospecto por ID
     */
    static async obtenerPorId(id) {
        const query = `
            SELECT p.*,
                   COALESCE(p.rutas_zona_ids, '[]'::jsonb) as rutas_zona_ids,
                   COALESCE(p.dias_turnos_puntuales, '[]'::jsonb) as dias_turnos_puntuales,
                   COALESCE(p.entramos_local, false) as entramos_local,
                   lp.nombre as lista_precios_nombre,
                   c.cliente_nombre as cliente_convertido_nombre,
                   c.codigo_bunker_cliente as cliente_convertido_codigo
            FROM public.bunker_prospectos p
            LEFT JOIN public.bunker_listas_precios lp ON lp.id = p.lista_precios_sugerida_id
            LEFT JOIN public.bunker_clientes c ON c.id = p.convertido_cliente_id
            WHERE p.id = $1 AND p.activo = true
        `;
        const res = await pool.query(query, [id]);
        return res.rows[0] || null;
    }

    /**
     * Crear un nuevo prospecto
     */
    static async crear(datos) {
        const codigo = datos.codigo_prospecto || await this.generarSiguienteCodigo();
        const origen = datos.origen_contacto || 'CALLE';
        const nombreFantasia = (datos.nombre_fantasia || '').trim();
        const rubro = (datos.rubro || 'Dietética').trim();
        const direccion = (datos.direccion || '').trim() || null;
        const localidad = (datos.localidad || '').trim() || null;
        const zona = (datos.zona || '').trim() || null;
        const latitud = datos.latitud ? parseFloat(datos.latitud) : null;
        const longitud = datos.longitud ? parseFloat(datos.longitud) : null;
        const contactoNombre = (datos.contacto_nombre || '').trim() || null;
        const contactoRol = (datos.contacto_rol || 'OTRO').toUpperCase().trim();
        const telefonoWhatsapp = (datos.telefono_whatsapp || '').trim() || null;
        const email = (datos.email || '').trim() || null;
        const estado = (datos.estado || 'POR_VISITAR').toUpperCase().trim();
        const fechaRevisita = datos.fecha_revisita ? new Date(datos.fecha_revisita) : null;
        const notas = (datos.notas || '').trim() || null;
        const listaSugeridaId = datos.lista_precios_sugerida_id ? parseInt(datos.lista_precios_sugerida_id) : null;
        const creadoPor = (datos.creado_por || 'sistema').trim();
        const imagenUrl = (datos.imagen_url || '').trim() || null;
        const webRedes = (datos.web_redes || '').trim() || null;
        const rutasZonaIds = JSON.stringify(this._normalizarArrayJson(datos.rutas_zona_ids, true));
        const diasTurnosPuntuales = JSON.stringify(this._normalizarArrayJson(datos.dias_turnos_puntuales, false));
        const entramosLocal = Boolean(datos.entramos_local);

        if (!nombreFantasia) {
            throw new Error('El nombre del negocio o referencia del comercio es obligatorio.');
        }

        const query = `
            INSERT INTO public.bunker_prospectos (
                codigo_prospecto, origen_contacto, nombre_fantasia, rubro,
                direccion, localidad, zona, latitud, longitud,
                contacto_nombre, contacto_rol, telefono_whatsapp, email,
                estado, fecha_revisita, notas, lista_precios_sugerida_id,
                creado_por, imagen_url, web_redes,
                rutas_zona_ids, dias_turnos_puntuales, entramos_local
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8, $9,
                $10, $11, $12, $13,
                $14, $15, $16, $17,
                $18, $19, $20,
                $21::jsonb, $22::jsonb, $23
            ) RETURNING *;
        `;

        const values = [
            codigo, origen, nombreFantasia, rubro,
            direccion, localidad, zona, latitud, longitud,
            contactoNombre, contactoRol, telefonoWhatsapp, email,
            estado, fechaRevisita, notas, listaSugeridaId,
            creadoPor, imagenUrl, webRedes,
            rutasZonaIds, diasTurnosPuntuales, entramosLocal
        ];

        const res = await pool.query(query, values);
        return res.rows[0];
    }

    /**
     * Actualizar datos de un prospecto
     */
    static async actualizar(id, datos) {
        const existente = await this.obtenerPorId(id);
        if (!existente) {
            throw new Error(`Prospecto #${id} no encontrado.`);
        }

        const nombreFantasia = datos.nombre_fantasia !== undefined ? datos.nombre_fantasia.trim() : existente.nombre_fantasia;
        const rubro = datos.rubro !== undefined ? datos.rubro.trim() : existente.rubro;
        const direccion = datos.direccion !== undefined ? (datos.direccion ? datos.direccion.trim() : null) : existente.direccion;
        const localidad = datos.localidad !== undefined ? (datos.localidad ? datos.localidad.trim() : null) : existente.localidad;
        const zona = datos.zona !== undefined ? (datos.zona ? datos.zona.trim() : null) : existente.zona;
        const latitud = datos.latitud !== undefined ? (datos.latitud ? parseFloat(datos.latitud) : null) : existente.latitud;
        const longitud = datos.longitud !== undefined ? (datos.longitud ? datos.longitud.length === 0 ? null : parseFloat(datos.longitud) : null) : existente.longitud;
        const contactoNombre = datos.contacto_nombre !== undefined ? (datos.contacto_nombre ? datos.contacto_nombre.trim() : null) : existente.contacto_nombre;
        const contactoRol = datos.contacto_rol !== undefined ? datos.contacto_rol.toUpperCase().trim() : existente.contacto_rol;
        const telefonoWhatsapp = datos.telefono_whatsapp !== undefined ? (datos.telefono_whatsapp ? datos.telefono_whatsapp.trim() : null) : existente.telefono_whatsapp;
        const email = datos.email !== undefined ? (datos.email ? datos.email.trim() : null) : existente.email;
        const estado = datos.estado !== undefined ? datos.estado.toUpperCase().trim() : existente.estado;
        const fechaRevisita = datos.fecha_revisita !== undefined ? (datos.fecha_revisita ? new Date(datos.fecha_revisita) : null) : existente.fecha_revisita;
        const notas = datos.notas !== undefined ? (datos.notas ? datos.notas.trim() : null) : existente.notas;
        const listaSugeridaId = datos.lista_precios_sugerida_id !== undefined ? (datos.lista_precios_sugerida_id ? parseInt(datos.lista_precios_sugerida_id) : null) : existente.lista_precios_sugerida_id;
        const imagenUrl = datos.imagen_url !== undefined ? (datos.imagen_url ? datos.imagen_url.trim() : null) : existente.imagen_url;
        const webRedes = datos.web_redes !== undefined ? (datos.web_redes ? datos.web_redes.trim() : null) : existente.web_redes;
        const rutasZonaIds = datos.rutas_zona_ids !== undefined
            ? JSON.stringify(this._normalizarArrayJson(datos.rutas_zona_ids, true))
            : JSON.stringify(this._normalizarArrayJson(existente.rutas_zona_ids, true));
        const diasTurnosPuntuales = datos.dias_turnos_puntuales !== undefined
            ? JSON.stringify(this._normalizarArrayJson(datos.dias_turnos_puntuales, false))
            : JSON.stringify(this._normalizarArrayJson(existente.dias_turnos_puntuales, false));
        const entramosLocal = datos.entramos_local !== undefined ? Boolean(datos.entramos_local) : Boolean(existente.entramos_local);

        const query = `
            UPDATE public.bunker_prospectos
            SET nombre_fantasia = $1,
                rubro = $2,
                direccion = $3,
                localidad = $4,
                zona = $5,
                latitud = $6,
                longitud = $7,
                contacto_nombre = $8,
                contacto_rol = $9,
                telefono_whatsapp = $10,
                email = $11,
                estado = $12,
                fecha_revisita = $13,
                notas = $14,
                lista_precios_sugerida_id = $15,
                imagen_url = $16,
                web_redes = $17,
                rutas_zona_ids = $18::jsonb,
                dias_turnos_puntuales = $19::jsonb,
                entramos_local = $20,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $21
            RETURNING *;
        `;

        const values = [
            nombreFantasia, rubro, direccion, localidad, zona,
            latitud, longitud, contactoNombre, contactoRol, telefonoWhatsapp,
            email, estado, fechaRevisita, notas, listaSugeridaId,
            imagenUrl, webRedes, rutasZonaIds, diasTurnosPuntuales, entramosLocal,
            id
        ];

        const res = await pool.query(query, values);
        return res.rows[0];
    }

    /**
     * Vincular rápidamente un prospecto a Rutas/Zonas y/o Días-Turnos puntuales
     */
    static async vincularRutasZona(id, { rutas_zona_ids, dias_turnos_puntuales } = {}) {
        const existente = await this.obtenerPorId(id);
        if (!existente) throw new Error(`Contacto #${id} no encontrado.`);

        const rIds = rutas_zona_ids !== undefined
            ? JSON.stringify(this._normalizarArrayJson(rutas_zona_ids, true))
            : JSON.stringify(this._normalizarArrayJson(existente.rutas_zona_ids, true));
        const dTurnos = dias_turnos_puntuales !== undefined
            ? JSON.stringify(this._normalizarArrayJson(dias_turnos_puntuales, false))
            : JSON.stringify(this._normalizarArrayJson(existente.dias_turnos_puntuales, false));

        const res = await pool.query(`
            UPDATE public.bunker_prospectos
            SET rutas_zona_ids = $1::jsonb,
                dias_turnos_puntuales = $2::jsonb,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *;
        `, [rIds, dTurnos, id]);
        return res.rows[0];
    }

    /**
     * Cambiar estado rápido y opcionalmente reprogramar fecha o lista de precios sugerida
     */
    static async cambiarEstado(id, nuevoEstado, { notas, fecha_revisita, lista_precios_sugerida_id } = {}) {
        let query = `
            UPDATE public.bunker_prospectos
            SET estado = $1,
                updated_at = CURRENT_TIMESTAMP
        `;
        const params = [nuevoEstado.toUpperCase().trim()];
        let pIndex = 2;

        if (notas !== undefined) {
            query += `, notas = $${pIndex}`;
            params.push(notas);
            pIndex++;
        }

        if (fecha_revisita !== undefined) {
            query += `, fecha_revisita = $${pIndex}`;
            params.push(fecha_revisita ? new Date(fecha_revisita) : null);
            pIndex++;
        }

        if (lista_precios_sugerida_id !== undefined) {
            query += `, lista_precios_sugerida_id = $${pIndex}`;
            params.push(lista_precios_sugerida_id ? parseInt(lista_precios_sugerida_id) : null);
            pIndex++;
        }

        query += ` WHERE id = $${pIndex} RETURNING *;`;
        params.push(id);

        const res = await pool.query(query, params);
        return res.rows[0];
    }

    /**
     * Marcar como convertido a cliente oficial
     */
    static async convertirACliente(id, bunkerClienteId) {
        const query = `
            UPDATE public.bunker_prospectos
            SET estado = 'CONVERTIDO',
                convertido_cliente_id = $1,
                convertido_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *;
        `;
        const res = await pool.query(query, [bunkerClienteId, id]);
        return res.rows[0];
    }

    /**
     * Obtener listado de zonas existentes
     */
    static async obtenerZonas() {
        const res = await pool.query(`
            SELECT DISTINCT zona 
            FROM public.bunker_prospectos 
            WHERE zona IS NOT NULL AND zona <> '' AND activo = true
            ORDER BY zona ASC;
        `);
        return res.rows.map(r => r.zona);
    }

    /**
     * Obtener métricas rápidas para el dashboard (hoy, total, agenda, conversión)
     */
    static async obtenerMetricas() {
        const query = `
            SELECT 
                COUNT(*) FILTER (WHERE activo = true AND origen_contacto != 'CLIENTE_ACTIVO') as total_activos,
                COUNT(*) FILTER (WHERE activo = true AND origen_contacto NOT IN ('RADAR_WEB', 'CLIENTE_ACTIVO')) as total_territorio,
                COUNT(*) FILTER (WHERE activo = true AND origen_contacto = 'RADAR_WEB') as total_web,
                COUNT(*) FILTER (WHERE activo = true AND estado = 'POR_VISITAR') as total_por_visitar,
                COUNT(*) FILTER (WHERE activo = true AND estado = 'CONTACTO_INICIAL') as total_iniciales,
                COUNT(*) FILTER (WHERE activo = true AND estado = 'LISTA_ENVIADA') as total_listas_enviadas,
                COUNT(*) FILTER (WHERE activo = true AND estado = 'VISITA_AGENDADA' AND fecha_revisita::date = CURRENT_DATE) as visitas_hoy,
                COUNT(*) FILTER (WHERE activo = true AND estado = 'VISITA_AGENDADA' AND fecha_revisita::date < CURRENT_DATE) as visitas_atrasadas,
                COUNT(*) FILTER (WHERE estado = 'CONVERTIDO') as total_convertidos,
                COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as captados_hoy
            FROM public.bunker_prospectos;
        `;
        const res = await pool.query(query);
        return res.rows[0];
    }

    /**
     * Obtener listas de precios Bunker disponibles
     */
    static async obtenerListasPrecios() {
        const res = await pool.query(`
            SELECT id, nombre, descripcion 
            FROM public.bunker_listas_precios 
            ORDER BY id ASC;
        `);
        return res.rows;
    }

    /**
     * Obtener métricas detalladas para el embudo de conversión y rendimiento por zona
     */
    static async obtenerMetricasEmbudo() {
        const res = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE activo = true) as total_prospectos,
                COUNT(*) FILTER (WHERE activo = true AND estado IN ('LISTA_ENVIADA', 'VISITA_AGENDADA', 'EN_NEGOCIACION', 'CONVERTIDO')) as etapa_lista_enviada,
                COUNT(*) FILTER (WHERE activo = true AND estado IN ('VISITA_AGENDADA', 'EN_NEGOCIACION', 'CONVERTIDO')) as etapa_agendados,
                COUNT(*) FILTER (WHERE estado = 'CONVERTIDO') as etapa_convertidos,
                COUNT(*) FILTER (WHERE estado = 'DESCARTADO') as etapa_descartados
            FROM public.bunker_prospectos;
        `);
        const porZona = await pool.query(`
            SELECT 
                COALESCE(zona, 'Sin Zona') as zona,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE estado = 'CONVERTIDO') as convertidos,
                COUNT(*) FILTER (WHERE estado = 'VISITA_AGENDADA') as agendados
            FROM public.bunker_prospectos
            WHERE activo = true
            GROUP BY zona
            ORDER BY total DESC
            LIMIT 10;
        `);
        return {
            funnel: res.rows[0],
            zonas: porZona.rows
        };
    }

    /**
     * ==========================================================
     * CONFIGURACIÓN DE NODOS, RUTAS/ZONAS LINEALES Y CRONOGRAMA
     * ==========================================================
     */
    static async obtenerConfiguracionRutasDias() {
        const nodosRes = await pool.query(`
            SELECT * FROM public.contacto_calle_nodos
            WHERE activo = true
            ORDER BY orden ASC, id ASC
        `);

        const rutasRes = await pool.query(`
            SELECT rz.*,
                   ns.nombre as nodo_salida_nombre, ns.icono as nodo_salida_icono,
                   ns.latitud as nodo_salida_lat, ns.longitud as nodo_salida_lng,
                   nl.nombre as nodo_llegada_nombre, nl.icono as nodo_llegada_icono,
                   nl.latitud as nodo_llegada_lat, nl.longitud as nodo_llegada_lng
            FROM public.contacto_calle_rutas_zona rz
            LEFT JOIN public.contacto_calle_nodos ns ON ns.id = rz.nodo_salida_id
            LEFT JOIN public.contacto_calle_nodos nl ON nl.id = rz.nodo_llegada_id
            WHERE rz.activo = true
            ORDER BY rz.id ASC
        `);

        const cronoRes = await pool.query(`
            SELECT c.*,
                   rz.nombre as ruta_zona_nombre,
                   rz.color as ruta_zona_color,
                   rz.calles_involucradas as ruta_zona_calles
            FROM public.contacto_calle_cronograma c
            INNER JOIN public.contacto_calle_rutas_zona rz ON rz.id = c.ruta_zona_id AND rz.activo = true
            ORDER BY c.dia_semana ASC, CASE WHEN c.turno = 'MANANA' THEN 1 ELSE 2 END ASC, c.id ASC
        `);

        return {
            nodos: nodosRes.rows,
            rutas_zona: rutasRes.rows,
            cronograma: cronoRes.rows
        };
    }

    static async guardarNodo(datos) {
        const id = datos.id ? parseInt(datos.id, 10) : null;
        const nombre = (datos.nombre || '').trim();
        if (!nombre) throw new Error('El nombre del punto/nodo es obligatorio.');
        const icono = (datos.icono || '📍').trim();
        const direccion = (datos.direccion || '').trim() || null;
        const localidad = (datos.localidad || 'La Plata').trim();
        const latitud = datos.latitud !== undefined && datos.latitud !== '' && datos.latitud !== null ? parseFloat(datos.latitud) : null;
        const longitud = datos.longitud !== undefined && datos.longitud !== '' && datos.longitud !== null ? parseFloat(datos.longitud) : null;

        if (id) {
            const res = await pool.query(`
                UPDATE public.contacto_calle_nodos
                SET nombre = $1, icono = $2, direccion = $3, localidad = $4, latitud = $5, longitud = $6, updated_at = NOW()
                WHERE id = $7
                RETURNING *
            `, [nombre, icono, direccion, localidad, latitud, longitud, id]);
            return res.rows[0];
        } else {
            const codigo = 'NODO_' + Date.now();
            const res = await pool.query(`
                INSERT INTO public.contacto_calle_nodos (codigo, nombre, icono, direccion, localidad, latitud, longitud, orden)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 10)
                RETURNING *
            `, [codigo, nombre, icono, direccion, localidad, latitud, longitud]);
            return res.rows[0];
        }
    }

    static async eliminarNodo(id) {
        await pool.query(`UPDATE public.contacto_calle_nodos SET activo = false WHERE id = $1 AND codigo NOT IN ('CASA', 'DEPOSITO')`, [id]);
        return true;
    }

    static async guardarRutaZona(datos) {
        const id = datos.id ? parseInt(datos.id, 10) : null;
        const nombre = (datos.nombre || '').trim();
        if (!nombre) throw new Error('El nombre de la Ruta/Zona es obligatorio.');
        const color = (datos.color || '#ea580c').trim();
        const nodoSalidaId = datos.nodo_salida_id ? parseInt(datos.nodo_salida_id, 10) : null;
        const nodoLlegadaId = datos.nodo_llegada_id ? parseInt(datos.nodo_llegada_id, 10) : null;
        const calles = (datos.calles_involucradas || '').trim() || null;
        const notas = (datos.notas || '').trim() || null;
        const waypoints = Array.isArray(datos.waypoints_json) ? JSON.stringify(datos.waypoints_json) : '[]';
        const anchoMetros = datos.ancho_metros ? parseInt(datos.ancho_metros, 10) : 350;
        const poligonoJson = Array.isArray(datos.poligono_json) ? JSON.stringify(datos.poligono_json) : '[]';

        let rutaGuardada;
        if (id) {
            const res = await pool.query(`
                UPDATE public.contacto_calle_rutas_zona
                SET nombre = $1, color = $2, nodo_salida_id = $3, nodo_llegada_id = $4,
                    calles_involucradas = $5, notas = $6, waypoints_json = $7::jsonb,
                    ancho_metros = $8, poligono_json = $9::jsonb, updated_at = NOW()
                WHERE id = $10
                RETURNING *
            `, [nombre, color, nodoSalidaId, nodoLlegadaId, calles, notas, waypoints, anchoMetros, poligonoJson, id]);
            rutaGuardada = res.rows[0];
        } else {
            const res = await pool.query(`
                INSERT INTO public.contacto_calle_rutas_zona (nombre, color, nodo_salida_id, nodo_llegada_id, calles_involucradas, notas, waypoints_json, ancho_metros, poligono_json)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)
                RETURNING *
            `, [nombre, color, nodoSalidaId, nodoLlegadaId, calles, notas, waypoints, anchoMetros, poligonoJson]);
            rutaGuardada = res.rows[0];
        }

        // Si envía dias_turnos (ej. ["1_MANANA", "3_TARDE"]), sincronizar el cronograma de esta ruta_zona
        if (Array.isArray(datos.dias_turnos) && rutaGuardada) {
            await pool.query(`DELETE FROM public.contacto_calle_cronograma WHERE ruta_zona_id = $1`, [rutaGuardada.id]);
            for (const token of datos.dias_turnos) {
                const [dStr, turnoStr] = String(token).split('_');
                const dia = parseInt(dStr, 10);
                const turno = (turnoStr || '').toUpperCase();
                if (dia >= 1 && dia <= 7 && (turno === 'MANANA' || turno === 'TARDE')) {
                    await pool.query(`
                        INSERT INTO public.contacto_calle_cronograma (dia_semana, turno, ruta_zona_id)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (dia_semana, turno, ruta_zona_id) DO NOTHING
                    `, [dia, turno, rutaGuardada.id]);
                }
            }
        }

        // Si envía ids_contactos_adentro, asegurar que queden vinculados a esta ruta_zona
        if (Array.isArray(datos.ids_contactos_adentro) && rutaGuardada) {
            const rIdNum = Number(rutaGuardada.id);
            const todosRes = await pool.query(`SELECT id, COALESCE(rutas_zona_ids, '[]'::jsonb) as r_ids FROM public.bunker_prospectos WHERE activo = true`);
            const setAdentro = new Set(datos.ids_contactos_adentro.map(Number));
            for (const row of todosRes.rows) {
                let arr = Array.isArray(row.r_ids) ? row.r_ids.map(Number) : [];
                const tiene = arr.includes(rIdNum);
                const debeTener = setAdentro.has(Number(row.id));
                if (debeTener && !tiene) {
                    arr.push(rIdNum);
                    await pool.query(`UPDATE public.bunker_prospectos SET rutas_zona_ids = $1::jsonb WHERE id = $2`, [JSON.stringify(arr), row.id]);
                }
            }
        }

        return rutaGuardada;
    }

    static async eliminarRutaZona(id) {
        await pool.query(`UPDATE public.contacto_calle_rutas_zona SET activo = false, updated_at = NOW() WHERE id = $1`, [id]);
        await pool.query(`DELETE FROM public.contacto_calle_cronograma WHERE ruta_zona_id = $1`, [id]);
        return true;
    }

    static async actualizarCronogramaBloque({ dia_semana, turno, ruta_zona_ids }) {
        const dia = parseInt(dia_semana, 10);
        const t = String(turno || '').toUpperCase().trim();
        if (dia < 1 || dia > 7 || !['MANANA', 'TARDE'].includes(t)) {
            throw new Error('Día de semana (1..7) o turno (MANANA/TARDE) inválido.');
        }

        const ids = this._normalizarArrayJson(ruta_zona_ids, true);
        await pool.query(`DELETE FROM public.contacto_calle_cronograma WHERE dia_semana = $1 AND turno = $2`, [dia, t]);

        for (const rId of ids) {
            await pool.query(`
                INSERT INTO public.contacto_calle_cronograma (dia_semana, turno, ruta_zona_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (dia_semana, turno, ruta_zona_id) DO NOTHING
            `, [dia, t, rId]);
        }

        return await this.obtenerConfiguracionRutasDias();
    }

    /**
     * Enviar o retirar un contacto del Pool de Logística (Operación manual de operador)
     */
    static async cambiarPoolLogistica(id, enPool = true) {
        const flag = Boolean(enPool);
        const query = flag
            ? `UPDATE public.bunker_prospectos
               SET en_pool_logistica = true,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $1
               RETURNING *;`
            : `UPDATE public.bunker_prospectos
               SET en_pool_logistica = false,
                   id_ruta = NULL,
                   orden_entrega = 999,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $1
               RETURNING *;`;
        const res = await pool.query(query, [id]);
        return res.rows[0] || null;
    }

    /**
     * Baja lógica
     */
    static async eliminar(id) {
        const res = await pool.query(`
            UPDATE public.bunker_prospectos 
            SET activo = false, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $1 RETURNING id;
        `, [id]);
        return res.rows.length > 0;
    }
}

module.exports = ProspectosModel;
