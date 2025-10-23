# 🔄 FLUJO: Presupuesto → Factura (Pre-CAE)

## 📊 TABLAS QUE INTERVIENEN

### ORIGEN (Presupuestos)
```
presupuestos
├── id
├── id_cliente
├── fecha
├── total
└── ...

presupuestos_detalles
├── id
├── id_presupuesto
├── articulo (descripción)
├── cantidad
├── precio1 (precio unitario)
├── iva1 (% de IVA: 21, 10.5, 0)
└── ...

clientes
├── cliente_id
├── nombre
├── cuit
├── condicion_iva
└── ...
```

### DESTINO (Facturación)
```
factura_facturas (CABECERA)
├── id
├── presupuesto_id ← LINK
├── cliente_id
├── tipo_cbte (1=A, 6=B)
├── concepto (1=Productos)
