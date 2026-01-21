# Soporte Reembolsos (SAPUI5 / SAP Fiori)

Aplicación SAPUI5/Fiori para **consultar reembolsos** por filtros, **seleccionar registros** en tabla y **generar un PDF descargable** usando **pdfMake** (sin impresión).

---

## ✅ Funcionalidades

- **Búsqueda por filtros**:
  - Sociedad (obligatorio)
  - Rango de fechas (obligatorio)
  - Definición del Proyecto (según reglas por sociedad)
  - Tipo de documento (según reglas por sociedad)
  - Grupo CECO (según reglas por sociedad)

- **Multi-selección (ValueHelp / Input)**
  - Definición del Proyecto (múltiples valores)
  - Tipo de documento (múltiples valores)
  - Grupo CECO (múltiples valores)

- **Listado de reembolsos** en tabla con selección múltiple.
- **Generar PDF**:
  - Se habilita cuando hay al menos un registro seleccionado.
  - Al ejecutar, **consume el servicio de detalle** (Indicador = `"2"`) para los reembolsos seleccionados.
  - Construye `docDefinition` (pdfMake) y realiza `download(nombreArchivo)`.
  - **NO imprime** (sin `window.print`, sin `autoPrint`).

---

## 🧩 Reglas de UI por sociedad (ejemplo)

La UI habilita/oculta filtros dependiendo de la sociedad:

- **4810 / 4811**
  - Muestra: **Definición del Proyecto**, **Tipo de documento**
  - Oculta: **Grupo CECO**

- **4813**
  - Muestra: **Grupo CECO**
  - Oculta: **Definición del Proyecto**, **Tipo de documento**

- Siempre:
  - Requiere **Sociedad** y **Rango de fechas** cuando se permite buscar.

> Estas reglas están centralizadas en un método similar a `_applySociedadRules(...)`.

---

## 🗂️ Estructura del proyecto (referencial)

```
webapp/
  controller/
    Reembolsos.controller.js
  view/
    Reembolsos.view.xml
  i18n/
    i18n.properties
  data/
    sociedades.txt
    tiposdoc.txt
  resources/
    pdfmake/
      pdfmake.js
      vfs_fonts.js
```

> Los paths dependen del `sap.app/id` (namespace) de la app.  
> Ejemplo: `co.com.conconcreto.soportereembolsos` → `co/com/conconcreto/soportereembolsos/...`

---

## ⚙️ Configuración requerida (manifest.json)

### 1) DataSources / Modelos

- **REST Reembolsos**
  - `sap.app/dataSources/restReemb/uri`

- **OData Proyecto**
  - Modelo: `S4ProyectoOData`

- **OData Grupo CECO**
  - Modelo: `S4OData`

Ejemplo (referencial):

```json
{
  "sap.app": {
    "dataSources": {
      "restReemb": {
        "uri": "/path/rest/reembolsos",
        "type": "REST"
      },
      "S4_PROYECTO": {
        "uri": "/sap/opu/odata/sap/YY1_PROYECTO_CDS/",
        "type": "OData",
        "settings": { "odataVersion": "2.0" }
      },
      "S4_GRUPO_CECO": {
        "uri": "/sap/opu/odata/sap/YY1_GRUPOCECO_CDS/",
        "type": "OData",
        "settings": { "odataVersion": "2.0" }
      }
    }
  },
  "sap.ui5": {
    "models": {
      "S4ProyectoOData": {
        "dataSource": "S4_PROYECTO",
        "settings": { "defaultBindingMode": "TwoWay" }
      },
      "S4OData": {
        "dataSource": "S4_GRUPO_CECO",
        "settings": { "defaultBindingMode": "TwoWay" }
      }
    }
  }
}
```

### 2) Librerías UI5

Según vista, se requiere:

- `sap.m`
- `sap.f`
- `sap.ui.layout` (si usas `SimpleForm` u otros layouts)
- `sap.ui.comp` (si usas `VariantManagement`)

Ejemplo (referencial):

```json
{
  "sap.ui5": {
    "dependencies": {
      "libs": {
        "sap.m": {},
        "sap.f": {},
        "sap.ui.layout": {},
        "sap.ui.comp": {}
      }
    }
  }
}
```

---

## ▶️ Ejecución local

### Prerrequisitos
- Node.js LTS
- UI5 Tooling / Fiori Tools (según el proyecto)

### Instalar dependencias
```bash
npm install
```

### Ejecutar
```bash
npm start
```

> En algunos proyectos:
```bash
fiori run --open "test/flp.html#app-preview"
```

---

## 🔎 Flujo de usuario

1. Seleccionar **Sociedad**.
2. Seleccionar **Rango de fechas**.
3. Según sociedad, diligenciar:
   - **Definición del Proyecto** y/o **Tipo de documento**, o
   - **Grupo CECO**
4. Clic en **Buscar** → se carga el listado.
5. Seleccionar uno o varios reembolsos en la tabla.
6. Clic en **Exportar/Generar PDF**:
   - Se consulta el detalle del/los seleccionados.
   - Se genera el PDF con pdfMake.
   - Se descarga el archivo.

---

## 📄 Generación PDF (pdfMake)

### Requisito clave
- Debe usar **descarga**:
  - `pdfMake.createPdf(docDefinition).download(nombreArchivo)`
- Debe **NO imprimir**:
  - No usar `window.print`, `autoPrint`, ni abrir diálogos de impresión.

### Patrón de carga (local)
Se carga pdfMake usando `sap.ui.require` desde:
- `.../resources/pdfmake/pdfmake`
- `.../resources/pdfmake/vfs_fonts`

Y se asigna el VFS:
```js
pdfMake.vfs = vfsFonts.pdfMake ? vfsFonts.pdfMake.vfs : vfsFonts;
```

### docDefinition
La estructura usa:
- `content` con encabezados, bloques, tablas, totales, firmas.
- tablas: `table: { headerRows, widths, body }`
- estilos: `styles` (cabeceras, alineaciones, tamaños).
- (opcional) `footer` con paginación.

> Se conservan formatos (`Intl.NumberFormat`, Formatter/Util) para números y fechas.

---

## 🧰 Multi-filtros (Definición / TipoDoc / Grupo CECO)

### Entrada
- El Input guarda valores separados por coma:
  - Ejemplo: `100012, 100013, 100020`

### Ejecución (OR real)
Para no depender de que el backend soporte listas en un parámetro:
- Se realiza **una consulta por cada valor seleccionado**.
- Se concatenan resultados y se **eliminan duplicados** (por llave funcional, por ejemplo `numeroReembolso + fecha`).

> Recomendación: mantener un límite de seguridad de consultas por búsqueda.

---

## 🧪 Troubleshooting

### 1) El botón PDF queda deshabilitado aunque seleccione filas
- Verifica que el binding del enabled apunte al modelo correcto:
  - Si es modelo default: `{/selectedCount}`
  - Si es modelo named "view": `{view>/selectedCount}`
- Verifica el evento correcto en la tabla:
  - `sap.m.Table`: `selectionChange`
  - `sap.ui.table.Table`: `rowSelectionChange`

### 2) No carga pdfMake local
- Revisa que existan los archivos:
  - `webapp/resources/pdfmake/pdfmake.js`
  - `webapp/resources/pdfmake/vfs_fonts.js`
- Revisa que el path del `sap.ui.require` coincida con el namespace real.

### 3) ValueHelp no permite seleccionar múltiples
- Confirmar que el dialog use:
  - `multiSelect: true`
- En confirm, concatenar selección en el Input:
  - `"A, B, C"`

### 4) No retorna datos al buscar
- Validar `sap.app/dataSources/restReemb/uri`
- Revisar que el servicio reciba los parámetros esperados:
  - `Sociedad`, `Proyecto`, `FechaIni`, `FechaFin`, `Ceco`, `tipodoc`, `Indicador`, `reembolso`, `fecha`

---

## 🧾 Licencia / Autor

Proyecto interno.  
Autor/Equipo: Conconcreto / Soporte Reembolsos.
