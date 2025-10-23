# Plan: Modal Interactivo para Armar Pedido

## Objetivo
Crear un modal interactivo con lector de códigos de barras para verificar físicamente los artículos de un presupuesto antes de marcarlo como "Pedido_Listo".

## Componentes del Modal

### 1. Estructura HTML
```html
<div id="modal-armar-pedido" class="modal-overlay">
    <div class="modal-content modal-armar-grande">
        <div class="modal-header">
            <h3>🔍 Verificar Pedido - Presupuesto [ID]</h3>
            <button class="modal-close" onclick="cerrarModalArmarPedido()">×</button>
        </div>
        
        <div class="modal-body">
            <!-- Campo de escaneo -->
            <div class="scanner-section">
                <label>Escanear Código de Barras:</label>
                <input type="text" id="scanner-input" placeholder="Escanee o ingrese código..." autofocus>
                <div id="scanner-feedback" class="feedback-message"></div>
            </div>
            
            <!-- Progreso -->
            <div class="progress-section">
                <div class="progress-bar">
                    <div id="progress-fill" class="progress-fill"></div>
                </div>
                <p id="progress-text">0 de 0 artículos confirmados</p>
            </div>
            
            <!-- Lista de artículos -->
            <div class="articulos-verificacion">
                <table class="tabla-verificacion">
                    <thead>
                        <tr>
                            <th>Estado</th>
                            <th>Código</th>
                            <th>Descripción</th>
                            <th>Cantidad Pedida</th>
                            <th>Cantidad Confirmada</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="lista-articulos-verificacion">
                        <!-- Filas dinámicas -->
                    </tbody>
                </table>
            </div>
        </div>
        
        <div class="modal-footer">
            <button id="btn-confirmar-pedido" class="btn-confirmar-pedido" disabled>
                ✅ Confirmar Pedido Completo
            </button>
            <button class="btn-cancelar" onclick="cerrarModalArmarPedido()">
                Cancelar
            </button>
        </div>
    </div>
</div>
```

### 2. Lógica JavaScript

#### Estado del Modal
```javascript
let estadoVerificacion = {
    presupuesto_id: null,
    cliente_id: null,
    articulos: [],
    articulosConfirmados: 0,
    totalArticulos: 0
};
```

#### Funciones Principales

**`abrirModalArmarPedido(clienteId, presupuestoId)`**
- Obtiene artículos del presupuesto desde `window.clientesPedidos`
- Inicializa estado de verificación
- Renderiza tabla de artículos
- Enfoca campo de escaneo

**`procesarCodigoEscaneado(codigo)`**
- Busca artículo en la lista por código
- Si encuentra:
  - Marca como confirmado (verde)
  - Incrementa contador
  - Muestra feedback positivo
- Si no encuentra:
  - Muestra error
  - Feedback negativo

**`marcarArticuloConfirmado(articuloNumero, cantidad)`**
- Actualiza estado visual (verde ✅)
- Actualiza cantidad confirmada
- Recalcula progreso
- Habilita/deshabilita botón "Confirmar Pedido"

**`confirmarPedidoCompleto()`**
- Verifica que todos los artículos estén confirmados
- Llama a `actualizarSecuenciaPresupuestos([presupuesto_id], 'Pedido_Listo')`
- Cierra modal
- Recarga vista

### 3. Estilos CSS

```css
.modal-armar-grande {
    max-width: 900px;
    max-height: 90vh;
}

.scanner-section {
    background: #f8f9fa;
    padding: 20px;
    border-radius: 8px;
    margin-bottom: 20px;
}

.scanner-section input {
    width: 100%;
    padding: 15px;
    font-size: 18px;
    border: 2px solid #007bff;
}

.feedback-message {
    margin-top: 10px;
    padding: 10px;
    border-radius: 4px;
    display: none;
}

.feedback-success {
    background: #d4edda;
    color: #155724;
    border: 1px solid #c3e6cb;
}

.feedback-error {
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
}

.progress-section {
    margin-bottom: 20px;
}

.progress-bar {
    width: 100%;
    height: 30px;
    background: #e9ecef;
    border-radius: 15px;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #28a745, #20c997);
    transition: width 0.3s ease;
    width: 0%;
}

.tabla-verificacion {
    width: 100%;
}

.articulo-confirmado {
    background: #d4edda !important;
}

.articulo-pendiente {
    background: #fff3cd !important;
}

.estado-check {
    font-size: 24px;
}

.btn-confirmar-pedido {
    background: #28a745;
    color: white;
    padding: 12px 24px;
    border: none;
    border-radius: 4px;
    font-size: 16px;
    cursor: pointer;
}

.btn-confirmar-pedido:disabled {
    background: #6c757d;
    cursor: not-allowed;
}
```

## Archivos a Modificar

1. **`src/produccion/pages/produccion.html`**
   - Agregar estructura del modal después del modal de asignación

2. **`src/produccion/js/produccion.js`**
   - Agregar funciones del modal de verificación
   - Modificar `renderizarGrupoSecuencia()` para agregar botón "Armar Pedido" en el acordeón correspondiente

3. **`src/produccion/controllers/pedidosPorCliente.js`**
   - Modificar `actualizarSecuenciaPresupuestos()` para aceptar cualquier secuencia válida (ya está hecho)

## Comportamiento Esperado

1. Usuario expande acordeón "📦 Armar Pedido"
2. Ve presupuestos que ya fueron impresos
3. Hace clic en botón "🔍 Verificar Pedido"
4. Se abre modal con lista de artículos
5. Escanea códigos uno por uno
6. Sistema marca cada artículo como confirmado
7. Cuando todos están confirmados, botón se habilita
8. Hace clic en "Confirmar Pedido Completo"
9. Presupuesto se mueve a "✅ Pedido Listo"

¿Procedo con la implementación?
</question>
</ask_followup_question>
