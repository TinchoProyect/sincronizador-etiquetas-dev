const fs = require('fs');
const FILE_PATH = 'src/produccion/css/ingredientes-panel.css';
let content = fs.readFileSync(FILE_PATH, 'utf8');

const anchorStart = `/* ============================================
 * TABLA DE INGREDIENTES
 * ============================================ */`;
const anchorEnd = `/* ============================================
 * RESPONSIVE
 * ============================================ */`;

const s = content.search(/\\/\\* ============================================\\r?\\n \\* TABLA DE INGREDIENTES\\r?\\n \\* ============================================ \\*\\//); const e = content.search(/\\/\\* ============================================\\r?\\n \\* RESPONSIVE\\r?\\n \\* ============================================ \\*\\//); if(s !== -1 && e !== -1) { const idxStart = s; const idxEnd = e;
    const newCss = `/* ============================================
 * TARJETAS APAISADAS DE INGREDIENTES (GLASSMORPHISM)
 * ============================================ */

.tarjetas-container {
    display: flex;
    flex-direction: column;
    gap: 30px;
    margin-top: 20px;
}

.sector-group-content {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    gap: 15px;
}

.sector-group-header {
    margin-bottom: 15px;
}

.sector-group-header h3 {
    font-size: 1.4rem;
    color: #2c3e50;
    font-weight: 700;
    margin: 0;
    padding-bottom: 5px;
    display: inline-block;
}

.sector-divider {
    height: 3px;
    width: 60px;
    background: linear-gradient(90deg, #007bff, #00d2ff);
    border-radius: 3px;
    margin-top: 4px;
}

.tarjeta-ingrediente {
    background: rgba(255, 255, 255, 0.7);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 12px;
    padding: 18px;
    box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.05);
    display: flex;
    flex-direction: column;
    gap: 15px;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.tarjeta-ingrediente:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 40px 0 rgba(31, 38, 135, 0.1);
    background: rgba(255, 255, 255, 0.9);
}

.tarjeta-main {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
}

.tarjeta-info-principal {
    flex: 1;
}

.tarjeta-titulo {
    font-weight: 700;
    font-size: 1.2rem;
    color: #1a1a1a;
    margin: 0 0 8px 0;
    line-height: 1.2;
}

.tarjeta-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
}

.badge-sutil {
    background: #f0f2f5;
    color: #5c6bc0;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 6px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
}

.tarjeta-stock {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    background: linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%);
    padding: 8px 12px;
    border-radius: 8px;
    min-width: 90px;
    border: 1px solid #e0e0e0;
}

.stock-valor {
    font-size: 1.4rem;
    font-weight: 800;
    color: #2e7d32;
    line-height: 1;
}

.stock-unidad {
    font-size: 0.8rem;
    color: #666;
    font-weight: 600;
    margin-top: 2px;
}

.tarjeta-acciones-inferior {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid rgba(0, 0, 0, 0.05);
    padding-top: 12px;
    margin-top: auto;
}

.btn-accion-icono {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.95rem;
    padding: 6px 12px;
    border-radius: 6px;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #555;
    font-weight: 600;
}

.btn-accion-icono:hover {
    background: #f0f0f0;
}

.btn-imprimir-rapido.text-imprimir {
    background: rgba(0, 123, 255, 0.1);
    color: #0056b3;
}
.btn-imprimir-rapido.text-imprimir:hover {
    background: rgba(0, 123, 255, 0.2);
}

.text-ajuste {
    color: #d35400;
    background: rgba(230, 126, 34, 0.1);
}
.text-ajuste:hover {
    background: rgba(230, 126, 34, 0.2);
}

.text-eliminar {
    color: #c0392b;
}
.text-eliminar:hover {
    background: rgba(192, 57, 43, 0.1);
}

.text-mix {
    color: #8e44ad;
}
.text-mix:hover {
    background: rgba(142, 68, 173, 0.1);
}

.tarjeta-sector-selector {
    padding: 4px;
    border-radius: 4px;
    border: 1px solid #ccc;
    font-size: 0.8rem;
    background: #fff;
    max-width: 120px;
    color: #555;
}

.acciones-grupo {
    display: flex;
    gap: 4px;
}

/* Modificadores estéticos */
.stock-potencial-texto {
    font-size: 0.8rem;
    color: #27ae60;
    font-weight: 600;
    margin-top: 4px;
    display: block;
}

`;
    content = content.substring(0, idxStart) + newCss + content.substring(idxEnd);
    fs.writeFileSync(FILE_PATH, content, 'utf8');
    console.log('CSS Replaced Successfully!');
} else {
    console.log('Anchors not found in CSS');
}
