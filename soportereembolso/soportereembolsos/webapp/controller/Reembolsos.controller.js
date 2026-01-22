sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/PDFViewer",
    "sap/m/TableSelectDialog",
    "sap/m/Column",
    "sap/m/Label",
    "sap/m/ColumnListItem",
    "sap/m/Text",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (
    Controller, JSONModel, MessageToast, MessageBox, PDFViewer,
    TableSelectDialog, Column, Label, ColumnListItem, Text, Filter, FilterOperator
) {
    "use strict";

    return Controller.extend("co.com.conconcreto.soportereembolsos.controller.Reembolsos", {

        // ======================================================
        // INIT
        // ======================================================
        onInit: function () {
            const oModel = new JSONModel({
                filters: {
                    Sociedad: "",
                    Proyecto: "",
                    FechaIni: "",
                    FechaFin: "",
                    Ceco: "",
                    tipodoc: ""
                },
                ui: {

                    busy: false, sociedadSelected: false,
                    isSociedad4813: false,
                    showProject: false,
                    showTipoDoc: false,
                    showCeco: false,
                    showFechas: false,
                    enableBuscar: false,
                    cecosLoaded: false,
                    proyectosLoaded: false
                },
                proyectos: [],
                sociedades: [],
                tiposDoc: [],
                cecos: [],
                list: [],
                detail: [],
                selectedCount: 0,
                selectedRows: []
            });

            this.getView().setModel(oModel);

            this._pdfViewer = new PDFViewer();
            this.getView().addDependent(this._pdfViewer);
            this._pdfObjectUrl = null;



            this._pdfPendingDetail = null;
            // maestros
            this._loadSociedadesFromText();
            this._loadTiposDocFromText();

            // estado inicial
            this._applySociedadRules("");
        },

        // ======================================================
        // PROYECTO (4810/4811) DESDE ODATA + VALUE HELP
        // ======================================================
        onValueHelpProyecto: async function () {
            try {
                await this._loadProyectosFromOData("");   // carga inicial (sin filtro)
                this._getProyectoVHDialog().open();
            } catch (e) {
                MessageBox.error(this._normalizeError(e));
            }
        },

        _getProyectoVHDialog: function () {
            if (this._projVH) return this._projVH;

            const oDialog = new TableSelectDialog({
                title: "Definición del Proyecto",
                multiSelect: true,
                rememberSelections: true,
                growing: true,
                growingThreshold: 30,
                search: this.onProyectoVHSearch.bind(this),
                confirm: this.onProyectoVHConfirm.bind(this),
                cancel: this.onProyectoVHCancel.bind(this)
            });

            oDialog.addColumn(new Column({ header: new Label({ text: "Proyecto" }) }));
            oDialog.addColumn(new Column({ header: new Label({ text: "Descripción" }) }));

            oDialog.bindAggregation("items", {
                path: "/proyectos",
                template: new ColumnListItem({
                    cells: [
                        new Text({ text: "{Project}" }),
                        new Text({ text: "{ProjectDescription}" })
                    ]
                })
            });

            this.getView().addDependent(oDialog);
            this._projVH = oDialog;
            return oDialog;
        },

        onProyectoVHSearch: async function (oEvent) {
            const sValue = (oEvent.getParameter("value") || "").trim();

            // si el usuario borra el texto, vuelve a cargar lista base
            try {
                oEvent.getSource().setBusy(true);
                await this._loadProyectosFromOData(sValue);
            } catch (e) {
                MessageToast.show("No se pudo consultar proyectos.");
            } finally {
                oEvent.getSource().setBusy(false);
            }
        },



        onProyectoVHConfirm: function (oEvent) {
            const aItems = oEvent.getParameter("selectedItems") || [];
            const oSingle = oEvent.getParameter("selectedItem");

            const aAll = aItems.length ? aItems : (oSingle ? [oSingle] : []);
            if (!aAll.length) return;

            const aProjects = aAll
                .map(function (it) {
                    const oObj = it.getBindingContext() && it.getBindingContext().getObject();
                    return (oObj && oObj.Project) ? String(oObj.Project).trim() : "";
                })
                .filter(Boolean);

            const sValue = aProjects.join(", ");
            this.getView().getModel().setProperty("/filters/Proyecto", sValue);

            this.onProyectoVHCancel();
        },

        onProyectoVHCancel: function () {
            if (this._projVH) {
                const oBinding = this._projVH.getBinding("items");
                if (oBinding) oBinding.filter([]);
            }
        },

        _getProyectoODataModel: function () {
            const oComp = this.getOwnerComponent && this.getOwnerComponent();

            const oModel = oComp && oComp.getModel && oComp.getModel("S4ProyectoOData");
            if (oModel && typeof oModel.read === "function") return oModel;

            const oViewModel = this.getView().getModel("S4ProyectoOData");
            if (oViewModel && typeof oViewModel.read === "function") return oViewModel;

            throw new Error("No se encontró el modelo OData V2 'S4ProyectoOData' definido en el manifest (S4_PROYECTO).");
        },

        _loadProyectosFromOData: function (sSearch) {
            const oModel = this.getView().getModel();
            const bLoaded = !!oModel.getProperty("/ui/proyectosLoaded");
            const sVal = (sSearch || "").trim();

            // Si no hay búsqueda y ya cargó una vez, no vuelvas a pedir
            if (!sVal && bLoaded && (oModel.getProperty("/proyectos") || []).length) {
                return Promise.resolve();
            }

            const oOData = this._getProyectoODataModel();
            const sPath = "/YY1_AyudaBusqProyecto";

            // filtros server-side (Project o Description)
            const aFilters = [];
            if (sVal) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("Project", FilterOperator.Contains, sVal),
                        new Filter("ProjectDescription", FilterOperator.Contains, sVal)
                    ],
                    and: false
                }));
            }

            return new Promise((resolve, reject) => {
                oOData.read(sPath, {
                    filters: aFilters,
                    urlParameters: {
                        "$select": "ProjectInternalID,Project,ProjectDescription",
                        "$top": "200"
                    },
                    success: (oData) => {
                        const aRaw = (oData && oData.results) ? oData.results : [];
                        const aDedup = this._dedupProyectos(aRaw);

                        oModel.setProperty("/proyectos", aDedup);

                        // solo marca loaded cuando es carga “base” (sin búsqueda)
                        if (!sVal) oModel.setProperty("/ui/proyectosLoaded", true);

                        resolve();
                    },
                    error: (oErr) => reject(oErr)
                });
            });
        },

        _dedupProyectos: function (aItems) {
            const m = new Map();

            (aItems || []).forEach((o) => {
                const key = (o.Project || "").trim();
                if (!key) return;

                const prev = m.get(key);
                if (!prev) {
                    m.set(key, o);
                    return;
                }

                // si el previo no tenía descripción y este sí, reemplaza
                const prevDesc = (prev.ProjectDescription || "").trim();
                const desc = (o.ProjectDescription || "").trim();
                if (!prevDesc && desc) m.set(key, o);
            });

            return Array.from(m.values()).sort((a, b) =>
                (a.Project || "").localeCompare(b.Project || "")
            );
        },


        // ======================================================
        // HELPER: leer URI desde manifest dataSources
        // ======================================================
        _getRestUrl: function (sDataSourceId) {
            return this.getOwnerComponent().getManifestEntry(
                "/sap.app/dataSources/" + sDataSourceId + "/uri"
            );
        },

        // ======================================================
        // REGLAS UI POR SOCIEDAD
        // ======================================================
        _applySociedadRules: function (sSoc) {
            const oModel = this.getView().getModel();

            const isSelected = !!(sSoc && String(sSoc).trim());
            const soc = (sSoc || "").trim();

            const is4810_4811 = (soc === "4810" || soc === "4811");
            const is4813 = (soc === "4813");

            oModel.setProperty("/ui/sociedadSelected", isSelected);
            oModel.setProperty("/ui/isSociedad4813", is4813);
            oModel.setProperty("/ui/showFechas", isSelected);

            oModel.setProperty("/ui/showProject", isSelected && is4810_4811);
            oModel.setProperty("/ui/showTipoDoc", isSelected && is4810_4811);

            oModel.setProperty("/ui/showCeco", isSelected && is4813);

            oModel.setProperty("/ui/enableBuscar", isSelected);

            // limpiar campos que NO aplican
            const f = Object.assign({}, oModel.getProperty("/filters"));

            if (!isSelected) {
                f.Proyecto = "";
                f.tipodoc = "";
                f.Ceco = "";
                f.FechaIni = "";
                f.FechaFin = "";
            } else if (is4810_4811) {
                f.Ceco = "";
            } else if (is4813) {
                f.Proyecto = "";
                f.tipodoc = "";
            } else {
                f.Proyecto = "";
                f.tipodoc = "";
                f.Ceco = "";
            }

            oModel.setProperty("/filters", f);

            // limpiar resultados cuando cambia sociedad
            oModel.setProperty("/list", []);
            oModel.setProperty("/detail", []);
            oModel.setProperty("/selectedCount", 0);



            oModel.setProperty("/selectedRows", []);
            this._pdfPendingDetail = null;

            const oTable = this.byId("tblLista");
            if (oTable) {
                oTable.removeSelections(true);
            }
        },

        // ======================================================
        // SOCIEDADES DESDE TEXTO + VALUE HELP
        // ======================================================
        _loadSociedadesFromText: async function () {
            try {
                const sUrl = sap.ui.require.toUrl("co/com/conconcreto/soportereembolsos/data/sociedades.txt");
                const res = await fetch(sUrl, { cache: "no-store" });
                if (!res.ok) throw new Error(`No se pudo leer sociedades.txt (HTTP ${res.status})`);

                const sText = await res.text();
                const aSoc = this._parsePipeText(sText, "CompanyCode", "CompanyCodeName");
                this.getView().getModel().setProperty("/sociedades", aSoc);
            } catch (e) {
                MessageToast.show("No se pudo cargar la lista de sociedades (sociedades.txt).");
            }
        },

        onValueHelpSociedad: function () {
            this._getSociedadVHDialog().open();
        },

        _getSociedadVHDialog: function () {
            if (this._socVH) return this._socVH;

            const oDialog = new TableSelectDialog({
                title: "Sociedades",
                growing: true,
                growingThreshold: 20,
                search: this.onSociedadVHSearch.bind(this),
                confirm: this.onSociedadVHConfirm.bind(this),
                cancel: this.onSociedadVHCancel.bind(this)
            });

            oDialog.addColumn(new Column({ header: new Label({ text: "CompanyCode" }) }));
            oDialog.addColumn(new Column({ header: new Label({ text: "CompanyCodeName" }) }));

            oDialog.bindAggregation("items", {
                path: "/sociedades",
                template: new ColumnListItem({
                    cells: [
                        new Text({ text: "{CompanyCode}" }),
                        new Text({ text: "{CompanyCodeName}" })
                    ]
                })
            });

            this.getView().addDependent(oDialog);
            this._socVH = oDialog;
            return oDialog;
        },

        onSociedadVHSearch: function (oEvent) {
            const sValue = (oEvent.getParameter("value") || "").trim();
            const oBinding = oEvent.getSource().getBinding("items");
            if (!oBinding) return;

            if (!sValue) {
                oBinding.filter([]);
                return;
            }

            const aFilters = [
                new Filter("CompanyCode", FilterOperator.Contains, sValue),
                new Filter("CompanyCodeName", FilterOperator.Contains, sValue)
            ];
            oBinding.filter([new Filter({ filters: aFilters, and: false })]);
        },

        onSociedadVHConfirm: function (oEvent) {
            const oItem = oEvent.getParameter("selectedItem");
            if (!oItem) return;

            const oObj = oItem.getBindingContext().getObject();
            const sSoc = (oObj && oObj.CompanyCode) ? String(oObj.CompanyCode) : "";

            const oModel = this.getView().getModel();
            oModel.setProperty("/filters/Sociedad", sSoc);

            this._applySociedadRules(sSoc);
        },

        onSociedadVHCancel: function () {
            if (this._socVH) {
                const oBinding = this._socVH.getBinding("items");
                if (oBinding) oBinding.filter([]);
            }
        },

        // ======================================================
        // TIPO DOC DESDE TEXTO + VALUE HELP
        // ======================================================
        _loadTiposDocFromText: async function () {
            try {
                const sUrl = sap.ui.require.toUrl("co/com/conconcreto/soportereembolsos/data/tiposdoc.txt");
                const res = await fetch(sUrl, { cache: "no-store" });
                if (!res.ok) throw new Error(`No se pudo leer tiposdoc.txt (HTTP ${res.status})`);

                const sText = await res.text();
                const aTipos = this._parsePipeText(sText, "Code", "Text");
                this.getView().getModel().setProperty("/tiposDoc", aTipos);
            } catch (e) {
                this.getView().getModel().setProperty("/tiposDoc", [
                    { Code: "R", Text: "Reembolso" },
                    { Code: "H", Text: "Honorario" }
                ]);
            }
        },

        onValueHelpTipoDoc: function () {
            this._getTipoDocVHDialog().open();
        },

        _getTipoDocVHDialog: function () {
            if (this._tipoDocVH) return this._tipoDocVH;

            const oDialog = new TableSelectDialog({
                title: "Tipo de documento",
                multiSelect: true,
                rememberSelections: true,
                growing: true,
                growingThreshold: 10,
                search: this.onTipoDocVHSearch.bind(this),
                confirm: this.onTipoDocVHConfirm.bind(this),
                cancel: this.onTipoDocVHCancel.bind(this)
            });

            oDialog.addColumn(new Column({ header: new Label({ text: "Código" }) }));
            oDialog.addColumn(new Column({ header: new Label({ text: "Descripción" }) }));

            oDialog.bindAggregation("items", {
                path: "/tiposDoc",
                template: new ColumnListItem({
                    cells: [
                        new Text({ text: "{Code}" }),
                        new Text({ text: "{Text}" })
                    ]
                })
            });

            this.getView().addDependent(oDialog);
            this._tipoDocVH = oDialog;
            return oDialog;
        },

        onTipoDocVHSearch: function (oEvent) {
            const sValue = (oEvent.getParameter("value") || "").trim();
            const oBinding = oEvent.getSource().getBinding("items");
            if (!oBinding) return;

            if (!sValue) {
                oBinding.filter([]);
                return;
            }

            const aFilters = [
                new Filter("Code", FilterOperator.Contains, sValue),
                new Filter("Text", FilterOperator.Contains, sValue)
            ];
            oBinding.filter([new Filter({ filters: aFilters, and: false })]);
        },



        onTipoDocVHConfirm: function (oEvent) {
            const aItems = oEvent.getParameter("selectedItems") || [];
            const oSingle = oEvent.getParameter("selectedItem");

            const aAll = aItems.length ? aItems : (oSingle ? [oSingle] : []);
            if (!aAll.length) return;

            const aCodes = aAll
                .map(function (it) {
                    const oObj = it.getBindingContext() && it.getBindingContext().getObject();
                    return (oObj && oObj.Code) ? String(oObj.Code).trim() : "";
                })
                .filter(Boolean);

            const sValue = aCodes.join(", ");
            this.getView().getModel().setProperty("/filters/tipodoc", sValue);

            this.onTipoDocVHCancel();
        },

        onTipoDocVHCancel: function () {
            if (this._tipoDocVH) {
                const oBinding = this._tipoDocVH.getBinding("items");
                if (oBinding) oBinding.filter([]);
            }
        },

        // ======================================================
        // CECO (4813) DESDE ODATA + VALUE HELP (SIN DUPLICADOS)
        // ======================================================
        onValueHelpCeco: async function () {
            try {
                await this._loadCecosFromOData();
                this._getCecoVHDialog().open();
            } catch (e) {
                MessageBox.error(this._normalizeError(e));
            }
        },

        _getCecoVHDialog: function () {
            if (this._cecoVH) return this._cecoVH;

            const oDialog = new TableSelectDialog({
                title: "Grupo CECO",
                multiSelect: true,
                rememberSelections: true,
                growing: true,
                growingThreshold: 30,
                search: this.onCecoVHSearch.bind(this),
                confirm: this.onCecoVHConfirm.bind(this),
                cancel: this.onCecoVHCancel.bind(this)
            });

            oDialog.addColumn(new Column({ header: new Label({ text: "Grupo" }) }));
            oDialog.addColumn(new Column({ header: new Label({ text: "Nombre" }) }));

            oDialog.bindAggregation("items", {
                path: "/cecos",
                template: new ColumnListItem({
                    cells: [
                        new Text({ text: "{GroupCostCenter}" }),
                        new Text({ text: "{NombreGrupoCeco}" })
                    ]
                })
            });

            this.getView().addDependent(oDialog);
            this._cecoVH = oDialog;
            return oDialog;
        },

        onCecoVHSearch: function (oEvent) {
            const sValue = (oEvent.getParameter("value") || "").trim();
            const oBinding = oEvent.getSource().getBinding("items");
            if (!oBinding) return;

            if (!sValue) {
                oBinding.filter([]);
                return;
            }

            const aFilters = [
                new Filter("GroupCostCenter", FilterOperator.Contains, sValue),
                new Filter("NombreGrupoCeco", FilterOperator.Contains, sValue)
            ];
            oBinding.filter([new Filter({ filters: aFilters, and: false })]);
        },



        onCecoVHConfirm: function (oEvent) {
            const aItems = oEvent.getParameter("selectedItems") || [];
            const oSingle = oEvent.getParameter("selectedItem");

            const aAll = aItems.length ? aItems : (oSingle ? [oSingle] : []);
            if (!aAll.length) return;

            const aCodes = aAll
                .map(function (it) {
                    const oObj = it.getBindingContext() && it.getBindingContext().getObject();
                    return (oObj && oObj.GroupCostCenter) ? String(oObj.GroupCostCenter).trim() : "";
                })
                .filter(Boolean);

            const sValue = aCodes.join(", ");
            this.getView().getModel().setProperty("/filters/Ceco", sValue);

            this.onCecoVHCancel();
        },

        onCecoVHCancel: function () {
            if (this._cecoVH) {
                const oBinding = this._cecoVH.getBinding("items");
                if (oBinding) oBinding.filter([]);
            }
        },

        _getGrupoCecoODataModel: function () {
            const oComp = this.getOwnerComponent && this.getOwnerComponent();

            const oModel = oComp && oComp.getModel && oComp.getModel("S4OData");
            if (oModel && typeof oModel.read === "function") return oModel;

            const oViewModel = this.getView().getModel("S4OData");
            if (oViewModel && typeof oViewModel.read === "function") return oViewModel;

            throw new Error("No se encontró el modelo OData V2 'S4OData' definido en el manifest (S4_GRUPO_CECO).");
        },

        _loadCecosFromOData: function () {
            const oModel = this.getView().getModel();
            const bLoaded = !!oModel.getProperty("/ui/cecosLoaded");
            if (bLoaded && (oModel.getProperty("/cecos") || []).length) {
                return Promise.resolve();
            }

            const oOData = this._getGrupoCecoODataModel();
            const sPath = "/YY1_GrupoCentroCosteOXA";

            return new Promise((resolve, reject) => {
                oOData.read(sPath, {
                    urlParameters: {
                        "$select": "SAP_UUID,GroupCostCenter,NombreGrupoCeco"
                    },
                    success: (oData) => {
                        const aRaw = (oData && oData.results) ? oData.results : [];
                        const aDedup = this._dedupCecos(aRaw);

                        oModel.setProperty("/cecos", aDedup);
                        oModel.setProperty("/ui/cecosLoaded", true);
                        resolve();
                    },
                    error: (oErr) => reject(oErr)
                });
            });
        },

        _dedupCecos: function (aItems) {
            const m = new Map();

            (aItems || []).forEach((o) => {
                const code = (o.GroupCostCenter || "").trim();
                if (!code) return;

                const name = (o.NombreGrupoCeco || "").trim();
                const prev = m.get(code);

                if (!prev) {
                    m.set(code, o);
                    return;
                }

                const prevName = (prev.NombreGrupoCeco || "").trim();
                if (!prevName && name) {
                    m.set(code, o);
                }
            });

            return Array.from(m.values()).sort((a, b) =>
                (a.GroupCostCenter || "").localeCompare(b.GroupCostCenter || "")
            );
        },

        // ======================================================
        // PARSER TEXTO "A|B"
        // ======================================================
        _parsePipeText: function (sText, keyA, keyB) {
            const lines = String(sText || "")
                .split(/\r?\n/)
                .map(l => l.trim())
                .filter(l => l && !l.startsWith("#"));

            const out = [];
            for (const line of lines) {
                let code = "";
                let name = "";

                if (line.includes("|")) {
                    const i = line.indexOf("|");
                    code = line.substring(0, i).trim();
                    name = line.substring(i + 1).trim();
                } else if (line.includes(";")) {
                    const i = line.indexOf(";");
                    code = line.substring(0, i).trim();
                    name = line.substring(i + 1).trim();
                } else if (line.includes(",")) {
                    const i = line.indexOf(",");
                    code = line.substring(0, i).trim();
                    name = line.substring(i + 1).trim();
                } else if (line.includes("\t")) {
                    const i = line.indexOf("\t");
                    code = line.substring(0, i).trim();
                    name = line.substring(i + 1).trim();
                } else {
                    const parts = line.split(/\s+/).filter(Boolean);
                    code = parts[0] || "";
                    name = parts.slice(1).join(" ");
                }

                if (code && name) {
                    const o = {};
                    o[keyA] = code;
                    o[keyB] = name;
                    out.push(o);
                }
            }
            return out;
        },


        // ======================================================
        // MULTI-VALUES (Input permite "A, B, C")
        // ======================================================
        _parseMultiValues: function (v) {
            const s = String(v || "").trim();
            if (!s) return [];

            // admite coma, punto y coma o saltos de línea
            const parts = s.split(/[,;\r\n]+/).map(function (p) { return String(p || "").trim(); }).filter(Boolean);

            const out = [];
            const seen = new Set();
            parts.forEach(function (p) {
                if (!seen.has(p)) {
                    seen.add(p);
                    out.push(p);
                }
            });

            return out;
        },

        _dedupListRows: function (aRows) {
            const m = new Map();

            (aRows || []).forEach(function (r) {
                const nro = (r && (r.numeroReembolso || r.reembolso || "")) ? String(r.numeroReembolso || r.reembolso) : "";
                const fecha = (r && (r.accountingdocumentcreationdate || r.fecha || "")) ? String(r.accountingdocumentcreationdate || r.fecha) : "";
                const extra = (r && (r.__ProyectoUsed || r.__CecoUsed || "")) ? String(r.__ProyectoUsed || r.__CecoUsed) : "";

                const key = [nro, fecha, extra].join("|") || JSON.stringify(r);
                if (!m.has(key)) m.set(key, r);
            });

            return Array.from(m.values());
        },

        // ======================================================
        // EVENTS APP
        // ======================================================
        onSelectionChange: function () {
            const oTable = this.byId("tblLista");
            const aSelectedItems = oTable ? (oTable.getSelectedItems() || []) : [];

            const aSelectedRows = aSelectedItems
                .map(function (oItem) {
                    const oCtx = oItem.getBindingContext();
                    return oCtx ? oCtx.getObject() : null;
                })
                .filter(Boolean);

            const oModel = this.getView().getModel();
            oModel.setProperty("/selectedCount", aSelectedRows.length);
            oModel.setProperty("/selectedRows", aSelectedRows);

            // si cambia selección, invalida el detalle cacheado para PDF
            this._pdfPendingDetail = null;
        },

        onLimpiar: function () {
            const oModel = this.getView().getModel();

            oModel.setProperty("/filters", {
                Sociedad: "",
                Proyecto: "",
                FechaIni: "",
                FechaFin: "",
                Ceco: "",
                tipodoc: ""
            });

            oModel.setProperty("/list", []);
            oModel.setProperty("/detail", []);
            oModel.setProperty("/selectedCount", 0);



            oModel.setProperty("/selectedRows", []);
            this._pdfPendingDetail = null;

            const oTable = this.byId("tblLista");
            if (oTable) oTable.removeSelections(true);

            const oDRS = this.byId("drsFechas");
            if (oDRS) {
                oDRS.setDateValue(null);
                oDRS.setSecondDateValue(null);
            }

            this._revokePdfUrl();
            this._applySociedadRules("");
        },
        onBuscar: async function () {
            const oModel = this.getView().getModel();
            const f = oModel.getProperty("/filters");

            const sSoc = (f.Sociedad || "").trim();
            const is4810_4811 = (sSoc === "4810" || sSoc === "4811");
            const is4813 = (sSoc === "4813");

            oModel.setProperty("/ui/isSociedad4813", is4813);
            oModel.setProperty("/ui/sociedadSelected", !!sSoc);

            if (!sSoc) return MessageBox.warning("Debe seleccionar Sociedad.");
            if (!f.FechaIni || !f.FechaFin) return MessageBox.warning("Debe diligenciar Fecha Ejecución (Inicio y Fin).");

            // ✅ Multi-valores permitidos en: Proyecto / TipoDoc / Ceco
            const aProyectos = is4810_4811 ? this._parseMultiValues(f.Proyecto) : [];
            const aTipoDocsRaw = is4810_4811 ? this._parseMultiValues(f.tipodoc) : [];
            const aTipoDocs = aTipoDocsRaw.length ? aTipoDocsRaw : [""]; // TipoDoc es opcional
            const aCecos = is4813 ? this._parseMultiValues(f.Ceco) : [];

            if (is4810_4811) {
                if (!aProyectos.length) return MessageBox.warning("Para 4810/4811 debe diligenciar Definición del Proyecto (uno o varios).");
            } else if (is4813) {
                if (!aCecos.length) return MessageBox.warning("Para 4813 debe diligenciar Grupo CECO (uno o varios).");
            } else {
                return MessageBox.warning("La sociedad seleccionada no tiene reglas configuradas en la app.");
            }

            // Construye requests (OR por cada valor seleccionado)
            const aReqs = [];

            if (is4810_4811) {
                aProyectos.forEach(function (sProj) {
                    (aTipoDocs || [""]).forEach(function (sTipo) {
                        aReqs.push({
                            params: {
                                Sociedad: sSoc,
                                Proyecto: sProj,
                                FechaIni: f.FechaIni,
                                FechaFin: f.FechaFin,
                                Indicador: "",
                                Ceco: "",
                                reembolso: "",
                                fecha: "",
                                tipodoc: sTipo || ""
                            },
                            meta: { Proyecto: sProj, tipodoc: sTipo || "", Ceco: "" }
                        });
                    });
                });
            } else if (is4813) {
                aCecos.forEach(function (sCeco) {
                    aReqs.push({
                        params: {
                            Sociedad: sSoc,
                            Proyecto: "",
                            FechaIni: f.FechaIni,
                            FechaFin: f.FechaFin,
                            Indicador: "",
                            Ceco: sCeco,
                            reembolso: "",
                            fecha: "",
                            tipodoc: ""
                        },
                        meta: { Proyecto: "", tipodoc: "", Ceco: sCeco }
                    });
                });
            }

            // Evita explosión de requests si seleccionan demasiados valores
            if (aReqs.length > 50) {
                return MessageBox.warning("Seleccionaste demasiados valores para filtrar (se generarían " + aReqs.length + " consultas). Reduce la selección e intenta nuevamente.");
            }

            this._setBusy(true);
            try {
                const aChunks = await Promise.all(aReqs.map(async function (oReq) {
                    const aData = await this._callService(oReq.params);
                    const aArr = Array.isArray(aData) ? aData : [];

                    return aArr.map(function (r) {
                        return Object.assign({}, r, {
                            __ProyectoUsed: oReq.meta.Proyecto,
                            __TipoDocUsed: oReq.meta.tipodoc,
                            __CecoUsed: oReq.meta.Ceco
                        });
                    });
                }.bind(this)));

                const aFlat = []
                    .concat.apply([], aChunks)
                    .filter(Boolean);

                const aList = this._dedupListRows(aFlat);

                oModel.setProperty("/list", aList);
                oModel.setProperty("/detail", []);
                oModel.setProperty("/selectedCount", 0);

                oModel.setProperty("/selectedRows", []);
                this._pdfPendingDetail = null;

                const oTable = this.byId("tblLista");
                if (oTable) oTable.removeSelections(true);

                MessageToast.show("Reembolsos encontrados: " + (aList || []).length);
            } catch (e) {
                MessageBox.error(this._normalizeError(e));
            } finally {
                this._setBusy(false);
            }
        },
        onCargarDetalle: async function () {
            const oModel = this.getView().getModel();
            const f = oModel.getProperty("/filters");
            const sSoc = (f.Sociedad || "").trim();

            const is4810_4811 = (sSoc === "4810" || sSoc === "4811");
            const is4813 = (sSoc === "4813");

            const oTable = this.byId("tblLista");
            if (!oTable) return;

            const aSelectedItems = oTable.getSelectedItems();
            if (!aSelectedItems.length) return MessageBox.information("Seleccione al menos un reembolso.");

            this._setBusy(true);
            try {
                const aPromises = aSelectedItems.map((oItem) => {
                    const oRow = oItem.getBindingContext().getObject();
                    const sReembolso = oRow && oRow.numeroReembolso ? String(oRow.numeroReembolso) : "";
                    const sFechaISO = oRow && oRow.accountingdocumentcreationdate ? String(oRow.accountingdocumentcreationdate) : "";
                    const sFecha = this._toYYYYMMDD(sFechaISO);

                    return this._callService({
                        Sociedad: sSoc,
                        Proyecto: is4810_4811 ? (f.Proyecto || oRow.project || "") : "",
                        FechaIni: f.FechaIni,
                        FechaFin: f.FechaFin,
                        Indicador: "2",
                        Ceco: is4813 ? (f.Ceco || "") : "",
                        reembolso: sReembolso,
                        fecha: sFecha,
                        tipodoc: is4810_4811 ? (f.tipodoc || "") : ""
                    });
                });

                const aResponses = await Promise.all(aPromises);
                const aDetail = aResponses
                    .filter(Array.isArray)
                    .reduce((acc, arr) => acc.concat(arr), []);

                oModel.setProperty("/detail", aDetail);
                MessageToast.show(`Detalle cargado: ${aDetail.length} registros`);
            } catch (e) {
                MessageBox.error(this._normalizeError(e));
            } finally {
                this._setBusy(false);
            }
        },

        // ======================================================
        // PDF (✅ pdfMake download)
        // ======================================================
        onImprimirPdf: async function () {
            const oModel = this.getView().getModel();
            const f = oModel.getProperty("/filters") || {};
            const sSoc = (f.Sociedad || "").trim();

            const oTable = this.byId("tblLista");
            if (!oTable) return;

            const aSelectedItems = oTable.getSelectedItems();
            if (!aSelectedItems.length) {
                MessageBox.information("Seleccione al menos un reembolso para generar el PDF.");
                return;
            }

            // 1) Cargar detalle desde el servicio (Indicador=2) según reembolsos seleccionados
            let aDetail = Array.isArray(this._pdfPendingDetail) ? this._pdfPendingDetail : [];

            if (!aDetail.length) {
                this._setBusy(true);
                try {
                    aDetail = await this._loadDetalleFromSelectedItems(aSelectedItems);
                    oModel.setProperty("/detail", aDetail);
                    this._pdfPendingDetail = aDetail;
                } catch (e) {
                    MessageBox.error(this._normalizeError(e));
                    return;
                } finally {
                    this._setBusy(false);
                }
            }

            if (!aDetail.length) {
                MessageBox.information("No se obtuvo detalle para los reembolsos seleccionados.");
                return;
            }

            // 2) Generar PDF (✅ pdfMake download) usando el mismo patrón del controller ejemplo
            if (window.pdfMake) {
                this._generatePDFWithData(window.pdfMake, aDetail);
                this._pdfPendingDetail = null;
                return;
            }

            sap.ui.require([
                "co/com/conconcreto/soportereembolsos/resources/pdfmake/pdfmake",
                "co/com/conconcreto/soportereembolsos/resources/pdfmake/vfs_fonts"
            ], function (pdfMake, vfsFonts) {
                try {
                    if (!pdfMake || !pdfMake.createPdf) {
                        throw new Error("pdfmake no se cargó correctamente");
                    }

                    // patrón exacto del ejemplo (asignación de vfs)
                    pdfMake.vfs = vfsFonts.pdfMake ? vfsFonts.pdfMake.vfs : vfsFonts;
                    window.pdfMake = pdfMake;

                    this._generatePDFWithData(pdfMake, aDetail);
                    this._pdfPendingDetail = null;
                } catch (error) {
                    console.error("Error con pdfmake local:", error);
                    this._loadPDFMakeFromCDN();
                }
            }.bind(this), function (oError) {
                console.error("Error cargando recursos locales:", oError);
                this._loadPDFMakeFromCDN();
            }.bind(this));
        },



        _loadDetalleFromSelectedItems: async function (aSelectedItems) {
            const oModel = this.getView().getModel();
            const f = oModel.getProperty("/filters");
            const sSoc = (f.Sociedad || "").trim();

            const is4810_4811 = (sSoc === "4810" || sSoc === "4811");
            const is4813 = (sSoc === "4813");

            const aProyFilter = this._parseMultiValues(f.Proyecto);
            const aTipoFilter = this._parseMultiValues(f.tipodoc);
            const aCecoFilter = this._parseMultiValues(f.Ceco);

            const aPromises = (aSelectedItems || []).map(function (oItem) {
                const oRow = oItem.getBindingContext().getObject();

                const sReembolso = oRow && oRow.numeroReembolso ? String(oRow.numeroReembolso) : "";
                const sFechaISO = oRow && oRow.accountingdocumentcreationdate ? String(oRow.accountingdocumentcreationdate) : "";
                const sFecha = this._toYYYYMMDD(sFechaISO);

                // ✅ toma el valor que realmente se usó al buscar (por fila),
                // y si no existe, cae al primer valor del filtro
                const sProyectoFila =
                    (oRow && oRow.__ProyectoUsed) ? String(oRow.__ProyectoUsed) :
                        (oRow && (oRow.project || oRow.Project || oRow.proyecto)) ? String(oRow.project || oRow.Project || oRow.proyecto) :
                            (aProyFilter[0] || "");

                const sTipoDocFila =
                    (oRow && oRow.__TipoDocUsed) ? String(oRow.__TipoDocUsed) :
                        (oRow && (oRow.tipodoc || oRow.documenttype)) ? String(oRow.tipodoc || oRow.documenttype) :
                            (aTipoFilter[0] || "");

                const sCecoFila =
                    (oRow && oRow.__CecoUsed) ? String(oRow.__CecoUsed) :
                        (aCecoFilter[0] || "");

                return this._callService({
                    Sociedad: sSoc,
                    Proyecto: is4810_4811 ? (sProyectoFila || "") : "",
                    FechaIni: f.FechaIni,
                    FechaFin: f.FechaFin,
                    Indicador: "2",
                    Ceco: is4813 ? (sCecoFila || "") : "",
                    reembolso: sReembolso,
                    fecha: sFecha,
                    tipodoc: is4810_4811 ? (sTipoDocFila || "") : ""
                });
            }.bind(this));

            const aResponses = await Promise.all(aPromises);

            const aDetail = (aResponses || [])
                .filter(Array.isArray)
                .reduce(function (acc, arr) { return acc.concat(arr); }, []);

            return aDetail;
        },

        _generatePDFWithData: function (pdfMake, aDetail) {
            const docDefinition = this._buildPdfMakeDocDefinition(aDetail);

            // ✅ requisito: generar archivo y descargar (NO imprimir)
            pdfMake.createPdf(docDefinition).download("Soporte_Revisoria_fiscal.pdf");
        },

        _buildPdfMakeDocDefinition: function (aAll) {
            const nf0 = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

            const groups = this._groupBy(aAll, r => String(r.documentoreembolso || "SIN_DOCUMENTO"));
            const docKeys = Object.keys(groups);

            // anchos aproximados (basados en el autoTable previo)
            const widths = [35, 45, 40, 40, 45, 70, 45, 45, 40, 45, 40, 40, 40, 40, 45];

            const content = [];

            docKeys.forEach((docKey, idx) => {
                const a = groups[docKey] || [];
                const h = a[0] || {};

                const cliente = (h.clienteniflargo && String(h.clienteniflargo).trim())
                    ? h.clienteniflargo
                    : (h.nit || "");

                const nombreCliente = h.nombre2 || h.nombre || "";
                const consecutivo = (h.consecutivocausacion ?? h.consecutivo ?? "") + "";
                const telefono = h.telefono || "";
                const proyecto = h.proyecto || h.definicionproyecto || "";
                const descProyecto = h.descripcionproyecto || "";
                const direccion = h.calle || "";

                const totalSoporte = this._sum(a, "valortotalcosto");

                // Resumen (2 columnas) - equivalente a kv() en jsPDF
                content.push({
                    layout: "noBorders",
                    table: {
                        widths: [90, "*", 90, "*"],
                        body: [
                            [{ text: "Documento:", bold: true }, String(docKey || ""), { text: "Consecutivo:", bold: true }, String(consecutivo || "")],
                            [{ text: "Cliente:", bold: true }, String(cliente || ""), { text: "Nombre:", bold: true }, String(nombreCliente || "")],
                            [{ text: "Teléfono:", bold: true }, String(telefono || ""), { text: "Dirección:", bold: true }, String(direccion || "")],
                            [{ text: "Proyecto:", bold: true }, String(proyecto || ""), { text: "Descripción:", bold: true }, String(descProyecto || "")],
                            [{ text: "Total Soporte:", bold: true }, nf0.format(Number(totalSoporte || 0)), "", ""]
                        ]
                    },
                    fontSize: 9,
                    margin: [0, 0, 0, 6]
                });

                // línea separadora
                content.push({
                    canvas: [{ type: "line", x1: 0, y1: 0, x2: 770, y2: 0, lineWidth: 0.5 }],
                    margin: [0, 0, 0, 6]
                });

                // Tabla detalle (equivalente autoTable)
                const headerRow = [
                    { text: "Clase\ndoc", style: "tableHeader" },
                    { text: "Documento", style: "tableHeader" },
                    { text: "Fecha", style: "tableHeader" },
                    { text: "Ref.", style: "tableHeader" },
                    { text: "NIT", style: "tableHeader" },
                    { text: "Nombre", style: "tableHeader" },
                    { text: "Valor Total\ncosto", style: "tableHeader" },
                    { text: "IVA Mayor\nvalor", style: "tableHeader" },
                    { text: "IVA VIS", style: "tableHeader" },
                    { text: "Factura\nReemb.", style: "tableHeader" },
                    { text: "RteFte", style: "tableHeader" },
                    { text: "Rte IVA", style: "tableHeader" },
                    { text: "Rte ICA", style: "tableHeader" },
                    { text: "Rte GAR", style: "tableHeader" },
                    { text: "Neto\nRTE", style: "tableHeader" }
                ];

                const bodyRows = (a || []).map((r) => ([
                    String(r.documenttype || r.clasedocumento || ""),
                    String(r.accountingdocument || r.documento || ""),
                    String(r.fecha || ""),
                    String(r.ledgergllineitem || r.referencia || ""),
                    String(r.nit || ""),
                    String(r.nombre || r.nombre2 || ""),
                    { text: nf0.format(Number(r.valortotalcosto || 0)), alignment: "right" },
                    { text: nf0.format(Number(r.ivamayorvalorcosto || 0)), alignment: "right" },
                    { text: nf0.format(Number(r.ivavis || 0)), alignment: "right" },
                    { text: nf0.format(Number(r.valorfactareembolsar || 0)), alignment: "right" },
                    { text: nf0.format(Number(r.valorretefuente || 0)), alignment: "right" },
                    { text: nf0.format(Number(r.valorrteiva || 0)), alignment: "right" },
                    { text: nf0.format(Number(r.valorrteica || 0)), alignment: "right" },
                    { text: nf0.format(Number(r.valorrtegar || 0)), alignment: "right" },
                    { text: nf0.format(Number(r.valornetorte || 0)), alignment: "right" }
                ]));

                const subtotalValTotal = this._sum(a, "valortotalcosto");
                const subtotalIvaMayor = this._sum(a, "ivamayorvalorcosto");
                const subtotalIvaVis = this._sum(a, "ivavis");
                const subtotalFact = this._sum(a, "valorfactareembolsar");
                const subtotalRetFte = this._sum(a, "valorretefuente");
                const subtotalRteIva = this._sum(a, "valorrteiva");
                const subtotalRteIca = this._sum(a, "valorrteica");
                const subtotalRteGar = this._sum(a, "valorrtegar");
                const subtotalNeto = this._sum(a, "valornetorte");

                // fila subtotal (colSpan 6)
                const subtotalRow = [
                    { text: "Subtotal:", colSpan: 6, bold: true, alignment: "right" },
                    "", "", "", "", "",
                    { text: nf0.format(subtotalValTotal), bold: true, alignment: "right" },
                    { text: nf0.format(subtotalIvaMayor), bold: true, alignment: "right" },
                    { text: nf0.format(subtotalIvaVis), bold: true, alignment: "right" },
                    { text: nf0.format(subtotalFact), bold: true, alignment: "right" },
                    { text: nf0.format(subtotalRetFte), bold: true, alignment: "right" },
                    { text: nf0.format(subtotalRteIva), bold: true, alignment: "right" },
                    { text: nf0.format(subtotalRteIca), bold: true, alignment: "right" },
                    { text: nf0.format(subtotalRteGar), bold: true, alignment: "right" },
                    { text: nf0.format(subtotalNeto), bold: true, alignment: "right" }
                ];

                const tableBody = [headerRow].concat(bodyRows).concat([subtotalRow]);

                content.push({
                    table: {
                        headerRows: 1,
                        widths: widths,
                        body: tableBody
                    },
                    fontSize: 6,
                    margin: [0, 0, 0, 8],
                    layout: {
                        fillColor: function (rowIndex) {
                            return rowIndex === 0 ? "#CCCCCC" : null;
                        }
                    }
                });

                // Bloque firma (equivalente al final del jsPDF)
                content.push({
                    text: "“Certifico que las cifras con los documentos soporte contenidas en este informe fueron tomadas de los libros de contabilidad tal como se informa en certificación adjunta”.",
                    fontSize: 8,
                    margin: [0, 6, 0, 8]
                });

                content.push({
                    canvas: [{ type: "line", x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5 }],
                    margin: [0, 0, 0, 2]
                });
                content.push({ text: " ", bold: true, fontSize: 8 });
                content.push({ text: " ", bold: true, fontSize: 8 });
                content.push({ text: "ELOISA MARIA BARRERA BARRERA", bold: true, fontSize: 8 });
                content.push({ text: "Revisor fiscal principal", fontSize: 8 });
                content.push({ text: "TP: 186699-T", fontSize: 8 });
                content.push({ text: "Ver certificación adjunta", italics: true, fontSize: 8 });

                if (idx < docKeys.length - 1) {
                    content.push({ text: "", pageBreak: "after" });
                }
            });

            return {
                pageSize: "A4",
                pageOrientation: "landscape",
                pageMargins: [22, 28, 22, 28],
                footer: function (currentPage, pageCount) {
                    return {
                        text: "Página " + currentPage + " de " + pageCount,
                        alignment: "right",
                        fontSize: 8,
                        margin: [0, 0, 22, 10]
                    };
                },
                content: content,
                styles: {
                    tableHeader: {
                        bold: true,
                        alignment: "center"
                    }
                },
                defaultStyle: {
                    fontSize: 9
                }
            };
        },

        _loadPDFMakeFromCDN: function () {
            if (window._loadingPDFMake) return;
            window._loadingPDFMake = true;

            const script1 = document.createElement('script');
            script1.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js';
            script1.onload = () => {
                const script2 = document.createElement('script');
                script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.js';
                script2.onload = () => {
                    window._loadingPDFMake = false;
                    this.onImprimirPdf();
                };
                document.head.appendChild(script2);
            };
            script1.onerror = () => { window._loadingPDFMake = false; };
            document.head.appendChild(script1);
        },

        _getAppModulePath: function () {
            // Convierte el sap.app/id (co.com....) a path (co/com/...)
            try {
                const sId = this.getOwnerComponent().getManifestEntry('/sap.app/id') || 'co.com.conconcreto.soportereembolsos';
                return String(sId).replace(/\./g, '/');
            } catch (e) {
                return 'co/com/conconcreto/soportereembolsos';
            }
        },

        _groupBy: function (arr, fnKey) {
            return (arr || []).reduce((acc, it) => {
                const k = fnKey(it);
                acc[k] = acc[k] || [];
                acc[k].push(it);
                return acc;
            }, {});
        },

        _sum: function (arr, field) {
            return (arr || []).reduce((acc, it) => acc + Number(it?.[field] || 0), 0);
        },

        _isFLP: function () {
            return !!(sap.ushell && sap.ushell.Container);
        },


        // ======================================================
        // BUSY (para VBox busy y busy de la vista)
        // ======================================================
        _setBusy: function (bBusy) {
            const oView = this.getView();
            const oModel = oView.getModel();
            const b = !!bBusy;

            if (oModel) {
                oModel.setProperty("/ui/busy", b);
            }

            // compatibilidad: busy global de la vista
            if (oView && typeof oView.setBusy === "function") {
                oView.setBusy(b);
            }
        },


        // ======================================================
        // REST CALL
        // ======================================================
        _callService: async function (params) {
            const sBase = this._getRestUrl("restReemb");
            const sUrl = `${sBase}?${this._toQueryString(params)}`;

            const res = await fetch(sUrl, {
                method: "GET",
                headers: { "Accept": "application/json" }
            });

            if (!res.ok) {
                const txt = await res.text().catch(() => "");
                throw new Error(`HTTP ${res.status} - ${txt || res.statusText}`);
            }

            const contentType = res.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                return await res.json();
            }

            const raw = await res.text();
            try { return JSON.parse(raw); } catch (e) { return raw; }
        },

        _toQueryString: function (obj) {
            return Object.keys(obj)
                .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k] ?? "")}`)
                .join("&");
        },

        _toYYYYMMDD: function (sISO) {
            return sISO ? String(sISO).replaceAll("-", "") : "";
        },

        _normalizeError: function (e) {
            return (e && (e.message || (typeof e === "string" ? e : JSON.stringify(e)))) || "Error desconocido";
        },

        _revokePdfUrl: function () {
            if (this._pdfObjectUrl) {
                URL.revokeObjectURL(this._pdfObjectUrl);
                this._pdfObjectUrl = null;
            }
        },

        // ======================================================
        // CLEANUP
        // ======================================================
        onExit: function () {
            this._revokePdfUrl();



            this._pdfPendingDetail = null;
            if (this._pdfViewer) {
                this._pdfViewer.destroy();
                this._pdfViewer = null;
            }

            if (this._socVH) { this._socVH.destroy(); this._socVH = null; }
            if (this._tipoDocVH) { this._tipoDocVH.destroy(); this._tipoDocVH = null; }
            if (this._cecoVH) { this._cecoVH.destroy(); this._cecoVH = null; }
            if (this._projVH) { this._projVH.destroy(); this._projVH = null; }
        },

        // ======================================================
        // DateRangeSelection change
        // ======================================================
        onFechaRangoChange: function (oEvent) {
            const oDRS = oEvent.getSource();
            const oIni = oDRS.getDateValue();
            const oFin = oDRS.getSecondDateValue();

            const oModel = this.getView().getModel();

            if (!oIni && !oFin) {
                oModel.setProperty("/filters/FechaIni", "");
                oModel.setProperty("/filters/FechaFin", "");
                return;
            }

            if (oIni && oFin) {
                oModel.setProperty("/filters/FechaIni", this._formatYYYYMMDD(oIni));
                oModel.setProperty("/filters/FechaFin", this._formatYYYYMMDD(oFin));

                const sIni = oModel.getProperty("/filters/FechaIni");
                const sFin = oModel.getProperty("/filters/FechaFin");
                if (sIni > sFin) {
                    MessageBox.warning("La fecha inicio no puede ser mayor que la fecha fin.");
                    oModel.setProperty("/filters/FechaIni", "");
                    oModel.setProperty("/filters/FechaFin", "");
                    oDRS.setDateValue(null);
                    oDRS.setSecondDateValue(null);
                }
            }
        },

        _formatYYYYMMDD: function (oDate) {
            const yyyy = String(oDate.getFullYear());
            const mm = String(oDate.getMonth() + 1).padStart(2, "0");
            const dd = String(oDate.getDate()).padStart(2, "0");
            return `${yyyy}${mm}${dd}`;
        }

    });
});
