const fs = require('fs');
const path = 'src/logistica/public/mobile/js/controllers/RutaActivaUI.js';
let content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');
const fixedLines = lines.slice(0, 748);
content = fixedLines.join('\n') + `
// --- Carga Contingente Dinámica (Check-in Chofer) ---

window.abrirModalContingencia = async (hash, esEdicion) => {
    try {
        const modal = document.getElementById('modal-contingencia-checkin');
        const form = document.getElementById('form-contingencia-checkin');
        const hashInput = document.getElementById('checkin-hash');
        
        // Reset form
        form.reset();
        hashInput.value = hash;

        if (esEdicion) {
            Swal.fire({ title: 'Cargando datos...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
            const response = await fetch(\`\${API_BASE_URL}/api/logistica/tratamientos/sesion/\${hash}\`);
            const data = await response.json();
            
            Swal.close();
            
            if (data.success && data.data && data.data.detalles) {
                const det = data.data.detalles;
                document.getElementById('checkin-descripcion').value = det.descripcion_externa || '';
                document.getElementById('checkin-kilos').value = det.kilos || '';
                document.getElementById('checkin-bultos').value = det.bultos || '';
                document.getElementById('checkin-motivo').value = det.motivo || '';
            }
        }
        
        modal.style.display = 'flex';
    } catch (error) {
        Swal.fire('Error', 'Fallo al inicializar el modal de contingencia', 'error');
    }
};

window.cerrarModalContingencia = () => {
    document.getElementById('modal-contingencia-checkin').style.display = 'none';
};

window.guardarCheckinContingencia = async (event) => {
    event.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-contingencia');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Guardando...';

    const hash = document.getElementById('checkin-hash').value;
    
    // Captura y Sanitización
    const kilosRaw = document.getElementById('checkin-kilos').value.trim();
    const kilosVal = parseFloat(kilosRaw.replace(',', '.'));
    const bultosVal = parseInt(document.getElementById('checkin-bultos').value);

    if (isNaN(kilosVal) || kilosVal <= 0) {
        Swal.fire('Atención', 'Los Kilos deben ser expresados en valores numéricos mayores a 0', 'warning');
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar Check-in';
        return;
    }

    const payload = {
        descripcion_externa: document.getElementById('checkin-descripcion').value.trim(),
        kilos: kilosVal,
        bultos: bultosVal,
        motivo: document.getElementById('checkin-motivo').value.trim()
    };

    try {
        const response = await fetch(\`\${API_BASE_URL}/api/logistica/tratamientos/chofer/checkin/\${hash}\`, {
            method: 'PUT',
            headers: { 
                'Authorization': \`Bearer \${state.sesion.token}\`,
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.success) {
            window.cerrarModalContingencia();
            Swal.fire('¡Carga Completada!', 'El check-in se ha guardado exitosamente.', 'success');
            
            // Recargar Ruta Activa para refrescar visualmente las tarjetas y el estado de los botones
            cargarRutaActiva();
        } else {
            throw new Error(data.error || 'Error al persistir contingencia');
        }

    } catch (error) {
        Swal.fire('Falla de Red', error.message, 'error');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar Check-in';
    }
};
`;
fs.writeFileSync(path, content);
console.log('Done!');
