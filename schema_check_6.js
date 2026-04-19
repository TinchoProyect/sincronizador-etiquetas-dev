const fs = require('fs');
let content = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

// Fragmento 1 (esVistaUsuario)
content = content.replace(
    'card.className = `tarjeta-ingrediente ${(ingrediente.stock_total <= 0) ? \\'con-stock-cero\\' : \\'\\'}`;',
    'const isChecked = window.ingredientesAjusteSeleccionados && window.ingredientesAjusteSeleccionados.has(ingredienteIdReal);\n            card.className = `tarjeta-ingrediente ${(ingrediente.stock_total <= 0) ? \\'con-stock-cero\\' : \\'\\'} ${isChecked ? \\'tarjeta-seleccionada\\' : \\'\\'}`;'
);

// Fragmento 2 (Vista General)
content = content.replace(
    'card.className = `tarjeta-ingrediente ${(ingrediente.stock_actual <= 0 && ingrediente.stock_potencial <= 0) ? \\'con-stock-cero\\' : \\'\\'}`;',
    'const isChecked = window.ingredientesAjusteSeleccionados && window.ingredientesAjusteSeleccionados.has(ingredienteIdReal);\n                card.className = `tarjeta-ingrediente ${(ingrediente.stock_actual <= 0 && ingrediente.stock_potencial <= 0) ? \\'con-stock-cero\\' : \\'\\'} ${isChecked ? \\'tarjeta-seleccionada\\' : \\'\\'}`;'
);

// Reemplazar los 2 checkboxes (g() replaces all)
content = content.replace(/class="checkbox-ajuste" data-id="\$\{ingredienteIdReal\}" onchange="window\.toggleSeleccionAjuste\(this\)"/g, 'class="checkbox-ajuste" data-id="${ingredienteIdReal}" onchange="window.toggleSeleccionAjuste(this)" ${isChecked ? \\'checked\\' : \\'\\'}');

fs.writeFileSync('src/produccion/js/ingredientes.js', content);
console.log('Restauración de Estado inyectada.');
