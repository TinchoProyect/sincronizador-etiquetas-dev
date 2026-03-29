const fs = require('fs');
let html = fs.readFileSync('src/produccion/pages/gestion-mantenimiento.html', 'utf8');

// 1. Reemplazar botones de liberarStock (Dropdown Interno y Normal)
html = html.replace(/liberarStock\(null, '\$\{item\.articulo_numero \|\| ''\}', \$\{cantidad\}, 'Vuelva a Ventas internamente', '\$\{item\.usuario_id \|\| ''\}'\)/g,
    "liberarStock(null, '${item.articulo_numero || ''}', ${cantidad}, 'Vuelva a Ventas internamente', '${item.usuario_id || ''}', ${item.id})");
html = html.replace(/liberarStock\('\$\{item\.cliente_id\}', '\$\{item\.articulo_numero\}', \$\{cantidad\}, 'Reintegro a Ventas tras Logística Inversa', '\$\{item\.usuario_id \|\| ''\}'\)/g,
    "liberarStock('${item.cliente_id}', '${item.articulo_numero}', ${cantidad}, 'Reintegro a Ventas tras Logística Inversa', '${item.usuario_id || ''}', ${item.id})");

// 2. Reemplazar botones de retornarAIngredientes
html = html.replace(/retornarAIngredientes\(null, '\$\{item\.ingrediente_id \|\| ''\}', '\$\{item\.articulo_numero \|\| ''\}', \$\{cantidad\}, 'Transferencia a ingredientes internamente', '\$\{item\.usuario_id \|\| ''\}'\)/g,
    "retornarAIngredientes(null, '${item.ingrediente_id || ''}', '${item.articulo_numero || ''}', ${cantidad}, 'Transferencia a ingredientes internamente', '${item.usuario_id || ''}', ${item.id})");
html = html.replace(/retornarAIngredientes\('\$\{item\.cliente_id\}', '\$\{item\.ingrediente_id \|\| ''\}', '\$\{item\.articulo_numero \|\| ''\}', \$\{cantidad\}, 'Transferencia a ingredientes \(Granel\)', '\$\{item\.usuario_id \|\| ''\}'\)/g,
    "retornarAIngredientes('${item.cliente_id}', '${item.ingrediente_id || ''}', '${item.articulo_numero || ''}', ${cantidad}, 'Transferencia a ingredientes (Granel)', '${item.usuario_id || ''}', ${item.id})");

// 3. Reemplazar Firmas de función
html = html.replace(/async function liberarStock\(clienteId, articuloActivo, cantidadOriginal, motivoDefecto, usuarioOriginalId\)/g,
    "async function liberarStock(clienteId, articuloActivo, cantidadOriginal, motivoDefecto, usuarioOriginalId, movimientoId)");

html = html.replace(/async function retornarAIngredientes\(clienteId, ingredienteActivo, articuloAsociado, cantidadOriginal, motivoDefecto, usuarioOriginalId\)/g,
    "async function retornarAIngredientes(clienteId, ingredienteActivo, articuloAsociado, cantidadOriginal, motivoDefecto, usuarioOriginalId, movimientoId)");

// 4. Inyectar id_movimiento en JSON.stringify ({ -> ojo, esto se hará reemplazando la base de body: JSON.stringify(
html = html.replace(/body: JSON\.stringify\(\{\s*cliente_id: clienteId,\s*articulo_origen:/g,
    "body: JSON.stringify({ movimiento_id: movimientoId, cliente_id: clienteId, articulo_origen:");

html = html.replace(/body: JSON\.stringify\(\{\s*cliente_id: clienteId,\s*articulo: articuloAsociado,\s*ingrediente_id:/g,
    "body: JSON.stringify({ movimiento_id: movimientoId, cliente_id: clienteId, articulo: articuloAsociado, ingrediente_id:");

fs.writeFileSync('src/produccion/pages/gestion-mantenimiento.html', html);
console.log("HTML Parcheado Frontend Ok");
