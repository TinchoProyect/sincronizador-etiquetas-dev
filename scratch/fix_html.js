const fs = require('fs');
const path = 'src/produccion/pages/ingredientes.html';
let content = fs.readFileSync(path, 'utf8');

// Normalizar saltos de línea para evitar problemas de compatibilidad de plataformas
content = content.replace(/\r\n/g, '\n');

const target = `        // Función para activar tab de usuario
        async function activarTabUsuario(usuarioId) {

            tabActiva = \`usuario-\${usuarioId}\`;

            // Actualizar encabezado de columna
            const columnaDinamica = document.getElementById('columna-dinamica');
            if (columnaDinamica) {
                columnaDinamica.textContent = 'Stock Personal';
            }

            // Cargar stock del usuario
            await cargarStockUsuario(usuarioId);
        }

        // Función para cargar stock de usuario
        async function cargarStockUsuario(usuarioId) {
            try {
                const response = await fetch(\`http://localhost:3002/api/produccion/ingredientes/stock-usuario/\${usuarioId}\`);

                if (!response.ok) {
                    throw new Error('Error al cargar stock del usuario');
                }

                const stockUsuario = await response.json();

                // Renderizar tabla
                renderizarTablaUsuario(stockUsuario);

                // Limpiar filtros
                limpiarFiltros();

            } catch (error) {
                console.error(\`❌ Error al cargar stock del usuario \${usuarioId}:\`, error);
                mostrarError('No se pudo cargar el stock del usuario');
            }
        }

        // Función para renderizar tabla de usuario
        function renderizarTablaUsuario(stockUsuario) {
            const tbody = document.getElementById('tabla-ingredientes-body');
            if (!tbody) return;

            tbody.innerHTML = '';

            if (!stockUsuario || stockUsuario.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center">Este usuario no tiene stock de ingredientes</td></tr>';
                return;
            }

            stockUsuario.forEach(item => {
                const row = document.createElement('tr');

                let tipoOrigen = 'Simple';
                if (item.origen_mix_id !== null && item.origen_mix_id !== undefined) {
                    tipoOrigen = 'Sobrante de Mix';
                }

                // 🔍 DEBUG: Ver qué ID tiene el item
                const ingredienteId = item.ingrediente_id || item.id;

                row.innerHTML = \`
                    <td>\${item.nombre_ingrediente}</td>
                    <td>\${item.unidad_medida || '-'}</td>
                    <td>\${item.categoria || '-'}</td>
                    <td>\${parseFloat(item.stock_total).toFixed(3)}</td>
                    <td>-</td>
                    <td>\${item.descripcion || '-'}</td>
                    <td>\${tipoOrigen}</td>
                    <td>-</td>
                    
                    <td style="text-align: center;">
                        <button class="btn-icon" 
                                onclick="window.abrirModalAjusteDesdeTabla(null, '\${item.nombre_ingrediente.replace(/'/g, "\\\\'")}', \${item.stock_total}, \${ingredienteId})"
                                title="Ajuste Rápido"
                                style="cursor:pointer; background:none; border:none; font-size:1.2em;">
                            
                              ✏️
                        </button>
                    </td>
                \`;

                tbody.appendChild(row);
            });
        }`;

const replacement = `        // Función para activar tab de usuario (unificado con ingredientes.js)
        async function activarTabUsuario(usuarioId) {
            tabActiva = \`usuario-\${usuarioId}\`;

            // Actualizar encabezado de columna
            const columnaDinamica = document.getElementById('columna-dinamica');
            if (columnaDinamica) {
                columnaDinamica.textContent = 'Stock Personal';
            }

            // Cargar stock del usuario mediante el helper global
            if (window.cargarIngredientes) {
                await window.cargarIngredientes(usuarioId);
            }

            // Limpiar filtros del panel lateral
            limpiarFiltros();
        }`;

if (!content.includes(target)) {
    console.error("❌ Target not found!");
} else {
    fs.writeFileSync(path, content.replace(target, replacement), 'utf8');
    console.log("✅ Replaced successfully!");
}
