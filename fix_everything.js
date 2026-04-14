const fs = require('fs');

// 1. Fix HTML Chofer to Select
function changeInputToSelect(filePath) {
    let html = fs.readFileSync(filePath, 'utf8');
    const regex = /<input type="text" id="checkin-chofer-nombre"[^>]*>/;
    if (regex.test(html)) {
        html = html.replace(regex, `<select id="checkin-chofer-nombre" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" required><option value="">Seleccione Chofer</option></select>`);
        fs.writeFileSync(filePath, html);
        console.log('Fixed HTML select in', filePath);
    }
}
changeInputToSelect('src/logistica/pages/dashboard.html');
changeInputToSelect('src/logistica/public/mobile/ruta.html');

// 2. Fix dashboard.js - Revert Lomasoft payload AND accurately update guardarCheckinContingencia
let dashJS = fs.readFileSync('src/logistica/js/dashboard.js', 'utf8');

dashJS = dashJS.replace(/const payload = \{\s*descripcion_externa: document\.getElementById\('checkin-descripcion'\)\.value\.trim\(\),[\s\S]*?fecha_evento: document\.getElementById\('checkin-fecha'\)\.value\s*\};\s*const LOMASOFT_URL/, `const payload = {
            codigo: seleccionada.codigo,
            punto_venta: seleccionada.punto_venta,
            comprobante_formateado: seleccionada.comprobante_formateado
        };

        const LOMASOFT_URL`);

const targetPayload = `const payload = {
        descripcion_externa: document.getElementById('checkin-descripcion').value.trim(),
        kilos: kilosVal,
        bultos: bultosVal,
        motivo: document.getElementById('checkin-motivo').value.trim(),
        responsable_nombre: document.getElementById('checkin-responsable-nombre').value.trim(),
        responsable_apellido: document.getElementById('checkin-responsable-apellido').value.trim(),
        responsable_celular: document.getElementById('checkin-responsable-celular').value.trim(),
        chofer_nombre: document.getElementById('checkin-chofer-nombre').value.trim(),
        fecha_evento: document.getElementById('checkin-fecha').value
    };`;

dashJS = dashJS.replace(/const payload = \{\s*descripcion_externa: document\.getElementById\('checkin-descripcion'\)\.value\.trim\(\),\s*kilos: kilosVal,\s*bultos: bultosVal,\s*motivo: document\.getElementById\('checkin-motivo'\)\.value\.trim\(\)\s*\};/g, targetPayload);

dashJS = dashJS.replace(/const det = data\.data\.detalles \|\| \{\};/, `const det = data.data.detalles || {};
                const selectChofer = document.getElementById('checkin-chofer-nombre');
                selectChofer.innerHTML = '<option value="">Seleccione Chofer</option>' + (window.state && window.state.choferes ? window.state.choferes.map(c => \`<option value="\${c.nombre_completo}">\${c.nombre_completo}</option>\`).join('') : '');`);

fs.writeFileSync('src/logistica/js/dashboard.js', dashJS);

// 3. Fix RutaActivaUI.js
let mobileJS = fs.readFileSync('src/logistica/public/mobile/js/controllers/RutaActivaUI.js', 'utf8');
mobileJS = mobileJS.replace(/const payload = \{\s*descripcion_externa: document\.getElementById\('checkin-descripcion'\)\.value\.trim\(\),\s*kilos: kilosVal,\s*bultos: bultosVal,\s*motivo: document\.getElementById\('checkin-motivo'\)\.value\.trim\(\)\s*\};/g, targetPayload);

mobileJS = mobileJS.replace(/const det = data\.data\.detalles \|\| \{\};/, `const det = data.data.detalles || {};
                const selectChofer = document.getElementById('checkin-chofer-nombre');
                try {
                    if (!window.state.choferes) {
                        const resChoferes = await window.fetchConAuth('/api/logistica/usuarios/choferes');
                        const dataChoferes = await resChoferes.json();
                        if (dataChoferes.success) window.state.choferes = dataChoferes.data;
                    }
                    if (window.state.choferes) {
                        selectChofer.innerHTML = '<option value="">Seleccione Chofer</option>' + window.state.choferes.map(c => \`<option value="\${c.nombre_completo}">\${c.nombre_completo}</option>\`).join('');
                        if (!hasCheckin && window.state.ruta && window.state.ruta.chofer) {
                            selectChofer.value = window.state.ruta.chofer.nombre_completo;
                        }
                    }
                } catch(e) { console.error('Error dropdown choferes', e); }`);

fs.writeFileSync('src/logistica/public/mobile/js/controllers/RutaActivaUI.js', mobileJS);
console.log('Fixed everything');
