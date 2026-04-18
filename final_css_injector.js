const fs = require('fs');

let cssFile = 'src/produccion/css/ingredientes-panel.css';
let css = fs.readFileSync(cssFile, 'utf8');

const sIdx = css.indexOf('/* ============================================\r\n * TABLA DE INGREDIENTES');
const _sIdx = css.indexOf('/* ============================================\n * TABLA DE INGREDIENTES');
const trueStart = sIdx !== -1 ? sIdx : _sIdx;

const eIdx = css.indexOf('/* ============================================\r\n * RESPONSIVE');
const _eIdx = css.indexOf('/* ============================================\n * RESPONSIVE');
const trueEnd = eIdx !== -1 ? eIdx : _eIdx;

const cardsCSS = `/* ============================================
 * TARJETAS APAISADAS DE INGREDIENTES
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
    margin-bottom: 5px;
    border-bottom: 2px solid #e2e8f0;
    padding-bottom: 8px;
    display: flex;
    align-items: center;
}

.sector-group-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: #334155;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.tarjeta-ingrediente {
    background: #ffffff;
    backdrop-filter: none;
    border: 1px solid #d1d5db;
    border-left: 4px solid #475569;
    border-radius: 8px;
    padding: 16px 18px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 140px;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.tarjeta-ingrediente:nth-child(even) {
    background: #f8fafc;
}

.tarjeta-ingrediente:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.08);
}

.tarjeta-main {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 15px;
    flex-grow: 1;
}

.tarjeta-info-principal {
    flex: 1;
}

.tarjeta-titulo {
    font-size: 1.05rem;
    color: #1e293b;
    margin: 0 0 10px 0;
    font-weight: 600;
    line-height: 1.3;
}

.tarjeta-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 15px;
}

.badge-sutil {
    background: #f1f5f9;
    color: #475569;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    border: 1px solid #e2e8f0;
}

.badge-warning {
    background: #fffbeb;
    color: #b45309;
    border-color: #fde68a;
}

.tarjeta-stock {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    background: #f8fafc;
    padding: 10px 14px;
    border-radius: 8px;
    min-width: 100px;
    border: 1px solid #e2e8f0;
}

.stock-valor {
    font-size: 1.4rem;
    font-weight: 700;
    color: #0f172a;
    line-height: 1;
    margin-bottom: 2px;
}

.stock-unidad {
    font-size: 0.8rem;
    color: #64748b;
    text-transform: uppercase;
    font-weight: 600;
}

.stock-potencial-texto {
    font-size: 0.75rem;
    color: #94a3b8;
    margin-top: 6px;
    white-space: nowrap;
}

.tarjeta-acciones-inferior {
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px dashed #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.acciones-grupo {
    display: flex;
    gap: 8px;
}

.btn-accion-icono {
    background: transparent;
    border: 1px solid #e2e8f0;
    color: #64748b;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    font-weight: 600;
}

.btn-accion-icono:hover {
    background: #f1f5f9;
    color: #334155;
    border-color: #cbd5e1;
}

.text-imprimir:hover { color: #0284c7; background: #e0f2fe; border-color: #bae6fd; }
.text-edit:hover { color: #ea580c; background: #ffedd5; border-color: #fed7aa; }
.text-danger:hover { color: #dc2626; background: #fee2e2; border-color: #fecaca; }
.text-mix:hover { color: #4f46e5; background: #e0e7ff; border-color: #c7d2fe; }

.tarjeta-acciones-principales {
    display: flex;
    gap: 6px;
}
`;

if (trueStart !== -1 && trueEnd !== -1) {
    let finalCss = css.substring(0, trueStart) + cardsCSS + '\\n\\n' + css.substring(trueEnd);

    // Apply global container patch exactly like final_fixes.js
    finalCss = finalCss.replace(/\\.ingredientes-container\\s*\\{[\\s\\S]*?\\}/, '.ingredientes-container {\\n    display: flex;\\n    height: calc(100vh - 120px);\\n    gap: 0;\\n    margin: 0;\\n    padding: 0;\\n    background: #f1f5f9;\\n}');

    // Fix body background like final_fixes.js
    finalCss = finalCss.replace(/body\\s*\\{[\\s\\S]*?background-color:\\s*#[a-fA-F0-9]{3,6};\\s*}/, 'body { background-color: #f1f5f9; }');

    // Make print media query spooler fix
    const classList = 'body.modo-impresion-cartel .container,\\n    body.modo-impresion-cartel .ingredientes-container,\\n    body.modo-impresion-cartel header,\\n    body.modo-impresion-cartel footer,';
    finalCss = finalCss.replace(/body\\.modo-impresion-cartel \\.app-container,/, classList);

    // Apply Cartel A4 Print Styles from printer_ext.js
    const printStyles = '\\n/* ============================================ */\\n/* MEDIA PRINT - CARTELERIA A4                  */\\n/* ============================================ */\\n@media print {\\n    body.modo-impresion-cartel .container,\\n    body.modo-impresion-cartel .ingredientes-container,\\n    body.modo-impresion-cartel header,\\n    body.modo-impresion-cartel footer,\\n    body.modo-impresion-cartel nav,\\n    body.modo-impresion-cartel .header,\\n    body.modo-impresion-cartel .swal2-container {\\n        display: none !important;\\n    }\\n    \\n    body.modo-impresion-cartel {\\n        background: white !important;\\n        margin: 0;\\n        padding: 0;\\n    }\\n\\n    body.modo-impresion-cartel #cartel-print-container {\\n        display: flex !important;\\n        flex-direction: column;\\n        justify-content: center;\\n        align-items: center;\\n        width: 100vw;\\n        height: 100vh;\\n        margin: 0;\\n        padding: 0;\\n        position: fixed;\\n        top: 0;\\n        left: 0;\\n        background: white;\\n        z-index: 999999;\\n        text-align: center;\\n    }\\n\\n    body.modo-impresion-cartel #cartel-print-container .cartel-letra {\\n        font-size: 45vh;\\n        font-weight: 900;\\n        line-height: 1;\\n        margin-bottom: 2vh;\\n        color: #000;\\n        font-family: Arial, Helvetica, sans-serif;\\n    }\\n\\n    body.modo-impresion-cartel #cartel-print-container .cartel-nombre {\\n        font-size: 8vh;\\n        font-weight: bold;\\n        text-transform: uppercase;\\n        color: #333;\\n        font-family: Arial, Helvetica, sans-serif;\\n    }\\n\\n    @page {\\n        size: A4 landscape;\\n        margin: 0;\\n    }\\n}';
    finalCss += printStyles;

    fs.writeFileSync('src/produccion/css/ingredientes-panel.css', finalCss, 'utf8');
    console.log('Successfully written perfect CSS blocks!');
} else {
    console.log('Failed to find CSS markers!', trueStart, trueEnd);
}
