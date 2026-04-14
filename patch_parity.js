const fs = require('fs');

const path = 'src/logistica/js/dashboard.js';
let content = fs.readFileSync(path, 'utf8');

// 1. In renderizarPedidos() - Add badge parity for state
content = content.replace(
    /(\$\{pedido\.comprobante_lomasoft \? \s*`.*?` : \s*`.*?`\s*\})/s,
    `\${!esRetiro ? ($1) : (pedido.tiene_checkin ? \`<span title="Check-in Completado" class="pedido-badge" style="background-color:#10b981; color:white;">✅ Check-in Listo</span>\` : \`<span title="Check-in Pendiente" class="pedido-badge" style="background-color:#f59e0b; color:white;">⏳ Check-in Pte.</span>\`)}`
);

// 2. In renderizarPedidos() - Add "Edit" button parity next to "Descartar"
content = content.replace(
    /\$\{esRetiro \? `<button onclick="event\.stopPropagation\(\); window\.descartarRetiro\('\$\{pedido\.id\}'\)" class="btn-sm btn-danger"(.*?)🗑️ Descartar<\/button>` : ''\}/s,
    `\${esRetiro ? \`<button onclick="event.stopPropagation(); window.abrirModalContingencia('\${pedido.hash}', \${pedido.tiene_checkin})" class="btn-sm btn-primary" style="padding: 2px 6px; font-size: 0.75rem; background-color: #f59e0b; color:white; border:none; border-radius:3px; cursor:pointer; margin-right: 2px;" title="Consultar o Completar Datos del Tratamiento">✏️ \${pedido.tiene_checkin ? 'Modificar' : 'Check-in'}</button>\` : ''}\n                        \${esRetiro ? \`<button onclick="event.stopPropagation(); window.descartarRetiro('\${pedido.id}')" class="btn-sm btn-danger"$1🗑️ Descartar</button>\` : ''}`
);


// 3. In renderizarTarjetaRuta() - Add badge parity for state 
// Around line 695: `<span class="badge badge-\${p.estado_logistico?.toLowerCase() || 'pendiente'}">\${p.estado_logistico || 'PENDIENTE'}</span>`
content = content.replace(
    /<span class="badge badge-\$\{p\.estado_logistico\?\.toLowerCase\(\) \|\| 'pendiente'\}">\$\{p\.estado_logistico \|\| 'PENDIENTE'\}<\/span>/g,
    `\${esRetiroDentro ? (p.tiene_checkin ? \`<span title="Check-in Completado" class="badge" style="background-color:#10b981; color:white;">✅ Listo</span>\` : \`<span title="Check-in Pendiente" class="badge" style="background-color:#f59e0b; color:white;">⏳ Pte</span>\`) : \`<span class="badge badge-\${p.estado_logistico?.toLowerCase() || 'pendiente'}">\${p.estado_logistico || 'PENDIENTE'}</span>\`}`
);

// 4. In renderizarTarjetaRuta() - Add "Edit" button parity next to "Descartar" around line 718
content = content.replace(
    /\$\{esRetiroDentro \? `<button(.*?)\s+onclick="event\.stopPropagation\(\); window\.descartarRetiro\('\$\{p\.id\}'\)"(.*?)🗑️<\/button>` : ''\}/g,
    `\${esRetiroDentro ? \`<button onclick="event.stopPropagation(); window.abrirModalContingencia('\${p.hash}', \${p.tiene_checkin})" class="btn-icon-danger" style="background-color: #f59e0b; padding: 0.1rem 0.3rem; font-size: 0.7rem; color: white; border: none; border-radius: 0.25rem; cursor: pointer; margin-right: 2px;" title="\${p.tiene_checkin ? 'Modificar Check-in' : 'Realizar Check-in'}">✏️</button>\` : ''}\n                                        \${esRetiroDentro ? \`<button$1 onclick="event.stopPropagation(); window.descartarRetiro('\${p.id}')"$2🗑️</button>\` : ''}`
);

// 5. Append JS functions at EOF
if(!content.includes('abrirModalContingencia')) {
    content += `\n\n// --- Carga Contingente Dinámica (Paridad Desktop) ---
window.abrirModalContingencia = async (hash, esEdicion) => {
    try {
        const modal = document.getElementById('modal-contingencia-checkin');
        const form = document.getElementById('form-contingencia-checkin');
        const hashInput = document.getElementById('checkin-hash');
        
        // Reset form
        form.reset();
        hashInput.value = hash;

        if (esEdicion) {
            Swal.fire({ title: 'Obteniendo datos de auditoría...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
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
        Swal.fire('Error', 'Fallo al inicializar el panel de auditoría', 'error');
    }
};

window.cerrarModalContingencia = () => {
    const modal = document.getElementById('modal-contingencia-checkin');
    if(modal) modal.style.display = 'none';
};

window.guardarCheckinContingencia = async (event) => {
    event.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-contingencia');
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = 'Registrando...';

    const hash = document.getElementById('checkin-hash').value;
    
    // Captura y Sanitización
    const kilosRaw = document.getElementById('checkin-kilos').value.trim();
    const kilosVal = parseFloat(kilosRaw.replace(',', '.'));
    const bultosVal = parseInt(document.getElementById('checkin-bultos').value);

    if (isNaN(kilosVal) || kilosVal <= 0) {
        Swal.fire('Atención', 'Los Kilos deben ser valores numéricamente válidos (>0).', 'warning');
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = 'Confirmar Check-in';
        return;
    }

    const payload = {
        descripcion_externa: document.getElementById('checkin-descripcion').value.trim(),
        kilos: kilosVal,
        bultos: bultosVal,
        motivo: document.getElementById('checkin-motivo').value.trim()
    };

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(\`\${API_BASE_URL}/api/logistica/tratamientos/chofer/checkin/\${hash}\`, {
            method: 'PUT',
            headers: { 
                'Authorization': \`Bearer \${token}\`,
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.success) {
            window.cerrarModalContingencia();
            Swal.fire('Auditoría Existosa', 'El estado Contingente ha sido asimilado por el backend LAMDA.', 'success');
            
            // Recargar Dashboard para reflejar el estado "Tiene Checkin"
            cargarDatosRestauracion();
        } else {
            throw new Error(data.error || 'Error al persistir contingencia en DB');
        }

    } catch (error) {
        Swal.fire('Falla de Red / Autorización', error.message, 'error');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = 'Confirmar Check-in';
    }
};
`;
}

fs.writeFileSync(path, content);
console.log('Parity code injected.');
