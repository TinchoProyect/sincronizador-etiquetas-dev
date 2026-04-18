const fs = require('fs');

let file = fs.readFileSync('src/produccion/js/mix.js', 'utf8');

const regexViejo = /const btnGuardarMix = modal\.querySelector\('#btn-guardar-mix'\);\s*btnGuardarMix\.onclick = \(\) => guardarRecetaMix\(mixId\);/;

const nuevoCodigo = `const btnGuardarMix = modal.querySelector('#btn-guardar-mix');
        btnGuardarMix.onclick = () => guardarRecetaMix(mixId);

        // Mostrar boton eliminar SOLO si ya hay configuracion, y asignarle comportamiento
        const btnEliminarFormula = modal.querySelector('#btn-eliminar-formula');
        if (btnEliminarFormula) {
            btnEliminarFormula.style.display = (data.composicion && data.composicion.length > 0) ? 'inline-block' : 'none';
            btnEliminarFormula.onclick = async () => {
                const confirmed = confirm('¿Eliminar Fórmula? Se borrará por completo la receta de este ingrediente y pasará a ser un insumo simple.');
                if (confirmed) {
                    try {
                        if (window.eliminarComposicionMix) {
                            modal.style.display = 'none';
                            await window.eliminarComposicionMix(mixId);
                        } else {
                            const response = await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${mixId}/composicion\`, {
                                method: 'DELETE'
                            });
                            if (!response.ok) throw new Error('Error eliminando formula');
                            
                            // Unlink
                            await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${mixId}\`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ padre_id: null })
                            });
                            
                            modal.style.display = 'none';
                            alert('La fórmula fue eliminada.');
                            if (typeof window.cargarIngredientes === 'function') {
                                await window.cargarIngredientes();
                            } else {
                                location.reload();
                            }
                        }
                    } catch (error) {
                       alert(error.message);
                    }
                }
            };
        }`;

if (file.match(regexViejo)) {
    file = file.replace(regexViejo, nuevoCodigo);
} else {
    console.error("No regexViejo");
}

file = file.replace(/modal\.querySelectorAll\('\.close-modal'\);/g, "modal.querySelectorAll('.close-modal, .close-modal-btn');");

fs.writeFileSync('src/produccion/js/mix.js', file, 'utf8');
console.log('JS Mix Updated Successfully!');
