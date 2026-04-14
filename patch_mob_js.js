const fs = require('fs');

function patchMobileJS(filePath) {
    let js = fs.readFileSync(filePath, 'utf8');

    // Patch guardarCheckinContingencia payload
    const regexPayload = /const payload = \{([\s\S]*?)\};/;
    const matchPayload = js.match(regexPayload);
    if(matchPayload) {
        const replacePayload = `const payload = {
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
        js = js.replace(matchPayload[0], replacePayload);
        fs.writeFileSync(filePath, js);
        console.log('Mobile Form payload patched.');
    } else {
        console.log('Mobile Payload patch failed.');
    }
}

patchMobileJS('src/logistica/public/mobile/js/controllers/RutaActivaUI.js');
