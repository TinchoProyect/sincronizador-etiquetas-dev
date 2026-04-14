const fs = require('fs');

function patchJS(filePath) {
    let js = fs.readFileSync(filePath, 'utf8');

    // Patch abrirModalContingencia
    const regexAbrir = /if \(data\.success && data\.data && data\.data\.detalles\) \{([\s\S]*?)modal\.style\.display/s;
    const matchAbrir = js.match(regexAbrir);

    if (matchAbrir) {
        const replaceAbrir = `if (data.success && data.data) {
                const det = data.data.detalles || {};
                document.getElementById('checkin-descripcion').value = det.descripcion_externa || '';
                document.getElementById('checkin-kilos').value = det.kilos || '';
                document.getElementById('checkin-bultos').value = det.bultos || '';
                document.getElementById('checkin-motivo').value = det.motivo || '';

                document.getElementById('checkin-responsable-nombre').value = data.data.responsable_nombre || '';
                document.getElementById('checkin-responsable-apellido').value = data.data.responsable_apellido || '';
                document.getElementById('checkin-responsable-celular').value = data.data.responsable_celular || '';
                document.getElementById('checkin-chofer-nombre').value = data.data.chofer_nombre || '';

                if (data.data.fecha_validacion_chofer) {
                    const d = new Date(data.data.fecha_validacion_chofer);
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    document.getElementById('checkin-fecha').value = d.toISOString().slice(0,16);
                } else {
                    const d = new Date();
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    document.getElementById('checkin-fecha').value = d.toISOString().slice(0,16);
                }
            }
        }
        
        modal.style.display`;
        js = js.replace(matchAbrir[0], replaceAbrir);
    }

    // Patch guardarCheckinContingencia
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
    }

    fs.writeFileSync(filePath, js);
    console.log('Patched JS logic in:', filePath);
}

patchJS('src/logistica/js/dashboard.js');
patchJS('src/logistica/public/mobile/js/controllers/RutaActivaUI.js');
