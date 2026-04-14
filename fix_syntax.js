const fs = require('fs');
let text = fs.readFileSync('src/logistica/js/dashboard.js', 'utf8');

text = text.replace(
  /\$\{\!esRetiro \? \(\$\{pedido\.comprobante_lomasoft \?([\s\S]*?)`([\s\S]*?)`\s*:\s*`<span title="Pendiente de Facturación" class="pedido-badge" style="background-color:#475569; color:white;">⏳ Pte. Facturación<\/span>`\s*\}\) : \(pedido\.tiene_checkin \? `<span title="Check-in Completado" class="pedido-badge" style="background-color:#10b981; color:white;">✅ Check-in Listo<\/span>` : `<span title="Check-in Pendiente" class="pedido-badge" style="background-color:#f59e0b; color:white;">⏳ Check-in Pte.<\/span>`\)\}/s,
  `\${!esRetiro ? (pedido.comprobante_lomasoft ? \`<span title="Lomasoft: \${pedido.comprobante_lomasoft}" class="pedido-badge" style="background-color:#10b981; color:white;">✅ Lomasoft</span>\` : \`<span title="Pendiente de Facturación" class="pedido-badge" style="background-color:#475569; color:white;">⏳ Pte. Facturación</span>\`) : (pedido.tiene_checkin ? \`<span title="Check-in Completado" class="pedido-badge" style="background-color:#10b981; color:white;">✅ Check-in Listo</span>\` : \`<span title="Check-in Pendiente" class="pedido-badge" style="background-color:#f59e0b; color:white;">⏳ Check-in Pte.</span>\`)}`
);

fs.writeFileSync('src/logistica/js/dashboard.js', text);
console.log('Fixed syntax block.');
