/**
 * Gestión de estado y marcadores para modo Forward-Only
 */

const { pool } = require('../../presupuestos/config/database');
const { readSheetWithHeaders } = require('./client_with_logs');

/**
 * Configuración persistente para Forward-Only
 */
class ForwardOnlyState {
    constructor() {
        this.config = {
            FORWARD_ONLY_MODE: false,
            CUTOFF_AT: null,
            LAST_SEEN_LOCAL_ID: 0,
            LAST_SEEN_SHEET_ROW: 0
        };
    }

    /**
     * Cargar configuración desde base de datos
     */
    async loadConfig() {
        try {
            const result = await pool.query(`
                SELECT forward_only_mode, cutoff_at, last_seen_local_id, last_seen_sheet_row
                FROM presupuestos_config 
                WHERE activo = true
                ORDER BY id DESC
                LIMIT 1
            `);

            if (result.rows.length > 0) {
                const row = result.rows[0];
                this.config = {
                    FORWARD_ONLY_MODE: row.forward_only_mode || false,
                    CUTOFF_AT: row.cutoff_at || null,
                    LAST_SEEN_LOCAL_ID: row.last_seen_local_id || 0,
                    LAST_SEEN_SHEET_ROW: row.last_seen_sheet_row || 0
                };
            }

            return this.config;
        } catch (error) {
            console.error('[FORWARD-ONLY-STATE] Error cargando configuración:', error.message);
            return this.config;
        }
    }

    /**
     * Guardar configuración en base de datos
     */
    async saveConfig() {
        try {
            await pool.query('BEGIN');

            // Actualizar el registro activo
            await pool.query(`
                UPDATE presupuestos_config 
                SET forward_only_mode = $1,
                    cutoff_at = $2,
                    last_seen_local_id = $3,
                    last_seen_sheet_row = $4,
                    fecha_modificacion = now()
                WHERE activo = true
            `, [
                this.config.FORWARD_ONLY_MODE,
                this.config.CUTOFF_AT,
                this.config.LAST_SEEN_LOCAL_ID,
                this.config.LAST_SEEN_SHEET_ROW
            ]);

            await pool.query('COMMIT');
            return true;
        } catch (error) {
            await pool.query('ROLLBACK');
            console.error('[FORWARD-ONLY-STATE] Error guardando configuración:', error.message);
            return false;
        }
    }

    /**
     * Habilitar modo Forward-Only con setup inicial
     */
    async enableForwardOnly(sheetsConfig) {
        console.log('[FORWARD-ONLY-STATE] Habilitando modo Forward-Only...');

        try {
            // 1. Establecer CUTOFF_AT = now()
            const cutoffAt = new Date().toISOString();
            
            // 2. Obtener LAST_SEEN_LOCAL_ID = MAX(presupuestos_detalles.id)
            const localMaxResult = await pool.query(`
                SELECT COALESCE(MAX(id), 0) as max_id 
                FROM presupuestos_detalles
            `);
            const lastSeenLocalId = localMaxResult.rows[0].max_id;

            // 3. Obtener LAST_SEEN_SHEET_ROW = MAX(_rowIndex en DetallesPresupuestos)
            const sheetsData = await readSheetWithHeaders(sheetsConfig.hoja_id, 'A:Q', 'DetallesPresupuestos');
            const lastSeenSheetRow = sheetsData.rows ? Math.max(...sheetsData.rows.map(row => row._rowIndex || 0)) : 0;

            // 4. Actualizar configuración
            this.config = {
                FORWARD_ONLY_MODE: true,
                CUTOFF_AT: cutoffAt,
                LAST_SEEN_LOCAL_ID: lastSeenLocalId,
                LAST_SEEN_SHEET_ROW: lastSeenSheetRow
            };

            // 5. Guardar de forma transaccional
            const saved = await this.saveConfig();

            if (saved) {
                // Salida observable exacta
                console.log('Forward-only habilitado: ✅');
                console.log(`Corte CUTOFF_AT: ${cutoffAt}`);
                console.log(`Marcadores iniciales: LAST_SEEN_LOCAL_ID=${lastSeenLocalId}, LAST_SEEN_SHEET_ROW=${lastSeenSheetRow}`);
                return true;
            } else {
                console.log('❌ Error guardando configuración Forward-Only');
                return false;
            }

        } catch (error) {
            console.error('[FORWARD-ONLY-STATE] Error habilitando Forward-Only:', error.message);
            return false;
        }
    }

    /**
     * Actualizar marcadores después de una corrida exitosa
     */
    async updateMarkers(newLastSeenLocalId, newLastSeenSheetRow) {
        try {
            this.config.LAST_SEEN_LOCAL_ID = Math.max(this.config.LAST_SEEN_LOCAL_ID, newLastSeenLocalId);
            this.config.LAST_SEEN_SHEET_ROW = Math.max(this.config.LAST_SEEN_SHEET_ROW, newLastSeenSheetRow);
            
            return await this.saveConfig();
        } catch (error) {
            console.error('[FORWARD-ONLY-STATE] Error actualizando marcadores:', error.message);
            return false;
        }
    }

    /**
     * Deshabilitar modo Forward-Only (volver al flujo tradicional)
     */
    async disableForwardOnly() {
        this.config.FORWARD_ONLY_MODE = false;
        return await this.saveConfig();
    }

    /**
     * Obtener configuración actual
     */
    getConfig() {
        return { ...this.config };
    }
}

// Instancia singleton
const forwardOnlyState = new ForwardOnlyState();

module.exports = {
    forwardOnlyState
};
