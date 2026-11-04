/**
 * Espacio de Autogestión "Mamus" — Retiro Simple de Ingredientes
 * Diseño austero, claro y secuencial en 3 pasos (1. Ingrediente, 2. Cantidad, 3. Confirmar)
 * con input en blanco despejado, opción de "Todo lo que queda (Total del saldo)" y ayudas discretas.
 */
(function () {
    let mamusIngredientesCache = [];
    let mamusIngredienteSeleccionado = null;
    let mamusUnidadSeleccionada = 'g'; // 'g' o 'kg'
    let mamusModoSaldoTotal = false;
    let mamusScanTimer = null;
    let mamusEnviando = false;

    function normalizarTextoMamus(txt) {
        if (!txt) return '';
        return String(txt)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    function obtenerTextoBusquedaIngredienteMamus(ing) {
        if (!ing) return '';
        const propios = [
            ing.codigo,
            ing.nombre,
            ing.descripcion,
            ing.categoria,
            ing.sector_letra,
            ing.sector_nombre,
            ing.articulo_vinculado_numero
        ]
            .filter(Boolean)
            .join(' ');
        const universal = typeof window.obtenerTextoBusquedaArticulo === 'function'
            ? window.obtenerTextoBusquedaArticulo(ing)
            : '';
        return normalizarTextoMamus(`${propios} ${universal}`);
    }

    function formatearStockAmigable(stockKgRaw) {
        const stockRaw = parseFloat(stockKgRaw || 0);
        const stockPositivo = stockRaw > 0 ? stockRaw : 0;
        const gramos = Math.round(stockPositivo * 1000);
        const kilosTxt = Number(stockPositivo.toFixed(3)).toString().replace('.', ',');
        if (stockPositivo <= 0) {
            return '0 g (0 kg)';
        }
        if (stockPositivo < 1) {
            return `${gramos} gramos (${kilosTxt} kg)`;
        }
        return `${kilosTxt} kg (${gramos} gramos)`;
    }

    function inyectarEstilosYDomMamus() {
        if (document.getElementById('modal-mamus-fullscreen')) return;

        const style = document.createElement('style');
        style.id = 'estilos-mamus-fullscreen';
        style.textContent = `
            #modal-mamus-fullscreen {
                display: none;
                position: fixed;
                inset: 0;
                width: 100vw;
                height: 100vh;
                background: #f8fafc;
                z-index: 99999;
                overflow-y: auto;
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
                color: #0f172a;
                box-sizing: border-box;
                padding: 0 0 60px 0;
            }
            #modal-mamus-fullscreen * {
                box-sizing: border-box;
            }
            .mamus-topbar {
                background: #1e293b;
                color: #ffffff;
                padding: 16px 28px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 3px solid #cbd5e1;
                position: sticky;
                top: 0;
                z-index: 10;
            }
            .mamus-topbar-title {
                font-size: 24px;
                font-weight: 800;
                margin: 0;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .mamus-btn-cerrar {
                background: #ffffff;
                color: #0f172a;
                border: 2px solid #94a3b8;
                border-radius: 10px;
                padding: 10px 20px;
                font-size: 18px;
                font-weight: 800;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            .mamus-btn-cerrar:hover {
                background: #f1f5f9;
            }
            .mamus-container {
                max-width: 820px;
                margin: 24px auto;
                padding: 0 20px;
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            .mamus-card {
                background: #ffffff;
                border: 2px solid #cbd5e1;
                border-radius: 16px;
                padding: 24px 28px;
                box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
            }
            .mamus-step-label {
                font-size: 22px;
                font-weight: 800;
                color: #0f172a;
                margin: 0 0 16px 0;
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .mamus-step-badge {
                background: #0f172a;
                color: #ffffff;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 19px;
                font-weight: 900;
                flex-shrink: 0;
            }
            .mamus-input-scanner {
                width: 100%;
                height: 64px;
                font-size: 24px;
                font-weight: 700;
                padding: 12px 18px;
                border: 2px solid #64748b;
                border-radius: 12px;
                background: #ffffff;
                color: #0f172a;
                outline: none;
            }
            .mamus-input-scanner:focus {
                border-color: #2563eb;
                box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15);
            }
            .mamus-sugerencias-lista {
                margin-top: 12px;
                display: grid;
                grid-template-columns: 1fr;
                gap: 8px;
                max-height: 300px;
                overflow-y: auto;
            }
            .mamus-sugerencia-item {
                background: #f8fafc;
                border: 2px solid #cbd5e1;
                border-radius: 10px;
                padding: 14px 18px;
                font-size: 20px;
                font-weight: 700;
                color: #0f172a;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 14px;
                text-align: left;
            }
            .mamus-sugerencia-item:hover {
                background: #eff6ff;
                border-color: #2563eb;
            }
            .mamus-sugerencia-stock {
                font-size: 18px;
                font-weight: 800;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .mamus-sugerencia-stock.con-stock {
                color: #15803d;
            }
            .mamus-sugerencia-stock.sin-stock {
                color: #dc2626;
            }
            .mamus-ingrediente-activo {
                background: #f0fdf4;
                border: 2px solid #16a34a;
                border-radius: 12px;
                padding: 18px 22px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 16px;
                flex-wrap: wrap;
            }
            .mamus-ingrediente-nombre {
                font-size: 26px;
                font-weight: 900;
                color: #14532d;
                margin: 0 0 6px 0;
            }
            .mamus-ingrediente-meta {
                font-size: 19px;
                font-weight: 700;
                color: #166534;
                margin: 0;
            }
            .mamus-btn-cambiar {
                background: #ffffff;
                color: #1e293b;
                border: 2px solid #64748b;
                border-radius: 10px;
                padding: 10px 16px;
                font-size: 17px;
                font-weight: 800;
                cursor: pointer;
            }
            .mamus-btn-cambiar:hover {
                background: #f1f5f9;
            }

            /* PASO 2: SELECTOR DE MODO Y CASILLERO DESPEJADO */
            .mamus-modos-label {
                font-size: 17px;
                font-weight: 700;
                color: #475569;
                margin: 0 0 10px 0;
            }
            .mamus-unidades-group {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
            }
            @media (max-width: 680px) {
                .mamus-unidades-group {
                    grid-template-columns: 1fr;
                }
            }
            .mamus-btn-unidad {
                min-height: 70px;
                padding: 12px 14px;
                border-radius: 12px;
                border: 2px solid #cbd5e1;
                background: #f8fafc;
                color: #1e293b;
                font-size: 19px;
                font-weight: 800;
                cursor: pointer;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                text-align: center;
                line-height: 1.2;
                transition: all 0.15s ease;
            }
            .mamus-btn-unidad small {
                font-size: 14px;
                font-weight: 600;
                color: #64748b;
                margin-top: 4px;
            }
            .mamus-btn-unidad:hover:not(:disabled) {
                border-color: #64748b;
                background: #f1f5f9;
            }
            .mamus-btn-unidad.activo {
                background: #1e293b;
                color: #ffffff;
                border-color: #0f172a;
            }
            .mamus-btn-unidad.activo small {
                color: #e2e8f0;
            }
            .mamus-btn-unidad.modo-total.activo {
                background: #0369a1;
                border-color: #075985;
                color: #ffffff;
            }
            .mamus-btn-unidad:disabled {
                opacity: 0.45;
                cursor: not-allowed;
            }

            /* ZONA DEL INPUT AISLADA Y LIMPIA */
            .mamus-input-zona {
                margin-top: 22px;
                padding: 22px 24px;
                background: #f8fafc;
                border: 2px solid #e2e8f0;
                border-radius: 14px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
            }
            .mamus-input-zona-label {
                font-size: 18px;
                font-weight: 800;
                color: #334155;
                margin: 0;
            }
            .mamus-input-box-row {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 14px;
                flex-wrap: wrap;
            }
            .mamus-input-cantidad {
                width: 240px;
                height: 76px;
                font-size: 38px;
                font-weight: 900;
                text-align: center;
                border: 3px solid #0f172a;
                border-radius: 12px;
                background: #ffffff;
                color: #0f172a;
                outline: none;
            }
            .mamus-input-cantidad:focus {
                border-color: #2563eb;
                box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.2);
            }
            .mamus-unidad-indicador {
                font-size: 24px;
                font-weight: 900;
                color: #0f172a;
                background: #e2e8f0;
                padding: 14px 20px;
                border-radius: 10px;
                min-width: 140px;
                text-align: center;
            }

            /* AYUDAS RÁPIDAS DISCRETAS */
            .mamus-ayudas-wrapper {
                margin-top: 18px;
                padding-top: 14px;
                border-top: 1px dashed #cbd5e1;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .mamus-ayudas-label {
                font-size: 14px;
                font-weight: 700;
                color: #64748b;
                margin-right: 4px;
            }
            .mamus-btn-preset {
                background: #ffffff;
                color: #475569;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                padding: 6px 12px;
                font-size: 15px;
                font-weight: 700;
                cursor: pointer;
            }
            .mamus-btn-preset:hover {
                background: #f1f5f9;
                border-color: #64748b;
                color: #0f172a;
            }

            /* PASO 3: CONFIRMACIÓN */
            .mamus-resumen-previo {
                padding: 16px 20px;
                border-radius: 12px;
                background: #f8fafc;
                border: 2px solid #cbd5e1;
                font-size: 22px;
                font-weight: 800;
                color: #1e293b;
                text-align: center;
                margin-bottom: 16px;
            }
            .mamus-resumen-previo.listo {
                background: #f0fdf4;
                border-color: #86efac;
                color: #14532d;
            }
            .mamus-btn-confirmar {
                width: 100%;
                height: 76px;
                background: #16a34a;
                color: #ffffff;
                border: 3px solid #14532d;
                border-radius: 14px;
                font-size: 26px;
                font-weight: 900;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
            }
            .mamus-btn-confirmar:hover:not(:disabled) {
                background: #15803d;
            }
            .mamus-btn-confirmar:disabled {
                background: #cbd5e1;
                border-color: #94a3b8;
                color: #64748b;
                cursor: not-allowed;
            }
            .mamus-alerta-exito {
                display: none;
                background: #dcfce7;
                border: 3px solid #16a34a;
                color: #14532d;
                padding: 20px 24px;
                border-radius: 14px;
                font-size: 23px;
                font-weight: 800;
                text-align: center;
            }
            .mamus-btn-finalizar-pizarra {
                margin-top: 14px;
                background: #1e293b;
                color: #ffffff;
                border: none;
                border-radius: 10px;
                padding: 12px 24px;
                font-size: 20px;
                font-weight: 800;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            .mamus-historial-lista {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .mamus-historial-item {
                background: #f8fafc;
                border: 1px solid #cbd5e1;
                border-radius: 10px;
                padding: 14px 18px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
                font-size: 19px;
            }
            .mamus-btn-anular {
                background: #fee2e2;
                color: #991b1b;
                border: 1px solid #ef4444;
                border-radius: 8px;
                padding: 8px 14px;
                font-size: 16px;
                font-weight: 800;
                cursor: pointer;
            }
            .mamus-btn-anular:hover {
                background: #fecaca;
            }
        `;
        document.head.appendChild(style);

        const overlay = document.createElement('div');
        overlay.id = 'modal-mamus-fullscreen';
        overlay.innerHTML = `
            <header class="mamus-topbar">
                <h1 class="mamus-topbar-title">🌸 Espacio de Mamus — Retiro de Ingredientes</h1>
                <button type="button" class="mamus-btn-cerrar" onclick="window.cerrarEspacioMamus()">
                    ← Volver a la Pizarra
                </button>
            </header>

            <div class="mamus-container">
                <div id="mamus-banner-exito" class="mamus-alerta-exito"></div>

                <!-- PUNTO 1: INGREDIENTE -->
                <section class="mamus-card">
                    <h2 class="mamus-step-label">
                        <span class="mamus-step-badge">1</span>
                        ¿Qué ingrediente te llevás?
                    </h2>

                    <div id="mamus-buscador-wrapper">
                        <div style="font-size: 16px; font-weight: 600; color: #475569; margin-bottom: 8px;">
                            Pasá el lector por el código de barras de la bolsa o escribí el nombre abajo:
                        </div>
                        <input
                            type="text"
                            id="mamus-input-ingrediente"
                            class="mamus-input-scanner"
                            placeholder=""
                            autocomplete="off"
                        />
                        <div id="mamus-sugerencias" class="mamus-sugerencias-lista" style="display: none;"></div>
                    </div>

                    <div id="mamus-ingrediente-seleccionado-card" class="mamus-ingrediente-activo" style="display: none;">
                        <div>
                            <p id="mamus-ing-nombre" class="mamus-ingrediente-nombre"></p>
                            <p id="mamus-ing-meta" class="mamus-ingrediente-meta"></p>
                        </div>
                        <button type="button" class="mamus-btn-cambiar" onclick="window.limpiarIngredienteMamus()">
                            Cambiar ingrediente
                        </button>
                    </div>
                </section>

                <!-- PUNTO 2: CANTIDAD DESPEJADA -->
                <section class="mamus-card">
                    <h2 class="mamus-step-label">
                        <span class="mamus-step-badge">2</span>
                        ¿Qué cantidad te llevás?
                    </h2>

                    <p class="mamus-modos-label">Elegí cómo anotar la cantidad:</p>
                    <div class="mamus-unidades-group">
                        <button type="button" id="mamus-btn-unidad-g" class="mamus-btn-unidad activo" onclick="window.seleccionarUnidadMamus('g')">
                            <span>En GRAMOS (g)</span>
                            <small>Menos de 1 kilo</small>
                        </button>
                        <button type="button" id="mamus-btn-unidad-kg" class="mamus-btn-unidad" onclick="window.seleccionarUnidadMamus('kg')">
                            <span>En KILOS (kg)</span>
                            <small>1 kilo o más</small>
                        </button>
                        <button type="button" id="mamus-btn-saldo-total" class="mamus-btn-unidad modo-total" onclick="window.seleccionarTodoElSaldoMamus()">
                            <span>TODO LO QUE QUEDA</span>
                            <small id="mamus-btn-saldo-total-sub">Total del saldo en sistema</small>
                        </button>
                    </div>

                    <!-- Casillero en blanco totalmente separado de los botones -->
                    <div class="mamus-input-zona">
                        <label for="mamus-input-cantidad" class="mamus-input-zona-label">
                            Escribí el número en el casillero en blanco:
                        </label>
                        <div class="mamus-input-box-row">
                            <input
                                type="text"
                                inputmode="decimal"
                                id="mamus-input-cantidad"
                                class="mamus-input-cantidad"
                                placeholder=""
                                autocomplete="off"
                            />
                            <div id="mamus-unidad-indicador" class="mamus-unidad-indicador">
                                GRAMOS (g)
                            </div>
                        </div>
                    </div>

                    <!-- Ayuditas discretas abajo sin invadir -->
                    <div class="mamus-ayudas-wrapper">
                        <span class="mamus-ayudas-label">Ayudas rápidas (opcional):</span>
                        <button type="button" class="mamus-btn-preset" onclick="window.aplicarPresetMamus(100, 'g')">100 g</button>
                        <button type="button" class="mamus-btn-preset" onclick="window.aplicarPresetMamus(200, 'g')">200 g</button>
                        <button type="button" class="mamus-btn-preset" onclick="window.aplicarPresetMamus(250, 'g')">250 g</button>
                        <button type="button" class="mamus-btn-preset" onclick="window.aplicarPresetMamus(500, 'g')">500 g</button>
                        <button type="button" class="mamus-btn-preset" onclick="window.aplicarPresetMamus(1, 'kg')">1 kg</button>
                    </div>
                </section>

                <!-- PUNTO 3: CONFIRMAR -->
                <section class="mamus-card">
                    <h2 class="mamus-step-label">
                        <span class="mamus-step-badge">3</span>
                        Confirmar el retiro
                    </h2>

                    <div id="mamus-resumen-previo" class="mamus-resumen-previo">
                        Primero elegí el ingrediente en el Punto 1
                    </div>

                    <button type="button" id="mamus-btn-confirmar" class="mamus-btn-confirmar" onclick="window.confirmarRetiroMamus()" disabled>
                        ✅ CONFIRMAR Y DESCONTAR STOCK
                    </button>
                </section>

                <!-- HISTORIAL RECIENTE -->
                <section class="mamus-card">
                    <h2 class="mamus-step-label" style="margin-bottom: 12px; font-size: 19px; color: #475569;">
                        Últimos retiros anotados
                    </h2>
                    <div id="mamus-historial-contenedor" class="mamus-historial-lista">
                        <div style="font-size: 18px; color: #64748b;">Cargando retiros recientes...</div>
                    </div>
                </section>
            </div>
        `;
        document.body.appendChild(overlay);

        configurarEventosInputsMamus();
    }

    async function cargarCatalogoIngredientesMamus() {
        try {
            const res = await fetch('/api/produccion/ingredientes');
            if (res.ok) {
                const data = await res.json();
                mamusIngredientesCache = Array.isArray(data) ? data : [];
            }
        } catch (err) {
            console.warn('⚠️ [MAMUS] Error precargando ingredientes:', err);
        }
    }

    async function buscarYSeleccionarPorCodigoMamus(codigoRaw) {
        const codigo = String(codigoRaw || '').trim();
        if (!codigo) return false;

        const codigoSinCeros = codigo.replace(/^0+/, '');
        let encontrado = mamusIngredientesCache.find(ing => {
            if (!ing.codigo) return false;
            const ingCod = String(ing.codigo).trim();
            return ingCod === codigo || ingCod.replace(/^0+/, '') === codigoSinCeros;
        });

        if (!encontrado) {
            try {
                const res = await fetch(`/api/produccion/ingredientes/buscar?codigo=${encodeURIComponent(codigo)}`);
                if (res.ok) {
                    encontrado = await res.json();
                }
            } catch (err) {
                console.warn('⚠️ [MAMUS] No se encontró por endpoint código:', err);
            }
        }

        if (encontrado && encontrado.id) {
            seleccionarIngredienteMamus(encontrado);
            return true;
        }
        return false;
    }

    function actualizarBotonSaldoTotal() {
        const btnTotal = document.getElementById('mamus-btn-saldo-total');
        const subTotal = document.getElementById('mamus-btn-saldo-total-sub');
        if (!btnTotal || !subTotal) return;

        if (!mamusIngredienteSeleccionado) {
            btnTotal.disabled = false;
            subTotal.textContent = 'Total del saldo en sistema';
            return;
        }

        const stockRaw = parseFloat(mamusIngredienteSeleccionado.stock_actual || 0);
        if (stockRaw <= 0) {
            btnTotal.disabled = true;
            subTotal.textContent = 'Sin saldo en sistema (0 g)';
        } else {
            btnTotal.disabled = false;
            if (stockRaw < 1) {
                subTotal.textContent = `Cargar los ${Math.round(stockRaw * 1000)} g de sistema`;
            } else {
                const kgTxt = Number(stockRaw.toFixed(3)).toString().replace('.', ',');
                subTotal.textContent = `Cargar los ${kgTxt} kg de sistema`;
            }
        }
    }

    function seleccionarIngredienteMamus(ing) {
        mamusIngredienteSeleccionado = ing;
        mamusModoSaldoTotal = false;

        const wrapperBuscador = document.getElementById('mamus-buscador-wrapper');
        const cardActivo = document.getElementById('mamus-ingrediente-seleccionado-card');
        const elNombre = document.getElementById('mamus-ing-nombre');
        const elMeta = document.getElementById('mamus-ing-meta');
        const sugDiv = document.getElementById('mamus-sugerencias');
        const inputScan = document.getElementById('mamus-input-ingrediente');

        if (inputScan) inputScan.value = '';
        if (sugDiv) {
            sugDiv.style.display = 'none';
            sugDiv.innerHTML = '';
        }
        if (wrapperBuscador) wrapperBuscador.style.display = 'none';
        if (cardActivo) cardActivo.style.display = 'flex';

        if (elNombre) {
            elNombre.textContent = `✅ ${ing.nombre}`;
        }
        if (elMeta) {
            const stockTexto = formatearStockAmigable(ing.stock_actual);
            elMeta.textContent = `Disponible en sistema: ${stockTexto}`;
        }

        actualizarBotonSaldoTotal();
        actualizarEstadoVisualUnidades();
        actualizarResumenPrevioMamus();

        const inputCant = document.getElementById('mamus-input-cantidad');
        if (inputCant) {
            setTimeout(() => {
                inputCant.focus();
            }, 60);
        }
    }

    window.limpiarIngredienteMamus = function () {
        mamusIngredienteSeleccionado = null;
        mamusModoSaldoTotal = false;
        const wrapperBuscador = document.getElementById('mamus-buscador-wrapper');
        const cardActivo = document.getElementById('mamus-ingrediente-seleccionado-card');
        const inputScan = document.getElementById('mamus-input-ingrediente');
        const inputCant = document.getElementById('mamus-input-cantidad');
        const sugDiv = document.getElementById('mamus-sugerencias');

        if (cardActivo) cardActivo.style.display = 'none';
        if (wrapperBuscador) wrapperBuscador.style.display = 'block';
        if (sugDiv) {
            sugDiv.style.display = 'none';
            sugDiv.innerHTML = '';
        }
        if (inputCant) inputCant.value = '';

        actualizarBotonSaldoTotal();
        actualizarEstadoVisualUnidades();
        actualizarResumenPrevioMamus();

        if (inputScan) {
            setTimeout(() => {
                inputScan.value = '';
                inputScan.focus();
            }, 50);
        }
    };

    function actualizarEstadoVisualUnidades() {
        const btnG = document.getElementById('mamus-btn-unidad-g');
        const btnKg = document.getElementById('mamus-btn-unidad-kg');
        const btnTotal = document.getElementById('mamus-btn-saldo-total');
        const indicador = document.getElementById('mamus-unidad-indicador');

        if (btnG) btnG.classList.toggle('activo', !mamusModoSaldoTotal && mamusUnidadSeleccionada === 'g');
        if (btnKg) btnKg.classList.toggle('activo', !mamusModoSaldoTotal && mamusUnidadSeleccionada === 'kg');
        if (btnTotal) btnTotal.classList.toggle('activo', mamusModoSaldoTotal);
        if (indicador) {
            indicador.textContent = mamusUnidadSeleccionada === 'kg' ? 'KILOS (kg)' : 'GRAMOS (g)';
        }
    }

    window.seleccionarUnidadMamus = function (unidad) {
        mamusModoSaldoTotal = false;
        mamusUnidadSeleccionada = unidad === 'kg' ? 'kg' : 'g';
        actualizarEstadoVisualUnidades();
        actualizarResumenPrevioMamus();

        const inputCant = document.getElementById('mamus-input-cantidad');
        if (inputCant) {
            inputCant.focus();
        }
    };

    window.seleccionarTodoElSaldoMamus = function () {
        if (!mamusIngredienteSeleccionado) {
            alert('Primero elegí el ingrediente en el Punto 1.');
            return;
        }

        const stockRaw = parseFloat(mamusIngredienteSeleccionado.stock_actual || 0);
        if (stockRaw <= 0) {
            alert('Este ingrediente figura sin stock en sistema. Ingresá la cantidad manualmente en Gramos o Kilos.');
            return;
        }

        mamusModoSaldoTotal = true;
        const inputCant = document.getElementById('mamus-input-cantidad');

        if (stockRaw < 1) {
            mamusUnidadSeleccionada = 'g';
            if (inputCant) inputCant.value = String(Math.round(stockRaw * 1000));
        } else {
            mamusUnidadSeleccionada = 'kg';
            if (inputCant) inputCant.value = String(Number(stockRaw.toFixed(3)));
        }

        actualizarEstadoVisualUnidades();
        actualizarResumenPrevioMamus();
    };

    window.aplicarPresetMamus = function (valor, unidad) {
        mamusModoSaldoTotal = false;
        mamusUnidadSeleccionada = unidad === 'kg' ? 'kg' : 'g';
        const inputCant = document.getElementById('mamus-input-cantidad');
        if (inputCant) {
            inputCant.value = String(valor);
        }
        actualizarEstadoVisualUnidades();
        actualizarResumenPrevioMamus();
    };

    function actualizarResumenPrevioMamus() {
        const resumenEl = document.getElementById('mamus-resumen-previo');
        const btnConfirmar = document.getElementById('mamus-btn-confirmar');
        const inputCant = document.getElementById('mamus-input-cantidad');
        if (!resumenEl || !btnConfirmar) return;

        if (!mamusIngredienteSeleccionado) {
            resumenEl.className = 'mamus-resumen-previo';
            resumenEl.innerHTML = 'Primero elegí el ingrediente en el Punto 1';
            btnConfirmar.disabled = true;
            return;
        }

        const rawVal = (inputCant ? inputCant.value : '').trim().replace(',', '.');
        const cantNum = parseFloat(rawVal);

        if (!rawVal || isNaN(cantNum) || cantNum <= 0) {
            resumenEl.className = 'mamus-resumen-previo';
            resumenEl.innerHTML = `Ingrediente: <strong>${mamusIngredienteSeleccionado.nombre}</strong> — Falta poner la cantidad en el Punto 2`;
            btnConfirmar.disabled = true;
            return;
        }

        const esGramos = mamusUnidadSeleccionada === 'g';
        const kilosCalculados = esGramos ? cantNum / 1000 : cantNum;
        const gramosCalculados = Math.round(kilosCalculados * 1000);

        const textoPrincipal = esGramos
            ? `${Math.round(cantNum)} gramos (${kilosCalculados.toFixed(3).replace('.', ',')} kg)`
            : `${cantNum.toString().replace('.', ',')} kilos (${gramosCalculados} gramos)`;

        const notaTotal = mamusModoSaldoTotal ? ' <span style="color:#0369a1;">(Total del saldo en sistema)</span>' : '';

        resumenEl.className = 'mamus-resumen-previo listo';
        resumenEl.innerHTML = `Vas a retirar: <strong>${textoPrincipal}</strong> de <strong>${mamusIngredienteSeleccionado.nombre}</strong>${notaTotal}`;
        btnConfirmar.disabled = false;
    }

    function coincideTerminoMamus(bolsa, termino) {
        if (!termino) return true;
        if (bolsa.includes(termino)) return true;
        if (termino.length >= 4 && termino.endsWith('s')) {
            const sinS = termino.slice(0, -1);
            if (bolsa.includes(sinS)) return true;
            if (termino.endsWith('es') && termino.length >= 5) {
                const sinEs = termino.slice(0, -2);
                if (bolsa.includes(sinEs)) return true;
            }
        }
        return false;
    }

    function filtrarYOrdenarIngredientesMamus(valor) {
        const terminos = normalizarTextoMamus(valor).split(/\s+/).filter(Boolean);
        if (terminos.length === 0) return [];

        return mamusIngredientesCache
            .filter(ing => {
                const bolsa = obtenerTextoBusquedaIngredienteMamus(ing);
                return terminos.every(t => coincideTerminoMamus(bolsa, t));
            })
            .sort((a, b) => {
                const stockA = parseFloat(a.stock_actual || 0);
                const stockB = parseFloat(b.stock_actual || 0);
                const tieneStockA = stockA > 0 ? 1 : 0;
                const tieneStockB = stockB > 0 ? 1 : 0;

                if (tieneStockA !== tieneStockB) {
                    return tieneStockB - tieneStockA;
                }

                return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
            });
    }

    function configurarEventosInputsMamus() {
        const inputScan = document.getElementById('mamus-input-ingrediente');
        const sugDiv = document.getElementById('mamus-sugerencias');
        const inputCant = document.getElementById('mamus-input-cantidad');

        if (inputScan) {
            inputScan.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (mamusScanTimer) clearTimeout(mamusScanTimer);
                    const valor = inputScan.value.trim();
                    if (!valor) return;

                    const okCodigo = await buscarYSeleccionarPorCodigoMamus(valor);
                    if (okCodigo) return;

                    const filtrados = filtrarYOrdenarIngredientesMamus(valor);
                    if (filtrados.length > 0) {
                        seleccionarIngredienteMamus(filtrados[0]);
                    }
                }
            });

            inputScan.addEventListener('input', async () => {
                if (mamusScanTimer) clearTimeout(mamusScanTimer);
                const valor = inputScan.value.trim();

                if (!valor) {
                    if (sugDiv) {
                        sugDiv.style.display = 'none';
                        sugDiv.innerHTML = '';
                    }
                    return;
                }

                if (/^\d{7,14}$/.test(valor)) {
                    mamusScanTimer = setTimeout(() => {
                        buscarYSeleccionarPorCodigoMamus(valor);
                    }, 120);
                    return;
                }

                if (mamusIngredientesCache.length === 0) {
                    await cargarCatalogoIngredientesMamus();
                }

                const coincidencias = filtrarYOrdenarIngredientesMamus(valor);

                if (!sugDiv) return;
                if (coincidencias.length === 0) {
                    sugDiv.style.display = 'block';
                    sugDiv.innerHTML = `<div style="padding:14px; font-size:19px; color:#64748b;">No se encontró ningún ingrediente con "${valor}"</div>`;
                    return;
                }

                sugDiv.style.display = 'grid';
                sugDiv.innerHTML = '';
                coincidencias.forEach(ing => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'mamus-sugerencia-item';
                    const stockRaw = parseFloat(ing.stock_actual || 0);
                    const tieneStock = stockRaw > 0;
                    const claseStock = tieneStock ? 'con-stock' : 'sin-stock';
                    const stockTxt = formatearStockAmigable(stockRaw);
                    btn.innerHTML = `
                        <span>🥜 ${ing.nombre}</span>
                        <span class="mamus-sugerencia-stock ${claseStock}">Stock: ${stockTxt}</span>
                    `;
                    btn.onclick = () => seleccionarIngredienteMamus(ing);
                    sugDiv.appendChild(btn);
                });
            });
        }

        if (inputCant) {
            inputCant.addEventListener('input', async () => {
                const rawVal = inputCant.value.trim();

                if (/^\d{7,14}$/.test(rawVal)) {
                    const codigoEscaneado = rawVal;
                    inputCant.value = '';
                    await buscarYSeleccionarPorCodigoMamus(codigoEscaneado);
                    return;
                }

                mamusModoSaldoTotal = false;
                actualizarEstadoVisualUnidades();
                actualizarResumenPrevioMamus();
            });

            inputCant.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    window.confirmarRetiroMamus();
                }
            });
        }
    }

    window.confirmarRetiroMamus = async function () {
        if (mamusEnviando || !mamusIngredienteSeleccionado) return;

        const inputCant = document.getElementById('mamus-input-cantidad');
        const rawVal = (inputCant ? inputCant.value : '').trim().replace(',', '.');
        const cantNum = parseFloat(rawVal);

        if (!rawVal || isNaN(cantNum) || cantNum <= 0) return;

        mamusEnviando = true;
        const btnConfirmar = document.getElementById('mamus-btn-confirmar');
        const textoOriginalBtn = btnConfirmar ? btnConfirmar.innerHTML : '';
        if (btnConfirmar) {
            btnConfirmar.disabled = true;
            btnConfirmar.innerHTML = '⏳ Guardando retiro...';
        }

        try {
            let usuarioId = null;
            try {
                const colab = JSON.parse(localStorage.getItem('colaboradorActivo') || 'null');
                if (colab && colab.id) usuarioId = colab.id;
            } catch (_) {}

            const res = await fetch('/api/produccion/ingredientes/retiro-mamus', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ingrediente_id: mamusIngredienteSeleccionado.id,
                    cantidad: cantNum,
                    unidad: mamusUnidadSeleccionada,
                    usuario_id: usuarioId
                })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'No se pudo descontar el stock');
            }

            const idx = mamusIngredientesCache.findIndex(i => Number(i.id) === Number(data.ingrediente_id));
            if (idx !== -1) {
                mamusIngredientesCache[idx].stock_actual = data.stock_nuevo;
            }

            const bannerExito = document.getElementById('mamus-banner-exito');
            if (bannerExito) {
                bannerExito.style.display = 'block';
                bannerExito.innerHTML = `
                    <div>✅ ¡Listo! Se descontaron <strong>${data.etiqueta_cantidad}</strong> de <strong>${data.ingrediente_nombre}</strong></div>
                    <div style="font-size: 18px; font-weight: 600; color: #166534; margin-top: 6px;">
                        Si terminaste, tocá el botón de abajo para volver a la Pizarra:
                    </div>
                    <button type="button" class="mamus-btn-finalizar-pizarra" onclick="window.cerrarEspacioMamus()">
                        ← Terminar y volver a la Pizarra
                    </button>
                `;
            }

            if (inputCant) inputCant.value = '';
            mamusModoSaldoTotal = false;
            mamusUnidadSeleccionada = 'g';
            window.limpiarIngredienteMamus();

            await cargarHistorialRetirosMamus();

            if (typeof window.cargarIngredientes === 'function') {
                try { window.cargarIngredientes(); } catch (_) {}
            }
            if (typeof window.actualizarAlertasPizarra === 'function') {
                try { window.actualizarAlertasPizarra(); } catch (_) {}
            }
        } catch (err) {
            alert(`Atención: ${err.message}`);
        } finally {
            mamusEnviando = false;
            if (btnConfirmar) {
                btnConfirmar.innerHTML = textoOriginalBtn || '✅ CONFIRMAR Y DESCONTAR STOCK';
                actualizarResumenPrevioMamus();
            }
        }
    };

    async function cargarHistorialRetirosMamus() {
        const cont = document.getElementById('mamus-historial-contenedor');
        if (!cont) return;

        try {
            const res = await fetch('/api/produccion/ingredientes/retiros-mamus');
            if (!res.ok) throw new Error('Error al consultar historial');
            const data = await res.json();
            const retiros = data.retiros || [];

            if (retiros.length === 0) {
                cont.innerHTML = '<div style="font-size: 18px; color: #64748b; padding: 6px 0;">Todavía no hay retiros anotados.</div>';
                return;
            }

            cont.innerHTML = '';
            retiros.slice(0, 10).forEach(r => {
                const fechaObj = new Date(r.fecha);
                const fechaTxt = fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
                const horaTxt = fechaObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                const kilosNum = parseFloat(r.kilos_retirados || 0);
                const cantTxt = kilosNum < 1
                    ? `${Math.round(kilosNum * 1000)} g`
                    : `${Number(kilosNum.toFixed(3)).toString().replace('.', ',')} kg (${Math.round(kilosNum * 1000)} g)`;

                const fila = document.createElement('div');
                fila.className = 'mamus-historial-item';
                fila.innerHTML = `
                    <div>
                        <strong style="color:#0f172a; font-size:20px;">🥜 ${r.ingrediente_nombre}</strong>
                        <span style="margin-left: 10px; background:#e2e8f0; color:#0f172a; padding:3px 10px; border-radius:8px; font-weight:800;">
                            ${cantTxt}
                        </span>
                        <div style="font-size:15px; color:#64748b; margin-top:3px;">
                            ${fechaTxt} a las ${horaTxt} hs
                        </div>
                    </div>
                    <button type="button" class="mamus-btn-anular" onclick="window.anularRetiroMamus(${r.id}, '${(r.ingrediente_nombre || '').replace(/'/g, "\\'")}')">
                        ↩️ Anular
                    </button>
                `;
                cont.appendChild(fila);
            });
        } catch (err) {
            cont.innerHTML = '<div style="font-size: 18px; color: #ef4444;">No se pudo cargar el historial reciente.</div>';
        }
    }

    window.anularRetiroMamus = async function (movId, nombreIng) {
        if (!confirm(`¿Querés anular el retiro de "${nombreIng}" y devolverlo al stock?`)) return;
        try {
            const res = await fetch(`/api/produccion/ingredientes/retiro-mamus/${movId}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudo anular');

            const bannerExito = document.getElementById('mamus-banner-exito');
            if (bannerExito) {
                bannerExito.style.display = 'block';
                bannerExito.innerHTML = `↩️ ${data.mensaje}`;
            }
            await cargarCatalogoIngredientesMamus();
            await cargarHistorialRetirosMamus();
            if (typeof window.actualizarAlertasPizarra === 'function') {
                try { window.actualizarAlertasPizarra(); } catch (_) {}
            }
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    };

    window.abrirEspacioMamus = async function () {
        inyectarEstilosYDomMamus();
        const modal = document.getElementById('modal-mamus-fullscreen');
        if (modal) {
            modal.style.display = 'block';
        }
        const bannerExito = document.getElementById('mamus-banner-exito');
        if (bannerExito) bannerExito.style.display = 'none';

        await Promise.all([
            cargarCatalogoIngredientesMamus(),
            cargarHistorialRetirosMamus()
        ]);

        if (!mamusIngredienteSeleccionado) {
            const inputScan = document.getElementById('mamus-input-ingrediente');
            if (inputScan) {
                setTimeout(() => inputScan.focus(), 80);
            }
        }
    };

    window.cerrarEspacioMamus = function () {
        const modal = document.getElementById('modal-mamus-fullscreen');
        if (modal) {
            modal.style.display = 'none';
        }

        if (document.getElementById('pizarra-canvas')) {
            if (typeof window.actualizarAlertasPizarra === 'function') {
                try { window.actualizarAlertasPizarra(); } catch (_) {}
            }
            return;
        }

        window.location.href=(window.LAMDA_RESOLVE_URL?window.LAMDA_RESOLVE_URL('http://localhost:3000'):'http://localhost:3000');
    };

    document.addEventListener('DOMContentLoaded', () => {
        inyectarEstilosYDomMamus();
        const params = new URLSearchParams(window.location.search);
        if (params.get('mamus') === '1') {
            window.abrirEspacioMamus();
        }
    });
})();
