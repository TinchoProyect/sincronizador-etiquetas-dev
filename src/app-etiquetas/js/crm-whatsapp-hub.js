/**
 * Módulo Horizontal Frontend: WhatsApp Bidireccional & Consola CRM de 3 Columnas
 * Sistema LAMDA
 * 
 * Incluye:
 * 1. Alertas en tiempo real en Pizarra con Auto-Apagado al responder desde el celular o sistema.
 * 2. Respuesta rápida desde la Pizarra y botón rápido de Modo Personal / Privacidad.
 * 3. Consola "WhatsApp LAMDA" de 3 Columnas (Chats filtrados + Conversación con atajos + Rayos X del Cliente).
 */

(function () {
    'use strict';

    let estadoConsola = {
        abierta: false,
        filtroActivo: 'CLIENTES', // 'SIN_RESPONDER' | 'CLIENTES' | 'NO_AGENDADOS' | 'PRIVADOS' | 'TODOS'
        busqueda: '',
        chats: [],
        chatActivoId: null,
        detalleActivo: null,
        acordeonesAbiertos: new Set(), // Por defecto siempre plegados al abrir la página/consola
        contadores: {
            clientes_sin_responder: 0,
            no_agendados_sin_responder: 0,
            total_chats_visibles: 0,
            total_privados_o_silenciados: 0
        },
        pollingInterval: null
    };

    const ETIQUETAS_CRM = {
        '': { label: 'Sin etiqueta comercial', bg: '#f1f5f9', color: '#475569' },
        'PEDIDO_PENDIENTE': { label: '🟢 Pedido por cargar', bg: '#dcfce7', color: '#166534' },
        'ESPERANDO_PAGO': { label: '🟡 Esperando comprobante/pago', bg: '#fef9c3', color: '#854d0e' },
        'PRESUPUESTO': { label: '🔵 Presupuesto enviado', bg: '#dbeafe', color: '#1e40af' },
        'RECLAMO': { label: '🔴 Reclamo / Revisar', bg: '#fee2e2', color: '#991b1b' }
    };

    const STORAGE_KEY_BORRADORES = 'lamda_wa_borradores_v1';

    function obtenerMapaBorradoresWa() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_BORRADORES);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function obtenerBorradorChatWa(chatPk) {
        if (!chatPk) return '';
        const mapa = obtenerMapaBorradoresWa();
        return String(mapa[String(chatPk)] || '');
    }

    window.guardarBorradorChatWa = function (chatPk, texto) {
        if (!chatPk) return;
        try {
            const mapa = obtenerMapaBorradoresWa();
            const val = String(texto || '');
            if (val.trim().length > 0) {
                mapa[String(chatPk)] = val;
            } else {
                delete mapa[String(chatPk)];
            }
            localStorage.setItem(STORAGE_KEY_BORRADORES, JSON.stringify(mapa));
            const banner = document.getElementById('wa-hub-borrador-banner');
            if (banner) {
                banner.style.display = val.trim().length > 0 ? 'flex' : 'none';
            }
        } catch (e) {}
    };

    window.limpiarBorradorChatWa = function (chatPk) {
        window.guardarBorradorChatWa(chatPk, '');
        const inp = document.getElementById('wa-hub-input-texto');
        if (inp) {
            inp.value = '';
            inp.rows = 2;
        }
    };

    /**
     * Inyecta los estilos CSS de la Consola de 3 Columnas y Alertas de Pizarra
     */
    function inyectarEstilosWhatsappHub() {
        if (document.getElementById('lamda-wa-hub-styles')) return;
        const style = document.createElement('style');
        style.id = 'lamda-wa-hub-styles';
        style.textContent = `
            /* Bloque de Alerta en Pizarra (Acordeón Compacto, plegado por defecto) */
            .pizarra-wa-entrantes-box {
                background: #f0fdf4;
                border: 1.5px solid #22c55e;
                border-radius: 10px;
                padding: 6px 11px;
                margin-bottom: 8px;
                box-shadow: 0 2px 6px rgba(34, 197, 94, 0.08);
            }
            .pizarra-wa-entrantes-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: nowrap;
                gap: 8px;
                cursor: pointer;
                user-select: none;
            }
            .pizarra-wa-entrantes-title {
                font-size: 0.92rem;
                font-weight: 800;
                color: #14532d;
                display: flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
                flex: 1;
                overflow: hidden;
            }
            .pizarra-wa-resumen-inline {
                font-size: 0.8rem;
                font-weight: 600;
                color: #15803d;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                opacity: 0.9;
            }
            .pizarra-wa-pulse-dot {
                width: 8px;
                height: 8px;
                background: #16a34a;
                border-radius: 50%;
                display: inline-block;
                flex-shrink: 0;
                box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7);
                animation: waPulseGreen 1.8s infinite;
            }
            @keyframes waPulseGreen {
                0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7); }
                70% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
                100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
            }
            .pizarra-wa-acordeon-body {
                margin-top: 8px;
                padding-top: 7px;
                border-top: 1px dashed #86efac;
                max-height: 245px;
                overflow-y: auto;
                padding-right: 4px;
            }
            .pizarra-wa-entrante-card {
                background: #ffffff;
                border: 1px solid #bbf7d0;
                border-left: 4px solid #16a34a;
                border-radius: 6px;
                padding: 5px 9px;
                margin-bottom: 5px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                flex-wrap: nowrap;
            }
            .pizarra-wa-entrante-card:last-child {
                margin-bottom: 0;
            }
            .pizarra-wa-msg-preview {
                font-size: 0.82rem;
                color: #334155;
                font-style: italic;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 420px;
                display: inline-block;
                vertical-align: bottom;
            }
            .pizarra-wa-btn {
                border: none;
                border-radius: 5px;
                padding: 3px 8px;
                font-size: 0.75rem;
                font-weight: 700;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 3px;
                white-space: nowrap;
                transition: opacity 0.15s;
            }
            .pizarra-wa-btn:hover {
                opacity: 0.9;
            }

            @media (max-width: 768px) {
                .pizarra-wa-entrantes-box {
                    padding: 8px 10px;
                    margin-bottom: 10px;
                }
                .pizarra-wa-entrantes-header {
                    flex-wrap: wrap;
                    gap: 8px;
                }
                .pizarra-wa-entrantes-title {
                    flex-wrap: wrap;
                    font-size: 0.88rem;
                    overflow: visible;
                }
                .pizarra-wa-resumen-inline {
                    width: 100%;
                    font-size: 0.78rem;
                    white-space: normal;
                    display: block;
                    margin-top: 2px;
                }
                .pizarra-wa-acordeon-body {
                    max-height: 320px;
                    padding-right: 0;
                }
                .pizarra-wa-entrante-card {
                    flex-direction: column;
                    align-items: stretch;
                    gap: 8px;
                    padding: 8px 10px;
                    flex-wrap: wrap;
                }
                .pizarra-wa-entrante-card > div:first-child {
                    white-space: normal !important;
                    overflow: visible !important;
                    text-overflow: clip !important;
                    line-height: 1.38;
                }
                .pizarra-wa-msg-preview {
                    white-space: normal;
                    max-width: 100%;
                    display: block;
                    margin-top: 3px;
                    font-size: 0.82rem;
                }
                .pizarra-wa-entrante-card > div:last-child {
                    width: 100%;
                    justify-content: flex-end;
                    gap: 6px !important;
                    flex-wrap: wrap;
                }
                .pizarra-wa-btn {
                    padding: 6px 10px;
                    font-size: 0.78rem;
                    min-height: 34px;
                }
            }

            /* Asegurar que cualquier modal SweetAlert2 se muestre siempre POR ENCIMA de la consola WhatsApp */
            .swal2-container {
                z-index: 20000 !important;
            }

            /* Modal / Consola Fullscreen 3 Columnas */
            #modal-consola-whatsapp-lamda {
                position: fixed;
                inset: 0;
                background: rgba(15, 23, 42, 0.68);
                backdrop-filter: blur(3px);
                z-index: 9990;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 14px;
            }
            #modal-consola-whatsapp-lamda.wa-hub-maximized {
                padding: 0;
            }
            .wa-hub-shell {
                width: 100%;
                max-width: 1520px;
                height: 92vh;
                background: #ffffff;
                border-radius: 14px;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                border: 1px solid #cbd5e1;
                transition: all 0.15s ease;
            }
            #modal-consola-whatsapp-lamda.wa-hub-maximized .wa-hub-shell {
                max-width: 100vw;
                width: 100vw;
                height: 100vh;
                border-radius: 0;
                border: none;
            }
            .wa-hub-topbar {
                background: #075e54;
                color: #ffffff;
                padding: 10px 18px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                flex-shrink: 0;
            }
            .wa-hub-grid {
                --wa-col-left: 320px;
                --wa-col-right: 410px;
                display: grid;
                grid-template-columns: var(--wa-col-left, 320px) 9px minmax(250px, 1fr) 9px var(--wa-col-right, 410px);
                flex: 1;
                min-height: 0;
                background: #f8fafc;
            }
            .wa-col-splitter {
                background: #e2e8f0;
                cursor: col-resize;
                display: flex;
                align-items: center;
                justify-content: center;
                user-select: none;
                position: relative;
                z-index: 15;
                transition: background 0.15s;
            }
            .wa-col-splitter:hover,
            .wa-col-splitter.dragging {
                background: #0ea5e9;
            }
            .wa-col-splitter span {
                color: #475569;
                font-size: 0.95rem;
                font-weight: 900;
                line-height: 1;
                pointer-events: none;
            }
            .wa-col-splitter:hover span,
            .wa-col-splitter.dragging span {
                color: #ffffff;
            }
            @media (max-width: 860px) {
                .wa-hub-grid {
                    grid-template-columns: 1fr !important;
                }
                .wa-col-splitter {
                    display: none;
                }
            }

            /* Columna 1: Lista de Chats */
            .wa-col-chats {
                border-right: 1px solid #e2e8f0;
                background: #ffffff;
                display: flex;
                flex-direction: column;
                min-height: 0;
            }
            .wa-filter-tabs {
                display: flex;
                gap: 4px;
                padding: 8px 10px;
                background: #f1f5f9;
                border-bottom: 1px solid #e2e8f0;
                overflow-x: auto;
            }
            .wa-filter-tab {
                border: 1px solid #cbd5e1;
                background: #ffffff;
                color: #334155;
                font-size: 0.74rem;
                font-weight: 700;
                padding: 4px 8px;
                border-radius: 14px;
                cursor: pointer;
                white-space: nowrap;
            }
            .wa-filter-tab.active {
                background: #128c7e;
                color: #ffffff;
                border-color: #075e54;
            }
            .wa-chat-list {
                flex: 1;
                overflow-y: auto;
            }
            .wa-chat-item {
                padding: 10px 12px;
                border-bottom: 1px solid #f1f5f9;
                cursor: pointer;
                transition: background 0.12s;
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .wa-chat-item:hover {
                background: #f8fafc;
            }
            .wa-chat-item.active {
                background: #e6f4ea;
                border-left: 4px solid #128c7e;
            }
            .wa-chat-item.waiting {
                background: #f0fdf4;
            }
            .wa-client-group {
                border-bottom: 1.5px solid #e2e8f0;
                background: #ffffff;
            }
            .wa-client-group.has-active {
                background: #f8fafc;
            }
            .wa-client-group-header {
                padding: 8px 12px 6px 12px;
                background: linear-gradient(90deg, #f8fafc 0%, #f1f5f9 100%);
                border-bottom: 1px dashed #e2e8f0;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 6px;
            }
            .wa-client-group-header:hover {
                background: #eef2ff;
            }
            .wa-client-group-contacts {
                padding-left: 10px;
                border-left: 3px solid #cbd5e1;
                margin-left: 8px;
            }
            .wa-client-group.has-active .wa-client-group-contacts {
                border-left-color: #128c7e;
            }
            .wa-client-subcontact {
                padding: 7px 10px 7px 8px;
                border-bottom: 1px solid #f1f5f9;
            }
            .wa-client-subcontact:last-child {
                border-bottom: none;
            }
            .wa-badge-num-legacy {
                background: #dbeafe;
                color: #1e40af;
                border: 1px solid #bfdbfe;
                font-size: 0.67rem;
                padding: 1px 5px;
                border-radius: 4px;
                font-weight: 800;
                white-space: nowrap;
            }
            .wa-badge-num-bunker {
                background: #e2e8f0;
                color: #334155;
                font-size: 0.67rem;
                padding: 1px 5px;
                border-radius: 4px;
                font-weight: 700;
                white-space: nowrap;
            }
            .wa-badge-multi-count {
                background: #f0fdf4;
                color: #15803d;
                border: 1px solid #bbf7d0;
                font-size: 0.66rem;
                padding: 1px 6px;
                border-radius: 999px;
                font-weight: 800;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .wa-acc-section {
                border-bottom: 1px solid #cbd5e1;
                background: #ffffff;
            }
            .wa-acc-header {
                padding: 9px 11px;
                cursor: pointer;
                user-select: none;
                display: flex;
                flex-direction: column;
                gap: 4px;
                transition: background 0.14s;
            }
            .wa-acc-header:hover {
                filter: brightness(0.97);
            }
            .wa-acc-header-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 6px;
            }
            .wa-acc-title {
                font-size: 0.82rem;
                font-weight: 800;
                display: flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
            }
            .wa-acc-arrow {
                font-size: 0.7rem;
                width: 14px;
                display: inline-block;
                text-align: center;
                transition: transform 0.15s;
            }
            .wa-acc-count-pill {
                font-size: 0.7rem;
                font-weight: 800;
                padding: 2px 8px;
                border-radius: 999px;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .wa-acc-subdivider {
                padding: 5px 12px;
                font-size: 0.71rem;
                font-weight: 800;
                letter-spacing: 0.01em;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #e2e8f0;
            }
            .wa-client-idx-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 20px;
                height: 18px;
                padding: 0 5px;
                border-radius: 5px;
                background: #0f172a;
                color: #ffffff;
                font-size: 0.68rem;
                font-weight: 800;
                flex-shrink: 0;
            }
            .wa-active-contact-pill {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                background: #ecfdf5;
                color: #047857;
                border: 1px solid #a7f3d0;
                font-size: 0.68rem;
                font-weight: 800;
                padding: 1px 6px;
                border-radius: 999px;
                white-space: nowrap;
            }
            .wa-search-preview-chip {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                background: #ffffff;
                color: #0f172a;
                border: 1px solid #94a3b8;
                border-radius: 6px;
                padding: 2px 7px;
                font-size: 0.72rem;
                font-weight: 700;
                cursor: pointer;
                box-shadow: 0 1px 2px rgba(0,0,0,0.05);
            }
            .wa-search-preview-chip:hover {
                background: #f0fdf4;
                border-color: #16a34a;
                color: #14532d;
            }

            /* Columna 2: Conversación */
            .wa-col-conv {
                display: flex;
                flex-direction: column;
                min-height: 0;
                background: #efeae2;
                border-right: 1px solid #e2e8f0;
            }
            .wa-conv-header {
                background: #f0f2f5;
                padding: 10px 16px;
                border-bottom: 1px solid #d1d7db;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .wa-conv-messages {
                flex: 1;
                overflow-y: auto;
                padding: 16px 20px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .wa-bubble {
                max-width: 76%;
                padding: 8px 12px;
                border-radius: 10px;
                font-size: 0.9rem;
                line-height: 1.38;
                position: relative;
                box-shadow: 0 1px 2px rgba(0,0,0,0.08);
                word-wrap: break-word;
            }
            .wa-bubble.incoming {
                align-self: flex-start;
                background: #ffffff;
                color: #0f172a;
                border-top-left-radius: 2px;
            }
            .wa-bubble.outgoing {
                align-self: flex-end;
                background: #d9fdd3;
                color: #0f172a;
                border-top-right-radius: 2px;
            }
            .wa-bubble-meta {
                display: flex;
                justify-content: flex-end;
                align-items: center;
                gap: 5px;
                font-size: 0.7rem;
                color: #64748b;
                margin-top: 3px;
            }
            .wa-quick-bar {
                background: #f8fafc;
                padding: 7px 12px;
                border-top: 1px solid #e2e8f0;
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                align-items: center;
            }
            .wa-quick-chip {
                background: #ffffff;
                border: 1px solid #cbd5e1;
                color: #0f172a;
                border-radius: 14px;
                padding: 4px 10px;
                font-size: 0.76rem;
                font-weight: 600;
                cursor: pointer;
                white-space: normal;
                line-height: 1.25;
                text-align: center;
            }
            .wa-quick-chip:hover {
                background: #f0fdf4;
                border-color: #22c55e;
            }
            .wa-conv-input-area {
                background: #f0f2f5;
                padding: 10px 14px;
                display: flex;
                gap: 8px;
                align-items: flex-end;
            }

            /* Columna 3: Rayos X Comerciales del Cliente */
            .wa-col-xray {
                background: #ffffff;
                display: flex;
                flex-direction: column;
                min-height: 0;
                overflow-y: auto;
                padding: 14px;
                gap: 12px;
            }
            .wa-xray-card {
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                padding: 10px 12px;
            }
            .wa-xray-title {
                font-size: 0.78rem;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 0.03em;
                color: #475569;
                margin-bottom: 6px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .wa-hub-mobile-tabs {
                display: none;
            }
            .wa-mob-nav-pill {
                display: none;
            }

            @media (max-width: 768px) {
                #modal-consola-whatsapp-lamda {
                    padding: 0 !important;
                }
                #modal-consola-whatsapp-lamda .wa-hub-shell {
                    width: 100vw !important;
                    max-width: 100vw !important;
                    height: 100dvh !important;
                    max-height: 100dvh !important;
                    border-radius: 0 !important;
                    border: none !important;
                }
                .wa-hub-topbar {
                    padding: 8px 10px !important;
                    flex-wrap: wrap !important;
                    gap: 6px !important;
                }
                .wa-hub-topbar > div:first-child {
                    gap: 6px !important;
                    min-width: 0;
                    flex: 1;
                }
                .wa-hub-topbar > div:first-child > span {
                    font-size: 1.15rem !important;
                }
                .wa-hub-topbar > div:first-child > div > div:first-child {
                    font-size: 0.88rem !important;
                    line-height: 1.2 !important;
                }
                .wa-hub-topbar > div:first-child > div > div:last-child {
                    display: none !important;
                }
                .wa-hub-col-resizer-box,
                #btn-wa-hub-maximize,
                .wa-col-splitter {
                    display: none !important;
                }
                .wa-hub-topbar > div:last-child {
                    width: 100%;
                    justify-content: space-between;
                    gap: 4px !important;
                }
                .wa-hub-topbar > div:last-child > button {
                    padding: 5px 8px !important;
                    font-size: 0.74rem !important;
                }
                .wa-hub-mobile-tabs {
                    display: flex !important;
                    background: #064e3b;
                    padding: 5px 6px;
                    gap: 4px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.16);
                    flex-shrink: 0;
                }
                .wa-hub-mob-tab {
                    flex: 1;
                    background: rgba(255, 255, 255, 0.1);
                    color: #d1fae5;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    border-radius: 6px;
                    padding: 7px 4px;
                    font-size: 0.76rem;
                    font-weight: 800;
                    cursor: pointer;
                    text-align: center;
                    white-space: nowrap;
                }
                .wa-hub-mob-tab.active {
                    background: #ffffff;
                    color: #064e3b;
                    border-color: #ffffff;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
                }
                #wa-hub-grid {
                    display: flex !important;
                    flex-direction: column !important;
                    flex: 1 !important;
                    min-height: 0 !important;
                    overflow: hidden !important;
                }
                #wa-hub-grid[data-mobile-tab="chats"] #wa-hub-col-chats {
                    display: flex !important;
                    width: 100% !important;
                    flex: 1 !important;
                    min-height: 0 !important;
                }
                #wa-hub-grid[data-mobile-tab="chats"] #wa-hub-col-conv,
                #wa-hub-grid[data-mobile-tab="chats"] #wa-hub-col-xray {
                    display: none !important;
                }
                #wa-hub-grid[data-mobile-tab="conv"] #wa-hub-col-conv {
                    display: flex !important;
                    width: 100% !important;
                    flex: 1 !important;
                    min-height: 0 !important;
                }
                #wa-hub-grid[data-mobile-tab="conv"] #wa-hub-col-chats,
                #wa-hub-grid[data-mobile-tab="conv"] #wa-hub-col-xray {
                    display: none !important;
                }
                #wa-hub-grid[data-mobile-tab="xray"] #wa-hub-col-xray {
                    display: flex !important;
                    width: 100% !important;
                    flex: 1 !important;
                    min-height: 0 !important;
                }
                #wa-hub-grid[data-mobile-tab="xray"] #wa-hub-col-chats,
                #wa-hub-grid[data-mobile-tab="xray"] #wa-hub-col-conv {
                    display: none !important;
                }
                .wa-filter-tabs {
                    flex-wrap: wrap;
                    padding: 6px 8px;
                }
                .wa-filter-tab {
                    flex: 1 1 calc(50% - 4px);
                    padding: 6px 4px;
                    font-size: 0.74rem;
                }
                .wa-conv-header {
                    padding: 8px 10px !important;
                    flex-direction: column !important;
                    align-items: stretch !important;
                    gap: 6px !important;
                }
                .wa-mob-nav-pill {
                    display: inline-flex !important;
                    align-items: center;
                    gap: 3px;
                    background: #e2e8f0;
                    border: 1px solid #cbd5e1;
                    color: #0f172a;
                    border-radius: 6px;
                    padding: 3px 8px;
                    font-size: 0.73rem;
                    font-weight: 800;
                    cursor: pointer;
                }
                .wa-conv-messages {
                    padding: 10px 8px !important;
                }
                .wa-bubble {
                    max-width: 88% !important;
                    font-size: 0.85rem !important;
                    padding: 7px 10px !important;
                }
                #wa-hub-asistente-contextual-bar {
                    padding: 5px 8px !important;
                    gap: 5px !important;
                }
                .wa-quick-bar {
                    padding: 5px 8px !important;
                    flex-wrap: nowrap !important;
                    overflow-x: auto !important;
                    -webkit-overflow-scrolling: touch !important;
                }
                .wa-quick-chip {
                    flex-shrink: 0 !important;
                    white-space: nowrap !important;
                }
                .wa-conv-input-area {
                    padding: 8px !important;
                    flex-direction: column !important;
                    align-items: stretch !important;
                    gap: 6px !important;
                }
                .wa-conv-input-area textarea {
                    width: 100% !important;
                    box-sizing: border-box !important;
                    min-height: 52px !important;
                }
                .wa-conv-input-area > div {
                    flex-direction: row !important;
                    width: 100% !important;
                    gap: 6px !important;
                }
                .wa-conv-input-area > div > button {
                    flex: 1 !important;
                    padding: 8px 6px !important;
                    font-size: 0.8rem !important;
                    justify-content: center;
                }
                .wa-col-xray {
                    padding: 10px !important;
                    gap: 10px !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Formatea tiempo relativo amigable (ej: "hace 4 min", "14:30 hs")
     */
    function formatearTiempoRelativo(fechaIso) {
        if (!fechaIso) return '';
        const fecha = new Date(fechaIso);
        const diffSeg = Math.floor((Date.now() - fecha.getTime()) / 1000);
        if (diffSeg < 60) return ' recién';
        if (diffSeg < 3600) return `hace ${Math.floor(diffSeg / 60)} min`;
        if (diffSeg < 86400) return `hace ${Math.floor(diffSeg / 3600)} h`;
        return fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    }

    function renderizarIconoAck(ack) {
        const n = parseInt(ack || 1);
        if (n >= 3) return `<span style="color: #0284c7; font-weight: 800;" title="Leído por el cliente">✓✓</span>`;
        if (n === 2) return `<span style="color: #64748b; font-weight: 800;" title="Entregado al teléfono">✓✓</span>`;
        return `<span style="color: #94a3b8;" title="Enviado">✓</span>`;
    }

    function escaparHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * 1. Consulta para la Pizarra Central
     */
    window.consultarAlertasWhatsappCrm = async function () {
        inyectarEstilosWhatsappHub();
        try {
            const res = await fetch('/api/crm/whatsapp/alertas-pizarra');
            if (!res.ok) return { alertas: [], contadores: {} };
            const data = await res.json();
            if (data && data.success) {
                estadoConsola.contadores = data.contadores || estadoConsola.contadores;
                actualizarBadgeHeaderWhatsapp(estadoConsola.contadores.clientes_sin_responder || 0);
                return data;
            }
        } catch (err) {
            console.warn('Error consultando alertas WhatsApp CRM:', err);
        }
        return { alertas: [], contadores: {} };
    };

    /**
     * Actualiza el contador en el acordeón de la Pizarra de index.html
     */
    function actualizarBadgeHeaderWhatsapp(cantidad) {
        const n = parseInt(cantidad || 0);
        window.__pizarraWaUnread = n;
        const badge = document.getElementById('nav-whatsapp-crm-badge');
        if (!badge) return;
        if (n > 0) {
            badge.textContent = n;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    /**
     * Alterna el acordeón de mensajes de WhatsApp en la Pizarra (plegado por defecto)
     */
    window.toggleAcordeonWaPizarra = function () {
        const actual = Boolean(window.pizarraWaEntrantesExpandido);
        window.pizarraWaEntrantesExpandido = !actual;
        const bodyEl = document.getElementById('pizarra-wa-acordeon-body');
        const chevEl = document.getElementById('pizarra-wa-acordeon-chevron');
        if (bodyEl) {
            bodyEl.style.display = window.pizarraWaEntrantesExpandido ? 'block' : 'none';
        }
        if (chevEl) {
            chevEl.textContent = window.pizarraWaEntrantesExpandido ? '▼' : '▶';
        }
    };

    /**
     * 2. Construye el HTML del bloque de alertas entrantes en la Pizarra Principal (Acordeón plegado por defecto)
     */
    window.construirHtmlAlertasWhatsappPizarra = function (datosWa) {
        const alertas = (datosWa && Array.isArray(datosWa.alertas)) ? datosWa.alertas : [];
        if (alertas.length === 0) return '';

        const estaExpandido = Boolean(window.pizarraWaEntrantesExpandido);

        // Resumen súper compacto de nombres para el encabezado cerrado (ej: "Edit, Nicolas, Cecilia +6")
        const primerosNombres = alertas.slice(0, 3).map(ch => {
            const raw = ch.contacto_nombre || ch.cliente_nombre || ch.telefono_normalizado || '';
            return escaparHtml(String(raw).split(/[\s,-]+/)[0]);
        }).join(', ');
        const restoCount = alertas.length - 3;
        const resumenCompacto = restoCount > 0 ? `${primerosNombres} (+${restoCount} más)` : primerosNombres;

        let html = `
            <div class="pizarra-wa-entrantes-box">
                <div class="pizarra-wa-entrantes-header" onclick="window.toggleAcordeonWaPizarra()" title="Click para desplegar o plegar los mensajes no leídos">
                    <div class="pizarra-wa-entrantes-title">
                        <span id="pizarra-wa-acordeon-chevron" style="font-size: 0.78rem; color: #15803d; width: 12px; display: inline-block;">${estaExpandido ? '▼' : '▶'}</span>
                        <span class="pizarra-wa-pulse-dot"></span>
                        <span style="white-space: nowrap;">💬 Mensajes No Leídos</span>
                        <span style="background: #16a34a; color: #fff; font-size: 0.74rem; font-weight: 800; padding: 1px 7px; border-radius: 10px; flex-shrink: 0;">${alertas.length}</span>
                        <span class="pizarra-wa-resumen-inline">— ${resumenCompacto}</span>
                    </div>
                    <button type="button" class="pizarra-wa-btn" style="background: #075e54; color: #fff; flex-shrink: 0;" onclick="event.stopPropagation(); window.abrirConsolaWhatsappLamda()">
                        🗂️ Consola
                    </button>
                </div>
                <div id="pizarra-wa-acordeon-body" class="pizarra-wa-acordeon-body" style="display: ${estaExpandido ? 'block' : 'none'};">
        `;

        alertas.forEach(ch => {
            const nombrePrincipal = escaparHtml(ch.cliente_nombre || ch.contacto_nombre || ch.telefono_normalizado);
            const codBadge = ch.codigo_bunker_cliente ? `<span style="background:#dcfce7; color:#166534; padding:0px 5px; border-radius:4px; font-size:0.7rem; margin-left:4px;">#${escaparHtml(ch.codigo_bunker_cliente)}</span>` : '';
            const cantNoLeidos = parseInt(ch.no_leidos || 0);
            const unreadPill = cantNoLeidos > 0
                ? `<span style="background:#16a34a; color:#fff; padding:0px 6px; border-radius:8px; font-size:0.68rem; font-weight:800; margin-left:4px;">${cantNoLeidos} sin ver</span>`
                : `<span style="background:#0284c7; color:#fff; padding:0px 6px; border-radius:8px; font-size:0.68rem; font-weight:800; margin-left:4px;">● Marcado no leído</span>`;
            const haceTxt = formatearTiempoRelativo(ch.ultimo_mensaje_at);
            const previewTxt = escaparHtml(ch.ultimo_mensaje_texto || 'Mensaje recibido');

            html += `
                <div class="pizarra-wa-entrante-card">
                    <div style="flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">
                        <strong style="font-size: 0.86rem; color: #0f172a;">${nombrePrincipal}</strong>
                        ${codBadge}
                        ${unreadPill}
                        <span style="font-size: 0.72rem; color: #15803d; font-weight: 700; margin: 0 6px;">(${haceTxt}):</span>
                        <span class="pizarra-wa-msg-preview" title="${previewTxt}">“${previewTxt}”</span>
                    </div>
                    <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
                        <button type="button" class="pizarra-wa-btn" style="background: #16a34a; color: white;" onclick="window.abrirConsolaWhatsappLamda(${ch.id})" title="Abrir conversación con ficha del cliente">
                            💬 Chat
                        </button>
                        <button type="button" class="pizarra-wa-btn" style="background: #0284c7; color: white;" onclick="window.respuestaRapidaPizarraWa(${ch.id}, '${nombrePrincipal.replace(/'/g, "\\'")}')" title="Respuesta rápida">
                            ⚡
                        </button>
                        <button type="button" class="pizarra-wa-btn" style="background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1;" onclick="window.marcarChatAtendidoWa(${ch.id})" title="Marcar como visto">
                            ✓
                        </button>
                        <button type="button" class="pizarra-wa-btn" style="background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;" onclick="window.cambiarPrivacidadRapidaWa(${ch.id}, '${nombrePrincipal.replace(/'/g, "\\'")}')" title="Pasar a Modo Personal / Ocultar de la Pizarra">
                            🔒
                        </button>
                    </div>
                </div>
            `;
        });

        html += `</div></div>`;
        return html;
    };

    /**
     * Respuesta rápida desde la Pizarra mediante modal ligero SweetAlert2
     */
    window.respuestaRapidaPizarraWa = async function (chatPk, nombreCliente) {
        if (typeof Swal === 'undefined') {
            window.abrirConsolaWhatsappLamda(chatPk);
            return;
        }

        const { value: texto } = await Swal.fire({
            title: `💬 Responder a ${nombreCliente}`,
            input: 'textarea',
            inputLabel: 'Tu respuesta se enviará por WhatsApp y apagará el alerta en Pizarra:',
            inputPlaceholder: 'Escribí tu mensaje acá...',
            showCancelButton: true,
            confirmButtonColor: '#16a34a',
            confirmButtonText: '🚀 Enviar WhatsApp',
            cancelButtonText: 'Cancelar'
        });

        if (!texto || !texto.trim()) return;

        try {
            Swal.fire({ title: 'Enviando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await fetch(`/api/crm/whatsapp/chats/${chatPk}/enviar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mensajeTexto: texto.trim() })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo enviar');

            Swal.fire({ icon: 'success', title: 'Respuesta enviada', timer: 1600, showConfirmButton: false });
            if (typeof window.actualizarAlertasPizarra === 'function') window.actualizarAlertasPizarra();
        } catch (err) {
            Swal.fire('Error', err.message || 'No se pudo enviar el mensaje.', 'error');
        }
    };

    /**
     * Marcar un chat como ya atendido (apaga la alerta sin enviar mensaje)
     */
    window.marcarChatAtendidoWa = async function (chatPk) {
        try {
            const res = await fetch(`/api/crm/whatsapp/chats/${chatPk}/marcar-atendido`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                if (typeof window.actualizarAlertasPizarra === 'function') window.actualizarAlertasPizarra();
                if (estadoConsola.abierta) {
                    await cargarListaChatsConsola();
                    if (estadoConsola.chatActivoId === chatPk) await seleccionarChatConsola(chatPk, false);
                }
            }
        } catch (err) {
            console.error('Error marcando chat atendido:', err);
        }
    };

    /**
     * Cambiar privacidad rápidamente desde la Pizarra o desde la Consola
     * (Resuelve el caso de un contacto que es cliente pero con el que estás hablando temas personales)
     */
    window.cambiarPrivacidadRapidaWa = async function (chatPk, nombreCliente) {
        if (typeof Swal === 'undefined') return;
        const { value: opcion } = await Swal.fire({
            title: `🔒 Privacidad de ${nombreCliente}`,
            html: `<p style="font-size:0.9rem; color:#475569;">Elegí cómo querés tratar las conversaciones con este contacto en LAMDA:</p>`,
            input: 'radio',
            inputOptions: {
                'SILENCIAR_24H': '🕒 Modo Personal por 24 hs (No avisa en Pizarra hoy)',
                'SILENCIADO_PIZARRA': '🔇 Modo Personal Permanente (Visible en consola, nunca en Pizarra)',
                'OCULTO': '👁️‍🗨️ Ocultar de LAMDA (Contacto privado, solo visible en pestaña Privados)',
                'ACTIVO': '🟢 Modo Comercial Activo (Avisa en Pizarra cuando escribe)'
            },
            inputValue: 'SILENCIAR_24H',
            showCancelButton: true,
            confirmButtonColor: '#075e54',
            confirmButtonText: 'Guardar preferencia',
            cancelButtonText: 'Cancelar'
        });

        if (!opcion) return;

        const payload = {};
        if (opcion === 'SILENCIAR_24H') {
            payload.modo_privacidad = 'ACTIVO';
            payload.silenciar_horas = 24;
        } else {
            payload.modo_privacidad = opcion;
            payload.silenciar_horas = 0;
        }

        try {
            const res = await fetch(`/api/crm/whatsapp/chats/${chatPk}/config`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: 'Preferencia de privacidad actualizada',
                    timer: 2000,
                    showConfirmButton: false
                });
                if (typeof window.actualizarAlertasPizarra === 'function') window.actualizarAlertasPizarra();
                if (estadoConsola.abierta) {
                    await cargarListaChatsConsola();
                    if (estadoConsola.chatActivoId === chatPk) await seleccionarChatConsola(chatPk, false);
                }
            }
        } catch (err) {
            console.error('Error actualizando privacidad:', err);
        }
    };

    /**
     * Asegura que el contenedor DOM de la Consola de 3 Columnas exista en la página
     */
    function asegurarModalConsolaDom() {
        inyectarEstilosWhatsappHub();
        let modal = document.getElementById('modal-consola-whatsapp-lamda');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'modal-consola-whatsapp-lamda';
        modal.innerHTML = `
            <div class="wa-hub-shell">
                <!-- Barra Superior -->
                <div class="wa-hub-topbar" ondblclick="window.toggleMaximizarConsolaWa()">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.4rem;">💬</span>
                        <div>
                            <div style="font-weight: 800; font-size: 1.05rem; letter-spacing: 0.01em;">WhatsApp LAMDA — Consola Comercial & CRM</div>
                            <div style="font-size: 0.76rem; color: #bbf7d0;">Sincronizado en espejo con tu celular · Identificación automática Búnker</div>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <div class="wa-hub-col-resizer-box" style="display: inline-flex; align-items: center; gap: 4px; background: rgba(0,0,0,0.22); padding: 3px 7px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2);" title="Ajustar ancho de las 3 columnas (también podés arrastrar las barras grises divisorias ⋮ con el mouse)">
                            <span style="font-size: 0.72rem; font-weight: 800; color: #a7f3d0;">📐 Columnas:</span>
                            <button type="button" onclick="window.ajustarAnchoColumnaWa('TOGGLE_LEFT')" style="background: rgba(255,255,255,0.16); color: #fff; border: 1px solid rgba(255,255,255,0.28); padding: 3px 7px; border-radius: 5px; font-size: 0.72rem; font-weight: 800; cursor: pointer;" title="Plegar o desplegar la columna izquierda de Chats">
                                ◀ Chats
                            </button>
                            <button type="button" onclick="window.ajustarAnchoColumnaWa('RESET')" style="background: rgba(255,255,255,0.16); color: #fff; border: 1px solid rgba(255,255,255,0.28); padding: 3px 7px; border-radius: 5px; font-size: 0.72rem; font-weight: 800; cursor: pointer;" title="Restaurar ancho equilibrado de las 3 columnas">
                                ⚖️ Normal
                            </button>
                            <button type="button" onclick="window.ajustarAnchoColumnaWa('WIDEN_RIGHT')" style="background: rgba(255,255,255,0.16); color: #fff; border: 1px solid rgba(255,255,255,0.28); padding: 3px 7px; border-radius: 5px; font-size: 0.72rem; font-weight: 800; cursor: pointer;" title="Ensanchar o alternar el ancho de la Columna 3 (Ficha y Cuenta Corriente)">
                                ↔ Ensanchar Derecha
                            </button>
                        </div>
                        <button type="button" onclick="window.iniciarNuevoChatClienteBunker()" style="background: #25D366; color: #052e16; border: none; padding: 6px 11px; border-radius: 8px; font-size: 0.8rem; font-weight: 800; cursor: pointer;">
                            ➕ Hablar con Cliente Búnker
                        </button>
                        <button type="button" id="btn-wa-hub-sync" onclick="window.sincronizarChatsWhatsappLamda()" style="background: rgba(255,255,255,0.16); color: #ffffff; border: 1px solid rgba(255,255,255,0.3); padding: 6px 11px; border-radius: 8px; font-size: 0.8rem; font-weight: 700; cursor: pointer;">
                            🔄 Traer Chats
                        </button>
                        <button type="button" id="btn-wa-hub-maximize" onclick="window.toggleMaximizarConsolaWa()" style="background: rgba(255,255,255,0.18); color: #ffffff; border: 1px solid rgba(255,255,255,0.35); height: 34px; padding: 0 10px; border-radius: 8px; font-size: 0.8rem; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Maximizar / Restaurar tamaño de pantalla">
                            ⛶ Maximizar
                        </button>
                        <button type="button" onclick="window.cerrarConsolaWhatsappLamda()" style="background: rgba(255,255,255,0.15); color: #ffffff; border: none; width: 34px; height: 34px; border-radius: 50%; font-size: 1.2rem; font-weight: 800; cursor: pointer;" title="Cerrar consola">
                            &times;
                        </button>
                    </div>
                </div>

                <!-- Cuerpo en 3 Columnas Redimensionables -->
                <!-- Barra de Solapas Móvil (solo visible en <= 768px) -->
                <div id="wa-hub-mobile-tabs" class="wa-hub-mobile-tabs">
                    <button type="button" class="wa-hub-mob-tab active" data-wa-mob-tab="chats" onclick="window.cambiarTabMovilConsolaWa('chats')">
                        💬 Lista de Chats
                    </button>
                    <button type="button" class="wa-hub-mob-tab" data-wa-mob-tab="conv" onclick="window.cambiarTabMovilConsolaWa('conv')">
                        💭 Conversación
                    </button>
                    <button type="button" class="wa-hub-mob-tab" data-wa-mob-tab="xray" onclick="window.cambiarTabMovilConsolaWa('xray')">
                        📊 Ficha / Rayos X
                    </button>
                </div>

                <!-- Cuerpo en 3 Columnas Redimensionables -->
                <div id="wa-hub-grid" class="wa-hub-grid" data-mobile-tab="chats">
                    <!-- COLUMNA 1: Lista de Chats y Filtros -->
                    <div id="wa-hub-col-chats" class="wa-col-chats" style="overflow: hidden;">
                        <div style="padding: 10px; border-bottom: 1px solid #e2e8f0;">
                            <input type="text" id="wa-hub-search-input" placeholder="🔍 Buscar Nº Legacy (042), Búnker (CB-0014), nombre o contacto..." oninput="window.filtrarBusquedaConsolaWa(this.value)" style="width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.84rem; box-sizing: border-box;">
                        </div>
                        <div class="wa-filter-tabs">
                            <button type="button" class="wa-filter-tab" data-filtro="SIN_RESPONDER" onclick="window.cambiarFiltroConsolaWa('SIN_RESPONDER')">🟢 No leídos</button>
                            <button type="button" class="wa-filter-tab active" data-filtro="CLIENTES" onclick="window.cambiarFiltroConsolaWa('CLIENTES')">👥 Clientes</button>
                            <button type="button" class="wa-filter-tab" data-filtro="NO_AGENDADOS" onclick="window.cambiarFiltroConsolaWa('NO_AGENDADOS')">❓ No agendados</button>
                            <button type="button" class="wa-filter-tab" data-filtro="PRIVADOS" onclick="window.cambiarFiltroConsolaWa('PRIVADOS')">🔒 Modo Personal</button>
                        </div>
                        <div id="wa-hub-chat-list" class="wa-chat-list"></div>
                    </div>

                    <!-- Divisor Vertical Arrastrable Izquierdo (Col 1 <-> Col 2) -->
                    <div id="wa-splitter-left" class="wa-col-splitter" title="Arrastrá con el mouse para cambiar el ancho de la lista de chats (Doble clic para plegar/desplegar)">
                        <span>⋮</span>
                    </div>

                    <!-- COLUMNA 2: El Chat al Estilo WhatsApp Web + Atajos LAMDA -->
                    <div id="wa-hub-col-conv" class="wa-col-conv" style="min-width: 0;">
                        <div style="margin: auto; text-align: center; padding: 30px; color: #64748b;">
                            <div style="font-size: 2.8rem; margin-bottom: 8px;">💬</div>
                            <div style="font-weight: 700; font-size: 1.05rem; color: #334155;">Seleccioná un cliente a la izquierda</div>
                            <p style="font-size: 0.86rem; max-width: 380px; margin: 6px auto 14px;">
                                Acá vas a ver la conversación igual que en WhatsApp Web y a la derecha toda la radiografía comercial del cliente en tiempo real.
                            </p>
                            <button type="button" onclick="window.sincronizarChatsWhatsappLamda()" style="background: #128c7e; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 700; cursor: pointer;">
                                🔄 Sincronizar conversaciones desde mi WhatsApp
                            </button>
                        </div>
                    </div>

                    <!-- Divisor Vertical Arrastrable Derecho (Col 2 <-> Col 3) -->
                    <div id="wa-splitter-right" class="wa-col-splitter" title="Arrastrá con el mouse para ensanchar o achicar la ficha de Rayos X (Doble clic para ampliar/restaurar)">
                        <span>⋮</span>
                    </div>

                    <!-- COLUMNA 3: Rayos X del Cliente (Contexto Comercial en Vivo) -->
                    <div id="wa-hub-col-xray" class="wa-col-xray" style="min-width: 0;">
                        <div style="margin: auto; text-align: center; padding: 20px; color: #94a3b8;">
                            <div style="font-size: 2rem; margin-bottom: 6px;">📊</div>
                            <div style="font-weight: 700; font-size: 0.92rem; color: #475569;">Columna 3: Rayos X del Cliente</div>
                            <p style="font-size: 0.8rem;">Al abrir un chat verás acá su Saldo en Cuenta Corriente, Últimos Pedidos, Facturas, Seguimientos y el interruptor de Privacidad.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        inicializarSplittersColumnasWa();
        return modal;
    }

    const STORAGE_KEY_LAYOUT_COLS = 'lamda_wa_hub_cols_v1';

    function aplicarAnchosColumnasWa(leftPx, rightPx, guardar = true) {
        const grid = document.getElementById('wa-hub-grid');
        if (!grid) return;
        const l = Math.max(0, Math.min(620, Number(leftPx)));
        const r = Math.max(0, Math.min(720, Number(rightPx)));
        grid.style.setProperty('--wa-col-left', `${l}px`);
        grid.style.setProperty('--wa-col-right', `${r}px`);
        const colChats = document.getElementById('wa-hub-col-chats');
        const colXray = document.getElementById('wa-hub-col-xray');
        if (colChats) colChats.style.display = l < 40 ? 'none' : 'flex';
        if (colXray) colXray.style.display = r < 40 ? 'none' : 'flex';
        if (guardar) {
            try {
                localStorage.setItem(STORAGE_KEY_LAYOUT_COLS, JSON.stringify({ left: l, right: r }));
            } catch (e) {}
        }
    }

    function obtenerAnchosColumnasActualesWa() {
        const grid = document.getElementById('wa-hub-grid');
        if (!grid) return { left: 320, right: 410 };
        const st = getComputedStyle(grid);
        const l = parseInt(st.getPropertyValue('--wa-col-left')) || 320;
        const r = parseInt(st.getPropertyValue('--wa-col-right')) || 410;
        return { left: l, right: r };
    }

    window.ajustarAnchoColumnaWa = function (accion) {
        const act = obtenerAnchosColumnasActualesWa();
        if (accion === 'TOGGLE_LEFT') {
            const nuevoLeft = act.left < 100 ? 320 : 0;
            aplicarAnchosColumnasWa(nuevoLeft, act.right, true);
        } else if (accion === 'WIDEN_RIGHT') {
            const nuevoRight = act.right < 430 ? 500 : (act.right < 540 ? 600 : 370);
            aplicarAnchosColumnasWa(act.left, nuevoRight, true);
        } else {
            aplicarAnchosColumnasWa(320, 410, true);
        }
    };

    function inicializarSplittersColumnasWa() {
        try {
            const guardado = JSON.parse(localStorage.getItem(STORAGE_KEY_LAYOUT_COLS) || 'null');
            if (guardado && typeof guardado.left === 'number' && typeof guardado.right === 'number') {
                aplicarAnchosColumnasWa(guardado.left, guardado.right, false);
            }
        } catch (e) {}

        const spLeft = document.getElementById('wa-splitter-left');
        const spRight = document.getElementById('wa-splitter-right');
        const grid = document.getElementById('wa-hub-grid');
        if (!grid) return;

        if (spLeft) {
            spLeft.addEventListener('dblclick', () => window.ajustarAnchoColumnaWa('TOGGLE_LEFT'));
            spLeft.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                spLeft.classList.add('dragging');
                const rectGrid = grid.getBoundingClientRect();
                const onMove = (eMove) => {
                    const act = obtenerAnchosColumnasActualesWa();
                    let nuevoLeft = eMove.clientX - rectGrid.left;
                    if (nuevoLeft < 90) nuevoLeft = 0;
                    else if (nuevoLeft < 200) nuevoLeft = 200;
                    aplicarAnchosColumnasWa(nuevoLeft, act.right, false);
                };
                const onUp = () => {
                    spLeft.classList.remove('dragging');
                    const act = obtenerAnchosColumnasActualesWa();
                    aplicarAnchosColumnasWa(act.left, act.right, true);
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });
        }

        if (spRight) {
            spRight.addEventListener('dblclick', () => window.ajustarAnchoColumnaWa('WIDEN_RIGHT'));
            spRight.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                spRight.classList.add('dragging');
                const rectGrid = grid.getBoundingClientRect();
                const onMove = (eMove) => {
                    const act = obtenerAnchosColumnasActualesWa();
                    let nuevoRight = rectGrid.right - eMove.clientX;
                    if (nuevoRight < 90) nuevoRight = 0;
                    else if (nuevoRight < 240) nuevoRight = 240;
                    aplicarAnchosColumnasWa(act.left, nuevoRight, false);
                };
                const onUp = () => {
                    spRight.classList.remove('dragging');
                    const act = obtenerAnchosColumnasActualesWa();
                    aplicarAnchosColumnasWa(act.left, act.right, true);
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });
        }
    }

    /**
     * Abre la Consola de 3 Columnas
     */
    window.cambiarTabMovilConsolaWa = function (tab) {
        const grid = document.getElementById('wa-hub-grid');
        if (grid) grid.setAttribute('data-mobile-tab', tab || 'chats');
        document.querySelectorAll('#wa-hub-mobile-tabs .wa-hub-mob-tab').forEach(btn => {
            if (btn.getAttribute('data-wa-mob-tab') === tab) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        if (tab === 'conv') {
            const scrollContainer = document.getElementById('wa-hub-messages-scroll');
            if (scrollContainer) {
                setTimeout(() => { scrollContainer.scrollTop = scrollContainer.scrollHeight; }, 30);
            }
        }
    };

    window.abrirConsolaWhatsappLamda = async function (chatIdSeleccionado = null) {
        const modal = asegurarModalConsolaDom();
        modal.style.display = 'flex';
        estadoConsola.abierta = true;
        // Siempre iniciar con los acordeones plegados por defecto al abrir la consola
        estadoConsola.acordeonesAbiertos.clear();

        if (chatIdSeleccionado) {
            estadoConsola.chatActivoId = chatIdSeleccionado;
        }

        await cargarListaChatsConsola();

        // Pre-calentar en segundo plano el catálogo de precios y el mapa del Portal B2B
        // para que al abrir el Asistente Comercial la respuesta sea instantánea
        setTimeout(() => {
            obtenerCatalogoDinamicoAsistenteWa().catch(() => {});
            obtenerMapaEstadosPortalB2BWa().catch(() => {});
        }, 150);

        if (estadoConsola.chatActivoId) {
            await seleccionarChatConsola(estadoConsola.chatActivoId, true);
        } else if (estadoConsola.chats.length > 0) {
            await seleccionarChatConsola(estadoConsola.chats[0].id, true);
        }
        if (window.innerWidth <= 768 && typeof window.cambiarTabMovilConsolaWa === 'function') {
            window.cambiarTabMovilConsolaWa(chatIdSeleccionado ? 'conv' : 'chats');
        }
        if (false) {
        }

        // Sincronización silenciosa automática al abrir la consola (trae lo enviado desde el celular sin tener que tocar "Traer Chats")
        const sincronizarSilenciosoConCelular = async () => {
            if (estadoConsola._syncSilenciosoEnCurso) return;
            estadoConsola._syncSilenciosoEnCurso = true;
            try {
                await fetch('/api/crm/whatsapp/sincronizar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ maxChats: 25, mensajesPorChat: 12 })
                });
                if (estadoConsola.abierta) {
                    await cargarListaChatsConsola(true);
                    if (estadoConsola.chatActivoId) {
                        await seleccionarChatConsola(estadoConsola.chatActivoId, false);
                    }
                }
            } catch (_) {
            } finally {
                estadoConsola._syncSilenciosoEnCurso = false;
            }
        };
        setTimeout(sincronizarSilenciosoConCelular, 250);

        let ciclosPolling = 0;
        if (estadoConsola.pollingInterval) clearInterval(estadoConsola.pollingInterval);
        estadoConsola.pollingInterval = setInterval(async () => {
            if (!estadoConsola.abierta) return;
            if (typeof Swal !== 'undefined' && typeof Swal.isVisible === 'function' && Swal.isVisible()) return;
            ciclosPolling++;
            if (ciclosPolling % 4 === 0) {
                sincronizarSilenciosoConCelular();
            } else {
                await cargarListaChatsConsola(true);
                if (estadoConsola.chatActivoId) {
                    await seleccionarChatConsola(estadoConsola.chatActivoId, false);
                }
            }
        }, 6000);
    };

    window.toggleMaximizarConsolaWa = function () {
        const modal = document.getElementById('modal-consola-whatsapp-lamda');
        const btn = document.getElementById('btn-wa-hub-maximize');
        if (!modal) return;
        const isMax = modal.classList.toggle('wa-hub-maximized');
        if (btn) {
            btn.innerHTML = isMax ? '🗗 Restaurar' : '⛶ Maximizar';
        }
    };

    window.cerrarConsolaWhatsappLamda = function () {
        const modal = document.getElementById('modal-consola-whatsapp-lamda');
        if (modal) modal.style.display = 'none';
        estadoConsola.abierta = false;
        if (estadoConsola.pollingInterval) {
            clearInterval(estadoConsola.pollingInterval);
            estadoConsola.pollingInterval = null;
        }
        if (typeof window.actualizarAlertasPizarra === 'function') {
            window.actualizarAlertasPizarra();
        }
    };

    window.cambiarFiltroConsolaWa = async function (nuevoFiltro) {
        estadoConsola.filtroActivo = nuevoFiltro;
        document.querySelectorAll('#modal-consola-whatsapp-lamda .wa-filter-tab').forEach(btn => {
            if (btn.getAttribute('data-filtro') === nuevoFiltro) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        await cargarListaChatsConsola();
    };

    window.filtrarBusquedaConsolaWa = async function (valor) {
        estadoConsola.busqueda = valor || '';
        // Regla explícita del Director: al usar el buscador NO se deben desplegar todos los acordeones automáticamente
        await cargarListaChatsConsola();
    };

    window.toggleAcordeonChatsWa = function (acordeonKey) {
        if (!acordeonKey) return;
        if (estadoConsola.acordeonesAbiertos.has(acordeonKey)) {
            estadoConsola.acordeonesAbiertos.delete(acordeonKey);
        } else {
            estadoConsola.acordeonesAbiertos.add(acordeonKey);
        }
        const bodyEl = document.getElementById(`wa-acc-body-${acordeonKey}`);
        const arrowEl = document.getElementById(`wa-acc-arrow-${acordeonKey}`);
        const chipsEl = document.getElementById(`wa-acc-chips-${acordeonKey}`);
        const estaAbierto = estadoConsola.acordeonesAbiertos.has(acordeonKey);
        if (bodyEl) bodyEl.style.display = estaAbierto ? 'block' : 'none';
        if (arrowEl) arrowEl.textContent = estaAbierto ? '▼' : '▶';
        if (chipsEl) chipsEl.style.display = (!estaAbierto && estadoConsola.busqueda.trim().length > 0) ? 'flex' : 'none';
    };

    const NOMBRES_MESES_ES = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    function formatearRangoCortoWa(msInicio, msFin) {
        const d1 = new Date(msInicio);
        const d2 = new Date(msFin);
        const f = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        return `${f(d1)} al ${f(d2)}`;
    }

    function clasificarGrupoEnAcordeonTemporal(g) {
        const ahora = new Date();
        const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
        const inicioAyer = inicioHoy - 86400000;
        const diaSemana = ahora.getDay(); // 0=Dom, 1=Lun ... 6=Sab
        const diasDesdeLunes = diaSemana === 0 ? 6 : (diaSemana - 1);
        const inicioSemanaActual = inicioHoy - (diasDesdeLunes * 86400000);
        const inicioSemanaPasada = inicioSemanaActual - (7 * 86400000);
        const inicioMesActual = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();

        const ts = g.maxFechaRealMs || 0;

        if (!g.tieneComunicacionReal || ts <= 0) {
            return {
                key: 'ACC_SIN_CONTACTO',
                ordenBucket: 999999,
                titulo: '📋 Sin contacto registrado aún',
                subtitulo: 'Clientes en Búnker sin mensajes previos',
                bgHeader: '#f8fafc',
                borderLeft: '#94a3b8',
                colorTexto: '#475569',
                bgPill: '#e2e8f0',
                colorPill: '#334155'
            };
        }

        if (ts >= inicioHoy) {
            return {
                key: 'ACC_HOY',
                ordenBucket: 1,
                titulo: '🟢 Contactados Hoy',
                subtitulo: 'Conversaciones activas y mensajes enviados hoy',
                bgHeader: 'linear-gradient(90deg, #ecfdf5 0%, #f0fdf4 100%)',
                borderLeft: '#16a34a',
                colorTexto: '#14532d',
                bgPill: '#dcfce7',
                colorPill: '#166534'
            };
        }

        if (ts >= inicioAyer && ts < inicioHoy) {
            const fechaAyerTxt = new Date(inicioAyer).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });
            return {
                key: 'ACC_AYER',
                ordenBucket: 2,
                titulo: '📅 Contactados Ayer',
                subtitulo: `${fechaAyerTxt}`,
                bgHeader: 'linear-gradient(90deg, #eff6ff 0%, #f8fafc 100%)',
                borderLeft: '#2563eb',
                colorTexto: '#1e3a8a',
                bgPill: '#dbeafe',
                colorPill: '#1e40af'
            };
        }

        if (ts >= inicioSemanaActual && ts < inicioAyer) {
            return {
                key: 'ACC_ESTA_SEMANA',
                ordenBucket: 3,
                titulo: '📆 Esta Semana (días previos)',
                subtitulo: formatearRangoCortoWa(inicioSemanaActual, inicioAyer - 86400000),
                bgHeader: 'linear-gradient(90deg, #eef2ff 0%, #f8fafc 100%)',
                borderLeft: '#4f46e5',
                colorTexto: '#312e81',
                bgPill: '#e0e7ff',
                colorPill: '#3730a3'
            };
        }

        if (ts >= inicioSemanaPasada && ts < inicioSemanaActual) {
            return {
                key: 'ACC_SEMANA_PASADA',
                ordenBucket: 4,
                titulo: '🗓️ Semana Pasada',
                subtitulo: formatearRangoCortoWa(inicioSemanaPasada, inicioSemanaActual - 86400000),
                bgHeader: 'linear-gradient(90deg, #f5f3ff 0%, #f8fafc 100%)',
                borderLeft: '#7c3aed',
                colorTexto: '#4c1d95',
                bgPill: '#ede9fe',
                colorPill: '#5b21b6'
            };
        }

        const fechaMsg = new Date(ts);
        const anio = fechaMsg.getFullYear();
        const mesIdx = fechaMsg.getMonth();
        const nombreMes = NOMBRES_MESES_ES[mesIdx] || '';

        if (ts >= inicioMesActual && ts < inicioSemanaPasada) {
            const numSemanaMes = Math.max(1, Math.ceil(fechaMsg.getDate() / 7));
            return {
                key: `ACC_MES_ACTUAL_SEM_${numSemanaMes}`,
                ordenBucket: 10 + (10 - numSemanaMes),
                titulo: `🗓️ ${nombreMes} — Semana ${numSemanaMes}`,
                subtitulo: `Comunicaciones previas de ${nombreMes}`,
                bgHeader: 'linear-gradient(90deg, #f8fafc 0%, #f1f5f9 100%)',
                borderLeft: '#0284c7',
                colorTexto: '#0c4a6e',
                bgPill: '#e0f2fe',
                colorPill: '#0369a1'
            };
        }

        // Meses anteriores agrupados por Mes y Año en orden cronológico descendente
        const claveMes = `${anio}_${String(mesIdx + 1).padStart(2, '0')}`;
        const ordenMes = 50000 - (anio * 12 + mesIdx);
        return {
            key: `ACC_MES_${claveMes}`,
            ordenBucket: ordenMes,
            titulo: `📁 ${nombreMes} ${anio}`,
            subtitulo: `Clientes contactados en ${nombreMes.toLowerCase()}`,
            bgHeader: 'linear-gradient(90deg, #f8fafc 0%, #f1f5f9 100%)',
            borderLeft: '#64748b',
            colorTexto: '#1e293b',
            bgPill: '#e2e8f0',
            colorPill: '#334155'
        };
    }

    function renderizarTarjetaGrupoClienteHtml(g, numeroOrden, esSeccionHoy = false) {
        const legacyTag = g.lomas_soft_id
            ? `<span class="wa-badge-num-legacy" title="Número de Cliente Legacy (Lomasoft)">Nº ${escaparHtml(g.lomas_soft_id)}</span>`
            : '';
        const codTag = g.codigo_bunker_cliente
            ? `<span class="wa-badge-num-bunker" title="Código de Cliente Búnker">#${escaparHtml(g.codigo_bunker_cliente)}</span>`
            : '';
        const badgeOrden = `<span class="wa-client-idx-badge" title="Orden dentro de este período">${numeroOrden}</span>`;

        const ctPrincipal = g.contactos[0];
        const nombreCtPrincipal = escaparHtml(ctPrincipal.contacto_nombre || ctPrincipal.pushname_wa || ctPrincipal.telefono_normalizado || 'Contacto');

        const estadoHoyBadge = esSeccionHoy
            ? (g.esConversacionActivaHoy
                ? `<span style="background:#dcfce7; color:#166534; border:1px solid #86efac; font-size:0.65rem; font-weight:800; padding:1px 6px; border-radius:999px; white-space:nowrap;">🟢 Activo hoy</span>`
                : `<span style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; font-size:0.65rem; font-weight:800; padding:1px 6px; border-radius:999px; white-space:nowrap;">📨 Contactado hoy</span>`)
            : '';

        if (g.contactos.length === 1) {
            const c = g.contactos[0];
            const isSelected = c.id === estadoConsola.chatActivoId;
            const isWaiting = c.esperando_respuesta === true;
            const titulo = escaparHtml(c.cliente_nombre || c.contacto_nombre || c.pushname_wa || c.telefono_normalizado);
            const cargoTxt = c.contacto_cargo ? ` (${escaparHtml(c.contacto_cargo)})` : '';
            const subContacto = (c.cliente_nombre && c.contacto_nombre && c.contacto_nombre !== c.cliente_nombre)
                ? `👤 ${escaparHtml(c.contacto_nombre)}${cargoTxt} · 📱 ${escaparHtml(c.ultimos_digitos || c.telefono_normalizado)}`
                : `📱 ${escaparHtml(c.telefono_normalizado)}${cargoTxt}`;
            const tiempoTxt = g.tieneComunicacionReal ? formatearTiempoRelativo(c.ultimo_mensaje_at) : 'Sin mensajes';
            const etq = ETIQUETAS_CRM[c.etiqueta_crm || ''];
            const etqBadge = c.etiqueta_crm && etq ? `<span style="background:${etq.bg}; color:${etq.color}; font-size:0.66rem; padding:1px 5px; border-radius:4px; font-weight:700;">${etq.label}</span>` : '';
            const privBadge = (c.modo_privacidad !== 'ACTIVO' || c.esta_silenciado_temporal)
                ? `<span title="En Modo Personal / Silenciado en Pizarra" style="font-size:0.75rem;">🔒</span>`
                : '';
            const textoMsg = g.tieneComunicacionReal
                ? `${c.ultimo_mensaje_from_me ? renderizarIconoAck(c.ultimo_mensaje_ack) + ' ' : ''}${escaparHtml(c.ultimo_mensaje_texto || '')}`
                : `<span style="color:#94a3b8; font-style:italic;">Sin comunicación registrada aún</span>`;

            return `
                <div class="wa-chat-item ${isSelected ? 'active' : ''} ${isWaiting ? 'waiting' : ''}" data-chat-id="${c.id}" onclick="window.seleccionarChatConsola(${c.id}, true)">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px;">
                        <div style="display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1; overflow: hidden;">
                            ${badgeOrden}
                            <span style="font-weight: 800; font-size: 0.87rem; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${privBadge} ${titulo}
                            </span>
                            ${legacyTag}
                            ${codTag}
                        </div>
                        <span style="font-size: 0.7rem; color: ${isWaiting ? '#16a34a' : '#64748b'}; font-weight: ${isWaiting ? '800' : '600'}; flex-shrink: 0;">
                            ${tiempoTxt}
                        </span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: #475569; gap: 4px;">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${subContacto}</span>
                        <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
                            ${estadoHoyBadge}
                            ${etqBadge}
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 2px;">
                        <div style="font-size: 0.78rem; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                            ${textoMsg}
                        </div>
                        ${isWaiting ? `<span style="background:${parseInt(c.no_leidos) > 0 ? '#16a34a' : '#0284c7'}; color:#fff; font-size:0.66rem; font-weight:800; padding:1px 6px; border-radius:10px; flex-shrink:0;">${parseInt(c.no_leidos) > 0 ? `${c.no_leidos} sin leer` : '● No leído'}</span>` : ''}
                    </div>
                </div>
            `;
        }

        // Cliente con múltiples contactos (2, 3 o más): destaca cuál es el contacto activo por el que se habló
        const algunoActivo = g.contactos.some(ct => ct.id === estadoConsola.chatActivoId);
        const idDefaultCliente = (g.contactos.find(ct => ct.id === estadoConsola.chatActivoId) || g.contactos[0]).id;
        const tituloCliente = escaparHtml(g.cliente_nombre);
        const pillContactoActivo = g.tieneComunicacionReal
            ? `<span class="wa-active-contact-pill" title="Contacto activo por el cual se comunicó con este cliente">💬 Vía: ${nombreCtPrincipal}</span>`
            : '';

        let subContactosHtml = '';
        g.contactos.forEach((ct, idxCt) => {
            const isSelected = ct.id === estadoConsola.chatActivoId;
            const isWaiting = ct.esperando_respuesta === true;
            const esElContactoActivo = idxCt === 0 && g.tieneComunicacionReal && Boolean(ct.tiene_comunicacion_real);
            const nombreCt = escaparHtml(ct.contacto_nombre || ct.pushname_wa || ct.telefono_normalizado);
            const cargoCt = ct.contacto_cargo ? ` <span style="color:#64748b; font-weight:600; font-size:0.71rem;">(${escaparHtml(ct.contacto_cargo)})</span>` : '';
            const telCorto = escaparHtml(ct.ultimos_digitos || ct.telefono_normalizado || '');
            const tieneMsgCt = Boolean(ct.tiene_comunicacion_real && ct.ultimo_mensaje_at);
            const tiempoTxt = tieneMsgCt ? formatearTiempoRelativo(ct.ultimo_mensaje_at) : 'Sin mensajes';
            const etq = ETIQUETAS_CRM[ct.etiqueta_crm || ''];
            const etqBadge = ct.etiqueta_crm && etq ? `<span style="background:${etq.bg}; color:${etq.color}; font-size:0.64rem; padding:1px 5px; border-radius:4px; font-weight:700;">${etq.label}</span>` : '';
            const privBadge = (ct.modo_privacidad !== 'ACTIVO' || ct.esta_silenciado_temporal)
                ? `<span title="En Modo Personal / Silenciado en Pizarra" style="font-size:0.72rem;">🔒</span>`
                : '';
            const badgeActivoRow = esElContactoActivo
                ? `<span style="background:#dcfce7; color:#15803d; font-size:0.63rem; font-weight:800; padding:0px 5px; border-radius:4px; border:1px solid #86efac;">Activo</span>`
                : '';
            const textoMsgCt = tieneMsgCt
                ? `${ct.ultimo_mensaje_from_me ? renderizarIconoAck(ct.ultimo_mensaje_ack) + ' ' : ''}${escaparHtml(ct.ultimo_mensaje_texto || '')}`
                : `<span style="color:#94a3b8; font-style:italic;">Sin mensajes en este número</span>`;

            subContactosHtml += `
                <div class="wa-chat-item wa-client-subcontact ${isSelected ? 'active' : ''} ${isWaiting ? 'waiting' : ''}" data-chat-id="${ct.id}" onclick="window.seleccionarChatConsola(${ct.id}, true)">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px;">
                        <div style="font-size: 0.79rem; font-weight: ${esElContactoActivo ? '800' : '600'}; color: ${esElContactoActivo ? '#0f172a' : '#475569'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display:flex; align-items:center; gap:4px;">
                            ${privBadge} <span>👤 ${nombreCt}${cargoCt}</span> ${badgeActivoRow} <span style="color:#94a3b8; font-weight:500; font-size:0.69rem;">· ${telCorto}</span>
                        </div>
                        <span style="font-size: 0.69rem; color: ${isWaiting ? '#16a34a' : '#64748b'}; font-weight: ${isWaiting ? '800' : '500'}; flex-shrink: 0;">
                            ${tiempoTxt}
                        </span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: 1px;">
                        <div style="font-size: 0.75rem; color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                            ${textoMsgCt}
                        </div>
                        ${etqBadge}
                        ${isWaiting ? `<span style="background:${parseInt(ct.no_leidos) > 0 ? '#16a34a' : '#0284c7'}; color:#fff; font-size:0.64rem; font-weight:800; padding:1px 6px; border-radius:10px; flex-shrink:0;">${parseInt(ct.no_leidos) > 0 ? `${ct.no_leidos} sin leer` : '● No leído'}</span>` : ''}
                    </div>
                </div>
            `;
        });

        return `
            <div class="wa-client-group ${algunoActivo ? 'has-active' : ''}">
                <div class="wa-client-group-header" onclick="window.seleccionarChatConsola(${idDefaultCliente}, true)" title="Cliente con ${g.contactos.length} contactos vinculados">
                    <div style="display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden;">
                            ${badgeOrden}
                            <span style="font-weight: 800; font-size: 0.87rem; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${tituloCliente}
                            </span>
                            ${legacyTag}
                            ${codTag}
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                            ${pillContactoActivo}
                            ${estadoHoyBadge}
                            <span class="wa-badge-multi-count">👥 ${g.contactos.length} contactos</span>
                        </div>
                    </div>
                </div>
                <div class="wa-client-group-contacts">
                    ${subContactosHtml}
                </div>
            </div>
        `;
    }

    /**
     * Carga la lista de chats para la Columna 1, agrupando contactos por cliente
     * y organizando los clientes en acordeones cronológicos (Hoy, Ayer, Semana Pasada, Meses) plegados por defecto.
     */
    async function cargarListaChatsConsola(silencioso = false) {
        const listEl = document.getElementById('wa-hub-chat-list');
        if (!listEl) return;

        try {
            const params = new URLSearchParams({
                filtro: estadoConsola.filtroActivo,
                q: estadoConsola.busqueda
            });
            const res = await fetch(`/api/crm/whatsapp/chats?${params.toString()}`);
            const data = await res.json();
            if (!data.success) return;

            const rawChats = data.data || [];
            // Unificar en cliente posibles filas duplicadas (@c.us vs @lid) del mismo contacto/cliente Búnker
            const chatsUnificados = [];
            rawChats.forEach(r => {
                if (r.bunker_cliente_id) {
                    const esLidR = String(r.chat_id || '').endsWith('@lid');
                    const nombreR = String(r.contacto_nombre || '').trim().toLowerCase();
                    const digR = String(r.ultimos_digitos || '').trim();

                    const ex = chatsUnificados.find(item => {
                        if (item.bunker_cliente_id !== r.bunker_cliente_id) return false;
                        const esLidEx = String(item.chat_id || '').endsWith('@lid');
                        const nombreEx = String(item.contacto_nombre || '').trim().toLowerCase();
                        const digEx = String(item.ultimos_digitos || '').trim();
                        if (!esLidR && !esLidEx && digR && digEx && digR === digEx) return true;
                        if ((esLidR || esLidEx) && nombreR && nombreEx && nombreR === nombreEx) return true;
                        return false;
                    });

                    if (ex) {
                        ex.esperando_respuesta = Boolean(ex.esperando_respuesta || r.esperando_respuesta);
                        ex.in_hoy = Number(ex.in_hoy || 0) + Number(r.in_hoy || 0);
                        ex.out_hoy = Number(ex.out_hoy || 0) + Number(r.out_hoy || 0);
                        ex.cant_mensajes_reales = Number(ex.cant_mensajes_reales || 0) + Number(r.cant_mensajes_reales || 0);
                        ex.tiene_comunicacion_real = Boolean(ex.tiene_comunicacion_real || r.tiene_comunicacion_real);
                        if (!ex.etiqueta_crm && r.etiqueta_crm) ex.etiqueta_crm = r.etiqueta_crm;
                        if (!ex.nota_rapida && r.nota_rapida) ex.nota_rapida = r.nota_rapida;
                        const fEx = ex.ultimo_mensaje_at ? new Date(ex.ultimo_mensaje_at).getTime() : 0;
                        const fR = r.ultimo_mensaje_at ? new Date(r.ultimo_mensaje_at).getTime() : 0;
                        if (fR > fEx) {
                            ex.ultimo_mensaje_at = r.ultimo_mensaje_at;
                            if (r.ultimo_mensaje_texto && r.ultimo_mensaje_texto !== 'Cliente Búnker vinculado') {
                                ex.ultimo_mensaje_texto = r.ultimo_mensaje_texto;
                            }
                            ex.ultimo_mensaje_from_me = r.ultimo_mensaje_from_me;
                        }
                        if (String(ex.chat_id || '').endsWith('@lid') && String(r.chat_id || '').endsWith('@c.us')) {
                            ex.id = r.id;
                            ex.chat_id = r.chat_id;
                            ex.telefono_normalizado = r.telefono_normalizado || ex.telefono_normalizado;
                            ex.ultimos_digitos = r.ultimos_digitos || ex.ultimos_digitos;
                        }
                        return;
                    }
                }
                chatsUnificados.push(r);
            });
            estadoConsola.chats = chatsUnificados;

            if (estadoConsola.chats.length === 0) {
                listEl.innerHTML = `
                    <div style="padding: 28px 16px; text-align: center; color: #64748b; font-size: 0.86rem;">
                        <p style="margin-bottom: 10px;">No hay conversaciones en la vista <strong>${estadoConsola.filtroActivo}</strong>${estadoConsola.busqueda ? ` para <strong>"${escaparHtml(estadoConsola.busqueda)}"</strong>` : ''}.</p>
                        <button type="button" onclick="window.sincronizarChatsWhatsappLamda()" style="background: #f0fdf4; border: 1px solid #86efac; color: #166534; padding: 6px 12px; border-radius: 6px; font-weight: 700; cursor: pointer;">
                            🔄 Traer chats recientes de WhatsApp
                        </button>
                    </div>
                `;
                return;
            }

            // 1. Agrupar contactos que pertenecen al mismo cliente (bunker_cliente_id)
            const mapaGrupos = new Map();
            const listaGrupos = [];
            estadoConsola.chats.forEach((c, idx) => {
                const tieneReal = Boolean(c.tiene_comunicacion_real !== undefined ? c.tiene_comunicacion_real : (c.ultimo_mensaje_at && c.ultimo_mensaje_texto !== 'Cliente Búnker vinculado'));
                c.tiene_comunicacion_real = tieneReal;
                c.fechaRealMs = (tieneReal && c.ultimo_mensaje_at) ? new Date(c.ultimo_mensaje_at).getTime() : 0;

                const groupKey = c.bunker_cliente_id ? `bc_${c.bunker_cliente_id}` : `raw_${c.id}`;
                if (!mapaGrupos.has(groupKey)) {
                    const nuevoGrupo = {
                        groupKey,
                        bunker_cliente_id: c.bunker_cliente_id || null,
                        cliente_nombre: c.cliente_nombre || c.contacto_nombre || c.pushname_wa || c.telefono_normalizado,
                        codigo_bunker_cliente: c.codigo_bunker_cliente || '',
                        lomas_soft_id: c.lomas_soft_id || '',
                        contactos: [],
                        ordenAparicion: idx
                    };
                    mapaGrupos.set(groupKey, nuevoGrupo);
                    listaGrupos.push(nuevoGrupo);
                }
                mapaGrupos.get(groupKey).contactos.push(c);
            });

            // 2. Ordenar los contactos de cada cliente poniendo primero el contacto activo por el cual nos comunicamos
            listaGrupos.forEach(g => {
                g.contactos.sort((a, b) => {
                    const wA = a.esperando_respuesta ? 1 : 0;
                    const wB = b.esperando_respuesta ? 1 : 0;
                    if (wA !== wB) return wB - wA;
                    const inA = Number(a.in_hoy || 0) > 0 ? 1 : 0;
                    const inB = Number(b.in_hoy || 0) > 0 ? 1 : 0;
                    if (inA !== inB) return inB - inA;
                    const outA = Number(a.out_hoy || 0) > 0 ? 1 : 0;
                    const outB = Number(b.out_hoy || 0) > 0 ? 1 : 0;
                    if (outA !== outB) return outB - outA;
                    return (b.fechaRealMs || 0) - (a.fechaRealMs || 0);
                });

                g.algunoEsperando = g.contactos.some(ct => ct.esperando_respuesta === true);
                g.tieneComunicacionReal = g.contactos.some(ct => ct.tiene_comunicacion_real === true);
                g.maxFechaRealMs = Math.max(0, ...g.contactos.map(ct => ct.fechaRealMs || 0));
                g.totalInHoy = g.contactos.reduce((acc, ct) => acc + Number(ct.in_hoy || 0), 0);
                g.totalOutHoy = g.contactos.reduce((acc, ct) => acc + Number(ct.out_hoy || 0), 0);
                g.esConversacionActivaHoy = Boolean(g.algunoEsperando || g.totalInHoy > 0);
            });

            // 3. Clasificar cada grupo de cliente en su acordeón temporal correspondiente
            const mapaAcordeones = new Map();
            listaGrupos.forEach(g => {
                const infoAcc = clasificarGrupoEnAcordeonTemporal(g);
                if (!mapaAcordeones.has(infoAcc.key)) {
                    mapaAcordeones.set(infoAcc.key, {
                        ...infoAcc,
                        grupos: []
                    });
                }
                mapaAcordeones.get(infoAcc.key).grupos.push(g);
            });

            const acordeonesOrdenados = Array.from(mapaAcordeones.values()).sort((a, b) => a.ordenBucket - b.ordenBucket);
            const hayBusquedaActiva = estadoConsola.busqueda.trim().length > 0;

            // 4. Renderizar acordeones (siempre plegados por defecto al abrir, y sin desplegarse solos al buscar)
            let html = '';
            acordeonesOrdenados.forEach(acc => {
                // Ordenar clientes dentro del acordeón
                if (acc.key === 'ACC_HOY') {
                    // Dentro de Hoy: primero Conversación Activa, luego Contactados Hoy (mensaje enviado), y por hora descendente
                    acc.grupos.sort((a, b) => {
                        const actA = a.esConversacionActivaHoy ? 1 : 0;
                        const actB = b.esConversacionActivaHoy ? 1 : 0;
                        if (actA !== actB) return actB - actA;
                        return (b.maxFechaRealMs || 0) - (a.maxFechaRealMs || 0);
                    });
                } else if (acc.key === 'ACC_SIN_CONTACTO') {
                    acc.grupos.sort((a, b) => String(a.cliente_nombre || '').localeCompare(String(b.cliente_nombre || ''), 'es'));
                } else {
                    acc.grupos.sort((a, b) => (b.maxFechaRealMs || 0) - (a.maxFechaRealMs || 0));
                }

                const estaAbierto = estadoConsola.acordeonesAbiertos.has(acc.key);
                const cantClientes = acc.grupos.length;
                const cantContactos = acc.grupos.reduce((sum, g) => sum + g.contactos.length, 0);

                let resumenDerecha = `${cantClientes} ${cantClientes === 1 ? 'cliente' : 'clientes'}`;
                if (acc.key === 'ACC_HOY') {
                    const cantActivos = acc.grupos.filter(g => g.esConversacionActivaHoy).length;
                    const cantEnviados = cantClientes - cantActivos;
                    resumenDerecha = `${cantClientes} clientes (${cantActivos} act. / ${cantEnviados} env.)`;
                } else if (cantContactos > cantClientes) {
                    resumenDerecha = `${cantClientes} ${cantClientes === 1 ? 'cliente' : 'clientes'} · ${cantContactos} cont.`;
                }

                // Si el usuario está buscando y el acordeón está plegado, mostrar píldoras rápidas de los clientes hallados sin abrir todos los acordeones
                let chipsBusquedaHtml = '';
                if (hayBusquedaActiva) {
                    const primeros = acc.grupos.slice(0, 4).map(g => {
                        const ctDef = g.contactos[0];
                        const numLeg = g.lomas_soft_id ? `Nº ${escaparHtml(g.lomas_soft_id)}` : (g.codigo_bunker_cliente ? `#${escaparHtml(g.codigo_bunker_cliente)}` : '');
                        const multiTxt = g.contactos.length > 1 ? ` · 👥 ${g.contactos.length}` : '';
                        return `<span class="wa-search-preview-chip" onclick="event.stopPropagation(); window.seleccionarChatConsola(${ctDef.id}, true)" title="Abrir directo el chat de ${escaparHtml(g.cliente_nombre)}">🎯 ${escaparHtml(g.cliente_nombre)} ${numLeg ? `<strong style="color:#1e40af;">(${numLeg})</strong>` : ''}${multiTxt}</span>`;
                    }).join('');
                    const extraCnt = acc.grupos.length > 4 ? `<span style="font-size:0.7rem; color:#64748b; font-weight:700;">+${acc.grupos.length - 4} más</span>` : '';
                    chipsBusquedaHtml = `
                        <div id="wa-acc-chips-${acc.key}" style="display:${!estaAbierto ? 'flex' : 'none'}; flex-wrap:wrap; gap:4px; margin-top:3px; align-items:center;">
                            ${primeros}${extraCnt}
                        </div>
                    `;
                }

                let interiorHtml = '';
                if (acc.key === 'ACC_HOY') {
                    const activosHoy = acc.grupos.filter(g => g.esConversacionActivaHoy);
                    const enviadosHoy = acc.grupos.filter(g => !g.esConversacionActivaHoy);
                    let contadorGlobalHoy = 0;

                    if (activosHoy.length > 0) {
                        interiorHtml += `
                            <div class="wa-acc-subdivider" style="background:#f0fdf4; color:#15803d;">
                                <span>🔥 En conversación activa hoy</span>
                                <span>${activosHoy.length}</span>
                            </div>
                        `;
                        activosHoy.forEach(g => {
                            contadorGlobalHoy++;
                            interiorHtml += renderizarTarjetaGrupoClienteHtml(g, contadorGlobalHoy, true);
                        });
                    }
                    if (enviadosHoy.length > 0) {
                        interiorHtml += `
                            <div class="wa-acc-subdivider" style="background:#f0f9ff; color:#0369a1;">
                                <span>📨 Ya contactados hoy (mensaje enviado)</span>
                                <span>${enviadosHoy.length}</span>
                            </div>
                        `;
                        enviadosHoy.forEach(g => {
                            contadorGlobalHoy++;
                            interiorHtml += renderizarTarjetaGrupoClienteHtml(g, contadorGlobalHoy, true);
                        });
                    }
                } else {
                    acc.grupos.forEach((g, idxGrupo) => {
                        interiorHtml += renderizarTarjetaGrupoClienteHtml(g, idxGrupo + 1, false);
                    });
                }

                html += `
                    <div class="wa-acc-section">
                        <div class="wa-acc-header" style="background:${acc.bgHeader}; border-left: 4px solid ${acc.borderLeft};" onclick="window.toggleAcordeonChatsWa('${acc.key}')">
                            <div class="wa-acc-header-row">
                                <div class="wa-acc-title" style="color:${acc.colorTexto};">
                                    <span id="wa-acc-arrow-${acc.key}" class="wa-acc-arrow">${estaAbierto ? '▼' : '▶'}</span>
                                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escaparHtml(acc.titulo)}</span>
                                </div>
                                <span class="wa-acc-count-pill" style="background:${acc.bgPill}; color:${acc.colorPill};">
                                    ${resumenDerecha}
                                </span>
                            </div>
                            <div style="font-size:0.7rem; color:#64748b; padding-left:20px;">
                                ${escaparHtml(acc.subtitulo)}
                            </div>
                            ${chipsBusquedaHtml}
                        </div>
                        <div id="wa-acc-body-${acc.key}" style="display:${estaAbierto ? 'block' : 'none'}; border-top:1px solid #e2e8f0;">
                            ${interiorHtml}
                        </div>
                    </div>
                `;
            });

            listEl.innerHTML = html;
        } catch (err) {
            if (!silencioso) console.error('Error cargando chats consola:', err);
        }
    }

    /**
     * Selecciona un chat y renderiza la Columna 2 (Conversación) y Columna 3 (Rayos X del Cliente)
     */
    window.seleccionarChatConsola = async function (chatPk, scrollAlFinal = true) {
        if (scrollAlFinal && window.innerWidth <= 768 && typeof window.cambiarTabMovilConsolaWa === 'function') {
            window.cambiarTabMovilConsolaWa('conv');
        }
        estadoConsola.chatActivoId = chatPk;
        document.querySelectorAll('#wa-hub-chat-list .wa-chat-item').forEach(el => {
            if (Number(el.getAttribute('data-chat-id')) === Number(chatPk)) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });
        document.querySelectorAll('#wa-hub-chat-list .wa-client-group').forEach(grp => {
            if (grp.querySelector('.wa-chat-item.active')) {
                grp.classList.add('has-active');
            } else {
                grp.classList.remove('has-active');
            }
        });

        try {
            const res = await fetch(`/api/crm/whatsapp/chats/${chatPk}/detalle`);
            const data = await res.json();
            if (!data.success) return;

            // Si es un refresco silencioso de fondo (cada 6s) y no entraron mensajes nuevos ni cambió el texto del último mensaje (ej: transcripción de audio), no destruir el DOM bajo el mouse
            const msgsPrev = (estadoConsola.detalleActivo && Array.isArray(estadoConsola.detalleActivo.mensajes))
                ? estadoConsola.detalleActivo.mensajes
                : null;
            const cantPrev = msgsPrev ? msgsPrev.length : -1;
            const cantNueva = Array.isArray(data.mensajes) ? data.mensajes.length : 0;
            const ultimoCuerpoPrev = (msgsPrev && msgsPrev.length > 0) ? String(msgsPrev[msgsPrev.length - 1].cuerpo || '') : '';
            const ultimoCuerpoNuevo = (Array.isArray(data.mensajes) && data.mensajes.length > 0) ? String(data.mensajes[data.mensajes.length - 1].cuerpo || '') : '';
            const mismoChat = estadoConsola.detalleActivo && estadoConsola.detalleActivo.chat && Number(estadoConsola.detalleActivo.chat.id) === Number(chatPk);

            estadoConsola.detalleActivo = data;
            estadoConsola.chatActivoDatos = data.chat;
            estadoConsola.rayosXActivo = data.rayos_x;

            if (!scrollAlFinal && mismoChat && cantPrev === cantNueva && ultimoCuerpoPrev === ultimoCuerpoNuevo) {
                return;
            }

            // Si el usuario estaba escribiendo en el input del mismo chat y es solo un refresco de fondo, conservar su texto
            const inputExistente = document.getElementById('wa-hub-input-texto');
            const textoEnCurso = (inputExistente && !scrollAlFinal) ? inputExistente.value : '';
            const estabaEnFoco = (inputExistente && document.activeElement === inputExistente);

            renderizarColumnaConversacion(data.chat, data.mensajes, scrollAlFinal, textoEnCurso, estabaEnFoco);
            renderizarColumnaRayosX(data.chat, data.rayos_x);
        } catch (err) {
            console.error('Error cargando detalle del chat:', err);
        }
    };

    /**
     * Renderiza la Columna 2: Conversación + Barra de Acciones Rápidas LAMDA
     */
    function renderizarColumnaConversacion(chat, mensajes, scrollAlFinal, textoEnCurso = '', restaurarFoco = false) {
        const colConv = document.getElementById('wa-hub-col-conv');
        if (!colConv) return;

        const titulo = escaparHtml(chat.cliente_nombre || chat.contacto_nombre || chat.pushname_wa || chat.telefono_normalizado);
        const badgeLegacyHdr = chat.lomas_soft_id
            ? `<span class="wa-badge-num-legacy" style="margin-left:5px;" title="Número de Cliente Legacy">Nº ${escaparHtml(chat.lomas_soft_id)}</span>`
            : '';
        const badgeBunkerHdr = chat.codigo_bunker_cliente
            ? `<span class="wa-badge-num-bunker" style="margin-left:4px;" title="Código Búnker">#${escaparHtml(chat.codigo_bunker_cliente)}</span>`
            : '';
        const subinfo = `📱 +${escaparHtml(chat.telefono_normalizado)} ${chat.contacto_nombre ? `· 👤 ${escaparHtml(chat.contacto_nombre)}` : ''} ${chat.contacto_cargo ? `(${escaparHtml(chat.contacto_cargo)})` : ''}`;
        const modoPrivTxt = chat.esta_silenciado_temporal
            ? '🕒 Modo Personal (24h)'
            : (chat.modo_privacidad === 'SILENCIADO_PIZARRA' ? '🔇 Modo Personal' : (chat.modo_privacidad === 'OCULTO' ? '👁️‍🗨️ Oculto' : '🟢 Comercial Activo'));

        // Si el cliente activo tiene múltiples contactos en la lista, mostrar selector rápido entre sus contactos
        const contactosMismoCliente = chat.bunker_cliente_id
            ? (estadoConsola.chats || []).filter(c => Number(c.bunker_cliente_id) === Number(chat.bunker_cliente_id))
            : [];
        const selectorMultiContactosHtml = contactosMismoCliente.length > 1
            ? `<div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap; margin-top:4px;">
                <span style="font-size:0.7rem; font-weight:700; color:#64748b;">Contactos del cliente:</span>
                ${contactosMismoCliente.map(ct => {
                    const esAct = Number(ct.id) === Number(chat.id);
                    const nom = escaparHtml(ct.contacto_nombre || ct.telefono_normalizado);
                    const crg = ct.contacto_cargo ? ` (${escaparHtml(ct.contacto_cargo)})` : '';
                    return `<button type="button" onclick="window.seleccionarChatConsola(${ct.id}, true)" style="background:${esAct ? '#075e54' : '#ffffff'}; color:${esAct ? '#ffffff' : '#334155'}; border:1px solid ${esAct ? '#075e54' : '#cbd5e1'}; border-radius:999px; padding:2px 8px; font-size:0.71rem; font-weight:${esAct ? '800' : '600'}; cursor:pointer;">👤 ${nom}${crg}</button>`;
                }).join('')}
               </div>`
            : '';

        let burbujasHtml = '';
        if (!mensajes || mensajes.length === 0) {
            burbujasHtml = `
                <div style="margin: auto; background: rgba(255,255,255,0.85); padding: 14px 20px; border-radius: 10px; text-align: center; color: #475569; font-size: 0.85rem;">
                    No hay mensajes guardados todavía en este hilo. Podés escribir abajo o tocar <strong>"Traer Chats Recientes del Celular"</strong> arriba.
                </div>
            `;
        } else {
            mensajes.forEach(m => {
                const hora = m.fecha_mensaje
                    ? new Date(m.fecha_mensaje).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : '';
                const origenBadge = (m.origen_envio && m.origen_envio.startsWith('lamda_'))
                    ? `<span style="background:rgba(0,0,0,0.06); padding:1px 5px; border-radius:4px; font-size:0.66rem;">LAMDA</span>`
                    : '';

                burbujasHtml += `
                    <div class="wa-bubble ${m.from_me ? 'outgoing' : 'incoming'}">
                        <div style="white-space: pre-wrap;">${escaparHtml(m.cuerpo)}</div>
                        <div class="wa-bubble-meta">
                            ${origenBadge}
                            <span>${hora}</span>
                            ${m.from_me ? renderizarIconoAck(m.ack) : ''}
                        </div>
                    </div>
                `;
            });
        }

        colConv.innerHTML = `
            <!-- Encabezado del Chat -->
            <div class="wa-conv-header">
                <div>
                    <div style="font-weight: 800; font-size: 0.98rem; color: #0f172a; display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                        <button type="button" class="wa-mob-nav-pill" onclick="window.cambiarTabMovilConsolaWa('chats')" title="Volver a la lista de chats">← Chats</button>
                        <button type="button" class="wa-mob-nav-pill" onclick="window.cambiarTabMovilConsolaWa('xray')" style="background:#ecfdf5; border-color:#6ee7b7; color:#065f46;" title="Ver Ficha / Rayos X del Cliente">📊 Ficha</button>
                        <span>${titulo}</span>
                        ${badgeLegacyHdr}
                        ${badgeBunkerHdr}
                    </div>
                    <div style="font-size: 0.76rem; color: #475569;">${subinfo}</div>
                    ${selectorMultiContactosHtml}
                </div>
                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                    <button type="button" onclick="window.abrirAsistenteComercialConversacionWa({ chatId: ${chat.id} })" style="background: linear-gradient(135deg, #059669, #0d9488); border: none; color: #ffffff; padding: 5px 10px; border-radius: 6px; font-size: 0.76rem; font-weight: 800; cursor: pointer; box-shadow: 0 1px 2px rgba(5,150,105,0.28);" title="Asistente Comercial Conversacional: Pasar Link del Portal B2B, Lista de Precios, ver qué compra este cliente y sugerir respuestas cortas paso a paso">
                        💬 Asistente: Precios, Portal e Historial
                    </button>
                    <button type="button" onclick="window.abrirAsistentePoliticasFinanciacionWa({ chatId: ${chat.id}, escenario: 'PAGOS_PARCIALES' })" style="background: linear-gradient(135deg, #1e40af, #0284c7); border: none; color: #ffffff; padding: 5px 10px; border-radius: 6px; font-size: 0.76rem; font-weight: 800; cursor: pointer; box-shadow: 0 1px 2px rgba(2,132,199,0.25);" title="Abrir Asistente de Políticas, Financiación y Pagos Parciales para este cliente">
                        🛡️ Políticas y Pagos Parciales
                    </button>
                    ${chat.esperando_respuesta ? `
                        <button type="button" onclick="window.marcarChatAtendidoWa(${chat.id})" style="background: #dcfce7; border: 1px solid #86efac; color: #166534; padding: 5px 10px; border-radius: 6px; font-size: 0.76rem; font-weight: 800; cursor: pointer;">
                            ✓ Marcar como visto
                        </button>
                    ` : ''}
                    <button type="button" onclick="window.cambiarPrivacidadRapidaWa(${chat.id}, '${titulo.replace(/'/g, "\\'")}')" style="background: #ffffff; border: 1px solid #cbd5e1; color: #334155; padding: 5px 10px; border-radius: 6px; font-size: 0.76rem; font-weight: 700; cursor: pointer;" title="Cambiar entre Modo Comercial y Modo Personal">
                        ${modoPrivTxt} ▾
                    </button>
                </div>
            </div>

            <!-- Historial de Mensajes -->
            <div id="wa-hub-messages-scroll" class="wa-conv-messages">
                ${burbujasHtml}
            </div>

            <!-- Barra de Asistencia Contextual en Vivo (Detecta consulta del cliente sin responder sola) -->
            ${(() => {
                const det = typeof detectarIntencionConversacionWa === 'function'
                    ? detectarIntencionConversacionWa(mensajes)
                    : { codigo: 'GENERAL', etiqueta: '💬 Conversación Comercial', pasoSugerido: 'PASO_1_PORTAL', ultimoRecibido: '' };
                const esPrioritario = det.codigo === 'PIDE_LISTA_PRECIOS' || det.codigo === 'CONSULTA_PRECIO_PRODUCTO' || chat.esperando_respuesta;
                const bgBanner = det.codigo === 'PIDE_LISTA_PRECIOS'
                    ? 'linear-gradient(90deg, #ecfdf5 0%, #f0fdfa 100%)'
                    : (det.codigo === 'CONSULTA_PRECIO_PRODUCTO' ? 'linear-gradient(90deg, #eff6ff 0%, #f0f9ff 100%)' : '#f8fafc');
                const borderBanner = det.codigo === 'PIDE_LISTA_PRECIOS' ? '#6ee7b7' : (det.codigo === 'CONSULTA_PRECIO_PRODUCTO' ? '#93c5fd' : '#e2e8f0');
                return `
                    <div id="wa-hub-asistente-contextual-bar" style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; background: ${bgBanner}; border-top: 1px solid ${borderBanner}; padding: 6px 12px; font-size: 0.75rem;">
                        <div style="display: flex; align-items: center; gap: 6px; min-width: 180px; flex: 1;">
                            <span style="background: ${esPrioritario ? '#059669' : '#475569'}; color: #fff; font-weight: 800; padding: 2px 7px; border-radius: 999px; font-size: 0.68rem; white-space: nowrap;">
                                ${escaparHtml(det.etiqueta)}
                            </span>
                            <span style="color: #334155; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escaparHtml(det.ultimoRecibido || '')}">
                                ${det.ultimoRecibido ? `Último del cliente: "${escaparHtml(det.ultimoRecibido.slice(0, 75))}${det.ultimoRecibido.length > 75 ? '…' : ''}"` : 'Asistencia paso a paso lista para el operador'}
                            </span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                            <button type="button" onclick="window.insertarAtajoTextoWa('SALUDO')" style="background: #ffffff; border: 1px solid #0284c7; color: #0369a1; padding: 3px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 800; cursor: pointer;" title="Escribe un saludo corto y variado de semana en el cuadro de abajo (clic varias veces para cambiar la frase)">
                                👋 Saludo corto (Variar 🎲)
                            </button>
                            <button type="button" onclick="window.insertarPasoRapidoAsistenteEnCuadroWa(${chat.id}, 'PASO_1_PORTAL')" style="background: #ffffff; border: 1px solid #10b981; color: #047857; padding: 3px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 800; cursor: pointer;" title="Escribe en el cuadro de abajo el Link del Portal + pregunta corta sin enviarlo automáticamente">
                                🔗 Link Portal
                            </button>
                            <button type="button" onclick="window.abrirAsistenteComercialConversacionWa({ chatId: ${chat.id}, pasoInicial: '${det.pasoSugerido}' })" style="background: #059669; border: none; color: #ffffff; padding: 4px 10px; border-radius: 6px; font-size: 0.73rem; font-weight: 800; cursor: pointer;" title="Abrir el Asistente Comercial Híbrido con último hilo, qué compra, cada cuánto compra, cómo paga y redacción proactiva">
                                💬 Asistente Híbrido ↗
                            </button>
                        </div>
                    </div>
                `;
            })()}

            <!-- Barra Horizontal de Atajos LAMDA -->
            <div class="wa-quick-bar">
                <span style="font-size: 0.72rem; font-weight: 800; color: #64748b;">⚡ Atajos:</span>
                <button type="button" class="wa-quick-chip" onclick="window.abrirAsistenteComercialConversacionWa({ chatId: ${chat.id} })" style="background: #ecfdf5; border-color: #6ee7b7; color: #047857; font-weight: 800;">💬 Lista de Precios / Portal / Qué Compra</button>
                <button type="button" class="wa-quick-chip" onclick="window.abrirAsistentePoliticasFinanciacionWa({ chatId: ${chat.id}, escenario: 'PAGOS_PARCIALES' })" style="background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; font-weight: 800;">🛡️ Políticas / Pagos Parciales</button>
                <button type="button" class="wa-quick-chip" onclick="window.insertarAtajoTextoWa('CBU')">🏦 Pegar CBU Galicia</button>
                <button type="button" class="wa-quick-chip" onclick="window.insertarAtajoTextoWa('SALUDO')">👋 Saludo Comercial</button>
                <button type="button" class="wa-quick-chip" onclick="window.insertarAtajoTextoWa('PEDIDO_CAMINO')">🚚 Mercadería en camino</button>
                <button type="button" class="wa-quick-chip" onclick="window.programarSeguimientoDesdeChatWa()">📅 Agendar Seguimiento</button>
            </div>

            <!-- Indicador de Borrador Reservado (no se pierde al cerrar la ventana) -->
            ${(() => {
                const borradorGuardado = textoEnCurso || obtenerBorradorChatWa(chat.id);
                const tieneBorrador = borradorGuardado.trim().length > 0;
                return `
                    <div id="wa-hub-borrador-banner" style="display: ${tieneBorrador ? 'flex' : 'none'}; justify-content: space-between; align-items: center; background: #ecfdf5; border-top: 1px solid #a7f3d0; padding: 4px 14px; font-size: 0.75rem; color: #065f46; font-weight: 700;">
                        <span>💾 Borrador reservado en este chat (podés cerrar la ventana para consultar precios y no se pierde)</span>
                        <button type="button" onclick="window.limpiarBorradorChatWa(${chat.id})" style="background: none; border: none; color: #dc2626; font-size: 0.73rem; font-weight: 800; cursor: pointer; text-decoration: underline;">🗑️ Limpiar borrador</button>
                    </div>
                    <!-- Área de Escritura -->
                    <div class="wa-conv-input-area">
                        <textarea id="wa-hub-input-texto" rows="${tieneBorrador && borradorGuardado.length > 90 ? 5 : 2}" placeholder="Escribí un mensaje para enviar por WhatsApp (se guarda solo como borrador)..." oninput="window.guardarBorradorChatWa(${chat.id}, this.value)" onkeydown="if(event.key==='Enter' && !event.shiftKey){ event.preventDefault(); window.enviarMensajeDesdeConsolaWa(${chat.id}); }" style="flex: 1; padding: 9px 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 0.9rem; font-family: inherit; resize: vertical;">${escaparHtml(borradorGuardado)}</textarea>
                        <div style="display: flex; flex-direction: column; gap: 5px; flex-shrink: 0;">
                            <button type="button" onclick="window.enviarMensajeDesdeConsolaWa(${chat.id})" style="background: #128c7e; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 800; font-size: 0.88rem; cursor: pointer; white-space: nowrap;" title="Enviar mensaje ahora mismo por WhatsApp">
                                🚀 Enviar Ahora
                            </button>
                            <button type="button" onclick="window.programarMensajeDesdeConsolaWa(${chat.id})" style="background: #0284c7; color: white; border: none; padding: 7px 12px; border-radius: 8px; font-weight: 800; font-size: 0.78rem; cursor: pointer; white-space: nowrap;" title="Reservar / Programar este mensaje para el Lunes u otro día y horario (Seguimientos WhatsApp)">
                                📅 Programar / Reservar
                            </button>
                        </div>
                    </div>
                `;
            })()}
        `;

        const scrollContainer = document.getElementById('wa-hub-messages-scroll');
        if (scrollContainer && scrollAlFinal) {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
        if (restaurarFoco) {
            const inp = document.getElementById('wa-hub-input-texto');
            if (inp) inp.focus();
        }
    }

    /**
     * Renderiza la Columna 3: Rayos X Comerciales del Cliente en Tiempo Real
     */
    function renderizarColumnaRayosX(chat, rayosX) {
        const colXray = document.getElementById('wa-hub-col-xray');
        if (!colXray) return;

        estadoConsola.rayosXActivo = rayosX;
        const cli = rayosX?.cliente;
        const cc = rayosX?.cuenta_corriente || { tiene_cuenta: false, saldo_actual: 0, ultimos_movimientos: [] };
        const facturas = rayosX?.ultimas_facturas || [];
        const pedidos = rayosX?.pedidos_recientes || [];
        const seguimientos = rayosX?.seguimientos || [];

        // Opciones de etiqueta CRM
        const opcionesEtiqueta = Object.entries(ETIQUETAS_CRM).map(([key, val]) => {
            const sel = (chat.etiqueta_crm || '') === key ? 'selected' : '';
            return `<option value="${key}" ${sel}>${val.label}</option>`;
        }).join('');

        let html = `
            <!-- 1. Clasificación CRM y Nota Rápida de la Conversación -->
            <div class="wa-xray-card" style="background: #f0fdf4; border-color: #bbf7d0;">
                <div class="wa-xray-title" style="color: #166534;">
                    <span>🏷️ Estado CRM del Chat</span>
                </div>
                <select onchange="window.guardarEtiquetaNotaChatWa(${chat.id}, this.value, null)" style="width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid #86efac; font-size: 0.84rem; font-weight: 700; margin-bottom: 8px; background: #fff;">
                    ${opcionesEtiqueta}
                </select>
                <textarea id="wa-xray-nota-rapida" rows="2" placeholder="📌 Nota rápida de este cliente/chat (se guarda al salir del campo)..." onblur="window.guardarEtiquetaNotaChatWa(${chat.id}, null, this.value)" style="width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.8rem; box-sizing: border-box; resize: vertical;">${escaparHtml(chat.nota_rapida || '')}</textarea>
            </div>
        `;

        if (!cli) {
            html += `
                <div class="wa-xray-card" style="border-color: #fde68a; background: #fffbeb;">
                    <div class="wa-xray-title" style="color: #92400e;">❓ Número no vinculado a Búnker</div>
                    <p style="font-size: 0.8rem; color: #78350f; margin: 4px 0 10px;">
                        Este número (<strong>+${escaparHtml(chat.telefono_normalizado)}</strong>) todavía no está asociado a un cliente de Búnker.
                    </p>
                    <button type="button" onclick="window.vincularChatConClienteBunkerModal(${chat.id})" style="width: 100%; background: #d97706; color: white; border: none; padding: 7px 10px; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; margin-bottom: 6px;">
                        🔗 Vincular a un Cliente de Búnker
                    </button>
                    <button type="button" onclick="window.cambiarPrivacidadRapidaWa(${chat.id}, '${escaparHtml(chat.telefono_normalizado)}')" style="width: 100%; background: #ffffff; color: #475569; border: 1px solid #cbd5e1; padding: 6px 10px; border-radius: 6px; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
                        🔒 Es contacto personal / Ocultar
                    </button>
                </div>
            `;
        } else {
            const saldoColor = cc.saldo_actual > 0 ? '#dc2626' : '#16a34a';
            const saldoFormateado = Number(cc.saldo_actual || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

            html += `
                <!-- 2. Ficha del Cliente Búnker -->
                <div class="wa-xray-card">
                    <div class="wa-xray-title">
                        <span>🏢 Cliente Búnker #${escaparHtml(cli.codigo_bunker_cliente || cli.id)}</span>
                        <button type="button" onclick="window.vincularChatConClienteBunkerModal(${chat.id})" style="background:none; border:none; color:#0284c7; font-size:0.72rem; cursor:pointer; text-decoration:underline;">Cambiar</button>
                    </div>
                    <div style="font-weight: 800; font-size: 0.94rem; color: #0f172a;">${escaparHtml(cli.cliente_nombre)}</div>
                    ${cli.razon_social ? `<div style="font-size: 0.78rem; color: #475569;">Razón Social: ${escaparHtml(cli.razon_social)}</div>` : ''}
                    ${cli.cuit_cuil ? `<div style="font-size: 0.76rem; color: #64748b;">CUIT: ${escaparHtml(cli.cuit_cuil)} (${escaparHtml(cli.condicion_iva || '-')})</div>` : ''}
                    ${cli.lista_asignada_id ? `<div style="font-size: 0.76rem; color: #0f766e; font-weight: 700;">🏷️ Lista Asignada: Lista #${cli.lista_asignada_id} (${escaparHtml(cli.lista_asignada_nombre || '')})</div>` : ''}
                    ${cli.lomas_localidad || cli.domicilio_fiscal ? `<div style="font-size: 0.76rem; color: #64748b;">📍 ${escaparHtml(cli.lomas_localidad || cli.domicilio_fiscal)}</div>` : ''}
                    <div style="display: flex; flex-direction: column; gap: 5px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e2e8f0;">
                        <button type="button" onclick="window.abrirAsistenteComercialConversacionWa({ chatId: ${chat.id} })" style="width: 100%; background: #ecfdf5; border: 1px solid #6ee7b7; color: #065f46; padding: 6px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 800; cursor: pointer; text-align: left;">
                            💬 Asistente: Lista de Precios, Portal y Qué Compra
                        </button>
                        <button type="button" onclick="window.abrirAsistentePoliticasFinanciacionWa({ chatId: ${chat.id}, escenario: 'PAGOS_PARCIALES' })" style="width: 100%; background: #eff6ff; border: 1px solid #93c5fd; color: #1e40af; padding: 6px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 800; cursor: pointer; text-align: left;">
                            🛡️ Asistente: Políticas y Pagos Parciales
                        </button>
                    </div>
                </div>

                <!-- 3. Estado de Cuenta Corriente -->
                <div class="wa-xray-card" style="${cc.saldo_actual > 0.01 ? 'border-color: #fecaca; background: #fffbfa;' : ''}">
                    <div class="wa-xray-title">
                        <span>💰 Cuenta Corriente ${cli.codigo_bunker_cliente ? `<a href="http://localhost:3005/pages/cuenta-corriente.html?cliente=${encodeURIComponent(cli.codigo_bunker_cliente)}" target="_blank" style="font-size:0.7rem; color:#0284c7; font-weight:700; text-decoration:none; margin-left:4px; text-transform:none;">Ver CC ↗</a>` : ''}</span>
                        <span style="font-size: 0.96rem; font-weight: 800; color: ${saldoColor};">${saldoFormateado}</span>
                    </div>
                    ${(cc.composicion && Array.isArray(cc.composicion.capas) && cc.composicion.capas.length > 0) ? `
                        <div style="margin-bottom: 6px; padding: 5px 7px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px;">
                            <div style="font-size: 0.69rem; font-weight: 800; color: #991b1b; margin-bottom: 3px;">⏳ Composición de Saldo Pendiente:</div>
                            <div style="display: flex; flex-direction: column; gap: 3px;">
                                ${cc.composicion.capas.map(capa => {
                                    const descCorta = String(capa.descripcion || capa.tipo_comprobante || 'Comprobante').replace(/\s*\(CAE:[^)]*\)/i, '').trim();
                                    const mPend = Number(capa.monto_pendiente || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
                                    const diasBadge = capa.antiguedad_dias > 0 ? `Hace ${capa.antiguedad_dias}d` : 'Hoy';
                                    const badgeBg = capa.antiguedad_dias > 14 ? '#dc2626' : (capa.antiguedad_dias > 7 ? '#d97706' : '#16a34a');
                                    return `
                                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.72rem; background:#ffffff; padding:2px 6px; border-radius:4px; border:1px solid #fee2e2;">
                                            <span style="color:#1e293b; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:165px;" title="${escaparHtml(capa.descripcion || '')}">${escaparHtml(descCorta)}</span>
                                            <span style="display:inline-flex; align-items:center; gap:4px; flex-shrink:0;">
                                                <strong style="color:#b91c1c;">${mPend}</strong>
                                                <span style="background:${badgeBg}; color:#fff; font-size:0.64rem; font-weight:800; padding:0px 5px; border-radius:8px;">${diasBadge}</span>
                                            </span>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${cc.ultimos_movimientos.length === 0 ? `
                        <div style="font-size: 0.78rem; color: #64748b;">Sin movimientos recientes registrados.</div>
                    ` : cc.ultimos_movimientos.slice(0, 4).map(m => {
                        const f = m.fecha_movimiento ? new Date(m.fecha_movimiento).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '';
                        const montoTxt = Number(m.monto || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
                        const descLimpia = String(m.descripcion || m.tipo_comprobante || m.origen_tipo || 'Movimiento').replace(/\s+/g, ' ').replace(/\s*\(CAE:[^)]*\)/i, '').trim();
                        const esDebito = m.tipo_movimiento === 'DEBITO';
                        return `
                            <div style="display:flex; justify-content:space-between; font-size:0.74rem; padding:3px 0; border-bottom:1px dashed #e2e8f0;" title="${escaparHtml(String(m.descripcion || '').replace(/\s+/g, ' ').trim())}">
                                <span style="color:#334155; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:190px;">${f} · ${escaparHtml(descLimpia)}</span>
                                <strong style="color:${esDebito ? '#b91c1c' : '#15803d'}; flex-shrink:0;">${esDebito ? '+' : '-'}${montoTxt}</strong>
                            </div>
                        `;
                    }).join('')}
                    <div style="margin-top: 8px; padding-top: 7px; border-top: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 5px;">
                        <button type="button" onclick="window.abrirAsistentePoliticasFinanciacionWa({ chatId: ${chat.id}, escenario: 'PAGOS_PARCIALES' })" style="width: 100%; background: linear-gradient(135deg, #1e40af, #0284c7); color: #ffffff; border: none; border-radius: 6px; padding: 7px 8px; font-size: 0.74rem; font-weight: 800; cursor: pointer; white-space: normal; line-height: 1.25; text-align: center; box-shadow: 0 1px 3px rgba(2,132,199,0.25);">
                            🛡️ Asistente: Políticas y Pagos Parciales
                        </button>
                        <button type="button" onclick="window.abrirAsistentePoliticasFinanciacionWa({ chatId: ${chat.id}, escenario: 'EXTRACTO_CON_POLITICAS', incluirPdf: true, incluirSaldo: true })" style="width: 100%; background: #f8fafc; color: #0f766e; border: 1px solid #99f6e4; border-radius: 6px; padding: 6px 8px; font-size: 0.72rem; font-weight: 800; cursor: pointer; white-space: normal; line-height: 1.25; text-align: center;">
                            📄 Enviar Extracto PDF + Políticas
                        </button>
                    </div>
                </div>

                <!-- 3.5. Últimas Facturas Emitidas + Secuencia de Gestión Comercial -->
                <div class="wa-xray-card" style="border-color: #cbd5e1;">
                    <div class="wa-xray-title">
                        <span>🧾 Últimas Facturas (${facturas.length})</span>
                        <a href="http://localhost:3004/pages/facturas.html" target="_blank" style="font-size:0.72rem; color:#0284c7; font-weight:700; text-decoration:none;">🏛️ Bandeja ARCA ↗</a>
                    </div>
                    ${facturas.length === 0 ? `
                        <div style="font-size: 0.78rem; color: #64748b;">Sin facturas emitidas recientes.</div>
                    ` : facturas.map(f => {
                        const esNC = [3, 8, 13].includes(Number(f.tipo_cbte));
                        const esBorrador = f.estado === 'BORRADOR';
                        const tipoLetra = Number(f.tipo_cbte) === 1 ? 'FA' : (Number(f.tipo_cbte) === 6 ? 'FB' : (Number(f.tipo_cbte) === 3 ? 'NC A' : (Number(f.tipo_cbte) === 8 ? 'NC B' : 'CB')));
                        const nroComp = esBorrador
                            ? `BORRADOR #${f.id}`
                            : `${String(f.pto_vta || 32).padStart(4, '0')}-${String(f.cbte_nro || 0).padStart(8, '0')}`;
                        const fechaRaw = f.fecha_emision || f.emitida_en;
                        const fechaTxt = fechaRaw ? new Date(fechaRaw).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '';
                        const montoNum = Number(f.imp_total || 0) * (esNC ? -1 : 1);
                        const totTxt = montoNum.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
                        const items = Array.isArray(f.items) ? f.items : [];
                        const ncsAsociadas = Array.isArray(f.ncs_asociadas) ? f.ncs_asociadas : [];
                        return `
                            <div style="padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-size: 0.76rem; ${esBorrador ? 'background:#fffbeb; padding:6px; border-radius:6px; margin-bottom:4px; border:1px solid #fde68a;' : ''}">
                                <div style="display:flex; justify-content:space-between; align-items:center; gap: 4px;">
                                    <div>
                                        <strong style="color:${esNC ? '#b91c1c' : '#0f172a'};">${tipoLetra} ${nroComp}</strong>
                                        <span style="color:#64748b; font-size:0.7rem;">(${fechaTxt})</span>
                                        ${esBorrador ? `<span style="background:#fef08a; color:#854d0e; font-size:0.65rem; font-weight:800; padding:1px 5px; border-radius:4px; margin-left:3px;">EN BANDEJA ARCA</span>` : ''}
                                    </div>
                                    <div style="display:flex; align-items:center; gap:6px;">
                                        <strong style="color:${esNC ? '#b91c1c' : '#0f172a'};">${totTxt}</strong>
                                        ${!esNC && !esBorrador ? `
                                            <button type="button" onclick="window.iniciarSecuenciaGestionComprobanteWa(${chat.id}, ${f.id})" title="Iniciar Secuencia Estándar de Gestión Comercial o Depositar NC + Nueva Factura en Bandeja ARCA" style="background:#fff7ed; border:1px solid #fdba74; color:#c2410c; border-radius:4px; padding:2px 6px; font-size:0.68rem; font-weight:800; cursor:pointer;">
                                                🛠️ Gestionar
                                            </button>
                                        ` : `
                                            <a href="http://localhost:3004/pages/facturas.html" target="_blank" style="background:#e0f2fe; border:1px solid #7dd3fc; color:#0369a1; border-radius:4px; padding:2px 6px; font-size:0.66rem; font-weight:800; text-decoration:none;">
                                                🏛️ Ver ARCA
                                            </a>
                                        `}
                                    </div>
                                </div>
                                ${ncsAsociadas.length > 0 ? `
                                    <div style="margin-top:3px; display:flex; flex-wrap:wrap; gap:4px;">
                                        ${ncsAsociadas.map(nc => `
                                            <span style="font-size:0.67rem; font-weight:700; padding:1px 6px; border-radius:4px; background:${nc.estado === 'BORRADOR' ? '#fef3c7' : '#dcfce7'}; color:${nc.estado === 'BORRADOR' ? '#92400e' : '#166534'}; border:1px solid ${nc.estado === 'BORRADOR' ? '#fcd34d' : '#86efac'};">
                                                ${nc.estado === 'BORRADOR' ? `📝 NC Borrador #${nc.id} en Bandeja ARCA (-$${Number(nc.imp_total || 0).toLocaleString('es-AR', {minimumFractionDigits:2})})` : `✅ NC Emitida #${nc.cbte_nro || nc.id} (-$${Number(nc.imp_total || 0).toLocaleString('es-AR', {minimumFractionDigits:2})})`}
                                            </span>
                                        `).join('')}
                                    </div>
                                ` : ''}
                                ${items.length > 0 ? `
                                    <div style="margin-top:3px; padding-left:6px; border-left:2px solid #e2e8f0; color:#475569; font-size:0.7rem;">
                                        ${items.map(it => {
                                            const pNeto = Number(it.p_unit || 0);
                                            return `<div style="display:flex; justify-content:space-between; gap:4px;">
                                                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:175px;">• ${escaparHtml(it.articulo_id || '')} (${Number(it.qty || 1)}u)</span>
                                                <span style="color:#334155; font-weight:600;">$${pNeto.toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})} neto</span>
                                            </div>`;
                                        }).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>

                <!-- 4. Últimos Pedidos / Presupuestos -->
                <div class="wa-xray-card">
                    <div class="wa-xray-title">
                        <span>📦 Últimos Pedidos (${pedidos.length})</span>
                        <a href="/presupuestos" target="_blank" style="font-size:0.72rem; color:#0284c7; text-decoration:none;">Ir a Presupuestos ↗</a>
                    </div>
                    ${pedidos.length === 0 ? `
                        <div style="font-size: 0.78rem; color: #64748b;">No se encontraron presupuestos recientes.</div>
                    ` : pedidos.map(p => {
                        const f = p.fecha ? new Date(p.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) : '';
                        const tot = Number(p.total || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
                        const est = escaparHtml(p.estado_logistico || p.secuencia || p.estado || 'Activo');
                        return `
                            <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.76rem; padding:4px 0; border-bottom:1px dashed #e2e8f0;">
                                <div>
                                    <strong>#${p.id}</strong> (${f})
                                    <span style="background:#e2e8f0; color:#334155; padding:1px 5px; border-radius:4px; font-size:0.68rem;">${est}</span>
                                </div>
                                <strong>${tot}</strong>
                            </div>
                        `;
                    }).join('')}
                </div>

                <!-- 5. Seguimientos Programados -->
                <div class="wa-xray-card" style="border-color: #bbf7d0;">
                    <div class="wa-xray-title">
                        <span>📅 Seguimientos WA (${seguimientos.length})</span>
                        <div style="display:flex; gap:4px;">
                            <button type="button" onclick="window.programarMensajeDesdeConsolaWa(${chat.id})" style="background:#dcfce7; border:1px solid #86efac; color:#166534; border-radius:4px; padding:2px 6px; font-size:0.7rem; font-weight:800; cursor:pointer;" title="Reservar el mensaje actual o programar uno nuevo">➕ Programar</button>
                            <button type="button" onclick="window.abrirMonitorCompletoSeguimientosWa()" style="background:#f1f5f9; border:1px solid #cbd5e1; color:#334155; border-radius:4px; padding:2px 6px; font-size:0.68rem; font-weight:700; cursor:pointer;" title="Abrir Monitor General de Seguimientos WhatsApp">🗂️ Monitor</button>
                        </div>
                    </div>
                    ${seguimientos.length === 0 ? `
                        <div style="font-size: 0.78rem; color: #64748b;">Sin envíos programados para este cliente.</div>
                    ` : seguimientos.slice(0, 4).map(s => {
                        let msgs = s.mensajes;
                        if (typeof msgs === 'string') {
                            try { msgs = JSON.parse(msgs); } catch (e) { msgs = [msgs]; }
                        }
                        if (!Array.isArray(msgs)) msgs = [msgs];
                        const primerTexto = String(msgs[0] || '').trim();
                        const esPend = s.estado === 'PENDIENTE';
                        return `
                            <div style="font-size:0.75rem; padding:6px 0; border-bottom:1px dashed #e2e8f0;">
                                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
                                    <span>
                                        <strong style="color:${esPend ? '#d97706' : '#16a34a'};">${esPend ? '🟡 PENDIENTE' : '🟢 ' + s.estado}</strong>
                                        · <strong>${s.fecha_programada}</strong> (${s.hora_programada || '09:00'} hs)
                                        <span style="background:#f1f5f9; color:#334155; padding:1px 5px; border-radius:4px; font-size:0.65rem; font-weight:700;">💬 ${msgs.length} ${msgs.length === 1 ? 'parte' : 'partes'}</span>
                                    </span>
                                    ${esPend ? `
                                        <div style="display:flex; gap:3px; flex-wrap:wrap;">
                                            <button type="button" onclick="window.enviarPruebaSeguimientoWhatsApp && window.enviarPruebaSeguimientoWhatsApp(${s.id})" title="Enviar prueba a mi propio WhatsApp (221 661 5746)" style="background:#eff6ff; border:1px solid #93c5fd; color:#1d4ed8; border-radius:4px; padding:1px 5px; font-size:0.66rem; font-weight:800; cursor:pointer;">🧪 Prueba</button>
                                            <button type="button" onclick="window.cargarSeguimientoAlChatWa(${chat.id}, ${s.id})" title="Volcar este mensaje reservado a la caja del chat" style="background:#e0f2fe; border:1px solid #7dd3fc; color:#0369a1; border-radius:4px; padding:1px 5px; font-size:0.66rem; font-weight:800; cursor:pointer;">📥 Al chat</button>
                                            <button type="button" onclick="window.enviarSeguimientoDesdeConsolaWa(${s.id}, ${chat.id})" title="Enviar ahora mismo por WhatsApp" style="background:#dcfce7; border:1px solid #86efac; color:#166534; border-radius:4px; padding:1px 5px; font-size:0.66rem; font-weight:800; cursor:pointer;">🚀 Enviar</button>
                                            <button type="button" onclick="window.editarSeguimientoEnModuloCompletoWa(${s.id})" title="Editar o dividir en el Programador Completo" style="background:#f8fafc; border:1px solid #cbd5e1; color:#334155; border-radius:4px; padding:1px 5px; font-size:0.66rem; cursor:pointer;">✏️</button>
                                        </div>
                                    ` : ''}
                                </div>
                                ${s.nota_interna ? `<div style="font-size:0.69rem; color:#0369a1; margin-top:2px;">📝 ${escaparHtml(s.nota_interna)}</div>` : ''}
                                ${primerTexto ? `<div style="font-size:0.71rem; color:#475569; margin-top:2px; background:#f8fafc; padding:3px 6px; border-radius:4px; border-left:2px solid #94a3b8; max-height:44px; overflow:hidden; text-overflow:ellipsis;">“${escaparHtml(primerTexto.substring(0, 140))}${primerTexto.length > 140 ? '...' : ''}”</div>` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        colXray.innerHTML = html;
    }

    /**
     * Envía un mensaje desde la Columna 2 de la Consola
     */
    window.enviarMensajeDesdeConsolaWa = async function (chatPk) {
        const input = document.getElementById('wa-hub-input-texto');
        if (!input) return;
        const texto = input.value.trim();
        if (!texto) return;

        input.disabled = true;
        try {
            const res = await fetch(`/api/crm/whatsapp/chats/${chatPk}/enviar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mensajeTexto: texto })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'No se pudo enviar el mensaje');
            }
            input.value = '';
            window.guardarBorradorChatWa(chatPk, '');
            await seleccionarChatConsola(chatPk, true);
            await cargarListaChatsConsola(true);
            if (typeof window.actualizarAlertasPizarra === 'function') window.actualizarAlertasPizarra();
        } catch (err) {
            if (typeof Swal !== 'undefined') {
                Swal.fire('Error de envío', err.message || 'Verificá que la sesión de WhatsApp esté activa.', 'error');
            } else {
                alert('Error: ' + err.message);
            }
        } finally {
            input.disabled = false;
            input.focus();
        }
    };

    /**
     * Inserta plantillas rápidas en el cuadro de texto (con rotación inteligente de saludos cortos)
     */
    let _rotadorSaludoRapidoIdx = 0;
    window.insertarAtajoTextoWa = function (tipo) {
        const input = document.getElementById('wa-hub-input-texto');
        if (!input) return;
        const chat = estadoConsola.detalleActivo?.chat;
        const rawContacto = String(chat?.contacto_nombre || '').replace(/\([^)]*\)/g, '').trim();
        const esRolGenerico = /^(encargad[oa]|negocio|local|sucursal|administraci[oó]n|compras|ventas|caja|deposito|dep[oó]sito|due[ñn][oa]|cliente|mostrador)$/i.test(rawContacto);
        const nombrePila = (!esRolGenerico && rawContacto && rawContacto.split(/\s+/)[0].length >= 3)
            ? (rawContacto.split(/\s+/)[0].charAt(0).toUpperCase() + rawContacto.split(/\s+/)[0].slice(1).toLowerCase())
            : '';

        const h = new Date().getHours();
        const saludoDia = h < 13 ? 'buen día' : (h < 20 ? 'buenas tardes' : 'buenas noches');
        const saludoDiaCap = h < 13 ? 'Buen día' : (h < 20 ? 'Buenas tardes' : 'Buenas noches');

        if (tipo === 'SALUDO') {
            const variantes = nombrePila
                ? [
                    `Hola ${nombrePila}, ${saludoDia}, cómo va? Cómo venís esta semana, necesitás algo o consultar algún precio?`,
                    `Hola ${nombrePila}! Cómo va la semana? Te escribo cortito por si necesitás reponer algo o saber algún precio.`,
                    `${saludoDiaCap} ${nombrePila}! Cómo andás? Necesitás que te pase algún precio o ir viendo algo para esta semana?`,
                    `Hola ${nombrePila}, cómo estás? Cómo vienen de mercadería para esta semana, necesitan algo?`,
                    `Hola ${nombrePila}! Todo bien? Avisame si para esta semana necesitás consultar algún valor o reponer algo`
                ]
                : [
                    `Hola, ${saludoDia}, cómo están? Cómo vienen esta semana, necesitan algo o consultar algún precio?`,
                    `Hola! Cómo va la semana por ahí? Te escribo cortito por si necesitan reponer algo o saber algún precio.`,
                    `${saludoDiaCap}! Cómo andan? Necesitan que les pase algún precio o ir viendo algo para esta semana?`,
                    `Hola, ${saludoDia}, cómo están? Cómo vienen de mercadería para esta semana, necesitan algo?`,
                    `Hola! Todo bien por ahí? Avísenme si para esta semana necesitan consultar algún valor o reponer mercadería`
                ];
            const texto = variantes[_rotadorSaludoRapidoIdx % variantes.length];
            _rotadorSaludoRapidoIdx++;
            input.value = texto;
            if (chat && chat.id) window.guardarBorradorChatWa(chat.id, input.value);
            input.focus();
            return;
        }

        let texto = '';
        if (tipo === 'CBU') {
            texto = `Te paso los datos bancarios para transferencia:\n*Banco:* Banco Galicia\n*Cuenta (CTA):* 4007844-1 373-4\n*CBU:* 0070373230004007844141\n*Alias:* lamda.ser.martin`;
        } else if (tipo === 'PEDIDO_CAMINO') {
            texto = `¡Hola${nombrePila ? ' ' + nombrePila : ''}! Te avisamos que tu pedido de LAMDA ya está preparado y en hoja de ruta para entrega. ¡Muchas gracias!`;
        }

        input.value = input.value ? (input.value + '\n' + texto) : texto;
        if (chat && chat.id) window.guardarBorradorChatWa(chat.id, input.value);
        input.focus();
    };

    /**
     * Abre el programador rápido o completo de Seguimientos WhatsApp tomando el texto actual del chat
     */
    window.programarSeguimientoDesdeChatWa = async function () {
        const chatPk = estadoConsola.chatActivoId || (estadoConsola.detalleActivo && estadoConsola.detalleActivo.chat && estadoConsola.detalleActivo.chat.id);
        await window.programarMensajeDesdeConsolaWa(chatPk);
    };

    /**
     * Calcula el próximo Lunes (o el día laboral siguiente) en formato YYYY-MM-DD
     */
    function obtenerProximoLunesYyyyMmDd() {
        const d = new Date();
        const day = d.getDay(); // 0=Dom, 1=Lun, ..., 5=Vie, 6=Sab
        const daysToAdd = day === 0 ? 1 : (day === 6 ? 2 : (day === 5 ? 3 : 1));
        d.setDate(d.getDate() + daysToAdd);
        return d.toLocaleDateString('en-CA');
    }

    /**
     * RESERVAR / PROGRAMAR MENSAJE EN EL MÓDULO DE SEGUIMIENTOS WHATSAPP (Lunes u otro día/horario)
     * Conectado directamente con public.crm_seguimientos_whatsapp y con el Programador & Monitor WhatsApp
     */
    window.programarMensajeDesdeConsolaWa = async function (chatPk, textoForzado = null, notaInternaForzada = null) {
        if (typeof Swal === 'undefined') return;
        const chat = estadoConsola.chatActivoDatos || (estadoConsola.detalleActivo && estadoConsola.detalleActivo.chat) || {};
        const rayosX = estadoConsola.rayosXActivo || (estadoConsola.detalleActivo && estadoConsola.detalleActivo.rayos_x) || {};
        const cli = rayosX.cliente || {};

        const inputChat = document.getElementById('wa-hub-input-texto');
        const textoActual = textoForzado !== null
            ? String(textoForzado)
            : (inputChat ? inputChat.value.trim() : obtenerBorradorChatWa(chatPk));

        const clienteNombre = cli.cliente_nombre || chat.cliente_nombre || chat.contacto_nombre || 'Cliente';
        const contactoNombre = chat.contacto_nombre || cli.cliente_nombre || 'Cliente';
        const telefono = chat.telefono_normalizado || '';
        const notaDefecto = notaInternaForzada !== null ? notaInternaForzada : (chat.nota_rapida ? String(chat.nota_rapida).split('\n')[0] : '');

        // Generar atajos de los próximos 7 días (destacando el Lunes)
        const diasNombres = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const fechaDefecto = obtenerProximoLunesYyyyMmDd();

        let pillsDiasHtml = '';
        for (let i = 0; i < 7; i++) {
            const d = new Date();
            d.setDate(d.getDate() + i);
            const ymd = d.toLocaleDateString('en-CA');
            const nomDia = diasNombres[d.getDay()];
            const numDia = d.getDate();
            const nomMes = mesesNombres[d.getMonth()];
            const esLunes = d.getDay() === 1;
            const label = i === 0 ? `Hoy (${nomDia} ${numDia})` : (i === 1 ? `Mañana (${nomDia} ${numDia})` : `${nomDia} ${numDia}/${nomMes}`);
            const isSel = ymd === fechaDefecto;
            pillsDiasHtml += `
                <button type="button" class="swal-wa-dia-pill" data-ymd="${ymd}" onclick="document.getElementById('swal-wa-prog-fecha').value='${ymd}'; document.querySelectorAll('.swal-wa-dia-pill').forEach(b=>{b.style.background='#f8fafc';b.style.color='#334155';b.style.borderColor='#cbd5e1';}); this.style.background='#0284c7'; this.style.color='#fff'; this.style.borderColor='#0284c7';" style="padding:5px 10px; border-radius:14px; border:1px solid ${isSel ? '#0284c7' : '#cbd5e1'}; background:${isSel ? '#0284c7' : '#f8fafc'}; color:${isSel ? '#fff' : '#334155'}; font-size:0.76rem; font-weight:${esLunes ? '800' : '700'}; cursor:pointer;">
                    📅 ${label}${esLunes ? ' ⭐' : ''}
                </button>
            `;
        }

        // Dividir automáticamente el texto inicial en mensajitos cortos si tiene párrafos (Saludo / Cuerpo / Cierre)
        const partesIniciales = (typeof window.dividirTextoEnMensajitos === 'function' && textoActual)
            ? window.dividirTextoEnMensajitos(textoActual)
            : (textoActual ? [textoActual] : ['']);
        if (partesIniciales.length === 0) partesIniciales.push('');

        window._renderPartesSwalWa = function (listaPartes) {
            const box = document.getElementById('swal-wa-prog-partes-box');
            if (!box) return;
            box.innerHTML = listaPartes.map((p, idx) => `
                <div class="swal-wa-parte-item" style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:7px 9px; margin-bottom:7px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <span style="font-size:0.74rem; font-weight:800; color:#15803d;">💬 Mensajito / Parte #${idx + 1}</span>
                        ${listaPartes.length > 1 ? `<button type="button" onclick="window._eliminarParteSwalWa(${idx})" style="background:none; border:none; color:#dc2626; font-size:0.74rem; cursor:pointer; font-weight:700;">🗑️ Quitar</button>` : ''}
                    </div>
                    <textarea class="swal-wa-parte-txt" rows="${Math.min(5, Math.max(2, String(p).split('\n').length))}" style="width:100%; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.82rem; font-family:inherit; box-sizing:border-box; resize:vertical;">${escaparHtml(p)}</textarea>
                </div>
            `).join('');
        };

        window._leerPartesSwalWa = function () {
            const txts = document.querySelectorAll('#swal-wa-prog-partes-box .swal-wa-parte-txt');
            return Array.from(txts).map(t => t.value.trim()).filter(Boolean);
        };

        window._agregarParteSwalWa = function () {
            const act = window._leerPartesSwalWa();
            act.push('');
            window._renderPartesSwalWa(act);
        };

        window._eliminarParteSwalWa = function (idx) {
            const txts = Array.from(document.querySelectorAll('#swal-wa-prog-partes-box .swal-wa-parte-txt')).map(t => t.value);
            txts.splice(idx, 1);
            window._renderPartesSwalWa(txts.length ? txts : ['']);
        };

        window._dividirPartesSwalWa = function () {
            const act = window._leerPartesSwalWa();
            if (act.length === 0) return;
            const nuevas = [];
            act.forEach(t => {
                const sub = typeof window.dividirTextoEnMensajitos === 'function'
                    ? window.dividirTextoEnMensajitos(t)
                    : t.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
                sub.forEach(s => nuevas.push(s));
            });
            window._renderPartesSwalWa(nuevas.length ? nuevas : act);
        };

        window._probarPartesSwalWa = async function () {
            const mensajes = window._leerPartesSwalWa();
            if (mensajes.length === 0) {
                alert('Escribí al menos un mensaje para enviar la prueba.');
                return;
            }
            const btn = document.getElementById('btn-swal-wa-test-self');
            const origTxt = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ Enviando al 221 661 5746...';
            }
            try {
                const res = await fetch('/api/crm/seguimientos/enviar-prueba-directa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ telefono_prueba: '5492216615746', mensajes })
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Error enviando prueba');
                if (btn) {
                    btn.innerHTML = `✅ ¡Prueba enviada (${mensajes.length} partes)!`;
                    btn.style.background = '#dcfce7';
                    btn.style.color = '#166534';
                }
                setTimeout(() => {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = origTxt;
                    }
                }, 3500);
            } catch (e) {
                alert('Error en envío de prueba: ' + e.message);
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = origTxt;
                }
            }
        };

        const result = await Swal.fire({
            title: '📅 Programar / Reservar Envío WhatsApp',
            width: 720,
            html: `
                <div style="text-align:left; font-size:0.85rem;">
                    <div style="background:#f0fdf4; border:1px solid #bbf7d0; padding:8px 12px; border-radius:8px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                        <span><strong>Cliente:</strong> ${escaparHtml(clienteNombre)}</span>
                        <span><strong>Destino:</strong> ${escaparHtml(contactoNombre)} (<code>+${escaparHtml(telefono)}</code>)</span>
                    </div>

                    <label style="font-weight:700; display:block; margin-bottom:5px;">1. Elegí el día de envío (1 clic o calendario):</label>
                    <div style="display:flex; flex-wrap:wrap; gap:5px; margin-bottom:8px;">
                        ${pillsDiasHtml}
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
                        <div>
                            <label style="font-weight:700; font-size:0.78rem; color:#475569;">Fecha Programada:</label>
                            <input type="date" id="swal-wa-prog-fecha" class="swal2-input" value="${fechaDefecto}" style="margin:3px 0 0 0; width:100%; height:36px; font-size:0.85rem;">
                        </div>
                        <div>
                            <label style="font-weight:700; font-size:0.78rem; color:#475569;">Horario (avisa en Pizarra):</label>
                            <div style="display:flex; gap:5px; align-items:center; margin-top:3px;">
                                <input type="time" id="swal-wa-prog-hora" class="swal2-input" value="09:00" style="margin:0; flex:1; height:36px; font-size:0.85rem;">
                                <button type="button" onclick="document.getElementById('swal-wa-prog-hora').value='09:00'" style="padding:4px 7px; border:1px solid #cbd5e1; border-radius:4px; background:#f8fafc; font-size:0.72rem; cursor:pointer; font-weight:700;">09:00</button>
                                <button type="button" onclick="document.getElementById('swal-wa-prog-hora').value='11:00'" style="padding:4px 7px; border:1px solid #cbd5e1; border-radius:4px; background:#f8fafc; font-size:0.72rem; cursor:pointer; font-weight:700;">11:00</button>
                                <button type="button" onclick="document.getElementById('swal-wa-prog-hora').value='15:00'" style="padding:4px 7px; border:1px solid #cbd5e1; border-radius:4px; background:#f8fafc; font-size:0.72rem; cursor:pointer; font-weight:700;">15:00</button>
                            </div>
                        </div>
                    </div>

                    <label style="font-weight:700; display:block; margin-bottom:3px;">2. Nota interna / Motivo de seguimiento:</label>
                    <input type="text" id="swal-wa-prog-nota" class="swal2-input" value="${escaparHtml(notaDefecto)}" placeholder="Ej: Enviar propuesta Nota de Crédito + Refacturación MPX5..." style="margin:0 0 10px 0; width:100%; height:35px; font-size:0.82rem;">

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
                        <label style="font-weight:700; margin:0;">3. Mensajitos a enviar en secuencia (Burbujas):</label>
                        <div style="display:flex; gap:5px; flex-wrap:wrap;">
                            <button type="button" id="btn-swal-wa-test-self" onclick="window._probarPartesSwalWa()" style="background:#eff6ff; border:1px solid #93c5fd; color:#1d4ed8; font-size:0.74rem; font-weight:800; padding:4px 9px; border-radius:6px; cursor:pointer;" title="Envía una prueba ahora mismo a tu propio WhatsApp (221 661 5746)">
                                🧪 Enviar Prueba (221 661 5746)
                            </button>
                            <button type="button" onclick="window._dividirPartesSwalWa()" style="background:#f8fafc; border:1px solid #cbd5e1; color:#334155; font-size:0.74rem; font-weight:700; padding:4px 8px; border-radius:6px; cursor:pointer;">
                                ✂️ Dividir en partes
                            </button>
                            <button type="button" onclick="window._agregarParteSwalWa()" style="background:#f0fdf4; border:1px solid #86efac; color:#166534; font-size:0.74rem; font-weight:800; padding:4px 8px; border-radius:6px; cursor:pointer;">
                                ➕ Agregar parte
                            </button>
                        </div>
                    </div>
                    <div id="swal-wa-prog-partes-box" style="max-height:250px; overflow-y:auto; padding-right:3px;"></div>
                </div>
            `,
            didOpen: () => {
                window._renderPartesSwalWa(partesIniciales);
            },
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '📅 Dejar Programado',
            confirmButtonColor: '#0284c7',
            denyButtonText: '🗂️ Abrir en Programador Completo',
            denyButtonColor: '#475569',
            cancelButtonText: 'Volver al chat',
            preConfirm: () => {
                const fecha = document.getElementById('swal-wa-prog-fecha').value;
                const hora = document.getElementById('swal-wa-prog-hora').value || '09:00';
                const nota = document.getElementById('swal-wa-prog-nota').value.trim();
                const msgs = window._leerPartesSwalWa();
                if (!fecha) {
                    Swal.showValidationMessage('Seleccioná una fecha de envío.');
                    return false;
                }
                if (msgs.length === 0) {
                    Swal.showValidationMessage('Debe haber al menos un mensaje para programar.');
                    return false;
                }
                return { modo: 'GUARDAR', fecha, hora, nota, msgs, msg: msgs.join('\n\n') };
            },
            preDeny: () => {
                const fecha = document.getElementById('swal-wa-prog-fecha').value;
                const hora = document.getElementById('swal-wa-prog-hora').value || '09:00';
                const nota = document.getElementById('swal-wa-prog-nota').value.trim();
                const msgs = window._leerPartesSwalWa();
                return { modo: 'ABRIR_COMPLETO', fecha, hora, nota, msgs, msg: msgs.join('\n\n') };
            }
        });

        if (result.isDenied && result.value) {
            const { fecha, hora, nota, msgs } = result.value;
            await window.abrirEnProgramadorCompletoWa(chat, cli, msgs, nota, fecha, hora);
            return;
        }

        if (!result.isConfirmed || !result.value) return;

        const { fecha, hora, nota, msgs, msg } = result.value;
        try {
            const res = await fetch('/api/crm/seguimientos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bunker_cliente_id: chat.bunker_cliente_id ? parseInt(chat.bunker_cliente_id) : (cli.id ? parseInt(cli.id) : null),
                    cliente_nombre: clienteNombre,
                    contacto_nombre: contactoNombre,
                    telefono_destino: telefono,
                    fecha_programada: fecha,
                    hora_programada: hora,
                    mensajes: msgs,
                    nota_interna: nota
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'No se pudo guardar la programación');
            }

            // Conservar también sincronizado el borrador o avisar que ya quedó reservado en Seguimientos WA
            window.guardarBorradorChatWa(chatPk, msg);
            await seleccionarChatConsola(chatPk, false);
            if (typeof window.actualizarAlertasPizarra === 'function') window.actualizarAlertasPizarra();
            if (typeof window.actualizarBadgeProgramados === 'function') window.actualizarBadgeProgramados();

            Swal.fire({
                icon: 'success',
                title: '¡Mensaje Reservado y Programado!',
                html: `Quedó agendado en <strong>Seguimientos WhatsApp</strong> para el <strong>${fecha} a las ${hora} hs</strong>.<br><span style="font-size:0.82rem; color:#475569;">Lo ves acá mismo a la derecha en <em>📅 Seguimientos WA</em> y te avisará en la Pizarra ese día.</span>`,
                timer: 3200,
                showConfirmButton: false
            });
        } catch (err) {
            Swal.fire('Error', err.message || 'No se pudo programar el seguimiento', 'error');
        }
    };

    /**
     * Abre el modal nativo #modal-programar-whatsapp (Programador & Monitor WhatsApp)
     * inyectándole el cliente actual, fecha, hora, nota y la burbuja con el texto preparado.
     */
    window.abrirEnProgramadorCompletoWa = async function (chat, cli, texto, nota, fecha, hora) {
        if (typeof window.abrirModalProgramarWhatsApp !== 'function') return;
        window.cerrarConsolaWhatsappLamda();
        await window.abrirModalProgramarWhatsApp(null, 'nuevo');

        const bunkerId = chat?.bunker_cliente_id || cli?.id;
        if (bunkerId) {
            const selectCli = document.getElementById('crm-cliente-select');
            if (selectCli) {
                selectCli.value = String(bunkerId);
                if (typeof window.onCrmClienteSeleccionado === 'function') {
                    await window.onCrmClienteSeleccionado();
                }
            }
        }
        const telInput = document.getElementById('crm-telefono-input');
        const nomInput = document.getElementById('crm-contacto-nombre-input');
        const fechaInput = document.getElementById('crm-fecha-input');
        const horaInput = document.getElementById('crm-hora-input');
        const notaInput = document.getElementById('crm-nota-input');
        const bubblesContainer = document.getElementById('crm-bubbles-container');

        if (telInput && chat?.telefono_normalizado) telInput.value = chat.telefono_normalizado;
        if (nomInput && (chat?.contacto_nombre || cli?.cliente_nombre)) nomInput.value = chat.contacto_nombre || cli.cliente_nombre;
        if (fechaInput && fecha) fechaInput.value = fecha;
        if (horaInput && hora) horaInput.value = hora;
        if (notaInput && nota) notaInput.value = nota;
        if (bubblesContainer && texto) {
            bubblesContainer.innerHTML = '';
            const listaBurbujas = Array.isArray(texto)
                ? texto
                : (typeof window.dividirTextoEnMensajitos === 'function' ? window.dividirTextoEnMensajitos(texto) : [texto]);
            if (typeof window.agregarBurbujaMensaje === 'function') {
                listaBurbujas.forEach(b => window.agregarBurbujaMensaje(b));
            }
        }
    };

    window.abrirMonitorCompletoSeguimientosWa = async function () {
        if (typeof window.abrirModalProgramarWhatsApp === 'function') {
            window.cerrarConsolaWhatsappLamda();
            await window.abrirModalProgramarWhatsApp(null, 'monitor');
        }
    };

    window.editarSeguimientoEnModuloCompletoWa = async function (seguimientoId) {
        if (typeof window.abrirModalProgramarWhatsApp === 'function') {
            window.cerrarConsolaWhatsappLamda();
            await window.abrirModalProgramarWhatsApp(seguimientoId, 'nuevo');
        }
    };

    window.cargarSeguimientoAlChatWa = function (chatPk, seguimientoId) {
        const segs = estadoConsola.rayosXActivo?.seguimientos || [];
        const item = segs.find(s => Number(s.id) === Number(seguimientoId));
        if (!item) return;
        let msgs = item.mensajes;
        if (typeof msgs === 'string') {
            try { msgs = JSON.parse(msgs); } catch (e) { msgs = [msgs]; }
        }
        if (!Array.isArray(msgs)) msgs = [msgs];
        const texto = msgs.join('\n\n').trim();
        const inp = document.getElementById('wa-hub-input-texto');
        if (inp) {
            inp.value = texto;
            inp.rows = 5;
            inp.focus();
            window.guardarBorradorChatWa(chatPk, texto);
        }
    };

    window.enviarSeguimientoDesdeConsolaWa = async function (seguimientoId, chatPk) {
        if (typeof window.enviarSeguimientoWhatsApp === 'function') {
            await window.enviarSeguimientoWhatsApp(seguimientoId);
            await seleccionarChatConsola(chatPk, true);
            await cargarListaChatsConsola(true);
        }
    };

    /**
     * Guarda etiqueta CRM o nota rápida del chat
     */
    window.guardarEtiquetaNotaChatWa = async function (chatPk, etiqueta, nota) {
        const payload = {};
        if (etiqueta !== null && etiqueta !== undefined) payload.etiqueta_crm = etiqueta;
        if (nota !== null && nota !== undefined) payload.nota_rapida = nota;

        try {
            await fetch(`/api/crm/whatsapp/chats/${chatPk}/config`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            await cargarListaChatsConsola(true);
        } catch (err) {
            console.error('Error guardando etiqueta/nota CRM:', err);
        }
    };

    /**
     * Modal para vincular un número de WhatsApp a un Cliente de Búnker (o cambiar vinculación)
     */
    window.vincularChatConClienteBunkerModal = async function (chatPk) {
        if (typeof Swal === 'undefined') return;
        try {
            const res = await fetch('/api/crm/clientes');
            const data = await res.json();
            const clientes = data.data || [];

            const optionsObj = { 'DESVINCULAR': '❌ Desvincular (Marcar como NO cliente)' };
            clientes.forEach(c => {
                const label = `${c.cliente_nombre || c.razon_social} ${c.codigo_bunker_cliente ? `(Cód. ${c.codigo_bunker_cliente})` : ''}`;
                optionsObj[c.id] = label;
            });

            const { value: seleccion } = await Swal.fire({
                title: '🔗 Vincular Chat con Cliente Búnker',
                input: 'select',
                inputOptions: optionsObj,
                inputPlaceholder: 'Seleccioná el cliente...',
                showCancelButton: true,
                confirmButtonColor: '#128c7e',
                confirmButtonText: 'Guardar vinculación',
                cancelButtonText: 'Cancelar'
            });

            if (!seleccion) return;

            const payload = seleccion === 'DESVINCULAR'
                ? { desvincular_cliente: true }
                : { bunker_cliente_id: parseInt(seleccion) };

            const resPatch = await fetch(`/api/crm/whatsapp/chats/${chatPk}/config`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const dataPatch = await resPatch.json();
            if (dataPatch.success) {
                await cargarListaChatsConsola();
                await seleccionarChatConsola(chatPk, false);
                if (typeof window.actualizarAlertasPizarra === 'function') window.actualizarAlertasPizarra();
            }
        } catch (err) {
            console.error('Error vinculando cliente:', err);
        }
    };

    /**
     * Permite elegir cualquier cliente de Búnker e iniciar/abrir su chat en la Consola
     */
    window.iniciarNuevoChatClienteBunker = async function () {
        if (typeof Swal === 'undefined') return;
        try {
            const res = await fetch('/api/crm/clientes');
            const data = await res.json();
            const clientes = data.data || [];

            const optionsObj = {};
            const mapaClientes = new Map();
            clientes.forEach(c => {
                mapaClientes.set(String(c.id), c);
                const partLeg = c.lomas_soft_id ? `Nº ${c.lomas_soft_id}` : '';
                const partBnk = c.codigo_bunker_cliente ? `#${c.codigo_bunker_cliente}` : '';
                const codigos = [partLeg, partBnk].filter(Boolean).join(' · ');
                optionsObj[c.id] = `${c.cliente_nombre || c.razon_social}${codigos ? ` (${codigos})` : ''}`;
            });

            const { value: cliId } = await Swal.fire({
                title: '➕ Abrir Chat con Cliente Búnker',
                input: 'select',
                inputOptions: optionsObj,
                inputPlaceholder: 'Elegí un cliente de Búnker...',
                showCancelButton: true,
                confirmButtonColor: '#128c7e',
                confirmButtonText: 'Siguiente'
            });

            if (!cliId) return;
            const cli = mapaClientes.get(String(cliId));
            let telefono = '';
            let contactoNombre = cli.cliente_nombre || 'Cliente';
            let contactoCargo = '';

            if (cli.whatsapp_facturas) {
                try {
                    const parsed = typeof cli.whatsapp_facturas === 'string' ? JSON.parse(cli.whatsapp_facturas) : cli.whatsapp_facturas;
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        if (parsed.length > 1) {
                            const contactOptions = {};
                            parsed.forEach((ct, idx) => {
                                contactOptions[String(idx)] = `👤 ${ct.nombre || 'Contacto'}${ct.cargo ? ` (${ct.cargo})` : ''} · 📱 ${ct.numero || ''}`;
                            });
                            const { value: idxElegido } = await Swal.fire({
                                title: `Elegir contacto de ${cli.cliente_nombre}`,
                                input: 'select',
                                inputOptions: contactOptions,
                                showCancelButton: true,
                                confirmButtonColor: '#128c7e',
                                confirmButtonText: 'Abrir Chat'
                            });
                            if (idxElegido === undefined || idxElegido === null) return;
                            const elegido = parsed[Number(idxElegido)] || parsed[0];
                            telefono = elegido.numero || '';
                            contactoNombre = elegido.nombre || contactoNombre;
                            contactoCargo = elegido.cargo || '';
                        } else {
                            const def = parsed.find(x => x.default) || parsed[0];
                            telefono = def.numero || '';
                            contactoNombre = def.nombre || contactoNombre;
                            contactoCargo = def.cargo || '';
                        }
                    }
                } catch (e) {}
            }

            if (!telefono) {
                const { value: telManual } = await Swal.fire({
                    title: `Teléfono de ${cli.cliente_nombre}`,
                    input: 'text',
                    inputLabel: 'Ingresá el número de WhatsApp (ej: 549221...):',
                    showCancelButton: true
                });
                if (!telManual) return;
                telefono = telManual;
            }

            const resInit = await fetch('/api/crm/whatsapp/iniciar-chat-cliente', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bunker_cliente_id: parseInt(cliId),
                    telefono,
                    contacto_nombre: contactoNombre,
                    contacto_cargo: contactoCargo
                })
            });
            const dataInit = await resInit.json();
            if (dataInit.success && dataInit.data) {
                estadoConsola.filtroActivo = 'CLIENTES';
                await cargarListaChatsConsola();
                await seleccionarChatConsola(dataInit.data.id, true);
            }
        } catch (err) {
            console.error('Error iniciando chat con cliente:', err);
        }
    };

    /**
     * Sincroniza bajo demanda las conversaciones recientes desde WhatsApp Web (puerto 3004)
     */
    window.sincronizarChatsWhatsappLamda = async function () {
        const btn = document.getElementById('btn-wa-hub-sync');
        const textoOriginal = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Sincronizando con WhatsApp...';
        }

        try {
            const res = await fetch('/api/crm/whatsapp/sincronizar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ maxChats: 45, mensajesPorChat: 15 })
            });
            const data = await res.json();
            await cargarListaChatsConsola();
            if (estadoConsola.chatActivoId) {
                await seleccionarChatConsola(estadoConsola.chatActivoId, true);
            }
            if (typeof window.actualizarAlertasPizarra === 'function') {
                window.actualizarAlertasPizarra();
            }

            if (typeof Swal !== 'undefined') {
                const syncInfo = data.sync || {};
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: syncInfo.success ? 'success' : 'info',
                    title: syncInfo.success
                        ? `Sincronizados ${syncInfo.chatsProcesados || 0} chats (${syncInfo.clientesDetectados || 0} clientes Búnker)`
                        : `Cruce local completado (${data.rematch?.vinculados || 0} vinculados). WhatsApp Web: ${syncInfo.message || 'verificar conexión'}`,
                    timer: 3500,
                    showConfirmButton: false
                });
            }
        } catch (err) {
            console.error('Error sincronizando chats:', err);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = textoOriginal;
            }
        }
    };

    /**
     * GESTIÓN SIMPLE SOBRE COMPROBANTE (Cualquier Cliente / Cualquier Factura)
     * 1. Tildar el/los ítem(s) de la factura a acreditar -> Enviar Nota de Crédito (BORRADOR) a Bandeja de Facturas.
     * 2. Armar Nueva Factura o Presupuesto -> Abre el armador estándar con el Buscador Universal de Artículos.
     * 3. (Opcional) Preparar o programar mensaje de aviso por WhatsApp.
     */
    window.iniciarSecuenciaGestionComprobanteWa = async function (chatPk, facturaId) {
        const rayosX = estadoConsola.rayosXActivo || (estadoConsola.detalleActivo && estadoConsola.detalleActivo.rayos_x) || {};
        const facturas = rayosX.ultimas_facturas || [];
        const fac = facturas.find(f => Number(f.id) === Number(facturaId));
        if (!fac || typeof Swal === 'undefined') {
            console.warn('No se encontró la factura en memoria o SweetAlert2 no está disponible:', facturaId);
            return;
        }

        const cli = rayosX.cliente || {};
        const chatDatos = estadoConsola.chatActivoDatos || (estadoConsola.detalleActivo && estadoConsola.detalleActivo.chat) || {};
        const nombreCorto = (chatDatos.contacto_nombre || cli.cliente_nombre || 'Cliente').split(/[-–(]/)[0].trim();
        const lomasClienteId = fac.cliente_id || cli.lomas_soft_id || cli.id || '';
        const tipoLetra = Number(fac.tipo_cbte) === 1 ? 'Factura A' : (Number(fac.tipo_cbte) === 6 ? 'Factura B' : 'Factura C');
        const tipoNcLetra = Number(fac.tipo_cbte) === 1 ? 'Nota de Crédito A' : (Number(fac.tipo_cbte) === 6 ? 'Nota de Crédito B' : 'Nota de Crédito C');
        const nroComp = `${String(fac.pto_vta || 32).padStart(4, '0')}-${String(fac.cbte_nro || 0).padStart(8, '0')}`;
        const fechaRaw = fac.fecha_emision || fac.emitida_en;
        const fechaTxt = fechaRaw ? new Date(fechaRaw).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
        const items = Array.isArray(fac.items) ? fac.items : [];
        const ncsAsociadas = Array.isArray(fac.ncs_asociadas) ? fac.ncs_asociadas : [];
        const fmt = (n) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Recalcular en vivo el total de la Nota de Crédito según ítems y cantidades tildadas
        window.recalcularTotalNcSimpleModal = function () {
            const box = document.getElementById('swal-nc-simple-total');
            if (!box) return;
            const chks = Array.from(document.querySelectorAll('.swal-chk-item-nc:checked'));
            if (chks.length === 0) {
                box.innerHTML = `<span style="color:#b91c1c; font-weight:700;">⚠️ Tildá al menos un ítem para la Nota de Crédito.</span>`;
                return;
            }
            let neto = 0, iva = 0;
            chks.forEach(c => {
                const idx = Number(c.getAttribute('data-idx'));
                const it = items[idx];
                if (!it) return;
                const inpCant = document.querySelector(`.swal-inp-cant-nc[data-idx="${idx}"]`);
                const qty = inpCant ? Math.max(0.01, parseFloat(inpCant.value) || Number(it.qty || 1)) : Number(it.qty || 1);
                const pNeto = Number(it.p_unit || 0);
                const ivaPct = Number(fac.tipo_cbte) === 11 ? 0 : Number(it.iva_pct || 21);
                const subNeto = +(qty * pNeto).toFixed(2);
                const subIva = +(subNeto * (ivaPct / 100)).toFixed(2);
                neto += subNeto;
                iva += subIva;
            });
            const total = +(neto + iva).toFixed(2);
            box.innerHTML = `Total ${tipoNcLetra}: <strong style="color:#dc2626; font-size:0.95rem;">-$${fmt(total)} final</strong> <span style="color:#64748b; font-size:0.78rem;">($${fmt(neto)} neto + $${fmt(iva)} IVA)</span>`;
        };

        const filasItemsHtml = items.map((it, idx) => {
            const pNeto = Number(it.p_unit || 0);
            const ivaPct = Number(it.iva_pct || 21);
            const pFinalFacturado = +(pNeto * (1 + ivaPct / 100)).toFixed(2);
            const pBunkerNeto = it.precio_bunker_neto !== null && it.precio_bunker_neto !== undefined ? Number(it.precio_bunker_neto) : pNeto;
            const pBunkerFinal = +(pBunkerNeto * (1 + ivaPct / 100)).toFixed(2);
            const preCheck = (it.coincide_alguna_lista === false && Math.abs(pBunkerNeto - pNeto) > 5) || items.length === 1;
            const qtyOrig = Number(it.qty || 1);

            return `
                <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 12px; border:1px solid #cbd5e1; background:#ffffff; border-radius:8px; margin-bottom:6px; cursor:pointer; font-size:0.84rem;">
                    <div style="display:flex; align-items:center; gap:9px; flex:1;">
                        <input type="checkbox" class="swal-chk-item-nc" data-idx="${idx}" ${preCheck ? 'checked' : ''} onchange="if(window.recalcularTotalNcSimpleModal) window.recalcularTotalNcSimpleModal();" style="width:17px; height:17px; cursor:pointer;">
                        <div>
                            <div style="font-weight:800; color:#0f172a;">${escaparHtml(it.descripcion || it.articulo_id)} <span style="color:#64748b; font-weight:600;">(${escaparHtml(it.articulo_id)})</span></div>
                            <div style="font-size:0.76rem; color:#475569; margin-top:2px;">
                                Facturado: <strong>$${fmt(pNeto)} + IVA</strong> ($${fmt(pFinalFacturado)} final)
                                ${Math.abs(pBunkerNeto - pNeto) > 1 ? ` · <span style="color:#0369a1; font-weight:700;">Lista actual: $${fmt(pBunkerNeto)} + IVA ($${fmt(pBunkerFinal)} final)</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:5px;" onclick="event.stopPropagation();">
                        <span style="font-size:0.76rem; color:#475569; font-weight:700;">Cant:</span>
                        <input type="number" step="any" min="0.01" max="${qtyOrig}" class="swal-inp-cant-nc" data-idx="${idx}" value="${qtyOrig}" oninput="if(window.recalcularTotalNcSimpleModal) window.recalcularTotalNcSimpleModal();" style="width:62px; padding:4px 6px; border:1px solid #94a3b8; border-radius:6px; font-weight:800; text-align:center; font-size:0.84rem;">
                    </div>
                </label>
            `;
        }).join('');

        const recolectarSeleccionados = () => {
            const chks = Array.from(document.querySelectorAll('.swal-chk-item-nc:checked'));
            return chks.map(c => {
                const idx = Number(c.getAttribute('data-idx'));
                const it = items[idx];
                if (!it) return null;
                const inpCant = document.querySelector(`.swal-inp-cant-nc[data-idx="${idx}"]`);
                const qtyElegida = inpCant ? Math.max(0.01, parseFloat(inpCant.value) || Number(it.qty || 1)) : Number(it.qty || 1);
                return {
                    ...it,
                    qty_elegida: qtyElegida
                };
            }).filter(Boolean);
        };

        // Cambiar entre Etapa 1 (Notificar al Cliente) y Etapa 2 (Ejecutar NC / Nueva Factura)
        window.cambiarEtapaModalGestionWa = function (etapa) {
            const p1 = document.getElementById('swal-panel-etapa-1');
            const p2 = document.getElementById('swal-panel-etapa-2');
            const t1 = document.getElementById('swal-tab-etapa-1');
            const t2 = document.getElementById('swal-tab-etapa-2');
            if (!p1 || !p2 || !t1 || !t2) return;
            if (Number(etapa) === 1) {
                p1.style.display = 'block';
                p2.style.display = 'none';
                t1.style.background = '#0f766e';
                t1.style.color = '#ffffff';
                t1.style.borderColor = '#0f766e';
                t2.style.background = '#f1f5f9';
                t2.style.color = '#475569';
                t2.style.borderColor = '#cbd5e1';
            } else {
                p1.style.display = 'none';
                p2.style.display = 'block';
                t2.style.background = '#1d4ed8';
                t2.style.color = '#ffffff';
                t2.style.borderColor = '#1d4ed8';
                t1.style.background = '#f1f5f9';
                t1.style.color = '#475569';
                t1.style.borderColor = '#cbd5e1';
            }
        };

        // Acción Etapa 2.1: Enviar SOLO la Nota de Crédito (BORRADOR) a la Bandeja de Facturas ARCA
        window.enviarNotaCreditoBandejaDesdeWa = async function () {
            const seleccionados = recolectarSeleccionados();
            if (seleccionados.length === 0) {
                alert('Tildá al menos un ítem de la factura para generar la Nota de Crédito.');
                return;
            }
            const moverStockEl = document.getElementById('swal-chk-stock-nc-wa');
            const moverStock = moverStockEl ? moverStockEl.checked : true;

            const btnNc = document.getElementById('btn-swal-enviar-nc-wa');
            const txtOrig = btnNc ? btnNc.innerHTML : '';
            if (btnNc) {
                btnNc.disabled = true;
                btnNc.innerHTML = '⏳ Enviando Nota de Crédito a Bandeja...';
            }

            try {
                const borradoresPrevios = ncsAsociadas.filter(n => n.estado === 'BORRADOR');
                if (borradoresPrevios.length > 0) {
                    const reemplazar = confirm(`Ya existe un Borrador de Nota de Crédito (#${borradoresPrevios[0].id}) para esta factura.\n\n¿Querés reemplazarlo con los ítems seleccionados ahora?`);
                    if (!reemplazar) {
                        if (btnNc) { btnNc.disabled = false; btnNc.innerHTML = txtOrig; }
                        return;
                    }
                    for (const bPrev of borradoresPrevios) {
                        try {
                            await fetch(`http://localhost:3004/facturacion/facturas/${bPrev.id}`, { method: 'DELETE' });
                        } catch (eDel) {
                            console.warn('No se pudo eliminar borrador previo:', eDel);
                        }
                    }
                }

                const mapAlicId = (it) => {
                    if (Number(fac.tipo_cbte) === 11) return 3;
                    const pct = Number(it.iva_pct || 21);
                    if (Math.abs(pct - 10.5) < 0.5) return 2;
                    if (pct === 0) return 3;
                    return 1;
                };

                const origTipo = Number(fac.tipo_cbte) || 1;
                const tipoNc = origTipo === 1 ? 3 : (origTipo === 6 ? 8 : 13);

                const payload3004 = {
                    tipo_cbte: tipoNc,
                    pto_vta: Number(fac.pto_vta) || 32,
                    concepto: 1,
                    es_nota_credito: true,
                    factura_asociada_id: Number(fac.id),
                    precio_modo: 'NETO',
                    mover_stock: Boolean(moverStock),
                    stock_descontado: !moverStock,
                    cliente: {
                        cliente_id: Number(lomasClienteId || fac.cliente_id || 0),
                        razon_social: cli.razon_social || cli.cliente_nombre || nombreCorto || 'Cliente'
                    },
                    items: seleccionados.map(it => ({
                        articulo_id: it.articulo_id,
                        descripcion: it.descripcion || it.articulo_id,
                        qty: Number(it.qty_elegida || it.qty || 1),
                        p_unit: Number(it.p_unit || 0),
                        alic_iva_id: mapAlicId(it)
                    }))
                };

                const res3004 = await fetch('http://localhost:3004/facturacion/facturas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload3004)
                });
                const data3004 = await res3004.json();
                if (!res3004.ok || !data3004.success) {
                    throw new Error(data3004.message || data3004.error || 'Error al crear el borrador de Nota de Crédito');
                }

                const ncCreada = data3004.data || {};
                const hoyStr = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
                const nuevaHuella = `[${hoyStr} ✅ NC EN BANDEJA ARCA] ${tipoLetra} ${nroComp}: Borrador ${tipoNcLetra} #${ncCreada.id} (-$${fmt(ncCreada.imp_total)}) listo para emitir CAE.`;
                const lineasPrevias = (chatDatos.nota_rapida || '').split('\n').map(l => l.trim()).filter(l => l && !l.includes(nroComp));
                await window.guardarEtiquetaNotaChatWa(chatPk, 'RECLAMO', [nuevaHuella, ...lineasPrevias].join('\n'));

                await seleccionarChatConsola(chatPk, false);
                await cargarListaChatsConsola(true);

                const precargarParam = seleccionados.map(it => `${encodeURIComponent(it.articulo_id || '')}:${Number(it.qty_elegida || it.qty || 1)}`).join(',');
                const urlArmador = `http://localhost:3003/pages/crear-presupuesto.html?modo=factura_directa&cliente=${encodeURIComponent(lomasClienteId)}&precargar=${precargarParam}&factura_origen=${fac.id}`;

                const rNext = await Swal.fire({
                    icon: 'success',
                    title: `✅ ${tipoNcLetra} enviada a Bandeja de Facturas`,
                    width: 600,
                    html: `
                        <div style="text-align:left; font-size:0.88rem; color:#1e293b;">
                            <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:10px 12px; margin-bottom:12px;">
                                <div style="font-weight:800; color:#991b1b;">🧾 Borrador #${ncCreada.id} — ${tipoNcLetra} (Asoc. a ${tipoLetra} ${nroComp})</div>
                                <div style="font-size:0.9rem; color:#dc2626; font-weight:800; margin-top:4px;">Total a acreditar: -$${fmt(ncCreada.imp_total)}</div>
                            </div>
                            <p style="margin:0; color:#334155;">¿Querés armar ahora la <strong>Nueva Factura / Presupuesto</strong> con el buscador de artículos o ir directo a la Bandeja de Facturas?</p>
                        </div>
                    `,
                    showCancelButton: true,
                    showDenyButton: true,
                    confirmButtonText: '🛒 Armar Nueva Factura / Presupuesto ↗',
                    confirmButtonColor: '#16a34a',
                    denyButtonText: '🏛️ Ver Bandeja de Facturas ↗',
                    denyButtonColor: '#0284c7',
                    cancelButtonText: 'Cerrar'
                });

                if (rNext.isConfirmed) {
                    window.open(urlArmador, '_blank');
                } else if (rNext.isDenied) {
                    window.open('http://localhost:3004/pages/facturas.html', '_blank');
                }
            } catch (err) {
                console.error('Error creando Nota de Crédito:', err);
                alert('Error: ' + err.message);
                if (btnNc) {
                    btnNc.disabled = false;
                    btnNc.innerHTML = txtOrig;
                }
            }
        };

        // Acción Etapa 2.2: Abrir el Armador Estándar (Con Buscador de Artículos, Cliente precargado y opción de Factura Directa o Presupuesto)
        window.abrirArmadorNuevaFacturaDesdeWa = function () {
            const seleccionados = recolectarSeleccionados();
            const precargarParam = seleccionados.map(it => `${encodeURIComponent(it.articulo_id || '')}:${Number(it.qty_elegida || it.qty || 1)}`).join(',');
            const urlArmador = `http://localhost:3003/pages/crear-presupuesto.html?modo=factura_directa&cliente=${encodeURIComponent(lomasClienteId)}&precargar=${precargarParam}&factura_origen=${fac.id}`;
            window.open(urlArmador, '_blank');
        };

        // Acción Etapa 1: Redactar Propuesta según Tipo de Gestión Estándar + Condición, dejar Huella CRM y Volcar al Chat o Programar
        window.prepararAvisoWhatsAppDesdeModal = async function (programar = false) {
            const seleccionados = recolectarSeleccionados();
            if (seleccionados.length === 0) {
                alert('Tildá al menos un ítem del comprobante para armar el mensaje.');
                return;
            }
            const tipoGestion = document.getElementById('swal-tipo-gestion-wa')?.value || 'ERROR_PRECIO_NC';
            const condicion = (document.getElementById('swal-condicion-gestion-wa')?.value || 'dejar la diferencia como saldo a cubrir sin apuro').trim();

            let resumenHuellaItems = '';
            const lineas = seleccionados.map(it => {
                const cant = Number(it.qty_elegida || it.qty || 1);
                const pFactNeto = Number(it.p_unit || 0);
                const ivaPct = Number(it.iva_pct || 21);
                const pFactFinal = +(pFactNeto * (1 + ivaPct / 100)).toFixed(2);
                const pRealNeto = Number(it.precio_bunker_neto || pFactNeto);
                const pRealFinal = +(pRealNeto * (1 + ivaPct / 100)).toFixed(2);
                resumenHuellaItems += `${it.articulo_id} (Fact: $${fmt(pFactNeto)} neto -> Real: $${fmt(pRealNeto)} neto) `;
                return `• *${it.descripcion || it.articulo_id}* (${cant} u.): figura facturado a *$${fmt(pFactNeto)} + IVA* ($${fmt(pFactFinal)} final), cuando el valor correspondiente de la unidad es *$${fmt(pRealNeto)} + IVA* ($${fmt(pRealFinal)} final).`;
            });
            const detalleTxt = lineas.length > 0 ? ('\n' + lineas.join('\n') + '\n') : '';

            let msg = '';
            let tipoCortoHuella = 'Propuesta NC + Refacturación';
            if (tipoGestion === 'ERROR_PRECIO_NC') {
                msg = `Hola ${nombreCorto}, ¿cómo estás? Te escribo porque revisando la *${tipoLetra} N° ${nroComp}* (del ${fechaTxt}) detectamos un error involuntario de sistema en el precio de facturación:${detalleTxt}\nTe pido disculpas por la confusión. Si estás de acuerdo, nuestra propuesta para dejarlo prolijo es emitir una *Nota de Crédito* sobre ese comprobante y volver a facturar el artículo al valor que corresponde, pudiendo ${condicion}.\n\nConfirmame por favor cuando puedas si te parece bien así avanzamos con el ajuste administrativo. ¡Muchas gracias!`;
                tipoCortoHuella = 'Propuesta NC + Refacturación';
            } else if (tipoGestion === 'DIFERENCIA_CANTIDAD') {
                msg = `Hola ${nombreCorto}, ¿cómo estás? Te contacto por la *${tipoLetra} N° ${nroComp}* (del ${fechaTxt}) respecto a:${detalleTxt}\nQuedamos a tu disposición para coordinar el ajuste o reposición correspondiente (${condicion}). Avisame si estás de acuerdo. ¡Gracias!`;
                tipoCortoHuella = 'Ajuste / Reposición de Mercadería';
            } else {
                msg = `Hola ${nombreCorto}, ¿cómo estás? Te escribo por una consulta administrativa sobre la *${tipoLetra} N° ${nroComp}* (del ${fechaTxt}).${detalleTxt}\nQuedo atento a tus comentarios. ¡Muchas gracias!`;
                tipoCortoHuella = 'Aclaración Administrativa';
            }

            const hoyStr = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
            const nuevaHuella = `[${hoyStr} ⏳ ESPERANDO OK CLIENTE] ${tipoLetra} ${nroComp}: ${tipoCortoHuella} por ${resumenHuellaItems.trim()} (${condicion}).`;
            const lineasPrevias = (chatDatos.nota_rapida || '').split('\n').map(l => l.trim()).filter(l => l && !l.includes(nroComp));
            await window.guardarEtiquetaNotaChatWa(chatPk, 'RECLAMO', [nuevaHuella, ...lineasPrevias].join('\n'));

            window.guardarBorradorChatWa(chatPk, msg);
            Swal.close();
            await seleccionarChatConsola(chatPk, false);

            const inputMsg = document.getElementById('wa-hub-input-texto');
            if (inputMsg) {
                inputMsg.value = msg;
                inputMsg.rows = 6;
                inputMsg.focus();
            }
            if (programar) {
                await window.programarMensajeDesdeConsolaWa(chatPk, msg, nuevaHuella);
            }
        };

        // Verificar si esta factura ya tiene huella previa registrada en el chat
        const huellaFacturaActual = (chatDatos.nota_rapida || '')
            .split('\n')
            .map(l => l.trim())
            .find(l => l.includes(nroComp)) || '';

        const alertaHuellaPreviaHtml = huellaFacturaActual ? `
            <div style="background:#f0fdf4; border:1px solid #86efac; padding:8px 12px; border-radius:8px; margin-bottom:8px; font-size:0.78rem; color:#166534;">
                📌 <strong>Gestión registrada en esta factura:</strong><br>
                <span>${escaparHtml(huellaFacturaActual)}</span>
            </div>
        ` : '';

        const alertaNcsPreviasHtml = ncsAsociadas.length > 0 ? `
            <div style="background:#fef3c7; border:1px solid #f59e0b; padding:8px 12px; border-radius:8px; margin-bottom:10px; font-size:0.8rem; color:#92400e; display:flex; justify-content:space-between; align-items:center;">
                <span>ℹ️ <strong>NC ya vinculada:</strong> ${ncsAsociadas.map(nc => `${nc.estado === 'BORRADOR' ? `Borrador NC #${nc.id}` : `NC Emitida #${nc.cbte_nro || nc.id}`} (-$${fmt(nc.imp_total)})`).join(', ')}</span>
                <a href="http://localhost:3004/pages/facturas.html" target="_blank" style="color:#0369a1; font-weight:800; text-decoration:underline;">Ver en Bandeja ↗</a>
            </div>
        ` : '';

        await Swal.fire({
            title: `🛠️ Gestionar ${tipoLetra} ${nroComp}`,
            width: 680,
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: 'Cerrar',
            html: `
                <div style="text-align:left; font-size:0.85rem; color:#1e293b;">
                    <div style="background:#f1f5f9; padding:8px 12px; border-radius:8px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                        <span>👤 <strong>${escaparHtml(cli.cliente_nombre || nombreCorto)}</strong> ${lomasClienteId ? `<span style="color:#64748b;">(#${lomasClienteId})</span>` : ''}</span>
                        <span style="color:#475569; font-weight:700;">📅 ${fechaTxt}</span>
                    </div>

                    ${alertaHuellaPreviaHtml}
                    ${alertaNcsPreviasHtml}

                    <div style="font-weight:800; color:#334155; margin-bottom:5px;">
                        Ítem(s) de la factura a gestionar:
                    </div>
                    <div style="max-height:175px; overflow-y:auto; margin-bottom:10px;">
                        ${filasItemsHtml || '<div style="color:#64748b;">Sin ítems detallados.</div>'}
                    </div>

                    <!-- SELECTOR DE ETAPA (PASO 1 vs PASO 2) SIN PISARSE ENTRE SÍ -->
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
                        <button type="button" id="swal-tab-etapa-1" onclick="window.cambiarEtapaModalGestionWa(1)" style="padding:9px 10px; border-radius:8px; border:2px solid #0f766e; background:#0f766e; color:#ffffff; font-weight:800; font-size:0.82rem; cursor:pointer;">
                            💬 Paso 1: Notificar al Cliente
                        </button>
                        <button type="button" id="swal-tab-etapa-2" onclick="window.cambiarEtapaModalGestionWa(2)" style="padding:9px 10px; border-radius:8px; border:2px solid #cbd5e1; background:#f1f5f9; color:#475569; font-weight:800; font-size:0.82rem; cursor:pointer;">
                            🧾 Paso 2: Nota de Crédito / Nueva Factura
                        </button>
                    </div>

                    <!-- PANEL ETAPA 1: REDACCIÓN ASISTIDA Y NOTIFICACIÓN AL CLIENTE -->
                    <div id="swal-panel-etapa-1" style="background:#f0fdf4; border:1px solid #86efac; border-radius:10px; padding:12px;">
                        <label style="font-weight:800; color:#14532d; display:block; margin-bottom:4px; font-size:0.82rem;">
                            1. Elegí el Tipo de Problema / Gestión Estándar:
                        </label>
                        <select id="swal-tipo-gestion-wa" style="width:100%; padding:8px 10px; border:1px solid #86efac; border-radius:6px; font-size:0.84rem; font-weight:700; color:#0f172a; background:#ffffff; margin-bottom:10px;">
                            <option value="ERROR_PRECIO_NC">⚖️ 1. Error de Precio en Factura → Propuesta Nota de Crédito + Refacturación</option>
                            <option value="DIFERENCIA_CANTIDAD">📦 2. Diferencia / Faltante de Mercadería → Ajuste o Reposición</option>
                            <option value="ACLARACION_COMPROBANTE">💬 3. Aclaración Administrativa sobre Comprobante</option>
                        </select>

                        <label style="font-weight:800; color:#14532d; display:block; margin-bottom:4px; font-size:0.82rem;">
                            2. Condición propuesta para la diferencia / resolución:
                        </label>
                        <input id="swal-condicion-gestion-wa" type="text" value="dejar la diferencia como saldo a cubrir sin apuro" style="width:100%; padding:8px 10px; border:1px solid #86efac; border-radius:6px; font-size:0.83rem; background:#ffffff; margin-bottom:12px; box-sizing:border-box;">

                        <div style="display:flex; gap:8px;">
                            <button type="button" onclick="window.prepararAvisoWhatsAppDesdeModal(false)" style="flex:1; background:#0f766e; color:#ffffff; border:none; border-radius:8px; padding:10px 12px; font-size:0.86rem; font-weight:800; cursor:pointer;">
                                📝 Preparar Mensaje en Chat
                            </button>
                            <button type="button" onclick="window.prepararAvisoWhatsAppDesdeModal(true)" style="flex:1; background:#0284c7; color:#ffffff; border:none; border-radius:8px; padding:10px 12px; font-size:0.86rem; font-weight:800; cursor:pointer;">
                                📅 Programar Envío WA
                            </button>
                        </div>
                    </div>

                    <!-- PANEL ETAPA 2: CUANDO EL CLIENTE YA DIO EL OK (NC + NUEVA FACTURA) -->
                    <div id="swal-panel-etapa-2" style="display:none; background:#f8fafc; border:1px solid #93c5fd; border-radius:10px; padding:12px;">
                        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:9px 12px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                            <div id="swal-nc-simple-total"></div>
                            <label style="display:inline-flex; align-items:center; gap:5px; font-size:0.78rem; font-weight:700; color:#991b1b; cursor:pointer;">
                                <input type="checkbox" id="swal-chk-stock-nc-wa" checked style="cursor:pointer;">
                                <span>📦 Reingresar stock al emitir</span>
                            </label>
                        </div>

                        <div style="display:flex; flex-direction:column; gap:10px;">
                            <button type="button" id="btn-swal-enviar-nc-wa" onclick="window.enviarNotaCreditoBandejaDesdeWa()" style="width:100%; background:#dc2626; color:#ffffff; border:none; border-radius:8px; padding:11px 14px; font-size:0.9rem; font-weight:800; cursor:pointer; display:flex; justify-content:center; align-items:center; gap:8px; box-shadow:0 2px 4px rgba(220,38,38,0.25);">
                                🧾 1. Enviar Nota de Crédito a Bandeja de Facturas
                            </button>

                            <button type="button" onclick="window.abrirArmadorNuevaFacturaDesdeWa()" style="width:100%; background:#16a34a; color:#ffffff; border:none; border-radius:8px; padding:11px 14px; font-size:0.9rem; font-weight:800; cursor:pointer; display:flex; justify-content:center; align-items:center; gap:8px; box-shadow:0 2px 4px rgba(22,163,74,0.25);">
                                🛒 2. Armar Nueva Factura o Presupuesto (Con Buscador de Artículos) ↗
                            </button>
                        </div>
                    </div>
                </div>
            `,
            didOpen: () => {
                if (typeof window.recalcularTotalNcSimpleModal === 'function') {
                    window.recalcularTotalNcSimpleModal();
                }
            }
        });
    };

    // =========================================================================
    // 10. ASISTENTE DE POLÍTICAS, FINANCIACIÓN Y PAGOS PARCIALES (NO AUTOMÁTICO)
    // =========================================================================
    let contextoPoliticasWaActual = null;

    function formatearMonedaArs(valor, decimales = 2) {
        const num = Number(valor || 0);
        return num.toLocaleString('es-AR', {
            style: 'currency',
            currency: 'ARS',
            minimumFractionDigits: decimales,
            maximumFractionDigits: decimales
        });
    }

    function obtenerPrimerNombreSaludo(chat, cli) {
        const raw = String(chat?.contacto_nombre || cli?.cliente_nombre || '').trim();
        if (!raw) return '';
        if (raw.includes(',')) {
            const partes = raw.split(',');
            const postComa = (partes[1] || '').trim().split(/\s+/)[0] || '';
            if (postComa.length >= 2) {
                return postComa.charAt(0).toUpperCase() + postComa.slice(1).toLowerCase();
            }
        }
        const primeraPalabra = raw.split(/\s+/)[0].replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '');
        if (!primeraPalabra || /^(el|la|los|las|san|don|doña|sra|sr|dietetica|almacen|mercado|fiambreria)$/i.test(primeraPalabra)) {
            return raw;
        }
        return primeraPalabra.charAt(0).toUpperCase() + primeraPalabra.slice(1).toLowerCase();
    }

    function construirBurbujasPoliticasWa(ctx, config) {
        const nombreSaludo = ctx.nombreSaludo || 'cliente';
        const reglas = ctx.salvavidas?.reglas_aplicadas || {};
        const diasV1 = Number(reglas.dias_ventana_estandar || 7);
        const diasCortesia = Number(reglas.dias_ventana_cortesia || 7);
        const finV2 = diasV1 + diasCortesia;
        const tasaMensual = Number(reglas.tasa_servicio_financiero || 3).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        const tasaDiariaPct = Number((reglas.tasa_diaria || 0.001) * 100).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

        const listaId = ctx.politicaInfo?.lista_id || ctx.cli?.lista_asignada_id || null;
        const listaNombre = ctx.politicaInfo?.lista_nombre || reglas.lista_nombre || ctx.cli?.lista_asignada_nombre || 'Mayorista LAMDA';
        const pol = ctx.politicaInfo?.politica || null;
        const tramos = Array.isArray(pol?.tramos) && pol.tramos.length > 0 ? pol.tramos : [{ monto_minimo: 300000, descuento_porcentaje: 5 }];
        const tramoPrincipal = tramos[0];
        const montoMinimoDesc = formatearMonedaArs(tramoPrincipal.monto_minimo || 300000, 0);
        const pctDesc = Number(tramoPrincipal.descuento_porcentaje || 5).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
        const aplicaSobreTxt = String(pol?.aplica_sobre || 'NETO').toUpperCase() === 'NETO' ? 'neto antes de impuestos' : 'total';

        const saldoCapital = Number(ctx.salvavidas?.saldo_contable_real ?? ctx.cc?.saldo_actual ?? 0);
        const montoFin = Number(ctx.salvavidas?.financiacion_total_con_iva ?? 0);
        const saldoTotal = montoFin > 0 ? Number(ctx.salvavidas?.saldo_total_proyectado_con_iva || (saldoCapital + montoFin)) : saldoCapital;
        const saldoTxt = formatearMonedaArs(saldoTotal, 2);
        const saldoCapitalTxt = formatearMonedaArs(saldoCapital, 2);
        const financiacionTxt = formatearMonedaArs(montoFin, 2);
        const capas = Array.isArray(ctx.salvavidas?.capas_simuladas) && ctx.salvavidas.capas_simuladas.length > 0
            ? ctx.salvavidas.capas_simuladas
            : (Array.isArray(ctx.cc?.composicion?.capas) ? ctx.cc.composicion.capas : []);

        const burbujas = [];

        // Si se adjunta el PDF de Cuenta Corriente, toda la explicación gruesa (saldo, comprobantes, 4 etapas, pagos parciales, 5% OFF y CBU) va adentro del PDF.
        // El cuerpo del mensaje de WhatsApp se mantiene cortito: indica que se adjunta el PDF y deja el link del portal.
        if (config.chkPdf) {
            burbujas.push(
                `Te adjunto el resumen actualizado de tu cuenta corriente en PDF.\n` +
                `Portal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/\n` +
                `Cualquier duda avisame!`
            );
            return burbujas;
        }

        // --- BLOQUE 1: SALUDO + CONTEXTO + PAGOS PARCIALES / FINANCIACIÓN ---
        const partesB1 = [];
        if (config.escenario === 'EXTRACTO_CON_POLITICAS') {
            partesB1.push(`Hola *${nombreSaludo}*, ¿cómo estás? Te compartimos el resumen actualizado de tu cuenta corriente en *LAMDA* y te detallamos cómo funcionan nuestras opciones de pagos parciales y políticas comerciales para tu comodidad:`);
        } else if (config.escenario === 'VENTANA_CORTESIA') {
            partesB1.push(`Hola *${nombreSaludo}*, ¡quedate tranquilo/a! Te detallamos cómo funciona nuestro respaldo de plazos y pagos parciales en *LAMDA* para que puedas organizarte con total comodidad:`);
        } else if (config.escenario === 'POLITICA_LISTA') {
            partesB1.push(`Hola *${nombreSaludo}*, ¿cómo estás? Te pasamos en limpio el detalle de las políticas comerciales y beneficios asignados a tu *Lista de Precios* en *LAMDA*:`);
        } else {
            partesB1.push(`Hola *${nombreSaludo}*, ampliando el resumen de cuenta que te enviamos recién, te paso en limpio cómo funciona nuestro sistema de *pagos parciales*, financiación y beneficios de tu lista para que lo manejes con total tranquilidad:`);
        }

        const cupoComodines = Number(reglas.cupo_cortesias_anual ?? 3);
        const comodinesDisp = Number(reglas.cortesias_disponibles_anio ?? 3);
        const tasaDiariaNum = Number(reglas.tasa_diaria || 0.001);

        if (config.chkSaldo) {
            const lineasCapas = capas.map(c => {
                const desc = String(c.descripcion || c.tipo_comprobante || 'Comprobante').replace(/\s*\(CAE:[^)]*\)/i, '').trim();
                const cap = Number(c.monto_pendiente || c.capital_pendiente || 0);
                const mPend = formatearMonedaArs(cap, 2);
                const dias = Math.max(1, Number(c.antiguedad_dias || c.dias_transcurridos || 1));
                const finCapa = Number(c.interes_financiacion_con_iva || ((cap * tasaDiariaNum * dias) * 1.21));
                const estadoFinTxt = dias <= finV2 && comodinesDisp > 0
                    ? `Financiación (${dias}d): *100% Bonificado ($ 0)* cancelando hasta el día ${finV2}`
                    : `Financiación (${dias}d desde entrega): *+${formatearMonedaArs(finCapa, 2)}*`;
                return `  • ${desc}: *${mPend}* (${dias} días) — ${estadoFinTxt}`;
            }).join('\n');

            const lineaResumenTotal = montoFin > 0
                ? `• Saldo total actual: *${saldoTxt}* (C: ${saldoCapitalTxt} + F: ${financiacionTxt})`
                : `• Saldo total actual: *${saldoTxt}*`;

            partesB1.push(
                `📊 *Estado Actual de Cuenta Corriente y Reloj desde Entrega:*\n` +
                `${lineaResumenTotal}\n` +
                (lineasCapas ? `${lineasCapas}` : `• Cuenta al día sin comprobantes pendientes.`)
            );
        }

        if (config.chkFinanciacion) {
            partesB1.push(
                `🤝 *1. Pagos Parciales y Cuenta Habilitada:*\n` +
                `Podés ir realizando *pagos parciales* a tu ritmo según tu comodidad. Cada entrega que realizás se acredita automáticamente sobre el comprobante más antiguo, achicando de inmediato tu saldo pendiente y manteniendo tu *cuenta habilitada* para que sigas haciendo pedidos sin interrupciones.`
            );

            partesB1.push(
                `🛡️ *2. Cómo funciona el Reloj de Financiación, la Cortesía Excepcional y los Comodines:*\n` +
                `Desde el *Día 1 de entregada la mercadería*, el sistema registra el reloj de asistencia financiera (*${tasaMensual}% mensual / ${tasaDiariaPct}% diario* exacto por día), bajo estas 3 reglas:\n` +
                `• *🟢 Plazo Habitual (Días 1 a ${diasV1}):* Es la condición normal de trabajo. Abonando dentro de los primeros ${diasV1} días, el cargo de financiación desde el Día 1 queda *100% bonificado ($ 0,00 a pagar)*.\n` +
                `• *🎟️ Cortesía Excepcional hasta ${finV2} Días (${cupoComodines} Comodines al Año):* Extenderse entre el *Día ${diasV1 + 1} y el Día ${finV2}* es *excepcional (no es la regla habitual)*. Para imprevistos puntuales, tu cuenta dispone de *${cupoComodines} comodines de cortesía al año* (aprox. 1 por trimestre; hoy tenés *${comodinesDisp} de ${cupoComodines}* disponibles). Usando un comodín y cancelando hasta el *Día ${finV2}*, la financiación desde el Día 1 queda *100% bonificada ($ 0,00)*.\n` +
                `• *🟡 Servicio de Financiación Activa (Día ${finV2 + 1} en adelante):* Si necesitás superar los ${finV2} días (o si ya utilizaste los ${cupoComodines} comodines anuales de cortesía), hacés uso formal del Servicio de Financiación LAMDA y se computa el financiamiento corrido *desde el Día 1 de la entrega* (*${tasaDiariaPct}% diario*) únicamente sobre el saldo que vaya quedando pendiente tras cada pago parcial.`
            );
        }

        if (partesB1.length > 0) {
            burbujas.push(partesB1.join('\n\n'));
        }

        // --- BLOQUE 2: POLÍTICA DE SU LISTA DE PRECIOS + MEDIOS DE PAGO + OFERTAS ---
        const partesB2 = [];

        if (config.chkPoliticaLista) {
            let textoTramos = `• *Bonificación por Volumen (${pctDesc}% OFF):* Tu Lista de Precios cuenta con un *${pctDesc}% de descuento directo* en pedidos que superen los *${montoMinimoDesc}* (${aplicaSobreTxt}) sobre los artículos de lista regular.`;
            if (tramos.length > 1) {
                const detalleEscalas = tramos.map(t => `${Number(t.descuento_porcentaje)}% OFF desde ${formatearMonedaArs(t.monto_minimo, 0)}`).join(' | ');
                textoTramos = `• *Bonificación por Volumen:* Tu Lista de Precios cuenta con descuentos automáticos por tramo (${detalleEscalas}, sobre ${aplicaSobreTxt}).`;
            }

            partesB2.push(
                `🏷️ *Política Comercial de tu Lista de Precios:*\n` +
                `• Mientras utilices pagos parciales o el Servicio de Asistencia Financiera, tu cuenta sigue operando con normalidad con los precios mayoristas de tu *Lista de Precios*.\n` +
                `${textoTramos}\n` +
                `• *Condición de Cuenta al Día (Saldo $ 0,00):* Tanto la bonificación del *${pctDesc}% por volumen* como las *ofertas promocionales especiales* se activan automáticamente cuando la cuenta corriente se encuentra al día (*Saldo $ 0,00*). A medida que completes los pagos parciales y el saldo llegue a cero, el sistema vuelve a habilitar todas las bonificaciones de forma inmediata.`
            );
        }

        if (config.chkMediosPago) {
            partesB2.push(
                `💳 *Medios de Pago Habilitados para tus Entregas:*\n` +
                `• 🏦 *Transferencia Bancaria:* Banco Galicia | Alias: *LAMDA.SER.MARTIN* | CBU: *0070373230004007844141* (Cta: 4007844-1 373-4 - Martin Ignacio Serrano).\n` +
                `• 🏧 *Depósito en Efectivo 24 hs (Cajeros Galicia):* Podés depositar efectivo sin sobre en cualquier terminal autoservicio Galicia a la *Caja de Ahorro en Pesos N° 4007844-1 373-4*.\n` +
                `• ✉️ *Efectivo Ensobrado con Reparto:* Podés entregar efectivo al chofer o en depósito utilizando nuestro registro asistido de arqueo.`
            );
        }

        if (config.chkOfertas && Array.isArray(ctx.ofertasVigentes) && ctx.ofertasVigentes.length > 0) {
            const topOfertas = ctx.ofertasVigentes.slice(0, 5).map(o => {
                const nombreArt = o.nombre_bunker || o.descripcion || o.codigo || 'Artículo';
                const precioOf = formatearMonedaArs(o.precio_oferta_final || o.valor_oferta || 0, 0);
                return `  • *${nombreArt}*: *${precioOf}*`;
            }).join('\n');
            partesB2.push(
                `🔥 *Ofertas Especiales Vigentes en tu Lista (disponibles con Cuenta al Día):*\n` +
                `${topOfertas}`
            );
        }

        partesB2.push(`Cualquier duda o si querés que simulemos cómo queda tu saldo aplicando un pago parcial determinado, avisanos por acá. ¡Muchas gracias!`);

        if (partesB2.length > 0) {
            burbujas.push(partesB2.join('\n\n'));
        }

        return burbujas;
    }

    function renderizarBurbujasEditorPoliticasWa(burbujas) {
        const cont = document.getElementById('wa-pol-bubbles-container');
        if (!cont) return;
        const lista = Array.isArray(burbujas) && burbujas.length > 0 ? burbujas : [''];
        cont.innerHTML = lista.map((txt, idx) => `
            <div class="wa-pol-bubble-card" style="background: #ffffff; border: 1px solid #86efac; border-left: 4px solid #16a34a; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 0.75rem; font-weight: 800; color: #166534;">💬 Burbuja de WhatsApp #${idx + 1} <span style="font-weight: 600; color: #64748b;">(editable antes de enviar)</span></span>
                    ${lista.length > 1 ? `<button type="button" onclick="window.eliminarBurbujaPoliticasWa(${idx})" style="background: none; border: none; color: #dc2626; font-size: 0.72rem; font-weight: 800; cursor: pointer;">🗑️ Quitar burbuja</button>` : ''}
                </div>
                <textarea class="wa-pol-bubble-textarea" rows="${Math.min(11, Math.max(4, Math.ceil(txt.length / 82)))}" style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.82rem; font-family: inherit; line-height: 1.42; color: #0f172a; box-sizing: border-box; resize: vertical;">${escaparHtml(txt)}</textarea>
            </div>
        `).join('');
    }

    window.leerBurbujasActualesPoliticasWa = function () {
        const nodos = document.querySelectorAll('#wa-pol-bubbles-container .wa-pol-bubble-textarea');
        const resultado = [];
        nodos.forEach(n => {
            const v = String(n.value || '').trim();
            if (v) resultado.push(v);
        });
        return resultado;
    };

    window.eliminarBurbujaPoliticasWa = function (idx) {
        const actuales = window.leerBurbujasActualesPoliticasWa();
        if (actuales.length <= 1) return;
        actuales.splice(idx, 1);
        renderizarBurbujasEditorPoliticasWa(actuales);
    };

    window.agregarBurbujaVaciaPoliticasWa = function () {
        const actuales = window.leerBurbujasActualesPoliticasWa();
        actuales.push('Escribí acá un mensaje adicional...');
        renderizarBurbujasEditorPoliticasWa(actuales);
    };

    window.regenerarBurbujasDesdeControlesPoliticasWa = function () {
        if (!contextoPoliticasWaActual) return;
        const escenario = document.getElementById('wa-pol-escenario')?.value || 'PAGOS_PARCIALES';
        const config = {
            escenario,
            chkFinanciacion: Boolean(document.getElementById('wa-pol-chk-financiacion')?.checked),
            chkPoliticaLista: Boolean(document.getElementById('wa-pol-chk-lista')?.checked),
            chkSaldo: Boolean(document.getElementById('wa-pol-chk-saldo')?.checked),
            chkMediosPago: Boolean(document.getElementById('wa-pol-chk-medios')?.checked),
            chkOfertas: Boolean(document.getElementById('wa-pol-chk-ofertas')?.checked),
            chkPdf: Boolean(document.getElementById('wa-pol-chk-pdf')?.checked)
        };
        const burbujas = construirBurbujasPoliticasWa(contextoPoliticasWaActual, config);
        renderizarBurbujasEditorPoliticasWa(burbujas);
    };

    window.onCambioEscenarioPoliticasWa = function (escenario) {
        const chkFin = document.getElementById('wa-pol-chk-financiacion');
        const chkLista = document.getElementById('wa-pol-chk-lista');
        const chkSaldo = document.getElementById('wa-pol-chk-saldo');
        const chkMedios = document.getElementById('wa-pol-chk-medios');
        const chkPdf = document.getElementById('wa-pol-chk-pdf');

        if (escenario === 'EXTRACTO_CON_POLITICAS') {
            if (chkFin) chkFin.checked = true;
            if (chkLista) chkLista.checked = true;
            if (chkSaldo) chkSaldo.checked = true;
            if (chkMedios) chkMedios.checked = true;
            if (chkPdf) chkPdf.checked = true;
        } else if (escenario === 'VENTANA_CORTESIA') {
            if (chkFin) chkFin.checked = true;
            if (chkLista) chkLista.checked = true;
            if (chkSaldo) chkSaldo.checked = true;
        } else if (escenario === 'POLITICA_LISTA') {
            if (chkFin) chkFin.checked = false;
            if (chkLista) chkLista.checked = true;
            if (chkSaldo) chkSaldo.checked = false;
        } else {
            // PAGOS_PARCIALES (caso Fernando Di Pietro donde el extracto recién fue enviado)
            if (chkFin) chkFin.checked = true;
            if (chkLista) chkLista.checked = true;
            if (chkSaldo) chkSaldo.checked = false;
        }
        window.regenerarBurbujasDesdeControlesPoliticasWa();
    };

    window.ejecutarEnvioPruebaPoliticasWa = async function () {
        if (!contextoPoliticasWaActual) return;
        const telInput = document.getElementById('wa-pol-tel-prueba');
        const statusBox = document.getElementById('wa-pol-test-status');
        const btnTest = document.getElementById('btn-wa-pol-test');
        const chkPdf = Boolean(document.getElementById('wa-pol-chk-pdf')?.checked);
        const telefonoPrueba = String(telInput?.value || '5492216615746').replace(/\D/g, '');

        if (telefonoPrueba.length < 10) {
            if (statusBox) {
                statusBox.style.display = 'block';
                statusBox.style.background = '#fef2f2';
                statusBox.style.color = '#991b1b';
                statusBox.innerHTML = '⚠️ Ingresá un número de teléfono de prueba válido (ej: 5492216615746).';
            }
            return;
        }

        const burbujas = window.leerBurbujasActualesPoliticasWa();
        if (burbujas.length === 0 && !chkPdf) {
            return;
        }

        const textoOriginalBtn = btnTest ? btnTest.innerHTML : '';
        if (btnTest) {
            btnTest.disabled = true;
            btnTest.innerHTML = '⏳ Enviando prueba al teléfono...';
        }
        if (statusBox) {
            statusBox.style.display = 'block';
            statusBox.style.background = '#eff6ff';
            statusBox.style.borderColor = '#93c5fd';
            statusBox.style.color = '#1e40af';
            statusBox.innerHTML = `⏳ Enviando ${chkPdf ? 'PDF de Cuenta Corriente + ' : ''}${burbujas.length} burbuja(s) de prueba al <strong>+${telefonoPrueba}</strong>...`;
        }

        try {
            // 1. Si está tildado adjuntar PDF de Cuenta Corriente y el cliente tiene cuentaId, enviamos el PDF con el cuerpo corto
            const usarPrimeraBurbujaComoCaptionPdf = Boolean(chkPdf && contextoPoliticasWaActual.cuentaId && burbujas.length > 0);
            if (chkPdf && contextoPoliticasWaActual.cuentaId) {
                const captionCorto = usarPrimeraBurbujaComoCaptionPdf
                    ? burbujas[0]
                    : `Te adjunto el resumen actualizado de tu cuenta corriente en PDF.\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/\nCualquier duda avisame!`;
                const respPdf = await fetch(`/api/logistica/bunker/cuentas-corrientes/${contextoPoliticasWaActual.cuentaId}/whatsapp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: telefonoPrueba,
                        incluirDetalle: true,
                        mensajeTexto: `🧪 [PRUEBA INTERNA LAMDA — Destinatario real: ${contextoPoliticasWaActual.cli?.cliente_nombre || contextoPoliticasWaActual.chat?.contacto_nombre || 'Cliente'}]\n\n${captionCorto}`
                    })
                });
                const dataPdf = await respPdf.json();
                if (!respPdf.ok || (!dataPdf.ok && !dataPdf.success)) {
                    throw new Error(dataPdf.error || 'No se pudo enviar el PDF de prueba.');
                }
            }

            // 2. Enviar las burbujas adicionales (si las hubiera) al teléfono de prueba
            const burbujasRestantes = usarPrimeraBurbujaComoCaptionPdf ? burbujas.slice(1) : burbujas;
            if (burbujasRestantes.length > 0) {
                const respTxt = await fetch('/api/crm/seguimientos/enviar-prueba-directa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telefono_prueba: telefonoPrueba,
                        mensajes: burbujasRestantes
                    })
                });
                const dataTxt = await respTxt.json();
                if (!respTxt.ok || !dataTxt.success) {
                    throw new Error(dataTxt.error || 'Error al enviar las burbujas de prueba.');
                }
            }

            if (statusBox) {
                const horaStr = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                statusBox.style.display = 'block';
                statusBox.style.background = '#ecfdf5';
                statusBox.style.borderColor = '#6ee7b7';
                statusBox.style.color = '#065f46';
                statusBox.innerHTML = `✅ <strong>¡Prueba enviada con éxito a las ${horaStr} al +${telefonoPrueba}!</strong> Revisá el WhatsApp de la empresa para leer cómo lo recibe el cliente. Si querés retocar alguna palabra, podés editar las burbujas acá mismo antes de enviárselo al cliente.`;
            }
        } catch (err) {
            if (statusBox) {
                statusBox.style.display = 'block';
                statusBox.style.background = '#fef2f2';
                statusBox.style.borderColor = '#fca5a5';
                statusBox.style.color = '#991b1b';
                statusBox.innerHTML = `❌ Error al enviar prueba: ${escaparHtml(err.message)}`;
            }
        } finally {
            if (btnTest) {
                btnTest.disabled = false;
                btnTest.innerHTML = textoOriginalBtn;
            }
        }
    };

    window.volcarPoliticasAlBorradorWa = function () {
        if (!contextoPoliticasWaActual) return;
        const burbujas = window.leerBurbujasActualesPoliticasWa();
        if (burbujas.length === 0) return;
        const textoUnido = burbujas.join('\n\n');
        const chatPk = contextoPoliticasWaActual.chat?.id;

        if (chatPk) {
            window.guardarBorradorChatWa(chatPk, textoUnido);
            const inp = document.getElementById('wa-hub-input-texto');
            if (inp) {
                inp.value = textoUnido;
                inp.rows = 6;
            }
        }
        if (typeof Swal !== 'undefined') Swal.close();
    };

    window.programarPoliticasWa = async function () {
        if (!contextoPoliticasWaActual) return;
        const burbujas = window.leerBurbujasActualesPoliticasWa();
        if (burbujas.length === 0) return;
        const chatPk = contextoPoliticasWaActual.chat?.id;
        if (typeof Swal !== 'undefined') Swal.close();
        if (chatPk && typeof window.programarMensajeDesdeConsolaWa === 'function') {
            await window.programarMensajeDesdeConsolaWa(chatPk, burbujas.join('\n\n'));
        }
    };

    window.enviarPoliticasAlClienteRealWa = async function () {
        if (!contextoPoliticasWaActual) return;
        const chat = contextoPoliticasWaActual.chat;
        const cli = contextoPoliticasWaActual.cli;
        const chkPdf = Boolean(document.getElementById('wa-pol-chk-pdf')?.checked);
        const burbujas = window.leerBurbujasActualesPoliticasWa();
        const btnEnviar = document.getElementById('btn-wa-pol-enviar-real');
        const statusBox = document.getElementById('wa-pol-test-status');

        if (!chat?.id) {
            alert('No hay un chat activo seleccionado.');
            return;
        }
        if (burbujas.length === 0 && !chkPdf) {
            return;
        }

        const nombreDest = cli?.cliente_nombre || chat?.contacto_nombre || chat?.telefono_normalizado;
        const confirmado = window.confirm(
            `¿Confirmás enviar ahora ${chkPdf ? 'el PDF de Cuenta Corriente + ' : ''}${burbujas.length} mensaje(s) de WhatsApp a ${nombreDest} (+${chat.telefono_normalizado})?`
        );
        if (!confirmado) return;

        const textoOriginal = btnEnviar ? btnEnviar.innerHTML : '';
        if (btnEnviar) {
            btnEnviar.disabled = true;
            btnEnviar.innerHTML = '⏳ Enviando al cliente...';
        }

        try {
            // 1. Si pidió adjuntar el PDF del Extracto de Cuenta Corriente, usamos la 1ra burbuja como cuerpo corto del PDF
            const usarPrimeraBurbujaComoCaptionPdf = Boolean(chkPdf && contextoPoliticasWaActual.cuentaId && burbujas.length > 0);
            if (chkPdf && contextoPoliticasWaActual.cuentaId) {
                const captionCorto = usarPrimeraBurbujaComoCaptionPdf
                    ? burbujas[0]
                    : `Te adjunto el resumen actualizado de tu cuenta corriente en PDF.\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/\nCualquier duda avisame!`;
                const respPdf = await fetch(`/api/logistica/bunker/cuentas-corrientes/${contextoPoliticasWaActual.cuentaId}/whatsapp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: chat.telefono_normalizado,
                        incluirDetalle: true,
                        mensajeTexto: captionCorto
                    })
                });
                const dataPdf = await respPdf.json();
                if (!respPdf.ok || (!dataPdf.ok && !dataPdf.success)) {
                    throw new Error(dataPdf.error || 'Error al adjuntar el PDF de Cuenta Corriente.');
                }
            }

            // 2. Enviar las burbujas adicionales (si las hubiera) por el endpoint oficial del chat CRM
            const burbujasRestantes = usarPrimeraBurbujaComoCaptionPdf ? burbujas.slice(1) : burbujas;
            for (let i = 0; i < burbujasRestantes.length; i++) {
                const textoBurbuja = burbujasRestantes[i];
                const respMsg = await fetch(`/api/crm/whatsapp/chats/${chat.id}/enviar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mensajeTexto: textoBurbuja, texto: textoBurbuja })
                });
                const dataMsg = await respMsg.json();
                if (!respMsg.ok || !dataMsg.success) {
                    throw new Error(dataMsg.error || `Error al enviar la burbuja #${i + 1}`);
                }
                if (i < burbujas.length - 1) {
                    await new Promise(r => setTimeout(r, 900));
                }
            }

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: '¡Políticas y Asistencia Enviadas!',
                    text: `Se enviaron ${burbujas.length} burbuja(s)${chkPdf ? ' y el PDF de Cuenta Corriente' : ''} a ${nombreDest}.`,
                    timer: 2400,
                    showConfirmButton: false
                });
            }

            if (typeof window.seleccionarChatConsola === 'function') {
                await window.seleccionarChatConsola(chat.id, true);
            }
            if (typeof cargarListaChatsConsola === 'function') {
                await cargarListaChatsConsola(true);
            }
        } catch (err) {
            if (statusBox) {
                statusBox.style.display = 'block';
                statusBox.style.background = '#fef2f2';
                statusBox.style.borderColor = '#fca5a5';
                statusBox.style.color = '#991b1b';
                statusBox.innerHTML = `❌ Error al enviar al cliente: ${escaparHtml(err.message)}`;
            } else {
                alert('Error al enviar al cliente: ' + err.message);
            }
        } finally {
            if (btnEnviar) {
                btnEnviar.disabled = false;
                btnEnviar.innerHTML = textoOriginal;
            }
        }
    };

    window.abrirAsistentePoliticasFinanciacionWa = async function (opciones = {}) {
        const targetChatId = opciones.chatId || estadoConsola.chatActivoId;
        if (targetChatId && (!estadoConsola.detalleActivo || Number(estadoConsola.detalleActivo?.chat?.id) !== Number(targetChatId))) {
            if (typeof window.seleccionarChatConsola === 'function') {
                await window.seleccionarChatConsola(targetChatId, false);
            }
        }

        const chat = estadoConsola.chatActivoDatos
            || (estadoConsola.detalleActivo && estadoConsola.detalleActivo.chat)
            || estadoConsola.chats.find(c => Number(c.id) === Number(targetChatId))
            || null;
        const rayosX = estadoConsola.rayosXActivo || (estadoConsola.detalleActivo && estadoConsola.detalleActivo.rayos_x) || null;
        if (!chat) {
            if (typeof Swal !== 'undefined') {
                Swal.fire('Seleccioná una conversación', 'Elegí primero un cliente en la columna izquierda de WhatsApp LAMDA.', 'info');
            }
            return;
        }

        const cli = rayosX?.cliente || null;
        const cc = rayosX?.cuenta_corriente || { tiene_cuenta: false, saldo_actual: 0, ultimos_movimientos: [] };
        const codigoBunker = cli?.codigo_bunker_cliente || cli?.id || null;
        let cuentaId = cc?.cuenta_id || null;

        if (typeof Swal !== 'undefined') {
            Swal.fire({
                title: '🛡️ Preparando Asistente de Políticas y Financiación...',
                html: 'Consultando reglas de su Lista de Precios, Ventanas de Financiación y Cuenta Corriente en tiempo real...',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });
        }

        let salvavidas = null;
        let politicaInfo = null;
        let ofertasVigentes = [];

        try {
            // Si tenemos cliente Búnker pero no cuentaId, lo resolvemos
            if (codigoBunker && !cuentaId) {
                const rCta = await fetch(`/api/logistica/bunker/cuentas-corrientes?cliente=${encodeURIComponent(codigoBunker)}`).then(r => r.json()).catch(() => null);
                if (rCta?.ok && rCta?.data?.id) {
                    cuentaId = rCta.data.id;
                }
            }

            const promesas = [
                cuentaId
                    ? fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaId}/salvavidas-simulacion`).then(r => r.json()).catch(() => null)
                    : Promise.resolve(null),
                codigoBunker
                    ? fetch(`/api/presupuestos/politicas/cliente/${encodeURIComponent(codigoBunker)}`).then(r => r.json()).catch(() => null)
                    : Promise.resolve(null),
                fetch('/api/ofertas-dinamicas?solo_activas=true').then(r => r.json()).catch(() => null)
            ];

            const [resSalv, resPol, resOf] = await Promise.all(promesas);
            if (resSalv?.ok && resSalv?.data) salvavidas = resSalv.data;
            if (resPol?.success) politicaInfo = resPol;

            const listaIdCliente = Number(politicaInfo?.lista_id || cli?.lista_asignada_id || 0);
            const rawOfertas = Array.isArray(resOf?.data) ? resOf.data : (Array.isArray(resOf) ? resOf : []);
            ofertasVigentes = rawOfertas.filter(o => {
                if (!listaIdCliente) return true;
                const listasOf = Array.isArray(o.listas) ? o.listas.map(Number) : [];
                return listasOf.length === 0 || listasOf.includes(listaIdCliente);
            });
        } catch (e) {
            console.warn('[WA-HUB] Error parcial cargando datos de políticas:', e.message);
        }

        const escenarioInicial = opciones.escenario || 'PAGOS_PARCIALES';
        const chkSaldoInicial = opciones.incluirSaldo !== undefined ? Boolean(opciones.incluirSaldo) : (escenarioInicial === 'EXTRACTO_CON_POLITICAS');
        const chkPdfInicial = opciones.incluirPdf !== undefined ? Boolean(opciones.incluirPdf) : (escenarioInicial === 'EXTRACTO_CON_POLITICAS');

        contextoPoliticasWaActual = {
            chat,
            cli,
            cc,
            cuentaId,
            salvavidas,
            politicaInfo,
            ofertasVigentes,
            nombreSaludo: obtenerPrimerNombreSaludo(chat, cli)
        };

        const reglas = salvavidas?.reglas_aplicadas || {};
        const listaId = politicaInfo?.lista_id || cli?.lista_asignada_id || '-';
        const listaNombre = politicaInfo?.lista_nombre || reglas.lista_nombre || cli?.lista_asignada_nombre || 'Sin lista asignada';
        const pol = politicaInfo?.politica || null;
        const tramo0 = (Array.isArray(pol?.tramos) && pol.tramos[0]) ? pol.tramos[0] : { monto_minimo: 300000, descuento_porcentaje: 5 };
        const saldoCapital = Number(salvavidas?.saldo_contable_real ?? cc?.saldo_actual ?? 0);
        const montoFinModal = Number(salvavidas?.financiacion_total_con_iva ?? 0);
        const saldoReal = montoFinModal > 0 ? Number(salvavidas?.saldo_total_proyectado_con_iva || (saldoCapital + montoFinModal)) : saldoCapital;
        const cantCapas = Array.isArray(salvavidas?.capas_simuladas) ? salvavidas.capas_simuladas.length : (Array.isArray(cc?.composicion?.capas) ? cc.composicion.capas.length : 0);
        const tasaMensual = Number(reglas.tasa_servicio_financiero || 3).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        const diasV1 = Number(reglas.dias_ventana_estandar || 7);
        const diasCort = Number(reglas.dias_ventana_cortesia || 7);
        const cupoComodines = Number(reglas.cupo_cortesias_anual ?? 3);
        const comodinesDisp = Number(reglas.cortesias_disponibles_anio ?? 3);
        const tasaDiariaNum = Number(reglas.tasa_diaria || 0.001);
        const capasArr = Array.isArray(salvavidas?.capas_simuladas) && salvavidas.capas_simuladas.length > 0
            ? salvavidas.capas_simuladas
            : (Array.isArray(cc?.composicion?.capas) ? cc.composicion.capas : []);
        const interesRelojDesdeDia1 = capasArr.reduce((acc, c) => {
            const cap = Number(c.capital_pendiente ?? c.monto_pendiente ?? 0);
            const d = Math.max(1, Number(c.antiguedad_dias || 1));
            return acc + Number(c.interes_acumulado_desde_dia_1 ?? (cap * tasaDiariaNum * d));
        }, 0);
        const maxDiasCapa = capasArr.reduce((mx, c) => Math.max(mx, Number(c.antiguedad_dias || 0)), 0);
        const estaBonificadoHoy = maxDiasCapa <= (diasV1 + diasCort) && comodinesDisp > 0;

        const burbujasIniciales = construirBurbujasPoliticasWa(contextoPoliticasWaActual, {
            escenario: escenarioInicial,
            chkFinanciacion: true,
            chkPoliticaLista: true,
            chkSaldo: chkSaldoInicial,
            chkMediosPago: escenarioInicial === 'EXTRACTO_CON_POLITICAS',
            chkOfertas: false,
            chkPdf: chkPdfInicial
        });

        await Swal.fire({
            title: '🛡️ Asistente de Políticas, Financiación y Pagos Parciales',
            width: 880,
            showConfirmButton: false,
            showCloseButton: true,
            html: `
                <div style="text-align: left; font-size: 0.84rem; color: #1e293b;">
                    <!-- RESUMEN DIAGNÓSTICO DEL CLIENTE -->
                    <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(195px, 1fr)); gap: 10px;">
                        <div>
                            <div style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">👤 Cliente / Contacto</div>
                            <div style="font-weight: 800; color: #0f172a; font-size: 0.88rem;">${escaparHtml(cli?.cliente_nombre || chat.contacto_nombre || 'Cliente')}</div>
                            <div style="font-size: 0.75rem; color: #475569;">📱 +${escaparHtml(chat.telefono_normalizado)} ${cli?.codigo_bunker_cliente ? `· <strong>${escaparHtml(cli.codigo_bunker_cliente)}</strong>` : ''}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.7rem; font-weight: 800; color: #0f766e; text-transform: uppercase;">🏷️ Lista y Bonificación Asignada</div>
                            <div style="font-weight: 800; color: #0f766e; font-size: 0.86rem;">Lista #${escaparHtml(listaId)} (${escaparHtml(listaNombre)})</div>
                            <div style="font-size: 0.74rem; color: #115e59;"><strong>${Number(tramo0.descuento_porcentaje || 5)}% OFF</strong> &gt; ${formatearMonedaArs(tramo0.monto_minimo || 300000, 0)} <em>(Exige Saldo $ 0,00)</em></div>
                        </div>
                        <div>
                            <div style="font-size: 0.7rem; font-weight: 800; color: #b91c1c; text-transform: uppercase;">💰 Saldo Total + Financiación</div>
                            <div style="font-weight: 900; color: ${saldoReal > 0.01 ? '#dc2626' : '#16a34a'}; font-size: 0.92rem;">${formatearMonedaArs(saldoReal, 2)}${montoFinModal > 0 ? ` <span style="font-size:0.72rem; font-weight:700; color:#475569;">(C: ${formatearMonedaArs(saldoCapital, 0)} + F: ${formatearMonedaArs(montoFinModal, 0)})</span>` : ''}</div>
                            <div style="font-size: 0.73rem; color: #1e293b; font-weight: 700;">⏱️ Financiación desde Día 1 (${maxDiasCapa}d): <span style="color: ${estaBonificadoHoy ? '#0284c7' : '#d97706'};">${formatearMonedaArs(montoFinModal > 0 ? montoFinModal : interesRelojDesdeDia1, 2)} (${estaBonificadoHoy ? `Bonificado hasta Día ${diasV1 + diasCort}` : 'Activo'})</span></div>
                            <div style="font-size: 0.72rem; color: #64748b;">🎟️ Comodines Cortesía Anual: <strong>${comodinesDisp} de ${cupoComodines} disponibles</strong></div>
                        </div>
                    </div>

                    <!-- SELECTOR DE ESCENARIO Y TILDES COMBINABLES -->
                    <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px;">
                            <label style="font-weight: 800; color: #1e3a8a; font-size: 0.8rem;">🎯 1. Escenario de Respuesta Asistida:</label>
                            <select id="wa-pol-escenario" onchange="window.onCambioEscenarioPoliticasWa(this.value)" style="flex: 1; min-width: 280px; padding: 6px 10px; border-radius: 6px; border: 1px solid #93c5fd; font-size: 0.81rem; font-weight: 700; color: #0f172a; background: #ffffff;">
                                <option value="PAGOS_PARCIALES" ${escenarioInicial === 'PAGOS_PARCIALES' ? 'selected' : ''}>🤝 Respuesta a "¿Puedo hacer pagos parciales?" (Ampliar resumen recién enviado)</option>
                                <option value="EXTRACTO_CON_POLITICAS" ${escenarioInicial === 'EXTRACTO_CON_POLITICAS' ? 'selected' : ''}>📄 Enviar Extracto PDF + Explicación Completa de Políticas y Financiación</option>
                                <option value="VENTANA_CORTESIA" ${escenarioInicial === 'VENTANA_CORTESIA' ? 'selected' : ''}>⏳ Cliente pide más plazo ("Aguantame unos días") — Ventanas y Asistencia</option>
                                <option value="POLITICA_LISTA" ${escenarioInicial === 'POLITICA_LISTA' ? 'selected' : ''}>🏷️ Explicación de Política de su Lista de Precios y Descuento por Volumen</option>
                            </select>
                        </div>

                        <div style="font-weight: 800; color: #1e3a8a; font-size: 0.78rem; margin-bottom: 6px;">☑️ 2. Módulos y Anexos a Incluir (como en Impresión de Presupuestos — tildá o destildá):</div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 6px 12px; font-size: 0.79rem;">
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 700; color: #0f172a;">
                                <input type="checkbox" id="wa-pol-chk-financiacion" checked onchange="window.regenerarBurbujasDesdeControlesPoliticasWa()">
                                <span>🤝 Pagos Parciales + Asistencia Financiera (Ventanas)</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 700; color: #0f172a;">
                                <input type="checkbox" id="wa-pol-chk-lista" checked onchange="window.regenerarBurbujasDesdeControlesPoliticasWa()">
                                <span>🏷️ Política de su Lista (#${escaparHtml(listaId)}) y Condición Saldo Cero</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 700; color: #0f172a;">
                                <input type="checkbox" id="wa-pol-chk-saldo" ${chkSaldoInicial ? 'checked' : ''} onchange="window.regenerarBurbujasDesdeControlesPoliticasWa()">
                                <span>📊 Detalle de Saldo Actual (${formatearMonedaArs(saldoReal, 2)}) en texto</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 700; color: #0f172a;">
                                <input type="checkbox" id="wa-pol-chk-medios" ${escenarioInicial === 'EXTRACTO_CON_POLITICAS' ? 'checked' : ''} onchange="window.regenerarBurbujasDesdeControlesPoliticasWa()">
                                <span>💳 Medios de Pago (CBU Galicia, Cajeros 24h y Ensobrado)</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 700; color: #0f172a;">
                                <input type="checkbox" id="wa-pol-chk-ofertas" onchange="window.regenerarBurbujasDesdeControlesPoliticasWa()">
                                <span>🔥 Ofertas Vigentes de su Lista (${ofertasVigentes.length} activas)</span>
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 800; color: #0f766e;">
                                <input type="checkbox" id="wa-pol-chk-pdf" ${chkPdfInicial ? 'checked' : ''} ${!cuentaId ? 'disabled' : ''}>
                                <span>📄 Adjuntar PDF Extracto Cuenta Corriente</span>
                            </label>
                        </div>
                    </div>

                    <!-- EDITOR DE BURBUJAS DE WHATSAPP -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-weight: 800; color: #14532d; font-size: 0.82rem;">✍️ 3. Revisá o Editá las Burbujas de WhatsApp (Asistencia al Operador):</span>
                        <div style="display: flex; gap: 6px;">
                            <button type="button" onclick="window.regenerarBurbujasDesdeControlesPoliticasWa()" style="background: #f1f5f9; border: 1px solid #cbd5e1; color: #334155; padding: 3px 8px; border-radius: 6px; font-size: 0.73rem; font-weight: 700; cursor: pointer;">🔄 Restaurar Texto Sugerido</button>
                            <button type="button" onclick="window.agregarBurbujaVaciaPoliticasWa()" style="background: #dcfce7; border: 1px solid #86efac; color: #166534; padding: 3px 8px; border-radius: 6px; font-size: 0.73rem; font-weight: 800; cursor: pointer;">➕ Agregar Burbuja</button>
                        </div>
                    </div>

                    <div id="wa-pol-bubbles-container" style="max-height: 290px; overflow-y: auto; padding-right: 4px; margin-bottom: 10px;"></div>

                    <!-- BANNER DE ESTADO DE ENVÍO DE PRUEBA -->
                    <div id="wa-pol-test-status" style="display: none; padding: 9px 12px; border-radius: 8px; border: 1px solid #93c5fd; font-size: 0.8rem; margin-bottom: 10px;"></div>

                    <!-- CAJA DE PRUEBA INTERNA AL TELÉFONO DE LA EMPRESA -->
                    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                        <div style="flex: 1; min-width: 240px;">
                            <div style="font-weight: 800; color: #92400e; font-size: 0.8rem;">🧪 Paso de Seguridad Recomendado: Probar antes en el WhatsApp de la Empresa</div>
                            <div style="font-size: 0.74rem; color: #78350f;">Envía estas mismas burbujas (y el PDF si está tildado) a tu teléfono para leer cómo lo recibe el cliente sin cerrar esta ventana.</div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <input type="text" id="wa-pol-tel-prueba" value="5492216615746" title="Teléfono de prueba (por defecto: WhatsApp de la empresa 221 661 5746)" style="width: 138px; padding: 7px 9px; border-radius: 6px; border: 1px solid #f59e0b; font-size: 0.8rem; font-weight: 800; color: #78350f; background: #ffffff;">
                            <button type="button" id="btn-wa-pol-test" onclick="window.ejecutarEnvioPruebaPoliticasWa()" style="background: #d97706; color: #ffffff; border: none; padding: 8px 14px; border-radius: 8px; font-weight: 800; font-size: 0.8rem; cursor: pointer; white-space: nowrap; box-shadow: 0 1px 3px rgba(217,119,6,0.3);">
                                🧪 Enviar Prueba a mi Teléfono
                            </button>
                        </div>
                    </div>

                    <!-- BOTONERA DE DECISIÓN DEL OPERADOR -->
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 6px; border-top: 1px solid #e2e8f0;">
                        <button type="button" onclick="window.volcarPoliticasAlBorradorWa()" style="background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 9px 14px; border-radius: 8px; font-weight: 800; font-size: 0.81rem; cursor: pointer;">
                            📥 Pasar al Borrador del Chat (No Enviar)
                        </button>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <button type="button" onclick="window.programarPoliticasWa()" style="background: #0284c7; color: #ffffff; border: none; padding: 9px 15px; border-radius: 8px; font-weight: 800; font-size: 0.82rem; cursor: pointer;">
                                📅 Programar / Reservar Envío
                            </button>
                            <button type="button" id="btn-wa-pol-enviar-real" onclick="window.enviarPoliticasAlClienteRealWa()" style="background: #128c7e; color: #ffffff; border: none; padding: 9px 18px; border-radius: 8px; font-weight: 800; font-size: 0.86rem; cursor: pointer; box-shadow: 0 2px 5px rgba(18,140,126,0.3);">
                                🚀 Enviar Ahora al Cliente
                            </button>
                        </div>
                    </div>
                </div>
            `,
            didOpen: () => {
                renderizarBurbujasEditorPoliticasWa(burbujasIniciales);
            }
        });
    };

    // =========================================================================
    // 💬 ASISTENTE COMERCIAL CONVERSACIONAL (LISTA DE PRECIOS, PORTAL B2B E HISTORIAL DE COMPRAS)
    // Filosofía: 100% Asistencia al Operador (NUNCA automático). Mensajes cortos,
    // cálidos y paso a paso pensados para diálogo real de WhatsApp (sin tiras largas).
    // =========================================================================

    const URL_PORTAL_B2B_OFICIAL = 'https://proud-darkness-ac3d.miserrano75.workers.dev';
    let cacheCatalogoAsistenteWa = null;
    let cacheCatalogoTimestampWa = 0;
    let cacheEstadosPortalB2B = null;
    let estadoAsistenteComercialWa = null;

    async function obtenerMapaEstadosPortalB2BWa() {
        if (cacheEstadosPortalB2B) return cacheEstadosPortalB2B;
        try {
            const res = await fetch('/js/b2b-estado-clientes.json?t=' + Date.now());
            if (res.ok) {
                const data = await res.json();
                if (data && data.clientes) {
                    cacheEstadosPortalB2B = data.clientes;
                    return cacheEstadosPortalB2B;
                }
            }
        } catch (_) {}
        return {};
    }

    function normalizarTextoBusquedaAsistenteWa(str) {
        return String(str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    /**
     * Clasifica determinísticamente la Línea de Negocio (LDN 1 a 6), si es Artículo Padre (Combo/Pack)
     * y el peso unitario de fracción (kilos_fraccion) vs peso del bulto (kilos_unidad).
     */
    function enriquecerMetadatosFiltrosArticuloWa(art) {
        if (!art || typeof art !== 'object') return art;
        const code = String(art.id || art.articulo_id || art.codigo_unico || '').trim().toLowerCase();
        const nombreVisible = String(art.nombre || art.nombre_visible || art.descripcion_generada || art.descripcion || code).trim();
        const descLow = nombreVisible.toLowerCase();
        const props = (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') ? art.propiedades_dinamicas : {};

        const kilosUnidad = Number(art.kilos_unidad || art.peso_bulto || 1) || 1;
        let packUnidades = Math.max(1, parseInt(art.pack_unidades, 10) || 1);
        const matchComboDesc = nombreVisible.match(/(?<![/\-\d]\s*)\b(\d+)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(g|gr|kg|k)\b/i);
        if (matchComboDesc && packUnidades <= 1) {
            packUnidades = Math.max(1, parseInt(matchComboDesc[1], 10) || 1);
        }

        const esArticuloPadre = Boolean(
            art.es_articulo_padre === true ||
            (art.es_pack === true && packUnidades > 1 && kilosUnidad > 0) ||
            (packUnidades > 1 && kilosUnidad > 0) ||
            matchComboDesc
        );

        let kilosFraccion = Number(art.kilos_fraccion || 0);
        if (!(kilosFraccion > 0)) {
            if (esArticuloPadre) {
                if (matchComboDesc) {
                    const valNum = parseFloat(String(matchComboDesc[2]).replace(',', '.')) || 1;
                    const uStr = String(matchComboDesc[3] || '').toLowerCase();
                    kilosFraccion = uStr.startsWith('g') ? Number((valNum / 1000).toFixed(3)) : valNum;
                } else if (packUnidades > 1 && kilosUnidad > 0) {
                    kilosFraccion = Number((kilosUnidad / packUnidades).toFixed(3));
                } else {
                    kilosFraccion = kilosUnidad;
                }
            } else {
                kilosFraccion = kilosUnidad;
            }
        }

        let lineaNegocio = Number(art.linea_negocio || 0);
        if (!(lineaNegocio >= 1 && lineaNegocio <= 6)) {
            const totalRecetas = parseInt(art.total_recetas, 10) || 0;
            const tienePackHijo = Boolean(art.pack_hijo_codigo && String(art.pack_hijo_codigo).trim() !== '');
            const noProducido = art.no_producido_por_lambda === true || art.no_producido_por_lambda === 'true';

            if (code.startsWith('bf') || code.includes('bfx') || descLow.includes('barrita') || descLow.includes('barr.') || descLow.startsWith('barra ')) {
                lineaNegocio = 5;
            } else if (descLow.includes('granola') || descLow.includes('grana ')) {
                lineaNegocio = 6;
            } else if (code.startsWith('prod up') || code.includes('tostad') || descLow.includes('tostad') || descLow.includes('tost/sal') || descLow.includes('tost/') || props.presentacion_variable_wip) {
                lineaNegocio = 4;
            } else if (descLow.includes('mix') || /^m(?:fs|ct|sp|st|s\d|s[x])/i.test(code)) {
                lineaNegocio = 3;
            } else if (totalRecetas > 0 || (tienePackHijo && !noProducido) || (kilosFraccion <= 5 && !noProducido && kilosUnidad <= 5)) {
                lineaNegocio = 2;
            } else {
                lineaNegocio = 1;
            }
        }

        const ldnMeta = {
            1: { tag: 'LDN 1', corto: 'Bulto', nombre: 'LDN 1: Bulto Cerrado', color: '#334155', bg: '#f1f5f9', border: '#cbd5e1' },
            2: { tag: 'LDN 2', corto: 'Fracc.', nombre: 'LDN 2: Fraccionado', color: '#15803d', bg: '#f0fdf4', border: '#86efac' },
            3: { tag: 'LDN 3', corto: 'Mix', nombre: 'LDN 3: Mixes', color: '#5b21b6', bg: '#f5f3ff', border: '#c4b5fd' },
            4: { tag: 'LDN 4', corto: 'Tost. UP', nombre: 'LDN 4: UP Tostadero', color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
            5: { tag: 'LDN 5', corto: 'Barritas', nombre: 'LDN 5: Barritas UP', color: '#9f1239', bg: '#fff1f2', border: '#fecdd3' },
            6: { tag: 'LDN 6', corto: 'Granolas', nombre: 'LDN 6: Granolas', color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' }
        }[lineaNegocio] || { tag: 'LDN 1', corto: 'Bulto', nombre: 'LDN 1: Bulto Cerrado', color: '#334155', bg: '#f1f5f9', border: '#cbd5e1' };

        art.kilos_unidad = kilosUnidad;
        art.kilos_fraccion = kilosFraccion;
        art.pack_unidades = packUnidades;
        art.es_articulo_padre = esArticuloPadre;
        art.linea_negocio = lineaNegocio;
        art.linea_negocio_tag = ldnMeta.tag;
        art.linea_negocio_corto = ldnMeta.corto;
        art.linea_negocio_nombre = ldnMeta.nombre;
        art.linea_negocio_style = ldnMeta;
        return art;
    }

    /**
     * Bolsa de Búsqueda Combinada (Política Universal de Búsqueda LAMDA - Fase 49)
     */
    function obtenerBolsaBusquedaArticuloAsistenteWa(art) {
        enriquecerMetadatosFiltrosArticuloWa(art);
        let baseUniversal = '';
        if (typeof window.obtenerTextoBusquedaArticulo === 'function') {
            try {
                baseUniversal = String(window.obtenerTextoBusquedaArticulo(art) || '');
            } catch (_) {}
        }
        const kgNum = Number(art.kilos_unidad || art.peso_bulto || 0);
        const kgFrac = Number(art.kilos_fraccion || kgNum || 0);
        const packU = Number(art.pack_unidades || 1);
        const ldnNum = Number(art.linea_negocio || 1);

        let kgTokens = '';
        if (kgNum > 0) {
            kgTokens += ` ${kgNum}kg ${kgNum} kg ${kgNum}kilos ${kgNum} kilos x${kgNum}kg x ${kgNum}kg x${kgNum}k x${kgNum} x ${kgNum} por ${kgNum} por${kgNum} por ${kgNum}kg de ${kgNum} de ${kgNum}kg`;
        }
        if (kgFrac > 0 && kgFrac < 1) {
            const gr = Math.round(kgFrac * 1000);
            kgTokens += ` ${gr}g ${gr}gr ${gr} gramos x${gr}g x ${gr}g x${gr} x ${gr} por ${gr} por${gr} de ${gr} de ${gr}g`;
        }
        if (art.es_articulo_padre) {
            const grHijo = kgFrac < 1 ? `${Math.round(kgFrac * 1000)}g` : `${kgFrac}kg`;
            kgTokens += ` articulo padre articulos padre padre combo combos pack packs ${packU}x${grHijo} ${packU} x ${grHijo} por ${packU}`;
        } else {
            kgTokens += ` individual individuales`;
        }
        kgTokens += ` ldn${ldnNum} ldn ${ldnNum} linea ${ldnNum} flujo ${ldnNum} ${art.linea_negocio_nombre || ''}`;

        const estaticos = [
            baseUniversal,
            art.id,
            art.articulo_id,
            art.codigo_unico,
            art.codigo_barras,
            art.numero,
            art.nombre,
            art.nombre_visible,
            art.descripcion,
            art.descripcion_generada,
            art.articulo_principal,
            art.familia_nombre,
            art.familia_b2b,
            art.rubro,
            art.sub_rubro,
            art.ruta_jerarquia_b2b,
            art.ruta_subcategoria_b2b,
            art.presentacion,
            art.unidad,
            kgTokens
        ];
        let dinamicosStr = '';
        if (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object') {
            try {
                dinamicosStr = JSON.stringify(art.propiedades_dinamicas);
            } catch (_) {}
        }
        let bolsa = normalizarTextoBusquedaAsistenteWa([...estaticos, dinamicosStr].filter(Boolean).join(' '));
        // Sinónimos comerciales y abreviaturas habituales del Búnker
        if (bolsa.includes('mpsa') || bolsa.includes('mariposa')) {
            bolsa += ' mariposa mpsa';
        }
        if (bolsa.includes('chler') || bolsa.includes('chandler')) {
            bolsa += ' chandler chler';
        }
        if (bolsa.includes('exlight') || bolsa.includes('extra light')) {
            bolsa += ' extra light exlight';
        }
        if (bolsa.includes('amlght') || bolsa.includes('ambar')) {
            bolsa += ' ambar light amlght';
        }
        if (bolsa.includes('escurrda') || bolsa.includes('escurrida')) {
            bolsa += ' escurrida fruta abrillantada fruta brillantada fruta escurrida confitada';
        }
        if (bolsa.includes('glsdo') || bolsa.includes('glasead')) {
            bolsa += ' glaseado glaseada glaseados glaciada glaciado fruta glaseada';
        }
        if (bolsa.includes('damazco') || bolsa.includes('damasco')) {
            bolsa += ' damasco damazco';
        }
        if (bolsa.includes('castana') || bolsa.includes('caju')) {
            bolsa += ' castana castanas caju';
        }
        return bolsa;
    }

    /**
     * Evalúa si un artículo cumple una condición de peso de fracción (<, <=, =, >=, >)
     */
    function cumpleFiltroFraccionWa(art, op, rawVal) {
        if (!op || rawVal === '' || rawVal === null || rawVal === undefined) return true;
        const num = parseFloat(String(rawVal).replace(',', '.'));
        if (!Number.isFinite(num) || num <= 0) return true;
        // Si el usuario escribe un número >= 50 (ej. 500 o 250), lo interpretamos como gramos (0.5kg, 0.25kg)
        const targetKg = num >= 50 ? (num / 1000) : num;
        const pesoFrac = Number(art.kilos_fraccion || art.kilos_unidad || 1);
        if (op === '<') return pesoFrac < (targetKg - 0.001);
        if (op === '<=') return pesoFrac <= (targetKg + 0.001);
        if (op === '>') return pesoFrac > (targetKg + 0.001);
        if (op === '>=') return pesoFrac >= (targetKg - 0.001);
        if (op === '=') return Math.abs(pesoFrac - targetKg) <= 0.02;
        return true;
    }

    /**
     * Evalúa si un artículo coincide con una expresión de presentación puntual ("por 10", "x 10", "por 500")
     */
    function cumplePresentacionPuntualWa(art, num, unidadStr = '') {
        if (!Number.isFinite(num) || num <= 0) return true;
        const u = String(unidadStr || '').toLowerCase();
        const pesoBulto = Number(art.kilos_unidad || 1);
        const pesoFrac = Number(art.kilos_fraccion || pesoBulto);
        const packU = Number(art.pack_unidades || 1);

        if (u.startsWith('g') || num >= 50) {
            const kgTarget = num >= 50 ? (num / 1000) : num;
            return Math.abs(pesoFrac - kgTarget) <= 0.015 || Math.abs(pesoBulto - kgTarget) <= 0.015;
        }
        return (
            Math.abs(pesoBulto - num) <= 0.05 ||
            Math.abs(pesoFrac - num) <= 0.05 ||
            (art.es_articulo_padre && packU === num)
        );
    }

    /**
     * Parsea una consulta escrita en el buscador extrayendo filtros acumulativos inline:
     * - "mayor que 2", "menor que 2", "< 2", "> 2", "<= 2", ">= 5", "hasta 2", "mas de 2", "fracciones chicas"
     * - "por 10", "x 10", "de 10", "por 500"
     * - "articulo padre", "padre", "combo", "pack" / "individual"
     * - "linea 1", "ldn 1", "linea 3", "ldn 3"
     * - Grupos de caracteres restantes (AND acumulativo sobre la Bolsa Universal)
     */
    function parsearConsultaCumulativaAsistenteWa(rawQuery) {
        let q = normalizarTextoBusquedaAsistenteWa(rawQuery || '');
        const resultado = {
            terminos: [],
            fraccionesInline: [],
            presentaciones: [],
            ldnsInline: [],
            tipoPadreInline: null
        };
        if (!q) return resultado;

        // 1. Atajos semánticos de tamaño de fracción
        q = q.replace(/\bfraccion(?:es)?\s+chicas?\b/g, () => {
            resultado.fraccionesInline.push({ op: '<=', kg: 2 });
            return ' ';
        });
        q = q.replace(/\bfraccion(?:es)?\s+grandes?\b/g, () => {
            resultado.fraccionesInline.push({ op: '>=', kg: 5 });
            return ' ';
        });

        // 2. Comparadores de fracción escritos en texto ("mayor o igual a 2", "menor o igual a 2", "mayor que 2", "menor que 2", "<= 2", "< 2", "> 2", etc.)
        const consumirFraccion = (regex, op) => {
            q = q.replace(regex, (_, numStr, uStr) => {
                const n = parseFloat(String(numStr).replace(',', '.'));
                if (Number.isFinite(n) && n > 0) {
                    const u = String(uStr || '').toLowerCase();
                    const kg = (u.startsWith('g') || n >= 50) ? (n / 1000) : n;
                    resultado.fraccionesInline.push({ op, kg });
                }
                return ' ';
            });
        };

        consumirFraccion(/(?:^|\s)(?:fraccion(?:es)?\s+)?(?:mayor(?:es)?\s+o\s+igual(?:es)?\s+(?:que|a|de)|desde|>=)\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|k|g|gr|gramos?)?(?=\s|$)/g, '>=');
        consumirFraccion(/(?:^|\s)(?:fraccion(?:es)?\s+)?(?:menor(?:es)?\s+o\s+igual(?:es)?\s+(?:que|a|de)|hasta|<=)\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|k|g|gr|gramos?)?(?=\s|$)/g, '<=');
        consumirFraccion(/(?:^|\s)(?:fraccion(?:es)?\s+)?(?:mayor(?:es)?\s+(?:que|a|de)|mayor(?:es)?|mas\s+de|>)\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|k|g|gr|gramos?)?(?=\s|$)/g, '>');
        consumirFraccion(/(?:^|\s)(?:fraccion(?:es)?\s+)?(?:menor(?:es)?\s+(?:que|a|de)|menor(?:es)?|menos\s+de|<)\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|k|g|gr|gramos?)?(?=\s|$)/g, '<');
        consumirFraccion(/(?:^|\s)(?:fraccion(?:es)?\s+)?(?:igual(?:es)?\s+a|=)\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|k|g|gr|gramos?)?(?=\s|$)/g, '=');

        // 3. Línea de Negocio inline ("linea de negocio 1", "linea 3", "ldn 3", "flujo 2")
        q = q.replace(/(?:^|\s)(?:linea\s+de\s+negocio|linea|ldn|flujo)\s*([1-6])(?=\s|$)/g, (_, numLdn) => {
            resultado.ldnsInline.push(Number(numLdn));
            return ' ';
        });

        // 4. Artículo Padre / Combo / Pack vs Individuales inline
        q = q.replace(/(?:^|\s)(?:sin\s+articulos?\s+padres?|sin\s+padres?|sin\s+combos?|solo\s+individual(?:es)?|individual(?:es)?)(?=\s|$)/g, () => {
            resultado.tipoPadreInline = 'SOLO_INDIVIDUAL';
            return ' ';
        });
        q = q.replace(/(?:^|\s)(?:articulos?\s+padres?|padres?|combos?|packs?)(?=\s|$)/g, () => {
            resultado.tipoPadreInline = 'SOLO_PADRE';
            return ' ';
        });

        // 5. Presentaciones puntuales ("por 10", "x 10", "de 10", "por 500")
        q = q.replace(/(?:^|\s)(?:por|x|de)\s*(\d+(?:[.,]\d+)?)\s*(kg|kilos?|k|g|gr|gramos?)?(?=\s|$)/g, (_, numStr, uStr) => {
            const n = parseFloat(String(numStr).replace(',', '.'));
            if (Number.isFinite(n) && n > 0) {
                resultado.presentaciones.push({ num: n, unidad: uStr || '' });
            }
            return ' ';
        });

        // 6. Ignorar conectores incompletos al final mientras el operador está escribiendo (ej: "nuez por ", "nuez mayor que ")
        q = q.replace(/(?:^|\s)(?:por|x|de|mayor|mayores|menor|menores|mayor\s+que|menor\s+que|mayor\s+a|menor\s+a|mayor\s+o|menor\s+o|mayor\s+o\s+igual|menor\s+o\s+igual|mas|menos|mas\s+de|menos\s+de|hasta|desde|igual|igual\s+a|linea|linea\s+de|linea\s+de\s+negocio|ldn|flujo|articulo|articulos|fraccion|fracciones)\s*$/g, ' ');

        resultado.terminos = q.split(/\s+/).map(s => s.trim()).filter(Boolean);
        return resultado;
    }

    /**
     * Detecta de forma determinista qué artículos del catálogo Búnker fueron mencionados
     * por el cliente en su mensaje o audio transcrito, respetando sinónimos comerciales,
     * números hablados ("un kilo", "dos kilos"), variedades ("turcos", "cajú") y exclusiones
     * explícitas ("el mix ese no te lo pido por ahora").
     */
    function detectarArticulosMencionadosEnTextoWa(textoRaw, todosArticulos = [], idsHabituales = new Set()) {
        const textoSinPrefijo = String(textoRaw || '')
            .replace(/^🎤\s*Audio:\s*/i, '')
            .replace(/^["'«»]+|["'«»]+$/g, '')
            .trim();
        let norm = normalizarTextoBusquedaAsistenteWa(textoSinPrefijo);
        if (!norm || norm === 'mensaje de audio' || !Array.isArray(todosArticulos) || todosArticulos.length === 0) {
            return { articulosMencionadosChat: [], idsPreseleccionados: [], conceptosNegados: new Set(), tokensNegados: [] };
        }

        // Normalizar fonéticas comunes de Whisper antes de evaluar conceptos y kilos
        norm = norm
            .replace(/\b(?:los\s+)?sigos\s+turcos\b/g, 'los higos turcos')
            .replace(/\bigosturcos?\b/g, 'higos turcos')
            .replace(/\bcastanhas?\b/g, 'castanas')
            .replace(/\bcajon\b/g, 'caju');

        // Convertir números en letras frecuentes en audios ("un kilo", "dos kilos", "por un kilo o por dos")
        const normConNumeros = norm
            .replace(/\bmedio\s+(?=kilos?|kg\b)/g, '0.5 ')
            .replace(/\b(?:un|uno|una)\b(?=\s*(?:kilos?|kg\b|o\s+dos|o\s+2))/g, '1')
            .replace(/\bdos\b(?=\s*(?:kilos?|kg\b|$|[.,;]))/g, '2')
            .replace(/\btres\b(?=\s*(?:kilos?|kg\b|$|[.,;]))/g, '3')
            .replace(/\bcuatro\b(?=\s*(?:kilos?|kg\b|$|[.,;]))/g, '4')
            .replace(/\bcinco\b(?=\s*(?:kilos?|kg\b|$|[.,;]))/g, '5')
            .replace(/\bdiez\b(?=\s*(?:kilos?|kg\b|$|[.,;]))/g, '10')
            .replace(/\bveinte\b(?=\s*(?:kilos?|kg\b|$|[.,;]))/g, '20')
            .replace(/\bveinticinco\b(?=\s*(?:kilos?|kg\b|$|[.,;]))/g, '25');

        // 1. Extraer presentaciones en kilos mencionadas en el texto (ej: "por un kilo, por dos kilos", "por 1 kilo, por 2")
        const kilosPedidos = new Set();
        const regexKilos = /\b(\d+(?:[.,]\d+)?)\s*(?:kilos?|kg|k)\b/gi;
        let mKg;
        while ((mKg = regexKilos.exec(normConNumeros)) !== null) {
            const val = parseFloat(String(mKg[1]).replace(',', '.'));
            if (Number.isFinite(val) && val > 0) kilosPedidos.add(val);
        }
        const regexRangoKilos = /\b(?:por|de|x)\s*(\d+(?:[.,]\d+)?)\s*(?:kilos?|kg|k)?\s*(?:,|\bo\b|\by\b)\s*(?:por|de|x)?\s*(\d+(?:[.,]\d+)?)\b/gi;
        let mRango;
        while ((mRango = regexRangoKilos.exec(normConNumeros)) !== null) {
            const v1 = parseFloat(String(mRango[1]).replace(',', '.'));
            const v2 = parseFloat(String(mRango[2]).replace(',', '.'));
            if (Number.isFinite(v1) && v1 > 0) kilosPedidos.add(v1);
            if (Number.isFinite(v2) && v2 > 0) kilosPedidos.add(v2);
        }

        // 2. Diccionario de conceptos de producto -> términos que deben buscarse en _bolsaBusqueda
        const reglasConceptos = [
            { id: 'fruta_abrillantada', trigger: /\b(abrillantad[ao]s?|brillantad[ao]s?|escurrid[ao]s?|escurrd[ao]s?)\b/, matchTokens: ['escurrida', 'escurrda', 'abrillantada'], peso: 6 },
            { id: 'fruta_glaseada', trigger: /\b(glasead[ao]s?|glaciad[ao]s?|glsdo)\b/, matchTokens: ['glasead', 'glsdo', 'frutas glaseadas'], peso: 5 },
            { id: 'nuez', trigger: /\b(nuez|nueces|chandler|mariposa|pecan)\b/, matchTokens: ['nuez', 'pecan'], peso: 4 },
            { id: 'almendra', trigger: /\b(almendras?|non\s*pareil|guara|carmel|filetead[ao]s?)\b/, matchTokens: ['almendra'], peso: 4 },
            { id: 'castana_caju', trigger: /\b(castanas?|caju)\b/, matchTokens: ['castana', 'caju'], peso: 5 },
            { id: 'pistacho', trigger: /\b(pistachos?)\b/, matchTokens: ['pistacho'], peso: 5 },
            { id: 'avellana', trigger: /\b(avellanas?)\b/, matchTokens: ['avellana'], peso: 5 },
            { id: 'pasas', trigger: /\b(pasas?|uva\s+rubia|uva\s+negra|jumbo|flame|sultanina|morena)\b/, matchTokens: ['pasa', 'uva'], peso: 4 },
            { id: 'ciruela', trigger: /\b(ciruelas?|presidente|bombon|d\s*agen)\b/, matchTokens: ['ciruela'], peso: 4 },
            { id: 'arandano', trigger: /\b(arandanos?)\b/, matchTokens: ['arandano'], peso: 5 },
            { id: 'datil', trigger: /\b(datil|datiles|medjoul|deglet)\b/, matchTokens: ['datil'], peso: 5 },
            { id: 'higo', trigger: /\b(higos?)\b/, matchTokens: ['higo'], peso: 5 },
            { id: 'damasco', trigger: /\b(damascos?|damazcos?)\b/, matchTokens: ['damasco', 'damazco'], peso: 5 },
            { id: 'kiwi', trigger: /\b(kiwis?)\b/, matchTokens: ['kiwi'], peso: 5 },
            { id: 'jengibre', trigger: /\b(jengibres?)\b/, matchTokens: ['jengibre'], peso: 5 },
            { id: 'naranja', trigger: /\b(naranjas?)\b/, matchTokens: ['naranja'], peso: 5 },
            { id: 'mix', trigger: /\b(mix|mixes)\b/, matchTokens: ['mix'], peso: 4 },
            { id: 'granola', trigger: /\b(granolas?)\b/, matchTokens: ['granola'], peso: 4 },
            { id: 'barrita', trigger: /\b(barritas?)\b/, matchTokens: ['barrita'], peso: 4 },
            { id: 'coco', trigger: /\b(coco)\b/, matchTokens: ['coco'], peso: 4 },
            { id: 'mani', trigger: /\b(mani|manies)\b/, matchTokens: ['mani'], peso: 4 },
            { id: 'semilla', trigger: /\b(semillas?|girasol|chia|sesamo|lino|zapallo|amapola)\b/, matchTokens: ['semilla', 'girasol', 'chia', 'sesamo', 'lino', 'zapallo', 'amapola'], peso: 4 },
            { id: 'legumbre', trigger: /\b(lentejas?|lentejon|garbanzos?|porotos?|quinoa)\b/, matchTokens: ['lenteja', 'lentejon', 'garbanzo', 'poroto', 'quinoa'], peso: 4 },
            { id: 'cereal', trigger: /\b(avena|arroz|basmati|yamani)\b/, matchTokens: ['avena', 'arroz', 'basmati', 'yamani'], peso: 4 },
            { id: 'azucar', trigger: /\b(azucar|mascabo)\b/, matchTokens: ['azucar', 'mascabo'], peso: 5 },
            { id: 'miel', trigger: /\b(miel)\b/, matchTokens: ['miel'], peso: 5 },
            { id: 'harina', trigger: /\b(harinas?)\b/, matchTokens: ['harina'], peso: 4 },
            { id: 'vainilla', trigger: /\b(vainilla|esencia)\b/, matchTokens: ['vainilla', 'esencia'], peso: 5 }
        ];

        // 2b. Detectar conceptos explícitamente NEGADOS por el cliente (ej: "El mix ese no te lo pido por ahora", "el mix no", "sin mix")
        const conceptosNegados = new Set();
        const tokensNegados = [];
        for (const r of reglasConceptos) {
            if (!r.trigger.test(norm)) continue;
            const src = r.trigger.source;
            const regNegDespues = new RegExp(`${src}(?:\\s+es[ea]|\\s+est[ea]|\\s+de\\s+frutos\\s+secos)?(?:\\s+por\\s+ahora)?\\s+no\\b`, 'i');
            const regNegAntes = new RegExp(`\\b(?:no\\s+(?:te\\s+)?(?:lo\\s+)?(?:pido|quiero|necesito|mandes|mande|agregues|incluyas)|sin|salvo|excepto|menos)\\s+(?:el\\s+|la\\s+|los\\s+|las\\s+)?${src}`, 'i');
            if (regNegDespues.test(norm) || regNegAntes.test(norm)) {
                conceptosNegados.add(r.id);
                r.matchTokens.forEach(t => {
                    if (!tokensNegados.includes(t)) tokensNegados.push(t);
                });
            }
        }

        const conceptosActivos = reglasConceptos.filter(r => r.trigger.test(norm) && !conceptosNegados.has(r.id));
        if (conceptosActivos.length === 0) {
            return { articulosMencionadosChat: [], idsPreseleccionados: [], conceptosNegados, tokensNegados };
        }

        const pidioHigoTurco = /\bturcos?\b/.test(norm);
        const pidioCaju = /\bcaju\b/.test(norm);
        const pidioTostadoOSalado = /\b(tostad[ao]s?|salad[ao]s?)\b/.test(norm);
        const maxKgPedido = kilosPedidos.size > 0 ? Math.max(...Array.from(kilosPedidos)) : 0;

        const candidatosConScore = [];
        for (const art of todosArticulos) {
            const bolsa = String(art._bolsaBusqueda || '');
            // Excluir terminantemente cualquier artículo que pertenezca a un concepto negado (ej. "el mix ese no")
            if (tokensNegados.length > 0 && tokensNegados.some(tok => bolsa.includes(tok))) {
                continue;
            }

            let score = 0;
            const conceptosCubiertos = [];

            for (const c of conceptosActivos) {
                if (c.matchTokens.some(tok => bolsa.includes(tok))) {
                    score += c.peso;
                    conceptosCubiertos.push(c.id);
                }
            }
            if (score <= 0) continue;

            // Sub-especificidad para Higos (Turco vs Negro)
            if (conceptosCubiertos.includes('higo') && pidioHigoTurco) {
                if (bolsa.includes('turco')) {
                    score += 10;
                } else {
                    score -= 8;
                }
            }

            // Sub-especificidad para Castañas (Cajú vs Pará, Natural vs Tostado/Salado)
            if (conceptosCubiertos.includes('castana_caju')) {
                if (pidioCaju) {
                    if (bolsa.includes('caju')) score += 8;
                    else if (bolsa.includes('para')) score -= 8;
                }
                const nomNorm = normalizarTextoBusquedaAsistenteWa(art.nombre);
                if (!pidioTostadoOSalado) {
                    if (!/\b(tost|totdo|sal)\b/.test(nomNorm) && !bolsa.includes('tostad') && !bolsa.includes('salad')) {
                        score += 4;
                    }
                }
            }

            // Bonus si el cliente mencionó "fruta" y el artículo tiene "fruta" en su nombre
            if (/\bfrutas?\b/.test(norm) && normalizarTextoBusquedaAsistenteWa(art.nombre).includes('fruta')) {
                score += 4;
            }

            // Bonus fuerte si coincide con la presentación en kilos pedida (ej: "por 1 kilo o por 2 kilos")
            const kgArt = Number(art.kilos_unidad || art.peso_bulto || 0);
            if (kilosPedidos.size > 0 && kgArt > 0) {
                let coincidioKg = false;
                for (const kgPed of kilosPedidos) {
                    if (Math.abs(kgArt - kgPed) < 0.05) {
                        score += 8;
                        coincidioKg = true;
                        break;
                    }
                }
                if (!coincidioKg && maxKgPedido >= 1 && kgArt < 0.5) {
                    // Penalizar bolsitas de 150g cuando el cliente pide por 1kg o 2kg
                    score -= 5;
                }
            }

            // Bonus si es artículo habitual del cliente
            if (idsHabituales && idsHabituales.has(String(art.id))) {
                score += 2;
            }

            // Bonus si tiene stock positivo
            if (Number(art.stock_real || 0) > 0) {
                score += 2;
            }

            if (score <= 0) continue;

            candidatosConScore.push({
                art,
                score,
                conceptosCubiertos
            });
        }

        candidatosConScore.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const kgA = Number(a.art.kilos_unidad || a.art.peso_bulto || 0);
            const kgB = Number(b.art.kilos_unidad || b.art.peso_bulto || 0);
            return kgA - kgB;
        });

        const seleccionadosTop = candidatosConScore.slice(0, 14).map(x => x.art);
        const articulosMencionadosChat = ordenarArticulosPorJerarquiaB2BWa(seleccionadosTop);

        // Pre-seleccionar automáticamente los mejores candidatos de cada concepto mencionado por el cliente
        // Si pidió varias presentaciones ("por 1 kilo o por 2 kilos"), incluir hasta 2 presentaciones por producto (máx 8 total)
        const idsPreseleccionados = [];
        const pideMultiplesPresentaciones = kilosPedidos.size >= 2 || /\b(presentacion|presentaciones|de\s+cuanto\s+vienen|por\s+cuanto\s+vienen)\b/.test(norm);
        for (const c of conceptosActivos) {
            const candsConcepto = candidatosConScore.filter(item => item.conceptosCubiertos.includes(c.id));
            if (candsConcepto.length === 0) continue;

            const maxPorConcepto = (pideMultiplesPresentaciones || c.id === 'fruta_glaseada' || c.id === 'higo' || c.id === 'avellana') ? 2 : 1;
            let agregadosConcepto = 0;
            const kilosYaCubiertosConcepto = new Set();

            for (const item of candsConcepto) {
                const idStr = String(item.art.id);
                const kgItem = Math.round(Number(item.art.kilos_unidad || item.art.peso_bulto || 1) * 100) / 100;
                // Evitar agregar dos calibres distintos de exactamente el mismo pesaje (ej. dos cajas de 10kg de avellanas)
                if (agregadosConcepto > 0 && kilosYaCubiertosConcepto.has(kgItem)) continue;
                if (!idsPreseleccionados.includes(idStr)) {
                    idsPreseleccionados.push(idStr);
                    kilosYaCubiertosConcepto.add(kgItem);
                    agregadosConcepto++;
                }
                if (agregadosConcepto >= maxPorConcepto || idsPreseleccionados.length >= 8) break;
            }
            if (idsPreseleccionados.length >= 8) break;
        }

        return {
            articulosMencionadosChat,
            idsPreseleccionados,
            conceptosNegados,
            tokensNegados
        };
    }

    /**
     * Analiza los últimos mensajes del chat (TANTO del cliente como nuestros propios mensajes enviados)
     * para saber si la conversación recién arranca hoy o si YA está en marcha hoy (< 8 horas),
     * evitando volver a saludar ("Hola X, ¿cómo estás?") cuando ya estamos conversando hoy.
     */
    function detectarIntencionConversacionWa(mensajes = []) {
        const lista = (Array.isArray(mensajes) ? mensajes : []).filter(m => String(m?.cuerpo || '').trim().length > 0);
        const entrantes = lista.filter(m => !m.from_me);
        const salientes = lista.filter(m => Boolean(m.from_me));

        const ultimoMensaje = lista.length > 0 ? lista[lista.length - 1] : null;
        const ultimoEntranteObj = entrantes.length > 0 ? entrantes[entrantes.length - 1] : null;
        const ultimoSalienteObj = salientes.length > 0 ? salientes[salientes.length - 1] : null;

        const ultimoEntrante = ultimoEntranteObj ? String(ultimoEntranteObj.cuerpo || '').trim() : '';
        const ultimoSaliente = ultimoSalienteObj ? String(ultimoSalienteObj.cuerpo || '').trim() : '';

        // Determinar si ya estamos conversando HOY (en las últimas 8 horas)
        const ahoraMs = Date.now();
        const obtenerMs = (m) => {
            if (!m) return 0;
            if (m.timestamp_wa && Number(m.timestamp_wa) > 1000000000) {
                const ts = Number(m.timestamp_wa);
                return ts < 10000000000 ? ts * 1000 : ts;
            }
            const f = m.fecha_mensaje || m.creado_en || m.fecha;
            const parsed = f ? new Date(f).getTime() : 0;
            return Number.isFinite(parsed) ? parsed : 0;
        };

        const idxUltimoEntrante = ultimoEntranteObj ? lista.lastIndexOf(ultimoEntranteObj) : -1;
        const idxUltimoSaliente = ultimoSalienteObj ? lista.lastIndexOf(ultimoSalienteObj) : -1;
        const msUltimoGeneral = obtenerMs(ultimoMensaje);
        const msUltimoSaliente = obtenerMs(ultimoSalienteObj);

        // Regla estricta: solo es "charla en curso" si hubo actividad real en las últimas 8 horas.
        // Si el último mensaje fue ayer o hace 5 días, NO está en curso hoy y corresponde saludar!
        const charlaEnCurso = msUltimoGeneral > 0 ? ((ahoraMs - msUltimoGeneral) < (8 * 3600 * 1000)) : false;
        const respondimosAlUltimo = idxUltimoSaliente > idxUltimoEntrante && idxUltimoSaliente !== -1;

        // Detectar si nuestro último mensaje de hoy fue una promesa puente ("en un ratin te paso todo", "ya te paso", "ahí te paso", "dale", "aguantame")
        const normSaliente = normalizarTextoBusquedaAsistenteWa(ultimoSaliente);
        const normUltEntRaw = normalizarTextoBusquedaAsistenteWa(ultimoEntrante);
        const esUltEntAcuseCorto = Boolean(
            ultimoEntrante.length > 0 &&
            ultimoEntrante.length <= 35 &&
            /^(ok|oki|okay|dale|genial|joya|barbaro|perfecto|listo|buenisimo|gracias|muchas gracias|mil gracias|de diez)\b/i.test(normUltEntRaw)
        );
        const prometimosPasarRecien = Boolean(
            charlaEnCurso &&
            (respondimosAlUltimo || esUltEntAcuseCorto) &&
            /(en un ratin|en un ratito|en un rato|te paso todo|ya te paso|ahi te paso|ahora te paso|ya te mando|ahi te mando|ahora te mando|aguantame|dame un segundo|dame un ratito|ahi me fijo|ya me fijo|dale|por supuesto|enseguida)/.test(normSaliente)
        );

        // Detectar si hoy ya le enviamos el link del portal
        const salientesRecientesTexto = salientes.slice(-3).map(m => String(m.cuerpo || '')).join(' ');
        const yaEnviamosLinkRecien = charlaEnCurso && /workers\.dev|portal/i.test(salientesRecientesTexto);

        const ultimosEntrantesTexto = entrantes.slice(-3).map(m => String(m.cuerpo || '')).join(' ');
        const norm = normalizarTextoBusquedaAsistenteWa(ultimosEntrantesTexto);
        const normUltEnt = (esUltEntAcuseCorto && prometimosPasarRecien) ? norm : normUltEntRaw;

        const diasDesdeUltimo = msUltimoGeneral > 0 ? Math.floor((ahoraMs - msUltimoGeneral) / (24 * 3600 * 1000)) : null;
        const fechaUltTxt = msUltimoGeneral > 0
            ? new Date(msUltimoGeneral).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
            : '';

        const notaApertura = charlaEnCurso
            ? (prometimosPasarRecien
                ? `Ya le respondiste "${ultimoSaliente.slice(0, 40)}" → continúa directo sin volver a saludar.`
                : `Charla activa hoy → sin saludo repetido.`)
            : `Último contacto ${diasDesdeUltimo !== null ? (diasDesdeUltimo === 0 ? 'hace unas horas' : `hace ${diasDesdeUltimo}d (${fechaUltTxt})`) : 'sin historial'} → Iniciar con saludo corto.`;

        if (!ultimoEntrante && !ultimoSaliente) {
            return {
                codigo: 'INICIAR_CONTACTO',
                etiqueta: '👋 Iniciar conversación comercial',
                pasoSugerido: 'PASO_1_PORTAL',
                charlaEnCurso: false,
                prometimosPasarRecien: false,
                yaEnviamosLinkRecien: false,
                ultimoRecibido: '',
                ultimoEnviado: '',
                explicacionAgente: 'Conversación desde cero: saluda al cliente, comparte su link de Portal y pregunta qué artículos necesita.'
            };
        }

        // Prioridad 1: si en el último mensaje pregunta el precio de productos puntuales (o dice "no me puedo meter en la página, me decís el precio de...")
        const mencionaProductoPuntual = /\b(fruta|abrillantad[ao]|brillantad[ao]|escurrid[ao]|glasead[ao]|glaciad[ao]|nuez|nueces|almendras?|castanas?|caju|pistachos?|avellanas?|pasas?|ciruelas?|arandanos?|datil|datiles|higos?|damascos?|kiwis?|jengibres?|naranjas?|mix|granolas?|barritas?|coco|mani|semillas?|girasol|chia|sesamo|lino|zapallo|amapola|lentejas?|garbanzos?|porotos?|quinoa|avena|arroz|azucar|mascabo|miel|harinas?|vainilla)\b/.test(normUltEnt);
        if (mencionaProductoPuntual && /(cuanto|precio|valor|decis|pasas|pasame|tenes|hay|stock|kilos?|kg)/.test(normUltEnt)) {
            return {
                codigo: 'CONSULTA_PRECIO_PRODUCTO',
                etiqueta: /^🎤\s*Audio:/i.test(ultimoEntrante) ? '🎙️ Consulta Precio por Audio' : '💲 Consulta Precio / Producto Puntual',
                pasoSugerido: 'PASO_3_PRODUCTOS',
                charlaEnCurso,
                prometimosPasarRecien,
                yaEnviamosLinkRecien,
                ultimoRecibido: ultimoEntrante,
                ultimoEnviado: ultimoSaliente,
                explicacionAgente: `${notaApertura} El cliente consultó por artículos puntuales; el asistente ya los pre-seleccionó para pasarle el valor exacto.`
            };
        }

        if (/(lista|catalogo|catálogo|pasas lista|pasar lista|tenes lista|mandame lista|mandar lista)/.test(norm)) {
            const pasoSug = yaEnviamosLinkRecien ? 'PASO_2_EXPLICAR_PORTAL' : 'PASO_1_PORTAL';
            return {
                codigo: 'PIDE_LISTA_PRECIOS',
                etiqueta: charlaEnCurso ? '📋 Pide Lista (Charla ya iniciada)' : '📋 Pide Lista de Precios / Catálogo',
                pasoSugerido: pasoSug,
                charlaEnCurso,
                prometimosPasarRecien,
                yaEnviamosLinkRecien,
                ultimoRecibido: ultimoEntrante,
                ultimoEnviado: ultimoSaliente,
                explicacionAgente: `${notaApertura} ${yaEnviamosLinkRecien ? 'Como ya le pasaste el link recién, te sugerimos el Paso 2 o 3.' : 'Pasa el link corto de su Portal y pregunta qué artículo busca.'}`
            };
        }

        if (/(cuanto|cuánto|precio|valor|tenes|tenés|hay|stock)/.test(norm) || mencionaProductoPuntual) {
            return {
                codigo: 'CONSULTA_PRECIO_PRODUCTO',
                etiqueta: /^🎤\s*Audio:/i.test(ultimoEntrante) ? '🎙️ Consulta Precio por Audio' : '💲 Consulta Precio / Producto Puntual',
                pasoSugerido: 'PASO_3_PRODUCTOS',
                charlaEnCurso,
                prometimosPasarRecien,
                yaEnviamosLinkRecien,
                ultimoRecibido: ultimoEntrante,
                ultimoEnviado: ultimoSaliente,
                explicacionAgente: `${notaApertura} Tildá abajo los artículos que busca o los que suele comprar para pasarle el valor exacto.`
            };
        }

        if (/(portal|link|clave|contrasena|contraseña|entrar|ingresar|pagina|página|web|pedido)/.test(norm)) {
            return {
                codigo: 'CONSULTA_PORTAL',
                etiqueta: '🌐 Consulta sobre Portal / Pedido',
                pasoSugerido: 'PASO_2_EXPLICAR_PORTAL',
                charlaEnCurso,
                prometimosPasarRecien,
                yaEnviamosLinkRecien,
                ultimoRecibido: ultimoEntrante,
                ultimoEnviado: ultimoSaliente,
                explicacionAgente: `${notaApertura} Podés explicarle en 3 líneas cómo usar el Portal B2B o pasarle su link corto.`
            };
        }

        return {
            codigo: 'CONVERSACION_ACTIVA',
            etiqueta: charlaEnCurso ? '💬 Charla en curso (Sin saludo repetido)' : '👋 Responder al cliente',
            pasoSugerido: yaEnviamosLinkRecien ? 'PASO_3_PRODUCTOS' : 'PASO_1_PORTAL',
            charlaEnCurso,
            prometimosPasarRecien,
            yaEnviamosLinkRecien,
            ultimoRecibido: ultimoEntrante,
            ultimoEnviado: ultimoSaliente,
            explicacionAgente: notaApertura
        };
    }

    let cacheJerarquiaB2BWa = null;
    let cacheJerarquiaB2BTimestampWa = 0;
    let cacheClientesAfectadosPreciosWa = null;
    let cacheClientesAfectadosTimestampWa = 0;

    async function obtenerCatalogoDinamicoAsistenteWa() {
        const ahora = Date.now();
        if (cacheCatalogoAsistenteWa && (ahora - cacheCatalogoTimestampWa) < 600000) {
            return cacheCatalogoAsistenteWa;
        }
        const [res, resBunker, resListasBunker, resClisBunker, resMixesBunker] = await Promise.all([
            fetch('/api/crm/catalogo-dinamico').catch(() => null),
            fetch('/api/logistica/bunker/listado').catch(() => null),
            fetch('/api/logistica/bunker/listas').catch(() => null),
            fetch('/api/logistica/bunker/clientes').catch(() => null),
            fetch('/api/logistica/bunker/mixes-composicion').catch(() => null)
        ]);
        const data = res ? await res.json().catch(() => null) : null;
        const dataBunker = resBunker ? await resBunker.json().catch(() => null) : null;
        const dataListasBunker = resListasBunker ? await resListasBunker.json().catch(() => null) : null;
        const dataClisBunker = resClisBunker ? await resClisBunker.json().catch(() => null) : null;
        const dataMixesBunker = resMixesBunker ? await resMixesBunker.json().catch(() => null) : null;

        const mixesComposicionMap = (dataMixesBunker && dataMixesBunker.success && dataMixesBunker.data && typeof dataMixesBunker.data === 'object')
            ? dataMixesBunker.data
            : {};

        const mapaClis = new Map();
        if (dataClisBunker && dataClisBunker.success && Array.isArray(dataClisBunker.data)) {
            for (const c of dataClisBunker.data) {
                const entry = {
                    id: Number(c.id),
                    lomas_soft_id: c.lomas_soft_id ? String(c.lomas_soft_id).trim() : '',
                    codigo_bunker_cliente: c.codigo_bunker_cliente ? String(c.codigo_bunker_cliente).trim() : '',
                    listas_precios: Array.isArray(c.listas_precios) ? c.listas_precios : []
                };
                if (c.id) mapaClis.set(`ID_${Number(c.id)}`, entry);
                if (c.codigo_bunker_cliente) mapaClis.set(`CB_${String(c.codigo_bunker_cliente).trim().toUpperCase()}`, entry);
                if (c.lomas_soft_id) {
                    const lNum = parseInt(String(c.lomas_soft_id).replace(/\D/g, ''), 10);
                    if (!isNaN(lNum) && lNum > 0) mapaClis.set(`LOMAS_${lNum}`, entry);
                }
            }
        }

        const listasFinales = (dataListasBunker && dataListasBunker.success && Array.isArray(dataListasBunker.data) && dataListasBunker.data.length > 0)
            ? dataListasBunker.data
            : (Array.isArray(data?.listas) ? data.listas : []);

        // 1. Fuente de Verdad Primaria: /api/logistica/bunker/listado (idéntica a Artículos Búnker)
        if (dataBunker && dataBunker.success && Array.isArray(dataBunker.data) && dataBunker.data.length > 0) {
            const mapaCatCrm = new Map();
            if (data && data.success && Array.isArray(data.articulos)) {
                for (const cArt of data.articulos) {
                    const k = String(cArt.articulo_id || cArt.codigo_unico || cArt.id || '').trim().toUpperCase();
                    if (k) mapaCatCrm.set(k, cArt);
                }
            }

            const ldnNombres = {
                1: 'LDN 1: Bulto Cerrado',
                2: 'LDN 2: Fraccionado',
                3: 'LDN 3: Mixes',
                4: 'LDN 4: UP Tostadero',
                5: 'LDN 5: Barritas',
                6: 'LDN 6: Granolas'
            };

            const articulosUnificados = [];
            for (const bArt of dataBunker.data) {
                if (!bArt || bArt.deshabilitado === true || bArt.deshabilitado === 'true' || bArt.deshabilitado === 1) continue;
                const famNom = String(bArt.familia_nombre || bArt.rubro || 'General').trim();
                const nombreVisible = String(bArt.descripcion_generada || bArt.descripcion || bArt.articulo_id || '').trim();
                const descUp = nombreVisible.toUpperCase();
                if (/^(PRODUCCION|INSUMOS)$/i.test(famNom)) continue;
                if (descUp.startsWith('PROD AP') || descUp.startsWith('PROD UP') || descUp.startsWith('CARRO MIX')) continue;

                const kUp = String(bArt.articulo_id || '').trim().toUpperCase();
                const cArt = mapaCatCrm.get(kUp) || null;
                const props = (bArt.propiedades_dinamicas && typeof bArt.propiedades_dinamicas === 'object') ? bArt.propiedades_dinamicas : {};
                const kilosUnidad = parseFloat(bArt.kilos_unidad) || 1;
                const packUnidades = Math.max(1, parseInt(bArt.pack_unidades, 10) || 1);
                const matchComboDesc = nombreVisible.match(/(?<![/\-\d]\s*)\b(\d+)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(g|gr|kg|k)\b/i);
                const esArticuloPadre = Boolean(
                    (bArt.es_pack === true && packUnidades > 1 && kilosUnidad > 0) ||
                    (packUnidades > 1 && kilosUnidad > 0) ||
                    matchComboDesc
                );
                let kilosFraccion = kilosUnidad;
                if (esArticuloPadre) {
                    if (packUnidades > 1 && kilosUnidad > 0) {
                        kilosFraccion = parseFloat((kilosUnidad / packUnidades).toFixed(3));
                    } else if (matchComboDesc) {
                        const valNum = parseFloat(String(matchComboDesc[2]).replace(',', '.')) || 1;
                        const uStr = String(matchComboDesc[3] || '').toLowerCase();
                        kilosFraccion = uStr.startsWith('g') ? parseFloat((valNum / 1000).toFixed(3)) : valNum;
                    }
                }

                const keyLow = kUp.toLowerCase();
                const descLow = nombreVisible.toLowerCase();
                const totalRecetas = parseInt(bArt.total_recetas || cArt?.total_recetas || 0, 10) || 0;
                const tienePackHijo = Boolean(bArt.pack_hijo_codigo && String(bArt.pack_hijo_codigo).trim() !== '');
                const noProducido = bArt.no_producido_por_lambda === true;

                let lineaNegocio = cArt?.linea_negocio || 1;
                if (!cArt?.linea_negocio) {
                    if (keyLow.startsWith('bf') || keyLow.includes('bfx') || descLow.includes('barrita') || descLow.includes('barr.') || descLow.startsWith('barra ')) {
                        lineaNegocio = 5;
                    } else if (descLow.includes('granola') || descLow.includes('grana ')) {
                        lineaNegocio = 6;
                    } else if (keyLow.startsWith('prod up') || keyLow.includes('tostad') || descLow.includes('tostad') || descLow.includes('tost/sal') || descLow.includes('tost/') || props.presentacion_variable_wip) {
                        lineaNegocio = 4;
                    } else if (descLow.includes('mix') || /^m(?:fs|ct|sp|st|s\d|s[x])/i.test(keyLow)) {
                        lineaNegocio = 3;
                    } else if (totalRecetas > 0 || (tienePackHijo && !noProducido)) {
                        lineaNegocio = 2;
                    }
                }

                const preciosActivos = {};
                if (Array.isArray(bArt.margenes)) {
                    for (const m of bArt.margenes) {
                        if (m && m.disponible === true && Number(m.precio_final) > 0) {
                            preciosActivos[Number(m.lista_id)] = Math.round(Number(m.precio_final));
                        }
                    }
                }

                const compTxt = mixesComposicionMap[bArt.articulo_id]
                    || mixesComposicionMap[kUp]
                    || cArt?.composicion
                    || bArt.composicion
                    || '';

                articulosUnificados.push({
                    ...(cArt || {}),
                    articulo_id: bArt.articulo_id,
                    codigo_barras: cArt?.codigo_barras || bArt.codigo_barras || '',
                    descripcion: bArt.descripcion,
                    descripcion_generada: bArt.descripcion_generada,
                    nombre_visible: nombreVisible,
                    kilos_unidad: kilosUnidad,
                    kilos_fraccion: kilosFraccion,
                    es_pack: Boolean(bArt.es_pack),
                    pack_unidades: packUnidades,
                    pack_hijo_codigo: bArt.pack_hijo_codigo || null,
                    es_articulo_padre: esArticuloPadre,
                    no_producido_por_lambda: noProducido,
                    expresado_en_gramos: Boolean(cArt?.expresado_en_gramos || bArt.expresado_en_gramos),
                    expresado_en_unidades: Boolean(bArt.expresado_en_unidades),
                    total_recetas: totalRecetas,
                    linea_negocio: lineaNegocio,
                    linea_negocio_tag: `LDN ${lineaNegocio}`,
                    linea_negocio_nombre: ldnNombres[lineaNegocio] || `LDN ${lineaNegocio}`,
                    familia_id: bArt.familia_id,
                    familia_nombre: famNom,
                    articulo_principal_id: bArt.articulo_principal_id || null,
                    articulo_principal_nombre: bArt.articulo_principal_nombre || null,
                    rubro: bArt.rubro || '',
                    sub_rubro: bArt.sub_rubro || '',
                    composicion: compTxt,
                    propiedades_dinamicas: props,
                    stock_real: Math.max(0, parseFloat(Number(bArt.stock_disponible ?? bArt.stock_fisico ?? cArt?.stock_real ?? 0).toFixed(2))),
                    precios: preciosActivos
                });
            }

            const resultadoUnificado = {
                success: true,
                listas: listasFinales,
                articulos: articulosUnificados,
                mapaClientesBunkerListas: mapaClis
            };
            cacheCatalogoAsistenteWa = resultadoUnificado;
            cacheCatalogoTimestampWa = ahora;
            return resultadoUnificado;
        }

        if (data && data.success) {
            data.mapaClientesBunkerListas = mapaClis;
            if (listasFinales.length > 0) data.listas = listasFinales;
            cacheCatalogoAsistenteWa = data;
            cacheCatalogoTimestampWa = ahora;
            return data;
        }
        return { articulos: [], listas: [], mapaClientesBunkerListas: mapaClis };
    }

    /**
     * Obtiene la matriz oficial de Configurar Jerarquía B2B (/api/logistica/b2b-jerarquia)
     * para ordenar y agrupar cualquier lista o resumen de productos en 5 niveles:
     * Nivel 1: Familia -> Nivel 2: Artículo Principal -> Niveles 3, 4 y 5: Subcategorías -> Presentación (kilos DESC).
     */
    async function obtenerMapaJerarquiaB2BWa() {
        const ahora = Date.now();
        if (cacheJerarquiaB2BWa && (ahora - cacheJerarquiaB2BTimestampWa) < 600000) {
            return cacheJerarquiaB2BWa;
        }
        try {
            const res = await fetch('/api/logistica/b2b-jerarquia');
            const data = await res.json();
            if (data && data.success && Array.isArray(data.familias)) {
                const mapaPorFamiliaId = new Map();
                const mapaPorFamiliaNombre = new Map();
                const mapaReglas = new Map();
                const normKey = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

                data.familias.forEach(fam => {
                    const famId = Number(fam.familia_id || 0);
                    const famNombre = String(fam.familia_nombre || '').trim();
                    const entry = {
                        familia_id: famId,
                        familia_nombre: famNombre
                    };
                    if (famId) mapaPorFamiliaId.set(famId, entry);
                    if (famNombre) mapaPorFamiliaNombre.set(normKey(famNombre), entry);

                    if (Array.isArray(fam.articulos_principales)) {
                        fam.articulos_principales.forEach(ap => {
                            const artP = String(ap.articulo_principal || '').trim().toLowerCase();
                            const rawEjeN3 = ap.eje_nivel_3 ? String(ap.eje_nivel_3).trim().toLowerCase() : '';
                            const ejesN3 = Array.isArray(ap.ejes_nivel_3) && ap.ejes_nivel_3.length > 0
                                ? ap.ejes_nivel_3.map(s => String(s).trim().toLowerCase()).filter(Boolean)
                                : (rawEjeN3 ? rawEjeN3.split(',').map(s => s.trim()).filter(Boolean) : []);
                            const ruleObj = {
                                eje_nivel_3: rawEjeN3,
                                ejes_nivel_3: ejesN3,
                                reglas_nivel_4: ap.reglas_nivel_4 && typeof ap.reglas_nivel_4 === 'object' ? ap.reglas_nivel_4 : {},
                                reglas_nivel_5: ap.reglas_nivel_5 && typeof ap.reglas_nivel_5 === 'object' ? ap.reglas_nivel_5 : {}
                            };
                            mapaReglas.set(`${famId}___${artP}`, ruleObj);
                            mapaReglas.set(`${famId}___${normKey(artP)}`, ruleObj);
                        });
                    }
                });

                cacheJerarquiaB2BWa = { mapaPorFamiliaId, mapaPorFamiliaNombre, mapaReglas };
                cacheJerarquiaB2BTimestampWa = ahora;
                return cacheJerarquiaB2BWa;
            }
        } catch (err) {
            console.warn('[WA-JERARQUIA-B2B] No se pudo obtener /api/logistica/b2b-jerarquia:', err);
        }
        return { mapaPorFamiliaId: new Map(), mapaPorFamiliaNombre: new Map(), mapaReglas: new Map() };
    }

    function resolverJerarquiaB2BArticuloWa(art, jerarquiaData) {
        if (!art) return art;
        const normKey = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const props = (art.propiedades_dinamicas && typeof art.propiedades_dinamicas === 'object')
            ? { ...art.propiedades_dinamicas }
            : {};

        const famId = Number(art.familia_id || props.familia_id || 0);
        const famConfig = (jerarquiaData?.mapaPorFamiliaId && famId && jerarquiaData.mapaPorFamiliaId.get(famId))
            || (jerarquiaData?.mapaPorFamiliaNombre && art.familia_nombre && jerarquiaData.mapaPorFamiliaNombre.get(normKey(art.familia_nombre)))
            || null;

        const familiaB2B = String(
            art.familia_b2b
            || famConfig?.familia_nombre
            || art.familia_nombre
            || props.familia_nombre
            || 'Artículos Generales'
        ).trim();

        const rawArtPrinc = props.articulo_principal || art.articulo_principal_b2b || art.articulo_principal;
        const rawPrinc = String(
            (typeof rawArtPrinc === 'object' && rawArtPrinc !== null)
                ? (rawArtPrinc.valor || rawArtPrinc.termino || 'General')
                : (rawArtPrinc || 'General')
        ).trim();

        const posObj = (props.posiciones && typeof props.posiciones === 'object') ? props.posiciones : props;
        for (const key in posObj) {
            if (Object.prototype.hasOwnProperty.call(posObj, key)) {
                const p = posObj[key];
                if (p && typeof p === 'object' && p.eje && p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                    const ejeClean = String(p.eje).trim().toLowerCase();
                    props[ejeClean] = String(p.valor).trim();
                }
            }
        }

        // Si el artículo ya viene enriquecido desde historialPreciosService con su ruta B2B, la respetamos y limpiamos duplicados
        if (art.articulo_principal_display && art.ruta_subcategoria_b2b !== undefined) {
            const disp = String(art.articulo_principal_display).trim();
            const subParts = String(art.ruta_subcategoria_b2b || '')
                .split(/\s*›\s*/)
                .map(s => s.trim())
                .filter(s => s && normKey(s) !== normKey(disp));
            const subClean = subParts.join(' › ');
            props.familia_nombre = familiaB2B;
            props.articulo_principal = disp;
            if (subClean) props.ruta_subcategoria_b2b = subClean;
            return {
                ...art,
                familia_b2b: familiaB2B,
                familia_nombre: familiaB2B,
                articulo_principal_original: rawPrinc,
                articulo_principal_display: disp,
                articulo_principal: disp,
                ruta_subcategoria_b2b: subClean,
                ruta_jerarquia_b2b: [familiaB2B, disp, subClean].filter(Boolean).join(' › '),
                propiedades_dinamicas: props
            };
        }

        let subCategoria = null;
        let subSubCategoria = null;
        let subSubSubCategoria = null;

        const confRule = jerarquiaData?.mapaReglas
            ? (jerarquiaData.mapaReglas.get(`${famId}___${rawPrinc.toLowerCase()}`)
                || jerarquiaData.mapaReglas.get(`${famId}___${normKey(rawPrinc)}`)
                || null)
            : null;

        const buscarValorEnPosiciones = (targetEje) => {
            const tNorm = normKey(targetEje);
            if (!tNorm) return null;
            for (const key in posObj) {
                if (Object.prototype.hasOwnProperty.call(posObj, key)) {
                    const p = posObj[key];
                    if (p && typeof p === 'object' && p.eje && normKey(p.eje) === tNorm) {
                        if (p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                            return String(p.valor).trim();
                        }
                    }
                }
            }
            return null;
        };

        if (confRule) {
            const targetEjesN3 = Array.isArray(confRule.ejes_nivel_3) && confRule.ejes_nivel_3.length > 0
                ? confRule.ejes_nivel_3
                : (confRule.eje_nivel_3 ? [confRule.eje_nivel_3] : []);
            for (const eje3 of targetEjesN3) {
                const v3 = buscarValorEnPosiciones(eje3);
                if (v3) {
                    subCategoria = v3;
                    break;
                }
            }

            if (subCategoria && confRule.reglas_nivel_4) {
                const cfgN4 = confRule.reglas_nivel_4[subCategoria] || null;
                if (cfgN4) {
                    const ejesN4 = Array.isArray(cfgN4)
                        ? cfgN4
                        : String(cfgN4).split(',').map(s => s.trim()).filter(Boolean);
                    for (const eje4 of ejesN4) {
                        const v4 = buscarValorEnPosiciones(eje4);
                        if (v4) {
                            subSubCategoria = v4;
                            break;
                        }
                    }
                }
            }

            if (subCategoria && subSubCategoria && confRule.reglas_nivel_5) {
                const cfgN5 = confRule.reglas_nivel_5[`${subCategoria}___${subSubCategoria}`] || null;
                if (cfgN5) {
                    const ejesN5 = Array.isArray(cfgN5)
                        ? cfgN5
                        : String(cfgN5).split(',').map(s => s.trim()).filter(Boolean);
                    for (const eje5 of ejesN5) {
                        const v5 = buscarValorEnPosiciones(eje5);
                        if (v5) {
                            subSubSubCategoria = v5;
                            break;
                        }
                    }
                }
            }
        } else {
            // Fallback por posiciones ordenadas si el principal aún no tiene regla en b2b-jerarquia
            const valsPos = [];
            for (const key of Object.keys(posObj).sort()) {
                const p = posObj[key];
                if (p && typeof p === 'object' && p.valor) {
                    valsPos.push(String(p.valor).trim());
                }
            }
            if (valsPos[0]) subCategoria = valsPos[0];
            if (valsPos[1]) subSubCategoria = valsPos[1];
            if (valsPos[2]) subSubSubCategoria = valsPos[2];
        }

        let articuloPrincipalDisplay = rawPrinc;
        let nivelesSub = [subCategoria, subSubCategoria, subSubSubCategoria].filter(Boolean);
        if ((/\bde$/i.test(articuloPrincipalDisplay) || /\bdel$/i.test(articuloPrincipalDisplay)) && nivelesSub.length > 0) {
            articuloPrincipalDisplay = `${articuloPrincipalDisplay} ${nivelesSub[0]}`;
            nivelesSub = nivelesSub.slice(1);
        }
        nivelesSub = nivelesSub.filter(s => normKey(s) !== normKey(articuloPrincipalDisplay));

        const rutaSubcategoriaB2B = nivelesSub.join(' › ');
        const rutaJerarquiaB2B = [familiaB2B, articuloPrincipalDisplay, ...nivelesSub].filter(Boolean).join(' › ');

        props.familia_nombre = familiaB2B;
        props.articulo_principal = articuloPrincipalDisplay;
        if (rutaSubcategoriaB2B) {
            props.ruta_subcategoria_b2b = rutaSubcategoriaB2B;
        }

        return {
            ...art,
            familia_b2b: familiaB2B,
            familia_nombre: familiaB2B,
            articulo_principal_original: rawPrinc,
            articulo_principal_display: articuloPrincipalDisplay,
            articulo_principal: articuloPrincipalDisplay,
            ruta_subcategoria_b2b: rutaSubcategoriaB2B,
            ruta_jerarquia_b2b: rutaJerarquiaB2B,
            propiedades_dinamicas: props
        };
    }

    function obtenerValorAtributoArticuloBunkerWa(art, attrKey) {
        if (!art || !attrKey) return null;
        const target = String(attrKey).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (target === 'ruta_subcategoria_b2b') {
            return art.ruta_subcategoria_b2b || art.propiedades_dinamicas?.ruta_subcategoria_b2b || null;
        }
        const pd = art.propiedades_dinamicas || {};
        for (const k of Object.keys(pd)) {
            if (k === 'posiciones') continue;
            const kNorm = String(k).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (kNorm === target && pd[k] !== undefined && pd[k] !== null && typeof pd[k] !== 'object' && String(pd[k]).trim() !== '') {
                return String(pd[k]).trim();
            }
        }
        const pos = pd.posiciones && typeof pd.posiciones === 'object' ? pd.posiciones : null;
        if (pos) {
            for (const pk of Object.keys(pos)) {
                const p = pos[pk];
                if (p && typeof p === 'object' && p.eje) {
                    const eNorm = String(p.eje).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    if (eNorm === target && p.valor !== undefined && p.valor !== null && String(p.valor).trim() !== '') {
                        return String(p.valor).trim();
                    }
                }
            }
        }
        return null;
    }

    function ordenarArticulosPorJerarquiaB2BWa(lista, nivelesActivos = null) {
        if (!Array.isArray(lista)) return [];
        const nivArr = Array.isArray(nivelesActivos) && nivelesActivos.length > 0
            ? nivelesActivos
            : ['familia', 'principal'];
        const esPlana = nivArr.includes('plana');
        const usaFam = !esPlana && nivArr.includes('familia');
        const usaPri = !esPlana && nivArr.includes('principal');
        const secKeys = esPlana ? [] : nivArr.filter(k => k !== 'familia' && k !== 'principal' && k !== 'plana');

        return [...lista].sort((a, b) => {
            if (usaFam) {
                const famA = String(a.familia_b2b || a.familia_nombre || 'ZZZ').trim();
                const famB = String(b.familia_b2b || b.familia_nombre || 'ZZZ').trim();
                const cmpFam = famA.localeCompare(famB, 'es', { sensitivity: 'base' });
                if (cmpFam !== 0) return cmpFam;
            }

            if (usaPri) {
                const priA = String(a.articulo_principal_display || a.articulo_principal || 'ZZZ').trim();
                const priB = String(b.articulo_principal_display || b.articulo_principal || 'ZZZ').trim();
                const cmpPri = priA.localeCompare(priB, 'es', { sensitivity: 'base' });
                if (cmpPri !== 0) return cmpPri;
            }

            if (secKeys.length > 0) {
                const secA = secKeys.map(k => obtenerValorAtributoArticuloBunkerWa(a, k) || '').filter(Boolean).join(' — ');
                const secB = secKeys.map(k => obtenerValorAtributoArticuloBunkerWa(b, k) || '').filter(Boolean).join(' — ');
                const cmpSec = secA.localeCompare(secB, 'es', { sensitivity: 'base' });
                if (cmpSec !== 0) return cmpSec;
            }

            const kgA = Number(a.kilos_unidad || a.peso_bulto || 1);
            const kgB = Number(b.kilos_unidad || b.peso_bulto || 1);
            if (Math.abs(kgB - kgA) > 0.001) return kgB - kgA;

            return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' });
        });
    }

    /**
     * Expande cada Pack Padre comercial (es_pack && pack_unidades > 1) inyectando inmediatamente
     * debajo su fila hija derivada ("↳ Unidad fraccionada por 300 g" con su precio unitario P. Ud.),
     * exactamente igual a Artículos Búnker (listado-bunker.js).
     */
    function expandirConHijosDerivadosBunkerWa(articulosOrdenados, listaId, mostrarHijos = true) {
        if (!Array.isArray(articulosOrdenados)) return [];
        const sinHijosSueltos = articulosOrdenados.filter(a => !a.es_hijo);
        if (!mostrarHijos) return sinHijosSueltos;

        const lid = Number(listaId) || 1;
        const resultado = [];
        for (const art of sinHijosSueltos) {
            resultado.push(art);
            const packUnits = parseInt(art.pack_unidades || 1, 10) || 1;
            const esPackFlag = art.es_pack === true || art.es_pack === 'true' || art.es_pack === 1 || art.es_pack === 't';
            const esPackReal = esPackFlag && (packUnits > 1 || Boolean(art.pack_hijo_codigo));
            if (esPackReal && packUnits > 1) {
                const infoP = formatearPrecioArticuloListaWa(art, lid);
                const factorKgPadre = Number(art.kilos_unidad || art.peso_bulto || infoP.kilosUnidad || 1) || 1;
                const pBultoPadre = Number(art.precio_nuevo_vigente || art.precio_nuevo_bulto || infoP.precioBultoExacto || infoP.precioBulto || 0);
                const pKgPadre = Number(art.precio_nuevo_kilo || (factorKgPadre > 0 && pBultoPadre > 0 ? (pBultoPadre / factorKgPadre) : infoP.precioKgExacto) || 0);
                const factorKgHijo = Number(art.kilos_fraccion) > 0 && Number(art.kilos_fraccion) < factorKgPadre
                    ? Number(art.kilos_fraccion)
                    : parseFloat((factorKgPadre / packUnits).toFixed(3));
                const pFinalHijo = factorKgHijo * pKgPadre;
                const presStrHijo = factorKgHijo < 1.0 ? `${Math.round(factorKgHijo * 1000)} g` : `${factorKgHijo.toFixed(2)} kg`;
                const nomBase = String(art.nombre || art.nombre_visible || art.descripcion_generada || art.descripcion || '').replace(/\b\d+\s*x\s*\d+(?:[.,]\d+)?\s*[a-zA-Z]*\b/gi, '').trim() || String(art.nombre || '');

                resultado.push({
                    ...art,
                    id: `${art.id || art.articulo_id}_HIJO`,
                    articulo_id: `${art.articulo_id || art.id}_HIJO`,
                    codigo_unico: `${art.codigo_unico || art.articulo_id || art.id}_HIJO`,
                    nombre: `» Unidad fraccionada por ${presStrHijo}`,
                    nomenclatura: nomBase,
                    kilos_unidad: factorKgHijo,
                    presentacion_str: presStrHijo,
                    precio_bulto_final: Number(pFinalHijo.toFixed(2)),
                    precio_kilo_final: Number(pKgPadre.toFixed(2)),
                    precio_nuevo_vigente: Number(pFinalHijo.toFixed(2)),
                    precio_nuevo_bulto: Number(pFinalHijo.toFixed(2)),
                    precio_nuevo_kilo: Number(pKgPadre.toFixed(2)),
                    es_hijo: true,
                    padre_id: art.articulo_id || art.id,
                    padre_nombre: art.nombre,
                    art_original: art,
                    composicion: '',
                    oferta_activa: null
                });
            }
        }
        return resultado;
    }

    /**
     * Consulta las actualizaciones de precio del cliente en Gestión de Cambios y Notificaciones
     * (/api/produccion/precios/clientes-afectados-resumen?dias=90)
     */
    async function obtenerCambiosPreciosClienteWa({ clienteId, lomasSoftId, codigoBunker, telefono, nombreCliente, forzar = false }) {
        const ahora = Date.now();
        let clientes = null;
        if (!forzar && cacheClientesAfectadosPreciosWa && (ahora - cacheClientesAfectadosTimestampWa) < 120000) {
            clientes = cacheClientesAfectadosPreciosWa;
        } else {
            try {
                const res = await fetch('/api/produccion/precios/clientes-afectados-resumen?dias=90');
                const data = await res.json();
                const listaResp = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.clientes) ? data.clientes : []);
                if (data && data.success && listaResp.length > 0) {
                    clientes = listaResp;
                    cacheClientesAfectadosPreciosWa = clientes;
                    cacheClientesAfectadosTimestampWa = ahora;
                }
            } catch (err) {
                console.warn('[WA-CAMBIOS-PRECIOS] No se pudo consultar clientes-afectados-resumen:', err);
            }
        }
        if (!Array.isArray(clientes) || clientes.length === 0) {
            return { clienteMatch: null, cambiosPreciosTodos: [], cambiosPreciosPendientes: [], legacyClienteIdPrecios: null };
        }

        const idBunkerNum = Number(clienteId || 0);
        const idLegacyNum = Number(String(lomasSoftId || '').replace(/\D/g, '') || 0);
        const codBunkerClean = String(codigoBunker || '').trim().toUpperCase();
        const esCodBunkerPrefijado = /^CB-\d+$/i.test(codBunkerClean);
        const telUltimos10 = String(telefono || '').replace(/\D/g, '').slice(-10);
        const normNom = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const nomBuscado = normNom(nombreCliente);

        // Búsqueda por prioridad estricta para evitar falsos cruces entre CB-XXXX (ej: CB-0020) y legacy_id (ej: 0020 vs 0579)
        let match = null;
        if (idBunkerNum > 0) {
            match = clientes.find(c => Number(c.bunker_id) > 0 && Number(c.bunker_id) === idBunkerNum) || null;
        }
        if (!match && codBunkerClean) {
            match = clientes.find(c => String(c.codigo_bunker_cliente || '').trim().toUpperCase() === codBunkerClean) || null;
        }
        if (!match && idLegacyNum > 0) {
            match = clientes.find(c => Number(c.legacy_id) === idLegacyNum || Number(c.cliente_id) === idLegacyNum) || null;
        }
        // Solo si el cliente NO tiene lomas_soft_id numérico conocido, buscar por teléfono o nombre exacto
        if (!match && idLegacyNum === 0 && !esCodBunkerPrefijado) {
            match = clientes.find(c => {
                if (telUltimos10 && telUltimos10.length >= 8) {
                    const telCli = String(c.telefono || '').replace(/\D/g, '').slice(-10);
                    if (telCli && telCli === telUltimos10) return true;
                }
                if (nomBuscado && nomBuscado.length >= 5) {
                    const nomItem = normNom(c.nombre_cliente || c.cliente_nombre || c.nombre || '');
                    if (nomItem && nomItem === nomBuscado) return true;
                }
                return false;
            }) || null;
        }

        if (!match) {
            return { clienteMatch: null, cambiosPreciosTodos: [], cambiosPreciosPendientes: [], legacyClienteIdPrecios: null };
        }

        const rawArts = Array.isArray(match.articulos_afectados)
            ? match.articulos_afectados
            : (Array.isArray(match.articulos) ? match.articulos : []);
        const todos = rawArts.map(cp => ({
            ...cp,
            articulo_id: String(cp.articulo_numero || cp.articulo_id || cp.codigo_unico || '').trim(),
            codigo_unico: String(cp.articulo_numero || cp.articulo_id || cp.codigo_unico || '').trim(),
            nombre: String(cp.descripcion || cp.nombre || cp.articulo_numero || '').trim(),
            peso_bulto: Number(cp.kilos_unidad || cp.peso_bulto || 1),
            kilos_unidad: Number(cp.kilos_unidad || cp.peso_bulto || 1),
            precio_pagado_bulto: Number(cp.precio_pagado_anterior || cp.precio_pagado_bulto || 0),
            precio_nuevo_bulto: Number(cp.precio_nuevo_vigente || cp.precio_nuevo_bulto || 0),
            ultima_fecha_compra: cp.ultima_compra_fecha || cp.ultima_fecha_compra || null
        }));
        const pendientes = todos.filter(a => String(a.estado_notificacion || 'PENDIENTE').toUpperCase() === 'PENDIENTE');
        return {
            clienteMatch: match,
            cambiosPreciosTodos: todos,
            cambiosPreciosPendientes: pendientes,
            legacyClienteIdPrecios: match.cliente_id || match.legacy_id || null
        };
    }

    /**
     * Marca en la base de datos de Gestión de Cambios y Notificaciones que los artículos
     * ya fueron notificados al cliente desde el CRM WhatsApp.
     */
    async function marcarCambiosPreciosComoNotificadosDesdeCrmWa(st, articulosEnviados) {
        if (!st) return;
        const listaBase = Array.isArray(articulosEnviados) && articulosEnviados.length > 0
            ? articulosEnviados
            : (st.cambiosPreciosPendientes || []);
        if (listaBase.length === 0) return;

        const legacyId = st.legacyClienteIdPrecios
            || Number(String(st.rayosX?.cliente?.lomas_soft_id || '').replace(/\D/g, '') || 0)
            || (!/^CB-\d+$/i.test(String(st.codigoBunker || '').trim()) ? Number(String(st.codigoBunker || '').replace(/\D/g, '') || 0) : 0);
        if (!legacyId) return;

        const itemsPayload = listaBase.map(a => {
            const infoP = formatearPrecioArticuloListaWa(a, st.listaId);
            const precioNotif = Number(a.precio_nuevo_bulto || infoP.precioBulto || a.precio_nuevo_kilo || infoP.precioKg || 0);
            return {
                cliente_id: legacyId,
                articulo_id: String(a.articulo_id || a.codigo_unico || a.id || '').trim(),
                precio_notificado: precioNotif
            };
        }).filter(it => it.articulo_id);

        if (itemsPayload.length === 0) return;

        try {
            await fetch('/api/produccion/precios/notificaciones/actualizar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: itemsPayload,
                    estado: 'NOTIFICADO',
                    canal: 'WHATSAPP_CRM'
                })
            });
            cacheClientesAfectadosPreciosWa = null;
            const codigosNotificados = new Set(itemsPayload.map(i => i.articulo_id.toUpperCase()));
            if (Array.isArray(st.cambiosPreciosPendientes)) {
                st.cambiosPreciosPendientes = st.cambiosPreciosPendientes.filter(a => {
                    const cod = String(a.articulo_id || a.codigo_unico || a.id || '').trim().toUpperCase();
                    return !codigosNotificados.has(cod);
                });
            }
            if (Array.isArray(st.cambiosPreciosTodos)) {
                st.cambiosPreciosTodos.forEach(a => {
                    const cod = String(a.articulo_id || a.codigo_unico || a.id || '').trim().toUpperCase();
                    if (codigosNotificados.has(cod)) {
                        a.estado_notificacion = 'NOTIFICADO';
                    }
                });
            }
        } catch (err) {
            console.warn('[WA-CAMBIOS-PRECIOS] No se pudo marcar como NOTIFICADO:', err);
        }
    }

    function obtenerNombrePilaCortoWa(nombreCompleto) {
        const limpio = String(nombreCompleto || '')
            .replace(/\([^)]*\)/g, '')
            .replace(/#[0-9]+/g, '')
            .trim();
        if (!limpio) return '';
        const partes = limpio.split(/[\s\-,]+/).filter(Boolean);
        const primera = partes[0] || '';
        if (primera.length <= 2 && partes[1]) return partes[1];
        return primera.charAt(0).toUpperCase() + primera.slice(1).toLowerCase();
    }

    function esArticuloActivoEnListaWa(art, listaId) {
        if (!art) return false;
        const lid = Number(listaId) || 1;
        if (art.precios && (Number(art.precios[lid]) > 0 || Number(art.precios[String(lid)]) > 0)) {
            return true;
        }
        if (Array.isArray(art.margenes)) {
            const m = art.margenes.find(x => Number(x.lista_id) === lid && x.disponible !== false);
            if (m && Number(m.precio_final) > 0) return true;
        }
        return false;
    }

    function formatearPrecioArticuloListaWa(art, listaId) {
        const lid = Number(listaId) || 1;
        const kilos = Number(art?.kilos_unidad || art?.peso_bulto || 1) || 1;
        let pLista = 0;
        if (art && art.es_hijo && Number(art.precio_bulto_final) > 0) {
            pLista = Number(art.precio_bulto_final);
        } else if (art && art.precios && (Number(art.precios[lid]) > 0 || Number(art.precios[String(lid)]) > 0)) {
            pLista = Number(art.precios[lid] || art.precios[String(lid)] || 0);
        } else if (art && Array.isArray(art.margenes)) {
            const m = art.margenes.find(x => Number(x.lista_id) === lid && x.disponible !== false);
            if (m && Number(m.precio_final) > 0) pLista = Number(m.precio_final);
        } else if (art && (Number(art.precio_nuevo_vigente) > 0 || Number(art.precio_nuevo_bulto) > 0)) {
            pLista = Number(art.precio_nuevo_vigente || art.precio_nuevo_bulto || 0);
        }
        const pKg = Number(art?.precio_nuevo_kilo) > 0
            ? Number(art.precio_nuevo_kilo)
            : (kilos > 0 ? (pLista / kilos) : pLista);
        return {
            precioBultoExacto: Number(pLista.toFixed(2)),
            precioKgExacto: Number(pKg.toFixed(2)),
            precioBulto: Math.round(pLista),
            precioKg: Math.round(pKg),
            kilosUnidad: kilos
        };
    }

    /**
     * Construye el texto corto, cálido y conversacional según el Paso elegido por el operador.
     * Regla estricta:
     * 1. NUNCA mencionar el nombre interno ni el número de la lista de precios al cliente ("Lista de precios", nada más).
     * 2. Si el cliente aún NO ingresó al Portal B2B, incluye automáticamente su link corto personalizado (?t=XXXXXX).
     * 3. Si la conversación YA está iniciada (st.charlaEnCurso === true, ej: ya le pusimos "Ya te paso"),
     *    NO repite "Hola Javier! ¿Cómo estás?" sino que continúa directamente el hilo de conversación.
     */
    function construirTextoPasoAsistenteComercialWa(st) {
        if (!st) return '';
        const enCurso = Boolean(st.charlaEnCurso);
        const saludoInicial = st.nombreCorto ? `Hola ${st.nombreCorto}! ¿Cómo estás? 😊\n` : `Hola! ¿Cómo estás? 😊\n`;
        const saludoBreve = st.nombreCorto ? `Hola ${st.nombreCorto}! ` : `Hola! `;

        const usaLinkActivacion = st.modoLink === 'ACTIVACION_CORTA' && st.linkActivacionCorto;
        const usaMagicLink = st.modoLink === 'MAGIC_LINK' && st.magicLinkDirecto;
        const linkElegido = usaMagicLink
            ? st.magicLinkDirecto
            : (usaLinkActivacion ? st.linkActivacionCorto : (st.urlPortalBase || URL_PORTAL_B2B_OFICIAL));

        const seleccionados = (st.catalogoArticulos || []).filter(a => st.idsSeleccionados.has(String(a.id)));

        if (st.pasoActual === 'PASO_1_PORTAL') {
            const introLink = enCurso
                ? `Acá te dejo`
                : `${saludoInicial}Te paso`;

            if (usaLinkActivacion && st.codigoActivacion) {
                return [
                    `${introLink} tu link personal de nuestro Portal de Clientes, donde tenés toda la lista de precios siempre actualizada al día (código de activación: *${st.codigoActivacion}*):`,
                    `🔗 ${linkElegido}`,
                    ``,
                    `¿Buscás algún artículo en particular?`
                ].join('\n');
            }
            return [
                `${introLink} el link de nuestro Portal de Clientes, donde tenés toda la lista de precios siempre actualizada al día:`,
                `🔗 ${linkElegido}`,
                ``,
                `¿Buscás algún artículo en particular?`
            ].join('\n');
        }

        if (st.pasoActual === 'PASO_2_EXPLICAR_PORTAL') {
            if (usaMagicLink) {
                return [
                    `Te cuento rapidito para qué te sirve el Portal: además de ver la lista de precios actualizada y las ofertas activas, desde ahí podés armar tu pedido en 1 minuto viendo las fracciones disponibles y consultar tu cuenta corriente cuando quieras.`,
                    ``,
                    `Acá te dejo tu link personal de ingreso directo (entrás sin clave desde el celu o la compu):`,
                    `🔗 ${st.magicLinkDirecto}`,
                    ``,
                    `Probá de abrirlo y decime si te resultó cómodo 🙌`
                ].join('\n');
            }
            if (usaLinkActivacion && st.codigoActivacion) {
                return [
                    `Te cuento rapidito para qué te sirve el Portal: además de ver la lista de precios actualizada y las ofertas activas, desde ahí podés armar tu pedido en 1 minuto viendo las fracciones disponibles y consultar tu cuenta corriente.`,
                    ``,
                    `Si todavía no habías entrado, tocando este link corto activás tu acceso en un paso (código: *${st.codigoActivacion}*):`,
                    `🔗 ${st.linkActivacionCorto}`
                ].join('\n');
            }
            return [
                `Te cuento rapidito para qué te sirve el Portal: además de ver la lista de precios actualizada y las ofertas activas, desde ahí podés armar tu pedido en 1 minuto viendo las fracciones disponibles y consultar tu cuenta corriente cuando quieras.`,
                ``,
                `Si necesitás que te pase un link de ingreso directo para tu celu, avisame y te lo envío por acá 🙌`
            ].join('\n');
        }

        if (st.pasoActual === 'PASO_3_PRODUCTOS') {
            const prefijo = enCurso ? '' : saludoBreve;
            if (seleccionados.length > 0) {
                const lineasProd = seleccionados.slice(0, 8).map(art => {
                    const infoP = formatearPrecioArticuloListaWa(art, st.listaId);
                    const txtBulto = `$${infoP.precioBulto.toLocaleString('es-AR')}`;
                    const txtKg = infoP.kilosUnidad > 1.05
                        ? ` ($${infoP.precioKg.toLocaleString('es-AR')}/kg)`
                        : '';
                    return `• *${art.nombre}*: *${txtBulto}*${txtKg}`;
                });
                return [
                    `${prefijo}Te paso los valores actualizados de la lista de precios:`,
                    ...lineasProd,
                    ``,
                    `¿Querés que te separe alguno de estos o buscabas alguna otra fracción?`
                ].join('\n');
            }

            const topHab = (st.articulosHabituales || []).slice(0, 2);
            if (topHab.length > 0) {
                const nombresHab = topHab.map(a => `*${a.nombre}*`).join(' y ');
                return [
                    `${prefijo}Ahí me fijé en lo que solés llevar (${nombresHab}).`,
                    `¿Querés que te pase cómo están hoy esos artículos o estabas buscando algún otro en particular?`
                ].join('\n');
            }

            return [
                `${prefijo}Decime qué artículos o fracciones (por ej. 1 kg, 2 kg o 5 kg) estás buscando y te paso los valores exactos enseguida 🙌`
            ].join('\n');
        }

        if (st.pasoActual === 'PASO_4_PDF') {
            const prefijo = enCurso ? `Acá te paso` : `${saludoBreve}Te paso acá mismo`;
            return [
                `${prefijo} la Lista de Precios actualizada en PDF 📄.`,
                `También podés consultarla en vivo cuando quieras desde el portal: ${linkElegido}`,
                ``,
                `Cualquier artículo puntual que quieras ver o separar, decime y lo vemos enseguida!`
            ].join('\n');
        }

        return '';
    }

    /**
     * Permite desde la barra contextual del chat insertar el Paso 1 o Paso 2 directo
     * en el cuadro de texto (#wa-hub-input-texto) sin enviarlo automáticamente.
     */
    window.insertarPasoRapidoAsistenteEnCuadroWa = async function (chatId, pasoCodigo = 'PASO_1_PORTAL') {
        const idChat = Number(chatId || estadoConsola.chatActivoId || 0);
        const chatObj = (estadoConsola.chats || []).find(c => Number(c.id) === idChat);
        const cli = estadoConsola.rayosXActivo?.cliente || null;
        const codigoBunker = cli?.codigo_bunker_cliente || chatObj?.codigo_bunker_cliente || '';
        const nombreBase = cli?.cliente_nombre || chatObj?.cliente_nombre || chatObj?.contacto_nombre || '';
        const nombreCorto = obtenerNombrePilaCortoWa(nombreBase);
        const listaId = Number(cli?.lista_asignada_id || chatObj?.lista_asignada_id || 1);

        const mensajesActuales = Array.isArray(estadoConsola.detalleActivo?.mensajes) ? estadoConsola.detalleActivo.mensajes : [];
        const det = detectarIntencionConversacionWa(mensajesActuales);

        const mapaEstados = await obtenerMapaEstadosPortalB2BWa();
        const estCli = codigoBunker ? mapaEstados[codigoBunker] : null;
        const yaIngreso = estCli ? Boolean(estCli.ya_ingreso) : true;

        const stTemp = {
            pasoActual: pasoCodigo,
            nombreCorto,
            listaId,
            charlaEnCurso: Boolean(det.charlaEnCurso),
            urlPortalBase: URL_PORTAL_B2B_OFICIAL,
            codigoActivacion: estCli?.codigo_activacion || '',
            linkActivacionCorto: estCli?.link_activacion_corto || '',
            modoLink: (!yaIngreso && estCli?.link_activacion_corto) ? 'ACTIVACION_CORTA' : 'PORTAL_GENERAL',
            magicLinkDirecto: '',
            catalogoArticulos: [],
            articulosHabituales: [],
            idsSeleccionados: new Set()
        };
        const texto = construirTextoPasoAsistenteComercialWa(stTemp);
        const input = document.getElementById('wa-hub-input-texto');
        if (input) {
            input.value = texto;
            input.rows = Math.min(7, Math.max(3, texto.split('\n').length));
            if (idChat) guardarBorradorChatWa(idChat, texto);
            input.focus();
        }
    };

    /**
     * Transcribe bajo demanda los últimos audios del chat activo y refresca la vista y el Asistente Comercial
     */
    window.transcribirAudiosChatManualWa = async function (chatIdParam) {
        const idChat = Number(chatIdParam || estadoAsistenteComercialWa?.chatId || estadoConsola.chatActivoId || 0);
        if (!idChat) return;
        try {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: '🎧 Escuchando y transcribiendo audio...',
                    html: 'Desencriptando nota de voz de WhatsApp y transcribiendo en español...',
                    allowOutsideClick: false,
                    didOpen: () => Swal.showLoading()
                });
            }
            await fetch(`/api/crm/whatsapp/chats/${encodeURIComponent(idChat)}/transcribir-audios`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ maxAudios: 4 })
            });
            if (typeof window.seleccionarChatConsola === 'function') {
                await window.seleccionarChatConsola(idChat, false);
            }
            if (typeof window.abrirAsistenteComercialConversacionWa === 'function') {
                await window.abrirAsistenteComercialConversacionWa({ chatId: idChat, forzarRelectura: true });
            }
        } catch (err) {
            console.warn('Error transcribiendo audio manual:', err);
        }
    };

    /**
     * Abre el Asistente Comercial Conversacional (Modal para el Operador)
     */
    window.abrirAsistenteComercialConversacionWa = async function (opciones = {}) {
        let chatId = opciones.chatId ? Number(opciones.chatId) : Number(estadoConsola.chatActivoId || 0);
        if (chatId && (!estadoConsola.detalleActivo || Number(estadoConsola.detalleActivo?.chat?.id) !== Number(chatId))) {
            if (typeof window.seleccionarChatConsola === 'function') {
                await window.seleccionarChatConsola(chatId, false);
            }
        }
        let chatObj = estadoConsola.chatActivoDatos
            || (estadoConsola.detalleActivo && estadoConsola.detalleActivo.chat)
            || (estadoConsola.chats || []).find(c => Number(c.id) === Number(chatId))
            || null;
        if (!chatObj && estadoConsola.chats && estadoConsola.chats.length > 0) {
            const filtrados = typeof obtenerChatsFiltrados === 'function' ? obtenerChatsFiltrados() : estadoConsola.chats;
            chatObj = filtrados[0] || estadoConsola.chats[0];
            if (chatObj) {
                chatId = Number(chatObj.id);
                if (typeof window.seleccionarChatConsola === 'function') {
                    await window.seleccionarChatConsola(chatId, false);
                }
            }
        }
        const rayosX = estadoConsola.rayosXActivo || (estadoConsola.detalleActivo && estadoConsola.detalleActivo.rayos_x) || null;
        const cliRx = rayosX?.cliente || null;

        const clienteId = opciones.clienteId || cliRx?.id || chatObj?.cliente_bunker_id || null;
        const codigoBunker = opciones.codigoBunker || cliRx?.codigo_bunker_cliente || chatObj?.codigo_bunker_cliente || '';
        const nombreCliente = opciones.nombreCliente || cliRx?.cliente_nombre || chatObj?.cliente_nombre || chatObj?.contacto_nombre || chatObj?.pushname_wa || 'Cliente';
        const telefonoCliente = opciones.telefono || chatObj?.telefono_normalizado || cliRx?.telefono || '';
        let tieneListaAsignada = opciones.tieneListaAsignada !== undefined
            ? Boolean(opciones.tieneListaAsignada)
            : (cliRx?.tiene_lista_asignada !== undefined
                ? Boolean(cliRx.tiene_lista_asignada)
                : (chatObj?.tiene_lista_asignada !== undefined
                    ? Boolean(chatObj.tiene_lista_asignada)
                    : Boolean(cliRx?.lista_asignada_id_real || chatObj?.lista_asignada_id_real)));
        let listaId = Number(opciones.listaId || cliRx?.lista_asignada_id || chatObj?.lista_asignada_id || 1);
        let listaNombreInterna = opciones.listaNombre || cliRx?.lista_asignada_nombre || chatObj?.lista_asignada_nombre || `Lista #${listaId}`;

        if (typeof Swal === 'undefined') {
            alert('SweetAlert2 no está disponible en esta vista.');
            return;
        }

        const forzarRelectura = Boolean(opciones.forzarRelectura);
        if (!window._cacheSintesisMemoriaClientesWa) {
            window._cacheSintesisMemoriaClientesWa = new Map();
        }
        const yaTieneSintesisLocal = Boolean(clienteId && window._cacheSintesisMemoriaClientesWa.has(Number(clienteId)) && !forzarRelectura);

        Swal.fire({
            title: yaTieneSintesisLocal
                ? '⚡ Levantando Síntesis en Memoria...'
                : '🧠 Preparando Asistente Comercial...',
            html: yaTieneSintesisLocal
                ? 'Recuperando perfil sintetizado del cliente y verificando únicamente si hubo últimas novedades...'
                : '1ra lectura profunda: analizando historial de compras, pagos y conversación para guardar la síntesis en memoria...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        let catalogoData = { articulos: [], listas: [] };
        let compradosRaw = [];
        let mensajesChat = Array.isArray(estadoConsola.detalleActivo?.mensajes) ? estadoConsola.detalleActivo.mensajes : [];
        let mapaEstadosPortal = {};
        let sintesisMemoria = null;
        let errorCriticoSintesis = '';
        let jerarquiaB2BData = { mapaPorFamiliaId: new Map(), mapaPorFamiliaNombre: new Map() };
        let cambiosPreciosData = { clienteMatch: null, cambiosPreciosTodos: [], cambiosPreciosPendientes: [], legacyClienteIdPrecios: null };

        try {
            const urlSintesis = clienteId
                ? `/api/crm/whatsapp/clientes/${encodeURIComponent(clienteId)}/sintesis-hibrida?chatId=${encodeURIComponent(chatId || 0)}`
                : null;

            const lomasSoftIdCli = cliRx?.lomas_soft_id || chatObj?.lomas_soft_id || '';
            const promesas = [
                obtenerCatalogoDinamicoAsistenteWa().catch(() => ({ articulos: [], listas: [] })),
                urlSintesis
                    ? fetch(urlSintesis).then(async r => {
                        const j = await r.json().catch(() => null);
                        if (!r.ok || !j || !j.success) {
                            return { success: false, _httpStatus: r.status, error: j?.error || `HTTP ${r.status} en síntesis de memoria` };
                        }
                        return j;
                    }).catch(e => ({ success: false, error: e.message || 'Fallo de red en síntesis de memoria' }))
                    : Promise.resolve(null),
                obtenerMapaEstadosPortalB2BWa().catch(() => ({})),
                obtenerMapaJerarquiaB2BWa().catch(() => ({ mapaPorFamiliaId: new Map(), mapaPorFamiliaNombre: new Map() })),
                obtenerCambiosPreciosClienteWa({
                    clienteId,
                    lomasSoftId: lomasSoftIdCli,
                    codigoBunker,
                    telefono: telefonoCliente,
                    nombreCliente,
                    forzar: forzarRelectura
                }).catch(() => ({ clienteMatch: null, cambiosPreciosTodos: [], cambiosPreciosPendientes: [], legacyClienteIdPrecios: null }))
            ];
            const [catRes, sintRes, estRes, jerRes, camRes] = await Promise.all(promesas);
            catalogoData = catRes || { articulos: [], listas: [] };
            mapaEstadosPortal = estRes || {};
            jerarquiaB2BData = jerRes || { mapaPorFamiliaId: new Map(), mapaPorFamiliaNombre: new Map() };
            cambiosPreciosData = camRes || { clienteMatch: null, cambiosPreciosTodos: [], cambiosPreciosPendientes: [], legacyClienteIdPrecios: null };

            if (sintRes && sintRes.success) {
                sintesisMemoria = sintRes;
                if (clienteId) {
                    window._cacheSintesisMemoriaClientesWa.set(Number(clienteId), sintRes);
                }
                compradosRaw = Array.isArray(sintRes.articulos_habituales) ? sintRes.articulos_habituales : [];
                if (Array.isArray(sintRes.mensajes_recientes) && sintRes.mensajes_recientes.length > 0) {
                    if (mensajesChat.length < sintRes.mensajes_recientes.length) {
                        mensajesChat = sintRes.mensajes_recientes;
                    }
                }
            } else if (clienteId) {
                errorCriticoSintesis = sintRes?.error || 'No respondió el servicio de Síntesis en Memoria.';
                // Fallback si no respondió el endpoint de síntesis
                const compRes = await fetch(`/api/logistica/bunker/clientes/${encodeURIComponent(clienteId)}/articulos-comprados`).then(r => r.json()).catch(() => ({ data: [] }));
                compradosRaw = Array.isArray(compRes?.data) ? compRes.data : [];
            }
        } catch (err) {
            errorCriticoSintesis = err.message || 'Error al levantar el contexto del cliente.';
            console.warn('[WA-ASISTENTE-COMERCIAL] Error parcial cargando contexto:', err);
        }

        if (catalogoData && catalogoData.mapaClientesBunkerListas instanceof Map) {
            const lomasNumLookup = parseInt(String(cliRx?.lomas_soft_id || chatObj?.lomas_soft_id || '').replace(/\D/g, ''), 10);
            const bCli = (clienteId && catalogoData.mapaClientesBunkerListas.get(`ID_${Number(clienteId)}`))
                || (codigoBunker && catalogoData.mapaClientesBunkerListas.get(`CB_${String(codigoBunker).trim().toUpperCase()}`))
                || (!isNaN(lomasNumLookup) && lomasNumLookup > 0 && catalogoData.mapaClientesBunkerListas.get(`LOMAS_${lomasNumLookup}`))
                || null;
            if (bCli) {
                if (Array.isArray(bCli.listas_precios) && bCli.listas_precios.length > 0) {
                    tieneListaAsignada = true;
                    listaId = Number(bCli.listas_precios[0].id) || listaId;
                    if (bCli.listas_precios[0].nombre) {
                        listaNombreInterna = bCli.listas_precios[0].nombre;
                    }
                } else {
                    tieneListaAsignada = false;
                }
            }
        }

        const estadoPortalCli = (codigoBunker && mapaEstadosPortal[codigoBunker]) ? mapaEstadosPortal[codigoBunker] : null;
        const yaIngresoPortal = estadoPortalCli ? Boolean(estadoPortalCli.ya_ingreso) : false;
        const fechaUltimoIngresoTxt = estadoPortalCli?.ultimo_ingreso
            ? new Date(estadoPortalCli.ultimo_ingreso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '';
        const emailRegistradoPortal = estadoPortalCli?.email_registrado || '';
        const codigoActivacionCorto = estadoPortalCli?.codigo_activacion || '';
        const linkActivacionCorto = estadoPortalCli?.link_activacion_corto || '';

        // 1. Normalizar todos los artículos del catálogo dinámico y enriquecerlos con la Jerarquía B2B,
        //    FILTRANDO ESTRICTAMENTE los artículos activos (disponible = true y precio > 0) en la Lista Asignada del cliente (igual que Artículos Búnker)
        let todosArticulos = (catalogoData.articulos || [])
            .filter(a => esArticuloActivoEnListaWa(a, listaId))
            .map(a => {
                const idNorm = String(a.id || a.articulo_id || a.codigo_unico || a.numero || '').trim();
                const codNorm = String(a.codigo_unico || a.articulo_id || a.id || a.numero || '').trim();
                const nomNorm = String(a.nombre || a.nombre_visible || a.descripcion_generada || a.descripcion || codNorm || 'Artículo').trim();
                const artNorm = resolverJerarquiaB2BArticuloWa({
                    ...a,
                    id: idNorm,
                    codigo_unico: codNorm,
                    nombre: nomNorm
                }, jerarquiaB2BData);
                artNorm._bolsaBusqueda = obtenerBolsaBusquedaArticuloAsistenteWa(artNorm);
                return artNorm;
            });
        todosArticulos = ordenarArticulosPorJerarquiaB2BWa(todosArticulos);

        const mapaPorId = new Map();
        const mapaPorCodigo = new Map();
        todosArticulos.forEach(a => {
            if (a.id) {
                mapaPorId.set(String(a.id), a);
                mapaPorId.set(String(a.id).toUpperCase(), a);
            }
            if (a.codigo_unico) {
                mapaPorCodigo.set(String(a.codigo_unico).trim().toUpperCase(), a);
            }
            if (a.codigo_barras) {
                mapaPorCodigo.set(String(a.codigo_barras).trim().toUpperCase(), a);
            }
        });

        // 2. Construir lista real de "Lo que este cliente nos compra habitualmente"
        //    (respetando estrictamente solo artículos activos en la lista de precios del cliente)
        const habitualesMap = new Map();
        compradosRaw.forEach(item => {
            const artId = String(item.articulo_id || '').trim();
            const artIdUp = artId.toUpperCase();
            let artCat = mapaPorId.get(artId) || mapaPorId.get(artIdUp) || mapaPorCodigo.get(artIdUp);
            if (!artCat && item.descripcion) {
                const descNorm = normalizarTextoBusquedaAsistenteWa(item.descripcion);
                artCat = todosArticulos.find(a => normalizarTextoBusquedaAsistenteWa(a.nombre) === descNorm);
            }
            if (artCat && esArticuloActivoEnListaWa(artCat, listaId)) {
                habitualesMap.set(String(artCat.id), {
                    ...artCat,
                    frecuencia_compra: Number(item.frecuencia_compra || 1),
                    ultima_compra: item.ultima_compra || null,
                    ultimo_precio_unitario: Number(item.ultimo_precio_unitario || 0)
                });
            }
        });

        const ultimasFacturasRx = rayosX?.ultimas_facturas || estadoConsola.rayosXActivo?.ultimas_facturas || [];
        ultimasFacturasRx.forEach(f => {
            const estF = String(f.estado || '').toUpperCase();
            if (estF.includes('ANULAD') || estF.includes('CANCELAD') || estF.includes('BAJA')) return;
            if (String(f.tipo_comprobante || '').toUpperCase().includes('NC') || [3, 8, 13].includes(Number(f.tipo_cbte))) return;
            (f.items || []).forEach(it => {
                const cod = String(it.articulo_id || '').trim();
                const codUp = cod.toUpperCase();
                let artCat = mapaPorCodigo.get(codUp) || mapaPorId.get(cod) || mapaPorId.get(codUp);
                if (!artCat && it.descripcion) {
                    const descNorm = normalizarTextoBusquedaAsistenteWa(it.descripcion);
                    artCat = todosArticulos.find(a => normalizarTextoBusquedaAsistenteWa(a.nombre) === descNorm);
                }
                if (artCat && esArticuloActivoEnListaWa(artCat, listaId)) {
                    const key = String(artCat.id);
                    if (!habitualesMap.has(key)) {
                        habitualesMap.set(key, {
                            ...artCat,
                            frecuencia_compra: 1,
                            ultima_compra: f.fecha_emision || f.emitida_en || null
                        });
                    }
                }
            });
        });

        // 2b. Fusionar los artículos de Gestión de Cambios y Notificaciones (/api/produccion/precios/clientes-afectados-resumen)
        //     verificando estrictamente que el artículo esté activo en la Lista Asignada del cliente
        const cambiosPreciosTodosEnriq = (cambiosPreciosData.cambiosPreciosTodos || []).map(cp => {
            const codUp = String(cp.articulo_id || '').trim().toUpperCase();
            const artCat = mapaPorCodigo.get(codUp) || mapaPorId.get(codUp) || null;
            if (!artCat || !esArticuloActivoEnListaWa(artCat, listaId)) {
                return null;
            }
            const combinado = resolverJerarquiaB2BArticuloWa({
                ...artCat,
                ...cp,
                id: String(artCat.id),
                codigo_unico: String(artCat.codigo_unico || cp.articulo_id || '').trim(),
                nombre: String(artCat.nombre || cp.nombre || cp.articulo_id || '').trim(),
                kilos_unidad: Number(artCat.kilos_unidad || cp.peso_bulto || 1),
                stock_real: cp.sin_stock_actual ? 0 : Number(artCat.stock_real ?? 1),
                precios: artCat.precios
            }, jerarquiaB2BData);
            combinado._bolsaBusqueda = obtenerBolsaBusquedaArticuloAsistenteWa(combinado);

            const keyHab = String(combinado.id);
            const prevHab = habitualesMap.get(keyHab);
            habitualesMap.set(keyHab, {
                ...(prevHab || {}),
                ...combinado,
                frecuencia_compra: Number(prevHab?.frecuencia_compra || 1),
                ultima_compra: cp.ultima_fecha_compra || prevHab?.ultima_compra || null,
                ultimo_precio_unitario: Number(cp.precio_pagado_bulto || prevHab?.ultimo_precio_unitario || 0)
            });
            return habitualesMap.get(keyHab);
        }).filter(Boolean);

        const cambiosPreciosTodos = ordenarArticulosPorJerarquiaB2BWa(cambiosPreciosTodosEnriq);
        const cambiosPreciosPendientes = cambiosPreciosTodos.filter(
            a => String(a.estado_notificacion || 'PENDIENTE').toUpperCase() === 'PENDIENTE'
        );

        // Ordenar habituales respetando Jerarquía B2B (Familia -> Artículo Principal -> Subcategoría B2B -> Kilos DESC)
        const articulosHabituales = ordenarArticulosPorJerarquiaB2BWa(Array.from(habitualesMap.values()));
        const idsHabituales = new Set(articulosHabituales.map(a => String(a.id)));
        const familiasCliente = new Set(articulosHabituales.map(a => a.familia_id).filter(Boolean));
        const principalesCliente = new Set(articulosHabituales.map(a => normalizarTextoBusquedaAsistenteWa(a.articulo_principal)).filter(Boolean));

        // 3. Construir lista de "Productos Similares / Complementarios" ordenados por Jerarquía B2B
        let articulosSimilares = todosArticulos.filter(a => {
            if (idsHabituales.has(String(a.id))) return false;
            if (Number(a.stock_real || 0) <= 0) return false;
            const princ = normalizarTextoBusquedaAsistenteWa(a.articulo_principal);
            return (a.familia_id && familiasCliente.has(a.familia_id)) || (princ && principalesCliente.has(princ));
        });
        if (articulosSimilares.length === 0) {
            articulosSimilares = ordenarArticulosPorJerarquiaB2BWa(
                todosArticulos
                    .filter(a => !idsHabituales.has(String(a.id)) && Number(a.stock_real || 0) > 0)
                    .sort((a, b) => Number(b.stock_real || 0) - Number(a.stock_real || 0))
                    .slice(0, 18)
            );
        } else {
            articulosSimilares = ordenarArticulosPorJerarquiaB2BWa(
                articulosSimilares
                    .sort((a, b) => Number(b.stock_real || 0) - Number(a.stock_real || 0))
                    .slice(0, 18)
            );
        }

        // 3b. Si en los últimos 4 mensajes hay algún audio entrante aún sin transcribir ("🎤 Mensaje de audio"), transcribirlo en caliente antes de correr el asistente
        if (chatId > 0 && Array.isArray(mensajesChat) && mensajesChat.length > 0) {
            const ult4Aud = mensajesChat.slice(-4).filter(m =>
                !m.from_me &&
                (m.tipo_mensaje === 'ptt' || m.tipo_mensaje === 'audio') &&
                (!m.cuerpo || String(m.cuerpo).trim() === '🎤 Mensaje de audio')
            );
            if (ult4Aud.length > 0) {
                try {
                    const trRes = await fetch(`/api/crm/whatsapp/chats/${encodeURIComponent(chatId)}/transcribir-audios`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            msgIds: ult4Aud.map(m => m.msg_id).filter(Boolean),
                            maxAudios: 3
                        })
                    }).then(r => r.json()).catch(() => null);
                    if (trRes && trRes.success && Array.isArray(trRes.resultados) && trRes.resultados.length > 0) {
                        const mapaTr = new Map(trRes.resultados.map(r => [String(r.msgId), r.cuerpo]));
                        mensajesChat.forEach(m => {
                            const shortId = String(m.msg_id || '').split('_').pop();
                            if (mapaTr.has(shortId)) {
                                m.cuerpo = mapaTr.get(shortId);
                            }
                        });
                    }
                } catch (_) {}
            }
        }

        // 4. Detectar si en los últimos mensajes o audios transcritos el cliente mencionó algún producto puntual
        const detIntencion = detectarIntencionConversacionWa(mensajesChat);
        const detArticulos = detectarArticulosMencionadosEnTextoWa(detIntencion.ultimoRecibido || '', todosArticulos, idsHabituales);
        let articulosMencionadosChat = detArticulos.articulosMencionadosChat || [];
        let tokensNegadosCliente = Array.isArray(detArticulos.tokensNegados) ? detArticulos.tokensNegados : [];
        let idsPreseleccionadosInicial = (detIntencion.codigo === 'CONSULTA_PRECIO_PRODUCTO' || detArticulos.idsPreseleccionados.length > 0)
            ? detArticulos.idsPreseleccionados
            : [];

        const contactoNombreChat = String(chatObj?.contacto_nombre || chatObj?.pushname_wa || '').trim();
        const nombreCorto = obtenerNombrePilaCortoWa(contactoNombreChat || nombreCliente);

        // 4b. Ejecutar razonamiento híbrido IA (Gemini) sobre la base determinista (o levantar el ya guardado en PostgreSQL en 0ms si no hubo mensajes nuevos)
        let razonamientoIa = null;
        let errorCriticoIa = '';
        let articulosPdfSugeridosIa = [];
        let sugerirAdjuntarPdfIa = false;

        if (!forzarRelectura && sintesisMemoria && sintesisMemoria.razonamiento_ia_guardado && sintesisMemoria.razonamiento_ia_guardado.usando_ia_real) {
            razonamientoIa = sintesisMemoria.razonamiento_ia_guardado;
        } else if (sintesisMemoria && sintesisMemoria.ia_cognitiva && sintesisMemoria.ia_cognitiva.disponible === false) {
            errorCriticoIa = 'El servicio de Inteligencia Artificial (Gemini) no tiene credenciales activas configuradas en el servidor.';
        } else if (Array.isArray(mensajesChat) && mensajesChat.length > 0) {
            try {
                if (typeof Swal !== 'undefined' && Swal.isVisible()) {
                    Swal.update({
                        title: '🧠 Gemini Analizando Conversación...',
                        html: 'Interpretando el pedido completo, descartando negaciones y seleccionando códigos deterministas del catálogo...'
                    });
                    Swal.showLoading();
                }
                const catalogoCompactoIa = todosArticulos.slice(0, 320).map(a => ({
                    codigo: a.codigo_unico || a.id,
                    nombre: a.nombre,
                    kilos_unidad: Number(a.kilos_unidad || a.peso_bulto || 1),
                    familia: a.familia_b2b || a.familia_nombre || '',
                    stock_disponible: Number(a.stock_real || 0)
                }));
                const ctrlIa = new AbortController();
                const timerIa = setTimeout(() => ctrlIa.abort(), 35000);
                let respIa = null;
                try {
                    const httpResIa = await fetch('/api/crm/whatsapp/asistente-hibrido/razonar', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        signal: ctrlIa.signal,
                        body: JSON.stringify({
                            clienteId: clienteId || 0,
                            clienteNombre: nombreCliente,
                            contactoNombre: contactoNombreChat,
                            apodoSugerido: nombreCorto,
                            mensajesRecientes: mensajesChat.slice(-14),
                            catalogoCompacto: catalogoCompactoIa,
                            habitualesCliente: articulosHabituales.slice(0, 20).map(h => ({
                                codigo: h.codigo_unico || h.id,
                                nombre: h.nombre,
                                kg: Number(h.kilos_unidad || 1)
                            })),
                            estadoCuentaDeterminista: {
                                saldo_total: rayosX?.cuenta_corriente?.saldo_actual || 0,
                                tiene_saldo_a_favor: Number(rayosX?.cuenta_corriente?.saldo_actual || 0) < -10,
                                facturas_pendientes: (rayosX?.ultimas_facturas || []).filter(f => Number(f.saldo_pendiente || 0) > 10).length,
                                pedidos_activos_en_curso: (rayosX?.pedidos_recientes || [])
                                    .filter(p => !/entregad|anulad|cancelad|baja/i.test(`${p.estado || ''} ${p.secuencia || ''} ${p.estado_logistico || ''}`))
                                    .slice(0, 3)
                                    .map(p => ({
                                        id: p.id,
                                        estado: p.estado || 'En preparación',
                                        secuencia: p.secuencia || '',
                                        total: p.total || 0
                                    })),
                                comportamiento_pago: sintesisMemoria?.comportamiento_pago || {}
                            },
                            linkPortalCliente: linkActivacionCorto || URL_PORTAL_B2B_OFICIAL,
                            forzarRecalculo: forzarRelectura
                        })
                    });
                    respIa = await httpResIa.json().catch(() => ({
                        success: false,
                        error: `Respuesta inválida del servidor IA (HTTP ${httpResIa.status})`
                    }));
                } finally {
                    clearTimeout(timerIa);
                }

                if (respIa && respIa.success && respIa.razonamiento && respIa.razonamiento.usando_ia_real) {
                    razonamientoIa = respIa.razonamiento;
                } else {
                    errorCriticoIa = respIa?.error || respIa?.razonamiento?.motivo_fallback || 'El servicio Gemini no respondió o devolvió un error de conexión.';
                    if (sintesisMemoria?.razonamiento_ia_guardado?.usando_ia_real) {
                        razonamientoIa = sintesisMemoria.razonamiento_ia_guardado;
                    }
                }
            } catch (errIa) {
                errorCriticoIa = errIa?.name === 'AbortError'
                    ? 'Tiempo de espera agotado (35s): el servicio de IA (Gemini) tardó demasiado en responder.'
                    : (errIa?.message || 'Fallo crítico al conectar con el servicio de IA (Gemini).');
                if (sintesisMemoria?.razonamiento_ia_guardado?.usando_ia_real) {
                    razonamientoIa = sintesisMemoria.razonamiento_ia_guardado;
                }
                console.error('❌ [WA-ASISTENTE-HIBRIDO-IA] Error crítico en conexión Gemini:', errIa);
            }
        }

        if (razonamientoIa && razonamientoIa.usando_ia_real) {
            sugerirAdjuntarPdfIa = Boolean(razonamientoIa.sugerir_adjuntar_pdf);
            if (Array.isArray(razonamientoIa.conceptos_excluidos) && razonamientoIa.conceptos_excluidos.length > 0) {
                razonamientoIa.conceptos_excluidos.forEach(c => {
                    if (!tokensNegadosCliente.includes(c)) tokensNegadosCliente.push(c);
                });
            }
            if (Array.isArray(razonamientoIa.codigos_articulos_seleccionados) && razonamientoIa.codigos_articulos_seleccionados.length > 0) {
                const seleccionadosIaObjs = [];
                const idsIa = [];
                razonamientoIa.codigos_articulos_seleccionados.forEach(codRaw => {
                    const codUp = String(codRaw || '').trim().toUpperCase();
                    const matchArt = mapaPorCodigo.get(codUp) || mapaPorId.get(codRaw) || mapaPorId.get(codUp);
                    if (matchArt) {
                        const bolsa = String(matchArt._bolsaBusqueda || '');
                        if (!tokensNegadosCliente.some(tok => bolsa.includes(tok))) {
                            seleccionadosIaObjs.push(matchArt);
                            idsIa.push(String(matchArt.id));
                        }
                    }
                });
                if (idsIa.length > 0) {
                    idsPreseleccionadosInicial = idsIa;
                    const idsSet = new Set(idsIa);
                    const restoMenc = articulosMencionadosChat.filter(a => !idsSet.has(String(a.id)));
                    articulosMencionadosChat = [...seleccionadosIaObjs, ...restoMenc];
                }
            }
            if (Array.isArray(razonamientoIa.codigos_articulos_pdf_sugeridos) && razonamientoIa.codigos_articulos_pdf_sugeridos.length > 0) {
                const pdfIaObjs = [];
                const vistosPdf = new Set();
                razonamientoIa.codigos_articulos_pdf_sugeridos.forEach(codRaw => {
                    const codUp = String(codRaw || '').trim().toUpperCase();
                    const matchArt = mapaPorCodigo.get(codUp) || mapaPorId.get(codRaw) || mapaPorId.get(codUp);
                    if (matchArt && !vistosPdf.has(String(matchArt.id))) {
                        const bolsa = String(matchArt._bolsaBusqueda || '');
                        if (!tokensNegadosCliente.some(tok => bolsa.includes(tok))) {
                            vistosPdf.add(String(matchArt.id));
                            pdfIaObjs.push(matchArt);
                        }
                    }
                });
                articulosPdfSugeridosIa = pdfIaObjs;
            }
        }

        // Detectar todos los teléfonos / chats vinculados a este mismo cliente para poder cambiar de contacto en 1 clic
        const chatsDelMismoCliente = (estadoConsola.chats || []).filter(c => {
            if (clienteId && Number(c.cliente_bunker_id) === Number(clienteId)) return true;
            if (codigoBunker && String(c.codigo_bunker_cliente || '').trim() === String(codigoBunker).trim()) return true;
            return Number(c.id) === Number(chatId);
        });

        const modoLinkInicial = linkActivacionCorto ? 'ACTIVACION_CORTA' : 'PORTAL_GENERAL';
        window._contadorAperturasAsistenteWa = ((window._contadorAperturasAsistenteWa || 0) + 1) % 12;

        estadoAsistenteComercialWa = {
            chatId,
            clienteId,
            codigoBunker,
            nombreCliente,
            contactoNombreChat,
            nombreCorto,
            telefonoCliente,
            chatsDelMismoCliente,
            tieneListaAsignada,
            listasDisponibles: Array.isArray(catalogoData.listas) ? catalogoData.listas : [],
            listaId,
            listaNombre: listaNombreInterna,
            listaNombreInterna,
            urlPortalBase: URL_PORTAL_B2B_OFICIAL,
            yaIngresoPortal,
            fechaUltimoIngresoTxt,
            emailRegistradoPortal,
            codigoActivacion: codigoActivacionCorto,
            linkActivacionCorto,
            modoLink: modoLinkInicial,
            magicLinkDirecto: '',
            charlaEnCurso: Boolean(detIntencion.charlaEnCurso),
            modoAccionProactiva: 'AUTO',
            varianteSaludoIdx: window._contadorAperturasAsistenteWa,
            pasoActual: idsPreseleccionadosInicial.length > 0 ? 'PASO_3_PRODUCTOS' : 'PASO_1_PORTAL',
            estrategiaActivaId: 'ESTRATEGIA_DIRECTA',
            tabProductosActual: articulosMencionadosChat.length > 0
                ? 'MENCIONADOS'
                : (cambiosPreciosPendientes.length > 0 ? 'CAMBIOS_PENDIENTES' : (articulosHabituales.length > 0 ? 'HABITUALES' : 'SIMILARES')),
            _tabFijadoManualmente: false,
            filtroBusqueda: '',
            filtroLdnSet: new Set(),
            filtroTipoPadre: 'TODOS',
            filtroFraccionOp: '',
            filtroFraccionKg: '',
            ultimosFiltrados: [],
            catalogoArticulos: todosArticulos,
            articulosHabituales,
            articulosSimilares,
            articulosMencionadosChat,
            articulosPdfSugeridosIa,
            idsPdfSeleccionados: new Set((articulosPdfSugeridosIa || []).map(a => String(a.id))),
            sugerirAdjuntarPdfIa,
            alcancePdfAdjunto: (idsPreseleccionadosInicial.length > 0 || (articulosPdfSugeridosIa || []).length > 0)
                ? 'SELECCIONADOS'
                : (cambiosPreciosPendientes.length > 0 ? 'ACTUALIZACIONES' : 'LISTA_COMPLETA'),
            mostrarRadiografia3Tarjetas: false,
            tokensNegadosCliente,
            cambiosPreciosTodos,
            cambiosPreciosPendientes,
            legacyClienteIdPrecios: cambiosPreciosData.legacyClienteIdPrecios,
            jerarquiaB2BData,
            idsSeleccionados: new Set(idsPreseleccionadosInicial),
            mensajesCompleta: mensajesChat,
            mensajesRecientes: mensajesChat.slice(-4),
            rayosX,
            detIntencion,
            sintesisMemoria,
            razonamientoIa,
            errorCriticoIa,
            errorCriticoSintesis
        };

        await inicializarConfigPdfGuardadaEnEstadoWa(estadoAsistenteComercialWa);

        const resultadoMesa = typeof window.ejecutarMesaAgentesComercialesWa === 'function'
            ? window.ejecutarMesaAgentesComercialesWa(estadoAsistenteComercialWa)
            : null;
        estadoAsistenteComercialWa.resultadoMesa = resultadoMesa;

        mostrarModalSwalAsistenteComercialWa(estadoAsistenteComercialWa);
    };

    function guardarBorradorTemporalModalAsistenteWa(st) {
        if (!st) return;
        const area1 = document.getElementById('wa-asist-com-textarea');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2');
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3');
        const chkPdf = document.getElementById('wa-asist-com-chk-pdf');
        const chkPdfCc = document.getElementById('wa-asist-com-chk-pdf-cc');
        const selAlcPdf = document.getElementById('wa-asist-com-sel-alcance-pdf');
        if (!area1) return;
        st._borradorMensajesEnCurso = {
            b1: area1.value,
            chkB2: Boolean(chkB2 && chkB2.checked),
            b2: area2 ? area2.value : '',
            chkB3: Boolean(chkB3 && chkB3.checked),
            b3: area3 ? area3.value : '',
            chkPdf: Boolean(chkPdf && chkPdf.checked),
            chkPdfCc: Boolean(chkPdfCc && chkPdfCc.checked),
            alcancePdf: selAlcPdf ? selAlcPdf.value : (st.alcancePdfAdjunto || 'LISTA_COMPLETA')
        };
    }

    function mostrarModalSwalAsistenteComercialWa(st) {
        if (!st) return;
        const {
            chatId,
            clienteId,
            codigoBunker = '',
            nombreCliente = '',
            contactoNombreChat = '',
            nombreCorto = '',
            telefonoCliente = '',
            chatsDelMismoCliente = [],
            listaId = 1,
            listaNombreInterna = '',
            todosArticulos = st.catalogoArticulos || [],
            articulosMencionadosChat = [],
            cambiosPreciosPendientes = [],
            articulosHabituales = [],
            articulosSimilares = [],
            rayosX,
            detIntencion = {},
            resultadoMesa
        } = st;

        const borradorPrevio = st._borradorMensajesEnCurso || null;
        const textoBurbuja1Inicial = borradorPrevio
            ? borradorPrevio.b1
            : (resultadoMesa?.proactivo?.burbuja1
                || resultadoMesa?.proactivo?.mensajePrincipal
                || (resultadoMesa?.ag4?.estrategias?.[0]?.burbuja1)
                || construirTextoPasoAsistenteComercialWa(st));
        const textoBurbuja2Inicial = borradorPrevio
            ? borradorPrevio.b2
            : (resultadoMesa?.proactivo?.burbuja2 || '');
        const textoBurbuja3Inicial = borradorPrevio
            ? borradorPrevio.b3
            : (resultadoMesa?.proactivo?.burbuja3 || '');
        const mostrarB2Inicial = borradorPrevio ? Boolean(borradorPrevio.chkB2) : Boolean(textoBurbuja2Inicial);
        const mostrarB3Inicial = borradorPrevio ? Boolean(borradorPrevio.chkB3) : Boolean(textoBurbuja3Inicial);
        const chkPdfInicial = borradorPrevio ? Boolean(borradorPrevio.chkPdf) : Boolean(st.sugerirAdjuntarPdfIa);
        const chkPdfCcInicial = borradorPrevio
            ? Boolean(borradorPrevio.chkPdfCc)
            : (resultadoMesa?.proactivo?.modoResuelto === 'AVISO_CORTO_CUENTA');
        if (borradorPrevio && borradorPrevio.alcancePdf) {
            st.alcancePdfAdjunto = borradorPrevio.alcancePdf;
        }

        const articulosConStock = (st.catalogoArticulos || []).filter(a => {
            enriquecerMetadatosFiltrosArticuloWa(a);
            return esArticuloActivoEnListaWa(a, st.listaId);
        });
        const totalConStock = articulosConStock.length;
        const totalPadresConStock = articulosConStock.filter(a => a.es_articulo_padre).length;
        const totalFraccLocalConStock = articulosConStock.filter(a => esArticuloFraccionadoLocalWa(a)).length;
        const cantSelPuntual = obtenerArticulosSeleccionadosYSugeridosPdfWa(st).length;
        const cantFiltradosPdfCustom = Array.isArray(st.articulosPdfConfiguradosEnModal) ? st.articulosPdfConfiguradosEnModal.length : 0;
        const alcanceActualPdf = st.alcancePdfAdjunto || 'LISTA_COMPLETA';

        const bannerSinListaAsignadaHtml = st.tieneListaAsignada === false
            ? `<div style="background: #fef2f2; border: 2px solid #ef4444; border-radius: 9px; padding: 7px 11px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                   <div style="font-size: 0.76rem; font-weight: 800; color: #991b1b;">
                       ⚠️ ATENCIÓN: Este cliente NO tiene Lista de Precios asignada en Artículos Búnker. Elegí qué lista aplicar antes de enviar precios:
                   </div>
                   <select onchange="window.cambiarListaPrecioManualAsistenteWa(this.value)" style="padding: 3px 8px; border-radius: 6px; border: 1px solid #dc2626; font-size: 0.74rem; font-weight: 800; background: #ffffff; color: #7f1d1d; cursor: pointer;">
                       ${(st.listasDisponibles || []).map(l => `<option value="${Number(l.id)}" ${Number(l.id) === Number(listaId) ? 'selected' : ''}>Lista #${Number(l.id)} — ${escaparHtml(l.nombre)}</option>`).join('')}
                   </select>
               </div>`
            : '';

        const panelMesaAgentesHtml = (typeof window.renderizarPanelMesaAgentesHtmlWa === 'function' && resultadoMesa)
            ? window.renderizarPanelMesaAgentesHtmlWa(st, resultadoMesa)
            : '';

        const selectorTelefonosClienteHtml = chatsDelMismoCliente.length > 1
            ? `<div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 4px;">
                   <span style="font-size: 0.7rem; font-weight: 800; color: #065f46;">📱 Celular destino:</span>
                   ${chatsDelMismoCliente.map(ch => {
                       const esActivo = Number(ch.id) === Number(chatId);
                       const etiq = ch.contacto_nombre || ch.pushname_wa || 'Contacto';
                       const telCorto = String(ch.telefono_normalizado || '').slice(-10);
                       return `
                           <button type="button" onclick="window.cambiarChatContactoAsistenteWa(${Number(ch.id)})" style="padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 800; cursor: pointer; border: ${esActivo ? '2px solid #059669' : '1px solid #cbd5e1'}; background: ${esActivo ? '#059669' : '#ffffff'}; color: ${esActivo ? '#ffffff' : '#334155'};">
                               ${esActivo ? '✓ ' : ''}${escaparHtml(etiq)} (${escaparHtml(telCorto)})
                           </button>
                       `;
                   }).join('')}
               </div>`
            : '';

        const ultimosMensajesHtml = estadoAsistenteComercialWa.mensajesRecientes.length === 0
            ? '<div style="font-size:0.74rem; color:#64748b;">Sin mensajes recientes en este número.</div>'
            : estadoAsistenteComercialWa.mensajesRecientes.map(m => {
                const quien = m.from_me ? '📤 Nosotros' : `📥 ${escaparHtml(contactoNombreChat || nombreCorto || 'Cliente')}`;
                const esAudioSinTranscribir = String(m.cuerpo || '').trim() === '🎤 Mensaje de audio';
                const esAudioTranscrito = !esAudioSinTranscribir && /^🎤/i.test(String(m.cuerpo || '').trim());
                const bg = m.from_me ? '#dcfce7' : (esAudioTranscrito ? '#eff6ff' : '#ffffff');
                const border = m.from_me ? '#86efac' : (esAudioTranscrito ? '#93c5fd' : '#cbd5e1');
                const rawF = m.fecha_mensaje || m.creado_en || m.fecha;
                let fechaHora = '';
                if (rawF) {
                    try {
                        const d = new Date(rawF);
                        fechaHora = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                    } catch (_) {}
                }
                const txtCuerpo = String(m.cuerpo || '').replace(/\s+/g, ' ');
                const btnTranscribirInline = esAudioSinTranscribir && chatId
                    ? ` <button type="button" onclick="window.transcribirAudiosChatManualWa(${Number(chatId)})" style="padding:1px 6px; border-radius:5px; border:1px solid #2563eb; background:#dbeafe; color:#1d4ed8; font-size:0.66rem; font-weight:800; cursor:pointer;">🎧 Transcribir audio</button>`
                    : '';
                return `
                    <div style="background:${bg}; border:1px solid ${border}; border-radius:7px; padding:4px 8px; font-size:0.73rem; color:#0f172a; display:flex; justify-content:space-between; gap:6px;">
                        <div style="min-width:0; flex:1;">
                            <strong style="color:${m.from_me ? '#166534' : '#0369a1'};">${quien}:</strong>
                            <span style="${esAudioTranscrito ? 'font-weight:700; color:#1e3a8a;' : ''}">${escaparHtml(txtCuerpo.slice(0, 175))}${txtCuerpo.length > 175 ? '…' : ''}</span>${btnTranscribirInline}
                        </div>
                        ${fechaHora ? `<span style="font-size:0.66rem; color:#64748b; white-space:nowrap; font-weight:700;">${escaparHtml(fechaHora)}</span>` : ''}
                    </div>
                `;
            }).join('');

        Swal.fire({
            title: '💬 Asistente Comercial Híbrido (Estructura del Cliente + WhatsApp Ágil)',
            width: '1000px',
            showConfirmButton: false,
            showCloseButton: true,
            html: `
                <div style="text-align: left; font-family: inherit; color: #1e293b; font-size: 0.84rem;">
                    ${bannerSinListaAsignadaHtml}
                    <!-- 1. CABECERA COMPACTA: CLIENTE + SELECTOR DE CELULAR + ÚLTIMOS MENSAJES DEL CHAT -->
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 8px; margin-bottom: 8px;">
                        <!-- Ficha del Cliente y Celular Activo -->
                        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; padding: 8px 11px;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
                                <div>
                                    <div style="font-weight: 800; font-size: 0.92rem; color: #065f46;">
                                        🏢 ${escaparHtml(nombreCliente)} ${codigoBunker ? `<span style="font-size:0.74rem; color:#047857;">(#${escaparHtml(codigoBunker)})</span>` : ''}
                                    </div>
                                    <div style="font-size: 0.72rem; color: ${st.tieneListaAsignada === false ? '#dc2626' : '#0f766e'}; font-weight: 700; margin-top: 1px;">
                                        ${st.tieneListaAsignada === false ? `⚠️ Sin lista asignada en Búnker (usando Lista #${escaparHtml(listaId)})` : `🔒 Lista #${escaparHtml(listaId)} (${escaparHtml(listaNombreInterna)})`} · 📱 ${escaparHtml(contactoNombreChat ? `${contactoNombreChat} (${telefonoCliente})` : (telefonoCliente || 'Sin teléfono'))}
                                    </div>
                                </div>
                                <span style="background:#059669; color:#fff; font-size:0.68rem; font-weight:800; padding:2px 8px; border-radius:999px; white-space:nowrap;">
                                    🛒 ${articulosHabituales.length} habituales
                                </span>
                            </div>
                            ${selectorTelefonosClienteHtml}
                        </div>

                        <!-- Últimos Mensajes Reales en el Chat con Fecha -->
                        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px 11px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                <span style="font-weight: 800; font-size: 0.74rem; color: #334155;">👀 Últimos Mensajes en este Número:</span>
                                <span style="background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; font-size: 0.68rem; font-weight: 800; padding: 1px 7px; border-radius: 999px;">
                                    ${escaparHtml(resultadoMesa?.ag1?.tituloIntencion || detIntencion.etiqueta)}
                                </span>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 3px; max-height: 76px; overflow-y: auto;">
                                ${ultimosMensajesHtml}
                            </div>
                        </div>
                    </div>

                    <!-- 2. ESTRUCTURA HÍBRIDA (HILO + QUÉ/CADA CUÁNTO COMPRA + CÓMO PAGA) Y BOTONERA PROACTIVA 1 CLIC -->
                    <div id="wa-asist-mesa-agentes-box">
                        ${panelMesaAgentesHtml}
                    </div>

                    <!-- 3. SECUENCIA DE MENSAJITOS CORTOS DE WHATSAPP (TEXTO CORTO + INFO DURA SEPARADA + CIERRE ATENTO) -->
                    <div style="background: #f8fafc; border: 2px solid #86efac; border-radius: 10px; padding: 9px 12px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;">
                            <span style="font-weight: 800; font-size: 0.81rem; color: #065f46;">
                                ✍️ Mensajes a enviar (cortos, sin "¿", separando el texto de la info dura):
                            </span>
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <div style="display: inline-flex; align-items: center; gap: 3px; background: #e2e8f0; padding: 2px; border-radius: 7px;" title="Elegí si querés incluir saludo inicial o continuar directo sin saludar">
                                    <button type="button" id="btn-wa-apertura-SALUDO" onclick="window.cambiarModoAperturaAsistenteWa(false)" style="padding: 3px 8px; border-radius: 5px; border: none; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
                                        👋 Con saludo
                                    </button>
                                    <button type="button" id="btn-wa-apertura-EN_CURSO" onclick="window.cambiarModoAperturaAsistenteWa(true)" style="padding: 3px 8px; border-radius: 5px; border: none; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
                                        ⚡ Sin saludo (ya hablamos hoy)
                                    </button>
                                </div>
                                <span id="wa-asist-com-long-badge" style="font-size: 0.71rem; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: #dcfce7; color: #166534;">
                                    ✅ Mensaje corto ideal
                                </span>
                            </div>
                        </div>

                        <div style="font-size: 0.71rem; font-weight: 800; color: #047857; margin-bottom: 3px;">
                            1️⃣ Mensaje 1 — Texto libre corto (recepción / saludo al pie):
                        </div>
                        <textarea id="wa-asist-com-textarea" rows="${Math.min(5, Math.max(2, Math.ceil((textoBurbuja1Inicial || '').length / 95)))}" oninput="window.actualizarIndicadorLongitudAsistenteComercialWa()" style="width: 100%; padding: 7px 10px; border-radius: 8px; border: 1px solid #10b981; font-size: 0.85rem; font-family: inherit; box-sizing: border-box; resize: vertical; background: #ffffff; color: #0f172a; font-weight: 500;">${escaparHtml(textoBurbuja1Inicial)}</textarea>

                        <!-- 2da burbuja: Info Dura separada (Link del Portal / Precios) -->
                        <div style="margin-top: 6px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.73rem; font-weight: 800; color: #0369a1; cursor: pointer;">
                                    <input type="checkbox" id="wa-asist-com-chk-burbuja2" ${mostrarB2Inicial ? 'checked' : ''} onchange="window.toggleSegundaBurbujaAsistenteWa(this.checked)">
                                    <span>2️⃣ Mensaje 2 (separado) — Info dura: Link del Portal o Precios puntuales</span>
                                </label>
                                <div style="display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap;">
                                    <button type="button" onclick="window.insertarSoloLinkPortalEnBurbuja2Wa()" title="Coloca o suma el Link del Portal B2B de este cliente en el Mensaje 2 sin borrar lo que escribiste en el Mensaje 1" style="padding: 1px 7px; border-radius: 5px; font-size: 0.68rem; font-weight: 800; cursor: pointer; border: 1px solid #0284c7; background: #e0f2fe; color: #0369a1;">
                                        🔗 +Link Portal en Msj 2
                                    </button>
                                    <span style="font-size: 0.68rem; font-weight: 800; color: #166534; background: #dcfce7; border: 1px solid #86efac; padding: 1px 7px; border-radius: 999px;">
                                        🔒 Precios 100% Deterministas (Lista #${escaparHtml(listaId)})
                                    </span>
                                </div>
                            </div>
                            <!-- Chips rápidos para quitar en 1 clic cualquier artículo de la Burbuja 2 -->
                            <div id="wa-asist-com-chips-b2" style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;"></div>
                            <div id="wa-asist-com-burbuja2-wrap" style="display: ${mostrarB2Inicial ? 'block' : 'none'}; margin-top: 4px;">
                                <textarea id="wa-asist-com-burbuja2" rows="2" oninput="window.actualizarIndicadorLongitudAsistenteComercialWa()" placeholder="Link del portal o lista corta de precios (se envía separado del texto)..." style="width: 100%; padding: 6px 9px; border-radius: 8px; border: 1px solid #7dd3fc; font-size: 0.82rem; font-family: inherit; box-sizing: border-box; resize: vertical; background: #ffffff; color: #0f172a;">${escaparHtml(textoBurbuja2Inicial)}</textarea>
                            </div>
                        </div>

                        <!-- 3ra burbuja: Cierre corto LAMDA o Recordatorio / Políticas de Saldo -->
                        <div style="margin-top: 5px;">
                            <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.73rem; font-weight: 800; color: #0f766e; cursor: pointer;">
                                <input type="checkbox" id="wa-asist-com-chk-burbuja3" ${mostrarB3Inicial ? 'checked' : ''} onchange="window.toggleTerceraBurbujaAsistenteWa(this.checked)">
                                <span>3️⃣ Mensaje 3 (separado) — Cierre atento LAMDA o Recordatorio / Políticas de Saldo</span>
                            </label>
                            <div id="wa-asist-com-burbuja3-wrap" style="display: ${mostrarB3Inicial ? 'block' : 'none'}; margin-top: 4px;">
                                <textarea id="wa-asist-com-burbuja3" rows="${textoBurbuja3Inicial.split('\n').length > 1 ? Math.min(5, textoBurbuja3Inicial.split('\n').length + 1) : 1}" oninput="window.actualizarIndicadorLongitudAsistenteComercialWa()" placeholder="Cierre corto o comentario de saldo y políticas de lista..." style="width: 100%; padding: 6px 9px; border-radius: 8px; border: 1px solid #5eead4; font-size: 0.82rem; font-family: inherit; box-sizing: border-box; resize: vertical; background: #ffffff; color: #0f172a;">${escaparHtml(textoBurbuja3Inicial)}</textarea>
                            </div>
                        </div>

                        <!-- Barra para instruir por voz o texto al Comité de Agentes + PDF Adjunto -->
                        <div style="margin-top: 7px; padding-top: 7px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <div style="display: flex; gap: 5px; align-items: center; flex: 1; min-width: 280px;">
                                <button type="button" id="btn-wa-asist-com-voz" onclick="window.toggleDictadoVozInstruccionAgenteWa()" style="background: #7c3aed; color: #ffffff; border: none; padding: 5px 10px; border-radius: 6px; font-size: 0.73rem; font-weight: 800; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;" title="Hablale al Comité de Agentes para agregar variantes (ej: castañas tostadas/saladas, damasco turco), quitar una caja grande o armar el PDF adjunto">
                                    🎙️ Hablarle al Agente
                                </button>
                                <input type="text" id="wa-asist-com-ia-prompt" onkeydown="if(event.key==='Enter'){event.preventDefault();window.pedirRedaccionIaEnVivoAsistenteWa();}" placeholder="🎙️ Tocá 'Hablarle al Agente' o escribí (ej: 'sumá castañas tostadas y damasco turco en fracciones chicas en PDF')..." style="flex: 1; padding: 5px 9px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.75rem; background: #ffffff;">
                                <button type="button" id="btn-wa-asist-com-ia-run" onclick="window.pedirRedaccionIaEnVivoAsistenteWa()" style="background: #0284c7; color: #ffffff; border: none; padding: 5px 10px; border-radius: 6px; font-size: 0.73rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
                                    ✨ Adaptar con IA
                                </button>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                ${(resultadoMesa?.ag3?.cuentaId || rayosX?.cuenta_corriente?.cuenta_id) ? `
                                    <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; font-weight: 800; font-size: 0.74rem; color: #6d28d9; background: #faf5ff; border: 1px solid #d8b4fe; padding: 3px 8px; border-radius: 6px;" title="Adjunta ahora el PDF de Resumen de Cuenta Corriente">
                                        <input type="checkbox" id="wa-asist-com-chk-pdf-cc" ${chkPdfCcInicial ? 'checked' : ''}>
                                        <span>📄 Resumen Cuenta PDF</span>
                                    </label>
                                ` : ''}
                                <div style="display: inline-flex; align-items: center; gap: 5px; background: #fffbeb; border: 1px solid #f59e0b; padding: 3px 7px; border-radius: 7px;">
                                    <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-weight: 800; font-size: 0.74rem; color: #b45309; white-space: nowrap;" title="Tildá para adjuntar el PDF de precios elegido al lado junto con tus mensajes">
                                        <input type="checkbox" id="wa-asist-com-chk-pdf" ${chkPdfInicial ? 'checked' : ''} onchange="window.toggleAdjuntarPdfAsistenteWa(this.checked)">
                                        <span id="lbl-wa-asist-com-chk-pdf">📄 Adjuntar PDF:</span>
                                    </label>
                                    <select id="wa-asist-com-sel-alcance-pdf" onchange="window.cambiarAlcancePdfDirectoAsistenteWa(this.value)" style="padding: 2px 6px; border-radius: 5px; border: 1px solid #fcd34d; background: #ffffff; color: #78350f; font-size: 0.73rem; font-weight: 800; cursor: pointer;" title="Elegí qué PDF adjuntar a tu mensaje (queda guardado por defecto para este cliente)">
                                        <option value="LISTA_COMPLETA" ${alcanceActualPdf === 'LISTA_COMPLETA' ? 'selected' : ''}>📋 Lista Completa (${totalConStock} art.)</option>
                                        <option value="SOLO_PADRES" ${alcanceActualPdf === 'SOLO_PADRES' ? 'selected' : ''}>📦 Solo Art. Padre / Packs (${totalPadresConStock} art.)</option>
                                        <option value="FRACCIONADOS_LOCAL" ${alcanceActualPdf === 'FRACCIONADOS_LOCAL' ? 'selected' : ''}>🛍️ Fraccionados y Packs Local (${totalFraccLocalConStock} art.)</option>
                                        <option value="HABITUALES" ${alcanceActualPdf === 'HABITUALES' ? 'selected' : ''}>🛒 Lo que compra (${articulosHabituales.length} art.)</option>
                                        <option value="ACTUALIZACIONES" ${alcanceActualPdf === 'ACTUALIZACIONES' ? 'selected' : ''}>🔔 Actualizaciones (${cambiosPreciosPendientes.length} art.)</option>
                                        <option value="SELECCIONADOS" id="opt-wa-asist-pdf-sel" ${alcanceActualPdf === 'SELECCIONADOS' ? 'selected' : ''}>✅ Seleccionados (${cantSelPuntual} art.)</option>
                                        ${cantFiltradosPdfCustom > 0 ? `<option value="FILTRADO_MODAL" ${alcanceActualPdf === 'FILTRADO_MODAL' ? 'selected' : ''}>🔍 Filtrado en Configurador (${cantFiltradosPdfCustom} art.)</option>` : ''}
                                    </select>
                                    <button type="button" onclick="window.abrirModalListaPreciosBunkerDesdeCrmWa(document.getElementById('wa-asist-com-sel-alcance-pdf')?.value || 'AUTO')" style="background: #ffffff; color: #92400e; border: 1px solid #d97706; padding: 2px 7px; border-radius: 5px; font-size: 0.7rem; font-weight: 800; cursor: pointer; white-space: nowrap;" title="Configurar columnas, alcance y filtros de PDF para este cliente">
                                        ⚙️ Configurar / Ver
                                    </button>
                                    ${st._tieneConfigPdfGuardadaCliente ? `<span id="wa-asist-pdf-default-badge" style="background:#dcfce7; color:#166534; border:1px solid #86efac; padding:1px 6px; border-radius:999px; font-size:0.65rem; font-weight:800; white-space:nowrap;" title="Esta configuración de PDF está guardada como predeterminada para este cliente">💾 Default cliente</span>` : ''}
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 4. CATÁLOGO, CAMBIOS PENDIENTES Y HABITUALES DEL CLIENTE (FILTRADO ACUMULATIVO DINÁMICO + JERARQUÍA B2B) -->
                    <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px 11px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px;">
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <span style="font-weight: 800; font-size: 0.76rem; color: #0f172a;">🛒 Buscador Acumulativo ("siempre filtra sobre lo filtrado"):</span>
                                <span id="wa-asist-com-count-filtrados" style="font-size: 0.69rem; font-weight: 800; color: #0369a1; background: #e0f2fe; border: 1px solid #bae6fd; padding: 1px 7px; border-radius: 999px;"></span>
                            </div>
                            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                                ${articulosMencionadosChat.length > 0 ? `
                                    <button type="button" id="tab-wa-prod-MENCIONADOS" onclick="window.cambiarTabProductosAsistenteComercialWa('MENCIONADOS')" style="padding: 3px 8px; border-radius: 6px; border: 1px solid #f59e0b; background: #fef3c7; color: #92400e; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
                                        💬 Mencionados (${articulosMencionadosChat.length})
                                    </button>
                                ` : ''}
                                ${cambiosPreciosPendientes.length > 0 ? `
                                    <button type="button" id="tab-wa-prod-CAMBIOS_PENDIENTES" onclick="window.cambiarTabProductosAsistenteComercialWa('CAMBIOS_PENDIENTES')" style="padding: 3px 8px; border-radius: 6px; border: 1px solid #f59e0b; background: #fffbeb; color: #92400e; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
                                        🔔 Cambios (${cambiosPreciosPendientes.length})
                                    </button>
                                ` : ''}
                                <button type="button" id="tab-wa-prod-HABITUALES" onclick="window.cambiarTabProductosAsistenteComercialWa('HABITUALES')" style="padding: 3px 8px; border-radius: 6px; border: 1px solid #10b981; background: #ecfdf5; color: #065f46; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
                                    🛒 Lo que nos compra (${articulosHabituales.length})
                                </button>
                                <button type="button" id="tab-wa-prod-SIMILARES" onclick="window.cambiarTabProductosAsistenteComercialWa('SIMILARES')" style="padding: 3px 8px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; color: #334155; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
                                    ✨ Similares (${articulosSimilares.length})
                                </button>
                                <button type="button" id="tab-wa-prod-TODOS" onclick="window.cambiarTabProductosAsistenteComercialWa('TODOS')" style="padding: 3px 8px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; color: #334155; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
                                    🔍 Todo el Catálogo (${todosArticulos.length})
                                </button>
                            </div>
                        </div>

                        <!-- Fila 1: Input por grupos de caracteres + Acciones en lote sobre lo filtrado -->
                        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 6px;">
                            <input type="text" id="wa-asist-com-search" placeholder="🔍 Filtrá por grupos de caracteres y expresiones (ej: 'nuez por 10 mar', 'menor que 2', 'mayor que 2', 'padre', 'ldn 3')..." oninput="window.filtrarBuscadorAsistenteComercialWa(this.value)" style="flex: 1; min-width: 240px; padding: 5px 9px; border-radius: 6px; border: 1px solid #94a3b8; font-size: 0.77rem; font-weight: 600; color: #0f172a;">
                            <button type="button" id="btn-wa-asist-sumar-pdf" onclick="window.sumarFiltradosAlPdfAsistenteWa()" title="Agrega los artículos actualmente filtrados al PDF Adjunto de Precios (sin sobrecargar el Mensaje 2)" style="background: #fffbeb; border: 1px solid #f59e0b; color: #b45309; padding: 5px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
                                📄 +Filtrados al PDF
                            </button>
                            <button type="button" id="btn-wa-asist-sumar-b2" onclick="window.seleccionarFiltradosEnBurbuja2Wa()" title="Suma los artículos filtrados (máx. 8) a la Burbuja 2 del texto" style="background: #ecfdf5; border: 1px solid #10b981; color: #065f46; padding: 5px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; cursor: pointer; white-space: nowrap;">
                                ✅ +En Burbuja 2
                            </button>
                            <button type="button" onclick="window.limpiarSeleccionProductosAsistenteComercialWa()" style="background: #f1f5f9; border: 1px solid #cbd5e1; color: #475569; padding: 5px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; cursor: pointer; white-space: nowrap;">
                                Quitar sel. (<span id="wa-asist-com-count-sel">0</span>)
                            </button>
                        </div>

                        <!-- Fila 2: Barra dinámica de filtros acumulativos (Línea de Negocio + Artículo Padre + Fracción mayor/menor que) -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 7px; padding: 5px 8px; margin-bottom: 6px;">
                            <!-- Línea de Negocio (LDN 1 a 6) -->
                            <div style="display: flex; align-items: center; gap: 3px; flex-wrap: wrap;">
                                <span style="font-size: 0.67rem; font-weight: 800; color: #475569; margin-right: 2px;">Línea:</span>
                                <button type="button" id="btn-wa-ldn-TODAS" onclick="window.toggleFiltroLdnAsistenteWa(0)" style="padding: 2px 6px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #0f172a; background: #0f172a; color: #ffffff;">Todas</button>
                                <button type="button" id="btn-wa-ldn-1" onclick="window.toggleFiltroLdnAsistenteWa(1)" title="Línea 1: Bulto Cerrado Directo (Sin Receta)" style="padding: 2px 6px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">LDN 1 (Bulto)</button>
                                <button type="button" id="btn-wa-ldn-2" onclick="window.toggleFiltroLdnAsistenteWa(2)" title="Línea 2: Fraccionados Mono-Ingrediente" style="padding: 2px 6px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #86efac; background: #ffffff; color: #15803d;">LDN 2 (Fracc.)</button>
                                <button type="button" id="btn-wa-ldn-3" onclick="window.toggleFiltroLdnAsistenteWa(3)" title="Línea 3: Mixes / Carros Granel" style="padding: 2px 6px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #c4b5fd; background: #ffffff; color: #5b21b6;">LDN 3 (Mix)</button>
                                <button type="button" id="btn-wa-ldn-4" onclick="window.toggleFiltroLdnAsistenteWa(4)" title="Línea 4: UP Tostadero Simple" style="padding: 2px 6px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #fde68a; background: #ffffff; color: #92400e;">LDN 4 (Tost.)</button>
                                <button type="button" id="btn-wa-ldn-5" onclick="window.toggleFiltroLdnAsistenteWa(5)" title="Línea 5: Barritas UP" style="padding: 2px 6px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #fecdd3; background: #ffffff; color: #9f1239;">LDN 5 (Barr.)</button>
                                <button type="button" id="btn-wa-ldn-6" onclick="window.toggleFiltroLdnAsistenteWa(6)" title="Línea 6: Granolas Doble Mezcla" style="padding: 2px 6px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #bae6fd; background: #ffffff; color: #0369a1;">LDN 6 (Gran.)</button>
                            </div>

                            <!-- Artículo Padre (Combos 10x500, 10x250, 10x200) vs Individual -->
                            <div style="display: flex; align-items: center; gap: 3px; flex-wrap: wrap;">
                                <span style="font-size: 0.67rem; font-weight: 800; color: #475569; margin-right: 1px;">Tipo:</span>
                                <button type="button" id="btn-wa-padre-SOLO_PADRE" onclick="window.setFiltroTipoPadreAsistenteWa('SOLO_PADRE')" title="Filtra sobre lo filtrado dejando solo Artículos Padre (combos como 10 x 500g, 10 x 250g, 10 x 200g, 10 x 1kg)" style="padding: 2px 7px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #c084fc; background: #ffffff; color: #6b21a8;">
                                    📦 Art. Padre (Combos)
                                </button>
                                <button type="button" id="btn-wa-padre-SOLO_INDIVIDUAL" onclick="window.setFiltroTipoPadreAsistenteWa('SOLO_INDIVIDUAL')" title="Filtra sobre lo filtrado excluyendo combos (solo fracciones/bultos individuales)" style="padding: 2px 7px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">
                                    🔹 Individuales
                                </button>
                            </div>

                            <!-- Filtro por Fracción (Mayor / Menor que X kg) -->
                            <div style="display: flex; align-items: center; gap: 3px; flex-wrap: wrap;">
                                <span style="font-size: 0.67rem; font-weight: 800; color: #475569;">Fracción:</span>
                                <select id="wa-asist-filtro-frac-op" onchange="window.setFiltroFraccionAsistenteWa()" style="padding: 2px 4px; border-radius: 5px; border: 1px solid #cbd5e1; font-size: 0.68rem; font-weight: 800; color: #0f172a; background: #ffffff;">
                                    <option value="">Todas</option>
                                    <option value="<">&lt; Menor que</option>
                                    <option value="<=">&le; Menor o igual a</option>
                                    <option value="=">= Igual a</option>
                                    <option value=">=">&ge; Mayor o igual a</option>
                                    <option value=">">&gt; Mayor que</option>
                                </select>
                                <input type="number" id="wa-asist-filtro-frac-kg" step="0.1" min="0" placeholder="kg (ej: 2)" oninput="window.setFiltroFraccionAsistenteWa()" style="width: 66px; padding: 2px 5px; border-radius: 5px; border: 1px solid #cbd5e1; font-size: 0.69rem; font-weight: 800; color: #0f172a; background: #ffffff;" title="Escribí los kilos (ej: 2 para 2kg, o 500 para 500g)">
                                <button type="button" id="btn-wa-frac-lt2" onclick="window.aplicarPresetFraccionAsistenteWa('<', 2)" title="Fracciones menores de 2 kg (1kg, 500g, 250g, 200g...)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">&lt;2kg</button>
                                <button type="button" id="btn-wa-frac-lte2" onclick="window.aplicarPresetFraccionAsistenteWa('<=', 2)" title="Fracciones de hasta 2 kg inclusive" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">&le;2kg</button>
                                <button type="button" id="btn-wa-frac-gt2" onclick="window.aplicarPresetFraccionAsistenteWa('>', 2)" title="Fracciones mayores de 2 kg (5kg, 10kg, 12kg, 25kg...)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">&gt;2kg</button>
                                <button type="button" id="btn-wa-frac-gte5" onclick="window.aplicarPresetFraccionAsistenteWa('>=', 5)" title="Presentaciones de 5 kg o más" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">&ge;5kg</button>
                                <button type="button" id="btn-wa-limpiar-filtros" onclick="window.limpiarFiltrosBuscadorAsistenteWa()" style="display: none; padding: 2px 7px; border-radius: 5px; font-size: 0.66rem; font-weight: 800; cursor: pointer; border: 1px solid #ef4444; background: #fef2f2; color: #b91c1c;" title="Limpia todos los filtros de texto, línea, artículo padre y fracción">
                                    🧹 Limpiar filtros
                                </button>
                            </div>
                        </div>

                        <div id="wa-asist-com-productos-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 5px; max-height: 165px; overflow-y: auto; padding: 2px;"></div>
                    </div>

                    <!-- BANNER DE ESTADO DE ENVÍO -->
                    <div id="wa-asist-com-status" style="display: none; padding: 8px 12px; border-radius: 8px; border: 1px solid #93c5fd; font-size: 0.79rem; margin-bottom: 10px;"></div>

                    <!-- 5. CAJA DE PRUEBA INTERNA Y BOTONERA DE ENVÍO -->
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 6px; border-top: 1px solid #e2e8f0;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <button type="button" onclick="window.volcarAsistenteComercialAlBorradorWa()" style="background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 7px 11px; border-radius: 8px; font-weight: 800; font-size: 0.76rem; cursor: pointer;">
                                📥 Pasar al Chat (Sin Enviar)
                            </button>
                            <div style="display: inline-flex; align-items: center; gap: 4px; background: #fffbeb; border: 1px solid #fde68a; padding: 3px 6px; border-radius: 8px;">
                                <input type="text" id="wa-asist-com-tel-prueba" value="5492216615746" title="Teléfono de prueba interno" style="width: 115px; padding: 4px 6px; border-radius: 5px; border: 1px solid #f59e0b; font-size: 0.74rem; font-weight: 800; color: #78350f; background: #ffffff;">
                                <button type="button" id="btn-wa-asist-com-test" onclick="window.ejecutarEnvioPruebaAsistenteComercialWa()" style="background: #d97706; color: #ffffff; border: none; padding: 5px 9px; border-radius: 6px; font-weight: 800; font-size: 0.74rem; cursor: pointer; white-space: nowrap;">
                                    🧪 Enviar Prueba
                                </button>
                            </div>
                        </div>
                        <div style="display: flex; gap: 7px; flex-wrap: wrap;">
                            <button type="button" onclick="window.programarAsistenteComercialWa()" style="background: #0284c7; color: #ffffff; border: none; padding: 8px 12px; border-radius: 8px; font-weight: 800; font-size: 0.77rem; cursor: pointer;">
                                📅 Programar Envío
                            </button>
                            <button type="button" id="btn-wa-asist-com-enviar-real" onclick="window.enviarAsistenteComercialAlClienteRealWa(false)" style="background: #128c7e; color: #ffffff; border: none; padding: 8px 18px; border-radius: 8px; font-weight: 800; font-size: 0.84rem; cursor: pointer; box-shadow: 0 2px 5px rgba(18,140,126,0.3);">
                                🚀 Enviar Ahora al Cliente
                            </button>
                        </div>
                    </div>
                </div>
            `,
            didOpen: () => {
                actualizarEstilosPasosAsistenteComercialWa();
                renderizarGridProductosAsistenteComercialWa();
                renderizarChipsSeleccionadosBurbuja2Wa();
                window.actualizarIndicadorLongitudAsistenteComercialWa();
            }
        });
    };

    function obtenerArticulosSeleccionadosYSugeridosPdfWa(st) {
        if (!st) return [];
        const vistos = new Set();
        const lista = [];
        const agregar = (arr) => {
            (Array.isArray(arr) ? arr : []).forEach(a => {
                if (!a || !a.id) return;
                const k = String(a.id);
                if (!vistos.has(k)) {
                    vistos.add(k);
                    lista.push(a);
                }
            });
        };
        const selCuerpo = (st.catalogoArticulos || []).filter(a => st.idsSeleccionados && st.idsSeleccionados.has(String(a.id)));
        agregar(selCuerpo);
        agregar(st.articulosPdfSugeridosIa);
        if (lista.length === 0) {
            if (Array.isArray(st.cambiosPreciosPendientes) && st.cambiosPreciosPendientes.length > 0) {
                agregar(st.cambiosPreciosPendientes);
            } else if (Array.isArray(st.articulosHabituales) && st.articulosHabituales.length > 0) {
                agregar(st.articulosHabituales);
            }
        }
        return ordenarArticulosPorJerarquiaB2BWa(lista);
    }

    function esArticuloFraccionadoLocalWa(art) {
        if (!art) return false;
        enriquecerMetadatosFiltrosArticuloWa(art);
        if (art.es_articulo_padre) return true;
        const kgU = Number(art.kilos_unidad || art.peso_bulto || 1);
        const kgF = Number(art.kilos_fraccion || kgU || 1);
        const ldn = Number(art.linea_negocio || 1);
        if ((ldn === 5 || ldn === 6) && kgU <= 3.05) return true;
        if (kgF <= 2.05 && kgU <= 2.05 && ldn !== 1) return true;
        if (kgU <= 1.05) return true;
        return false;
    }

    window.cambiarListaPrecioManualAsistenteWa = async function (nuevaListaId) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const lid = Number(nuevaListaId) || 1;
        const lObj = (st.listasDisponibles || []).find(l => Number(l.id) === lid);
        await window.abrirAsistenteComercialConversacionWa({
            chatId: st.chatId,
            clienteId: st.clienteId,
            codigoBunker: st.codigoBunker,
            nombreCliente: st.nombreCliente,
            telefono: st.telefonoCliente,
            tieneListaAsignada: st.tieneListaAsignada,
            listaId: lid,
            listaNombre: lObj ? lObj.nombre : `Lista #${lid}`
        });
    };

    function obtenerArticulosParaPdfAdjuntoAsistenteWa(st) {
        if (!st) return [];
        const cfg = st.configModalPdfBunker || {};
        const nivActivos = Array.isArray(cfg.nivelesAgrupar) && cfg.nivelesAgrupar.length > 0 ? cfg.nivelesAgrupar : ['familia', 'principal'];
        const alc = st.alcancePdfAdjunto || cfg.alcance || 'SELECCIONADOS';
        if (alc === 'FILTRADO_MODAL' && Array.isArray(st.articulosPdfConfiguradosEnModal) && st.articulosPdfConfiguradosEnModal.length > 0) {
            return ordenarArticulosPorJerarquiaB2BWa(st.articulosPdfConfiguradosEnModal, nivActivos);
        }
        if (cfg && cfg.alcance === alc && Array.isArray(st.articulosPdfConfiguradosEnModal) && st.articulosPdfConfiguradosEnModal.length > 0 && cfg._tieneFiltroActivo) {
            return ordenarArticulosPorJerarquiaB2BWa(st.articulosPdfConfiguradosEnModal, nivActivos);
        }
        if (alc === 'SOLO_PADRES') {
            return ordenarArticulosPorJerarquiaB2BWa(
                (st.catalogoArticulos || []).filter(a => {
                    enriquecerMetadatosFiltrosArticuloWa(a);
                    return esArticuloActivoEnListaWa(a, st.listaId) && Boolean(a.es_articulo_padre);
                }),
                nivActivos
            );
        }
        if (alc === 'FRACCIONADOS_LOCAL') {
            return ordenarArticulosPorJerarquiaB2BWa(
                (st.catalogoArticulos || []).filter(a => esArticuloActivoEnListaWa(a, st.listaId) && esArticuloFraccionadoLocalWa(a)),
                nivActivos
            );
        }
        if (alc === 'LISTA_COMPLETA') {
            return ordenarArticulosPorJerarquiaB2BWa(
                (st.catalogoArticulos || []).filter(a => esArticuloActivoEnListaWa(a, st.listaId)),
                nivActivos
            );
        }
        if (alc === 'HABITUALES') {
            const habs = (st.articulosHabituales && st.articulosHabituales.length > 0)
                ? st.articulosHabituales
                : (st.catalogoArticulos || []).filter(a => esArticuloActivoEnListaWa(a, st.listaId));
            return ordenarArticulosPorJerarquiaB2BWa(habs, nivActivos);
        }
        if (alc === 'ACTUALIZACIONES') {
            const acts = (st.cambiosPreciosPendientes && st.cambiosPreciosPendientes.length > 0)
                ? st.cambiosPreciosPendientes
                : (st.cambiosPreciosTodos && st.cambiosPreciosTodos.length > 0
                    ? st.cambiosPreciosTodos
                    : obtenerArticulosSeleccionadosYSugeridosPdfWa(st));
            return ordenarArticulosPorJerarquiaB2BWa(acts, nivActivos);
        }
        return ordenarArticulosPorJerarquiaB2BWa(obtenerArticulosSeleccionadosYSugeridosPdfWa(st), nivActivos);
    }

    window.toggleAdjuntarPdfAsistenteWa = function (checked) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.sugerirAdjuntarPdfIa = Boolean(checked);
        persistirConfigModalPdfClienteEnServidorWa(st, {
            configuradoManualmente: true,
            adjuntarPdfDefault: Boolean(checked)
        });
    };

    window.cambiarAlcancePdfDirectoAsistenteWa = function (nuevoAlcance) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.alcancePdfAdjunto = nuevoAlcance || 'LISTA_COMPLETA';
        if (st.configModalPdfBunker && st.alcancePdfAdjunto !== 'FILTRADO_MODAL') {
            st.configModalPdfBunker.alcance = st.alcancePdfAdjunto;
        }
        const chkPdf = document.getElementById('wa-asist-com-chk-pdf');
        if (chkPdf) chkPdf.checked = true;
        st.sugerirAdjuntarPdfIa = true;
        persistirConfigModalPdfClienteEnServidorWa(st, {
            configuradoManualmente: true,
            adjuntarPdfDefault: true,
            alcanceOverride: st.alcancePdfAdjunto
        });
        renderizarChipsSeleccionadosBurbuja2Wa();
    };

    function renderizarChipsSeleccionadosBurbuja2Wa() {
        const st = estadoAsistenteComercialWa;
        const box = document.getElementById('wa-asist-com-chips-b2');
        const selAlc = document.getElementById('wa-asist-com-sel-alcance-pdf');
        const optSel = document.getElementById('opt-wa-asist-pdf-sel');
        if (!st) return;

        const cantSelPuntual = obtenerArticulosSeleccionadosYSugeridosPdfWa(st).length;
        if (optSel) {
            optSel.textContent = `✅ Seleccionados (${cantSelPuntual} art.)`;
        }
        if (selAlc && st.alcancePdfAdjunto) {
            selAlc.value = st.alcancePdfAdjunto;
        }

        if (!box) return;
        const seleccionados = (st.catalogoArticulos || []).filter(a => st.idsSeleccionados && st.idsSeleccionados.has(String(a.id)));
        if (seleccionados.length === 0) {
            box.innerHTML = '';
            return;
        }
        box.innerHTML = `<span style="font-size:0.68rem; font-weight:800; color:#475569; align-self:center; margin-right:2px;">En Burbuja 2 (tocá ✖ para sacar):</span>` +
            seleccionados.map(art => {
                const infoP = formatearPrecioArticuloListaWa(art, st.listaId);
                const pBulto = Math.round(Number(art.precio_nuevo_bulto || infoP.precioBulto || 0));
                return `
                    <button type="button" onclick="window.toggleArticuloAsistenteComercialWa('${escaparHtml(String(art.id))}')" title="Clic para quitar este artículo del Mensaje 2" style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; font-size:0.69rem; font-weight:800; cursor:pointer; border:1px solid #059669; background:#ecfdf5; color:#065f46;">
                        <span>${escaparHtml(art.nombre)} ($${pBulto.toLocaleString('es-AR')})</span>
                        <span style="color:#dc2626; font-weight:900; margin-left:2px;">✖</span>
                    </button>
                `;
            }).join('');
    }

    window.toggleRadiografia3TarjetasWa = function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.mostrarRadiografia3Tarjetas = !st.mostrarRadiografia3Tarjetas;
        const boxMesa = document.getElementById('wa-asist-mesa-agentes-box');
        if (boxMesa && typeof window.renderizarPanelMesaAgentesHtmlWa === 'function' && st.resultadoMesa) {
            boxMesa.innerHTML = window.renderizarPanelMesaAgentesHtmlWa(st, st.resultadoMesa);
        }
    };

    function sincronizarMesaAgentesYEditorWa() {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const resultadoMesa = typeof window.ejecutarMesaAgentesComercialesWa === 'function'
            ? window.ejecutarMesaAgentesComercialesWa(st)
            : null;
        st.resultadoMesa = resultadoMesa;

        const boxMesa = document.getElementById('wa-asist-mesa-agentes-box');
        if (boxMesa && typeof window.renderizarPanelMesaAgentesHtmlWa === 'function' && resultadoMesa) {
            boxMesa.innerHTML = window.renderizarPanelMesaAgentesHtmlWa(st, resultadoMesa);
        }

        const b1 = resultadoMesa?.proactivo?.burbuja1
            || resultadoMesa?.proactivo?.mensajePrincipal
            || (resultadoMesa?.ag4?.estrategias?.[0]?.burbuja1)
            || construirTextoPasoAsistenteComercialWa(st);
        const b2 = resultadoMesa?.proactivo?.burbuja2 || '';
        const b3 = resultadoMesa?.proactivo?.burbuja3 || '';

        const area1 = document.getElementById('wa-asist-com-textarea');
        if (area1) {
            area1.value = b1;
            area1.rows = Math.min(5, Math.max(2, Math.ceil((b1 || '').length / 95)));
        }

        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2');
        const wrapB2 = document.getElementById('wa-asist-com-burbuja2-wrap');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        if (area2) area2.value = b2;
        if (chkB2) chkB2.checked = Boolean(b2);
        if (wrapB2) wrapB2.style.display = b2 ? 'block' : 'none';

        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3');
        const wrapB3 = document.getElementById('wa-asist-com-burbuja3-wrap');
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        if (area3) {
            area3.value = b3;
            area3.rows = b3 && (b3.split('\n').length > 1 || b3.length > 95) ? Math.min(5, b3.split('\n').length + 1) : 1;
        }
        if (chkB3) chkB3.checked = Boolean(b3);
        if (wrapB3) wrapB3.style.display = b3 ? 'block' : 'none';

        const chkPdfCc = document.getElementById('wa-asist-com-chk-pdf-cc');
        if (chkPdfCc) {
            chkPdfCc.checked = resultadoMesa?.proactivo?.modoResuelto === 'AVISO_CORTO_CUENTA';
        }

        actualizarEstilosPasosAsistenteComercialWa();
        renderizarChipsSeleccionadosBurbuja2Wa();
        window.actualizarIndicadorLongitudAsistenteComercialWa();
    }

    window.elegirAccionProactivaAsistenteWa = function (modoId) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.modoAccionProactiva = modoId;
        sincronizarMesaAgentesYEditorWa();
    };

    window.rotarVarianteSaludoAsistenteWa = function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.varianteSaludoIdx = ((st.varianteSaludoIdx || 0) + 1) % 12;
        sincronizarMesaAgentesYEditorWa();
    };

    window.achicarMensajeProactivoAsistenteWa = function () {
        const st = estadoAsistenteComercialWa;
        const area1 = document.getElementById('wa-asist-com-textarea');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2');
        const wrapB2 = document.getElementById('wa-asist-com-burbuja2-wrap');
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3');
        const wrapB3 = document.getElementById('wa-asist-com-burbuja3-wrap');
        if (!st || !area1) return;

        const info = st.resultadoMesa?.infoContacto || {};
        const ag1 = st.resultadoMesa?.ag1 || {};
        const apodo = info.apodoCorto || info.nombrePila || '';
        const nomFormal = info.nombreFormalPila || info.nombrePila || apodo;
        const buenDiaCap = info.saludoMomentoCap || 'Buen día';

        // Al pedir "Tanteo corto (1 línea)", apagamos Burbuja 2 y Burbuja 3 para dejar un único toque de WhatsApp real
        if (chkB2) chkB2.checked = false;
        if (wrapB2) wrapB2.style.display = 'none';
        if (chkB3) chkB3.checked = false;
        if (wrapB3) wrapB3.style.display = 'none';
        if (area2) area2.value = '';
        if (area3) area3.value = '';

        let variantesCortas = [];
        if (ag1.clienteHabloUltimo && ag1.situacionDialogo !== 'CLIENTE_POSTERGO_Y_LLEGO_MOMENTO') {
            variantesCortas = apodo
                ? [
                    `Acá andamos ${apodo}, con cosas varias... Contame, qué querés hacer?`,
                    `Bien ${apodo}, todo tranquilo! Contame cómo venís con eso.`,
                    `Dale ${apodo}, genial! Decime cómo te queda más cómodo.`
                ]
                : [
                    `Acá andamos, todo tranquilo! Contame, qué querés hacer?`,
                    `Dale, genial! Decime cómo te queda más cómodo.`
                ];
        } else {
            variantesCortas = apodo
                ? [
                    `Hola ${apodo}, cómo andás?`,
                    `${buenDiaCap} ${apodo}, cómo andás?`,
                    `${nomFormal}! Cómo va?`,
                    `Hola ${apodo}, todo bien?`,
                    `Hola ${apodo}, cómo va?`
                ]
                : [
                    `Hola! Cómo andan?`,
                    `${buenDiaCap}, cómo andan?`,
                    `Hola, cómo va todo?`
                ];
        }
        st.modoAccionProactiva = 'TANTEO_CORTO';
        st._achicarIdx = ((st._achicarIdx || 0) + 1) % variantesCortas.length;
        area1.value = variantesCortas[st._achicarIdx];
        window.actualizarIndicadorLongitudAsistenteComercialWa();
    };

    /**
     * Sincroniza la coherencia entre Mensaje 1, Mensaje 2 y Mensaje 3 cuando el usuario
     * activa o desactiva manualmente los checkboxes de Burbuja 2 o Burbuja 3:
     *   - Si Burbuja 2 o Burbuja 3 están activas, quita cualquier cierre ("Estoy atento", etc.) del final de Burbuja 1.
     *   - Si Burbuja 3 se activa y está vacía, le coloca un cierre que NO repita palabras de Burbuja 1.
     *   - Si Burbuja 2 se activa y está vacía, le coloca el link del Portal y adapta el final de Burbuja 1.
     */
    function sincronizarCoherenciaEntreBurbujasWa() {
        const st = estadoAsistenteComercialWa;
        const area1 = document.getElementById('wa-asist-com-textarea');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2');
        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3');
        if (!area1) return;

        const b2Activa = Boolean(chkB2 && chkB2.checked);
        const b3Activa = Boolean(chkB3 && chkB3.checked);

        const limpiarCierre = typeof window.limpiarCierreRedundanteBurbuja1Wa === 'function'
            ? window.limpiarCierreRedundanteBurbuja1Wa
            : (t => String(t || '').replace(/(?:\r?\n|\s)+(?:estoy|quedo|quedamos|estamos)\s+atent[oa]s?(?:\s+por\s+cualquier\s+cosa)?[.!]*$/i, '').trim());

        if (b2Activa && area2 && !String(area2.value || '').trim()) {
            const infoDuraLink = st?.resultadoMesa?.proactivo?.infoDuraLinkPortal
                || st?.resultadoMesa?.proactivo?.linkElegido
                || st?.linkActivacionCorto
                || st?.urlPortalBase
                || URL_PORTAL_B2B_OFICIAL;
            area2.value = infoDuraLink;
        }

        if (b2Activa || b3Activa) {
            // Quitar cualquier cierre prematuro ("Estoy atento.", etc.) del final del Mensaje 1
            const limpio1 = limpiarCierre(area1.value);
            if (limpio1) {
                area1.value = limpio1;
            }
            // Si activó Burbuja 2 (Link del Portal) y el Mensaje 1 no menciona el link, agregar puente natural
            if (b2Activa && area2 && /https?:\/\//i.test(area2.value) && !/portal|link|acceso|precios\s+actualizados/i.test(area1.value)) {
                area1.value = `${area1.value.trim()} Te dejo acá abajo el link del portal por si querés mirar precios.`;
            }
        }

        if (b3Activa && area3) {
            const norm1 = String(area1.value || '').toLowerCase();
            let txt3 = String(area3.value || '').trim();
            const esTextoSaldoEnB3 = /saldo\s+pendiente|cuenta\s+corriente|bonificaci[oó]n\s+por\s+volumen|cuenta\s+al\s+d[ií]a/i.test(txt3);
            const cierreIaContextual = String(
                st?.razonamientoIa?.burbuja3_cierre
                || st?.resultadoMesa?.proactivo?.cierreSugerido3raBurbuja
                || ''
            ).trim();
            const cierresAlternativos = [
                'Cualquier cosa estamos atentos.',
                'Quedamos atentos por cualquier cosa.',
                'Estoy atento por cualquier cosa.',
                'Avisame cualquier duda que tengas.',
                'Quedamos a disposición por cualquier consulta.'
            ];
            if (!esTextoSaldoEnB3 && (!txt3 || (norm1.includes('atento') && txt3.toLowerCase().includes('atento')))) {
                if (cierreIaContextual && !(norm1.includes('atento') && cierreIaContextual.toLowerCase().includes('atento'))) {
                    area3.value = cierreIaContextual;
                } else {
                    const elegido = cierresAlternativos.find(c => {
                        const cl = c.toLowerCase();
                        if (norm1.includes('atento') && cl.includes('atento')) return false;
                        if (norm1.includes('escribime') && cl.includes('escribime')) return false;
                        if (norm1.includes('avisame') && cl.includes('avisame')) return false;
                        return true;
                    }) || cierresAlternativos[0];
                    area3.value = elegido;
                }
            }
        } else if (!b2Activa && !b3Activa) {
            // Si quedó solo el Mensaje 1, limpiamos cualquier puente colgado al link, y NO agregamos "Estoy atento" si es un tanteo o pregunta directa
            const actual1 = String(area1.value || '').replace(/\s*Te dejo ac[aá] abajo el link del portal por si quer[eé]s mirar precios\.?$/i, '').trim();
            const modoAct = st?.modoAccionProactiva || st?.resultadoMesa?.proactivo?.modoResuelto || '';
            const esTanteoOPingPong = modoAct === 'TANTEO_CORTO' || modoAct === 'PING_PONG_TEMA' || /\?$/.test(actual1) || actual1.length <= 55;
            if (actual1 && !esTanteoOPingPong && !/(?:atent[oa]s?|disposici[oó]n|escribime|avisame)[.!]*$/i.test(actual1)) {
                const txt3Prev = String(area3?.value || '').trim();
                const cierreRestaurar = (txt3Prev && txt3Prev.length < 80) ? txt3Prev : 'Estoy atento.';
                area1.value = `${actual1}\n${cierreRestaurar}`;
            } else {
                area1.value = actual1;
            }
        }
    }

    window.sumarLinkPortalAlMensajeAsistenteWa = function () {
        const st = estadoAsistenteComercialWa;
        const area1 = document.getElementById('wa-asist-com-textarea');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2');
        const wrapB2 = document.getElementById('wa-asist-com-burbuja2-wrap');
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3');
        const wrapB3 = document.getElementById('wa-asist-com-burbuja3-wrap');
        if (!st || !area1) return;

        const infoDuraLink = st.resultadoMesa?.proactivo?.infoDuraLinkPortal
            || st.resultadoMesa?.proactivo?.linkElegido
            || st.linkActivacionCorto
            || st.urlPortalBase
            || URL_PORTAL_B2B_OFICIAL;

        // Si en la Burbuja 2 había una mención o explicación de saldo pendiente, la pasamos a la Burbuja 3 para no perderla
        const txt2Actual = String(area2?.value || '').trim();
        if (txt2Actual && !/https?:\/\//i.test(txt2Actual) && /saldo|cuenta\s+corriente|bonificaci[oó]n/i.test(txt2Actual) && area3) {
            area3.value = txt2Actual;
            area3.rows = Math.min(6, Math.max(2, txt2Actual.split('\n').length + 1));
        }

        if (area2) {
            area2.value = infoDuraLink;
            area2.rows = 2;
        }
        if (chkB2) chkB2.checked = true;
        if (wrapB2) wrapB2.style.display = 'block';

        if (chkB3) chkB3.checked = true;
        if (wrapB3) wrapB3.style.display = 'block';

        sincronizarCoherenciaEntreBurbujasWa();
        window.actualizarIndicadorLongitudAsistenteComercialWa();
    };

    /**
     * Incorpora en 1 clic la mención del saldo pendiente y/o la explicación de las políticas
     * de su Lista de Precios asignada dentro del Asistente Comercial Híbrido:
     *   - 'CORTO': agrega un recordatorio corto y cálido en burbuja separada (en B3 si B2 tiene el Link/Precios, o en B2 si no).
     *   - 'CORTO_EN_B1': incrusta la mención corta directamente dentro del Mensaje 1.
     *   - 'DETALLE_POLITICAS': agrega en burbuja separada el detalle del saldo, días de antigüedad, pagos parciales y beneficios de su Lista (5% > $300k + ofertas con saldo $0).
     *   - 'BENEFICIO_AL_DIA': recuerda al cliente con saldo $0 que tiene activo el 5% (> $300.000) y ofertas.
     */
    window.incorporarMencionSaldoAsistenteWa = function (modoSaldo = 'CORTO') {
        const st = estadoAsistenteComercialWa;
        const area1 = document.getElementById('wa-asist-com-textarea');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2');
        const wrapB2 = document.getElementById('wa-asist-com-burbuja2-wrap');
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3');
        const wrapB3 = document.getElementById('wa-asist-com-burbuja3-wrap');
        const statusEl = document.getElementById('wa-asist-com-status');
        if (!st || !area1) return;

        if (st._ultimoModoSaldoClick === modoSaldo) {
            st._offsetVarianteSaldo = ((st._offsetVarianteSaldo || 0) + 1) % 6;
        } else {
            st._ultimoModoSaldoClick = modoSaldo;
            st._offsetVarianteSaldo = 0;
        }

        const resMesa = st.resultadoMesa || (typeof window.ejecutarMesaAgentesComercialesWa === 'function' ? window.ejecutarMesaAgentesComercialesWa(st) : null);
        const infoContacto = resMesa?.infoContacto || {};
        const ag3 = resMesa?.ag3 || {};
        const textos = typeof window.generarTextosMencionSaldoWa === 'function'
            ? window.generarTextosMencionSaldoWa(st, infoContacto, ag3, st._offsetVarianteSaldo)
            : null;
        if (!textos) return;

        const limpiarCierre = typeof window.limpiarCierreRedundanteBurbuja1Wa === 'function'
            ? window.limpiarCierreRedundanteBurbuja1Wa
            : (t => String(t || '').trim());

        if (modoSaldo === 'CORTO_EN_B1') {
            // Quitar cualquier mención corta previa de saldo que hayamos insertado en B1 para poder rotarla limpio
            let b1Actual = String(area1.value || '').trim();
            b1Actual = b1Actual
                .replace(/\s*(?:De paso te encargo|Te recuerdo tambi[eé]n cortito|De paso te comento que ten[eé]s pendiente|Te encargo de paso cuando puedas ver)[^.!?\n]*[.!?]/gi, '')
                .trim();

            const b2Activa = Boolean(chkB2 && chkB2.checked);
            const b3Activa = Boolean(chkB3 && chkB3.checked);
            let b1SinCierre = limpiarCierre(b1Actual);

            const regexPuentePortal = /(\s*Te\s+(?:dejo|paso|adjunto)\s+ac[aá]\s+abajo\s+el\s+(?:link|acceso)\s+del\s+portal[^.!?\n]*[.!?]?)$/i;
            const matchPuente = b1SinCierre.match(regexPuentePortal);

            if (matchPuente) {
                const antesPuente = b1SinCierre.slice(0, matchPuente.index).trim();
                b1SinCierre = `${antesPuente} ${textos.mencionCortaInline}${matchPuente[1]}`;
            } else {
                b1SinCierre = `${b1SinCierre} ${textos.mencionCortaInline}`.trim();
            }

            if (!b2Activa && !b3Activa) {
                b1SinCierre = `${b1SinCierre}\nCualquier cosa escribime por acá.`;
            }
            area1.value = b1SinCierre;
            area1.rows = Math.min(5, Math.max(3, b1SinCierre.split('\n').length + 1));
        } else {
            const textoBurbujaSaldo = modoSaldo === 'DETALLE_POLITICAS'
                ? textos.detalleSaldoYPoliticasBurbuja
                : textos.mencionCortaBurbuja;

            // Limpiar el cierre del final del Mensaje 1 porque ahora el cierre irá al final de la burbuja de saldo
            const b1Limpio = limpiarCierre(area1.value);
            if (b1Limpio) area1.value = b1Limpio;

            const txt2 = String(area2?.value || '').trim();
            const b2TieneLinkOPrecios = Boolean(chkB2 && chkB2.checked && (/https?:\/\//i.test(txt2) || /•\s*\*/.test(txt2) || /Código de acceso:/i.test(txt2)));

            if (b2TieneLinkOPrecios && area3) {
                // Mantiene el Link o Precios en el Mensaje 2 y coloca el Saldo / Políticas en el Mensaje 3
                area3.value = textoBurbujaSaldo;
                area3.rows = modoSaldo === 'DETALLE_POLITICAS' ? 5 : 2;
                if (chkB3) chkB3.checked = true;
                if (wrapB3) wrapB3.style.display = 'block';
            } else if (area2) {
                // Coloca el Saldo / Políticas en el Mensaje 2 (separado del saludo) y apaga B3 para no duplicar cierre
                area2.value = textoBurbujaSaldo;
                area2.rows = modoSaldo === 'DETALLE_POLITICAS' ? 5 : 2;
                if (chkB2) chkB2.checked = true;
                if (wrapB2) wrapB2.style.display = 'block';
                if (chkB3) chkB3.checked = false;
                if (wrapB3) wrapB3.style.display = 'none';
            }
        }

        window.actualizarIndicadorLongitudAsistenteComercialWa();

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = '#faf5ff';
            statusEl.style.borderColor = '#c4b5fd';
            statusEl.style.color = '#4c1d95';
            const etiqModo = modoSaldo === 'DETALLE_POLITICAS'
                ? `Detalle de saldo (${ag3.saldoFmt || '$0'}${ag3.antiguedadMax > 0 ? ` · ${ag3.antiguedadMax} días` : ''}) y políticas de su Lista en burbuja separada`
                : (modoSaldo === 'CORTO_EN_B1'
                    ? `Mención corta de saldo integrada dentro del Mensaje 1`
                    : `Recordatorio corto de saldo (${ag3.saldoFmt || '$0'}) en burbuja separada`);
            statusEl.innerHTML = `💳 <strong>${escaparHtml(etiqModo)}</strong> (variante #${(st._offsetVarianteSaldo || 0) + 1}). <em>Si volvés a tocar el botón, rota otra variante de redacción.</em>`;
        }
    };

    window.toggleSegundaBurbujaAsistenteWa = function (checked) {
        const wrap = document.getElementById('wa-asist-com-burbuja2-wrap');
        if (wrap) {
            wrap.style.display = checked ? 'block' : 'none';
        }
        sincronizarCoherenciaEntreBurbujasWa();
        window.actualizarIndicadorLongitudAsistenteComercialWa();
    };

    window.toggleTerceraBurbujaAsistenteWa = function (checked) {
        const wrap = document.getElementById('wa-asist-com-burbuja3-wrap');
        if (wrap) {
            wrap.style.display = checked ? 'block' : 'none';
        }
        sincronizarCoherenciaEntreBurbujasWa();
        window.actualizarIndicadorLongitudAsistenteComercialWa();
    };

    window.cambiarChatContactoAsistenteWa = async function (nuevoChatId) {
        if (!nuevoChatId) return;
        if (typeof window.seleccionarChatConsola === 'function') {
            await window.seleccionarChatConsola(Number(nuevoChatId), false);
        }
        await window.abrirAsistenteComercialConversacionWa({ chatId: Number(nuevoChatId) });
    };

    window.forzarRelecturaProfundaClienteWa = async function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        await window.abrirAsistenteComercialConversacionWa({
            chatId: Number(st.chatId || 0),
            clienteId: st.clienteId,
            forzarRelectura: true
        });
    };

    window.refrescarVistaMesaAgentesWa = function () {
        sincronizarMesaAgentesYEditorWa();
    };

    window.seleccionarEstrategiaMesaAgentesWa = function (estrategiaId) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.estrategiaActivaId = estrategiaId;
        st.modoAccionProactiva = estrategiaId;
        sincronizarMesaAgentesYEditorWa();
    };

    let _grabadorVozAgenteWa = null;
    let _chunksVozAgenteWa = [];
    let _streamVozAgenteWa = null;
    let _reconocedorVozEnVivoWa = null;
    let _textoDictadoEnVivoWa = '';

    /**
     * Convierte cualquier Blob de audio grabado en el navegador (ej: audio/webm;codecs=opus de Chrome)
     * a un buffer PCM 16-bit mono de 16kHz en formato estándar audio/wav compatible 100% con Gemini Multimodal.
     */
    async function convertirBlobAudioAWavBase64Wa(blob) {
        const arrayBuf = await blob.arrayBuffer();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        try {
            const audioBuffer = await ctx.decodeAudioData(arrayBuf.slice(0));
            const targetRate = 16000;
            const ratio = audioBuffer.sampleRate / targetRate;
            const ch0 = audioBuffer.getChannelData(0);
            const numSamples = Math.max(1, Math.floor(ch0.length / ratio));
            const wavBuf = new ArrayBuffer(44 + numSamples * 2);
            const view = new DataView(wavBuf);

            const writeStr = (offset, str) => {
                for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
            };
            writeStr(0, 'RIFF');
            view.setUint32(4, 36 + numSamples * 2, true);
            writeStr(8, 'WAVE');
            writeStr(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true); // PCM
            view.setUint16(22, 1, true); // Mono
            view.setUint32(24, targetRate, true);
            view.setUint32(28, targetRate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            writeStr(36, 'data');
            view.setUint32(40, numSamples * 2, true);

            let peak = 0;
            for (let i = 0; i < numSamples; i++) {
                const idx = Math.min(ch0.length - 1, Math.floor(i * ratio));
                const s = Math.max(-1, Math.min(1, ch0[idx] || 0));
                if (Math.abs(s) > peak) peak = Math.abs(s);
                view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }

            const bytes = new Uint8Array(wavBuf);
            let binary = '';
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
            }
            return {
                base64: btoa(binary),
                mimeType: 'audio/wav',
                peak
            };
        } finally {
            try { await ctx.close(); } catch (_) {}
        }
    }

    window.toggleDictadoVozInstruccionAgenteWa = async function () {
        const btnVoz = document.getElementById('btn-wa-asist-com-voz');
        const inp = document.getElementById('wa-asist-com-ia-prompt');
        const statusEl = document.getElementById('wa-asist-com-status');

        if (_grabadorVozAgenteWa && _grabadorVozAgenteWa.state === 'recording') {
            try {
                if (_reconocedorVozEnVivoWa) _reconocedorVozEnVivoWa.stop();
            } catch (_) {}
            _grabadorVozAgenteWa.stop();
            return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = '#fef2f2';
                statusEl.style.borderColor = '#fecaca';
                statusEl.style.color = '#991b1b';
                statusEl.textContent = '⚠️ Tu navegador no permite acceso al micrófono en esta ventana.';
            }
            return;
        }

        try {
            _streamVozAgenteWa = await navigator.mediaDevices.getUserMedia({ audio: true });
            _chunksVozAgenteWa = [];
            _textoDictadoEnVivoWa = '';

            // Iniciar reconocimiento de voz en vivo en paralelo para mostrar las palabras en tiempo real y servir de respaldo
            const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRec) {
                try {
                    _reconocedorVozEnVivoWa = new SpeechRec();
                    _reconocedorVozEnVivoWa.lang = 'es-AR';
                    _reconocedorVozEnVivoWa.continuous = true;
                    _reconocedorVozEnVivoWa.interimResults = true;
                    _reconocedorVozEnVivoWa.onresult = (ev) => {
                        let finalStr = '';
                        let interimStr = '';
                        for (let i = 0; i < ev.results.length; i++) {
                            const tr = ev.results[i][0]?.transcript || '';
                            if (ev.results[i].isFinal) finalStr += tr + ' ';
                            else interimStr += tr;
                        }
                        const combinado = (finalStr + interimStr).trim();
                        if (combinado) {
                            _textoDictadoEnVivoWa = combinado;
                            if (inp) inp.value = combinado;
                        }
                    };
                    _reconocedorVozEnVivoWa.onerror = () => {};
                    _reconocedorVozEnVivoWa.start();
                } catch (_) {
                    _reconocedorVozEnVivoWa = null;
                }
            }

            const mimePreferido = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : '');
            _grabadorVozAgenteWa = mimePreferido
                ? new MediaRecorder(_streamVozAgenteWa, { mimeType: mimePreferido })
                : new MediaRecorder(_streamVozAgenteWa);

            _grabadorVozAgenteWa.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) _chunksVozAgenteWa.push(ev.data);
            };

            _grabadorVozAgenteWa.onstop = async () => {
                try {
                    try {
                        if (_reconocedorVozEnVivoWa) _reconocedorVozEnVivoWa.stop();
                    } catch (_) {}
                    if (_streamVozAgenteWa) {
                        _streamVozAgenteWa.getTracks().forEach(t => t.stop());
                        _streamVozAgenteWa = null;
                    }
                    if (btnVoz) {
                        btnVoz.disabled = true;
                        btnVoz.style.background = '#6d28d9';
                        btnVoz.innerHTML = '⏳ Procesando voz...';
                    }
                    if (statusEl) {
                        statusEl.style.display = 'block';
                        statusEl.style.background = '#eff6ff';
                        statusEl.style.borderColor = '#93c5fd';
                        statusEl.style.color = '#1e3a8a';
                        statusEl.innerHTML = '🎧 <strong>Interpretando tu instrucción de voz con Gemini y ejecutando el Comité de Agentes...</strong>';
                    }

                    const mimeFinal = _grabadorVozAgenteWa?.mimeType || 'audio/webm';
                    const blob = new Blob(_chunksVozAgenteWa, { type: mimeFinal });
                    let textoTranscritoFinal = '';

                    if (blob.size > 150) {
                        try {
                            const b64Nativo = await new Promise((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(String(reader.result || '').replace(/^data:[^;]+;base64,/, ''));
                                reader.onerror = reject;
                                reader.readAsDataURL(blob);
                            });
                            const rNat = await fetch('/api/crm/whatsapp/asistente-hibrido/transcribir-instruccion-voz', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ audioBase64: b64Nativo, mimeType: mimeFinal })
                            });
                            const dNat = await rNat.json().catch(() => null);
                            if (rNat.ok && dNat && dNat.success && dNat.texto) {
                                textoTranscritoFinal = String(dNat.texto).trim();
                            }
                        } catch (_) {}

                        if (!textoTranscritoFinal) {
                            try {
                                const wavInfo = await convertirBlobAudioAWavBase64Wa(blob);
                                const r = await fetch('/api/crm/whatsapp/asistente-hibrido/transcribir-instruccion-voz', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ audioBase64: wavInfo.base64, mimeType: wavInfo.mimeType })
                                });
                                const data = await r.json().catch(() => null);
                                if (r.ok && data && data.success && data.texto) {
                                    textoTranscritoFinal = String(data.texto).trim();
                                }
                            } catch (eWav) {
                                console.warn('[WA-VOZ] Fallback a dictado en vivo:', eWav.message);
                            }
                        }
                    }

                    if (!textoTranscritoFinal && _textoDictadoEnVivoWa) {
                        textoTranscritoFinal = _textoDictadoEnVivoWa.trim();
                    }
                    if (!textoTranscritoFinal && inp && String(inp.value || '').trim().length >= 3) {
                        textoTranscritoFinal = String(inp.value || '').trim();
                    }

                    if (!textoTranscritoFinal) {
                        throw new Error('No se detectó voz en el micrófono (verificá que otra aplicación no esté usando el micrófono en simultáneo o hablá un par de segundos más cerca).');
                    }

                    if (inp) {
                        inp.value = textoTranscritoFinal;
                    }
                    await window.pedirRedaccionIaEnVivoAsistenteWa();
                } catch (errVoz) {
                    if (statusEl) {
                        statusEl.style.display = 'block';
                        statusEl.style.background = '#fef2f2';
                        statusEl.style.borderColor = '#fecaca';
                        statusEl.style.color = '#991b1b';
                        statusEl.innerHTML = `⚠️ Error al procesar instrucción por voz: ${escaparHtml(errVoz.message)}`;
                    }
                } finally {
                    if (btnVoz) {
                        btnVoz.disabled = false;
                        btnVoz.style.background = '#7c3aed';
                        btnVoz.innerHTML = '🎙️ Hablarle al Agente';
                    }
                }
            };

            _grabadorVozAgenteWa.start(250);
            if (btnVoz) {
                btnVoz.style.background = '#dc2626';
                btnVoz.innerHTML = '⏹️ Detener y Ejecutar (Grabando...)';
            }
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = '#faf5ff';
                statusEl.style.borderColor = '#c4b5fd';
                statusEl.style.color = '#5b21b6';
                statusEl.innerHTML = '🎙️ <strong>Escuchando tu instrucción...</strong> Hablale al equipo de agentes (ej: <em>"agregale las ofertas de castañas tostadas y saladas y damasco turco en fracciones chicas, sacá la caja de 10kg y mandale PDF adjunto"</em>) y tocá <strong>⏹️ Detener y Ejecutar</strong>.';
            }
        } catch (errMic) {
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = '#fef2f2';
                statusEl.style.borderColor = '#fecaca';
                statusEl.style.color = '#991b1b';
                statusEl.innerHTML = `⚠️ No se pudo abrir el micrófono: ${escaparHtml(errMic.message)}`;
            }
        }
    };

    window.pedirRedaccionIaEnVivoAsistenteWa = async function () {
        const st = estadoAsistenteComercialWa;
        if (!st || typeof window.generarConIaGenerativaMesaAgentesWa !== 'function') return;
        const inp = document.getElementById('wa-asist-com-ia-prompt');
        const btn = document.getElementById('btn-wa-asist-com-ia-run');
        const statusEl = document.getElementById('wa-asist-com-status');
        const instruccion = String(inp?.value || '').trim();

        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Razonando...';
        }
        try {
            const resIa = await window.generarConIaGenerativaMesaAgentesWa(st, st.resultadoMesa || window.ejecutarMesaAgentesComercialesWa(st), instruccion);
            if (resIa && (resIa.burbuja1 || resIa.burbuja2)) {
                const area1 = document.getElementById('wa-asist-com-textarea');
                const area2 = document.getElementById('wa-asist-com-burbuja2');
                const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2');
                const wrapB2 = document.getElementById('wa-asist-com-burbuja2-wrap');
                const area3 = document.getElementById('wa-asist-com-burbuja3');
                const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3');
                const wrapB3 = document.getElementById('wa-asist-com-burbuja3-wrap');
                const chkPdf = document.getElementById('wa-asist-com-chk-pdf');

                if (area1 && resIa.burbuja1) area1.value = resIa.burbuja1;
                if (area2) area2.value = resIa.burbuja2 || '';
                if (chkB2) chkB2.checked = Boolean(resIa.burbuja2);
                if (wrapB2) wrapB2.style.display = resIa.burbuja2 ? 'block' : 'none';

                if (area3) area3.value = resIa.burbuja3 || '';
                if (chkB3) chkB3.checked = Boolean(resIa.burbuja3);
                if (wrapB3) wrapB3.style.display = resIa.burbuja3 ? 'block' : 'none';

                if (chkPdf && st.sugerirAdjuntarPdfIa) {
                    chkPdf.checked = true;
                }

                if (st.resultadoMesa && st.razonamientoIa?.explicacion_razonamiento) {
                    st.resultadoMesa.proactivo.diagnosticoEjecutivoAgente = st.razonamientoIa.explicacion_razonamiento;
                }
                const boxMesa = document.getElementById('wa-asist-mesa-agentes-box');
                if (boxMesa && typeof window.renderizarPanelMesaAgentesHtmlWa === 'function' && st.resultadoMesa) {
                    boxMesa.innerHTML = window.renderizarPanelMesaAgentesHtmlWa(st, st.resultadoMesa);
                }

                actualizarEstilosPasosAsistenteComercialWa();
                renderizarGridProductosAsistenteComercialWa();
                renderizarChipsSeleccionadosBurbuja2Wa();
                window.actualizarIndicadorLongitudAsistenteComercialWa();

                if (statusEl) {
                    const cantPdf = obtenerArticulosParaPdfAdjuntoAsistenteWa(st).length;
                    statusEl.style.display = 'block';
                    statusEl.style.background = '#ecfdf5';
                    statusEl.style.borderColor = '#6ee7b7';
                    statusEl.style.color = '#065f46';
                    statusEl.innerHTML = `✨ <strong>Instrucción aplicada por el Comité de Agentes (Lista #${escaparHtml(st.listaId)} verificada):</strong> ${escaparHtml(resIa.pasoEnEspera || '')}${chkPdf?.checked ? ` · 📄 <strong>PDF Adjunto listo (${cantPdf} artículos de su Lista #${escaparHtml(st.listaId)})</strong>.` : ''}`;
                }
            }
        } catch (err) {
            const boxMesa = document.getElementById('wa-asist-mesa-agentes-box');
            if (boxMesa && typeof window.renderizarPanelMesaAgentesHtmlWa === 'function' && st.resultadoMesa) {
                boxMesa.innerHTML = window.renderizarPanelMesaAgentesHtmlWa(st, st.resultadoMesa);
            }
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = '#fef2f2';
                statusEl.style.borderColor = '#fecaca';
                statusEl.style.color = '#991b1b';
                statusEl.innerHTML = `🚨 <strong>Error al adaptar mensaje con IA:</strong> ${escaparHtml(err.message)}`;
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '✨ Adaptar con IA';
            }
        }
    };

    window.cambiarModoLinkAsistenteWa = function (nuevoModo) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.modoLink = nuevoModo;
        sincronizarMesaAgentesYEditorWa();
    };

    window.cambiarModoAperturaAsistenteWa = function (enCursoBool) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st._charlaEnCursoForzadaUsuario = true;
        st.charlaEnCurso = Boolean(enCursoBool);
        sincronizarMesaAgentesYEditorWa();
    };

    function actualizarEstilosPasosAsistenteComercialWa() {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const pasos = ['PASO_1_PORTAL', 'PASO_2_EXPLICAR_PORTAL', 'PASO_3_PRODUCTOS', 'PASO_4_PDF'];
        pasos.forEach(p => {
            const btn = document.getElementById(`btn-paso-wa-${p}`);
            if (!btn) return;
            const activo = st.pasoActual === p;
            btn.style.border = activo ? '2px solid #059669' : '1px solid #cbd5e1';
            btn.style.background = activo ? '#f0fdf4' : '#ffffff';
            btn.style.boxShadow = activo ? '0 1px 4px rgba(5,150,105,0.2)' : 'none';
        });

        ['ACTIVACION_CORTA', 'PORTAL_GENERAL'].forEach(m => {
            const btn = document.getElementById(`btn-wa-modo-link-${m}`);
            if (!btn) return;
            const activo = st.modoLink === m;
            btn.style.background = activo ? '#059669' : '#ffffff';
            btn.style.color = activo ? '#ffffff' : '#065f46';
            btn.style.border = activo ? '1px solid #059669' : '1px solid #86efac';
        });

        const btnEnCurso = document.getElementById('btn-wa-apertura-EN_CURSO');
        const btnSaludo = document.getElementById('btn-wa-apertura-SALUDO');
        if (btnEnCurso && btnSaludo) {
            const enCurso = Boolean(st.charlaEnCurso);
            btnEnCurso.style.background = enCurso ? '#0284c7' : 'transparent';
            btnEnCurso.style.color = enCurso ? '#ffffff' : '#475569';
            btnSaludo.style.background = !enCurso ? '#059669' : 'transparent';
            btnSaludo.style.color = !enCurso ? '#ffffff' : '#475569';
        }

        const tabs = ['MENCIONADOS', 'CAMBIOS_PENDIENTES', 'HABITUALES', 'SIMILARES', 'TODOS'];
        tabs.forEach(t => {
            const btn = document.getElementById(`tab-wa-prod-${t}`);
            if (!btn) return;
            const activo = st.tabProductosActual === t;
            btn.style.outline = activo ? '2px solid #0f172a' : 'none';
        });

        // Actualizar estilos de botones de Línea de Negocio (LDN 1..6)
        const ldnSet = st.filtroLdnSet instanceof Set ? st.filtroLdnSet : new Set();
        const btnTodasLdn = document.getElementById('btn-wa-ldn-TODAS');
        if (btnTodasLdn) {
            const todasActiva = ldnSet.size === 0;
            btnTodasLdn.style.background = todasActiva ? '#0f172a' : '#ffffff';
            btnTodasLdn.style.color = todasActiva ? '#ffffff' : '#475569';
            btnTodasLdn.style.borderColor = todasActiva ? '#0f172a' : '#cbd5e1';
        }
        const coloresLdn = {
            1: { activeBg: '#334155', activeText: '#ffffff', border: '#cbd5e1', text: '#334155' },
            2: { activeBg: '#15803d', activeText: '#ffffff', border: '#86efac', text: '#15803d' },
            3: { activeBg: '#5b21b6', activeText: '#ffffff', border: '#c4b5fd', text: '#5b21b6' },
            4: { activeBg: '#92400e', activeText: '#ffffff', border: '#fde68a', text: '#92400e' },
            5: { activeBg: '#9f1239', activeText: '#ffffff', border: '#fecdd3', text: '#9f1239' },
            6: { activeBg: '#0369a1', activeText: '#ffffff', border: '#bae6fd', text: '#0369a1' }
        };
        [1, 2, 3, 4, 5, 6].forEach(n => {
            const btn = document.getElementById(`btn-wa-ldn-${n}`);
            if (!btn) return;
            const act = ldnSet.has(n);
            const c = coloresLdn[n];
            btn.style.background = act ? c.activeBg : '#ffffff';
            btn.style.color = act ? c.activeText : c.text;
            btn.style.borderColor = act ? c.activeBg : c.border;
        });

        // Actualizar estilos de botones Artículo Padre vs Individuales
        const btnPadre = document.getElementById('btn-wa-padre-SOLO_PADRE');
        const btnIndiv = document.getElementById('btn-wa-padre-SOLO_INDIVIDUAL');
        if (btnPadre) {
            const act = st.filtroTipoPadre === 'SOLO_PADRE';
            btnPadre.style.background = act ? '#7e22ce' : '#ffffff';
            btnPadre.style.color = act ? '#ffffff' : '#6b21a8';
            btnPadre.style.borderColor = act ? '#7e22ce' : '#c084fc';
        }
        if (btnIndiv) {
            const act = st.filtroTipoPadre === 'SOLO_INDIVIDUAL';
            btnIndiv.style.background = act ? '#0f172a' : '#ffffff';
            btnIndiv.style.color = act ? '#ffffff' : '#334155';
            btnIndiv.style.borderColor = act ? '#0f172a' : '#cbd5e1';
        }

        // Actualizar estilos de presets rápidos de fracción (<2kg, <=2kg, >2kg, >=5kg)
        const presets = [
            { id: 'btn-wa-frac-lt2', op: '<', kg: 2 },
            { id: 'btn-wa-frac-lte2', op: '<=', kg: 2 },
            { id: 'btn-wa-frac-gt2', op: '>', kg: 2 },
            { id: 'btn-wa-frac-gte5', op: '>=', kg: 5 }
        ];
        presets.forEach(pr => {
            const b = document.getElementById(pr.id);
            if (!b) return;
            const act = st.filtroFraccionOp === pr.op && Number(st.filtroFraccionKg) === pr.kg;
            b.style.background = act ? '#0284c7' : '#ffffff';
            b.style.color = act ? '#ffffff' : '#334155';
            b.style.borderColor = act ? '#0284c7' : '#cbd5e1';
        });

        const countEl = document.getElementById('wa-asist-com-count-sel');
        if (countEl) countEl.textContent = String(st.idsSeleccionados.size);
    }

    /**
     * Pipeline de Filtrado Acumulativo ("siempre filtrar sobre lo filtrado"):
     * Combina Pestaña Base + Línea de Negocio (LDN 1..6) + Tipo (Artículo Padre / Individual)
     * + Fracción (<, <=, =, >=, > kg) + Presentaciones puntuales ("por 10") + Grupos de caracteres (AND).
     */
    function obtenerArticulosFiltradosAsistenteComercialWa() {
        const st = estadoAsistenteComercialWa;
        if (!st) return { filtrados: [], totalBase: 0, hayFiltrosActivos: false, parsed: null };

        const parsed = parsearConsultaCumulativaAsistenteWa(st.filtroBusqueda || '');
        const ldnSetUi = st.filtroLdnSet instanceof Set ? st.filtroLdnSet : new Set();
        const ldnsActivas = new Set([...ldnSetUi, ...(parsed.ldnsInline || [])]);
        const tipoPadreActivo = parsed.tipoPadreInline || st.filtroTipoPadre || 'TODOS';
        const fracOpUi = String(st.filtroFraccionOp || '').trim();
        const fracKgUi = st.filtroFraccionKg;
        const tieneFracUi = Boolean(fracOpUi && fracKgUi !== '' && fracKgUi !== null && Number(fracKgUi) > 0);

        const hayFiltrosActivos = Boolean(
            String(st.filtroBusqueda || '').trim() ||
            ldnsActivas.size > 0 ||
            tipoPadreActivo !== 'TODOS' ||
            tieneFracUi
        );

        const aplicarFiltrosSobrePool = (poolBase) => {
            return (Array.isArray(poolBase) ? poolBase : []).filter(art => {
                const bolsa = art._bolsaBusqueda || obtenerBolsaBusquedaArticuloAsistenteWa(art);

                // 1. Filtro acumulativo por Línea de Negocio (LDN 1 a 6)
                if (ldnsActivas.size > 0 && !ldnsActivas.has(Number(art.linea_negocio || 1))) {
                    return false;
                }

                // 2. Filtro acumulativo por Artículo Padre (Combos 10x500g, 10x250g, 10x200g...) vs Individual
                if (tipoPadreActivo === 'SOLO_PADRE' && !art.es_articulo_padre) {
                    return false;
                }
                if (tipoPadreActivo === 'SOLO_INDIVIDUAL' && art.es_articulo_padre) {
                    return false;
                }

                // 3. Filtro acumulativo por Fracción (UI selector + input)
                if (tieneFracUi && !cumpleFiltroFraccionWa(art, fracOpUi, fracKgUi)) {
                    return false;
                }

                // 4. Filtro acumulativo por Fracción escrito en el buscador ("menor que 2", "mayor que 2", "< 2", "> 2")
                if (parsed.fraccionesInline.length > 0) {
                    for (const fIn of parsed.fraccionesInline) {
                        if (!cumpleFiltroFraccionWa(art, fIn.op, fIn.kg)) return false;
                    }
                }

                // 5. Filtro acumulativo por Presentación puntual escrita ("por 10", "x 10", "por 500")
                if (parsed.presentaciones.length > 0) {
                    for (const pr of parsed.presentaciones) {
                        if (!cumplePresentacionPuntualWa(art, pr.num, pr.unidad)) return false;
                    }
                }

                // 6. Filtro acumulativo por grupos de caracteres (AND sobre la Bolsa Universal)
                if (parsed.terminos.length > 0) {
                    if (!parsed.terminos.every(t => bolsa.includes(t))) return false;
                }

                return true;
            });
        };

        const obtenerPoolPorTab = (tab) => {
            if (tab === 'MENCIONADOS') return st.articulosMencionadosChat || [];
            if (tab === 'CAMBIOS_PENDIENTES') return st.cambiosPreciosPendientes || [];
            if (tab === 'HABITUALES') return st.articulosHabituales || [];
            if (tab === 'SIMILARES') return st.articulosSimilares || [];
            return st.catalogoArticulos || [];
        };

        // Si el operador empieza a usar los filtros/buscador y no había fijado manualmente una pestaña chica,
        // buscamos sobre Todo el Catálogo para evitar callejones sin salida (dead-ends).
        let tabEfectivo = st.tabProductosActual || 'TODOS';
        if (hayFiltrosActivos && !st._tabFijadoManualmente && tabEfectivo !== 'TODOS') {
            tabEfectivo = 'TODOS';
            st.tabProductosActual = 'TODOS';
        }

        let poolBase = obtenerPoolPorTab(tabEfectivo);
        let filtrados = aplicarFiltrosSobrePool(poolBase);

        // Si el operador tenía fijada una pestaña puntual (ej: Mencionados) pero lo que busca no está ahí y sí en Todo el Catálogo,
        // y escribió texto o filtró por línea, pasamos automáticamente a Todo el Catálogo si ahí sí hay coincidencias
        if (filtrados.length === 0 && hayFiltrosActivos && tabEfectivo !== 'TODOS') {
            const enCatalogoTotal = aplicarFiltrosSobrePool(st.catalogoArticulos || []);
            if (enCatalogoTotal.length > 0) {
                st.tabProductosActual = 'TODOS';
                poolBase = st.catalogoArticulos || [];
                filtrados = enCatalogoTotal;
            }
        }

        st.ultimosFiltrados = filtrados;
        return {
            filtrados,
            totalBase: poolBase.length,
            hayFiltrosActivos,
            parsed
        };
    }

    function renderizarGridProductosAsistenteComercialWa() {
        const st = estadoAsistenteComercialWa;
        const grid = document.getElementById('wa-asist-com-productos-grid');
        if (!st || !grid) return;

        const { filtrados: fuente, totalBase, hayFiltrosActivos } = obtenerArticulosFiltradosAsistenteComercialWa();
        actualizarEstilosPasosAsistenteComercialWa();

        const countFiltradosEl = document.getElementById('wa-asist-com-count-filtrados');
        if (countFiltradosEl) {
            countFiltradosEl.textContent = hayFiltrosActivos
                ? `Mostrando ${fuente.length} de ${totalBase} art.`
                : `${fuente.length} art. en vista`;
        }

        const btnLimpiarFiltros = document.getElementById('btn-wa-limpiar-filtros');
        if (btnLimpiarFiltros) {
            btnLimpiarFiltros.style.display = hayFiltrosActivos ? 'inline-block' : 'none';
        }

        const btnSumarPdf = document.getElementById('btn-wa-asist-sumar-pdf');
        if (btnSumarPdf) {
            btnSumarPdf.textContent = `📄 +Filtrados al PDF (${fuente.length})`;
            btnSumarPdf.disabled = fuente.length === 0;
            btnSumarPdf.style.opacity = fuente.length === 0 ? '0.5' : '1';
        }
        const btnSumarB2 = document.getElementById('btn-wa-asist-sumar-b2');
        if (btnSumarB2) {
            const cantB2 = Math.min(8, fuente.length);
            btnSumarB2.textContent = `✅ +Burbuja 2 (${cantB2})`;
            btnSumarB2.disabled = fuente.length === 0;
            btnSumarB2.style.opacity = fuente.length === 0 ? '0.5' : '1';
        }

        if (fuente.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 14px; text-align: center; color: #64748b; font-size: 0.78rem; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1;">
                    ${st.tabProductosActual === 'CAMBIOS_PENDIENTES' && !hayFiltrosActivos
                        ? '✅ No quedan actualizaciones de precio pendientes de notificar para este cliente.'
                        : (st.tabProductosActual === 'HABITUALES' && !hayFiltrosActivos
                            ? 'Este cliente aún no registra artículos comprados en su historial. Probá la pestaña "✨ Similares" o usá el buscador acumulativo.'
                            : 'No quedaron artículos con esa combinación de filtros acumulativos. <button type="button" onclick="window.limpiarFiltrosBuscadorAsistenteWa()" style="margin-left:6px; padding:2px 8px; border-radius:5px; border:1px solid #0284c7; background:#e0f2fe; color:#0369a1; font-weight:800; cursor:pointer;">🧹 Limpiar filtros</button>')}
                </div>
            `;
            return;
        }

        const idsHab = new Set((st.articulosHabituales || []).map(a => String(a.id)));
        const idsPend = new Set((st.cambiosPreciosPendientes || []).map(a => String(a.id)));
        const idsPdfSet = new Set((st.articulosPdfSugeridosIa || []).map(a => String(a.id)));

        grid.innerHTML = fuente.map(art => {
            enriquecerMetadatosFiltrosArticuloWa(art);
            const idStr = String(art.id);
            const sel = st.idsSeleccionados.has(idStr);
            const enPdf = sel || idsPdfSet.has(idStr);
            const esHab = idsHab.has(idStr);
            const esPend = idsPend.has(idStr) || String(art.estado_notificacion || '').toUpperCase() === 'PENDIENTE';
            const infoP = formatearPrecioArticuloListaWa(art, st.listaId);
            const pBulto = Number(art.precio_nuevo_bulto || infoP.precioBulto || 0);
            const pKg = Number(art.precio_nuevo_kilo || infoP.precioKg || pBulto);
            const kilosU = Number(art.kilos_unidad || art.peso_bulto || infoP.kilosUnidad || 1);
            const stockNum = art.sin_stock_actual ? 0 : Number(art.stock_real || 0);

            const ldnSt = art.linea_negocio_style || { tag: `LDN ${art.linea_negocio || 1}`, corto: '', color: '#334155', bg: '#f1f5f9', border: '#cbd5e1' };
            const ldnBadge = `<span style="background:${ldnSt.bg}; color:${ldnSt.color}; border:1px solid ${ldnSt.border}; padding:0px 5px; border-radius:4px; font-size:0.61rem; font-weight:800;" title="${escaparHtml(art.linea_negocio_nombre || '')}">${escaparHtml(ldnSt.tag)}${ldnSt.corto ? `·${escaparHtml(ldnSt.corto)}` : ''}</span>`;

            const padreBadge = art.es_articulo_padre
                ? `<span style="background:#f3e8ff; color:#6b21a8; border:1px solid #d8b4fe; padding:0px 5px; border-radius:4px; font-size:0.61rem; font-weight:800;" title="Artículo Padre / Combo (${art.pack_unidades} unidades de ${art.kilos_fraccion < 1 ? `${Math.round(art.kilos_fraccion * 1000)}g` : `${art.kilos_fraccion}kg`})">📦 Padre</span>`
                : '';

            const stockBadge = stockNum > 0
                ? `<span style="color:#15803d; font-weight:700;">Stock: ${stockNum}u</span>`
                : `<span style="color:#b91c1c; font-weight:700;">⚠️ Sin stock</span>`;

            const frecBadge = esHab && art.frecuencia_compra
                ? `<span style="background:#dcfce7; color:#166534; padding:0px 5px; border-radius:4px; font-size:0.63rem; font-weight:800;">🛒 ${art.frecuencia_compra}x</span>`
                : '';

            let varBadge = '';
            if (art.diferencia_porcentaje !== undefined && art.diferencia_porcentaje !== null) {
                const dif = Math.round(Number(art.diferencia_porcentaje));
                const signo = dif > 0 ? `+${dif}%` : `${dif}%`;
                varBadge = `<span style="background:${esPend ? '#fef3c7' : '#f1f5f9'}; color:${esPend ? '#b45309' : '#475569'}; border:1px solid ${esPend ? '#fcd34d' : '#cbd5e1'}; padding:0px 5px; border-radius:4px; font-size:0.63rem; font-weight:800;">${esPend ? '🔔 ' : ''}${signo}</span>`;
            }

            const jerarquiaCorta = [art.familia_b2b, art.articulo_principal_display, art.ruta_subcategoria_b2b]
                .filter(Boolean)
                .join(' › ');

            const altSug = (stockNum <= 0 && art.alternativa_sugerida && art.alternativa_sugerida.nombre)
                ? `<div style="font-size:0.64rem; color:#047857; font-weight:700; margin-top:2px;">↳ Alt. en stock: ${escaparHtml(art.alternativa_sugerida.nombre)} ($${Math.round(Number(art.alternativa_sugerida.precio_kilo || art.alternativa_sugerida.precio_bulto || 0)).toLocaleString('es-AR')}/kg)</div>`
                : '';

            return `
                <div onclick="window.toggleArticuloAsistenteComercialWa('${escaparHtml(idStr)}')" style="cursor: pointer; padding: 6px 8px; border-radius: 7px; border: ${sel ? '2px solid #059669' : (enPdf ? '1.5px solid #f59e0b' : (esPend ? '1px solid #f59e0b' : '1px solid #e2e8f0'))}; background: ${sel ? '#ecfdf5' : (enPdf ? '#fffbeb' : '#ffffff')}; display: flex; justify-content: space-between; align-items: center; gap: 6px; transition: all 0.12s;">
                    <div style="min-width: 0; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 1px;">
                            ${ldnBadge}
                            ${padreBadge}
                            ${jerarquiaCorta ? `<span style="font-size: 0.61rem; font-weight: 800; color: #0369a1; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escaparHtml(jerarquiaCorta)}</span>` : ''}
                        </div>
                        <div style="font-weight: 800; font-size: 0.74rem; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escaparHtml(art.nombre)} (${escaparHtml(idStr)})">
                            ${sel ? '✅ ' : (enPdf ? '📄 ' : '')}${escaparHtml(art.nombre)}
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 0.66rem; color: #64748b; margin-top: 2px;">
                            ${varBadge}
                            ${frecBadge}
                            ${stockBadge}
                            ${kilosU > 1.05 ? `<span>($${Math.round(pKg).toLocaleString('es-AR')}/kg)</span>` : ''}
                        </div>
                        ${altSug}
                    </div>
                    <div style="text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
                        <div style="font-weight: 900; font-size: 0.78rem; color: #047857;">$${Math.round(pBulto).toLocaleString('es-AR')}</div>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button type="button" onclick="event.stopPropagation(); window.toggleArticuloSoloPdfAsistenteWa('${escaparHtml(idStr)}')" title="Incluir o quitar este artículo en el PDF Adjunto de Precios (sin agregarlo al texto de Burbuja 2)" style="padding: 1px 5px; border-radius: 4px; font-size: 0.6rem; font-weight: 800; cursor: pointer; border: 1px solid ${enPdf ? '#d97706' : '#cbd5e1'}; background: ${enPdf ? '#fef3c7' : '#f8fafc'}; color: ${enPdf ? '#92400e' : '#475569'};">
                                ${enPdf ? '📄 En PDF' : '+PDF'}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    window.cambiarPasoAsistenteComercialWa = function (nuevoPaso) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.pasoActual = nuevoPaso;
        const chkPdf = document.getElementById('wa-asist-com-chk-pdf');
        if (chkPdf) {
            chkPdf.checked = (nuevoPaso === 'PASO_4_PDF');
        }
        sincronizarMesaAgentesYEditorWa();
    };

    window.cambiarTabProductosAsistenteComercialWa = function (nuevoTab) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        // Si toca de nuevo la misma pestaña específica, conmuta a Todo el Catálogo manteniendo los filtros activos
        if (st.tabProductosActual === nuevoTab && nuevoTab !== 'TODOS') {
            st.tabProductosActual = 'TODOS';
            st._tabFijadoManualmente = false;
        } else {
            st.tabProductosActual = nuevoTab;
            st._tabFijadoManualmente = (nuevoTab !== 'TODOS');
        }
        renderizarGridProductosAsistenteComercialWa();
    };

    window.filtrarBuscadorAsistenteComercialWa = function (valor) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.filtroBusqueda = valor || '';
        renderizarGridProductosAsistenteComercialWa();
    };

    window.toggleFiltroLdnAsistenteWa = function (ldnNum) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        if (!(st.filtroLdnSet instanceof Set)) st.filtroLdnSet = new Set();
        const num = Number(ldnNum || 0);
        if (num === 0) {
            st.filtroLdnSet.clear();
        } else if (st.filtroLdnSet.has(num)) {
            st.filtroLdnSet.delete(num);
        } else {
            st.filtroLdnSet.add(num);
        }
        renderizarGridProductosAsistenteComercialWa();
    };

    window.setFiltroTipoPadreAsistenteWa = function (modo) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.filtroTipoPadre = (st.filtroTipoPadre === modo) ? 'TODOS' : modo;
        renderizarGridProductosAsistenteComercialWa();
    };

    window.setFiltroFraccionAsistenteWa = function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const selOp = document.getElementById('wa-asist-filtro-frac-op');
        const inpKg = document.getElementById('wa-asist-filtro-frac-kg');
        let op = selOp ? selOp.value : '';
        const kgVal = inpKg ? inpKg.value : '';
        // Si el operador escribe un número de kilos (ej: 2) sin haber abierto el selector de operador, por defecto aplicamos "<=" (hasta X kg)
        if (!op && kgVal !== '' && Number(kgVal) > 0 && selOp) {
            op = '<=';
            selOp.value = '<=';
        }
        st.filtroFraccionOp = op;
        st.filtroFraccionKg = kgVal;
        renderizarGridProductosAsistenteComercialWa();
    };

    window.aplicarPresetFraccionAsistenteWa = function (op, kg) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const selOp = document.getElementById('wa-asist-filtro-frac-op');
        const inpKg = document.getElementById('wa-asist-filtro-frac-kg');
        if (st.filtroFraccionOp === op && Number(st.filtroFraccionKg) === Number(kg)) {
            st.filtroFraccionOp = '';
            st.filtroFraccionKg = '';
            if (selOp) selOp.value = '';
            if (inpKg) inpKg.value = '';
        } else {
            st.filtroFraccionOp = op;
            st.filtroFraccionKg = String(kg);
            if (selOp) selOp.value = op;
            if (inpKg) inpKg.value = String(kg);
        }
        renderizarGridProductosAsistenteComercialWa();
    };

    window.limpiarFiltrosBuscadorAsistenteWa = function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.filtroBusqueda = '';
        if (st.filtroLdnSet instanceof Set) st.filtroLdnSet.clear();
        st.filtroTipoPadre = 'TODOS';
        st.filtroFraccionOp = '';
        st.filtroFraccionKg = '';
        const inpSearch = document.getElementById('wa-asist-com-search');
        const selOp = document.getElementById('wa-asist-filtro-frac-op');
        const inpKg = document.getElementById('wa-asist-filtro-frac-kg');
        if (inpSearch) inpSearch.value = '';
        if (selOp) selOp.value = '';
        if (inpKg) inpKg.value = '';
        renderizarGridProductosAsistenteComercialWa();
    };

    window.toggleArticuloSoloPdfAsistenteWa = function (idArticulo) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const key = String(idArticulo);
        if (!Array.isArray(st.articulosPdfSugeridosIa)) st.articulosPdfSugeridosIa = [];
        const idx = st.articulosPdfSugeridosIa.findIndex(a => String(a.id) === key);
        if (idx >= 0) {
            st.articulosPdfSugeridosIa.splice(idx, 1);
        } else {
            const artObj = (st.catalogoArticulos || []).find(a => String(a.id) === key);
            if (artObj) st.articulosPdfSugeridosIa.push(artObj);
        }
        const chkPdf = document.getElementById('wa-asist-com-chk-pdf');
        if (chkPdf && st.articulosPdfSugeridosIa.length > 0) {
            chkPdf.checked = true;
            st.alcancePdfAdjunto = 'SELECCIONADOS';
        }
        renderizarChipsSeleccionadosBurbuja2Wa();
        renderizarGridProductosAsistenteComercialWa();
    };

    window.sumarFiltradosAlPdfAsistenteWa = function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const filtrados = Array.isArray(st.ultimosFiltrados) ? st.ultimosFiltrados : [];
        if (filtrados.length === 0) return;
        if (!Array.isArray(st.articulosPdfSugeridosIa)) st.articulosPdfSugeridosIa = [];
        const existentes = new Set(st.articulosPdfSugeridosIa.map(a => String(a.id)));
        let agregados = 0;
        filtrados.slice(0, 60).forEach(art => {
            const k = String(art.id);
            if (!existentes.has(k)) {
                existentes.add(k);
                st.articulosPdfSugeridosIa.push(art);
                agregados++;
            }
        });
        st.alcancePdfAdjunto = 'SELECCIONADOS';
        const chkPdf = document.getElementById('wa-asist-com-chk-pdf');
        if (chkPdf) chkPdf.checked = true;
        renderizarChipsSeleccionadosBurbuja2Wa();
        renderizarGridProductosAsistenteComercialWa();

        const statusEl = document.getElementById('wa-asist-com-status');
        if (statusEl) {
            const totalPdf = obtenerArticulosParaPdfAdjuntoAsistenteWa(st).length;
            statusEl.style.display = 'block';
            statusEl.style.background = '#fffbeb';
            statusEl.style.borderColor = '#fcd34d';
            statusEl.style.color = '#92400e';
            statusEl.innerHTML = `📄 <strong>Se sumaron ${agregados} artículos filtrados al PDF Adjunto</strong> (Total en PDF: <strong>${totalPdf} artículos</strong> con precios deterministas de su Lista #${escaparHtml(st.listaId)}).`;
        }
    };

    window.seleccionarFiltradosEnBurbuja2Wa = function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const filtrados = Array.isArray(st.ultimosFiltrados) ? st.ultimosFiltrados : [];
        if (filtrados.length === 0) return;
        filtrados.slice(0, 8).forEach(art => {
            st.idsSeleccionados.add(String(art.id));
        });
        st.pasoActual = 'PASO_3_PRODUCTOS';
        st.modoAccionProactiva = 'COTIZAR';
        sincronizarMesaAgentesYEditorWa();
        renderizarGridProductosAsistenteComercialWa();
    };

    window.toggleArticuloAsistenteComercialWa = function (idArticulo) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const key = String(idArticulo);
        if (st.idsSeleccionados.has(key)) {
            st.idsSeleccionados.delete(key);
        } else {
            st.idsSeleccionados.add(key);
        }
        if (st.idsSeleccionados.size > 0) {
            st.pasoActual = 'PASO_3_PRODUCTOS';
            st.modoAccionProactiva = 'COTIZAR';
        } else if (st.modoAccionProactiva === 'COTIZAR') {
            st.modoAccionProactiva = 'AUTO';
        }
        sincronizarMesaAgentesYEditorWa();
        renderizarGridProductosAsistenteComercialWa();
    };

    window.limpiarSeleccionProductosAsistenteComercialWa = function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        st.idsSeleccionados.clear();
        if (st.modoAccionProactiva === 'COTIZAR') {
            st.modoAccionProactiva = 'AUTO';
        }
        sincronizarMesaAgentesYEditorWa();
        renderizarGridProductosAsistenteComercialWa();
    };

    window.restaurarTextoPasoAsistenteComercialWa = function () {
        sincronizarMesaAgentesYEditorWa();
    };

    window.actualizarIndicadorLongitudAsistenteComercialWa = function () {
        const area1 = document.getElementById('wa-asist-com-textarea');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2')?.checked;
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3')?.checked;
        const badge = document.getElementById('wa-asist-com-long-badge');
        if (!area1 || !badge) return;

        const t1 = String(area1.value || '').trim();
        const t2 = chkB2 ? String(area2?.value || '').trim() : '';
        const t3 = chkB3 ? String(area3?.value || '').trim() : '';
        const chars = t1.length + t2.length + t3.length;
        const burbujas = [t1, t2, t3].filter(Boolean).length || 1;

        if (chars <= 520) {
            badge.style.background = '#dcfce7';
            badge.style.color = '#166534';
            badge.textContent = `✅ Ideal para WhatsApp (${burbujas} ${burbujas === 1 ? 'mensaje corto' : 'mensajes cortos separados'})`;
        } else if (chars <= 800) {
            badge.style.background = '#fef3c7';
            badge.style.color = '#92400e';
            badge.textContent = `⚠️ Longitud media (${burbujas} mensajes)`;
        } else {
            badge.style.background = '#fee2e2';
            badge.style.color = '#991b1b';
            badge.textContent = `🚨 Texto largo — En WhatsApp conviene ir paso a paso`;
        }
    };

    /**
     * Genera el Link de Acceso Directo (Magic Link sin clave) para este cliente en su Portal B2B
     */
    window.generarLinkDirectoPortalAsistenteWa = async function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const identificador = st.codigoBunker || st.clienteId;
        if (!identificador) {
            Swal.showValidationMessage('Este chat aún no está vinculado a un cliente de Búnker para generarle acceso directo.');
            return;
        }
        const btn = document.getElementById('btn-wa-asist-com-magic');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Generando...';
        }
        try {
            const res = await fetch(`/api/logistica/b2b-onboarding/acceso-maestro/${encodeURIComponent(identificador)}`);
            const data = await res.json();
            if (!res.ok || !data.success || !(data.magicLink || data.url)) {
                throw new Error(data.error || 'No se pudo generar el link directo.');
            }
            const linkDirecto = data.magicLink || data.url;
            st.magicLinkDirecto = linkDirecto;
            st.modoLink = 'MAGIC_LINK';
            if (btn) {
                btn.textContent = '✅ Magic Link Activo';
                btn.style.background = '#059669';
            }
            sincronizarMesaAgentesYEditorWa();
        } catch (err) {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔑 Magic Link Directo';
            }
            const statusEl = document.getElementById('wa-asist-com-status');
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = '#fef2f2';
                statusEl.style.borderColor = '#fecaca';
                statusEl.style.color = '#991b1b';
                statusEl.innerHTML = `⚠️ No se pudo generar el Magic Link directo (${escaparHtml(err.message)}).`;
            }
        }
    };

    /**
     * Prepara los artículos seleccionados con el estándar unificado de Artículos Búnker + Jerarquía B2B
     * y genera el Blob del PDF institucional desde /api/logistica/bunker/cotizaciones/exportar-pdf
     */
    async function generarBlobPdfFormatoBunkerJerarquiaB2BWa({
        listaId,
        articulosRaw,
        clienteNombre = null,
        telefonoCliente = null,
        tituloInforme = null,
        alcance = 'ACTUALIZACIONES',
        agruparPorJerarquiaB2B = true,
        nivelesAgrupar = null,
        mostrarHijos = true,
        mostrarComposicionMixes = false,
        modoPrecio = 'kilo_y_bulto',
        incluirComparativaYAlternativas = false,
        mostrarPrecioAnterior = false,
        mostrarPorcentajeVariacion = false,
        mostrarAlternativasStock = false,
        destacarOfertas = true,
        bonificacionConfig = { activa: true, umbral: 300000, porcentaje: 5 }
    }) {
        const st = estadoAsistenteComercialWa;
        const lid = Number(listaId || st?.listaId) || 1;
        const nivActivos = Array.isArray(nivelesAgrupar) && nivelesAgrupar.length > 0
            ? nivelesAgrupar
            : (agruparPorJerarquiaB2B ? ['familia', 'principal'] : ['plana']);

        const ordenadosPadres = ordenarArticulosPorJerarquiaB2BWa(
            (Array.isArray(articulosRaw) ? articulosRaw : []).filter(a => !a.es_hijo),
            nivActivos
        );
        const baseLista = expandirConHijosDerivadosBunkerWa(ordenadosPadres, lid, Boolean(mostrarHijos));
        if (baseLista.length === 0) {
            throw new Error('No hay artículos para incluir en el PDF.');
        }

        let tieneNotasComparativas = false;
        const articulosPayload = baseLista.map(art => {
            const artRef = art.art_original || art;
            const infoP = formatearPrecioArticuloListaWa(art, lid);
            const kilosU = Number(art.kilos_unidad || art.peso_bulto || infoP.kilosUnidad || 1) || 1;
            const pBultoExacto = Number(art.precio_bulto_final || art.precio_nuevo_vigente || art.precio_nuevo_bulto || infoP.precioBultoExacto || infoP.precioBulto || 0);
            const pKgExacto = Number(art.precio_kilo_final || art.precio_nuevo_kilo || (kilosU > 0 && pBultoExacto > 0 ? (pBultoExacto / kilosU) : infoP.precioKgExacto) || 0);
            const famB2B = String(artRef.familia_b2b || artRef.familia_nombre || 'Artículos Generales').trim();
            const priB2B = String(artRef.articulo_principal_display || artRef.articulo_principal || 'General').trim();
            const subB2B = String(artRef.ruta_subcategoria_b2b || '').trim();

            const props = {
                ...(artRef.propiedades_dinamicas && typeof artRef.propiedades_dinamicas === 'object' ? artRef.propiedades_dinamicas : {}),
                familia_nombre: famB2B,
                articulo_principal: priB2B
            };
            if (subB2B) {
                props.ruta_subcategoria_b2b = subB2B;
            }

            let notaComp = (!art.es_hijo && mostrarComposicionMixes) ? String(art.composicion || '').trim() : '';
            if (!art.es_hijo && incluirComparativaYAlternativas) {
                const partesNota = [];
                if ((mostrarPrecioAnterior || mostrarPorcentajeVariacion) && art.precio_pagado_kilo && Number(art.precio_pagado_kilo) > 0) {
                    const antKg = Math.round(Number(art.precio_pagado_kilo)).toLocaleString('es-AR');
                    const dif = art.diferencia_porcentaje !== undefined ? Math.round(Number(art.diferencia_porcentaje)) : null;
                    const txtDif = (mostrarPorcentajeVariacion && dif !== null) ? ` (${dif > 0 ? '+' : ''}${dif}%)` : '';
                    if (mostrarPrecioAnterior) {
                        partesNota.push(`Últ. compra: $${antKg}/kg${txtDif}`);
                    } else if (txtDif) {
                        partesNota.push(`Variación: ${dif > 0 ? '+' : ''}${dif}%`);
                    }
                }
                if (mostrarAlternativasStock && art.sin_stock_actual) {
                    const altNom = art.alternativa_sugerida?.descripcion || art.alternativa_sugerida?.nombre;
                    if (altNom) {
                        const altP = Math.round(Number(art.alternativa_sugerida.precio_nuevo_kilo || art.alternativa_sugerida.precio_kilo || art.alternativa_sugerida.precio_bulto || 0)).toLocaleString('es-AR');
                        partesNota.push(`Alt. sugerida: ${altNom} ($${altP}/kg)`);
                    }
                }
                if (partesNota.length > 0) {
                    notaComp = partesNota.join(' · ');
                    tieneNotasComparativas = true;
                }
            }

            const preciosObj = { ...(art.precios || {}) };
            preciosObj[lid] = pBultoExacto;
            preciosObj[String(lid)] = pBultoExacto;

            const presStr = art.presentacion_str || (kilosU >= 1.0 ? `${kilosU.toFixed(2)} kg` : `${Math.round(kilosU * 1000)} g`);
            const nomVisible = String(art.nomenclatura || art.nombre || art.nombre_visible || art.descripcion_generada || art.descripcion || art.codigo_unico || art.articulo_id || '').trim();

            return {
                ...art,
                id: art.id || art.codigo_unico || art.articulo_id,
                articulo_id: art.codigo_unico || art.articulo_id || art.id,
                codigo_unico: art.codigo_unico || art.articulo_id || art.id,
                nombre: nomVisible,
                nomenclatura: nomVisible,
                descripcion_generada: nomVisible,
                descripcion: nomVisible,
                familia_nombre: famB2B,
                articulo_principal: priB2B,
                kilos_unidad: kilosU,
                presentacion_str: presStr,
                iva: Number(art.iva || 21),
                precio_bulto_final: Number(pBultoExacto.toFixed(2)),
                precio_kilo_final: Number(pKgExacto.toFixed(2)),
                precios: preciosObj,
                propiedades_dinamicas: props,
                composicion: notaComp
            };
        }).filter(a => a.precio_bulto_final > 0 || a.precio_kilo_final > 0);

        if (articulosPayload.length === 0) {
            throw new Error('No se encontraron precios válidos (> $0) en la lista asignada para los artículos seleccionados.');
        }

        const agruparConfig = nivActivos.includes('plana') ? ['plana'] : nivActivos;

        const nombreClienteFinal = String(clienteNombre || st?.nombreCliente || 'Cliente LAMDA').trim();
        const tituloFinal = tituloInforme || (
            alcance === 'ACTUALIZACIONES'
                ? 'Actualización de Precios'
                : (alcance === 'HABITUALES' ? 'Lista de Precios Habituales' : 'Lista de Precios')
        );

        const resPdf = await fetch('/api/logistica/bunker/cotizaciones/exportar-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cliente_nombre: nombreClienteFinal,
                whatsapp: String(telefonoCliente || st?.telefonoCliente || ''),
                titulo_informe: tituloFinal,
                lista_id: lid,
                listaId: lid,
                lista_nombre: st?.listaNombreInterna || `Lista #${lid}`,
                listaNombre: st?.listaNombreInterna || `Lista #${lid}`,
                articulos: articulosPayload,
                agrupar_por_atributo: agruparConfig,
                modo_precio: modoPrecio,
                modo_iva: 'con_iva',
                ocultar_columna_iva: true,
                mostrar_composicion_mixes: Boolean(mostrarComposicionMixes || (incluirComparativaYAlternativas && tieneNotasComparativas)),
                destacar_ofertas: Boolean(destacarOfertas),
                bonificacion_volumen: Boolean(bonificacionConfig?.activa),
                bonificacion_config: bonificacionConfig
            })
        });

        if (!resPdf.ok) {
            throw new Error(`No se pudo generar el PDF Búnker (HTTP ${resPdf.status}).`);
        }
        return await resPdf.blob();
    }

    /**
     * Resuelve la clave canónica del cliente para leer/guardar sus preferencias deterministas de PDF
     * en public.bunker_config_informe_precios_cliente (/api/produccion/precios/informe-config/:cliente_id)
     */
    function obtenerClaveConfigPdfClienteWa(st) {
        if (!st) return '';
        const leg = st.legacyClienteIdPrecios
            || st.rayosX?.cliente?.lomas_soft_id
            || (st.codigoBunker && /^\d+$/.test(String(st.codigoBunker).trim()) ? String(st.codigoBunker).trim() : '');
        if (leg) return String(leg).trim();
        if (st.codigoBunker) return String(st.codigoBunker).trim();
        if (st.clienteId) return `b_${st.clienteId}`;
        return '';
    }

    function obtenerTodasClavesStorageConfigPdfClienteWa(st) {
        if (!st) return [];
        const claves = [];
        if (st.clienteId) claves.push(`b_${Number(st.clienteId)}`);
        if (st.codigoBunker) claves.push(`cb_${String(st.codigoBunker).trim().toUpperCase()}`);
        const leg = st.legacyClienteIdPrecios || st.rayosX?.cliente?.lomas_soft_id || '';
        const legNum = parseInt(String(leg).replace(/\D/g, ''), 10);
        if (!isNaN(legNum) && legNum > 0) claves.push(`l_${legNum}`);
        if (st.chatId) claves.push(`chat_${Number(st.chatId)}`);
        return Array.from(new Set(claves.filter(Boolean)));
    }

    async function cargarConfigPdfClientePersistenteWa(st) {
        if (!st) return null;
        const clienteKeyConfig = obtenerClaveConfigPdfClienteWa(st);
        let cfgServidor = null;
        if (clienteKeyConfig) {
            try {
                const resCfg = await fetch(`/api/produccion/precios/informe-config/${encodeURIComponent(clienteKeyConfig)}`);
                if (resCfg.ok) {
                    const dataCfg = await resCfg.json();
                    if (dataCfg && dataCfg.config) {
                        cfgServidor = dataCfg.config;
                    }
                }
            } catch (eCfg) {
                console.warn('[WA-PDF-CONFIG] No se pudo cargar config de servidor:', eCfg);
            }
        }

        let cfgLocal = null;
        try {
            const claves = obtenerTodasClavesStorageConfigPdfClienteWa(st);
            for (const k of claves) {
                const raw = localStorage.getItem(`lamda_wa_pdf_config_cliente_v2_${k}`);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object') {
                        cfgLocal = parsed;
                        break;
                    }
                }
            }
        } catch (_) {}

        return {
            ...(cfgServidor || {}),
            ...(cfgLocal || {})
        };
    }

    async function inicializarConfigPdfGuardadaEnEstadoWa(st) {
        if (!st) return;
        const clienteKeyConfig = obtenerClaveConfigPdfClienteWa(st);
        const cfgGuardada = await cargarConfigPdfClientePersistenteWa(st);

        const agruparGuardado = cfgGuardada?.agrupar_jerarquia_b2b !== undefined
            ? Boolean(cfgGuardada.agrupar_jerarquia_b2b)
            : true;
        const nivelesGuardados = Array.isArray(cfgGuardada?.niveles_agrupar_bunker) && cfgGuardada.niveles_agrupar_bunker.length > 0
            ? cfgGuardada.niveles_agrupar_bunker
            : (agruparGuardado ? ['familia', 'principal'] : ['plana']);
        const mostrarHijosGuardado = cfgGuardada?.mostrar_hijos_bunker !== undefined
            ? Boolean(cfgGuardada.mostrar_hijos_bunker)
            : true;
        const mostrarCompMixGuardado = cfgGuardada?.mostrar_composicion_mixes_bunker !== undefined
            ? Boolean(cfgGuardada.mostrar_composicion_mixes_bunker)
            : false;
        const mostrarAntGuardado = cfgGuardada?.mostrar_precio_anterior !== undefined
            ? Boolean(cfgGuardada.mostrar_precio_anterior)
            : false;
        const mostrarPctGuardado = cfgGuardada?.mostrar_porcentaje_variacion !== undefined
            ? Boolean(cfgGuardada.mostrar_porcentaje_variacion)
            : false;
        const modoPrecioGuardado = cfgGuardada?.modo_precio_bunker || 'kilo_y_bulto';
        const destacarOfertasGuardado = cfgGuardada?.destacar_ofertas_bunker !== undefined
            ? Boolean(cfgGuardada.destacar_ofertas_bunker)
            : true;
        const bonifGuardada = cfgGuardada?.bonificacion_activa_bunker !== undefined
            ? Boolean(cfgGuardada.bonificacion_activa_bunker)
            : true;

        const tieneConfigManual = Boolean(cfgGuardada?.configurado_manualmente);
        const alcanceGuardado = String(cfgGuardada?.alcance_pdf_bunker || '').trim();
        const alcanceBaseGuardado = String(
            cfgGuardada?.alcance_base_modal_bunker
            || (alcanceGuardado && alcanceGuardado !== 'FILTRADO_MODAL' ? alcanceGuardado : '')
            || st.alcancePdfAdjunto
            || 'LISTA_COMPLETA'
        ).trim();

        const ldnArr = Array.isArray(cfgGuardada?.filtro_ldn_bunker)
            ? cfgGuardada.filtro_ldn_bunker.map(n => Number(n)).filter(n => n >= 1 && n <= 6)
            : [];
        const exclArr = Array.isArray(cfgGuardada?.ids_excluidos_bunker)
            ? cfgGuardada.ids_excluidos_bunker.map(x => String(x)).filter(Boolean)
            : [];

        st.configModalPdfBunker = {
            clienteKeyConfig,
            alcance: alcanceBaseGuardado,
            agruparJerarquiaB2B: !nivelesGuardados.includes('plana'),
            nivelesAgrupar: [...nivelesGuardados],
            mostrarHijos: mostrarHijosGuardado,
            mostrarComposicionMixes: mostrarCompMixGuardado,
            modoPrecio: modoPrecioGuardado,
            incluirComparativaYAlternativas: Boolean(mostrarAntGuardado || mostrarPctGuardado),
            mostrarPrecioAnterior: mostrarAntGuardado,
            mostrarPorcentajeVariacion: mostrarPctGuardado,
            mostrarAlternativasStock: false,
            destacarOfertas: destacarOfertasGuardado,
            bonificacionActiva: bonifGuardada,
            bonificacionUmbral: 300000,
            bonificacionPorcentaje: 5,
            mensajeAdjunto: '',
            filtroBusqueda: String(cfgGuardada?.filtro_busqueda_bunker || ''),
            filtroTipoPadre: String(cfgGuardada?.filtro_tipo_padre_bunker || 'TODOS'),
            filtroLdnSet: new Set(ldnArr),
            filtroFraccionOp: String(cfgGuardada?.filtro_fraccion_op_bunker || ''),
            filtroFraccionKg: String(cfgGuardada?.filtro_fraccion_kg_bunker || ''),
            idsExcluidos: new Set(exclArr),
            _tieneFiltroActivo: false
        };

        // Determinar si en el último mensaje entrante del chat el cliente consultó explícitamente por productos puntuales
        const ultMsgChat = Array.isArray(st.mensajesCompleta) && st.mensajesCompleta.length > 0
            ? st.mensajesCompleta[st.mensajesCompleta.length - 1]
            : null;
        const clientePidioProductoPuntualEnChat = Boolean(
            ultMsgChat &&
            !ultMsgChat.from_me &&
            st.detIntencion?.codigo === 'CONSULTA_PRECIO_PRODUCTO' &&
            st.idsSeleccionados &&
            st.idsSeleccionados.size > 0
        );

        if (tieneConfigManual && !clientePidioProductoPuntualEnChat) {
            st._tieneConfigPdfGuardadaCliente = true;
            if (Array.isArray(cfgGuardada?.ids_seleccionados_pdf_bunker) && cfgGuardada.ids_seleccionados_pdf_bunker.length > 0 && (alcanceGuardado === 'SELECCIONADOS' || alcanceBaseGuardado === 'SELECCIONADOS')) {
                const setIdsSel = new Set(cfgGuardada.ids_seleccionados_pdf_bunker.map(x => String(x)));
                const artsSelGuardados = (st.catalogoArticulos || []).filter(a => setIdsSel.has(String(a.id)));
                if (artsSelGuardados.length > 0) {
                    st.articulosPdfSugeridosIa = artsSelGuardados;
                }
            }
            const artsModal = obtenerArticulosSegunAlcanceModalPdfWa(st);
            st.articulosPdfConfiguradosEnModal = artsModal;
            st.alcancePdfAdjunto = st.configModalPdfBunker._tieneFiltroActivo
                ? 'FILTRADO_MODAL'
                : (alcanceGuardado || alcanceBaseGuardado || 'LISTA_COMPLETA');
            if (cfgGuardada?.adjuntar_pdf_default !== undefined) {
                st.sugerirAdjuntarPdfIa = Boolean(cfgGuardada.adjuntar_pdf_default);
            }
        }
    }

    /**
     * Genera el PDF con el formato institucional unificado de Artículos Búnker + Jerarquía B2B
     * y lo envía por WhatsApp al número indicado.
     */
    async function enviarPdfListaPreciosPorWa({
        listaId,
        telefonoDestino,
        mensajeTexto,
        articulosPersonalizados = null,
        alcance = 'ACTUALIZACIONES',
        agruparPorJerarquiaB2B = true,
        nivelesAgrupar = null,
        mostrarHijos = true,
        mostrarComposicionMixes = false,
        modoPrecio = 'kilo_y_bulto',
        incluirComparativaYAlternativas = false,
        mostrarPrecioAnterior = false,
        mostrarPorcentajeVariacion = false,
        mostrarAlternativasStock = false,
        destacarOfertas = true,
        bonificacionConfig = { activa: true, umbral: 300000, porcentaje: 5 },
        nombreArchivoBase = 'Lista_de_Precios_LAMDA'
    }) {
        const st = estadoAsistenteComercialWa;
        const lid = Number(listaId || st?.listaId) || 1;
        const articulosAEnviar = Array.isArray(articulosPersonalizados) && articulosPersonalizados.length > 0
            ? articulosPersonalizados
            : ((st?.catalogoArticulos || []).filter(a => esArticuloActivoEnListaWa(a, lid)));

        const blob = await generarBlobPdfFormatoBunkerJerarquiaB2BWa({
            listaId: lid,
            articulosRaw: articulosAEnviar,
            clienteNombre: st?.nombreCliente || 'Cliente LAMDA',
            telefonoCliente: st?.telefonoCliente || telefonoDestino,
            alcance,
            agruparPorJerarquiaB2B,
            nivelesAgrupar,
            mostrarHijos,
            mostrarComposicionMixes,
            modoPrecio,
            incluirComparativaYAlternativas,
            mostrarPrecioAnterior,
            mostrarPorcentajeVariacion,
            mostrarAlternativasStock,
            destacarOfertas,
            bonificacionConfig
        });

        const base64DataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        const cleanBase64 = String(base64DataUrl || '').replace(/^data:[^;]+;base64,/, '').trim();

        const fechaHoy = new Date().toISOString().slice(0, 10);
        const cleanCli = String(st?.nombreCliente || 'Cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
        const filename = `${nombreArchivoBase}_${cleanCli}_${fechaHoy}.pdf`;

        const payloadDocumento = {
            destinatarios: Array.isArray(telefonoDestino)
                ? telefonoDestino.map(n => String(n).trim()).filter(Boolean).join(', ')
                : String(telefonoDestino || '').trim(),
            pdfBase64: cleanBase64,
            filename,
            mensajeTexto: mensajeTexto || '📄 Lista de Precios LAMDA',
            chatId: st?.chatId || null
        };

        const urlFacturacionWa = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:3004/facturacion/whatsapp/enviar-documento'
            : '/api/facturacion/whatsapp/enviar-documento';

        let resEnvio = null;
        try {
            resEnvio = await fetch(urlFacturacionWa, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payloadDocumento)
            });
        } catch (errRed) {
            resEnvio = null;
        }

        if (!resEnvio || resEnvio.status === 404 || resEnvio.status === 502 || resEnvio.status === 503) {
            try {
                resEnvio = await fetch('/api/crm/whatsapp/enviar-documento', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payloadDocumento)
                });
            } catch (errRedFallback) {
                throw new Error('No se pudo conectar con el servidor de WhatsApp (puerto 3004). Verificá que el módulo de Facturación/WhatsApp esté activo.');
            }
        }

        const rawText = await resEnvio.text();
        let dataEnvio = null;
        try {
            dataEnvio = JSON.parse(rawText);
        } catch (_) {
            throw new Error(`Respuesta inesperada del servidor WhatsApp (HTTP ${resEnvio.status}): ${rawText.slice(0, 120)}`);
        }

        if (!resEnvio.ok || !dataEnvio.success) {
            const detalleErr = (Array.isArray(dataEnvio?.detalles) && dataEnvio.detalles[0]?.error)
                ? dataEnvio.detalles[0].error
                : (dataEnvio.error || dataEnvio.message || 'Error al enviar el PDF por WhatsApp.');
            throw new Error(detalleErr);
        }
        return dataEnvio;
    }

    /**
     * Abre el Diseñador y Vista Previa en Vivo de Lista de Precios / Informe de Actualizaciones
     * unificado con "Artículos Búnker" y "Configurar Jerarquía B2B", conectado directamente
     * al contacto de WhatsApp activo en el CRM y a la memoria determinista por cliente
     * (public.bunker_config_informe_precios_cliente).
     */
    window.abrirModalListaPreciosBunkerDesdeCrmWa = async function (alcanceInicial = 'AUTO') {
        const st = estadoAsistenteComercialWa;
        if (!st) return;

        // Guardar en memoria los 3 mensajes que el operador estaba armando en el Asistente Híbrido para no perderlos
        guardarBorradorTemporalModalAsistenteWa(st);

        const cantPendientes = (st.cambiosPreciosPendientes || []).length;
        const cantHabituales = (st.articulosHabituales || []).length;
        const cantSeleccionados = obtenerArticulosSeleccionadosYSugeridosPdfWa(st).length;

        let alcanceResuelto = alcanceInicial;
        if (alcanceResuelto === 'FILTRADO_MODAL') {
            alcanceResuelto = st.configModalPdfBunker?.alcance || 'LISTA_COMPLETA';
        } else if (alcanceResuelto === 'AUTO') {
            if (st.alcancePdfAdjunto && st.alcancePdfAdjunto !== 'FILTRADO_MODAL') {
                alcanceResuelto = st.alcancePdfAdjunto;
            } else if (st.configModalPdfBunker?.alcance) {
                alcanceResuelto = st.configModalPdfBunker.alcance;
            } else if (cantSeleccionados > 0) {
                alcanceResuelto = 'SELECCIONADOS';
            } else if (st.modoAccionProactiva === 'ACTUALIZACIONES_PENDIENTES' && cantPendientes > 0) {
                alcanceResuelto = 'ACTUALIZACIONES';
            } else if (cantPendientes > 0) {
                alcanceResuelto = 'ACTUALIZACIONES';
            } else if (cantHabituales > 0) {
                alcanceResuelto = 'HABITUALES';
            } else {
                alcanceResuelto = 'LISTA_COMPLETA';
            }
        }

        // Cargar configuración determinista guardada para este cliente (LocalStorage + PostgreSQL)
        const clienteKeyConfig = obtenerClaveConfigPdfClienteWa(st);
        const cfgGuardadaCliente = await cargarConfigPdfClientePersistenteWa(st);

        const limpiar = typeof window.limpiarSignosAperturaWa === 'function'
            ? window.limpiarSignosAperturaWa
            : (s => String(s || '').replace(/[¿¡]/g, '').trim());

        const construirMensajePorAlcance = (alc) => {
            const nom = st.nombreCorto ? ` ${st.nombreCorto}` : '';
            const saludoBase = st.charlaEnCurso ? `Te paso${nom}` : `Hola${nom}, cómo estás? Te paso`;
            if (alc === 'ACTUALIZACIONES') {
                return limpiar(`${saludoBase} en PDF el detalle actualizado de los productos que solés llevar, ordenado por familia.`);
            }
            if (alc === 'HABITUALES') {
                return limpiar(`${saludoBase} en PDF la lista actualizada de los artículos que trabajás habitualmente con nosotros.`);
            }
            if (alc === 'SOLO_PADRES') {
                return limpiar(`${saludoBase} en PDF nuestra lista actualizada de packs y presentaciones fraccionadas listas para exhibir.`);
            }
            if (alc === 'FRACCIONADOS_LOCAL') {
                return limpiar(`${saludoBase} en PDF la lista actualizada de packs, barritas, granolas y fracciones chicas para el local.`);
            }
            if (alc === 'SELECCIONADOS') {
                return limpiar(`${saludoBase} en PDF la cotización actualizada de los artículos consultados.`);
            }
            return limpiar(`${saludoBase} nuestra Lista de Precios actualizada en PDF.`);
        };

        const agruparGuardado = cfgGuardadaCliente?.agrupar_jerarquia_b2b !== undefined
            ? Boolean(cfgGuardadaCliente.agrupar_jerarquia_b2b)
            : true;
        const nivelesGuardados = Array.isArray(cfgGuardadaCliente?.niveles_agrupar_bunker) && cfgGuardadaCliente.niveles_agrupar_bunker.length > 0
            ? cfgGuardadaCliente.niveles_agrupar_bunker
            : (agruparGuardado ? ['familia', 'principal'] : ['plana']);
        const mostrarHijosGuardado = cfgGuardadaCliente?.mostrar_hijos_bunker !== undefined
            ? Boolean(cfgGuardadaCliente.mostrar_hijos_bunker)
            : true;
        const mostrarCompMixGuardado = cfgGuardadaCliente?.mostrar_composicion_mixes_bunker !== undefined
            ? Boolean(cfgGuardadaCliente.mostrar_composicion_mixes_bunker)
            : false;
        const mostrarAltGuardado = false;
        const mostrarAntGuardado = cfgGuardadaCliente?.mostrar_precio_anterior !== undefined
            ? Boolean(cfgGuardadaCliente.mostrar_precio_anterior)
            : false;
        const mostrarPctGuardado = cfgGuardadaCliente?.mostrar_porcentaje_variacion !== undefined
            ? Boolean(cfgGuardadaCliente.mostrar_porcentaje_variacion)
            : false;
        const modoPrecioGuardado = cfgGuardadaCliente?.modo_precio_bunker
            || (cfgGuardadaCliente?.mostrar_bulto === false && alcanceResuelto === 'ACTUALIZACIONES' ? 'kilo_y_bulto' : 'kilo_y_bulto');
        const destacarOfertasGuardado = cfgGuardadaCliente?.destacar_ofertas_bunker !== undefined
            ? Boolean(cfgGuardadaCliente.destacar_ofertas_bunker)
            : true;
        const bonifGuardada = cfgGuardadaCliente?.bonificacion_activa_bunker !== undefined
            ? Boolean(cfgGuardadaCliente.bonificacion_activa_bunker)
            : true;

        const prevCfg = st.configModalPdfBunker || {};
        const ldnGuardadoArr = Array.isArray(cfgGuardadaCliente?.filtro_ldn_bunker)
            ? cfgGuardadaCliente.filtro_ldn_bunker.map(n => Number(n)).filter(n => n >= 1 && n <= 6)
            : [];
        const exclGuardadoArr = Array.isArray(cfgGuardadaCliente?.ids_excluidos_bunker)
            ? cfgGuardadaCliente.ids_excluidos_bunker.map(x => String(x)).filter(Boolean)
            : [];

        st.configModalPdfBunker = {
            clienteKeyConfig,
            alcance: alcanceResuelto,
            agruparJerarquiaB2B: !nivelesGuardados.includes('plana'),
            nivelesAgrupar: Array.isArray(prevCfg.nivelesAgrupar) && prevCfg.nivelesAgrupar.length > 0 ? [...prevCfg.nivelesAgrupar] : [...nivelesGuardados],
            mostrarHijos: prevCfg.mostrarHijos !== undefined ? Boolean(prevCfg.mostrarHijos) : mostrarHijosGuardado,
            mostrarComposicionMixes: prevCfg.mostrarComposicionMixes !== undefined ? Boolean(prevCfg.mostrarComposicionMixes) : mostrarCompMixGuardado,
            modoPrecio: prevCfg.modoPrecio || modoPrecioGuardado,
            incluirComparativaYAlternativas: Boolean(mostrarAntGuardado || mostrarPctGuardado || mostrarAltGuardado),
            mostrarPrecioAnterior: prevCfg.mostrarPrecioAnterior !== undefined ? Boolean(prevCfg.mostrarPrecioAnterior) : mostrarAntGuardado,
            mostrarPorcentajeVariacion: prevCfg.mostrarPorcentajeVariacion !== undefined ? Boolean(prevCfg.mostrarPorcentajeVariacion) : mostrarPctGuardado,
            mostrarAlternativasStock: mostrarAltGuardado,
            destacarOfertas: prevCfg.destacarOfertas !== undefined ? Boolean(prevCfg.destacarOfertas) : destacarOfertasGuardado,
            bonificacionActiva: prevCfg.bonificacionActiva !== undefined ? Boolean(prevCfg.bonificacionActiva) : bonifGuardada,
            bonificacionUmbral: 300000,
            bonificacionPorcentaje: 5,
            mensajeAdjunto: construirMensajePorAlcance(alcanceResuelto),
            filtroBusqueda: prevCfg.filtroBusqueda !== undefined ? prevCfg.filtroBusqueda : String(cfgGuardadaCliente?.filtro_busqueda_bunker || ''),
            filtroTipoPadre: prevCfg.filtroTipoPadre || String(cfgGuardadaCliente?.filtro_tipo_padre_bunker || 'TODOS'),
            filtroLdnSet: prevCfg.filtroLdnSet instanceof Set ? prevCfg.filtroLdnSet : new Set(ldnGuardadoArr),
            filtroFraccionOp: prevCfg.filtroFraccionOp !== undefined ? prevCfg.filtroFraccionOp : String(cfgGuardadaCliente?.filtro_fraccion_op_bunker || ''),
            filtroFraccionKg: prevCfg.filtroFraccionKg !== undefined ? prevCfg.filtroFraccionKg : String(cfgGuardadaCliente?.filtro_fraccion_kg_bunker || ''),
            idsExcluidos: prevCfg.idsExcluidos instanceof Set ? prevCfg.idsExcluidos : new Set(exclGuardadoArr),
            _tieneFiltroActivo: false
        };

        const articulosConStock = (st.catalogoArticulos || []).filter(a => {
            enriquecerMetadatosFiltrosArticuloWa(a);
            return esArticuloActivoEnListaWa(a, st.listaId);
        });
        const totalConStock = articulosConStock.length;
        const totalPadresConStock = articulosConStock.filter(a => a.es_articulo_padre).length;
        const totalFraccLocalConStock = articulosConStock.filter(a => esArticuloFraccionadoLocalWa(a)).length;
        const destinoLabel = st.contactoNombreChat
            ? `${st.contactoNombreChat} (${st.telefonoCliente || 'Sin número'})`
            : `${st.nombreCliente} (${st.telefonoCliente || 'Sin número'})`;

        Swal.fire({
            title: '📄 Lista de Precios e Informe Búnker (100% Espejado con Artículos Búnker)',
            width: '1140px',
            showConfirmButton: false,
            showCloseButton: true,
            html: `
                <div style="text-align: left; font-family: inherit; color: #1e293b; font-size: 0.82rem;">
                    ${st.tieneListaAsignada === false ? `
                        <div style="background: #fef2f2; border: 2px solid #ef4444; border-radius: 9px; padding: 7px 11px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <div style="font-size: 0.76rem; font-weight: 800; color: #991b1b;">
                                ⚠️ Este cliente NO tiene Lista de Precios asignada en Artículos Búnker. Seleccioná qué lista aplicar:
                            </div>
                            <select onchange="window.cambiarListaPrecioManualAsistenteWa(this.value)" style="padding: 3px 8px; border-radius: 6px; border: 1px solid #dc2626; font-size: 0.74rem; font-weight: 800; background: #ffffff; color: #7f1d1d; cursor: pointer;">
                                ${(st.listasDisponibles || []).map(l => `<option value="${Number(l.id)}" ${Number(l.id) === Number(st.listaId) ? 'selected' : ''}>Lista #${Number(l.id)} — ${escaparHtml(l.nombre)}</option>`).join('')}
                            </select>
                        </div>
                    ` : ''}
                    <!-- CABECERA CONECTADA AL CHAT ACTIVO Y A LA LISTA ASIGNADA DEL CLIENTE -->
                    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <div>
                            <div style="font-weight: 800; font-size: 0.9rem; color: #065f46; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span>🏢 ${escaparHtml(st.nombreCliente)}</span>
                                <span style="background: #065f46; color: #ffffff; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem;">🔒 Lista Activa #${escaparHtml(st.listaId)} (${escaparHtml(st.listaNombreInterna)}) · Solo artículos activos en esta lista</span>
                                <span id="crm-pdf-saved-badge" style="background: #dcfce7; color: #166534; border: 1px solid #86efac; padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 800;">
                                    💾 Reglas deterministas de este cliente activas
                                </span>
                            </div>
                            <div style="font-size: 0.74rem; color: #0f766e; font-weight: 700; margin-top: 2px;">
                                📱 Destinatario conectado en el CRM: <strong>${escaparHtml(destinoLabel)}</strong> (misma lógica exacta que Enviar Lista Completa en Artículos Búnker)
                            </div>
                        </div>
                        <button type="button" onclick="window.aplicarConfigPdfYVolverAlAsistenteWa(false)" style="background: #ffffff; color: #065f46; border: 1px solid #10b981; padding: 5px 11px; border-radius: 7px; font-weight: 800; font-size: 0.75rem; cursor: pointer;">
                            ⬅️ Volver al Mensaje que estaba armando
                        </button>
                    </div>

                    <!-- CUERPO DOBLE COLUMNA: CONTROLES A LA IZQUIERDA + FILTROS RÁPIDOS Y VISTA PREVIA EN VIVO A LA DERECHA -->
                    <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start;">
                        <!-- COLUMNA IZQUIERDA: ALCANCE Y FORMATO GUARDADO POR CLIENTE -->
                        <div style="flex: 0 1 345px; min-width: 290px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 9px; box-sizing: border-box;">
                            <div>
                                <div style="font-weight: 800; font-size: 0.76rem; color: #0f172a; margin-bottom: 5px;">
                                    1️⃣ Qué productos incluir en el PDF (activos en Lista #${escaparHtml(st.listaId)}):
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    <button type="button" id="btn-crm-pdf-alcance-LISTA_COMPLETA" onclick="window.cambiarAlcanceModalPdfBunkerWa('LISTA_COMPLETA')" style="text-align: left; padding: 6px 9px; border-radius: 7px; font-size: 0.73rem; font-weight: 800; cursor: pointer;">
                                        📋 Lista de Precios Completa Activa (${totalConStock})
                                    </button>
                                    <button type="button" id="btn-crm-pdf-alcance-SOLO_PADRES" onclick="window.cambiarAlcanceModalPdfBunkerWa('SOLO_PADRES')" style="text-align: left; padding: 6px 9px; border-radius: 7px; font-size: 0.73rem; font-weight: 800; cursor: pointer;" title="Todos los packs / artículos padre activos en esta lista (10x300g, 10x200g, 10x150g, 10x500g, 24x50g...)">
                                        📦 Solo Artículos Padre / Packs 10x (${totalPadresConStock})
                                    </button>
                                    <button type="button" id="btn-crm-pdf-alcance-FRACCIONADOS_LOCAL" onclick="window.cambiarAlcanceModalPdfBunkerWa('FRACCIONADOS_LOCAL')" style="text-align: left; padding: 6px 9px; border-radius: 7px; font-size: 0.73rem; font-weight: 800; cursor: pointer;" title="Todos los packs padre + todas las fracciones chicas de hasta 2kg, barritas y granolas (sin graneles de 5kg/10kg)">
                                        🛍️ Fraccionados y Packs para Local (${totalFraccLocalConStock})
                                    </button>
                                    <button type="button" id="btn-crm-pdf-alcance-HABITUALES" onclick="window.cambiarAlcanceModalPdfBunkerWa('HABITUALES')" style="text-align: left; padding: 6px 9px; border-radius: 7px; font-size: 0.73rem; font-weight: 800; cursor: pointer;">
                                        🛒 Lo que nos Compra Habitualmente (${cantHabituales})
                                    </button>
                                    <button type="button" id="btn-crm-pdf-alcance-ACTUALIZACIONES" onclick="window.cambiarAlcanceModalPdfBunkerWa('ACTUALIZACIONES')" style="text-align: left; padding: 6px 9px; border-radius: 7px; font-size: 0.73rem; font-weight: 800; cursor: pointer;">
                                        🔔 Actualizaciones Pendientes (${cantPendientes})
                                    </button>
                                    ${cantSeleccionados > 0 ? `
                                        <button type="button" id="btn-crm-pdf-alcance-SELECCIONADOS" onclick="window.cambiarAlcanceModalPdfBunkerWa('SELECCIONADOS')" style="text-align: left; padding: 6px 9px; border-radius: 7px; font-size: 0.73rem; font-weight: 800; cursor: pointer;">
                                            ✅ Seleccionados en el Asistente (${cantSeleccionados})
                                        </button>
                                    ` : ''}
                                </div>
                            </div>

                            <div style="border-top: 1px dashed #cbd5e1; padding-top: 8px;">
                                <div style="font-weight: 800; font-size: 0.74rem; color: #0f172a; margin-bottom: 5px;">
                                    📦 Niveles de Agrupamiento (Multi-Selección igual a Artículos Búnker):
                                </div>
                                <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 7px;">
                                    <button type="button" id="chip-crm-pdf-agrup-plana" onclick="window.toggleNivelAgrupamientoModalPdfWa('plana')" style="padding: 3px 7px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1;">📋 Plana</button>
                                    <button type="button" id="chip-crm-pdf-agrup-familia" onclick="window.toggleNivelAgrupamientoModalPdfWa('familia')" style="padding: 3px 7px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1;">🌾 Familia</button>
                                    <button type="button" id="chip-crm-pdf-agrup-principal" onclick="window.toggleNivelAgrupamientoModalPdfWa('principal')" style="padding: 3px 7px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1;">🌽 Atributo Principal</button>
                                    <button type="button" id="chip-crm-pdf-agrup-ruta_subcategoria_b2b" onclick="window.toggleNivelAgrupamientoModalPdfWa('ruta_subcategoria_b2b')" title="Subcategoría configurada en Jerarquía B2B" style="padding: 3px 7px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1;">🌳 Subcategoría B2B</button>
                                    <button type="button" id="chip-crm-pdf-agrup-tratamiento" onclick="window.toggleNivelAgrupamientoModalPdfWa('tratamiento')" style="padding: 3px 7px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1;">🏷️ Tratamiento</button>
                                    <button type="button" id="chip-crm-pdf-agrup-conformacion" onclick="window.toggleNivelAgrupamientoModalPdfWa('conformacion')" style="padding: 3px 7px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1;">🏷️ Conformación</button>
                                    <button type="button" id="chip-crm-pdf-agrup-variedad" onclick="window.toggleNivelAgrupamientoModalPdfWa('variedad')" style="padding: 3px 7px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1;">🏷️ Variedad</button>
                                    <button type="button" id="chip-crm-pdf-agrup-definicion" onclick="window.toggleNivelAgrupamientoModalPdfWa('definicion')" style="padding: 3px 7px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1;">🏷️ Definición</button>
                                    <button type="button" id="chip-crm-pdf-agrup-calibre" onclick="window.toggleNivelAgrupamientoModalPdfWa('calibre')" style="padding: 3px 7px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1;">🏷️ Calibre</button>
                                </div>

                                <div style="font-weight: 800; font-size: 0.74rem; color: #0f172a; margin-bottom: 4px;">
                                    2️⃣ Opciones de Presentación y Formato (se guardan por cliente):
                                </div>
                                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 800; color: #6b21a8; cursor: pointer; margin-bottom: 4px;">
                                    <input type="checkbox" id="chk-crm-pdf-hijos" ${st.configModalPdfBunker.mostrarHijos ? 'checked' : ''} onchange="window.actualizarConfigModalPdfBunkerWa()">
                                    <span>↳ Incluir unidad fraccionada hija debajo de cada Pack Padre</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 700; color: #065f46; cursor: pointer; margin-bottom: 4px;">
                                    <input type="checkbox" id="chk-crm-pdf-comp-mix" ${st.configModalPdfBunker.mostrarComposicionMixes ? 'checked' : ''} onchange="window.actualizarConfigModalPdfBunkerWa()">
                                    <span>🥗 Incluir composición de ingredientes en Mixes</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 700; color: #334155; cursor: pointer; margin-bottom: 4px;">
                                    <input type="checkbox" id="chk-crm-pdf-ofertas" ${st.configModalPdfBunker.destacarOfertas ? 'checked' : ''} onchange="window.actualizarConfigModalPdfBunkerWa()">
                                    <span>🔥 Destacar Ofertas Activas (% OFF)</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.72rem; font-weight: 700; color: #334155; cursor: pointer; margin-bottom: 4px;">
                                    <input type="checkbox" id="chk-crm-pdf-bonif" ${st.configModalPdfBunker.bonificacionActiva ? 'checked' : ''} onchange="window.actualizarConfigModalPdfBunkerWa()">
                                    <span>🛡️ Pie de Bonificación (&gt;$300.000 → 5% OFF)</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.71rem; font-weight: 700; color: #b45309; cursor: pointer; margin-bottom: 3px;">
                                    <input type="checkbox" id="chk-crm-pdf-precio-ant" ${st.configModalPdfBunker.mostrarPrecioAnterior ? 'checked' : ''} onchange="window.actualizarConfigModalPdfBunkerWa()">
                                    <span>⏮️ Mostrar Últ. Compra del cliente ($/kg abonado)</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.71rem; font-weight: 700; color: #b45309; cursor: pointer; margin-bottom: 6px;">
                                    <input type="checkbox" id="chk-crm-pdf-pct-var" ${st.configModalPdfBunker.mostrarPorcentajeVariacion ? 'checked' : ''} onchange="window.actualizarConfigModalPdfBunkerWa()">
                                    <span>📈 Mostrar % de Variación respecto a su última compra</span>
                                </label>

                                <div style="font-size: 0.72rem; font-weight: 800; color: #475569; margin-bottom: 3px;">Columnas de Precio (Lista #${escaparHtml(st.listaId)}):</div>
                                <select id="sel-crm-pdf-modo-precio" onchange="window.actualizarConfigModalPdfBunkerWa()" style="width: 100%; padding: 5px 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.75rem; font-weight: 700; background: #ffffff;">
                                    <option value="kilo_y_bulto" ${st.configModalPdfBunker.modoPrecio === 'kilo_y_bulto' ? 'selected' : ''}>💰 P. Kilo + P. Bulto / Ud. (Recomendado Búnker)</option>
                                    <option value="por_kilo" ${st.configModalPdfBunker.modoPrecio === 'por_kilo' ? 'selected' : ''}>⚖️ Solo Precio por Kilo (P. Kilo)</option>
                                    <option value="bulto_cerrado" ${st.configModalPdfBunker.modoPrecio === 'bulto_cerrado' ? 'selected' : ''}>📦 Solo Precio por Bulto (P. Bulto / Ud.)</option>
                                </select>
                            </div>

                            <div style="border-top: 1px dashed #cbd5e1; padding-top: 8px;">
                                <div style="font-weight: 800; font-size: 0.75rem; color: #065f46; margin-bottom: 4px;">
                                    3️⃣ Mensaje corto que acompaña al PDF (sin "¿"):
                                </div>
                                <textarea id="txt-crm-pdf-mensaje" rows="3" style="width: 100%; padding: 6px 8px; border-radius: 7px; border: 1px solid #10b981; font-size: 0.78rem; font-family: inherit; box-sizing: border-box; resize: vertical;">${escaparHtml(st.configModalPdfBunker.mensajeAdjunto)}</textarea>
                            </div>
                        </div>

                        <!-- COLUMNA DERECHA: FILTRO ACUMULATIVO RÁPIDO DEL PDF + VISTA PREVIA EN VIVO -->
                        <div style="flex: 1 1 500px; min-width: 0; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;">
                            <!-- BARRA DE FILTRO RÁPIDO EN VIVO SOBRE EL PDF ("SIEMPRE FILTRA SOBRE LO FILTRADO") -->
                            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px 10px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 5px;">
                                    <span style="font-weight: 800; font-size: 0.75rem; color: #0f172a;">
                                        🔍 Filtro Rápido del PDF en Vivo (filtra sobre el alcance elegido):
                                    </span>
                                    <div style="display: flex; align-items: center; gap: 6px;">
                                        <span id="crm-pdf-count-filtrados-badge" style="background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; padding: 1px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 800;"></span>
                                        <button type="button" id="btn-crm-pdf-limpiar-filtros" onclick="window.limpiarFiltrosModalPdfBunkerWa()" style="display: none; padding: 2px 7px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #ef4444; background: #fef2f2; color: #b91c1c;">
                                            🧹 Limpiar filtro PDF
                                        </button>
                                    </div>
                                </div>
                                <input type="text" id="inp-crm-pdf-filtro-texto" value="${escaparHtml(st.configModalPdfBunker.filtroBusqueda || '')}" oninput="window.filtrarTextoModalPdfBunkerWa(this.value)" placeholder="🔍 Filtrá por grupos de caracteres (ej: 'mix', '10 x 300', '10 x 200', 'barra', 'granola', 'nuez mar', 'menor que 2', 'padre')..." style="width: 100%; padding: 5px 9px; border-radius: 6px; border: 1px solid #94a3b8; font-size: 0.76rem; font-weight: 600; color: #0f172a; box-sizing: border-box; margin-bottom: 5px; background: #ffffff;">
                                <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;">
                                    <!-- Tipo Padre / Combos / Fraccionados Chicos -->
                                    <div style="display: flex; align-items: center; gap: 3px; flex-wrap: wrap;">
                                        <span style="font-size: 0.66rem; font-weight: 800; color: #475569;">Tipo:</span>
                                        <button type="button" id="btn-crm-pdf-padre-SOLO_PADRE" onclick="window.setFiltroTipoPadreModalPdfWa('SOLO_PADRE')" title="Dejar solo Artículos Padre / Combos (10x300g, 10x200g, 10x150g, 10x500g, 24x50g...)" style="padding: 2px 7px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #c084fc; background: #ffffff; color: #6b21a8;">
                                            📦 Solo Art. Padre (Combos 10x)
                                        </button>
                                        <button type="button" id="btn-crm-pdf-padre-FRACC_LOCAL" onclick="window.setFiltroTipoPadreModalPdfWa('FRACC_LOCAL')" title="Packs Padre + Todas las fracciones chicas (≤ 2kg), barritas y granolas (sin bolsas de 5kg/10kg)" style="padding: 2px 7px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #86efac; background: #ffffff; color: #15803d;">
                                            🛍️ Packs + Fracc. ≤2kg
                                        </button>
                                        <button type="button" id="btn-crm-pdf-padre-SOLO_INDIVIDUAL" onclick="window.setFiltroTipoPadreModalPdfWa('SOLO_INDIVIDUAL')" title="Solo artículos individuales (sin packs/combos)" style="padding: 2px 7px; border-radius: 5px; font-size: 0.67rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">
                                            🔹 Individuales
                                        </button>
                                    </div>
                                    <!-- Línea de Negocio (LDN 1 a 6) -->
                                    <div style="display: flex; align-items: center; gap: 3px; flex-wrap: wrap;">
                                        <span style="font-size: 0.66rem; font-weight: 800; color: #475569;">Línea:</span>
                                        <button type="button" id="btn-crm-pdf-ldn-TODAS" onclick="window.toggleFiltroLdnModalPdfWa(0)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #0f172a; background: #0f172a; color: #ffffff;">Todas</button>
                                        <button type="button" id="btn-crm-pdf-ldn-1" onclick="window.toggleFiltroLdnModalPdfWa(1)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">LDN 1</button>
                                        <button type="button" id="btn-crm-pdf-ldn-2" onclick="window.toggleFiltroLdnModalPdfWa(2)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #86efac; background: #ffffff; color: #15803d;">LDN 2 (Fracc.)</button>
                                        <button type="button" id="btn-crm-pdf-ldn-3" onclick="window.toggleFiltroLdnModalPdfWa(3)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #c4b5fd; background: #ffffff; color: #5b21b6;">LDN 3 (Mix)</button>
                                        <button type="button" id="btn-crm-pdf-ldn-4" onclick="window.toggleFiltroLdnModalPdfWa(4)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #fde68a; background: #ffffff; color: #92400e;">LDN 4 (Tost.)</button>
                                        <button type="button" id="btn-crm-pdf-ldn-5" onclick="window.toggleFiltroLdnModalPdfWa(5)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #fecdd3; background: #ffffff; color: #9f1239;">LDN 5 (Barr.)</button>
                                        <button type="button" id="btn-crm-pdf-ldn-6" onclick="window.toggleFiltroLdnModalPdfWa(6)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #bae6fd; background: #ffffff; color: #0369a1;">LDN 6 (Gran.)</button>
                                    </div>
                                    <!-- Fracción en Kg (Botones rápidos + Selector e Input editable por el usuario) -->
                                    <div style="display: flex; align-items: center; gap: 3px; flex-wrap: wrap;">
                                        <span style="font-size: 0.66rem; font-weight: 800; color: #475569;">Fracción:</span>
                                        <select id="sel-crm-pdf-frac-op" onchange="window.setFiltroFraccionModalPdfWa()" title="Operador de peso de fracción" style="padding: 2px 4px; border-radius: 4px; border: 1px solid #94a3b8; font-size: 0.66rem; font-weight: 800; color: #0f172a; background: #ffffff;">
                                            <option value="" ${!st.configModalPdfBunker.filtroFraccionOp ? 'selected' : ''}>Todos</option>
                                            <option value="<" ${st.configModalPdfBunker.filtroFraccionOp === '<' ? 'selected' : ''}>&lt; menor a</option>
                                            <option value="<=" ${st.configModalPdfBunker.filtroFraccionOp === '<=' ? 'selected' : ''}>&le; hasta</option>
                                            <option value="=" ${st.configModalPdfBunker.filtroFraccionOp === '=' ? 'selected' : ''}>= igual a</option>
                                            <option value=">=" ${st.configModalPdfBunker.filtroFraccionOp === '>=' ? 'selected' : ''}>&ge; desde</option>
                                            <option value=">" ${st.configModalPdfBunker.filtroFraccionOp === '>' ? 'selected' : ''}>&gt; mayor a</option>
                                        </select>
                                        <input type="number" id="inp-crm-pdf-frac-kg" value="${escaparHtml(st.configModalPdfBunker.filtroFraccionKg || '')}" step="0.1" min="0" placeholder="kg" oninput="window.setFiltroFraccionModalPdfWa()" title="Escribí el valor en kg que querés filtrar (ej: 0.5, 1, 1.5, 2, 5)" style="width: 58px; padding: 2px 5px; border-radius: 4px; border: 1px solid #94a3b8; font-size: 0.68rem; font-weight: 800; color: #0f172a; background: #ffffff;">
                                        <span style="font-size: 0.64rem; font-weight: 800; color: #475569; margin-right: 2px;">kg</span>
                                        <button type="button" id="btn-crm-pdf-frac-lte1" onclick="window.aplicarPresetFraccionModalPdfWa('<=', 1)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">&le;1kg</button>
                                        <button type="button" id="btn-crm-pdf-frac-lt2" onclick="window.aplicarPresetFraccionModalPdfWa('<', 2)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">&lt;2kg</button>
                                        <button type="button" id="btn-crm-pdf-frac-lte2" onclick="window.aplicarPresetFraccionModalPdfWa('<=', 2)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">&le;2kg</button>
                                        <button type="button" id="btn-crm-pdf-frac-gt2" onclick="window.aplicarPresetFraccionModalPdfWa('>', 2)" style="padding: 2px 5px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; cursor: pointer; border: 1px solid #cbd5e1; background: #ffffff; color: #334155;">&gt;2kg</button>
                                    </div>
                                </div>
                            </div>

                            <!-- VISTA PREVIA EN VIVO ESTILO ARTÍCULOS BÚNKER -->
                            <div style="background: #e2e8f0; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px; max-height: 410px; overflow: auto; box-sizing: border-box;">
                                <div id="crm-pdf-bunker-live-preview" style="min-width: 460px; background: #ffffff; border-radius: 8px; padding: 14px 16px; box-shadow: 0 2px 8px rgba(15,23,42,0.08); box-sizing: border-box;"></div>
                            </div>
                        </div>
                    </div>

                    <div id="crm-pdf-bunker-status" style="display: none; margin-top: 8px; padding: 8px 12px; border-radius: 8px; border: 1px solid #93c5fd; font-size: 0.78rem;"></div>

                    <!-- BARRA INFERIOR DE ACCIÓN: GUARDAR E INCLUIR EN EL MENSAJE DEL ASISTENTE -->
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; padding-top: 8px; border-top: 1px solid #e2e8f0;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <button type="button" id="btn-crm-pdf-descargar" onclick="window.descargarVistaPreviaPdfBunkerDesdeCrmWa()" style="background: #0f172a; color: #ffffff; border: none; padding: 7px 12px; border-radius: 8px; font-weight: 800; font-size: 0.76rem; cursor: pointer;">
                                📥 Abrir / Imprimir PDF en Pestaña
                            </button>
                            <button type="button" onclick="window.aplicarConfigPdfYVolverAlAsistenteWa(false)" style="background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 7px 12px; border-radius: 8px; font-weight: 800; font-size: 0.76rem; cursor: pointer;">
                                ⬅️ Cancelar y Volver
                            </button>
                        </div>
                        <button type="button" id="btn-crm-pdf-aplicar-volver" onclick="window.aplicarConfigPdfYVolverAlAsistenteWa(true)" style="background: #059669; color: #ffffff; border: none; padding: 9px 18px; border-radius: 8px; font-weight: 900; font-size: 0.85rem; cursor: pointer; box-shadow: 0 2px 6px rgba(5,150,105,0.3);">
                            ✅ Guardar Configuración e Incluir este PDF en mi Mensaje
                        </button>
                    </div>
                </div>
            `,
            didOpen: () => {
                window.renderizarVistaPreviaModalPdfBunkerWa();
            }
        });
    };

    window.toggleNivelAgrupamientoModalPdfWa = function (nivelKey) {
        const st = estadoAsistenteComercialWa;
        if (!st || !st.configModalPdfBunker) return;
        const cfg = st.configModalPdfBunker;
        if (!Array.isArray(cfg.nivelesAgrupar)) {
            cfg.nivelesAgrupar = ['familia', 'principal'];
        }
        if (nivelKey === 'plana') {
            cfg.nivelesAgrupar = ['plana'];
            cfg.agruparJerarquiaB2B = false;
        } else {
            cfg.nivelesAgrupar = cfg.nivelesAgrupar.filter(k => k !== 'plana');
            if (cfg.nivelesAgrupar.includes(nivelKey)) {
                cfg.nivelesAgrupar = cfg.nivelesAgrupar.filter(k => k !== nivelKey);
                if (cfg.nivelesAgrupar.length === 0) {
                    cfg.nivelesAgrupar = ['plana'];
                }
            } else {
                cfg.nivelesAgrupar.push(nivelKey);
            }
            cfg.agruparJerarquiaB2B = !cfg.nivelesAgrupar.includes('plana');
        }
        persistirConfigModalPdfClienteEnServidorWa(st);
        window.renderizarVistaPreviaModalPdfBunkerWa();
    };

    window.filtrarTextoModalPdfBunkerWa = function (valor) {
        const st = estadoAsistenteComercialWa;
        if (!st || !st.configModalPdfBunker) return;
        st.configModalPdfBunker.filtroBusqueda = valor || '';
        window.renderizarVistaPreviaModalPdfBunkerWa();
    };

    window.setFiltroTipoPadreModalPdfWa = function (modo) {
        const st = estadoAsistenteComercialWa;
        if (!st || !st.configModalPdfBunker) return;
        st.configModalPdfBunker.filtroTipoPadre = (st.configModalPdfBunker.filtroTipoPadre === modo) ? 'TODOS' : modo;
        window.renderizarVistaPreviaModalPdfBunkerWa();
    };

    window.toggleFiltroLdnModalPdfWa = function (ldnNum) {
        const st = estadoAsistenteComercialWa;
        if (!st || !st.configModalPdfBunker) return;
        if (!(st.configModalPdfBunker.filtroLdnSet instanceof Set)) {
            st.configModalPdfBunker.filtroLdnSet = new Set();
        }
        const n = Number(ldnNum || 0);
        if (n === 0) {
            st.configModalPdfBunker.filtroLdnSet.clear();
        } else if (st.configModalPdfBunker.filtroLdnSet.has(n)) {
            st.configModalPdfBunker.filtroLdnSet.delete(n);
        } else {
            st.configModalPdfBunker.filtroLdnSet.add(n);
        }
        window.renderizarVistaPreviaModalPdfBunkerWa();
    };

    window.setFiltroFraccionModalPdfWa = function () {
        const st = estadoAsistenteComercialWa;
        if (!st || !st.configModalPdfBunker) return;
        const selOp = document.getElementById('sel-crm-pdf-frac-op');
        const inpKg = document.getElementById('inp-crm-pdf-frac-kg');
        let op = selOp ? selOp.value : '';
        const kgVal = inpKg ? inpKg.value : '';
        if (!op && kgVal !== '' && Number(kgVal) > 0 && selOp) {
            op = '<=';
            selOp.value = '<=';
        }
        st.configModalPdfBunker.filtroFraccionOp = op;
        st.configModalPdfBunker.filtroFraccionKg = kgVal;
        window.renderizarVistaPreviaModalPdfBunkerWa();
    };

    window.aplicarPresetFraccionModalPdfWa = function (op, kg) {
        const st = estadoAsistenteComercialWa;
        if (!st || !st.configModalPdfBunker) return;
        const selOp = document.getElementById('sel-crm-pdf-frac-op');
        const inpKg = document.getElementById('inp-crm-pdf-frac-kg');
        if (st.configModalPdfBunker.filtroFraccionOp === op && Number(st.configModalPdfBunker.filtroFraccionKg) === Number(kg)) {
            st.configModalPdfBunker.filtroFraccionOp = '';
            st.configModalPdfBunker.filtroFraccionKg = '';
            if (selOp) selOp.value = '';
            if (inpKg) inpKg.value = '';
        } else {
            st.configModalPdfBunker.filtroFraccionOp = op;
            st.configModalPdfBunker.filtroFraccionKg = String(kg);
            if (selOp) selOp.value = op;
            if (inpKg) inpKg.value = String(kg);
        }
        window.renderizarVistaPreviaModalPdfBunkerWa();
    };

    window.limpiarFiltrosModalPdfBunkerWa = function () {
        const st = estadoAsistenteComercialWa;
        if (!st || !st.configModalPdfBunker) return;
        st.configModalPdfBunker.filtroBusqueda = '';
        st.configModalPdfBunker.filtroTipoPadre = 'TODOS';
        if (st.configModalPdfBunker.filtroLdnSet instanceof Set) st.configModalPdfBunker.filtroLdnSet.clear();
        if (st.configModalPdfBunker.idsExcluidos instanceof Set) st.configModalPdfBunker.idsExcluidos.clear();
        st.configModalPdfBunker.filtroFraccionOp = '';
        st.configModalPdfBunker.filtroFraccionKg = '';
        const inp = document.getElementById('inp-crm-pdf-filtro-texto');
        const selOp = document.getElementById('sel-crm-pdf-frac-op');
        const inpKg = document.getElementById('inp-crm-pdf-frac-kg');
        if (inp) inp.value = '';
        if (selOp) selOp.value = '';
        if (inpKg) inpKg.value = '';
        window.renderizarVistaPreviaModalPdfBunkerWa();
    };

    window.excluirArticuloPuntualModalPdfWa = function (idArticulo) {
        const st = estadoAsistenteComercialWa;
        if (!st || !st.configModalPdfBunker) return;
        if (!(st.configModalPdfBunker.idsExcluidos instanceof Set)) {
            st.configModalPdfBunker.idsExcluidos = new Set();
        }
        st.configModalPdfBunker.idsExcluidos.add(String(idArticulo));
        window.renderizarVistaPreviaModalPdfBunkerWa();
    };

    window.insertarSoloLinkPortalEnBurbuja2Wa = function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const linkPortal = st.magicLinkDirecto
            || st.linkActivacionCorto
            || st.resultadoMesa?.proactivo?.infoDuraLinkPortal
            || st.urlPortalBase
            || URL_PORTAL_B2B_OFICIAL;
        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2');
        const wrapB2 = document.getElementById('wa-asist-com-burbuja2-wrap');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3');
        const wrapB3 = document.getElementById('wa-asist-com-burbuja3-wrap');
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        if (chkB2) chkB2.checked = true;
        if (wrapB2) wrapB2.style.display = 'block';
        if (area2) {
            const actual = String(area2.value || '').trim();
            if (!actual) {
                area2.value = linkPortal;
            } else if (!actual.includes(linkPortal)) {
                area2.value = `${actual}\n\n🔗 Portal de Clientes: ${linkPortal}`;
            }
        }
        if (chkB3 && !chkB3.checked) {
            chkB3.checked = true;
            if (wrapB3) wrapB3.style.display = 'block';
            if (area3 && !String(area3.value || '').trim()) {
                area3.value = st.resultadoMesa?.proactivo?.cierreSugerido3raBurbuja || 'Cualquier cosa estamos atentos.';
            }
        }
        window.actualizarIndicadorLongitudAsistenteComercialWa();
    };

    window.aplicarConfigPdfYVolverAlAsistenteWa = function (adjuntarAlMensaje = true) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        if (st.configModalPdfBunker) {
            window.actualizarConfigModalPdfBunkerWa();
            const artsActualesModal = obtenerArticulosSegunAlcanceModalPdfWa(st);
            st.articulosPdfConfiguradosEnModal = artsActualesModal;
            st.alcancePdfAdjunto = st.configModalPdfBunker._tieneFiltroActivo
                ? 'FILTRADO_MODAL'
                : (st.configModalPdfBunker.alcance || 'LISTA_COMPLETA');

            if (adjuntarAlMensaje) {
                st.sugerirAdjuntarPdfIa = true;
                persistirConfigModalPdfClienteEnServidorWa(st, {
                    configuradoManualmente: true,
                    adjuntarPdfDefault: true,
                    alcanceOverride: st.alcancePdfAdjunto
                });
                if (!st._borradorMensajesEnCurso) {
                    st._borradorMensajesEnCurso = {
                        b1: st.resultadoMesa?.proactivo?.burbuja1 || '',
                        chkB2: Boolean(st.resultadoMesa?.proactivo?.burbuja2),
                        b2: st.resultadoMesa?.proactivo?.burbuja2 || '',
                        chkB3: Boolean(st.resultadoMesa?.proactivo?.burbuja3),
                        b3: st.resultadoMesa?.proactivo?.burbuja3 || '',
                        chkPdf: true,
                        chkPdfCc: false,
                        alcancePdf: st.alcancePdfAdjunto
                    };
                } else {
                    st._borradorMensajesEnCurso.chkPdf = true;
                    st._borradorMensajesEnCurso.alcancePdf = st.alcancePdfAdjunto;
                }
            } else {
                persistirConfigModalPdfClienteEnServidorWa(st, {
                    configuradoManualmente: true
                });
            }
        }
        mostrarModalSwalAsistenteComercialWa(st);
        if (adjuntarAlMensaje) {
            const statusEl = document.getElementById('wa-asist-com-status');
            if (statusEl) {
                const arts = obtenerArticulosParaPdfAdjuntoAsistenteWa(st);
                const mapaEtiq = {
                    LISTA_COMPLETA: '📋 Lista de Precios Completa',
                    SOLO_PADRES: '📦 Solo Artículos Padre / Packs (10x...)',
                    FRACCIONADOS_LOCAL: '🛍️ Fraccionados y Packs para Local',
                    HABITUALES: '🛒 Lo que nos compra habitualmente',
                    ACTUALIZACIONES: '🔔 Actualizaciones pendientes',
                    SELECCIONADOS: '✅ Artículos seleccionados',
                    FILTRADO_MODAL: '🔍 Selección filtrada en el Configurador'
                };
                const etiqAlcance = mapaEtiq[st.alcancePdfAdjunto] || '📄 Lista configurada';
                statusEl.style.display = 'block';
                statusEl.style.background = '#ecfdf5';
                statusEl.style.borderColor = '#6ee7b7';
                statusEl.style.color = '#065f46';
                statusEl.innerHTML = `✅ <strong>Configuración de PDF guardada por defecto para ${escaparHtml(st.nombreCorto || st.nombreCliente)} y lista para adjuntar:</strong> ${etiqAlcance} (<strong>${arts.length} artículos</strong> de su Lista #${escaparHtml(st.listaId)}). La próxima vez que abras este cliente ya tendrá esta configuración lista.`;
            }
        }
    };

    function obtenerArticulosSegunAlcanceModalPdfWa(st) {
        if (!st) return [];
        const cfg = st.configModalPdfBunker || {};
        const alc = cfg.alcance || 'ACTUALIZACIONES';
        const nivActivos = Array.isArray(cfg.nivelesAgrupar) && cfg.nivelesAgrupar.length > 0
            ? cfg.nivelesAgrupar
            : (cfg.agruparJerarquiaB2B !== false ? ['familia', 'principal'] : ['plana']);

        let base = [];
        if (alc === 'ACTUALIZACIONES') {
            base = (st.cambiosPreciosPendientes && st.cambiosPreciosPendientes.length > 0)
                ? st.cambiosPreciosPendientes
                : (st.cambiosPreciosTodos || []);
        } else if (alc === 'HABITUALES') {
            base = st.articulosHabituales || [];
        } else if (alc === 'SOLO_PADRES') {
            base = (st.catalogoArticulos || []).filter(a => {
                enriquecerMetadatosFiltrosArticuloWa(a);
                return esArticuloActivoEnListaWa(a, st.listaId) && Boolean(a.es_articulo_padre);
            });
        } else if (alc === 'FRACCIONADOS_LOCAL') {
            base = (st.catalogoArticulos || []).filter(a => esArticuloActivoEnListaWa(a, st.listaId) && esArticuloFraccionadoLocalWa(a));
        } else if (alc === 'SELECCIONADOS') {
            base = obtenerArticulosSeleccionadosYSugeridosPdfWa(st);
        } else {
            base = (st.catalogoArticulos || []).filter(a => esArticuloActivoEnListaWa(a, st.listaId));
        }

        cfg._totalBaseSinFiltro = base.length;

        const parsed = parsearConsultaCumulativaAsistenteWa(cfg.filtroBusqueda || '');
        const ldnSetUi = cfg.filtroLdnSet instanceof Set ? cfg.filtroLdnSet : new Set();
        const ldnsActivas = new Set([...ldnSetUi, ...(parsed.ldnsInline || [])]);
        const tipoPadreActivo = parsed.tipoPadreInline || cfg.filtroTipoPadre || 'TODOS';
        const fracOpUi = String(cfg.filtroFraccionOp || '').trim();
        const fracKgUi = cfg.filtroFraccionKg;
        const tieneFracUi = Boolean(fracOpUi && fracKgUi !== '' && fracKgUi !== null && Number(fracKgUi) > 0);

        const idsExcluidosPdf = cfg.idsExcluidos instanceof Set ? cfg.idsExcluidos : new Set();
        const hayFiltroEnModal = Boolean(
            String(cfg.filtroBusqueda || '').trim() ||
            ldnsActivas.size > 0 ||
            tipoPadreActivo !== 'TODOS' ||
            tieneFracUi ||
            idsExcluidosPdf.size > 0
        );
        cfg._tieneFiltroActivo = hayFiltroEnModal;

        if (!hayFiltroEnModal) {
            return ordenarArticulosPorJerarquiaB2BWa(base, nivActivos);
        }

        const filtrados = base.filter(art => {
            const idKey = String(art.id || art.codigo_unico || art.articulo_id || '');
            if (idsExcluidosPdf.has(idKey)) return false;
            enriquecerMetadatosFiltrosArticuloWa(art);
            const bolsa = art._bolsaBusqueda || obtenerBolsaBusquedaArticuloAsistenteWa(art);
            if (ldnsActivas.size > 0 && !ldnsActivas.has(Number(art.linea_negocio || 1))) return false;
            if (tipoPadreActivo === 'SOLO_PADRE' && !art.es_articulo_padre) return false;
            if (tipoPadreActivo === 'FRACC_LOCAL' && !esArticuloFraccionadoLocalWa(art)) return false;
            if (tipoPadreActivo === 'SOLO_INDIVIDUAL' && art.es_articulo_padre) return false;
            if (tieneFracUi && !cumpleFiltroFraccionWa(art, fracOpUi, fracKgUi)) return false;
            if (parsed.fraccionesInline.length > 0) {
                for (const fIn of parsed.fraccionesInline) {
                    if (!cumpleFiltroFraccionWa(art, fIn.op, fIn.kg)) return false;
                }
            }
            if (parsed.presentaciones.length > 0) {
                for (const pr of parsed.presentaciones) {
                    if (!cumplePresentacionPuntualWa(art, pr.num, pr.unidad)) return false;
                }
            }
            if (parsed.terminos.length > 0) {
                if (!parsed.terminos.every(t => bolsa.includes(t))) return false;
            }
            return true;
        });

        return ordenarArticulosPorJerarquiaB2BWa(filtrados, nivActivos);
    }

    async function persistirConfigModalPdfClienteEnServidorWa(st, opciones = {}) {
        if (!st) return;
        const cfg = st.configModalPdfBunker || {};
        const key = cfg.clienteKeyConfig || obtenerClaveConfigPdfClienteWa(st);
        const alcanceActual = opciones.alcanceOverride
            || (cfg._tieneFiltroActivo ? 'FILTRADO_MODAL' : (cfg.alcance || st.alcancePdfAdjunto || 'LISTA_COMPLETA'));
        const alcanceBaseModal = (cfg.alcance && cfg.alcance !== 'FILTRADO_MODAL')
            ? cfg.alcance
            : (alcanceActual !== 'FILTRADO_MODAL' ? alcanceActual : 'LISTA_COMPLETA');

        const chkPdfDom = document.getElementById('wa-asist-com-chk-pdf');
        const adjuntarDefault = opciones.adjuntarPdfDefault !== undefined
            ? Boolean(opciones.adjuntarPdfDefault)
            : (chkPdfDom ? Boolean(chkPdfDom.checked) : Boolean(st.sugerirAdjuntarPdfIa));

        const ldnArr = cfg.filtroLdnSet instanceof Set ? Array.from(cfg.filtroLdnSet) : [];
        const exclArr = cfg.idsExcluidos instanceof Set ? Array.from(cfg.idsExcluidos) : [];
        const selPdfIds = obtenerArticulosSeleccionadosYSugeridosPdfWa(st).map(a => String(a.id)).filter(Boolean);

        const payloadCompleto = {
            configurado_manualmente: opciones.configuradoManualmente !== undefined ? Boolean(opciones.configuradoManualmente) : true,
            adjuntar_pdf_default: adjuntarDefault,
            alcance_pdf_bunker: alcanceActual,
            alcance_base_modal_bunker: alcanceBaseModal,
            agrupar_jerarquia_b2b: cfg.agruparJerarquiaB2B !== undefined ? Boolean(cfg.agruparJerarquiaB2B) : true,
            niveles_agrupar_bunker: Array.isArray(cfg.nivelesAgrupar) && cfg.nivelesAgrupar.length > 0 ? cfg.nivelesAgrupar : ['familia', 'principal'],
            mostrar_hijos_bunker: cfg.mostrarHijos !== undefined ? Boolean(cfg.mostrarHijos) : true,
            mostrar_composicion_mixes_bunker: Boolean(cfg.mostrarComposicionMixes),
            mostrar_alternativas_stock: false,
            mostrar_precio_anterior: Boolean(cfg.mostrarPrecioAnterior),
            mostrar_porcentaje_variacion: Boolean(cfg.mostrarPorcentajeVariacion),
            mostrar_bulto: cfg.modoPrecio === 'kilo_y_bulto' || cfg.modoPrecio === 'bulto_cerrado' || !cfg.modoPrecio,
            modo_precio_bunker: cfg.modoPrecio || 'kilo_y_bulto',
            destacar_ofertas_bunker: cfg.destacarOfertas !== undefined ? Boolean(cfg.destacarOfertas) : true,
            bonificacion_activa_bunker: cfg.bonificacionActiva !== undefined ? Boolean(cfg.bonificacionActiva) : true,
            filtro_busqueda_bunker: String(cfg.filtroBusqueda || ''),
            filtro_tipo_padre_bunker: String(cfg.filtroTipoPadre || 'TODOS'),
            filtro_ldn_bunker: ldnArr,
            filtro_fraccion_op_bunker: String(cfg.filtroFraccionOp || ''),
            filtro_fraccion_kg_bunker: String(cfg.filtroFraccionKg || ''),
            ids_excluidos_bunker: exclArr,
            ids_seleccionados_pdf_bunker: selPdfIds,
            updated_at: new Date().toISOString()
        };

        st._tieneConfigPdfGuardadaCliente = true;

        // 1. Guardar instantáneamente en LocalStorage bajo todas las claves canónicas del cliente
        try {
            const claves = obtenerTodasClavesStorageConfigPdfClienteWa(st);
            const jsonStr = JSON.stringify(payloadCompleto);
            claves.forEach(k => {
                localStorage.setItem(`lamda_wa_pdf_config_cliente_v2_${k}`, jsonStr);
            });
        } catch (eLs) {
            console.warn('[WA-PDF-CONFIG] No se pudo guardar en localStorage:', eLs);
        }

        // 2. Persistir también en PostgreSQL (/api/produccion/precios/informe-config/:cliente_id)
        if (key) {
            try {
                await fetch(`/api/produccion/precios/informe-config/${encodeURIComponent(key)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payloadCompleto)
                });
            } catch (err) {
                console.warn('[WA-PDF-CONFIG] No se pudo persistir preferencia del cliente en servidor:', err);
            }
        }

        const badge = document.getElementById('crm-pdf-saved-badge');
        if (badge) {
            badge.textContent = `💾 Configuración por defecto guardada para ${st.nombreCorto || st.nombreCliente}`;
        }
    }

    window.cambiarAlcanceModalPdfBunkerWa = function (nuevoAlcance) {
        const st = estadoAsistenteComercialWa;
        if (!st || !st.configModalPdfBunker) return;
        st.configModalPdfBunker.alcance = nuevoAlcance;
        const txtArea = document.getElementById('txt-crm-pdf-mensaje');
        if (txtArea) {
            const nom = st.nombreCorto ? ` ${st.nombreCorto}` : '';
            const saludoBase = st.charlaEnCurso ? `Te paso${nom}` : `Hola${nom}, cómo estás? Te paso`;
            if (nuevoAlcance === 'ACTUALIZACIONES') {
                txtArea.value = `${saludoBase} en PDF el detalle actualizado de los productos que solés llevar, ordenado por familia.`;
            } else if (nuevoAlcance === 'HABITUALES') {
                txtArea.value = `${saludoBase} en PDF la lista actualizada de los artículos que trabajás habitualmente con nosotros.`;
            } else if (nuevoAlcance === 'SOLO_PADRES') {
                txtArea.value = `${saludoBase} en PDF nuestra lista actualizada de packs y presentaciones fraccionadas listas para exhibir.`;
            } else if (nuevoAlcance === 'FRACCIONADOS_LOCAL') {
                txtArea.value = `${saludoBase} en PDF la lista actualizada de packs, barritas, granolas y fracciones chicas para el local.`;
            } else if (nuevoAlcance === 'SELECCIONADOS') {
                txtArea.value = `${saludoBase} en PDF la cotización actualizada de los artículos consultados.`;
            } else {
                txtArea.value = `${saludoBase} nuestra Lista de Precios actualizada en PDF.`;
            }
            st.configModalPdfBunker.mensajeAdjunto = txtArea.value;
        }
        persistirConfigModalPdfClienteEnServidorWa(st, { configuradoManualmente: true });
        window.renderizarVistaPreviaModalPdfBunkerWa();
    };

    window.actualizarConfigModalPdfBunkerWa = function () {
        const st = estadoAsistenteComercialWa;
        if (!st || !st.configModalPdfBunker) return;
        const nivs = Array.isArray(st.configModalPdfBunker.nivelesAgrupar) && st.configModalPdfBunker.nivelesAgrupar.length > 0
            ? st.configModalPdfBunker.nivelesAgrupar
            : ['familia', 'principal'];
        st.configModalPdfBunker.agruparJerarquiaB2B = !nivs.includes('plana');
        st.configModalPdfBunker.mostrarHijos = Boolean(document.getElementById('chk-crm-pdf-hijos')?.checked);
        st.configModalPdfBunker.mostrarComposicionMixes = Boolean(document.getElementById('chk-crm-pdf-comp-mix')?.checked);
        st.configModalPdfBunker.mostrarPrecioAnterior = Boolean(document.getElementById('chk-crm-pdf-precio-ant')?.checked);
        st.configModalPdfBunker.mostrarPorcentajeVariacion = Boolean(document.getElementById('chk-crm-pdf-pct-var')?.checked);
        st.configModalPdfBunker.mostrarAlternativasStock = false;
        st.configModalPdfBunker.incluirComparativaYAlternativas = Boolean(
            st.configModalPdfBunker.mostrarPrecioAnterior
            || st.configModalPdfBunker.mostrarPorcentajeVariacion
        );
        st.configModalPdfBunker.destacarOfertas = Boolean(document.getElementById('chk-crm-pdf-ofertas')?.checked);
        st.configModalPdfBunker.bonificacionActiva = Boolean(document.getElementById('chk-crm-pdf-bonif')?.checked);
        st.configModalPdfBunker.modoPrecio = document.getElementById('sel-crm-pdf-modo-precio')?.value || 'kilo_y_bulto';
        st.configModalPdfBunker.mensajeAdjunto = document.getElementById('txt-crm-pdf-mensaje')?.value || '';
        persistirConfigModalPdfClienteEnServidorWa(st);
        window.renderizarVistaPreviaModalPdfBunkerWa();
    };

    window.renderizarVistaPreviaModalPdfBunkerWa = function () {
        const st = estadoAsistenteComercialWa;
        const container = document.getElementById('crm-pdf-bunker-live-preview');
        if (!st || !container) return;

        const cfg = st.configModalPdfBunker || {};
        ['ACTUALIZACIONES', 'HABITUALES', 'SOLO_PADRES', 'FRACCIONADOS_LOCAL', 'SELECCIONADOS', 'LISTA_COMPLETA'].forEach(k => {
            const btn = document.getElementById(`btn-crm-pdf-alcance-${k}`);
            if (!btn) return;
            const act = cfg.alcance === k;
            btn.style.background = act ? '#059669' : '#ffffff';
            btn.style.color = act ? '#ffffff' : '#1e293b';
            btn.style.border = act ? '2px solid #047857' : '1px solid #cbd5e1';
        });

        const nivActivos = Array.isArray(cfg.nivelesAgrupar) && cfg.nivelesAgrupar.length > 0
            ? cfg.nivelesAgrupar
            : (cfg.agruparJerarquiaB2B !== false ? ['familia', 'principal'] : ['plana']);
        ['plana', 'familia', 'principal', 'ruta_subcategoria_b2b', 'tratamiento', 'conformacion', 'variedad', 'definicion', 'calibre'].forEach(k => {
            const ch = document.getElementById(`chip-crm-pdf-agrup-${k}`);
            if (!ch) return;
            const act = nivActivos.includes(k);
            ch.style.background = act ? '#8e4785' : '#ffffff';
            ch.style.color = act ? '#ffffff' : '#334155';
            ch.style.borderColor = act ? '#8e4785' : '#cbd5e1';
        });

        const articulos = obtenerArticulosSegunAlcanceModalPdfWa(st);

        // Actualizar estilos de la barra de filtro rápido del PDF en vivo
        const badgeCount = document.getElementById('crm-pdf-count-filtrados-badge');
        if (badgeCount) {
            badgeCount.textContent = cfg._tieneFiltroActivo
                ? `Mostrando ${articulos.length} de ${cfg._totalBaseSinFiltro || articulos.length} art.`
                : `${articulos.length} art. en el PDF`;
        }
        const btnLimpiar = document.getElementById('btn-crm-pdf-limpiar-filtros');
        if (btnLimpiar) {
            btnLimpiar.style.display = cfg._tieneFiltroActivo ? 'inline-block' : 'none';
        }
        const btnAplicarVolver = document.getElementById('btn-crm-pdf-aplicar-volver');
        if (btnAplicarVolver) {
            btnAplicarVolver.textContent = `✅ Guardar Configuración e Incluir este PDF (${articulos.length} art.) en mi Mensaje`;
        }

        const btnPadre = document.getElementById('btn-crm-pdf-padre-SOLO_PADRE');
        const btnFraccLoc = document.getElementById('btn-crm-pdf-padre-FRACC_LOCAL');
        const btnIndiv = document.getElementById('btn-crm-pdf-padre-SOLO_INDIVIDUAL');
        if (btnPadre) {
            const act = cfg.filtroTipoPadre === 'SOLO_PADRE';
            btnPadre.style.background = act ? '#7e22ce' : '#ffffff';
            btnPadre.style.color = act ? '#ffffff' : '#6b21a8';
        }
        if (btnFraccLoc) {
            const act = cfg.filtroTipoPadre === 'FRACC_LOCAL';
            btnFraccLoc.style.background = act ? '#15803d' : '#ffffff';
            btnFraccLoc.style.color = act ? '#ffffff' : '#15803d';
        }
        if (btnIndiv) {
            const act = cfg.filtroTipoPadre === 'SOLO_INDIVIDUAL';
            btnIndiv.style.background = act ? '#0f172a' : '#ffffff';
            btnIndiv.style.color = act ? '#ffffff' : '#334155';
        }

        const ldnSet = cfg.filtroLdnSet instanceof Set ? cfg.filtroLdnSet : new Set();
        const btnLdnTodas = document.getElementById('btn-crm-pdf-ldn-TODAS');
        if (btnLdnTodas) {
            const act = ldnSet.size === 0;
            btnLdnTodas.style.background = act ? '#0f172a' : '#ffffff';
            btnLdnTodas.style.color = act ? '#ffffff' : '#475569';
        }
        const colLdn = {
            1: { bg: '#334155', txt: '#334155' },
            2: { bg: '#15803d', txt: '#15803d' },
            3: { bg: '#5b21b6', txt: '#5b21b6' },
            4: { bg: '#92400e', txt: '#92400e' },
            5: { bg: '#9f1239', txt: '#9f1239' },
            6: { bg: '#0369a1', txt: '#0369a1' }
        };
        [1, 2, 3, 4, 5, 6].forEach(n => {
            const b = document.getElementById(`btn-crm-pdf-ldn-${n}`);
            if (!b) return;
            const act = ldnSet.has(n);
            b.style.background = act ? colLdn[n].bg : '#ffffff';
            b.style.color = act ? '#ffffff' : colLdn[n].txt;
        });

        [
            { id: 'btn-crm-pdf-frac-lte1', op: '<=', kg: 1 },
            { id: 'btn-crm-pdf-frac-lt2', op: '<', kg: 2 },
            { id: 'btn-crm-pdf-frac-lte2', op: '<=', kg: 2 },
            { id: 'btn-crm-pdf-frac-gt2', op: '>', kg: 2 }
        ].forEach(pr => {
            const b = document.getElementById(pr.id);
            if (!b) return;
            const act = cfg.filtroFraccionOp === pr.op && Number(cfg.filtroFraccionKg) === pr.kg;
            b.style.background = act ? '#0284c7' : '#ffffff';
            b.style.color = act ? '#ffffff' : '#334155';
        });

        const fechaHoy = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const mostrarKg = cfg.modoPrecio === 'por_kilo' || cfg.modoPrecio === 'kilo_y_bulto';
        const mostrarBulto = cfg.modoPrecio === 'bulto_cerrado' || cfg.modoPrecio === 'kilo_y_bulto';
        const tituloDoc = cfg.alcance === 'ACTUALIZACIONES'
            ? 'Actualización de Precios'
            : (cfg.alcance === 'HABITUALES' ? 'Lista de Precios Habituales' : 'Lista de Precios');

        if (articulos.length === 0) {
            container.innerHTML = `<div style="padding: 24px; text-align: center; color: #64748b; font-weight: 700;">No hay artículos en este alcance. Elegí otra opción a la izquierda.</div>`;
            return;
        }

        const fmtARS = (v) => '$ ' + Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Expandir con filas hijas derivadas de packs padre igual que Artículos Búnker
        const articulosVista = expandirConHijosDerivadosBunkerWa(articulos, st.listaId, cfg.mostrarHijos !== false);
        const limitePreview = Math.min(articulosVista.length, 100);
        let famActual = null;
        let priActual = null;
        let subActual = null;
        let filasHtml = '';

        const atrSecundarios = nivActivos.filter(n => !['plana', 'familia', 'principal'].includes(n));

        for (let i = 0; i < limitePreview; i++) {
            const art = articulosVista[i];
            const artRef = art.art_original || art;
            const fam = String(artRef.familia_b2b || artRef.familia_nombre || 'Artículos Generales').trim();
            const pri = String(artRef.articulo_principal_display || artRef.articulo_principal || 'General').trim();
            const subVals = atrSecundarios
                .map(n => obtenerValorAtributoArticuloBunkerWa(artRef, n))
                .filter(v => v && v.toLowerCase() !== 'general' && v.toLowerCase() !== pri.toLowerCase());
            const sub = subVals.join(' · ');

            if (!art.es_hijo && !nivActivos.includes('plana')) {
                if (nivActivos.includes('familia') && fam !== famActual) {
                    famActual = fam;
                    priActual = null;
                    subActual = null;
                    filasHtml += `
                        <tr>
                            <td colspan="4" style="background: #f8fafc; color: #0f172a; border: 1px solid #94a3b8; font-weight: 900; font-size: 0.74rem; padding: 5px 10px; letter-spacing: 0.03em; text-transform: uppercase;">
                                <img src="/img/isotipo_L_LAMDA.png" alt="L" style="height: 12px; vertical-align: middle; margin-right: 6px;" onerror="this.style.display='none'">
                                ${escaparHtml(fam)}
                            </td>
                        </tr>
                    `;
                }
                if (nivActivos.includes('principal') && pri !== priActual) {
                    priActual = pri;
                    subActual = null;
                    filasHtml += `
                        <tr>
                            <td colspan="4" style="background: #e0f2fe; color: #0369a1; font-weight: 800; font-size: 0.72rem; padding: 4px 10px 4px 16px; text-transform: uppercase;">
                                ${escaparHtml(pri)}
                            </td>
                        </tr>
                    `;
                }
                if (sub && sub !== subActual) {
                    subActual = sub;
                    filasHtml += `
                        <tr>
                            <td colspan="4" style="background: #f1f5f9; color: #6b21a8; font-weight: 800; font-size: 0.67rem; padding: 3px 10px 3px 24px; border-bottom: 1px solid #e2e8f0; text-transform: uppercase;">
                                » ${escaparHtml(sub)}
                            </td>
                        </tr>
                    `;
                }
            }

            const infoP = formatearPrecioArticuloListaWa(art, st.listaId);
            const kilosU = Number(art.kilos_unidad || art.peso_bulto || infoP.kilosUnidad || 1) || 1;
            const pBulto = Number(art.precio_bulto_final || art.precio_nuevo_vigente || art.precio_nuevo_bulto || infoP.precioBultoExacto || infoP.precioBulto || 0);
            const pKg = Number(art.precio_kilo_final || art.precio_nuevo_kilo || (kilosU > 0 && pBulto > 0 ? (pBulto / kilosU) : infoP.precioKgExacto) || 0);
            const presStr = art.presentacion_str || (kilosU >= 1 ? `${kilosU.toFixed(2)} kg` : `${Math.round(kilosU * 1000)} g`);

            if (art.es_hijo) {
                filasHtml += `
                    <tr style="border-bottom: 1px solid #f1f5f9; background: #faf5ff;">
                        <td style="padding: 3px 8px 3px 22px; min-width: 170px; font-style: italic; font-weight: 700; font-size: 0.69rem; color: #6b21a8;">
                            » ${escaparHtml(art.nombre)}
                        </td>
                        <td style="padding: 3px 8px; text-align: center; font-size: 0.67rem; color: #6b21a8; font-style: italic; white-space: nowrap;">
                            ${escaparHtml(presStr)}
                        </td>
                        ${mostrarKg ? `<td style="padding: 3px 8px; text-align: right; font-size: 0.68rem; color: #64748b; white-space: nowrap;">${escaparHtml(fmtARS(pKg))}</td>` : ''}
                        ${mostrarBulto ? `<td style="padding: 3px 8px; text-align: right; font-weight: 800; font-size: 0.7rem; color: #6b21a8; white-space: nowrap;"><span style="font-size:0.62rem; color:#7e22ce;">(P. Ud.)</span> ${escaparHtml(fmtARS(pBulto))}</td>` : ''}
                    </tr>
                `;
                continue;
            }

            let detalleComparativoHtml = '';
            const badges = [];
            if (cfg.mostrarComposicionMixes && art.composicion) {
                badges.push(`<span style="color:#475569;">🥗 ${escaparHtml(String(art.composicion))}</span>`);
            }
            if (cfg.incluirComparativaYAlternativas) {
                if ((cfg.mostrarPrecioAnterior || cfg.mostrarPorcentajeVariacion) && art.precio_pagado_kilo && Number(art.precio_pagado_kilo) > 0) {
                    const antKg = Math.round(Number(art.precio_pagado_kilo)).toLocaleString('es-AR');
                    const dif = art.diferencia_porcentaje !== undefined ? Math.round(Number(art.diferencia_porcentaje)) : null;
                    const txtDif = (cfg.mostrarPorcentajeVariacion && dif !== null) ? ` (${dif > 0 ? '+' : ''}${dif}%)` : '';
                    if (cfg.mostrarPrecioAnterior) {
                        badges.push(`<span style="color:#64748b;">Últ. compra: $${antKg}/kg <strong style="color:${dif > 0 ? '#b45309' : '#15803d'};">${txtDif}</strong></span>`);
                    } else if (txtDif) {
                        badges.push(`<strong style="color:${dif > 0 ? '#b45309' : '#15803d'};">Variación: ${dif > 0 ? '+' : ''}${dif}%</strong>`);
                    }
                }
            }
            if (badges.length > 0) {
                detalleComparativoHtml = `<div style="font-size: 0.65rem; margin-top: 2px; font-style: italic;">${badges.join(' · ')}</div>`;
            }

            const idArtKey = String(art.id || art.codigo_unico || art.articulo_id || '');
            filasHtml += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 5px 8px; min-width: 170px;">
                        <div style="font-weight: 700; font-size: 0.73rem; color: #0f172a; display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                            <span>${escaparHtml(art.nombre)}</span>
                            <button type="button" onclick="window.excluirArticuloPuntualModalPdfWa('${escaparHtml(idArtKey)}')" title="Quitar este artículo del PDF" style="border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; border-radius: 4px; padding: 0px 5px; font-size: 0.65rem; font-weight: 900; cursor: pointer; line-height: 1.3;">✖</button>
                        </div>
                        ${detalleComparativoHtml}
                    </td>
                    <td style="padding: 5px 8px; text-align: center; font-size: 0.7rem; color: #64748b; white-space: nowrap;">
                        ${escaparHtml(presStr)}
                    </td>
                    ${mostrarKg ? `<td style="padding: 5px 8px; text-align: right; font-weight: 800; font-size: 0.74rem; color: #1e293b; white-space: nowrap;">${escaparHtml(fmtARS(pKg))}</td>` : ''}
                    ${mostrarBulto ? `<td style="padding: 5px 8px; text-align: right; font-weight: 900; font-size: 0.75rem; color: #15803d; white-space: nowrap;">${escaparHtml(fmtARS(pBulto))}</td>` : ''}
                </tr>
            `;
        }

        const notaMasArticulos = articulosVista.length > limitePreview
            ? `<div style="padding: 6px; text-align: center; font-size: 0.7rem; color: #64748b; background: #f8fafc;">… y ${articulosVista.length - limitePreview} renglones más incluidos en el PDF completo.</div>`
            : '';

        container.innerHTML = `
            <!-- ENCABEZADO INSTITUCIONAL ARTÍCULOS BÚNKER -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #8e4785; padding-bottom: 8px; margin-bottom: 8px;">
                <div>
                    <img src="/img/logo_LAMDA.png" alt="LAMDA" style="height: 34px; object-fit: contain;" onerror="this.style.display='none'">
                    <div style="font-size: 0.67rem; color: #64748b; font-weight: 700; margin-top: 2px; white-space: nowrap;">
                        WhatsApp: +54 9 221 661-5746
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 900; font-size: 0.92rem; color: #1e293b;">${escaparHtml(tituloDoc)}</div>
                    <div style="font-size: 0.74rem; color: #334155; font-weight: 800; margin-top: 2px;">Cliente: ${escaparHtml(st.nombreCliente)}</div>
                    <div style="font-size: 0.66rem; color: #64748b; font-weight: 600;">Emisión: ${escaparHtml(fechaHoy)} · ${articulos.length} art.</div>
                </div>
            </div>

            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #8e4785; color: #ffffff;">
                        <th style="padding: 5px 8px; text-align: left; font-size: 0.68rem; min-width: 170px;">Artículo / Nomenclatura</th>
                        <th style="padding: 5px 8px; text-align: center; font-size: 0.68rem; width: 78px; white-space: nowrap;">Presentación</th>
                        ${mostrarKg ? `<th style="padding: 5px 8px; text-align: right; font-size: 0.68rem; width: 92px; white-space: nowrap;">P. Kilo</th>` : ''}
                        ${mostrarBulto ? `<th style="padding: 5px 8px; text-align: right; font-size: 0.68rem; width: 98px; white-space: nowrap;">P. Bulto / Ud.</th>` : ''}
                    </tr>
                </thead>
                <tbody>
                    ${filasHtml}
                </tbody>
            </table>
            ${notaMasArticulos}
            ${cfg.bonificacionActiva ? `
                <div style="margin-top: 8px; padding: 6px 10px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 6px; font-size: 0.68rem; font-weight: 700; color: #4b5563;">
                    <div style="color: #7e22ce; font-weight: 800; margin-bottom: 2px;">INFORMACIÓN DE COTIZACIÓN Y CONDICIONES COMERCIALES</div>
                    <div>• Los precios expuestos son FINALES.</div>
                    <div style="color: #2563eb; font-weight: 800;">• Bonificación Comercial: 5% de descuento adicional en compras superiores a $300.000.</div>
                </div>
            ` : ''}
        `;
    };

    window.descargarVistaPreviaPdfBunkerDesdeCrmWa = async function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        window.actualizarConfigModalPdfBunkerWa();
        const cfg = st.configModalPdfBunker || {};
        const btn = document.getElementById('btn-crm-pdf-descargar');
        const statusEl = document.getElementById('crm-pdf-bunker-status');
        const articulos = obtenerArticulosSegunAlcanceModalPdfWa(st);

        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Generando PDF...';
        }
        try {
            const blob = await generarBlobPdfFormatoBunkerJerarquiaB2BWa({
                listaId: st.listaId,
                articulosRaw: articulos,
                clienteNombre: st.nombreCliente,
                telefonoCliente: st.telefonoCliente,
                alcance: cfg.alcance,
                agruparPorJerarquiaB2B: cfg.agruparJerarquiaB2B,
                nivelesAgrupar: cfg.nivelesAgrupar,
                mostrarHijos: cfg.mostrarHijos !== false,
                mostrarComposicionMixes: Boolean(cfg.mostrarComposicionMixes),
                modoPrecio: cfg.modoPrecio,
                incluirComparativaYAlternativas: cfg.incluirComparativaYAlternativas,
                mostrarPrecioAnterior: cfg.mostrarPrecioAnterior,
                mostrarPorcentajeVariacion: cfg.mostrarPorcentajeVariacion,
                mostrarAlternativasStock: false,
                destacarOfertas: cfg.destacarOfertas,
                bonificacionConfig: {
                    activa: cfg.bonificacionActiva,
                    umbral: 300000,
                    porcentaje: 5
                }
            });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
        } catch (err) {
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = '#fef2f2';
                statusEl.style.borderColor = '#fecaca';
                statusEl.style.color = '#991b1b';
                statusEl.innerHTML = `❌ Error al generar PDF: ${escaparHtml(err.message)}`;
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '📥 Ver / Imprimir PDF Oficial';
            }
        }
    };

    window.enviarPdfBunkerDesdeCrmWa = async function (esPrueba = false) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        window.actualizarConfigModalPdfBunkerWa();
        const cfg = st.configModalPdfBunker || {};
        const articulos = obtenerArticulosSegunAlcanceModalPdfWa(st);
        const statusEl = document.getElementById('crm-pdf-bunker-status');
        const btnTest = document.getElementById('btn-crm-pdf-test');
        const btnReal = document.getElementById('btn-crm-pdf-enviar-real');

        const limpiar = typeof window.limpiarSignosAperturaWa === 'function'
            ? window.limpiarSignosAperturaWa
            : (s => String(s || '').replace(/[¿¡]/g, '').trim());

        const mensajeLimpio = limpiar(document.getElementById('txt-crm-pdf-mensaje')?.value || cfg.mensajeAdjunto || '');
        const telDestino = esPrueba
            ? String(document.getElementById('inp-crm-pdf-tel-prueba')?.value || '5492216615746').replace(/\D/g, '')
            : String(st.telefonoCliente || '').replace(/\D/g, '');

        if (!telDestino) {
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = '#fef2f2';
                statusEl.style.color = '#991b1b';
                statusEl.textContent = '⚠️ El contacto no tiene un número de teléfono válido.';
            }
            return;
        }

        if (btnTest) btnTest.disabled = true;
        if (btnReal) {
            btnReal.disabled = true;
            if (!esPrueba) btnReal.textContent = '⏳ Enviando PDF...';
        }
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = '#eff6ff';
            statusEl.style.borderColor = '#93c5fd';
            statusEl.style.color = '#1e3a8a';
            statusEl.innerHTML = `⏳ Generando y enviando PDF Búnker (${articulos.length} artículos con precios de Lista #${escaparHtml(st.listaId)}) a <strong>${escaparHtml(telDestino)}</strong>...`;
        }

        try {
            const prefijoPrueba = esPrueba ? `🧪 *[PRUEBA INTERNA — Destino real: ${st.nombreCliente}]*\n\n` : '';
            await enviarPdfListaPreciosPorWa({
                listaId: st.listaId,
                telefonoDestino: telDestino,
                mensajeTexto: prefijoPrueba + mensajeLimpio,
                articulosPersonalizados: articulos,
                alcance: cfg.alcance,
                agruparPorJerarquiaB2B: cfg.agruparJerarquiaB2B,
                nivelesAgrupar: cfg.nivelesAgrupar,
                mostrarHijos: cfg.mostrarHijos !== false,
                mostrarComposicionMixes: Boolean(cfg.mostrarComposicionMixes),
                modoPrecio: cfg.modoPrecio,
                incluirComparativaYAlternativas: cfg.incluirComparativaYAlternativas,
                mostrarPrecioAnterior: cfg.mostrarPrecioAnterior,
                mostrarPorcentajeVariacion: cfg.mostrarPorcentajeVariacion,
                mostrarAlternativasStock: false,
                destacarOfertas: cfg.destacarOfertas,
                bonificacionConfig: {
                    activa: cfg.bonificacionActiva,
                    umbral: 300000,
                    porcentaje: 5
                },
                nombreArchivoBase: cfg.alcance === 'ACTUALIZACIONES' ? 'Actualizacion_Precios_LAMDA' : 'Lista_de_Precios_LAMDA'
            });

            if (!esPrueba && cfg.alcance === 'ACTUALIZACIONES') {
                await marcarCambiosPreciosComoNotificadosDesdeCrmWa(st, articulos);
            }

            if (esPrueba) {
                if (statusEl) {
                    statusEl.style.background = '#ecfdf5';
                    statusEl.style.borderColor = '#6ee7b7';
                    statusEl.style.color = '#065f46';
                    statusEl.innerHTML = `✅ <strong>PDF de prueba enviado con éxito a ${escaparHtml(telDestino)}</strong>. Verificalo en tu WhatsApp y cuando quieras tocá <em>"🚀 Enviar PDF Ahora"</em>.`;
                }
            } else {
                Swal.close();
                if (st.chatId && typeof window.seleccionarChatConsola === 'function') {
                    await window.seleccionarChatConsola(st.chatId, true);
                }
                if (typeof cargarListaChatsConsola === 'function') {
                    await cargarListaChatsConsola(true);
                }
            }
        } catch (err) {
            if (statusEl) {
                statusEl.style.background = '#fef2f2';
                statusEl.style.borderColor = '#fecaca';
                statusEl.style.color = '#991b1b';
                statusEl.innerHTML = `❌ Error al enviar PDF: ${escaparHtml(err.message)}`;
            }
        } finally {
            if (btnTest) btnTest.disabled = false;
            if (btnReal) {
                btnReal.disabled = false;
                btnReal.textContent = `🚀 Enviar PDF Ahora a ${st.contactoNombreChat || st.nombreCorto || st.nombreCliente}`;
            }
        }
    };

    /**
     * Envía una prueba real al teléfono de la empresa (5492216615746) sin cerrar el modal.
     */
    window.ejecutarEnvioPruebaAsistenteComercialWa = async function () {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const limpiar = typeof window.limpiarSignosAperturaWa === 'function'
            ? window.limpiarSignosAperturaWa
            : (s => String(s || '').replace(/[¿¡]/g, '').trim());

        const area1 = document.getElementById('wa-asist-com-textarea');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2')?.checked;
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3')?.checked;

        const texto1 = limpiar(area1?.value || '');
        const texto2 = chkB2 ? limpiar(area2?.value || '') : '';
        const texto3 = chkB3 ? limpiar(area3?.value || '') : '';

        const telInput = document.getElementById('wa-asist-com-tel-prueba');
        const telefonoPrueba = String(telInput?.value || '5492216615746').replace(/\D/g, '');
        const chkPdf = document.getElementById('wa-asist-com-chk-pdf')?.checked;
        const chkPdfCc = document.getElementById('wa-asist-com-chk-pdf-cc')?.checked;
        const cuentaIdCc = st.resultadoMesa?.ag3?.cuentaId || st.rayosX?.cuenta_corriente?.cuenta_id || null;
        const statusEl = document.getElementById('wa-asist-com-status');
        const btnTest = document.getElementById('btn-wa-asist-com-test');

        if (!texto1 && !chkPdf && !chkPdfCc) {
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = '#fef2f2';
                statusEl.style.color = '#991b1b';
                statusEl.textContent = '⚠️ Escribí un mensaje o tildá el envío de PDF para probar.';
            }
            return;
        }

        const cantBurbujas = [texto1, texto2, texto3].filter(Boolean).length || 1;
        if (btnTest) {
            btnTest.disabled = true;
            btnTest.textContent = '⏳ Enviando prueba...';
        }
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = '#eff6ff';
            statusEl.style.borderColor = '#93c5fd';
            statusEl.style.color = '#1e3a8a';
            statusEl.innerHTML = `⏳ Enviando prueba en ${cantBurbujas} ${cantBurbujas === 1 ? 'mensaje' : 'mensajes separados'}${chkPdfCc ? ' + PDF Resumen de Cuenta' : ''} al WhatsApp <strong>${escaparHtml(telefonoPrueba)}</strong>...`;
        }

        try {
            const prefijoPrueba = `🧪 *[PRUEBA INTERNA — Destino real: ${st.nombreCliente}]*\n\n`;
            if (chkPdf) {
                const alcPdf = document.getElementById('wa-asist-com-sel-alcance-pdf')?.value || st.alcancePdfAdjunto || 'LISTA_COMPLETA';
                st.alcancePdfAdjunto = alcPdf;
                const cfgPdf = st.configModalPdfBunker || {};
                const esModoActualizaciones = alcPdf === 'ACTUALIZACIONES';
                await enviarPdfListaPreciosPorWa({
                    listaId: st.listaId,
                    telefonoDestino: telefonoPrueba,
                    mensajeTexto: prefijoPrueba + texto1,
                    articulosPersonalizados: obtenerArticulosParaPdfAdjuntoAsistenteWa(st),
                    alcance: alcPdf,
                    agruparPorJerarquiaB2B: cfgPdf.agruparJerarquiaB2B !== undefined ? cfgPdf.agruparJerarquiaB2B : true,
                    nivelesAgrupar: cfgPdf.nivelesAgrupar || ['familia', 'principal'],
                    mostrarHijos: cfgPdf.mostrarHijos !== false,
                    mostrarComposicionMixes: Boolean(cfgPdf.mostrarComposicionMixes),
                    modoPrecio: cfgPdf.modoPrecio || 'kilo_y_bulto',
                    incluirComparativaYAlternativas: cfgPdf.incluirComparativaYAlternativas !== undefined ? cfgPdf.incluirComparativaYAlternativas : esModoActualizaciones,
                    mostrarPrecioAnterior: cfgPdf.mostrarPrecioAnterior !== undefined ? cfgPdf.mostrarPrecioAnterior : esModoActualizaciones,
                    mostrarPorcentajeVariacion: cfgPdf.mostrarPorcentajeVariacion !== undefined ? cfgPdf.mostrarPorcentajeVariacion : esModoActualizaciones,
                    mostrarAlternativasStock: false,
                    destacarOfertas: cfgPdf.destacarOfertas !== undefined ? cfgPdf.destacarOfertas : true,
                    bonificacionConfig: {
                        activa: cfgPdf.bonificacionActiva !== undefined ? cfgPdf.bonificacionActiva : true,
                        umbral: 300000,
                        porcentaje: 5
                    },
                    nombreArchivoBase: alcPdf === 'ACTUALIZACIONES' ? 'Actualizacion_Precios_LAMDA' : 'Lista_de_Precios_LAMDA'
                });
                const extras = [texto2, texto3].filter(Boolean);
                if (extras.length > 0) {
                    await fetch('/api/crm/seguimientos/enviar-prueba-directa', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            telefono_prueba: telefonoPrueba,
                            mensajes: extras
                        })
                    });
                }
            } else if (texto1) {
                const listaMensajes = [prefijoPrueba + texto1];
                if (texto2) listaMensajes.push(texto2);
                if (texto3) listaMensajes.push(texto3);
                const res = await fetch('/api/crm/seguimientos/enviar-prueba-directa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telefono_prueba: telefonoPrueba,
                        mensajes: listaMensajes
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'No se pudo enviar el mensaje de prueba.');
                }
            }

            if (chkPdfCc && cuentaIdCc) {
                const respCc = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaIdCc}/whatsapp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: telefonoPrueba,
                        incluirDetalle: true,
                        mensajeTexto: `Te adjunto el resumen actualizado de tu cuenta corriente en PDF.\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/`
                    })
                });
                const dataCc = await respCc.json();
                if (!respCc.ok || (!dataCc.ok && !dataCc.success)) {
                    throw new Error(dataCc.error || 'No se pudo adjuntar el PDF de Cuenta Corriente en la prueba.');
                }
            }

            if (statusEl) {
                statusEl.style.background = '#ecfdf5';
                statusEl.style.borderColor = '#6ee7b7';
                statusEl.style.color = '#065f46';
                statusEl.innerHTML = `✅ <strong>Prueba enviada con éxito a ${escaparHtml(telefonoPrueba)}</strong> (${cantBurbujas} ${cantBurbujas === 1 ? 'burbuja' : 'burbujas separadas'}). Revisá tu celular y cuando estés conforme tocá <em>"🚀 Enviar Ahora al Cliente"</em>.`;
            }
        } catch (err) {
            if (statusEl) {
                statusEl.style.background = '#fef2f2';
                statusEl.style.borderColor = '#fecaca';
                statusEl.style.color = '#991b1b';
                statusEl.innerHTML = `❌ Error en envío de prueba: ${escaparHtml(err.message)}`;
            }
        } finally {
            if (btnTest) {
                btnTest.disabled = false;
                btnTest.textContent = '🧪 Enviar Prueba';
            }
        }
    };

    window.volcarAsistenteComercialAlBorradorWa = function () {
        const st = estadoAsistenteComercialWa;
        const limpiar = typeof window.limpiarSignosAperturaWa === 'function'
            ? window.limpiarSignosAperturaWa
            : (s => String(s || '').replace(/[¿¡]/g, '').trim());
        const area1 = document.getElementById('wa-asist-com-textarea');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2')?.checked;
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3')?.checked;
        const t1 = limpiar(area1?.value || '');
        const t2 = chkB2 ? limpiar(area2?.value || '') : '';
        const t3 = chkB3 ? limpiar(area3?.value || '') : '';
        const texto = [t1, t2, t3].filter(Boolean).join('\n\n');
        if (!texto) return;

        if (st && st.chatId) {
            guardarBorradorChatWa(st.chatId, texto);
        }
        const inputChat = document.getElementById('wa-hub-input-texto');
        if (inputChat) {
            inputChat.value = texto;
            inputChat.rows = Math.min(7, Math.max(3, texto.split('\n').length));
        }
        Swal.close();
        if (inputChat) inputChat.focus();
    };

    window.programarAsistenteComercialWa = function () {
        const st = estadoAsistenteComercialWa;
        const limpiar = typeof window.limpiarSignosAperturaWa === 'function'
            ? window.limpiarSignosAperturaWa
            : (s => String(s || '').replace(/[¿¡]/g, '').trim());
        const area1 = document.getElementById('wa-asist-com-textarea');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2')?.checked;
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3')?.checked;
        const t1 = limpiar(area1?.value || '');
        const t2 = chkB2 ? limpiar(area2?.value || '') : '';
        const t3 = chkB3 ? limpiar(area3?.value || '') : '';
        const texto = [t1, t2, t3].filter(Boolean).join('\n\n');
        if (!st || !texto) return;

        if (st.chatId) {
            guardarBorradorChatWa(st.chatId, texto);
            const inputChat = document.getElementById('wa-hub-input-texto');
            if (inputChat) inputChat.value = texto;
            Swal.close();
            window.programarMensajeDesdeConsolaWa(st.chatId);
        }
    };

    window.enviarAsistenteComercialAlClienteRealWa = async function (soloBurbuja1 = false) {
        const st = estadoAsistenteComercialWa;
        if (!st) return;
        const limpiar = typeof window.limpiarSignosAperturaWa === 'function'
            ? window.limpiarSignosAperturaWa
            : (s => String(s || '').replace(/[¿¡]/g, '').trim());

        const area1 = document.getElementById('wa-asist-com-textarea');
        const area2 = document.getElementById('wa-asist-com-burbuja2');
        const chkB2 = document.getElementById('wa-asist-com-chk-burbuja2')?.checked;
        const area3 = document.getElementById('wa-asist-com-burbuja3');
        const chkB3 = document.getElementById('wa-asist-com-chk-burbuja3')?.checked;

        const texto1 = limpiar(area1?.value || '');
        const texto2 = chkB2 ? limpiar(area2?.value || '') : '';
        const texto3 = chkB3 ? limpiar(area3?.value || '') : '';
        const enviarSegundaAhora = !soloBurbuja1 && Boolean(texto2);
        const enviarTerceraAhora = !soloBurbuja1 && Boolean(texto3);

        const chkPdf = document.getElementById('wa-asist-com-chk-pdf')?.checked;
        const chkPdfCc = document.getElementById('wa-asist-com-chk-pdf-cc')?.checked;
        const cuentaIdCc = st.resultadoMesa?.ag3?.cuentaId || st.rayosX?.cuenta_corriente?.cuenta_id || null;
        const statusEl = document.getElementById('wa-asist-com-status');
        const btnReal = document.getElementById('btn-wa-asist-com-enviar-real');
        const btnB1 = document.getElementById('btn-wa-asist-com-enviar-b1');

        if (!texto1 && !chkPdf && !chkPdfCc) return;

        if (btnReal) {
            btnReal.disabled = true;
            btnReal.textContent = '⏳ Enviando...';
        }
        if (btnB1) btnB1.disabled = true;

        const enviarTextoUnico = async (msgTxt) => {
            if (st.chatId) {
                const res = await fetch(`/api/crm/whatsapp/chats/${st.chatId}/enviar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mensajeTexto: msgTxt, texto: msgTxt })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    const detalleErr = (Array.isArray(data?.detalles) && data.detalles[0]?.error)
                        ? data.detalles[0].error
                        : (data?.error || 'No se pudo enviar el mensaje.');
                    throw new Error(detalleErr);
                }
            } else {
                const res = await fetch('/api/crm/whatsapp/enviar-directo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telefono: st.telefonoCliente,
                        cliente_bunker_id: st.clienteId || null,
                        nombre_contacto: st.nombreCliente,
                        mensaje: msgTxt
                    })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    const detalleErr = (Array.isArray(data?.detalles) && data.detalles[0]?.error)
                        ? data.detalles[0].error
                        : (data?.error || 'No se pudo enviar el mensaje directo.');
                    throw new Error(detalleErr);
                }
            }
        };

        try {
            const alcPdf = document.getElementById('wa-asist-com-sel-alcance-pdf')?.value || st.alcancePdfAdjunto || 'LISTA_COMPLETA';
            st.alcancePdfAdjunto = alcPdf;
            const cfgPdf = st.configModalPdfBunker || {};
            const esModoActualizaciones = (st.resultadoMesa?.proactivo?.modoResuelto === 'ACTUALIZACIONES_PENDIENTES' || alcPdf === 'ACTUALIZACIONES') && (st.cambiosPreciosPendientes || []).length > 0;
            if (chkPdf) {
                const telDest = String(st.telefonoCliente || '').replace(/\D/g, '');
                if (!telDest) {
                    throw new Error('El cliente no tiene un número de teléfono válido para adjuntar el PDF.');
                }
                await enviarPdfListaPreciosPorWa({
                    listaId: st.listaId,
                    telefonoDestino: telDest,
                    mensajeTexto: texto1,
                    articulosPersonalizados: obtenerArticulosParaPdfAdjuntoAsistenteWa(st),
                    alcance: alcPdf,
                    agruparPorJerarquiaB2B: cfgPdf.agruparJerarquiaB2B !== undefined ? cfgPdf.agruparJerarquiaB2B : true,
                    nivelesAgrupar: cfgPdf.nivelesAgrupar || ['familia', 'principal'],
                    mostrarHijos: cfgPdf.mostrarHijos !== false,
                    mostrarComposicionMixes: Boolean(cfgPdf.mostrarComposicionMixes),
                    modoPrecio: cfgPdf.modoPrecio || 'kilo_y_bulto',
                    incluirComparativaYAlternativas: cfgPdf.incluirComparativaYAlternativas !== undefined ? cfgPdf.incluirComparativaYAlternativas : (alcPdf === 'ACTUALIZACIONES'),
                    mostrarPrecioAnterior: cfgPdf.mostrarPrecioAnterior !== undefined ? cfgPdf.mostrarPrecioAnterior : (alcPdf === 'ACTUALIZACIONES'),
                    mostrarPorcentajeVariacion: cfgPdf.mostrarPorcentajeVariacion !== undefined ? cfgPdf.mostrarPorcentajeVariacion : (alcPdf === 'ACTUALIZACIONES'),
                    mostrarAlternativasStock: false,
                    destacarOfertas: cfgPdf.destacarOfertas !== undefined ? cfgPdf.destacarOfertas : true,
                    bonificacionConfig: {
                        activa: cfgPdf.bonificacionActiva !== undefined ? cfgPdf.bonificacionActiva : true,
                        umbral: 300000,
                        porcentaje: 5
                    },
                    nombreArchivoBase: alcPdf === 'ACTUALIZACIONES' ? 'Actualizacion_Precios_LAMDA' : 'Lista_de_Precios_LAMDA'
                });
            } else if (texto1) {
                await enviarTextoUnico(texto1);
            }

            if (chkPdfCc && cuentaIdCc) {
                const telDestCc = String(st.telefonoCliente || '').replace(/\D/g, '');
                if (!telDestCc) {
                    throw new Error('El cliente no tiene un número de teléfono válido para adjuntar el PDF de Cuenta Corriente.');
                }
                await new Promise(r => setTimeout(r, 900));
                const respCc = await fetch(`/api/logistica/bunker/cuentas-corrientes/${cuentaIdCc}/whatsapp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        destinatarios: telDestCc,
                        incluirDetalle: true,
                        mensajeTexto: `Te adjunto el resumen actualizado de tu cuenta corriente en PDF.\nPortal de pedidos y precios: https://portal-lamda-b2b.idadesarrollo.workers.dev/`
                    })
                });
                const dataCc = await respCc.json();
                if (!respCc.ok || (!dataCc.ok && !dataCc.success)) {
                    throw new Error(dataCc.error || 'Error al adjuntar el PDF de Cuenta Corriente.');
                }
            }

            if (enviarSegundaAhora) {
                await new Promise(r => setTimeout(r, 1200));
                await enviarTextoUnico(texto2);
            }

            if (enviarTerceraAhora) {
                await new Promise(r => setTimeout(r, 1100));
                await enviarTextoUnico(texto3);
            }

            // Si enviamos las actualizaciones pendientes (en texto o en PDF), las marcamos como NOTIFICADO en Gestión de Cambios
            if (esModoActualizaciones && (enviarSegundaAhora || chkPdf)) {
                await marcarCambiosPreciosComoNotificadosDesdeCrmWa(st, st.cambiosPreciosPendientes);
            }

            if (soloBurbuja1 && (texto2 || texto3)) {
                const resto = [texto2, texto3].filter(Boolean).join('\n\n');
                if (st.chatId) guardarBorradorChatWa(st.chatId, resto);
                const inputChat = document.getElementById('wa-hub-input-texto');
                if (inputChat) inputChat.value = resto;
            } else if (st.chatId) {
                limpiarBorradorChatWa(st.chatId);
            }

            Swal.close();

            if (st.chatId && typeof window.seleccionarChatConsola === 'function') {
                await window.seleccionarChatConsola(st.chatId, true);
            }
            if (typeof cargarListaChatsConsola === 'function') {
                await cargarListaChatsConsola(true);
            }
        } catch (err) {
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = '#fef2f2';
                statusEl.style.borderColor = '#fecaca';
                statusEl.style.color = '#991b1b';
                statusEl.innerHTML = `❌ Error al enviar al cliente: ${escaparHtml(err.message)}`;
            }
            if (btnReal) {
                btnReal.disabled = false;
                btnReal.textContent = '🚀 Enviar Ahora al Cliente';
            }
            if (btnB1) btnB1.disabled = false;
        }
    };

})();