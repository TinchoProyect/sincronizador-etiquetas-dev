const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '../src/logistica/js/listado-clientes.js');

try {
  // Primero revertir cualquier cambio roto para empezar limpio
  const { execSync } = require('child_process');
  execSync(`git checkout "${targetFile}"`);
  console.log('✅ Archivo original revertido a estado limpio.');

  let content = fs.readFileSync(targetFile, 'utf8');

  // El bloque exacto que queremos buscar
  const targetText = `                const selectorHtml = \`
                    <div style="text-align: left; font-family: 'Outfit', sans-serif; font-size: 15px; color: #334155;">
                        <p style="margin: 0 0 10px 0; font-weight: 600; color: #475569;">1. Seleccione el Canal de Envío:</p>
                        <div style="display: flex; gap: 20px; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 500;">
                                <input type="radio" name="canal-invite" value="whatsapp" \${defaultCanal === 'whatsapp' ? 'checked' : ''} \${!hasWp ? 'disabled' : ''} style="accent-color: var(--purple-primary); width: 16px; height: 16px;">
                                <span style="\${!hasWp ? 'opacity: 0.5;' : ''}">📱 WhatsApp</span>
                            </label>
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 500;">
                                <input type="radio" name="canal-invite" value="email" \${defaultCanal === 'email' ? 'checked' : ''} \${!hasEmail ? 'disabled' : ''} style="accent-color: var(--purple-primary); width: 16px; height: 16px;">
                                <span style="\${!hasEmail ? 'opacity: 0.5;' : ''}">✉️ Email / Correo</span>
                            </label>
                        </div>
                        <p style="margin: 0 0 8px 0; font-weight: 600; color: #475569;">2. Seleccione el Destinatario:</p>
                        <select id="select-destinatario-invite" class="swal2-select" style="width: 100%; margin: 0; box-sizing: border-box; display: block; height: 38px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; color: #1e293b; background: #ffffff; padding: 0 8px;"></select>
                    </div>
                \`;

                const result = await Swal.fire({
                    title: \`<span style="color: var(--purple-primary); font-weight: 700; font-family: 'Outfit'; font-size: 1.35rem;">Invitar al Portal B2B</span>\`,
                    html: selectorHtml,
                    showCancelButton: true,
                    confirmButtonColor: 'var(--purple-primary)',
                    cancelButtonColor: '#64748b',
                    confirmButtonText: '🚀 Enviar Invitación',
                    cancelButtonText: 'Cancelar',
                    didOpen: () => {
                        const selectEl = document.getElementById('select-destinatario-invite');
                        const radios = document.getElementsByName('canal-invite');
                        
                        const updateSelect = (canal) => {
                            selectEl.innerHTML = '';
                            if (canal === 'whatsapp') {
                                wpContacts.forEach(c => {
                                    const opt = document.createElement('option');
                                    opt.value = c.numero;
                                    opt.text = \`[WhatsApp] \${c.numero} \${c.nombre ? \`(\${c.nombre} - \${c.cargo || 'Contacto'})\` : ''}\`;
                                    selectEl.appendChild(opt);
                                });
                            } else {
                                emailContacts.forEach(e => {
                                    const opt = document.createElement('option');
                                    opt.value = e.email;
                                    opt.text = \`[Email] \${e.email} \${e.nombre ? \`(\${e.nombre} - \${e.cargo || 'Contacto'})\` : ''}\`;
                                    selectEl.appendChild(opt);
                                });
                            }
                        };

                        // Initial populating
                        updateSelect(defaultCanal);

                        // Event listeners for radio switch
                        radios.forEach(radio => {
                            radio.addEventListener('change', (e) => {
                                updateSelect(e.target.value);
                            });
                        });
                    },
                    preConfirm: () => {
                        const checkedRadio = document.querySelector('input[name="canal-invite"]:checked');
                        if (!checkedRadio) {
                            Swal.showValidationMessage('Debe seleccionar un canal de envío');
                            return false;
                        }
                        const canal = checkedRadio.value;
                        const destino = document.getElementById('select-destinatario-invite').value;
                        if (!destino) {
                            Swal.showValidationMessage('Debe seleccionar un destinatario válido');
                            return false;
                        }
                        return { canal, destino };
                    }
                });

                if (!result.isConfirmed) return;

                Swal.fire({
                    title: 'Enviando Invitación...',
                    html: 'Procesando el envío en segundo plano...',
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                try {
                    const response = await fetch('/api/logistica/b2b-onboarding/invitar', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ 
                            cliente_id: codigo,
                            canal: result.value.canal,
                            destino: result.value.destino
                        })
                    });`;

  // El reemplazo deseado
  const replacementText = `                const selectorHtml = \`
                    <div style="text-align: left; font-family: 'Outfit', sans-serif; font-size: 15px; color: #334155;">
                        <p style="margin: 0 0 10px 0; font-weight: 600; color: #475569;">1. Seleccione el Canal de Envío:</p>
                        <div style="display: flex; gap: 20px; margin-bottom: 15px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 500;">
                                <input type="radio" name="canal-invite" value="whatsapp" \${defaultCanal === 'whatsapp' ? 'checked' : ''} \${!hasWp ? 'disabled' : ''} style="accent-color: var(--purple-primary); width: 16px; height: 16px;">
                                <span style="\${!hasWp ? 'opacity: 0.5;' : ''}">📱 WhatsApp</span>
                            </label>
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 500;">
                                <input type="radio" name="canal-invite" value="email" \${defaultCanal === 'email' ? 'checked' : ''} \${!hasEmail ? 'disabled' : ''} style="accent-color: var(--purple-primary); width: 16px; height: 16px;">
                                <span style="\${!hasEmail ? 'opacity: 0.5;' : ''}">✉️ Email / Correo</span>
                            </label>
                        </div>
                        
                        <p style="margin: 0 0 8px 0; font-weight: 600; color: #475569;">2. Seleccione el Destinatario:</p>
                        <select id="select-destinatario-invite" class="swal2-select" style="width: 100%; margin: 0 0 15px 0; box-sizing: border-box; display: block; height: 38px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; color: #1e293b; background: #ffffff; padding: 0 8px;"></select>
                        
                        <p style="margin: 0 0 8px 0; font-weight: 600; color: #475569;">3. Vista Previa del Mensaje:</p>
                        <div class="phone-simulator" style="width: 100%; background-color: #0c0d14; border: 10px solid #1e293b; border-radius: 20px; box-sizing: border-box; padding: 12px; margin-bottom: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                            <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-bottom: 8px; padding: 0 4px; font-family: monospace;">
                                <span>LAMDA Mobile</span>
                                <span>12:00</span>
                            </div>
                            <div id="phone-chat-header" style="background-color: #1e1b29; padding: 8px; border-radius: 8px; color: #f1f5f9; display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                                <div style="width: 28px; height: 28px; background-color: #8e4785; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; color: #fff;">L</div>
                                <div>
                                    <div style="font-weight: 600; font-size: 12px; line-height: 1.2;">Portal LAMDA</div>
                                    <div style="font-size: 9px; color: #10b981; line-height: 1;">En línea</div>
                                </div>
                            </div>
                            <div style="background-color: #161422; border-radius: 12px; padding: 12px; min-height: 100px; display: flex; flex-direction: column; justify-content: flex-end;">
                                <div id="chat-bubble-preview" style="background-color: #2b2545; color: #f1f5f9; border-radius: 12px 12px 0 12px; padding: 10px; font-size: 13px; line-height: 1.45; word-break: break-all; white-space: pre-wrap; align-self: flex-end; max-width: 95%;">
                                    Cargando...
                                </div>
                            </div>
                        </div>

                        <p style="margin: 0 0 8px 0; font-weight: 600; color: #475569;">4. Editar Cuerpo del Mensaje:</p>
                        <textarea id="textarea-message-invite" class="swal2-textarea" style="width: 100%; height: 90px; margin: 0; box-sizing: border-box; font-family: sans-serif; font-size: 13px; line-height: 1.4; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; resize: none;"></textarea>
                        <small style="color: #64748b; font-size: 11px; margin-top: 4px; display: block;">* El marcador <strong>[Enlace_Al_Portal]</strong> se reemplazará automáticamente por la clave del cliente al enviar.</small>
                    </div>
                \`;
 
                 const result = await Swal.fire({
                     title: \`<span style="color: var(--purple-primary); font-weight: 700; font-family: 'Outfit'; font-size: 1.35rem;">Invitar al Portal B2B</span>\`,
                     html: selectorHtml,
                     showCancelButton: true,
                     confirmButtonColor: 'var(--purple-primary)',
                     cancelButtonColor: '#64748b',
                     confirmButtonText: '🚀 Enviar Invitación',
                     cancelButtonText: 'Cancelar',
                     didOpen: () => {
                         const selectEl = document.getElementById('select-destinatario-invite');
                         const radios = document.getElementsByName('canal-invite');
                         const textareaEl = document.getElementById('textarea-message-invite');
                         const previewEl = document.getElementById('chat-bubble-preview');
                         
                         const getContactName = () => {
                             const selectedOption = selectEl.options[selectEl.selectedIndex];
                             if (!selectedOption) return nombre;
                             const text = selectedOption.text;
                             const match = text.match(/\\(([^)]+)\\)/);
                             if (match) {
                                 const parts = match[1].split(' - ');
                                 return parts[0].trim();
                             }
                             return nombre;
                         };

                         const updateTextAndPreview = () => {
                             const contactName = getContactName();
                             textareaEl.value = \`Hola \${contactName}, te paso la clave del portal para que te loguees. Entrá acá: [Enlace_Al_Portal]\`;
                             previewEl.textContent = textareaEl.value;
                         };
                         
                         const updateSelect = (canal) => {
                             selectEl.innerHTML = '';
                             if (canal === 'whatsapp') {
                                 wpContacts.forEach(c => {
                                     const opt = document.createElement('option');
                                     opt.value = c.numero;
                                     opt.text = \`[WhatsApp] \${c.numero} \${c.nombre ? \`(\${c.nombre} - \${c.cargo || 'Contacto'})\` : ''}\`;
                                     selectEl.appendChild(opt);
                                 });
                             } else {
                                 emailContacts.forEach(e => {
                                     const opt = document.createElement('option');
                                     opt.value = e.email;
                                     opt.text = \`[Email] \${e.email} \${e.nombre ? \`(\${e.nombre} - \${e.cargo || 'Contacto'})\` : ''}\`;
                                     selectEl.appendChild(opt);
                                 });
                             }
                             updateTextAndPreview();
                         };
 
                         // Initial populating
                         updateSelect(defaultCanal);
 
                         // Event listeners for radio switch
                         radios.forEach(radio => {
                             radio.addEventListener('change', (e) => {
                                 updateSelect(e.target.value);
                             });
                         });

                         // Event listener for dropdown switch
                         selectEl.addEventListener('change', () => {
                             updateTextAndPreview();
                         });

                         // Event listener for textarea editing
                         textareaEl.addEventListener('input', () => {
                             previewEl.textContent = textareaEl.value;
                         });
                     },
                     preConfirm: () => {
                         const checkedRadio = document.querySelector('input[name="canal-invite"]:checked');
                         if (!checkedRadio) {
                             Swal.showValidationMessage('Debe seleccionar un canal de envío');
                             return false;
                         }
                         const canal = checkedRadio.value;
                         const destino = document.getElementById('select-destinatario-invite').value;
                         const mensajeTexto = document.getElementById('textarea-message-invite').value;
                         if (!destino) {
                             Swal.showValidationMessage('Debe seleccionar un destinatario válido');
                             return false;
                         }
                         if (!mensajeTexto.trim()) {
                             Swal.showValidationMessage('El cuerpo del mensaje no puede estar vacío');
                             return false;
                         }
                         return { canal, destino, mensajeTexto };
                     }
                 });
 
                 if (!result.isConfirmed) return;
 
                 Swal.fire({
                     title: 'Enviando Invitación...',
                     html: 'Procesando el envío en segundo plano...',
                     allowOutsideClick: false,
                     didOpen: () => {
                         Swal.showLoading();
                     }
                 });
 
                 try {
                     const response = await fetch('/api/logistica/b2b-onboarding/invitar', {
                         method: 'POST',
                         headers: {
                             'Content-Type': 'application/json'
                         },
                         body: JSON.stringify({ 
                             cliente_id: codigo,
                             canal: result.value.canal,
                             destino: result.value.destino,
                             mensajeTexto: result.value.mensajeTexto
                         })
                     });`;

  // Normalizar retornos de carro por compatibilidad
  content = content.replace(/\r\n/g, '\n');
  const targetNormal = targetText.replace(/\r\n/g, '\n');
  const replacementNormal = replacementText.replace(/\r\n/g, '\n');

  if (content.includes(targetNormal)) {
    content = content.replace(targetNormal, replacementNormal);
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('🎉 Modificación de listado-clientes.js aplicada perfectamente.');
  } else {
    console.error('❌ No se encontró el bloque de destino exacto en el archivo original.');
  }
} catch (err) {
  console.error('💥 Error aplicando cambio:', err);
}
