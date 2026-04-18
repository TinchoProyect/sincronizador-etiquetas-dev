const fs = require('fs');

// ==== Fix HTML margin for centering ====
let fileHTML = fs.readFileSync('src/produccion/pages/ingredientes.html', 'utf8');

// The string I injected previously:
const targetString = 'class="modal-content" style="position: relative; max-width: 600px;';
if (fileHTML.includes(targetString)) {
    fileHTML = fileHTML.replace(targetString, 'class="modal-content" style="margin: 10vh auto; position: relative; max-width: 600px;');
    fs.writeFileSync('src/produccion/pages/ingredientes.html', fileHTML, 'utf8');
}


// ==== Fix JS Drag Logic ====
let fileJS = fs.readFileSync('src/produccion/js/ingredientes.js', 'utf8');

const regexViejo = /function dragMouseDown\(e\) \{[\s\S]*?function elementDrag\(e\) \{[\s\S]*?modal\.style\.left = \(modal\.offsetLeft - pos1\) \+ "px";\s*\}/;

const nuevaLogic = `function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            
            // Fix critico UX: Anclar posicion absoluta en el momento del click para que no salte ni desaparezca por el margin auto
            if (modal.style.position !== 'absolute') {
                const rect = modal.getBoundingClientRect();
                modal.style.margin = '0';
                modal.style.position = 'absolute';
                modal.style.left = rect.left + 'px';
                modal.style.top = rect.top + 'px';
                modal.style.transform = 'none';
            }
            
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;

            // Establecer la nueva posición basada en el offsetTop/Left que ahora es absoluto y estable
            let newTop = modal.offsetTop - pos2;
            let newLeft = modal.offsetLeft - pos1;
            
            // Fix critico UX: Prevenir que se pierda del viewport
            if (newTop < 0) newTop = 0;
            if (newLeft < 0) newLeft = 0;
            
            modal.style.top = newTop + "px";
            modal.style.left = newLeft + "px";
        }`;

if (fileJS.match(regexViejo)) {
    fileJS = fileJS.replace(regexViejo, nuevaLogic);
}

// Reset the modal's style coordinates when it is closed, to prevent the "crisis" and allow it to center naturally next time
// Let's hook into the close drag element just to make sure
const oldCloseDrag = /function closeDragElement\(\) \{\s*document\.onmouseup = null;\s*document\.onmousemove = null;\s*\}/;
const newCloseDrag = `function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }`;

if (fileJS.match(oldCloseDrag)) {
    fileJS = fileJS.replace(oldCloseDrag, newCloseDrag);
}

// Also, the user mentioned that if the modal is hidden, the state corrupts. 
// Actually, the main issue was the jumping off screen during drag (which made it impossible to close, causing the "crisis").
// The boundary limits and absolute switch prevent the disappearing.
// To be perfectly safe, I'll add a snippet to \`abrirEdicionMix\` in mix.js that resets the modal CSS back into default centering.

fs.writeFileSync('src/produccion/js/ingredientes.js', fileJS, 'utf8');

console.log('UI/UX Drag fixes Complete');
