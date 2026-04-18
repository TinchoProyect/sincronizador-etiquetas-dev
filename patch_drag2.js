const fs = require('fs');

// HTML: Ensure exact absolute centering with fixed position (to override flex parent constraints and margin glitches)
let html = fs.readFileSync('src/produccion/pages/ingredientes.html', 'utf8');

const oldModalContentStyleRegex = /class="modal-content"[^>]*?style="[^"]*?"/;
const newModalContentStyle = 'class="modal-content" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); margin: 0; max-width: 600px; width: 100%; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1);"';

if (html.match(oldModalContentStyleRegex)) {
    html = html.replace(oldModalContentStyleRegex, newModalContentStyle);
    fs.writeFileSync('src/produccion/pages/ingredientes.html', html, 'utf8');
    console.log('HTML Modal Centering fixed.');
}

// JS: Fix drag functionality replacing the whole drag block
let js = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

// The drag functions we want to replace
const dragRegex = /function dragMouseDown\(e\) \{[\s\S]*?function closeDragElement\(\) \{[\s\S]*?document\.onmousemove = null;\s*\}/;

const newDrag = `function dragMouseDown(e) {
            e.preventDefault();
            
            // Si el modal está centrado via transform (nuestra config default), 
            // cambiar eso a top/left exacto absoluto ANTES de arrastrar para que NO HAGA UN SALTO (-50% transform elimina la estetica).
            if (modal.style.position !== 'absolute' || modal.style.transform === 'translate(-50%, -50%)') {
                const rect = modal.getBoundingClientRect();
                modal.style.position = 'absolute';
                modal.style.margin = '0';
                modal.style.transform = 'none'; // Aquí la clave: al desactivarlo, top/left asumen control total de la fisica
                // Asignamos la ubicacion exacta que tenia en pantalla visualmente gracias a getBoundingClientRect:
                modal.style.top = rect.top + 'px';
                modal.style.left = rect.left + 'px';
            }
            
            // Obtener la posición del cursor al inicio
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            // Calcular la nueva posición via diferencia
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            
            // Establecer la nueva posición. Usamos offsetTop porque acabamos de volverlo puramente absoluto en el mousedown.
            let nextTop = modal.offsetTop - pos2;
            let nextLeft = modal.offsetLeft - pos1;
            
            // Prevenir pérdida del modal fuera de la pantalla (Left o Top negativos)
            if (nextTop < 0) nextTop = 0;
            if (nextLeft < 0) nextLeft = 0;
            
            modal.style.top = nextTop + "px";
            modal.style.left = nextLeft + "px";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }`;

if (js.match(dragRegex)) {
    js = js.replace(dragRegex, newDrag);
    fs.writeFileSync('src/produccion/js/ingredientes.js', js, 'utf8');
    console.log('JS Drag Physics fix applied.');
} else {
    console.log('Could not find drag block in js.');
}
