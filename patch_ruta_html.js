const fs = require('fs');

function patchMobileHTML(filePath) {
    let html = fs.readFileSync(filePath, 'utf8');

    // Remove old modal form content
    const match = html.match(/(<div style="margin-bottom: 15px;">\s*<label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Descripción del artículo \w*<\/label>)[^]*?(<button type="submit" id="btn-submit-contingencia" style="width: 100%; padding: 12px;)/);
    
    if (match) {
        const replacement = `
                      <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                          <div style="flex: 1;">
                              <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Nombre Resp. <span style="color:red">*</span></label>
                              <input type="text" id="checkin-responsable-nombre" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" required placeholder="Entregado por">
                          </div>
                          <div style="flex: 1;">
                              <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Apellido Resp.</label>
                              <input type="text" id="checkin-responsable-apellido" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" placeholder="Opcional">
                          </div>
                      </div>

                      <div style="margin-bottom: 15px;">
                          <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Celular Contacto Responsable</label>
                          <input type="tel" id="checkin-responsable-celular" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" placeholder="Opcional">
                      </div>

                      <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                          <div style="flex: 1;">
                              <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Kilos Brutos <span style="color:red">*</span></label>
                              <input type="text" inputmode="decimal" id="checkin-kilos" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" required placeholder="0.00">
                          </div>
                          <div style="flex: 1;">
                              <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Bultos <span style="color:red">*</span></label>
                              <input type="number" id="checkin-bultos" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" required placeholder="0" min="1">
                          </div>
                      </div>

                      <div style="margin-bottom: 15px;">
                          <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Descripción del artículo <span style="color:red">*</span></label>
                          <input type="text" id="checkin-descripcion" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" required placeholder="Ej: semilla, dátil, harina">
                      </div>
                      
                      <div style="margin-bottom: 15px;">
                          <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Motivo a Tratar <span style="color:red">*</span></label>
                          <textarea id="checkin-motivo" rows="3" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" required placeholder="Describa el servicio requerido..."></textarea>
                      </div>

                      <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                          <div style="flex: 1;">
                              <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Chofer <span style="color:red">*</span></label>
                              <input type="text" id="checkin-chofer-nombre" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" required placeholder="Nombre Chofer">
                          </div>
                          <div style="flex: 1;">
                              <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Fecha/Hora <span style="color:red">*</span></label>
                              <input type="datetime-local" id="checkin-fecha" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" required>
                          </div>
                      </div>
                      
                      ${match[2]}`;
        
        fs.writeFileSync(filePath, html.substring(0, match.index) + replacement + html.substring(match.index + match[0].length));
        console.log('Patched modal in:', filePath);
    } else {
        console.log('No match found in ' + filePath);
    }
}

patchMobileHTML('src/logistica/public/mobile/ruta.html');
