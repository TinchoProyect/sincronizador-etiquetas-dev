const fs = require('fs');

let mixJS = fs.readFileSync('src/produccion/js/mix.js', 'utf8');

const regexViejo = /export async function abrirEdicionMix\(mixId\) \{[\s\S]*?modal\.style\.display = 'block';/g;

const nuevaFunc = `export async function abrirEdicionMix(mixId) {
    const modal = document.getElementById('modal-mix');
    if (!modal) {
        console.error('❌ Modal #modal-mix no encontrado en el DOM');
        return;
    }

    // Resetear coordenadas para anular residuos drag and drop y forzar centrado (UX Fix)
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
        modalContent.style.position = 'relative';
        modalContent.style.top = '';
        modalContent.style.left = '';
        modalContent.style.margin = '10vh auto';
    }

    mixActual = mixId;
    ingredienteSeleccionadoId = null;

    try {
        if (ingredientesLista.length === 0) {
            const response = await fetch('http://localhost:3002/api/produccion/ingredientes');
            if (!response.ok) throw new Error('No se pudieron cargar los ingredientes');
            ingredientesLista = await response.json();
        }

        const compResponse = await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${mixId}/composicion\`);
        if (!compResponse.ok) throw new Error('Error al cargar la composición del mix');
        const data = await compResponse.json();

        // Actualizar título
        const titulo = modal.querySelector('#modal-mix-titulo') || modal.querySelector('h5') || modal.querySelector('h2');
        if (titulo) {
            titulo.textContent = \`Composición de: \${data.mix.nombre}\`;
        }

        // Actualizar tabla de composición con botones de eliminar como íconos
        const tbody = modal.querySelector('#tabla-mix-ingredientes-body');
        tbody.innerHTML = data.composicion.map(item => \`
            <tr>
                <td style="padding: 12px; font-weight: 500;">\${item.nombre_ingrediente}</td>
                <td style="padding: 12px;">\${item.cantidad} \${item.unidad_medida || ''}</td>
                <td style="text-align: right; padding: 12px;">
                    <button 
                        onclick="window.eliminarIngredienteDeMix(\${mixId}, \${item.ingrediente_id})" 
                        class="btn-eliminar-ingrediente"
                        title="Eliminar ingrediente"
                        style="background: transparent; border: none; font-size: 1.2rem; cursor: pointer; transition: transform 0.2s;"
                        onmouseover="this.style.transform='scale(1.2)'"
                        onmouseout="this.style.transform='scale(1)'"
                    >❌</button>
                </td>
            </tr>
        \`).join('');

        // Calcular y mostrar el total
        calcularYMostrarTotal();

        // Configurar búsqueda
        const inputBusqueda = document.getElementById('buscar-ingrediente-mix');
        inputBusqueda.value = '';
        inputBusqueda.removeEventListener('input', manejarBusquedaMix); // Limpiar listener anterior
        inputBusqueda.addEventListener('input', manejarBusquedaMix);

        // Configurar botón de agregar
        const btnAgregar = modal.querySelector('#btn-agregar-a-mix');
        btnAgregar.onclick = () => agregarIngredienteAMix(mixId);

        // Configurar botón de guardar receta
        const btnGuardarMix = modal.querySelector('#btn-guardar-mix');
        btnGuardarMix.onclick = () => guardarRecetaMix(mixId);

        // Mostrar boton eliminar SOLO si hay composicion
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
                            const response = await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${mixId}/composicion\`, { method: 'DELETE' });
                            if (!response.ok) throw new Error('Error eliminando formula');
                            await fetch(\`http://localhost:3002/api/produccion/ingredientes/\${mixId}\`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padre_id: null }) });
                            modal.style.display = 'none';
                            alert('Fórmula eliminada');
                            if (typeof window.cargarIngredientes === 'function') await window.cargarIngredientes(); else location.reload();
                        }
                    } catch (error) { alert(error.message); }
                }
            };
        }

        modal.style.display = 'flex';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'flex-start';
        // Enlazar los botones cerrar nativos 
        const closeBtns = modal.querySelectorAll('.close-modal, .close-modal-btn');
        closeBtns.forEach((b)=>{ b.onclick = () => modal.style.display = 'none'; });
`;

if (mixJS.match(regexViejo)) {
    mixJS = mixJS.replace(regexViejo, nuevaFunc);
    fs.writeFileSync('src/produccion/js/mix.js', mixJS, 'utf8');
} else {
    // Si no lo encuentra podria estar buscando export function... (por lo del eval anterior)
    console.log("No hice match con la regex de reset.");
}
