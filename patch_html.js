const fs = require('fs');

function patchHTML(filePath) {
    let html = fs.readFileSync(filePath, 'utf8');

    // Remove old modal form content
    const match = html.match(/(<div class="form-group"[^>]*>\s*<label>Descripción del artículo|<div style="margin-bottom: 15px;">\s*<label style="display: block; font-weight: bold)[^]*?(<div class="modal-footer"|<div style="margin-top: 20px; display: flex)/);
    
    if (match) {
        const replacement = `
                    <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                        <div class="form-group" style="flex: 1; margin-bottom: 15px;">
                            <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Nombre Responsable <span class="required" style="color:red">*</span></label>
                            <input type="text" id="checkin-responsable-nombre" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" required placeholder="Quien entrega">
                        </div>
                        <div class="form-group" style="flex: 1; margin-bottom: 15px;">
                            <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Apellido Responsable</label>
                            <input type="text" id="checkin-responsable-apellido" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" placeholder="Opcional">
                        </div>
                    </div>
                    
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Celular Contacto Responsable</label>
                        <input type="tel" id="checkin-responsable-celular" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" placeholder="Opcional">
                    </div>

                    <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                        <div class="form-group" style="flex: 1;">
                            <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Kilos Brutos <span class="required" style="color:red">*</span></label>
                            <input type="text" inputmode="decimal" id="checkin-kilos" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" required placeholder="0.00">
                        </div>
                        <div class="form-group" style="flex: 1;">
                            <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Bultos <span class="required" style="color:red">*</span></label>
                            <input type="number" id="checkin-bultos" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" required placeholder="0" min="1">
                        </div>
                    </div>

                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Descripción del artículo <span class="required" style="color:red">*</span></label>
                        <input type="text" id="checkin-descripcion" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" required placeholder="Ej: semilla, dátil, harina">
                    </div>
                    
                    <div class="form-group" style="margin-bottom: 1.5rem;">
                        <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Motivo a Tratar <span class="required" style="color:red">*</span></label>
                        <textarea id="checkin-motivo" rows="3" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" required placeholder="Describa el servicio requerido..."></textarea>
                    </div>

                    <div style="display: flex; gap: 1rem; margin-bottom: 1.5rem;">
                        <div class="form-group" style="flex: 1;">
                            <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Nombre Chofer LAMDA <span class="required" style="color:red">*</span></label>
                            <input type="text" id="checkin-chofer-nombre" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" required placeholder="Nombre Chofer">
                        </div>
                        <div class="form-group" style="flex: 1;">
                            <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Fecha y Hora <span class="required" style="color:red">*</span></label>
                            <input type="datetime-local" id="checkin-fecha" style="width: 100%; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px;" required>
                        </div>
                    </div>
                    
                    ${match[2]}`;
        
        fs.writeFileSync(filePath, html.substring(0, match.index) + replacement + html.substring(match.index + match[0].length));
        console.log('Patched modal in:', filePath);
    }
}

patchHTML('src/logistica/pages/dashboard.html');
patchHTML('src/logistica/public/mobile/ruta.html');
