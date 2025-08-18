# Informe de Mixes para PIPA - Resumen de Entrega

## 📋 Descripción del Proyecto

Este directorio contiene el informe profesional generado para el cliente **PIPA (dietética)** con el detalle de composición en porcentajes de todos los productos tipo "mix" (ingredientes compuestos) que elabora **LAMDA**.

## 📁 Archivos Entregables

### Archivos del Informe
- **`informe_mixes_PIPA.md`** - Informe principal en formato Markdown
- **`informe_mixes_PIPA.pdf`** - Informe principal en formato PDF (listo para imprimir)

### Archivos de Código (para mantenimiento)
- **`generador_informe_mixes.js`** - Script principal que genera el informe
- **`convertir_pdf.js`** - Script auxiliar para conversión a PDF
- **`README.md`** - Este archivo de documentación

## 📊 Resultados del Análisis

### Productos Analizados
El informe incluye **11 productos tipo "mix"** encontrados en la base de datos:

1. **Mezcla Barrita** - 8 componentes
2. **Mezcla Grana de Flor** - 7 componentes  
3. **Mezcla Grana de Sol** - 4 componentes
4. **Mix Almafrut** - 6 componentes
5. **Mix BK** - 7 componentes
6. **Mix Color Tropical (MIX)** - 11 componentes
7. **Mix Frutos Secos Con Pasas (Mix)** - 9 componentes
8. **Mix Premium (Mix)** - 5 componentes
9. **Mix Salado (Mix)** - 6 componentes
10. **Mix sin Pasas (Mix)** - 9 componentes
11. **Mix Tropical (Mix)** - 13 componentes

### Estadísticas Generales
- **Total de mixes procesados:** 11
- **Total de componentes únicos:** 30
- **Datos pendientes/asunciones:** 0 (todos los datos están completos)

## ✅ Validaciones Realizadas

### Criterios de Calidad Aplicados
- ✅ Todos los mixes tienen al menos 2 componentes
- ✅ Los porcentajes están redondeados a 2 decimales
- ✅ La suma de porcentajes es exactamente 100.00% para cada mix
- ✅ Se aplicó ajuste automático de residuos de redondeo
- ✅ Se detectaron automáticamente posibles alérgenos

### Información Incluida por Mix
- Nombre comercial del producto
- Código interno (cuando está disponible)
- Descripción del producto (cuando está disponible)
- Tabla de composición porcentual ordenada de mayor a menor
- Detección automática de alérgenos comunes
- Validación de integridad de datos

## 🔍 Metodología de Cálculo

### Fórmula de Porcentajes
```
Porcentaje = (cantidad_componente / receta_base_kg) × 100
```

### Ajuste de Redondeo
- Redondeo inicial a 2 decimales
- Cálculo de diferencia respecto a 100.00%
- Ajuste automático sobre el componente de mayor proporción
- Verificación final de suma exacta

## 🚨 Alérgenos Detectados

El sistema detecta automáticamente los siguientes tipos de alérgenos:
- **Frutos secos:** almendra, nuez, avellana, pistacho, castaña
- **Maní:** maní, cacahuete
- **Gluten:** trigo, avena, cebada, centeno
- **Soja:** soja, soya
- **Lácteos:** leche, queso, yogur
- **Huevo:** huevo, clara, yema
- **Sésamo:** sésamo, ajonjolí

## 🔧 Información Técnica

### Base de Datos
- **Sistema:** PostgreSQL
- **Base de datos:** etiquetas
- **Tablas principales:**
  - `ingredientes` - Catálogo de ingredientes y mixes
  - `ingrediente_composicion` - Composición de cada mix

### Tecnologías Utilizadas
- **Node.js** - Runtime de JavaScript
- **PostgreSQL** - Base de datos
- **Puppeteer** - Generación de PDF
- **Markdown** - Formato de documentación

## 📅 Información de Generación

- **Fecha de generación:** 12 de agosto de 2025, 06:48 p. m.
- **Sistema:** LAMDA
- **Cliente:** PIPA (Dietética)
- **Zona horaria:** America/Argentina/Buenos_Aires

## 🔄 Regeneración del Informe

Para regenerar el informe con datos actualizados:

```bash
# Desde el directorio raíz del proyecto
node reportes/pipa/generador_informe_mixes.js
```

Para generar solo el PDF desde el Markdown existente:

```bash
node reportes/pipa/convertir_pdf.js
```

## 📞 Contacto

Para consultas sobre este informe o modificaciones:
- **Sistema:** LAMDA
- **Módulo:** Producción - Gestión de Mixes
- **Generado automáticamente**

---

*Informe generado automáticamente por el Sistema LAMDA para PIPA (Dietética)*
