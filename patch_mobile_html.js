const fs = require('fs');
const path = 'src/logistica/public/mobile/ruta.html';
let html = fs.readFileSync(path, 'utf8');

const regex = /<form id="form-contingencia-checkin"[^>]*>([\s\S]*?)<button type="submit" id="btn-submit-contingencia"/;
const match = html.match(regex);

if (match) {
    const replacement = `
                    <input type="hidden" id="checkin-hash" value="">
                    
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

                    <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                        <div style="flex: 1;">
                            <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Chofer <span style="color:red">*</span></label>
                            <input type="text" id="checkin-chofer-nombre" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" required placeholder="Nombre Chofer">
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; font-weight: bold; color: #475569; margin-bottom: 5px;">Fecha/Hora <span style="color:red">*</span></label>
                            <input type="datetime-local" id="checkin-fecha" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px;" required>
                        </div>
                    </div>
                    
                    `;
    html = html.replace(match[1], replacement);
    fs.writeFileSync(path, html);
    console.log('Mobile Form updated successfully.');
} else {
    console.log('Form bounds not found in mobile form.');
}
