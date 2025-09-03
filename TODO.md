# TODO - Implementar funcionalidades completas en Editar Presupuesto

## ✅ COMPLETADO
- [x] Estructura HTML básica
- [x] Carga de datos del presupuesto
- [x] Tabla de detalles editable
- [x] Agregar/eliminar filas básicas

## 🔄 EN PROGRESO
- [ ] Autocompletado de clientes
- [ ] Autocompletado de artículos
- [ ] Cálculos automáticos de precios
- [ ] IVA dinámico (Remito-Efectivo)
- [ ] Cálculos de totales
- [ ] Formateo de moneda ARS
- [ ] Nombres de campos correctos
- [ ] Carga de datos de cliente
- [ ] Búsqueda automática de precios
- [ ] Validaciones avanzadas
- [ ] Manejo de formulario completo
- [ ] Mejor manejo de errores

## 📋 DETALLES DE IMPLEMENTACIÓN

### 1. Autocompletado de Clientes
- Implementar búsqueda en tiempo real
- Mostrar sugerencias con formato
- Navegación por teclado (flechas, enter, escape)
- Carga de nombre completo del cliente

### 2. Autocompletado de Artículos
- Búsqueda por código o descripción
- Mostrar stock disponible
- Carga automática de precios desde API
- Etiquetas de artículos

### 3. Cálculos Automáticos
- Precio unitario con IVA
- Subtotal por línea
- Total bruto, descuento, total final
- IVA dinámico para Remito-Efectivo

### 4. Formulario Completo
- Idempotency-Key para evitar duplicados
- Timeout de 60 segundos
- Mejor manejo de errores
- Mensajes en español
- Redirección automática al éxito

### 5. Validaciones
- Campos obligatorios
- Formatos correctos
- Al menos un detalle
- Valores numéricos válidos
