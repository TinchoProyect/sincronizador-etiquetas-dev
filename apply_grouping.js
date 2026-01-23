const fs = require('fs');
const path = 'src/produccion/pages/pendientes-compra.html';

try {
    let content = fs.readFileSync(path, 'utf8');

    // Define the start and end of the block to replace
    // Start: "// Agrupar por presupuesto"
    // End: "container.innerHTML = html ||"

    const startMarker = '// Agrupar por presupuesto';
    const endMarker = 'container.innerHTML = html ||';

    const startIndex = content.indexOf(startMarker);
    const endIndex = content.indexOf(endMarker);

    if (startIndex === -1 || endIndex === -1) {
        console.error('Markers not found!');
        console.log('Start:', startIndex, 'End:', endIndex);
        process.exit(1);
    }

    const preBlock = content.substring(0, startIndex);
    const postBlock = content.substring(endIndex);

    // The new logic block
    const newBlock = `// Agrupar por presupuesto
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

            // AHORA: Agrupar Presupuestos por CLIENTE
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

            // Renderizar HTML: Iterar Clientes -> Presupuestos
            const html = Array.from(clientesMap.values()).map(cliente => {
                
                // Generar HTML de los presupuestos de este cliente
                const presupuestosHtml = cliente.presupuestos.map(presupuesto => {
                    const fechaFormateada = presupuesto.articulos[0]?.presupuesto_fecha 
                        ? new Date(presupuesto.articulos[0].presupuesto_fecha).toLocaleDateString('es-AR')
                        : '-';

                    // Crear mapa de pendientes para marcar en rojo
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
                                            const esPendiente = pendientesSet.has(articulo.articulo_numero);
                                            // Robust matching
                                            const pendienteData = presupuesto.pendientes.find(p => 
                                                String(p.codigo_barras_real || p.codigo_barras || p.articulo_numero).trim() === String(articulo.articulo_numero).trim()
                                            );

                                            return \`
                                                <tr \${esPendiente ? 'class="articulo-derivado"' : ''}>
                                                    <td>\${articulo.articulo_numero}</td>
                                                    <td>\${articulo.descripcion}</td>
                                                    <td>\${parseFloat(articulo.pedido_total).toFixed(2)}</td>
                                                    <td>\${parseFloat(articulo.stock_disponible).toFixed(2)}</td>
                                                    <td class="\${articulo.faltante > 0 ? 'cantidad-faltante' : 'cantidad-completa'}">
                                                        \${parseFloat(articulo.faltante).toFixed(2)}
                                                    </td>
                                                    <td>
                                                        \${esPendiente && pendienteData ? \`
                                                            <button class="btn-revertir" onclick="revertirPendiente(\${pendienteData.id})" title="Volver a Pendientes">
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

                // Renderizar contenedor del CLIENTE
                return \`
                    <div class="cliente-item">
                        <div class="cliente-header" onclick="toggleCliente('cli-\${cliente.id}')">
                            <div>
                                <strong>👤 \${cliente.nombre}</strong>
                                <span style="color: #6c757d; margin-left: 10px;">(\${cliente.presupuestos.length} presupuestos)</span>
                            </div>
                            <div class="toggle-icon">▼</div>
                        </div>
                        <div id="cli-\${cliente.id}" class="cliente-content" style="display: block;">
                            \${presupuestosHtml}
                        </div>
                    </div>
                \`;
            }).join('');
            
            `;

    const finalContent = preBlock + newBlock + postBlock;
    fs.writeFileSync(path, finalContent, 'utf8');
    console.log('Success: File updated.');

} catch (err) {
    console.error('Error:', err);
    process.exit(1);
}
