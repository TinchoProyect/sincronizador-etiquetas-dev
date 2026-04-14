/**
 * JS para WebApp Ligera de Tratamientos (Pre Check-in)
 * Diseñado bajo preceptos de asincronía determinista e inmutabilidad de la promesa.
 */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Extraer token (hash) de la URL determinando la sesión
    // La forma estándar esperada será: /pages/tratamiento-checkin.html?hash=ABC...
    const urlParams = new URLSearchParams(window.location.search);
    const sessionHash = urlParams.get('hash');
    
    // Nodos del DOM
    const statusBanner = document.getElementById('statusBanner');
    const form = document.getElementById('checkinForm');
    const btnSubmit = document.getElementById('btnSubmit');
    const spinner = document.getElementById('loadingSpinner');
    const btnText = document.querySelector('.btn-text');
    const successPanel = document.getElementById('successPanel');
    const errorPanel = document.getElementById('errorPanel');
    const errorText = document.getElementById('errorText');

    // Validación temprana de Dominio Seguro
    if (!sessionHash || sessionHash.trim() === '') {
        showFatalError("No se detectó una sesión válida en el código QR. Por favor, solicite al chofer generar uno nuevo.");
        return;
    }

    // Inicializa cargando datos de sesión
    (async function initSession() {
        try {
            const baseUrl = window.PUBLIC_BASE_URL || window.location.origin;
            const res = await fetch(`${baseUrl}/api/logistica/tratamientos/sesion/${sessionHash}`);
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'La orden no existe o ya ha caducado.');
            }

            // Exito: Carga nombre y desbloquea form
            const dName = document.getElementById('nombreClienteText');
            if (dName) dName.textContent = data.data.cliente_nombre;
            
            const clientPanel = document.getElementById('clientInfoPanel');
            if (clientPanel) clientPanel.classList.remove('hidden');

            statusBanner.style.display = 'none';
            form.classList.remove('hidden');

        } catch(error) {
            console.error('[Tratamiento-UI] Falla al validar PWA inicial:', error);
            showFatalError(error.message);
        }
    })();

    form.addEventListener('submit', async (e) => {
        e.preventDefault(); // Evitamos recarga del navegador
        
        // Bloqueo de UI (Inmutabilidad temporal) para prevenir multi-posteos
        btnSubmit.disabled = true;
        btnText.classList.add('hidden');
        spinner.classList.remove('hidden');

        // Captura y Sanitización de Data Empírica
        const descripcionInput = document.getElementById('descripcion').value.trim();
        const kilosRaw = document.getElementById('kilos').value.trim();
        const kilosClean = kilosRaw.replace(',', '.');
        const kilosVal = parseFloat(kilosClean);
        const bultosVal = parseInt(document.getElementById('bultos').value);
        const motivoInput = document.getElementById('motivo').value.trim();

        // Control de fronteras (Bultos y Kilos deterministas)
        if (isNaN(kilosVal) || kilosVal <= 0) {
            triggerWarningToast("Los Kilos deben ser expresados en valores matemáticos superiores a 0.");
            return;
        }

        if (isNaN(bultosVal) || bultosVal < 1) {
            triggerWarningToast("Debe despacharse como mínimo un bulto (1 entero).");
            return;
        }

        const payload = {
            descripcion_externa: descripcionInput,
            kilos: kilosVal,
            bultos: bultosVal,
            motivo: motivoInput
        };

        try {
            // El fallback busca la URL pública si env-config.js fallase
            const baseUrl = window.PUBLIC_BASE_URL || window.location.origin;
            const fullEndpoint = `${baseUrl}/api/logistica/tratamientos/precheckin/${sessionHash}`;

            const networkResponse = await fetch(fullEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            // Resolucion Asíncrona Robusta
            const data = await networkResponse.json();

            if (!networkResponse.ok || !data.success) {
                // Instanciamos el texto del backend o un genérico
                throw new Error(data.error || 'La comunicación con LAMDA ha sido denegada o cortada inesperadamente.');
            }

            // Flujo de éxito
            form.classList.add('hidden');
            successPanel.classList.remove('hidden');
            statusBanner.style.display = 'none';

        } catch (error) {
            console.error('[Tratamiento-UI] Falla Asíncrona:', error);
            
            // Evaluamos si el error amerita cierre destructivo del formulario
            const msgLiteral = error.message.toLowerCase();
            const esErrorFatal = msgLiteral.includes('inválido') || msgLiteral.includes('completada') || msgLiteral.includes('expirado');
            
            if (esErrorFatal) {
                showFatalError(error.message);
            } else {
                triggerWarningToast(error.message);
            }
        }
    });

    /**
     * Levanta un error destructivo inhabilitando la sesión.
     */
    function showFatalError(msg) {
        form.classList.add('hidden');
        errorPanel.classList.remove('hidden');
        errorText.textContent = msg;
        statusBanner.style.display = 'none';
        
        // Ensure inputs are totally disconnected
        btnSubmit.disabled = true;
    }

    /**
     * Muestra un error temporal y rehabilita el bloqueo del botón para reintento.
     */
    function triggerWarningToast(msg) {
        // Aprovechamos status banner como tooltip persistente temporal
        statusBanner.textContent = msg;
        statusBanner.style.color = 'var(--danger-color)';
        statusBanner.style.backgroundColor = '#fef2f2';
        statusBanner.style.borderColor = '#fecaca';
        statusBanner.style.display = 'block';

        // Restaurar estado visual del submit tras 2 segundos de lectura
        setTimeout(() => {
            btnSubmit.disabled = false;
            btnText.classList.remove('hidden');
            spinner.classList.add('hidden');
            statusBanner.style.display = 'none';
        }, 3500);
    }
});
