/**
 * VISOR VIGIA DE AUDITORÍA Y DEPURACIÓN - PRODUCCIÓN
 * Copiar y pegar en la consola para activar el panel de monitoreo en tiempo real.
 */
(function () {
    // Evitar múltiples instancias
    if (document.getElementById('visor-vigia-panel')) return;

    // --- ESTILOS CSS ---
    const style = document.createElement('style');
    style.textContent = `
        #visor-vigia-panel {
            position: fixed;
            bottom: 10px;
            right: 10px;
            width: 350px;
            background: rgba(0, 0, 0, 0.85);
            color: #0f0;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
            border-radius: 8px;
            z-index: 99999;
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
            border: 1px solid #333;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transition: opacity 0.3s;
        }
        #visor-vigia-header {
            background: #222;
            padding: 8px;
            cursor: move;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #444;
        }
        #visor-vigia-content {
            padding: 10px;
            max-height: 400px;
            overflow-y: auto;
        }
        .vigia-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            border-bottom: 1px dotted #444;
            padding-bottom: 2px;
        }
        .vigia-label { color: #ccc; }
        .vigia-value { font-weight: bold; }
        .vigia-ok { color: #4caf50; }
        .vigia-error { color: #f44336; }
        .vigia-warn { color: #ff9800; }
        .vigia-btn {
            background: #333;
            color: white;
            border: 1px solid #555;
            padding: 4px 8px;
            cursor: pointer;
            margin-top: 5px;
            width: 100%;
        }
        .vigia-btn:hover { background: #444; }
        #vigia-logs {
            margin-top: 10px;
            border-top: 1px solid #444;
            padding-top: 5px;
            font-size: 11px;
            color: #aaa;
            max-height: 100px;
            overflow-y: auto;
        }
    `;
    document.head.appendChild(style);

    // --- CREAR UI ---
    const panel = document.createElement('div');
    panel.id = 'visor-vigia-panel';
    panel.innerHTML = `
        <div id="visor-vigia-header">
            <span>👁️ VIGIA: Configurar Carros</span>
            <button onclick="document.getElementById('visor-vigia-panel').remove()" style="background:none;border:none;color:white;cursor:pointer;">x</button>
        </div>
        <div id="visor-vigia-content">
            <div id="vigia-status-list"></div>
            <button class="vigia-btn" id="btn-force-check">🔄 Forzar Chequeo</button>
            <button class="vigia-btn" id="btn-manual-render">🛠️ Re-renderizar Sugerencias</button>
            <div id="vigia-logs"></div>
        </div>
    `;
    document.body.appendChild(panel);

    // --- LÓGICA DE MONITOREO ---
    const logContainer = document.getElementById('vigia-logs');

    function log(msg, type = 'info') {
        const div = document.createElement('div');
        const time = new Date().toLocaleTimeString();
        div.textContent = `[${time}] ${msg}`;
        if (type === 'error') div.style.color = '#f44336';
        logContainer.prepend(div);
    }

    function checkStatus() {
        const list = document.getElementById('vigia-status-list');
        if (!list) return;

        const checks = [
            {
                label: 'Global: obtenerPackMapping',
                value: typeof window.obtenerPackMapping === 'function',
                okVal: true
            },
            {
                label: 'Global: toggleExpandirArticulo',
                value: typeof window.toggleExpandirArticulo === 'function',
                okVal: true
            },
            {
                label: 'DOM: #carros-lista-container',
                value: !!document.getElementById('carros-lista-container'),
                okVal: true
            },
            {
                label: 'DOM: #carros-sugerencias-container',
                value: !!document.getElementById('carros-sugerencias-container'),
                okVal: true
            },
            {
                label: 'DOM: #carros-panel-content',
                value: !!document.getElementById('carros-panel-content'),
                okVal: true
            },
            {
                label: 'Datos: __resumenFaltantesDatos',
                value: window.__resumenFaltantesDatos ? `${window.__resumenFaltantesDatos.length} items` : 'NULL',
                okVal: v => v !== 'NULL'
            }
        ];

        list.innerHTML = checks.map(c => {
            const isOk = typeof c.okVal === 'function' ? c.okVal(c.value) : c.value === c.okVal;
            const displayVal = typeof c.value === 'boolean' ? (c.value ? 'SI' : 'NO') : c.value;
            return `
                <div class="vigia-item">
                    <span class="vigia-label">${c.label}</span>
                    <span class="vigia-value ${isOk ? 'vigia-ok' : 'vigia-error'}">${displayVal}</span>
                </div>
            `;
        }).join('');
    }

    // --- ACCIONES ---
    document.getElementById('btn-force-check').onclick = () => {
        checkStatus();
        log('Chequeo forzado ejecutado');
    };

    document.getElementById('btn-manual-render').onclick = () => {
        log('Intentando re-render manual...');
        if (typeof window.procesarYRenderizarSugerencias === 'function') {
            window.procesarYRenderizarSugerencias()
                .then(() => log('Render manual completado', 'ok'))
                .catch(e => log(`Error render manual: ${e.message}`, 'error'));
        } else {
            // Intento de fallback si la función no es global (está dentro del módulo)
            // Emitimos el evento de nuevo
            if (window.__resumenFaltantesDatos) {
                window.dispatchEvent(new CustomEvent('resumen:faltantes:listo', {
                    detail: { datos: window.__resumenFaltantesDatos }
                }));
                log('Evento resumen:faltantes:listo re-emitido');
            } else {
                log('Error: No hay datos para re-emitir evento', 'error');
            }
        }
    };

    // --- INICIAR VIGIA ---
    checkStatus();
    setInterval(checkStatus, 2000); // Chequeo cada 2s
    log('Visor Vigia iniciado. Monitoreando...');

    // Observador de mutaciones para detectar cambios en el DOM
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === 'childList') {
                // Verificar si se agregaron nodos relevantes
                m.addedNodes.forEach(node => {
                    if (node.id === 'carros-sugerencias-container') {
                        log('DOM: Contenedor sugerencias APERECIÓ', 'ok');
                        checkStatus();
                    }
                });
            }
        }
    });

    const target = document.getElementById('carros-panel-content') || document.body;
    observer.observe(target, { childList: true, subtree: true });

})();
