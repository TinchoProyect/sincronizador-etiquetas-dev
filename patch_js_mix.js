const fs = require('fs');

let file = fs.readFileSync('src/produccion/js/mix.js', 'utf8');

// The function we are injecting this to is: abrirEdicionMix
// It currently has something like:
/*
        // Configurar botón de agregar
        const btnAgregar = modal.querySelector('#btn-agregar-a-mix');
        btnAgregar.onclick = () => agregarIngredienteAMix(mixId);

        // Configurar botón de guardar receta
        const btnGuardarMix = modal.querySelector('#btn-guardar-mix');
        btnGuardarMix.onclick = () => guardarRecetaMix(mixId);
*/

const oldHooks = "const btnGuardarMix = modal.querySelector('#btn-guardar-mix');\n        btnGuardarMix.onclick = () => guardarRecetaMix(mixId);";

const newHooks = `const btnGuardarMix = modal.querySelector('#btn-guardar-mix');
        btnGuardarMix.onclick = () => guardarRecetaMix(mixId);

        // Mostrar boton eliminar SOLO si ya hay configuracion, y asignarle comportamiento
        const btnEliminarFormula = modal.querySelector('#btn-eliminar-formula');
        if (btnEliminarFormula) {
            btnEliminarFormula.style.display = (data.composicion && data.composicion.length > 0) ? 'inline-block' : 'none';
            btnEliminarFormula.onclick = async () => {
                const confirmed = await Swal.fire({
                    title: '¿Eliminar Fórmula?',
                    text: "Se borrará por completo la receta de este ingrediente y pasará a ser un insumo simple.",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#d33',
                    cancelButtonColor: '#3085d6',
                    confirmButtonText: 'Sí, eliminar',
                    cancelButtonText: 'Cancelar'
                });
                
                if (confirmed.isConfirmed) {
                    try {
                        if (window.eliminarComposicionMix) {
                            // Ejecutamos la que esta en ingredientes.js
                            modal.style.display = 'none'; // cerramos el modal
                            await window.eliminarComposicionMix(mixId);
                        } else {
                            // Backup en caso de que no este definida
                            const response = await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${mixId}/composicion\`, {
                                method: 'DELETE'
                            });
                            if (!response.ok) throw new Error('Error eliminando formula');
                            
                            modal.style.display = 'none';
                            Swal.fire('Eliminada', 'La fórmula fue eliminada.', 'success');
                            if (window.actualizarResumenIngredientes) await window.actualizarResumenIngredientes();
                            else if (window.cargarIngredientes) await window.cargarIngredientes();
                        }
                    } catch (error) {
                       Swal.fire('Error', error.message, 'error');
                    }
                }
            };
        }`;

if (file.includes(oldHooks)) {
    file = file.replace(oldHooks, newHooks);
} else {
    console.error("No se encontraron los hooks para reemplazar en mix.js");
}

/* Also hook the cancel button */
const oldCancelHooks = "const closeButtons = modal.querySelectorAll('.close-modal');";
const newCancelHooks = "const closeButtons = modal.querySelectorAll('.close-modal, .close-modal-btn');";
if (file.includes(oldCancelHooks)) {
    file = file.replace(oldCancelHooks, newCancelHooks);
}

fs.writeFileSync('src/produccion/js/mix.js', file, 'utf8');
