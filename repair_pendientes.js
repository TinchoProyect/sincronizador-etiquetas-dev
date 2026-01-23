const fs = require('fs');
const path = 'src/produccion/pages/pendientes-compra.html';

try {
    let content = fs.readFileSync(path, 'utf8');

    // The markers for the corrupted block seems to be around " // Agrupar por presupuesto"
    // and ending at "container.innerHTML = html ||"
    // Since the content is mangled, I'll search for a larger safe block to replace.

    // I will replace everything from "async function renderizarAcordeon" down to "}" of that function.
    // I need to be careful to find the correct closing brace. 
    // Or I can look for "async function cargarPendientesAgrupados" and replace from "async function renderizarAcordeon" 
    // which comes after it.

    // Let's find "async function renderizarAcordeon"
    const startMarker = 'async function renderizarAcordeon(containerId, pendientes, tipo) {';
    const startIndex = content.indexOf(startMarker);

    // Let's find the end of the script tag or the next function "togglePresupuesto"
    const endMarker = 'function togglePresupuesto(presupuestoId) {';
    const endIndex = content.indexOf(endMarker);

    if (startIndex === -1 || endIndex === -1) {
        console.error('Markers not found!');
        console.log('Start Index:', startIndex);
        console.log('End Marker Index:', endIndex);
        process.exit(1);
    }

    const preBlock = content.substring(0, startIndex);
    const postBlock = content.substring(endIndex);

    // Complete, Correct Function
    const newFunction = `async function renderizarAcordeon(containerId, pendientes, tipo) {
            const container = document.getElementById(containerId);

            if (pendientes.length === 0) {
                container.innerHTML = \`
                    <div class="mensaje-vacio">
                        <span>✅</span>
                        <p>\${tipo === 'imprimir' ? 'No hay pendientes para imprimir' : 'No hay pendientes en espera'}</p>
                    </div>
                \`;
                return;
            }

            // Agrupar por presupuesto
            const presupuestosMap = new Map();

            for (const pendiente of pendientes) {
                const presupId = pendiente.id_presupuesto_local;

                if (!presupuestosMap.has(presupId)) {
                    // Obtener datos del presupuesto
                    const presupuestoResponse = await fetch(\`/api/produccion/pedidos-por-cliente?ids=\${presupId}\`);
                    const presupuestoData = await presupuestoResponse.json();

                    if (presupuestoData.success && presupuestoData.data.length > 0) {
                        const cliente = presupuestoData.data[0];
                        const articulos = cliente.articulos.filter(a => a.id_presupuesto_local === presupId);

                        presupuestosMap.set(presupId, {
                            id_local: presupId,
                            id_ext: pendiente.id_presupuesto_ext,
                            cliente_id: cliente.cliente_id,
                            cliente_nombre: cliente.cliente_nombre,
                            articulos: articulos,
                            pendientes: []
                        });
                    }
                }

                if (presupuestosMap.has(presupId)) {
                    presupuestosMap.get(presupId).pendientes.push(pendiente);
                }
            }

            // Agrupar Presupuestos por CLIENTE
            const clientesMap = new Map();
            presupuestosMap.forEach(pres => {
                const cliId = String(pres.cliente_id);
                if (!clientesMap.has(cliId)) {
                    clientesMap.set(cliId, {
                        id: cliId,
                        nombre: pres.cliente_nombre,
                        presupuestos: []
                    });
                }
                clientesMap.get(cliId).presupuestos.push(pres);
            });

            // Renderizar HTML
            const html = Array.from(clientesMap.values()).map(cliente => {
                
                const presupuestosHtml = cliente.presupuestos.map(presupuesto => {
                    const fechaFormateada = presupuesto.articulos[0]?.presupuesto_fecha 
                        ? new Date(presupuesto.articulos[0].presupuesto_fecha).toLocaleDateString('es-AR')
                        : '-';

                    const pendientesSet = new Set(
                        presupuesto.pendientes.map(p => p.codigo_barras_real || p.codigo_barras)
                    );

                    return \`
                        <div class="presupuesto-item">
                            <div class="presupuesto-header" onclick="togglePresupuesto('pres-\${presupuesto.id_local}')">
                                <div>
                                    <strong>Presupuesto \${presupuesto.id_ext}</strong>
                                    <span style="color: #6c757d; margin-left: 10px;">👤 \${presupuesto.cliente_nombre}</span>
                                    <span style="color: #6c757d; margin-left: 10px;">📅 \${fechaFormateada}</span>
                                    <span style="color: #6c757d; margin-left: 10px;">(\${presupuesto.pendientes.length} art. derivados)</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    \${tipo === 'imprimir' ? \`
                                        <button class="btn-imprimir-pendiente" onclick="event.stopPropagation(); imprimirPendiente(\${presupuesto.id_local}, '\${presupuesto.id_ext}', \${presupuesto.cliente_id})">
                                            📄 Imprimir
                                        </button>
                                    \` : ''}
                                    <span class="toggle-icon" style="font-size: 1.2em;">▼</span>
                                </div>
                            </div>
                            <div id="pres-\${presupuesto.id_local}" class="presupuesto-content">
                                \${tipo === 'espera' ? \`
                                    <div class="info-espera">
                                        <strong>⏳ Esperando llegada de mercadería</strong>
                                        <p>Este presupuesto ya fue impreso y está en espera de que lleguen los artículos pendientes.</p>
                                    </div>
                                \` : ''}
                                
                                <table class="tabla-pendientes">
                                    <thead>
                                        <tr>
                                            <th>Artículo</th>
                                            <th>Descripción</th>
                                            <th>Cantidad</th>
                                            <th>Stock</th>
                                            <th>Faltante</th>
                                            <th>Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        \${presupuesto.articulos.map(articulo => {
                                            const matchCode = (p) => {
                                                 const c = String(p.codigo_barras_real || p.codigo_barras || p.articulo_numero).trim();
                                                 const a = String(articulo.articulo_numero).trim();
                                                 return c === a;
                                            };
                                            const esPendiente = pendientesSet.has(articulo.articulo_numero);
                                            const pendienteData = presupuesto.pendientes.find(p => matchCode(p));
                                            const isActive = esPendiente;
                                            
                                            return \`
                                                <tr \${isActive ? 'class="articulo-derivado" style="background-color: #ffeeba;"' : ''}>
                                                    <td>\${articulo.articulo_numero}</td>
                                                    <td>\${articulo.descripcion}</td>
                                                    <td>\${parseFloat(articulo.pedido_total).toFixed(2)}</td>
                                                    <td>\${parseFloat(articulo.stock_disponible).toFixed(2)}</td>
                                                    <td class="\${isActive ? 'cantidad-faltante' : 'cantidad-completa'}" style="\${isActive ? 'color:#dc3545;font-weight:bold' : 'color:#28a745'}">
                                                        \${isActive ? (pendienteData?.cantidad_faltante || articulo.faltante) : '✓'}
                                                    </td>
                                                    <td>
                                                        \${isActive && pendienteData ? \`
                                                            <button class="btn-revertir" onclick="revertirPendiente(\${pendienteData.id})" title="Devolver a pendientes">
                                                                ↩️ Revertir
                                                            </button>
                                                        \` : ''}
                                                    </td>
                                                </tr>
                                            \`;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    \`;
                }).join('');

                return \`
                    <div class="cliente-item">
                        <div class="cliente-header" onclick="toggleCliente('cli-\${cliente.id}')">
                            <div>
                                <strong>👤 \${cliente.nombre}</strong>
                                <span style="color: #6c757d; margin-left: 10px;">(\${cliente.presupuestos.length} presupuestos)</span>
                            </div>
                            <div class="toggle-icon">▼</div>
                        </div>
                        <div id="cli-\${cliente.id}" class="cliente-content" style="display: none;">
                            \${presupuestosHtml}
                        </div>
                    </div>
                \`;
            }).join('');

            container.innerHTML = html || \`
                <div class="mensaje-vacio">
                    <span>✅</span>
                    <p>No hay pendientes en esta sección</p>
                </div>
            \`;
        }

        `;

    fs.writeFileSync(path, preBlock + newFunction + postBlock, 'utf8');
    console.log('Success: File repaired.');

} catch (err) {
    console.error('Error:', err);
    process.exit(1);
}
