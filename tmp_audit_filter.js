const fs = require('fs');

const data = JSON.parse(fs.readFileSync('tmp_audit_lomasoft_ids.json', 'utf8'));

// Buscamos monto exacto o cercano
const byAmount = data.filter(r => Math.abs(Number(r.calc_total) - 210502.97) < 5 || Math.abs(Number(r.calc_total) - 210502) < 5);
console.log('--- BY AMOUNT (~210502) ---');
console.log(JSON.stringify(byAmount, null, 2));

// Buscamos todos los del cliente 216
const byClient = data.filter(r => r.id_cliente == '216' || r.id_cliente == 216);
console.log('\n--- BY CLIENT 216 ---');
console.log(JSON.stringify(byClient, null, 2));

