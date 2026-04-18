const fs = require('fs');

const css = `
/* ============================================
 * TARJETAS APAISADAS DE INGREDIENTES
 * ============================================ */

.ingredientes-landscape-grid {
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

.tarjeta-cuerpo {
    flex-grow: 1;
}

.tarjeta-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
}

.tarjeta-codigo {
    background-color: #e2e8f0;
    color: #475569;
    font-size: 0.75rem;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    letter-spacing: 0.5px;
}

.tarjeta-titulo {
    font-size: 1.1rem;
    color: #1e293b;
    margin: 0 0 6px 0;
    font-weight: 700;
    line-height: 1.2;
}

.tarjeta-descripcion {
    font-size: 0.85rem;
    color: #64748b;
    margin-bottom: 12px;
    line-height: 1.4;
}

.tarjeta-stats {
    display: flex;
    gap: 12px;
    margin-bottom: 15px;
    background: #f1f5f9;
    padding: 10px;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
}

.stat-item {
    display: flex;
    flex-direction: column;
    flex: 1;
}

.stat-label {
    font-size: 0.7rem;
    color: #64748b;
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 2px;
    letter-spacing: 0.5px;
}

.stat-value {
    font-size: 1.25rem;
    font-weight: 800;
    color: #0f172a;
}

.stat-value small {
    font-size: 0.8rem;
    color: #64748b;
    font-weight: 600;
}

.stat-item.stock-cero .stat-value {
    color: #dc2626;
}

.tarjeta-footer {
    display: flex;
    gap: 8px;
    border-top: 1px solid #e2e8f0;
    padding-top: 12px;
    flex-wrap: wrap;
}

.btn-tarjeta {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
    background-color: #f1f5f9;
    color: #475569;
    transition: all 0.2s;
    flex: 1;
    text-align: center;
}

.btn-tarjeta:hover {
    background-color: #e2e8f0;
}

.btn-tarjeta.action {
    background-color: #e0f2fe;
    color: #0369a1;
}

.btn-tarjeta.action:hover {
    background-color: #bae6fd;
}

.btn-tarjeta-sector {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    border: 1px solid #cbd5e1;
    cursor: pointer;
    background-color: #ffffff;
    color: #3b82f6;
    transition: all 0.2s;
    text-align: center;
}
.btn-tarjeta-sector:hover {
    background-color: #eff6ff;
    border-color: #93c5fd;
}

.btn-imprimir-cartel {
    background: #17a2b8;
    color: white;
    border: none;
    padding: 6px 14px;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.95rem;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    transition: all 0.2s;
}

.btn-imprimir-cartel:hover {
    background: #138496;
    transform: translateY(-1px);
}

@media print {
    body.modo-impresion-cartel * {
        visibility: hidden;
    }
    body.modo-impresion-cartel #cartel-print-container,
    body.modo-impresion-cartel #cartel-print-container * {
        visibility: visible;
    }
    body.modo-impresion-cartel #cartel-print-container {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100vh;
        display: flex !important;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        page-break-after: always;
        text-align: center;
    }
    .cartel-letra {
        font-size: 250px;
        font-weight: 900;
        line-height: 1;
        margin-bottom: 20px;
        color: #000;
    }
    .cartel-nombre {
        font-size: 60px;
        font-weight: 700;
        color: #333;
    }
    @page {
        size: A4 landscape;
        margin: 0;
    }
}
`;
fs.appendFileSync('src/produccion/css/ingredientes-panel.css', css);
console.log('Done append.');
