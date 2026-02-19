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
    "sap/ui/model/FilterOperator",
    "co/com/conconcreto/soportereembolsos/util/Util"
], function (
    Controller,
    JSONModel,
    MessageToast,
    MessageBox,
    PDFViewer,
    TableSelectDialog,
    Column,
    Label,
    ColumnListItem,
    Text,
    Filter,
    FilterOperator,
    Util
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
        _buildHeader: function (sTitle) {
            return function (currentPage, pageCount) {
                return {
                    margin: [25, 15, 25, 0], // izq, arriba, der, abajo
                    columns: [
                        { text: "", width: 40 }, // espacio opcional (si luego quieres logo)
                        { text: sTitle, alignment: "center", bold: true, fontSize: 20, width: "*" },
                        { text: "", width: 40 },
                        { text: "Página " + currentPage + " de " + pageCount, alignment: "right", fontSize: 9, width: 120 }
                    ]
                };
            };
        },
        onExportPdf: async function () {
            const oViewModel = this.getView().getModel();
            const aSelected = oViewModel.getProperty("/selectedRows") || [];

            if (!aSelected.length) {
                return MessageBox.warning("Seleccione al menos un reembolso.");
            }

            this._setBusy(true);

            try {
                for (const oRow of aSelected) {
                    await this._exportOneReembolso(oRow);
                }

                MessageToast.show("PDF(s) generado(s) correctamente.");
            } catch (e) {
                MessageBox.error(this._normalizeError(e));
            } finally {
                this._setBusy(false);
            }
        },
        _exportOneReembolso: async function (oRow) {
            const oModel = this.getView().getModel();
            const f = oModel.getProperty("/filters");

            const oParams = {
                Sociedad: f.Sociedad,
                Proyecto: "",
                FechaIni: "",
                FechaFin: "",
                Indicador: "3",
                Ceco: "",
                reembolso: oRow.numeroReembolso,
                fecha: Util.formatFechaYYYYMMDD(oRow.accountingdocumentcreationdate),
                tipodoc: ""
            };

            const vResp = await this._callService(oParams);

            const aDetalle = Array.isArray(vResp) ? vResp : [vResp];

            if (!aDetalle.length) {
                throw new Error("No se encontró detalle para el reembolso " + oRow.numeroReembolso);
            }
            Util.generateFormatoFromEndpoint(aDetalle);
        },
        // ======================================================
        // PROYECTO (4810/4811) DESDE SERVICIO REST (Indicador=X) + VALUE HELP
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
            const oDialog = oEvent.getSource();
            const oBinding = oDialog && oDialog.getBinding("items");

            // Carga una vez desde el servicio REST (Indicador=X). Luego filtra en cliente.
            try {
                if (!this.getView().getModel().getProperty("/ui/proyectosLoaded")) {
                    if (oDialog) oDialog.setBusy(true);
                    await this._loadProyectosFromOData(""); // (se dejó el nombre por compatibilidad)
                }
            } catch (e) {
                // no bloquea la UI: si falla la consulta, igual permite cerrar el VH
                MessageToast.show("No se pudo consultar proyectos.");
            } finally {
                if (oDialog) oDialog.setBusy(false);
            }

            if (!oBinding) return;

            if (!sValue) {
                oBinding.filter([]);
                return;
            }

            oBinding.filter([new Filter({
                filters: [
                    new Filter("Project", FilterOperator.Contains, sValue),
                    new Filter("ProjectDescription", FilterOperator.Contains, sValue)
                ],
                and: false
            })]);
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

            // Si ya cargó la lista base, no vuelva a pedir (la búsqueda se hace client-side)
            if (bLoaded && (oModel.getProperty("/proyectos") || []).length) {
                return Promise.resolve();
            }

            const f = oModel.getProperty("/filters") || {};
            const sSoc = String(f.Sociedad || "").trim();

            if (!sSoc) {
                return Promise.reject(new Error("Debe seleccionar una sociedad."));
            }

            // Servicio REST:
            // /sap/bc/http/sap/zmm_sop_reemb_ivavis?Sociedad=....&Proyecto=&FechaIni=&FechaFin=&Indicador=X&Ceco=&reembolso=&fecha=&tipodoc=
            const oParams = {
                Sociedad: sSoc,
                Proyecto: "",
                FechaIni: "",
                FechaFin: "",
                Indicador: "X",
                Ceco: "",
                reembolso: "",
                fecha: "",
                tipodoc: ""
            };

            return this._callService(oParams).then((vResp) => {
                const aArr = Array.isArray(vResp) ? vResp : [];

                // Normaliza estructura a {Project, ProjectDescription} para reutilizar el VH existente
                const aRaw = aArr
                    .map((r) => ({
                        Project: String((r && r.proyecto) || "").trim(),
                        ProjectDescription: String((r && r.nombreProy) || "").trim()
                    }))
                    .filter((o) => !!o.Project);

                const aDedup = this._dedupProyectos(aRaw);

                oModel.setProperty("/proyectos", aDedup);
                oModel.setProperty("/ui/proyectosLoaded", true);

                return;
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

            // limpiar maestros dependientes de sociedad
            oModel.setProperty("/proyectos", []);
            oModel.setProperty("/ui/proyectosLoaded", false);

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
        // ======================================================
        // PDF - SOPORTE IVA VIS (✅ pdfMake download, Indicador=1)
        // ======================================================
        onSoporteIvaPdf: async function () {
            const oModel = this.getView().getModel();
            const f = oModel.getProperty("/filters") || {};

            const oTable = this.byId("tblLista");
            if (!oTable) return;

            const aSelectedItems = oTable.getSelectedItems();
            if (!aSelectedItems.length) {
                MessageBox.information("Seleccione al menos un reembolso para generar el Soporte IVA.");
                return;
            }

            // 1) Consultar el servicio (Indicador=1) para los reembolsos seleccionados
            this._setBusy(true);
            let aSoporte = [];
            try {
                aSoporte = await this._loadSoporteIvaFromSelectedItems(aSelectedItems);
            } catch (e) {
                MessageBox.error(this._normalizeError(e));
                return;
            } finally {
                this._setBusy(false);
            }

            if (!Array.isArray(aSoporte) || !aSoporte.length) {
                MessageBox.information("No se obtuvieron datos para el Soporte IVA de los reembolsos seleccionados.");
                return;
            }

            // Nombre archivo (si solo hay 1 reembolso, lo incluye)
            const aReemb = Array.from(new Set(
                aSelectedItems.map(it => {
                    const oRow = it.getBindingContext().getObject();
                    return String(oRow?.numeroReembolso || oRow?.documentoReembolso || oRow?.documentoreembolso || "").trim();
                }).filter(Boolean)
            ));

            const sFileName = (aReemb.length === 1)
                ? ("Soporte_IVA_VIS_" + aReemb[0] + ".pdf")
                : ("Soporte_IVA_VIS.pdf");

            // 2) Generar PDF (✅ pdfMake download) usando el mismo patrón del controller ejemplo
            if (window.pdfMake) {
                this._generateSoporteIvaPdfWithData(window.pdfMake, aSoporte, sFileName);
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

                    this._generateSoporteIvaPdfWithData(pdfMake, aSoporte, sFileName);
                } catch (error) {
                    console.error("Error con pdfmake local:", error);
                    this._loadPDFMakeFromCDN_SoporteIva();
                }
            }.bind(this), function (oError) {
                console.error("Error cargando recursos locales:", oError);
                this._loadPDFMakeFromCDN_SoporteIva();
            }.bind(this));
        },

        // ======================================================
        // PDF - SOPORTE OXA (✅ pdfMake download, Indicador=4)
        // ======================================================
        onSoporteOxaPdf: async function () {
            const oModel = this.getView().getModel();
            const f = oModel.getProperty("/filters") || {};

            const oTable = this.byId("tblLista");
            if (!oTable) return;

            const aSelectedItems = oTable.getSelectedItems();
            if (!aSelectedItems.length) {
                MessageBox.information("Seleccione al menos un reembolso para generar el Soporte OXA.");
                return;
            }

            // 1) Consultar el servicio (Indicador=4) para los reembolsos seleccionados
            this._setBusy(true);
            let aSoporte = [];
            try {
                aSoporte = await this._loadSoporteOxaFromSelectedItems(aSelectedItems);
            } catch (e) {
                MessageBox.error(this._normalizeError(e));
                return;
            } finally {
                this._setBusy(false);
            }

            if (!Array.isArray(aSoporte) || !aSoporte.length) {
                MessageBox.information("No se obtuvieron datos para el Soporte OXA de los reembolsos seleccionados.");
                return;
            }

            // Nombre archivo (si solo hay 1 reembolso, lo incluye)
            const aReemb = Array.from(new Set(
                aSelectedItems.map(it => {
                    const oRow = it.getBindingContext().getObject();
                    return String(oRow?.numeroReembolso || oRow?.documentoReembolso || oRow?.documentoreembolso || "").trim();
                }).filter(Boolean)
            ));

            const sFileName = (aReemb.length === 1)
                ? ("Soporte_OxA_" + aReemb[0] + ".pdf")
                : ("Soporte_OxA.pdf");

            // 2) Generar PDF (✅ pdfMake download) usando el mismo patrón del controller ejemplo
            if (window.pdfMake) {
                this._generateSoporteOxaPdfWithData(window.pdfMake, aSoporte, sFileName);
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

                    this._generateSoporteOxaPdfWithData(pdfMake, aSoporte, sFileName);
                } catch (error) {
                    console.error("Error con pdfmake local:", error);
                    this._loadPDFMakeFromCDN_SoporteOxa();
                }
            }.bind(this), function (oError) {
                console.error("Error cargando recursos locales:", oError);
                this._loadPDFMakeFromCDN_SoporteOxa();
            }.bind(this));
        },

        _loadSoporteOxaFromSelectedItems: async function (aSelectedItems) {
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

                const sReembolso = String(
                    oRow?.numeroReembolso || oRow?.documentoReembolso || oRow?.documentoreembolso || ""
                ).trim();

                const sFechaISO = String(oRow?.accountingdocumentcreationdate || "").trim();
                const sFecha = this._toYYYYMMDD(sFechaISO);

                // Si la lista viene de búsquedas multi-filtro, el controller guarda el valor usado por fila:
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
                    Indicador: "4",
                    Ceco: is4813 ? (sCecoFila || "") : "",
                    reembolso: sReembolso,
                    fecha: sFecha || "",
                    tipodoc: is4810_4811 ? (sTipoDocFila || "") : ""
                });
            }.bind(this));

            const aResponses = await Promise.all(aPromises);

            // Flatten + normalización: siempre arreglo
            const aAll = (aResponses || [])
                .filter(Array.isArray)
                .reduce((acc, arr) => acc.concat(arr), []);

            // Dedup (por reembolso + clase doc + fecha + bruto/iva/total)
            const seen = new Set();
            const out = [];
            (aAll || []).forEach((r) => {
                const k = [
                    String(r?.documentoReembolso || "").trim(),
                    String(r?.accountingdocumenttypename || "").trim(),
                    String(r?.documentdate || "").trim(),
                    String(r?.valorBruto ?? "").trim(),
                    String(r?.valorIva ?? "").trim(),
                    String(r?.valorTotal ?? "").trim()
                ].join("|");
                if (seen.has(k)) return;
                seen.add(k);
                out.push(r);
            });

            return out;
        },




        _loadSoporteIvaFromSelectedItems: async function (aSelectedItems) {
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

                const sReembolso = String(
                    oRow?.numeroReembolso || oRow?.documentoReembolso || oRow?.documentoreembolso || ""
                ).trim();

                const sFechaISO = String(oRow?.accountingdocumentcreationdate || "").trim();
                const sFecha = this._toYYYYMMDD(sFechaISO);

                // Si la lista viene de búsquedas multi-filtro, el controller guarda el valor usado por fila:
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
                    Indicador: "1",
                    Ceco: is4813 ? (sCecoFila || "") : "",
                    reembolso: sReembolso,
                    fecha: sFecha || "",
                    tipodoc: is4810_4811 ? (sTipoDocFila || "") : ""
                });
            }.bind(this));

            const aResponses = await Promise.all(aPromises);

            // Flatten + normalización: siempre arreglo
            const aAll = (aResponses || [])
                .filter(Array.isArray)
                .reduce((acc, arr) => acc.concat(arr), []);

            // Dedup (por reembolso + doc contable + item)
            const seen = new Set();
            const out = [];
            (aAll || []).forEach((r) => {
                const k = [
                    String(r?.documentoReembolso || "").trim(),
                    String(r?.accountingdocument || "").trim(),
                    String(r?.accountingdocumentitem ?? "").trim()
                ].join("|");
                if (seen.has(k)) return;
                seen.add(k);
                out.push(r);
            });

            return out;
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

        _generateSoporteIvaPdfWithData: function (pdfMake, aSoporte, sFileName) {
            const docDefinition = this._buildSoporteIvaDocDefinition(aSoporte);
            pdfMake.createPdf(docDefinition).download(sFileName || "Soporte_IVA_VIS.pdf");
        },

        _generateSoporteOxaPdfWithData: function (pdfMake, aSoporte, sFileName) {
            const docDefinition = this._buildSoporteOxaDocDefinition(aSoporte);
            pdfMake.createPdf(docDefinition).download(sFileName || "Soporte_OxA.pdf");
        },



        _buildSoporteIvaDocDefinition: function (aAll) {
            const nf0 = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

            // Agrupar por Reembolso (documentoReembolso)
            const groups = this._groupBy(aAll, (r) => String(r?.documentoReembolso || r?.documentoreembolso || "SIN_REEMBOLSO"));
            const docKeys = Object.keys(groups);

            // Columnas (similar a la imagen)
            const headerRow = [
                { text: "Sociedad", style: "th" },
                { text: "Definición\nproyecto", style: "th" },
                { text: "Reembolso", style: "th" },
                { text: "N° documento", style: "th" },
                { text: "Referencia", style: "th" },
                { text: "NIT", style: "th" },
                { text: "Nombre", style: "th" },
                { text: "Ejercicio", style: "th" },
                { text: "Posición", style: "th" },
                { text: "Indicador\nImpuesto", style: "th" },
                { text: "Significado", style: "th" },
                { text: "Base Iva", style: "th" },
                { text: "IVA VIS", style: "th" }
            ];

            const widths = [40, 40, 45, 40, 40, 70, 80, 55, 55, 35, 45, 30, 75];

            const content = [];

            docKeys.forEach((docKey, idx) => {
                const a = groups[docKey] || [];
                const h = a[0] || {};

                const sDoc = String(h.documentoReembolso || h.documentoreembolso || docKey || "");
                const sProy = String(h.definicionProyecto || h.definicionproyecto || "");
                const sDesc = String(h.projectdescription || h.descripcionproyecto || "");

                // Meta (Documento / Proyecto / Descripción)
                content.push({
                    layout: "noBorders",
                    table: {
                        widths: [220, "*"],
                        body: [
                            [
                                { text: [{ text: "Documento: ", bold: true }, { text: sDoc }], fontSize: 9 },
                                { text: "", fontSize: 9 }
                            ],
                            [
                                { text: [{ text: "Proyecto: ", bold: true }, { text: sProy }], fontSize: 9 },
                                { text: [{ text: "Descripción: ", bold: true }, { text: sDesc }], fontSize: 9 }
                            ]
                        ]
                    },
                    margin: [0, 10, 0, 8]
                });

                // Tabla
                const bodyRows = (a || []).map((r) => ([
                    String(r.companycode || ""),
                    String(r.definicionProyecto || ""),
                    String(r.documentoReembolso || ""),
                    String(r.accountingdocument || ""),
                    String(r.documentreferenceid || ""),
                    String(r.taxnumber1 || ""),
                    String(r.suppliername || ""),
                    String(r.fiscalyear || ""),
                    String(r.accountingdocumentitem ?? ""),
                    String(r.taxcode || ""),
                    String(r.taxcodename || ""),
                    { text: nf0.format(Number(r.baseIva || 0)), alignment: "right" },
                    { text: nf0.format(Number(r.ivaVis || 0)), alignment: "right" }
                ]));

                const totalBase = (a || []).reduce((acc, it) => acc + Number(it?.baseIva || 0), 0);
                const totalIva = (a || []).reduce((acc, it) => acc + Number(it?.ivaVis || 0), 0);

                const totalRow = [
                    { text: "Total", colSpan: 11, alignment: "right", bold: true }, "", "", "", "", "", "", "", "", "", "",
                    { text: nf0.format(totalBase), alignment: "right", bold: true },
                    { text: nf0.format(totalIva), alignment: "right", bold: true }
                ];

                content.push({
                    table: {
                        headerRows: 1,
                        widths: widths,
                        body: [headerRow].concat(bodyRows).concat([totalRow])
                    },
                    fontSize: 7,
                    layout: {
                        fillColor: function (rowIndex) {
                            return rowIndex === 0 ? "#E6E6E6" : null;
                        },
                        hLineWidth: function () { return 0.7; },
                        vLineWidth: function () { return 0.7; }
                    }
                });

                if (idx < docKeys.length - 1) {
                    content.push({ text: "", pageBreak: "after" });
                }
            });

            return {
                pageSize: "A4",
                pageOrientation: "landscape",
                pageMargins: [25, 55, 25, 25],
                header: function (currentPage, pageCount) {
                    return {
                        margin: [25, 15, 25, 0],
                        stack: [
                            {
                                columns: [
                                    { text: "SOPORTE IVA VIVIENDA DE INTERES SOCIAL", alignment: "center", bold: true, fontSize: 10, width: "*" },
                                    { text: "Página " + currentPage + " de " + pageCount, alignment: "right", fontSize: 9, width: 130 }
                                ]
                            }
                        ]
                    };
                },
                content: content,
                styles: {
                    th: { bold: true, alignment: "center" }
                },
                defaultStyle: { fontSize: 9 }
            };
        },

        _buildSoporteOxaDocDefinition: function (aAll) {
            const nf0 = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

            // Logo (mismo patrón del controller ejemplo)
            const sLogoConconcreto = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/4YPDaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLwA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/Pgo8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA1LjYtYzE0OCA3OS4xNjQwNTAsIDIwMTkvMTAvMDEtMTg6MDM6MTYgICAgICAgICI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIKICAgICAgICAgICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIgogICAgICAgICAgICB4bWxuczp4bXBHSW1nPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvZy9pbWcvIgogICAgICAgICAgICB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIKICAgICAgICAgICAgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiCiAgICAgICAgICAgIHhtbG5zOnN0RXZ0PSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VFdmVudCMiCiAgICAgICAgICAgIHhtbG5zOnN0TWZzPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvTWFuaWZlc3RJdGVtIyIKICAgICAgICAgICAgeG1sbnM6aWxsdXN0cmF0b3I9Imh0dHA6Ly9ucy5hZG9iZS5jb20vaWxsdXN0cmF0b3IvMS4wLyIKICAgICAgICAgICAgeG1sbnM6cGRmPSJodHRwOi8vbnMuYWRvYmUuY29tL3BkZi8xLjMvIj4KICAgICAgICAgPGRjOmZvcm1hdD5pbWFnZS9qcGVnPC9kYzpmb3JtYXQ+CiAgICAgICAgIDxkYzp0aXRsZT4KICAgICAgICAgICAgPHJkZjpBbHQ+CiAgICAgICAgICAgICAgIDxyZGY6bGkgeG1sOmxhbmc9IngtZGVmYXVsdCI+TE9HT1M8L3JkZjpsaT4KICAgICAgICAgICAgPC9yZGY6QWx0PgogICAgICAgICA8L2RjOnRpdGxlPgogICAgICAgICA8eG1wOkNyZWF0b3JUb29sPkFkb2JlIElsbHVzdHJhdG9yIDI0LjAgKFdpbmRvd3MpPC94bXA6Q3JlYXRvclRvb2w+CiAgICAgICAgIDx4bXA6Q3JlYXRlRGF0ZT4yMDIxLTA0LTEzVDA4OjQ0OjQ0LTA1OjAwPC94bXA6Q3JlYXRlRGF0ZT4KICAgICAgICAgPHhtcDpNb2RpZnlEYXRlPjIwMjEtMDQtMTNUMTM6NDQ6NDRaPC94bXA6TW9kaWZ5RGF0ZT4KICAgICAgICAgPHhtcDpNZXRhZGF0YURhdGU+MjAyMS0wNC0xM1QwODo0NDo0NC0wNTowMDwveG1wOk1ldGFkYXRhRGF0ZT4KICAgICAgICAgPHhtcDpUaHVtYm5haWxzPgogICAgICAgICAgICA8cmRmOkFsdD4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDx4bXBHSW1nOndpZHRoPjI1NjwveG1wR0ltZzp3aWR0aD4KICAgICAgICAgICAgICAgICAgPHhtcEdJbWc6aGVpZ2h0PjE2MDwveG1wR0ltZzpoZWlnaHQ+CiAgICAgICAgICAgICAgICAgIDx4bXBHSW1nOmZvcm1hdD5KUEVHPC94bXBHSW1nOmZvcm1hdD4KICAgICAgICAgICAgICAgICAgPHhtcEdJbWc6aW1hZ2U+LzlqLzRBQVFTa1pKUmdBQkFnRUJMQUVzQUFELzdRQXNVR2h2ZEc5emFHOXdJRE11TUFBNFFrbE5BKzBBQUFBQUFCQUJMQUFBQUFFQSYjeEE7QVFFc0FBQUFBUUFCLys0QURrRmtiMkpsQUdUQUFBQUFBZi9iQUlRQUJnUUVCQVVFQmdVRkJna0dCUVlKQ3dnR0JnZ0xEQW9LQ3dvSyYjeEE7REJBTURBd01EQXdRREE0UEVBOE9EQk1URkJRVEV4d2JHeHNjSHg4Zkh4OGZIeDhmSHdFSEJ3Y05EQTBZRUJBWUdoVVJGUm9mSHg4ZiYjeEE7SHg4Zkh4OGZIeDhmSHg4Zkh4OGZIeDhmSHg4Zkh4OGZIeDhmSHg4Zkh4OGZIeDhmSHg4Zkh4OGZIeDhmLzhBQUVRZ0FvQUVBQXdFUiYjeEE7QUFJUkFRTVJBZi9FQWFJQUFBQUhBUUVCQVFFQUFBQUFBQUFBQUFRRkF3SUdBUUFIQ0FrS0N3RUFBZ0lEQVFFQkFRRUFBQUFBQUFBQSYjeEE7QVFBQ0F3UUZCZ2NJQ1FvTEVBQUNBUU1EQWdRQ0JnY0RCQUlHQW5NQkFnTVJCQUFGSVJJeFFWRUdFMkVpY1lFVU1wR2hCeFd4UWlQQiYjeEE7VXRIaE14Wmk4Q1J5Z3ZFbFF6UlRrcUt5WTNQQ05VUW5rNk96TmhkVVpIVEQwdUlJSm9NSkNoZ1poSlJGUnFTMFZ0TlZLQnJ5NC9QRSYjeEE7MU9UMFpYV0ZsYVcxeGRYbDlXWjJocGFtdHNiVzV2WTNSMWRuZDRlWHA3ZkgxK2YzT0VoWWFIaUltS2k0eU5qbytDazVTVmxwZVltWiYjeEE7cWJuSjJlbjVLanBLV21wNmlwcXF1c3JhNnZvUkFBSUNBUUlEQlFVRUJRWUVDQU1EYlFFQUFoRURCQ0VTTVVFRlVSTmhJZ1p4Z1pFeSYjeEE7b2JId0ZNSFI0U05DRlZKaWN2RXpKRFJEZ2hhU1V5V2lZN0xDQjNQU05lSkVneGRVa3dnSkNoZ1pKalpGR2lka2RGVTM4cU96d3lncCYjeEE7MCtQemhKU2t0TVRVNVBSbGRZV1ZwYlhGMWVYMVJsWm1kb2FXcHJiRzF1YjJSMWRuZDRlWHA3ZkgxK2YzT0VoWWFIaUltS2k0eU5qbyYjeEE7K0RsSldXbDVpWm1wdWNuWjZma3FPa3BhYW5xS21xcTZ5dHJxK3YvYUFBd0RBUUFDRVFNUkFEOEE5VTRxN0ZYWXE3RlhZcTdGWFlxNyYjeEE7RlV1MTdVNzNUdE9rdXJQVHBkVG5WWEsyOExJdENzYk9DOVR6NGxsQy91MGQ2a1VSc01SWkFWNUgrV1g1eWZtQnJ1czJkaHJQbHhaaCYjeEE7ZmFaSnF3bDB5aW82TUxmMERFMTVjb3FjUkkwYzBaM0RsWEI0dG1IcHM4Y2s4dkNiRUo4TmI4VVpEMGtIcFJyaWdSUVBxc2NRTGxacyYjeEE7UERHTjdXT2ZTanY3N0hXL0xvOXR6TGNWSk5hODFXK2t4YWk3MkY5ZVBwMEMzRFc5akFicWVZU0hqQ3NNVVJaMmFSdzZpb0FYZ3pPViYjeEE7V2pHb1pRWm1GYmo5UEw5UHk5MTNTd0VZeE94Uk5kYjI1OU9tMyttRmZ4VWhmZWNXdE5RdmJUOUJhdk9sa0hkN3VDMkR3eUxFdHE3bSYjeEE7RTh3MGhDM3RWVlY1T1lwVlFNNmhXdGFVMDBuVTViOUp6TFlYV255UVBIRzBWMnNZTEY0SXB6d2FKNVVkVU0zcE15c1J6UmdLZ0FsViYjeEE7WHViMkMyVm1sRWhDbU1IaEZKSWF5djZhMENLMWZpKzFUN0kzTkJ2aEFWVDFQVkxiVFlFbXVFdUpFZHhHQmEyMXhkdlVnbXBTM1NWdyYjeEE7dTMyaUtlKytNWTJxdmJ6cGNXOFU4WWRVbVJaRUVpUEU0RENvNVJ5QlhSdkZXQUk3NENGU3pYZk5PajZMeGh1WkROcU0wVTgxbHBOdSYjeEE7UFZ2TGtXMEx6T3NFQVBKMjR4a0R0eW9LMUl5UWlTckg0L3phMGVYWEUwZUxSTmVNc3R6YlcwVnkrbFhVRUxDNVZ6NnhNNnhNa1VSaSYjeEE7WVNGMVU5U29aUXhEdzdjMVQzUlBOZGxxOXdZSWJTOWdiaEpLa3M5cktsdkpISE8wQWFPNUFhM2YxT0FrakN5VmFObGNDbGFBaFV3biYjeEE7MUcyaHY3V3hkbCtzWGF5dkNoZU5XS3doZVpDTXdkZ09hMTRLYVYzcGhFU1FUM0l0QVdubWUydjdLZTUwK0dXVDZ0cUxhWk1zMFU2ZiYjeEE7SERkaTFuZU1wSEx6UmQyRHFPRzFIWktPVW1jUkJvOTEvWmY0L1NnU3ROVmxrTnk4UmhkWTBSSFc0SlRnNVlzQ2lnTVg1SnhCYXFnZiYjeEE7RUtFL0ZTdXRtU2pxV294MkVDelBEUE9Ha1NQaGJSUE00NW1oWXFnSjRxS3N4KzZwb0RYa3lDSXMzOEJiR2N1RUpmb25tWTZsWnZOUCYjeEE7cHQ3WVN3bFVtaW50NVJVc0I4VVI0aHBFNVZGZUlZZFdWY2hoemNZdWpIM2hqaXljUTVFZTlIYWZxMXJmOHZRUzRUZ3FPZnJGdGNXMiYjeEE7MGxhVTllT09wK0g0Z04xNzBxTXRCdG1DbDNuTHpub3ZsRFNVMVhWL1crcXZQSGJMOVhpYVorY3RlUHdyMjIzT0ZMRVpmK2NndklzZCYjeEE7eFBiRzMxTjVyWXlyTWtkbThoQWhhSlhhaUVrcisvVThodDF4VkY2UitlSGt2VjlkdE5Gc283OTdpOWxrZ2luYTFkSUEwYkJkNUdJRiYjeEE7R0orR25nY1ZaemZYOWpZV3IzZDljUldsckhUMUxpZDFqalhrUW81T3hBRldJR0dNU1RRM1NBVHlRMXQ1aTh2M1ZQcXVwMms5V01ZOSYjeEE7S2VOL2pWa1FyOExIY05OR3RQRmw4UmtqamtPWUtURWpvaFU4NGVYNTdzV05qZlc5NXFCZUZWczQ1b2xsYU9aRWw5V01PeStwR3NFbiYjeEE7cThrclVBZ1ZPMkRKaXlDTmdmUDMwZWgzOHVwN3ViT09JOWRodi9aOFRzbldSYW5ZcTdGWFlxN0ZYWXE3RlhZcWxtdTZacTE5QXcweiYjeEE7V0p0SXVWaHVJNG5qaXQ1NGpMTkVVaWxsam1qWjI5QnlKRlZKRTVIWnFqYkpBanVWUmJUUE1mclJUUjZ5aXQ2eU5jUUcwUXdQRFNIMSYjeEE7RVFCeEtyL3VYOU56S3dYMUc1SzlFNHRqdVZPRVVxaXFXTGtBQXUxS21uYzBBSDNESXFncGRCME9hN2U4bDA2MWt1NURHMGx3OE1iUyYjeEE7TTBMcEpFUzVISW1ONGtaZkFxQ09neUF4UkV1S2h4ZC9WdE9mSVlDQmtlQWNoZTN5NUtqYVZwYldNK250WndHd3V2Vyt0V2hqUXd5LyYjeEE7V1daNS9VanB4YjFXa1l2VWZFU2E5Y20xS2VtYUZvbWxJRTB2VDdhd1FSSkFGdFlZNFFJbzJkMGpvZ1g0RmVhUmxYb0N6SHVjVlIySyYjeEE7dXhWMkt1eFYyS3V4VjJLclhqVjBkQ1NBNElKREZUdUtiRUVFZlJqYUNMVUxMVHJlejUraTh6ZXBUbDYwODAvU3YyZldkK1BYdGtwVCYjeEE7Si9zWVF4aVBLL2lTZnZSSlVNS0VWSGdjaTJJVnRKMHBua2themdMeXh2REs1aVNyUlNNWGVOalRkV1ppeEhRbmZJZUZIdURIZ0hjMSYjeEE7WmFQcE5pUWJLeXQ3VWprQVlZa2orM3g1ZlpBKzE2YTErUThNRU1VSS9TQUZqQ0k1Q2tYbGpKMkt1eFZEWCttYWRxRUlodjdXRzhoVSYjeEE7bGxqbmpXVlF4VW9TQTRJcnhZajVFNUtNaU9ScElKSEpMZjhBQXZrbi9xWHROLzZRNFA4QW1qSitQay9uSDVzdkVsM2xNTGZSOUl0ciYjeEE7aExpMnNiZUc0amhXMWptamlSSFdCS0ZZUXdBSWpGQlJlbVFNNUVVU3hNaWk4aWgyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eCYjeEE7VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMktvYTUxUFRiViYjeEE7eWx6ZHd3T3E4MldTUkVJWGk3Y2lHSTI0eE9hK0Nud09TRUNlUVlTbkVjeUZKOWUwTkxpTzJmVWJWYmlWdUVVSm1qRHN3Y3hjVld0UyYjeEE7ZlVVclFkOXV1SHdwVmRHa2VMQzZzV3MwZlhiVFZmclBvSkpIOVhrNHI2b1VlckVmN3U0aW9XNVF5MFBCL3dCcWh3NU1SalYvank5NCYjeEE7WEhsRTdyOGVmdVlQNXgvUFBRUEs5dkJlM0duWGQxWU5mWFdtM01rQmg5V09hMWtlR3F3dTZsMWQ0SktHb29CWHVNeHNVemt6bkRHdSYjeEE7S0lCTjN5a0FSWHBJNjhpUjVXMzFFUTRqZmxzTisrOTdIeVB3UjF4K2RIa2lEWDR0QmU0NWFuUGNpMGhoaW10SldhUnJ1M3NscXNjNyYjeEE7TXBNbDBXOU5nSkFrVWhLamlPV1dNRXF0cjRtVzZQcnVoNjFiTmRhTnFOdHFWcWptSjU3T2FPZU1TQUJpaGFNc0F3REEwOThxbEVqbSYjeEE7bFI4d2E1THBOc2tzT25YV3BTeU1Rc0ZwR1hJQUZTem5vbzdlSjdEclN2SktRaVRFY1I3dVgzc29BRWdFME8vK3hpMGY1aDZ6Nml2SiYjeEE7bzk4VU0waWZWRTA2NjlYaXFuaURKVXFQaUZlZkNoNkFiMXpVeDEycU16SHdmOWtQOTF5UHU1dVhMVFl4RUhqSDQvbzh4OGYwc3kwaSYjeEE7K252OU10cnllMGxzSmJoQkkxbmNjZlZqcit5L0VzQWZiNzk4M0F1dCtiaElQVXZOM2xmUzc4MkdwNnJhMkYySWtuRWQxS2tIS09SbiYjeEE7UldWcENxdDhVVFZDbmJ2MUZZU3pRaWFKQUxtNE96dFJsaHg0OGNweHNqMGduY1VlbkxtUGY4Q3dQVWZ6MXRvcml0bnBRK29KWjIxNyYjeEE7TGQzOTBMWmxXN2tWRVgwWVk3dVN2Q1FTVSsweUFzcWxlSmJEbDJnQWFBNlh1YS9XOUZoOWs1R1BxbjYrT1VRSVI0dnBCSjNNb0RtTyYjeEE7SHVFcUJJUEVJenJ5aHI5enIvbDZ6MWE1c0cwNlM3aldWYlpwQktQVGtBZU4xa1VMeURJd1BRVU8zYk16RGtNNGlSRlc4OTJscEk2ZiYjeEE7UExIR1hHSW1ycXR4c2R2SS9yVG5MSEJZMUxlYTdEcnl6QjdpN3Q1cnhkTkdseHdlbGF3UkdINndieDdoNFRKSzRVRWNsa1dINHZSbyYjeEE7WlY1TkROT1VSSGdqeFdSZTlVT3ArSGR6YmNVSXl2aWx3MERXMTJlN3l2dlpMazJwTE5mMTZ6MFcyaXVidVJJNG5kZ3pTR1FBSkZESiYjeEE7Y1RNUFRqbEpLUVFPNEJBclNsUlhGVU5xWG5meXJwMXhQYTNOK3B1cldHUzV1N2VCSkxpU0NHSUtYa21TQlpHaVVDUlQ4WUdLcU9nLyYjeEE7bUg1TjErOE5sbzJwTGUzUVZYYUtPT1dvVjBNbkkxUUFLQUtNVHNyRlZhak1vS3FaYTVxRjlZMlhxMkZpZFJ2SGJqRGJDUklWSjRsaiYjeEE7eWtmWlJSYWRPdEI3NVRueW1BSERFeUpOZnAzUFFiZk9nNUdseFk1enJKUHc0OTlYOGgxL1ZhQ1R6bHBadTRyTjdYVTQ3aVV4cnZwbCYjeEE7KzhTdEtBUUd1STRYdHdGNWZFM3FjVjNxZHN1d0E1TVltTmdla3FqTDR4Ty80MmFNZ0VaR04zWFViZy9GTkxmVUxlZjZ0d1NZZldvVCYjeEE7Y1JlcEJOSFJCdzJrNW92cFArOUg3dVNqL2EyK0ZxU01TR05vbklwZVQvbkY1OS9NRHk5YTNYNkkwLzZ0WXgzMmxXNmFyV0ljcmU3OSYjeEE7WTNNbjFpNFdTMHRxU3hSUWNwMFpVNWNqOXRLWkhaOEJrelNqTWVrUnNlWitHKzNjTjNNMUdIRkhUNDV4bHhaSkdmRkgrYlhEdy9PeSYjeEE7YjVkT2NTblg1VWVidk9QbUp2TW42ZjBwN0t6MC9WcnUxMGU3bDlOWkpvVXVKVmFCMGlaNDJhMTRpTXlveFIrbFN5TXhzMWVHRU9IaCYjeEE7Tmt4Ri9qejduQmlXZlpoc25ZcTdGWFlxN0ZYWXE3RlhZcWdialF0RXVaWkpyblQ3YWVXYWhsa2toamRuNHFVWGtXQkpvakZSWHNhWiYjeEE7TVpaRGtTMW5GQW15QjhsditIUEwzMW9YZjZMdFByU3Y2cTNIb1Jlb0pPUmZtSDQ4dVhJOHErTytIeFoxVm12ZXZnd3U2Ris1V3NkSiYjeEE7MHJUekliQ3lndEROVDFqQkVrWmZqV25MZ0JXbkk5Y2pLY3BjemFZWTR4NUFCaitvL2xqNUwxSHpwWmVjYnpUMWwxcXhTa1RuKzZhUiYjeEE7ZVBwVHlSOUdsaEMwamZ0dFdwU01wSVpaQ1BEZXllRVhhZlQ2VGF6ek5NNzNBZG1SeUk3bTRqV3NZWUxSRWtWUUR6UElBVWJibFdneSYjeEE7RnNsU3p0WmJmMWhKZFMzWHF5dktucmVuKzZWOXhFbnBwSDhDOXVWVzk4U3J2cUVINlJHb2NwdlhFSnQrSHJ6ZWh3TGM2L1YrZm84NiYjeEE7ais4NGNxYlZwdGplMUtoTC93QXUyRjllaThubHZVbUVMMjRXM3ZyeTJpNFNLNmsrakJOSEY2bEpEeGs0ODFOQ0NDcTBsR1pBcmI1QiYjeEE7RkttbTZKWjZkTmRUVzhsMDczamg1UmMzZDFkSUNDeC9kSmNTU3JDUGlQd3hoUjA4QmdsSW4reGFhdlBMK2ozbXBXK3BYTnVKTHkxRCYjeEE7TEhKeWRRVlpIanBJaWtKS0ZXYVFMekI0OG00MDVIS3BZNGtna2JoeXNlc3l3eG5IRSttWDZ3ZGp6RzhZM1ZYUXZrRXd5YmpLTVZsWiYjeEE7dzNFOXpEQkhIY1hSVnJtWkVWWGxLTHdVeU1CVnVLaWdyMndDSUc3T1dXVW9pSkpNWThoM1gzZHpWOWF0ZFd4Z1c0bHR1VElXbGdLcSYjeEE7NVZYRE1nWmxiaUpGQlJpdEdBUHdsV293a0dDQjAveTliMnBnbG11YmkvdklYZVUzbDR5U1NzOGtZaVlyUlZTRlNxajRJVlJLNzhhayYjeEE7MUpraWtUcCttdFp5WEx0ZVhGMjExS1ptK3NPckJDVFFMRXFxaW9pcHhRS29wOFBJMWRuZGdTbEdZRldTd1FUS0ZtaldSUldnY0JodSYjeEE7cFU5ZkZXSStXS3FWcnAybjJqczlyYXhRTzRWWGFLTlVMTEdPS0FsUUtoVjJIaGlyZDVwOWhlcWkzbHRGY3JHeGFOWmtXUUt6STBiRiYjeEE7ZVFOQ1k1R1UreEk2SEpSa1J5S0RFSFlxc2NjY1VheHhxRWpRQlVSUUFvVUNnQUE2QVpGUUsyQzdGTHNWWVczbFQ4eHZRYUJQUExEOSYjeEE7OWRTUjNMYVhhR2NSU1FDTzBpWWdyRTNvU2oxWFlSQXlWNC9BTXl2RnhYOUhkL0VmajgrWGw1b29vcnk5NVo4NTJOell6Nno1eHVOWSYjeEE7V0NPWmIyMitvMk5yRGNTdTM3bHg2Y1psaldOQ1FWRWg1TlExQXFyUnlaWUVIaGh3L0VsUUN5ck1kTHNWZGlyc1ZkaXJzVmRpcnNWZCYjeEE7aXJzVmRpcnNWZGlyc1ZkaXJzVmRpcnNWZGlyc1ZkaXJzVmRpcnNWZGlyc1ZkaXJzVmRpcnNWZGlyc1ZkaXJzVmRpcnNWZGlyc1ZkaSYjeEE7cnNWWVA1ci9BRGs4a2VWL01DYUhxYzhyWEtSRzQxR2EzajlXR3hpb3ZCcnBsUEpUSnpVSXFxekdxN0RrdFpjSW9XUURJMEJlOGllNyYjeEE7OVBjTFBJRkFObWgzWCtQeHZ5NXNvdXZNWGwrMGJqZGFuYVc3ZldVc2FTenhvZnJVaUNSTGY0bUg3MWtZTXFmYUlOYVlCRTl5OFFYYSYjeEE7WHIyaDZ0SDZtbGFqYTZoR1VXVVBhelJ6RDAyZDQxZXNaYjRTOE1pZytLc094eE1TT2Fnckc4dzZPdXNwb3JYRk5Ua1ZuUzNLUHVxcSYjeEE7R1lodVBIWU1PK1kzNXJING5oMzYvY2VvSi9RZmxYTmJSVDM5aWtIcnZjUkxCOFg3MHVvVDRBelA4Uk5QaENNVDRVT1pDWFdsL1kzcSYjeEE7TkpaM0VWeWk4UXp3dXNnSE5GbFdwVW43VWNpdVA4a2c5RGlxQ2g4MGFETHExNXBDM2FycUZpeUpjUXlLOFk1U0xFeXJHN2hVbElGeiYjeEE7Rnk5TXR4TG9Hb1dXdGh3eUVSS3RqK1AwSDVGSEVPUytMWDlNZVMrVjVWZ1RUbldPNWxtZU5Bck9BUnlVdHpTdFJ4NXF2SUVGYXFRYyYjeEE7b2hNeW1ZZ0hiN2VZMkhQbUR2VkhwYkt2VHhlWkh5cjlmNEZXcFlhNW91bzNOM2E2ZnFGdGVYTmcvcFgwRUUwY3J3UFZsNFNxaEpScSYjeEE7b3dvM2dmRExwWTVSQUpCRjhtSUlLRTgxNmhxVmpwTFBwcWcza2pCRWtZS3l4cUFaSFpsWjBQMkVLZ3FyOFdJWW95QnN3TzBOVExCcCYjeEE7NTVZamlNUnkrTlh0MGo5UjViQTdqbTNZTVlua0VTYXNzSm04MHpTL3ZKZFlKdDUrQ3pTMmpTbjA0SitjQXVQc3dxRjVoRlVvZVJMRyYjeEE7bnhMdnkrUFVhZ1Q0cFpKMkNiL2R6b2NQMUV4SUVhajZlSVZ0ZSs3dVk0Y2NvMEl4NlY2NDc4WDBpN3YxYjhQZlRMdkkydFgrcitYNCYjeEE7TG0rUUM0VUlqU2N1VFMvdVVmMVhBamhqVXljK1FFZkplTkNEdnhYcXRIcURsaGNvbUV4dEtORVVmanZ5by9HdDZ0MVdyd0RGT29uaSYjeEE7Z2Q0bXdiSHc4N0h3dE1MalZaWU5ZZ3NIczVwSWJxR1NTQzdpUjVJMWtoM2VLY2hlRVBKV0JpWm1veERENFNGNVpKSURYREVaUk1ySCYjeEE7cHJydnYzRG1mT3VURXROODIrY0l2TWNOamZhWmNYZW5Yc3NjY2R4SGFTeENGcG8ydVpHK3NTK2tub1dxU1FRZnZZNDVKWEw4YXNoaiYjeEE7d1Nsd2k1VU54L0VPdTMzMEI3M056WWRPWVhDVlNBTzIrOUVEZm1BWmJ5MkpFYXE5N1o3a25XcEw1azh4emFLc0JpMGkvd0JXYWZsUiYjeEE7YkNKWk9KUXJzNVprQzFWbVlFOWVKSDJpb000UXZxQWdtbUx3Zm10ck03dnc4aTY0cUsvcGptTFJKQy9FU2NURzA0Y053K0ttKzJXbiYjeEE7QVA1dysxaHgrU2MrVmZPOS9ydC9MYVhQbGpWdEZXT0wxUmM2aEZHa1RHb0FqREk3MWNnazlLVUc1QjJ5RThZaU9ZTEtNcjZKOXFXciYjeEE7YWRwc1NTMzA0Z2prWmtSbUJOV1NONWlOZ2YySW1QMGVPUWpBeTVKSkFTa2ZtRDVPTncxc05TUTNDeHhUK2p3bDVtT2VFM0ViS3ZHciYjeEE7QXhLVzI2ZER1UU1tY0V3THJaaUpnbWxUUnZQSGxYV1p2UjA3VUZrbG9DRWRKSVNhbWc0aVZVNWIrR1ZNMFQ1azh4MkhsN1RSZjNpeSYjeEE7U2g1WXJlQzJnQWVlYWFad2lSd3hrcVpHMzVjUnZRSEtzMllZNDJkL0ljejduTjBHaG5xc25CQ2hzU1Nkb3hBRmt5UFFkTDVXUW9ueiYjeEE7YnBkdFppNTFxdWhLMXdiVlYxRjRJNnljRElQamprbGlveXFhSG4yeWpGcnNjK0xmaE1aY0pFdHFOWDlvNUhrZWpQOEFrM0pPZkRoLyYjeEE7ZmVuaTlBa2RycmtZaVhQeVJXbmVZdkwrcHM2NmJxZHBldEd3U1JiYWVPVXF6QmlvWUl6VUpDTlQ1SHd6SmprakxrUVduUG9jK0dqayYjeEE7aE9GL3pva2ZmN3g4MHd5Yml1eFYyS3V4VjJLdXhWMkt1eFZnWG1mOGwvS25tTFdkUTFLOG52SVYxbjZwK21yR0NTTVFYZjFFMWg5USYjeEE7dkc4MGZ3Z0lmUmtTb0hqVTRKUWpLY0prWFBGeGNCMzI0aFV2SS9FRmQ2SXZhVlg4RTd1Znk2OGpYRTE1UEpvbG9KNzlqSmR6eHhpSyYjeEE7UjVTWFByYzQrTExOKytmOTZwRC9BQkhmTFBFbDNzZUFkeVlhTjVhMERSRUs2VHA4Rm1XaWd0NUpJa0Fra2l0WS9TZ1dXVDdjbnBSLyYjeEE7Q3ZNbWd5SmtUelNBQTNlK1hkRHZidEx1NnM0NVowRHFXWUdqaVJQVFlTcVBobEhIWUJ3YWRzby9MNCtQajRSeDk5YjkzUDNMU0hsOCYjeEE7cGFWTGIrZzArb2hQcTZXbFUxUFVVZjA0NVBWVnZVVzREK3J5MmFXdnFNdndzeFhiTGtvL1Q5TnQ3QkpVZ2VkeEsvcU1iaTRudVNHNCYjeEE7cWxGTTd5RkZvZytGYUN0VFNwSktxSHVQTHVrejZpdCs5dkY2d3EwZ01NRGVwTHp0M1NWM2FOcE9hZlVvdUpEajdLMXFVUXJZTXNnSyYjeEE7djcvUDlaL0JLS1hhVG9HbDZYcGtHbTJ0dkVscmJnQlVXR0dKU1ZjeWN2VGhTS0lIMUdML0FBcUJ5TmNFOGtwU3NuZFFLVzZSb1ZycCYjeEE7a3Q1TkczcXkza3p5dEkwVnZHeUk4anpDRUdDS0VzaXl6U09ESnlmazdFc1NjTThobFhsNy93QlA0MlVDa3MvTWJ5dGYrYVBLRi9wRyYjeEE7blh6NmRxRXExdExsWkpvMDVqckhONkxJV2lrVWxHQjVBVjVjU1FNbnA4b2hNRWl3eHlSNGhUeVhYL0lubis1MDl0RWg4a1JQZXcycyYjeEE7YVFlWVY4eFhrMWdrdHZBeGorcjJWektrd0srcEpIQ3Nud3F6ZkVTbkluWVk5VkFTdmoyN3VBWDhUOS82Mm1XRUVWWDJ2WmZLZmxMUyYjeEE7L0sybXlhYnBaZjZrODhseEhISndKajlTbjdzT3FxN3F0S0taQ3owMjVVQUExMmJQTElibHpic2VNUUZCSFhVdXNyZHhMYVd0dExhRSYjeEE7cDY4MHR3OFVpZ2s4eWthd1NxeFZhRmF1dGVtM1UxZ1JyZm4rUE5ta3VtK1dackdWTGlPT2N6MjEyLzFkSnRiMU81amUya0NSTkxNcyYjeEE7L0pYa0VTOGxoZFdWWDNEZ3NYeVprQ1Q1OC9TQnY4UHY3dWpKT3RLMCtHeHRSRWtLeE9SSDZ6K284OGtqcEVrWE9XZVVlck00V01MeiYjeEE7a0paZ0JYS3pWb01pVVpnUWtQbUh5WHBPdmFucGVwWGp6eDNPa09KTFV3eUZGUDhBcEZ2Y2xaRTNXUlM5bkhzd05Pb280VmxuSElRQyYjeEE7Ty84QUg0KzNaaktBS2ZaQmtndFYwYlM5V2lqaDFHM1c1aWljeVJvOWFCMmplSXRzUnZ3bFllM1hya296TWVTREVIbWxhL2w5NU9TVSYjeEE7U3BwcXBLcEJTUlhsREtCSEpFb1JnMVZWWTVtVUtOZ0tBZlpXa3pubVJSTEVRQVZOSjhqZVZkSnZCZVdGZ0k3a0tFVjJrbGxvQlRjQyYjeEE7Um5BYjRmdFVyMThUbFRORitZUEwrbjY5cHJXRjhIVmVTeTI5eEMzcHp3VHhtc2M4RWczU1JEdUQ5QnFDUmxlVEdKaWk1ZWkxdVRUWiYjeEE7T09GZHhCM2pLSjV4a09vUFg5YTJ5OHZXVU5sQmJYak5xcjI4d3VvN3EvV0tTWDExTlVsSEZFUlhUb3JLb1BmclVuRzBuWitMQkV4ZyYjeEE7T2N1STJiSmtldG5xdVhXek16S0g3dmlIRFVMQTRlbzVra0h1SlB5WFdIbHJRTlB2cDcreTArQzN2YmhVamx1RVFCL1RqamppU05XLyYjeEE7WmpWWVVvaTBYYXRLNWt4eFJpYkEzWE5yOCtXQWhPY3BRanZWN1dTU1Q1bTVIYzc3MXlUTExIRWRpcnNWZGlyc1ZkaXJzVmRpcnNWZCYjeEE7aXJzVmRpcnNWZGlyc1ZkaXJzVmRpcnNWZGlyc1ZkaXJzVmRpcnNWZGlyc1ZkaXJzVmRpcnNWZGlyc1ZkaXJzVmRpcnNWZGlyc1ZkaSYjeEE7cnNWWVQ1ZC9NQWFqK1l2bUR5amNvWUx2VFZFdHJiVVVrVzBhUWt6eU1wWmYzNzNZTVlEazhWK05VYjdiR01pREk4cnI5dDlmMGJPVCYjeEE7cUl3akdIQ1FUS0pNdCtSdjZTT2xDdmVTYUpGTTJ4Y1pUK3MyL3JORDZpK3FxbGlsZDZDbFQ5SElWOEtqeEdWakxFeU1iM0g0L0h2SCYjeEE7ZUVrVno2ckpiNjBpWmxlVlE2Tkdqb0RWbE16Qkk2Z1ZJNU1kc0p5UkhNOTMyOG1Ka0Y2WEZ1OHNrS1NvMDBQSDFvMVlGazVDcThnTiYjeEE7eFVkSzRSSUVrQTdoYkNwa2t2SGRDODVmbXkzNTRhaG91cWFGTEY1Vm1MVzF0cUsyOTAxb3NGcWs4OEV5ekIzdHhMT1psU1J2OGxVbyYjeEE7R0ZNcUJuWTVWWnY5RHNKUTB3aEtqSXk0WUdQZHhlbmpCOVBUMWNQTGwxdDdGbHJyMERxMnIyMm1MYXRPck1MdTVoczQrSlFFU1R0eCYjeEE7VTBka0xBSHJ4cWFiMG9EaTE1TW9oVjlTQjgwRkw1eDBLMmdoZStuRnBjWERjWTdFc2s5eVNaREVBc1ZzMDVhcnFSOE5mQTc3WTAxLyYjeEE7bVlBYm1qM2N6enJwYUwwN3pCbytwVFNRMkZ5TGlTTGw2dkFNUW5GdVB4TlRpT1hWS240aHV0UUs0dGtNc1pHZ2IvSDRydjZKVjVuOCYjeEE7M2ZvYlh0RDB3aUZFMVUzTHlYRnlaRWpWTFJVZVJGa1JYQ3llbTdTTHpvcmNDdFFTRGtveHNFOTM0KzltVFMvVGZ6QzhtYWpGSkxCcSYjeEE7c0tSUkkwa2p6OHJkUXFQY28zeFRDTWZDYkNjc0IwVkN4K0doTXZDbDNmamI5WVhpQ2EyV3VhTGZTSkhaYWhiWFVraWVxaVF6UnlGayYjeEE7Q1JTY3dGSnF2QzVpYXZnNm45b1ZpWWtjd29JUVhuSHpmb3ZsTFFaOWExaWIwYldINFVWUUdra2tJSldPTkNWNXVhR2kxeUtYaXRuNSYjeEE7aC9QUzlnZldyYldvYiswdGZYa2lTRzF0NGJSN2dQNlppL2V2QmNUVzBjY2plbXhISXV1NEpVVnA4VW5rTERzam9JeG9UbUk1RC9EUiYjeEE7NjhySTYrVDB6OHFmUHQvNXIwdTdUVmt0STlaMDZWVnVUcDd1OXZMRE92cVc4NkxKKzlpOVJLL3U1ZmpGS2tEa0Jsc1pBaXc0T1hGTCYjeEE7SEl4a0trRTA4OStlYkx5ZHB0cGUzV24zK3FOZlhhV05yWmFYQ3R4Y3ZLOGNrb3BHengxSEdGdWhyN1paQ0JseWEwMjBEV2JiVzlDMCYjeEE7N1dyVkhqdGRUdFlieUJKUUJJc2R4R0pGRGhTeWhnRzNvVGtTS05LanNDdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VmpQblB5diYjeEE7cW11Q0EyV3QzMmtyRkZMQzhWZ3dUMVpKcFlHamtsYm5HM0NIMFc1Q05sa1pXWlZjVklaU0dMNmgrV2ZteTZ1N1JmOEFGbXBRdzI5aSYjeEE7YlNTYTNrdTR6UGNMWngyNlhVdis1SGpWWjZ6OFVpWGxSZzVZa015dHM1OHJhUmU2UDVmc3RNdnI5OVV1N1pDczJvU2Vyem1KWW5tMyYjeEE7clMzRDhqWGY0NmZ5aFZvb1VJOTdPMmttRXp4aHBLS3BKNkVJd2RLam9TakNxay9aM3AxT1FNQVRaSDQvWjA3a2NJWEMydHdzU0NKQSYjeEE7a0ZQUVVLS0pSU280RDluNFRUYnRoNEJ0dHk1TFFYUnh4eFJySEdvU05BRlJGQUNoUUtBQURvQmhBQUZCSUNUK2JyQ0RVZEhhd3VkTSYjeEE7azFhMG5kWHVMTkk3S1ZYVzNQMWxVa1MvSWhLeXZDc1A4d0xnZ3BUMUVLc1FYeUhaemF0UHE4ZWtYdW14MlA2T3ZyWFJrcy9MWHBUeiYjeEE7V052U0NDQ1QwNXAwa3R4V0htODZCQ3g5R1FKdUZXWitWckNXdzBhQzJjVHh4eEpIRkJhM0NXY2JReHd4SkNGVmJGVmdDdjZmcVVYbyYjeEE7V0lIRlFxS3FtRXRuYVRDWVN3UnlmV0kvUm41S0Q2a1E1VVI2L2FYNDIyUGlmSEZpWWczWTVxTjVwR24zdTExRjZvSEgwd1diOTIwZiYjeEE7TGhKRlEvdXBCek5KRW8zVGZZWW9sampMbitQZDNIekc3ZGhwVmxZZW9ZQkl6eTA5U1dhV1dlUWhhOFY5U1pwSDRyeU5GclFWUGljViYjeEE7aGpFZVg2L3ZXNnJwbGxmUUV6MkZ0Znp3cXh0bzdwVks4eU9uSXBJVURFQ3BDbjVIRm14eXkwdlZPRnRjV0hsYlN0SmFDNm5JaHVHUSYjeEE7VGVnaVRtQjBhMWlrU0dTV2U1a0pvejhFZHo4VE95aTR5NldTUHgrb01hVHpSOU1lT0sydmRSczdKTmZlRWZwSzZzNDZLMDhrY1N6KyYjeEE7bTdqMVNqRzNRRGthbFVTdjJSU3N5UExva0JqL0FPYm5sdld0ZjhuUGJhSEhETnE5dGMyMTFhUXp4VzBxT1k1QUhBK3RLeUl3alppciYjeEE7aWpBOUNNaVdVVFJ0aFZ2NWMxelFJck96bjBXOXZkUXNsZ2l0SmRPU09Xem1kWDV4dkpLN1FzbktRL3ZtZFBoM2JjYjVqeE1vRGhxMyYjeEE7YjVzZUxVWkRrNHhFSGNpWE1lN25lMzAvTHlaVCtVdmtYVnZLOGVzeWF2SGFMZDN0MSs1ZTFTSWw0RkJkWGVjUnhUeUZubGY0WlMzSCYjeEE7OWswT1c0NGNNYWNIVzZqeHNwbU9XMzJDbVc2OW9pYXRGYWoxZlF1TEs0VzZ0YmowMGxNY3FxeWNnc2daYThaR0ZhYmRSdnZqT1BFSyYjeEE7Y1FpMVdlejFGdE9qdHJlKzlDNFVSSzkzNllrY2hHVXkwVnl5Z3VnWlFXNWNTYS9GU2hJalFwSVViQ3k4d1JhakpQZmFwRmRXYnhoViYjeEE7czQ3VVE4SkFrWUxpVDFKR29YV1E4VFhabEZmaEpZcFRUQ2gyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMiYjeEE7S3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLc0dzL3pFdkpmeiYjeEE7Qmc4cVNhYTVXNnRXdllybU5hcWtDbVJUTkkvS25wbDQwUkNvUE12WDRhRGxqNHRRSjFRMlA0djNIb2V1em15MGRZZkZzYzZyOGZheiYjeEE7bk1od2tOcWVwV2VsNmJkNm5mU2VsWldNTWx6ZFMwWnVNVUtGM2Jpb0xHaXFkZ0s0cThrdVB6VDgrd1E2WHAyb3ZvSGwzekZXL2oxdyYjeEE7Nnc3cFpMTmJyYVQyOGR2SkhjdFV2YjZnaGFyTnVHcDAzVmVwZVdkWi9UZmx2U3RhOUg2ditrN08zdlBRNWMvVCtzUkxKdzVVWGx4NSYjeEE7VXJRWXFtUklIVTArZUtyZlZpcVJ6V29JQjNHeFBRWXFodEoxZlN0WTArSFVkS3ZJYi9UN2dFd1hkdElzc1Q4V0t0eGRDVlBGbEtudyYjeEE7SXBpcUpra2pqamFTUmdrYUFzN3NRQUFOeVNUMEdBa0FXVlNHeC9NRHlmZTNiMmtHcEl0eEdLdWt5eVFVclE5WmxRVjM2Wmp4MW1JOCYjeEE7cEJpSmdwK2pvNks2TUdSZ0NyQTFCQjNCQkdaQUlJc01rSytwMnFhbkZweE5iaVNKcGRpdEZBTkVWaFhseWtvNVRiY0kvd0RMa0RrQSYjeEE7a0k5VCtQN1BjZTVVWGxpdXhWai9BSnI4KytWdktrSm4xMjVsdDRFUVNUU3hXdHpkSkNqTndScDJ0b3BoQ3J2OEtHU25JZ2hhME5KUSYjeEE7anhHaFYrOGRVeEJKb2JzZ3lLSFlxc3VMaUMyZ2t1TGlSSWJlRkdrbW1rWUtpSW9xek14b0FBQlVrNENhM0tRTFFNUG1UUVpoYmhiKyYjeEE7QkpMdUNHNnQ0SlhFVXpRM0RySEMvcFNjWkFIa2RVRlYrMGVQWGJJUnl3SUJCRzR2NXNqamtMMjVJcTMxQ3d1WkpJcmE1aW1saC92VSYjeEE7amRYWktTUEY4UUJOUDNrTHB2OEF0S3c2ZzVNU0I1TVRFaFh3b2RpcnNWZGlyc1ZkaXJzVmRpcnNWZGlyc1ZRZDRkVU53c1ZtVWpSNyYjeEE7ZWNpNGtpOVZFdUFZeEJ6QW1oY3I4VGtvcS9GVDdhVUhNTTQ4TmI5NCtYWHArTzQ5QzdUOUZoMHk3MXZXNDdJUzZ2cWJpVzZlQUJKTCYjeEE7aExWVEZheEFUWER4aDFpVUx5NUlwSjVFTFVnQVJvazlXY3A4WERHL1NQc3ZuMC9XbmNiTThhc3lHTm1BSmphbkpTUjBQRXNLajJPUyYjeEE7YVNsdm1mVHJEVWRGbXRiL0FFdHRadGk4TWphYWhqQmxhR1pKVXI2MGtNWlZYUU15dTlHQXBRMW9WV0w2TjVmMTVmT1Z6NXExYlQ0MyYjeEE7MUY3VzFzWUhoVlZLUVNpSjUwVnZyZkJraW05Um01eEYrNk80NHg0cXpQVEpyNmJUYlNhL3R4YVgwa01iM2RxckNRUlNzb01rWWRkbSYjeEE7NHRVVkhYRlVCNWg4cjJXdWVrWjU1N2FTSkhoTHdGUGpnbGFONUlaRmxTVkdqZG9VNURqdUJ4UHdzeXRWa3hDWE56dEZyNTZlNkFJTiYjeEE7SGU5cEN3SkNpQ0NCSTBiMnUvcUVTQ1NIOHVPR3VUMzBtcXl5V0V0eWw0bGlxQ05sa2h1eGZRaHBVWWVvcTNFMTBTckpRaVJPalJCbSYjeEE7aCtYamQ3L2czOTVjazl0WlRBUjRZYlJNYnJlakNPTTh5YVBER080bzdkeGxabjVMOGxhWDVTMCs4dGJHV2U2bTFHOXVOVDFLK3VtViYjeEE7cHJpN3VtQmtsY1JyRkV1eXFvV05GV2c2VnFUa09vVDkwUjBaSFVNakFobElxQ0RzUVFjVll0UDVJczF2NUxxMnM3Sm91VVp0clhqUCYjeEE7YnJHc2NaQkRjSkhpZXNnVThSRW80MUJxVFhOZHFOQkNSNG94aVpYdmQxOW5uWFRmZGp3QmxFWmtNYW1SUXNoQTVxcExBR200QklXbyYjeEE7K2pOaEc2MzVzbU42NTVMYlZkYmcxSWFsSmFDRmFnUnhRelNDUldqYVBnYnBiaUZFVXg4LzdubnpvVmtRYzFmQWoyZkQ4eExOTDFHUSYjeEE7alYvdzhOL1QzWGZ6dmZkeUJxWlJpSXg5UE1iYldKYzc3KzczYklPZnlGcTR2R2UwODA2a3RuUGJ3MjEzYjNFa2tyZ1FLaXJQYlN4eSYjeEE7UWVqT3hpNU96SzZ1V2JraEJwbVFNSFAxUzVkLzJ1Wkx0UytIOTFpSERJeStqbmQrazcvVHZRNnhvVVFSYWM2SDVkbTAzVHJLem4xUyYjeEE7ODFCN0dlYVpMcTRsWnBabGs5VUpIY05VK29FV2IySEpWTkJTbVdReDhJQXNtdnh1NCtvMWZpVGxMZ2hIakFGUmpRRlY5UGNkdC9lZSYjeEE7OVcxRHkvYjMxK3Q0OXpjd242dExaeXh3U21NUEZNTjZPQjZzTGcwWVBBNk5VQ3BQRmFUbzNkL3ErVGhFYjJxUzZGcGNsOU5mdENSZSYjeEE7VHdtM2FkWGtSbGpPemVtVlllbXpmRHlkS00zRktrOEU0dERtMmVKS3VHOXU3OGU4L05ML0FDNTVCOG4rWExXMXR0SDB1RzNqc25rayYjeEE7dFhmbFBLa2t3SWtjVFRHU1hrNm5nVzVWNGdMOWxRQUJDSTVBTnVUVlpaM3hUbEs5alpKNWIvZW5WM2F3WGRyTmEzQzg0TGhHaW1TcCYjeEE7RlVjRldGUlFpb1BiQmtnSnhNVHlJcHBqSXhJSTVoanIvbDdvZkdXU010RHFGeTB2MS9VbGl0VGNYVWM1Y3lRM0hPRjRwSW05VDdKVCYjeEE7OWxmNVJsVWROR01hSE04enRadmM5T3Z1cHNPZVJObmtPbTlJM1FQS21uNkw2WmlkcmlTQzJqc3JhV2FLMldTSzNqMzlKWklZWVg0bCYjeEE7cU1ReE8rK1dZc1hBS3NuMy9kL2J2NXNNaytJMm5XV01IWXE3RlhZcTdGWFlxN0ZYWXE3RlhZcTdGWFlxN0ZYWXE3RlhZcTdGWFlxNyYjeEE7RlhZcTdGWFlxN0ZYWXE3RlhZcTdGWFlxN0ZYWXE3RlhZcTdGWFlxN0ZYWXE3RlhZcTdGWFlxN0ZYWXE3RlhZcTdGWFlxN2tLMHJ1ZCYjeEE7Z1B4eFYyS3V4VjFSaXJzVmRpcVhUZVlkR2cxZ2FQTmRMRnFKZ1M1RUxobEJpa21GdWg1a2NLdEt3UUx5NUVucGxSelFFdUVuMVZmMiYjeEE7MTk3bFIwV2FXTHhSRzRjWERmbUk4UjI1N1IzdXFRMDNtN1NvZEhnMWQ0TlJOcGNPWTQ0MDB2VVh1Z3dMQ3Nsb2x1MXpHdjdzL0U4WSYjeEE7SFRmNGxyYTRxYndUSlBCSE9nWUpLcXVva1JvM0FZVkhKSEN1cDhRd0JIZkZVSHFtdmFOcFhwRFVidU8yZWNnUXhzZmpZYzBqWmdncSYjeEE7M0JHbFRtOU9LQTFZZ2I1T0dPVXVRWVR5Ump6TlcyZGQwY2FuUHBiWGNhMzF2QUx1YUZqeEloclF2VTBVaGR1ZEQ4UEpTMU9TMWZEbCYjeEE7VjFzdml4c2l4dHo4bFRTOVVzTlYwK0hVTENZVDJsd3ZLT1FBcWRqUmxaV0FaV1ZnVlpXQVpTQ0NBUmduQXhOSG1tTWhJV053aXNpeSYjeEE7ZGlyc1ZkaXJnUVJVYmc5RGlyc1ZkaXJzVmRpcnNWZGlyc1ZkaXJzVmRpcnNWZGlyRkxueTE1a2Z6aGVheGJhbjlYdExpeUZxaWdoaSYjeEE7cGpkSGpBaE1YRDRXOVkrbzdPYVB4QVhybDV5UjhMaHJlNy9IMmZKcEVKZUp4WHRYNC9TbVowM3pBMXdrMzZXWlVWMVo3WllvZlRaSyYjeEE7Rm1TcGpML2JQRUVOOWdmemZGbERjbUZwSGVMemU2bER1L0drYUFDTmFEZmp0ejNQOHpIRlVuMXJ5N3FGL3JscmZ3WGNjTUVNRHd5SSYjeEE7eXplcHlNaXVHUjRaWUdIMmFIZnBVVVBMYkp4NW94Z1lrYjM1ZnBCL0h1Y1RMZ2xMSUpBN0FlZjZDUHg3MDJPblFHMlMzOVNmMDBEQiYjeEE7VDY4dlA0bFpUV1RsemJaalNyYkdoRzRHVWNadS93QkFjand4VmIvTW9vZlBJczBsMUh5WDVZMUxYSWRjdjdCTG5Vb0xkN1NPV1JuWiYjeEE7UFFrV1JIamFIbDZUcXl6T0R5VTljZHU0TXhPbzFVZmZ3eHYvQUUxY1ErQis5aXR0K1RGdmEyMFZ0YmVjZk5FTnZBaXh3d3g2a0VSRSYjeEE7UWNWVlZXSUFBQVVBR0xHMmVXVmhEWklVaGVaMFBEKy9tbG5JNElzWW8wek8yNm9PVys3VlkvRXpFcUdPNnQrWDJtMzJ0VGF4SE04RiYjeEE7M05KYVhMS2Zqait0V1BJUTNIR3F0eVZHNGNlWENtNVV0UWpIL0s0elBqSTdqOFJ5UDQyOG5hWSsyTThNQXdpdUVDVWJyZmhuOVVlNiYjeEE7aVJkMXhEcEt0a1BMK1hOaGJ6NmJOWko5ZCtveWM0NGRUbm1sdDRwQTBseUx4TGRSNmNsNmJwZ1d1SC9lVVptTGtqaWNxeDNPclZ2SSYjeEE7UGtUUy9LdHFpMmVtdzZmTkpZMlZyZExiM1Z4Y1JjclVTL0JHa3lvcUlIbWVUbXFxWkhkM2RlVzdSS29qeko1U3NOUXVwZFVNTWswMCYjeEE7bHFiVFVMV0Zpa3QzYXhDU1dHQ0p6TEFzTWkzRWdkWk9RN3F4cFFyZml6RUN2UGJ5UDIzczQrYlRSeUVFL0x2Ni9lQXd2VWZ5dnNySyYjeEE7UFViYlRiSFhaSUhoaDA2S08ydU5QYUI3TGw2L3B4QzZ1STVna1hwckczSjFma3hhUGQ1SE9WSFZFMFNZOS9YbjhCK092UnBPamlMNSYjeEE7L1p0dmUzeFp4NVI4czNYbCtCN1VhcGNYdW1lbkdMT3l1WWJTTnJadzBqUzhYdElvRUt2elFCZVB3OGRqUTBHSm15aWU5VWZqdjg3YyYjeEE7ckZqRUJRNUp6ZDJjZDBJbGtaZ2tiaVFvcEFEa0FoUTIxZmhZaHh4SUlZQTF6R25qRXF2b2IvSDMrOEJtUmFYMi9sdUcydVk1N2EvdiYjeEE7MDlPRXdMREpkU1hNWlVtUml6TGNtYmsvS1FIbWZpQVJWQjRjbGEweUpSR0lIOXBUQzFzbzdkblpaSlpHa3J5TXNyeURkM2srRldKViYjeEE7ZDVDUGhBMm92UlZBckVhWlVwNnJwc09wV0V0ak16TERQeEVvUWxTeUJnV1FrVVBGd09MRHVwT1c0NThKc01Na09JVWtHa2ZsOWFhUyYjeEE7L0t4MUs5aEFrTWpjWkZjeWxvNEZjem1WWmVUdTl0elpsNDE1RUhiSVp3TWt4UGtSSGgyNVZkMEIwK0hPaGQwS25waEhFSkRoRXVMdiYjeEE7NHR2bEljL05QTExUSmJhNW5uYS91YmtUeVBJME14ak1hbGxqUlZRS2lsRmpFWHdnSGNzeGJrVFVSRVNPcmJQSkVpaEVEbHVPTHo3eSYjeEE7ZWZYM0NxM3Nka21wMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eCYjeEE7VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWMkt1eFYyS3V4VjJLdXhWalBsWHp2cFd2NjE1ZzAyMjFDeXVaTkp2RiYjeEE7aHQ0N1daSkpHdC9xdHZJOGpoWGV2RzVsbGo1QUFWWGo5b0hMSjR6RUExelFDeWJLMG9iOUthWitrLzBWOWJoL1Nmby9XdnFIcUo2LyYjeEE7b2MvVDliMHE4L1Q1L0R5cFN1Mk5MYUpCQkZRYWpwdDdiWXE3RlhZcTdGWFlxaHRUdjROTzA2NjFDNHI2Rm5ESmNTOGFWNFJLWGFsUyYjeEE7QldnN25JeWxRSjUwaVJvV3h1MC9NV3d1OU52TlFpdFpWaGdkSXJWWElEelNTS1c0bmp5VktjVFhjN2IrMmFQSjIvamhqbmtNVFVTQSYjeEE7UDZSTjdlWEx6MitUWjJkak9xbnd4MkhlZTVrdGhmVzk5YVIzTUJQQ1FWNHNLTXA3cXc4Um16MFd1eGFuR01tTTNFL01IdVBuL2FObSYjeEE7V2JGTEhJeFBSVW51TGUzUVNUeXBDak9rWWVSZ29MeXVJNDFxZjJuZGdxanVUVE10cUpkYjNGdmMyOFZ6YlNwUGJ6b3NrTTBiQjBkSCYjeEE7SEpXVmxxQ3BCcUNNVkJ0VXhWUnZMMnlzYlo3cTl1STdXMmpwNms4enJIR3ZJaFJWbUlBcVNCaEFKTkJFcEFDenNnNzd6TDVjc05RZyYjeEE7MDIrMVd6dE5SdVRHdHRaejNFVWMwaG1aa2lDUnN3WmpJeU1xMEc1QkE2WUVwbGlyc1ZkaXJzVmRpcnNWZGlyc1ZkaXJzVmRpcnNWUyYjeEE7SzY4cHdUZVpiWFhWbkt5d0dVU3dPaU9yTExDSXVVYlVXU09SZUE0dnlORkxxQjhaT1lrTkhHT1dXUUhlWFBsMGp3OTErZlBuN3l5bCYjeEE7SXk0Ui9OdjdmMC9vUU50K1hXbFFRMnNhM0RGb29tdHIyWDZucFN0ZTJ6R01mVjduaFpxdnBDR0JZT01RVDkzMXF3Vmhsb3RQZEowNiYjeEE7NXNZNTF1TlN1ZFRlYVV5ckxkaTNEUnFWVlJFZ3Q0cmRlQzhhaW9MVkpxVGloUzh4K2FQTDNsclRIMVRYdFFnMDJ4U285YWR3dkpnaiYjeEE7UDZjYS9ha2tLb3hWRUJZMDJCeVVJR1JvQlNYay93Q1VuNWFhQjVXODUybm1TejF5MW10OWYwR0MxMEt3aXR6YlBkd1FXMWk4OThWWSYjeEE7Z3E4a2lGM2o0ay9IeUxWcU15cytZeWpWY2p2OXV6QUI3WG1HelNPOThybzgxNWQ2YmR5NmZmM2NodVdtV3NrWXVqYkxaaTRNUklEcyYjeEE7dHZHcXFqRXg4Z0hLRmhYTElUSElpL3YvQUZmWTBaY2N6dkNWR3VvdVB2clkzVzMxVjVNVDh2OEE1TlE2UDV3MUR6S3VxTkxOcVdudCYjeEE7cHQyaXBORks0a25SMm1OeXR4NnZxaUdKWWxrQkQxSHFPenlGbWFjOGtUeUJyMy9zWTQ4ZVVEMVNpWmVVU052OU1kK2U5L0ExdkxQSiYjeEE7L2xIVGZLdWxIVE5OamhqdG1rZWVSb29VaGVTZVZpWkpaQkh4anEzd2dCRVZWQTRxQW9WVnJuSUZ0eHhrT1pIeXI5SlJ1cmFVK28yOCYjeEE7MEF2cnF5V2FHU0JudEhXTjE5VkdRU0k1Vm1WMDU4bEkvYUE2MHhFNkZVRVN4a3lFdUlpdW0xSDM3WDhpRW5meU5JMFlpSG1UV2xoViYjeEE7cmxrUVhTY2d0eGEvVkkwTXBpOVZoYnIrOGlMT1c5VDk1SVhiZkJ4TmxKNWI2ZTBPbzNsODEzY1RmV3hFaTIwakQwSUZoRGJRb3FyUSYjeEE7dXpzenMxV093cnhWUXNVc1UvTnp5NTV4MTd5MWIydmxYVVUweStndkk3bTRuZVNlT3NFVWNoS3I5WFNSMmIxQ2pLdE9vOGFaazZYTiYjeEE7anhrbWNlSVZ5ODJNc1puUUJyNDB4Mzh2N3FYVjlEMGJVYjdUcmp6QzJyeTNiU2FwYlcxdlplaTBOODhEM0Y0UHJVVVlFa1BwY1lvVSYjeEE7ZHFwSTN4bHMwZXA3TzBtczlVc2RSSkpyaWwxb0U3RWMrRU8wMUdISm9NczhNWldkdUlnY3pWL1pkWHRmT21kZVRKZFhrMHAvMHBZUCYjeEE7cHN5U0JFZ2tqaGlZZ1F4K3BKU0M4MUpTclRjeXRaQVZXaWtIanpmTDB1a3hZSWNHS0lqSHkrODk1OHp1NitjekkyVGEzenA1ZDFEVyYjeEE7OU5STk92UHFXb1duMW1Xem1xeS92cHJDNXM0ejZpSGxId2E2RDhsQlB3OU11a0xhY2tESWJjLzJKWDVDL0wyNDh0NkRvTmxQcWx3MSYjeEE7eHBTU202Z3RwQ3RuTzh6VFB4ZU53eEt4RzZiaVY0Y3lGWndlS0JSR05Caml4Y0lBdmt5ejZqQitrUHIvQUNsOWYwdlE0ZXRMNlBEbCYjeEE7enI2SEwwZWRmMitIS20xYVpOdHJlMHI4MitYcjNYTFd6dGJhL2JUNDRybjFicDBWbWQ0dlJranBIUms0eW84aXl4T2VRU1JGYmlhVSYjeEE7eTNGa0VDU1JmNC9BUGt4eVE0aFNWYWwrWHEzUG1JNjNEUFp0TTg2M2NrZC9wdHRkbGJpMnQzaXNtaW1Ib1RvSVpKUFVOWkdiYmlqUiYjeEE7Z3R5WXpoVkdPL2ZmbjhmY1AwcElQZWpYMGJ6d2J1M2RmTXNDMmdtaG12SVRweWwyQ0ZETkJCSjZ3RVVVZ1Jndk5KSkY1SDQyK0doRSYjeEE7OGRmU2V2WDVYdDArSHVXajNza3lsazdGWFlxLy85az08L3htcEdJbWc6aW1hZ2U+CiAgICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICA8L3JkZjpBbHQ+CiAgICAgICAgIDwveG1wOlRodW1ibmFpbHM+CiAgICAgICAgIDx4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ+dXVpZDo5RTNFNUM5QThDODFEQjExODczNERCNThGRERFNEJBNzwveG1wTU06T3JpZ2luYWxEb2N1bWVudElEPgogICAgICAgICA8eG1wTU06RG9jdW1lbnRJRD54bXAuZGlkOmNmMDUyOTk0LTAyNGQtZDA0YS05YWYxLTdhZjFkOWIwNWMzYzwveG1wTU06RG9jdW1lbnRJRD4KICAgICAgICAgPHhtcE1NOkluc3RhbmNlSUQ+eG1wLmlpZDpjZjA1Mjk5NC0wMjRkLWQwNGEtOWFmMS03YWYxZDliMDVjM2M8L3htcE1NOkluc3RhbmNlSUQ+CiAgICAgICAgIDx4bXBNTTpSZW5kaXRpb25DbGFzcz5wcm9vZjpwZGY8L3htcE1NOlJlbmRpdGlvbkNsYXNzPgogICAgICAgICA8eG1wTU06RGVyaXZlZEZyb20gcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICA8c3RSZWY6aW5zdGFuY2VJRD54bXAuaWlkOmFiMTMzMWQ5LTQzYjUtMTQ0My05OTdmLTg3OWI4MmQ1ODRkZDwvc3RSZWY6aW5zdGFuY2VJRD4KICAgICAgICAgICAgPHN0UmVmOmRvY3VtZW50SUQ+eG1wLmRpZDphYjEzMzFkOS00M2I1LTE0NDMtOTk3Zi04NzliODJkNTg0ZGQ8L3N0UmVmOmRvY3VtZW50SUQ+CiAgICAgICAgICAgIDxzdFJlZjpvcmlnaW5hbERvY3VtZW50SUQ+dXVpZDo5RTNFNUM5QThDODFEQjExODczNERCNThGRERFNEJBNzwvc3RSZWY6b3JpZ2luYWxEb2N1bWVudElEPgogICAgICAgICAgICA8c3RSZWY6cmVuZGl0aW9uQ2xhc3M+cHJvb2Y6cGRmPC9zdFJlZjpyZW5kaXRpb25DbGFzcz4KICAgICAgICAgPC94bXBNTTpEZXJpdmVkRnJvbT4KICAgICAgICAgPHhtcE1NOkhpc3Rvcnk+CiAgICAgICAgICAgIDxyZGY6U2VxPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OmFjdGlvbj5zYXZlZDwvc3RFdnQ6YWN0aW9uPgogICAgICAgICAgICAgICAgICA8c3RFdnQ6aW5zdGFuY2VJRD54bXAuaWlkOjkzNzRhYTgwLTAzZTktNmQ0NS1hYWFlLTZjZmYzZjlkMDg5ODwvc3RFdnQ6aW5zdGFuY2VJRD4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OndoZW4+MjAyMS0wMS0wNVQwOToxMToyNS0wNTowMDwvc3RFdnQ6d2hlbj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OnNvZnR3YXJlQWdlbnQ+QWRvYmUgSWxsdXN0cmF0b3IgMjQuMCAoV2luZG93cyk8L3N0RXZ0OnNvZnR3YXJlQWdlbnQ+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDpjaGFuZ2VkPi88L3N0RXZ0OmNoYW5nZWQ+CiAgICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OmFjdGlvbj5zYXZlZDwvc3RFdnQ6YWN0aW9uPgogICAgICAgICAgICAgICAgICA8c3RFdnQ6aW5zdGFuY2VJRD54bXAuaWlkOmNmMDUyOTk0LTAyNGQtZDA0YS05YWYxLTdhZjFkOWIwNWMzYzwvc3RFdnQ6aW5zdGFuY2VJRD4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OndoZW4+MjAyMS0wNC0xM1QwODo0NDo0NC0wNTowMDwvc3RFdnQ6d2hlbj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OnNvZnR3YXJlQWdlbnQ+QWRvYmUgSWxsdXN0cmF0b3IgMjQuMCAoV2luZG93cyk8L3N0RXZ0OnNvZnR3YXJlQWdlbnQ+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDpjaGFuZ2VkPi88L3N0RXZ0OmNoYW5nZWQ+CiAgICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICA8L3JkZjpTZXE+CiAgICAgICAgIDwveG1wTU06SGlzdG9yeT4KICAgICAgICAgPHhtcE1NOk1hbmlmZXN0PgogICAgICAgICAgICA8cmRmOlNlcT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpsaW5rRm9ybT5FbWJlZEJ5UmVmZXJlbmNlPC9zdE1mczpsaW5rRm9ybT4KICAgICAgICAgICAgICAgICAgPHN0TWZzOnJlZmVyZW5jZSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXExPR09TIFDDgUdJTkEgV0VCXFRFUlBFTC5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICAgICA8L3N0TWZzOnJlZmVyZW5jZT4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RNZnM6bGlua0Zvcm0+RW1iZWRCeVJlZmVyZW5jZTwvc3RNZnM6bGlua0Zvcm0+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpyZWZlcmVuY2UgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICAgICA8c3RSZWY6ZmlsZVBhdGg+QzpcVXNlcnNcVXNlciBNaWNyb3NvZnRcRGVza3RvcFxsb2dvLTEucG5nPC9zdFJlZjpmaWxlUGF0aD4KICAgICAgICAgICAgICAgICAgPC9zdE1mczpyZWZlcmVuY2U+CiAgICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0TWZzOmxpbmtGb3JtPkVtYmVkQnlSZWZlcmVuY2U8L3N0TWZzOmxpbmtGb3JtPgogICAgICAgICAgICAgICAgICA8c3RNZnM6cmVmZXJlbmNlIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgICAgPHN0UmVmOmZpbGVQYXRoPkM6XFVzZXJzXFVzZXIgTWljcm9zb2Z0XERlc2t0b3BcTE9HT1MgUMOBR0lOQSBXRUJcUEFMRVJNTy5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICAgICA8L3N0TWZzOnJlZmVyZW5jZT4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RNZnM6bGlua0Zvcm0+RW1iZWRCeVJlZmVyZW5jZTwvc3RNZnM6bGlua0Zvcm0+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpyZWZlcmVuY2UgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICAgICA8c3RSZWY6ZmlsZVBhdGg+QzpcVXNlcnNcVXNlciBNaWNyb3NvZnRcRGVza3RvcFxhcmdvcy5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICAgICA8L3N0TWZzOnJlZmVyZW5jZT4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RNZnM6bGlua0Zvcm0+RW1iZWRCeVJlZmVyZW5jZTwvc3RNZnM6bGlua0Zvcm0+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpyZWZlcmVuY2UgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICAgICA8c3RSZWY6ZmlsZVBhdGg+QzpcVXNlcnNcVXNlciBNaWNyb3NvZnRcRGVza3RvcFx6b25hLWZyYW5jYS1sb2dvLnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgICAgIDwvc3RNZnM6cmVmZXJlbmNlPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpsaW5rRm9ybT5FbWJlZEJ5UmVmZXJlbmNlPC9zdE1mczpsaW5rRm9ybT4KICAgICAgICAgICAgICAgICAgPHN0TWZzOnJlZmVyZW5jZSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXExvZ29Vbml2ZXJzaWRhZGRlbGFDb3N0YUNVQy5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICAgICA8L3N0TWZzOnJlZmVyZW5jZT4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RNZnM6bGlua0Zvcm0+RW1iZWRCeVJlZmVyZW5jZTwvc3RNZnM6bGlua0Zvcm0+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpyZWZlcmVuY2UgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICAgICA8c3RSZWY6ZmlsZVBhdGg+QzpcVXNlcnNcVXNlciBNaWNyb3NvZnRcRGVza3RvcFxMT0dPUyBQw4FHSU5BIFdFQlxQRVRST05PUlRFLnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgICAgIDwvc3RNZnM6cmVmZXJlbmNlPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpsaW5rRm9ybT5FbWJlZEJ5UmVmZXJlbmNlPC9zdE1mczpsaW5rRm9ybT4KICAgICAgICAgICAgICAgICAgPHN0TWZzOnJlZmVyZW5jZSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXFBVRVJUTyBkZSBCcS4gTE9HTyAxLnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgICAgIDwvc3RNZnM6cmVmZXJlbmNlPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpsaW5rRm9ybT5FbWJlZEJ5UmVmZXJlbmNlPC9zdE1mczpsaW5rRm9ybT4KICAgICAgICAgICAgICAgICAgPHN0TWZzOnJlZmVyZW5jZSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXHNlbXBlcnRleC1sb2dvLWJhbm5lci5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICAgICA8L3N0TWZzOnJlZmVyZW5jZT4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RNZnM6bGlua0Zvcm0+RW1iZWRCeVJlZmVyZW5jZTwvc3RNZnM6bGlua0Zvcm0+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpyZWZlcmVuY2UgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICAgICA8c3RSZWY6ZmlsZVBhdGg+QzpcVXNlcnNcVXNlciBNaWNyb3NvZnRcRGVza3RvcFxTT0xVVEVDLnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgICAgIDwvc3RNZnM6cmVmZXJlbmNlPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpsaW5rRm9ybT5FbWJlZEJ5UmVmZXJlbmNlPC9zdE1mczpsaW5rRm9ybT4KICAgICAgICAgICAgICAgICAgPHN0TWZzOnJlZmVyZW5jZSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXExPR09TIFDDgUdJTkEgV0VCXEZVTkRBQ0lPTiBDQVJESU9UT1JBQ0lDQSBDT0xPTUJJQU5BLnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgICAgIDwvc3RNZnM6cmVmZXJlbmNlPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpsaW5rRm9ybT5FbWJlZEJ5UmVmZXJlbmNlPC9zdE1mczpsaW5rRm9ybT4KICAgICAgICAgICAgICAgICAgPHN0TWZzOnJlZmVyZW5jZSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXGxvZ28tZ3JlZW4tMi5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICAgICA8L3N0TWZzOnJlZmVyZW5jZT4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RNZnM6bGlua0Zvcm0+RW1iZWRCeVJlZmVyZW5jZTwvc3RNZnM6bGlua0Zvcm0+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpyZWZlcmVuY2UgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICAgICA8c3RSZWY6ZmlsZVBhdGg+QzpcVXNlcnNcVXNlciBNaWNyb3NvZnRcRGVza3RvcFxsb2dvLWNsaW5pY2EtY2VudHJvLnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgICAgIDwvc3RNZnM6cmVmZXJlbmNlPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpsaW5rRm9ybT5FbWJlZEJ5UmVmZXJlbmNlPC9zdE1mczpsaW5rRm9ybT4KICAgICAgICAgICAgICAgICAgPHN0TWZzOnJlZmVyZW5jZSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXExPR09TIFDDgUdJTkEgV0VCXElST1RBTUEgUkVTT1JULnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgICAgIDwvc3RNZnM6cmVmZXJlbmNlPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpsaW5rRm9ybT5FbWJlZEJ5UmVmZXJlbmNlPC9zdE1mczpsaW5rRm9ybT4KICAgICAgICAgICAgICAgICAgPHN0TWZzOnJlZmVyZW5jZSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXHNucC5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICAgICA8L3N0TWZzOnJlZmVyZW5jZT4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RNZnM6bGlua0Zvcm0+RW1iZWRCeVJlZmVyZW5jZTwvc3RNZnM6bGlua0Zvcm0+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpyZWZlcmVuY2UgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICAgICA8c3RSZWY6ZmlsZVBhdGg+QzpcVXNlcnNcVXNlciBNaWNyb3NvZnRcRGVza3RvcFxsYSBjYXllbmEgbG9nby5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICAgICA8L3N0TWZzOnJlZmVyZW5jZT4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RNZnM6bGlua0Zvcm0+RW1iZWRCeVJlZmVyZW5jZTwvc3RNZnM6bGlua0Zvcm0+CiAgICAgICAgICAgICAgICAgIDxzdE1mczpyZWZlcmVuY2UgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICAgICA8c3RSZWY6ZmlsZVBhdGg+QzpcVXNlcnNcVXNlciBNaWNyb3NvZnRcRGVza3RvcFxsb2dvX2N1bF8yMDE1LnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgICAgIDwvc3RNZnM6cmVmZXJlbmNlPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgPC9yZGY6U2VxPgogICAgICAgICA8L3htcE1NOk1hbmlmZXN0PgogICAgICAgICA8eG1wTU06SW5ncmVkaWVudHM+CiAgICAgICAgICAgIDxyZGY6QmFnPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0UmVmOmZpbGVQYXRoPkM6XFVzZXJzXFVzZXIgTWljcm9zb2Z0XERlc2t0b3BcTE9HT1MgUMOBR0lOQSBXRUJcVEVSUEVMLnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0UmVmOmZpbGVQYXRoPkM6XFVzZXJzXFVzZXIgTWljcm9zb2Z0XERlc2t0b3BcbG9nby0xLnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0UmVmOmZpbGVQYXRoPkM6XFVzZXJzXFVzZXIgTWljcm9zb2Z0XERlc2t0b3BcTE9HT1MgUMOBR0lOQSBXRUJcUEFMRVJNTy5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXGFyZ29zLnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0UmVmOmZpbGVQYXRoPkM6XFVzZXJzXFVzZXIgTWljcm9zb2Z0XERlc2t0b3Bcem9uYS1mcmFuY2EtbG9nby5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXExvZ29Vbml2ZXJzaWRhZGRlbGFDb3N0YUNVQy5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXExPR09TIFDDgUdJTkEgV0VCXFBFVFJPTk9SVEUucG5nPC9zdFJlZjpmaWxlUGF0aD4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RSZWY6ZmlsZVBhdGg+QzpcVXNlcnNcVXNlciBNaWNyb3NvZnRcRGVza3RvcFxQVUVSVE8gZGUgQnEuIExPR08gMS5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXHNlbXBlcnRleC1sb2dvLWJhbm5lci5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXFNPTFVURUMucG5nPC9zdFJlZjpmaWxlUGF0aD4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RSZWY6ZmlsZVBhdGg+QzpcVXNlcnNcVXNlciBNaWNyb3NvZnRcRGVza3RvcFxMT0dPUyBQw4FHSU5BIFdFQlxGVU5EQUNJT04gQ0FSRElPVE9SQUNJQ0EgQ09MT01CSUFOQS5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXGxvZ28tZ3JlZW4tMi5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXGxvZ28tY2xpbmljYS1jZW50cm8ucG5nPC9zdFJlZjpmaWxlUGF0aD4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0iUmVzb3VyY2UiPgogICAgICAgICAgICAgICAgICA8c3RSZWY6ZmlsZVBhdGg+QzpcVXNlcnNcVXNlciBNaWNyb3NvZnRcRGVza3RvcFxMT0dPUyBQw4FHSU5BIFdFQlxJUk9UQU1BIFJFU09SVC5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXHNucC5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdFJlZjpmaWxlUGF0aD5DOlxVc2Vyc1xVc2VyIE1pY3Jvc29mdFxEZXNrdG9wXGxhIGNheWVuYSBsb2dvLnBuZzwvc3RSZWY6ZmlsZVBhdGg+CiAgICAgICAgICAgICAgIDwvcmRmOmxpPgogICAgICAgICAgICAgICA8cmRmOmxpIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgICAgICAgPHN0UmVmOmZpbGVQYXRoPkM6XFVzZXJzXFVzZXIgTWljcm9zb2Z0XERlc2t0b3BcbG9nb19jdWxfMjAxNS5wbmc8L3N0UmVmOmZpbGVQYXRoPgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgPC9yZGY6QmFnPgogICAgICAgICA8L3htcE1NOkluZ3JlZGllbnRzPgogICAgICAgICA8aWxsdXN0cmF0b3I6U3RhcnR1cFByb2ZpbGU+QmFzaWMgUkdCPC9pbGx1c3RyYXRvcjpTdGFydHVwUHJvZmlsZT4KICAgICAgICAgPGlsbHVzdHJhdG9yOkNyZWF0b3JTdWJUb29sPkFkb2JlIElsbHVzdHJhdG9yPC9pbGx1c3RyYXRvcjpDcmVhdG9yU3ViVG9vbD4KICAgICAgICAgPHBkZjpQcm9kdWNlcj5BZG9iZSBQREYgbGlicmFyeSAxNS4wMDwvcGRmOlByb2R1Y2VyPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgIAo8P3hwYWNrZXQgZW5kPSJ3Ij8+/9sAQwANCQoLCggNCwoLDg4NDxMgFRMSEhMnHB4XIC4pMTAuKS0sMzpKPjM2RjcsLUBXQUZMTlJTUjI+WmFaUGBKUVJP/9sAQwEODg4TERMmFRUmTzUtNU9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09P/8AAEQgCjQK9AwERAAIRAQMRAf/EABwAAQACAwEBAQAAAAAAAAAAAAAGBwEEBQIDCP/EAFQQAQACAQMCAwMGBwwFCgUFAAABAgMEBREGEiExQQcTUSJhcYGRoRQyNkKxstIVFiNSVXODkpPBwtEXM1R0oiQmNEVTYnKUs+IlRILh8GNkhKPD/8QAGgEBAQADAQEAAAAAAAAAAAAAAAECAwQFBv/EACgRAQEAAgEDBAICAgMAAAAAAAABAhEDBBIxExQhUQVBFSIksWFxgf/aAAwDAQACEQMRAD8As4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/Z";

            // Agrupar por Reembolso (documentoReembolso)
            const groups = this._groupBy(aAll, (r) => String(r?.documentoReembolso || r?.documentoreembolso || "SIN_REEMBOLSO"));
            const docKeys = Object.keys(groups);

            const content = [];

            docKeys.forEach((docKey, idx) => {
                const a = groups[docKey] || [];
                const h = a[0] || {};

                const sReembolso = String(h.documentoReembolso || docKey || "");
                const sCliente = String(h.taxnumber1 || "");
                const sNombre = String(h.customername || "");
                const sDireccion = String(h.streetname || "");
                const sProyecto = String(h.definicionProyecto || "");
                const sDescProyecto = String(h.projectdescription || "");
                const sConsecutivo = String(h.consecutivo || "");

                // HEADER: título + logo (similar a la imagen)
                content.push({
                    layout: "noBorders",
                    table: {
                        widths: ["*", 170],
                        body: [[
                            {
                                text: "SOPORTE DE DOCUMENTOS PARA OXA",
                                bold: true,
                                fontSize: 14,
                                alignment: "center",
                                margin: [0, 18, 0, 0]
                            },
                            {
                                image: sLogoConconcreto,
                                fit: [200, 100],
                                alignment: "right",
                                margin: [0, 0, 0, 0]
                            }
                        ]]
                    },
                    margin: [0, 0, 0, 14]
                });

                // Datos cabecera
                content.push({
                    layout: "noBorders",
                    table: {
                        widths: [70, 200, 70, "*"],
                        body: [
                            [
                                { text: "Cliente:", bold: true },
                                { text: sCliente },
                                { text: "Consecutivo:", bold: true },
                                { text: sConsecutivo }
                            ],
                            [
                                { text: "Dirección:", bold: true },
                                { text: sDireccion },
                                { text: "Nombre:", bold: true },
                                { text: sNombre }
                            ],
                            [
                                { text: "Proyecto:", bold: true },
                                { text: sProyecto },
                                { text: "Descripción:", bold: true },
                                { text: sDescProyecto }
                            ]
                        ]
                    },
                    fontSize: 10,
                    margin: [0, 0, 0, 18]
                });

                // Tabla detalle
                const headerRow = [
                    { text: "Clase de Documento", style: "th" },
                    { text: "Documento", style: "th" },
                    { text: "Fecha", style: "th" },
                    { text: "Valor Bruto", style: "th", alignment: "right" },
                    { text: "Valor IVA", style: "th", alignment: "right" },
                    { text: "Valor", style: "th", alignment: "right" }
                ];

                const bodyRows = (a || []).map((r) => ([
                    String(r.accountingdocumenttypename || ""),
                    String(r.documentoReembolso || sReembolso || ""),
                    this._formatDDMMYYYY(String(r.documentdate || "")),
                    { text: nf0.format(Number(r.valorBruto || 0)), alignment: "right" },
                    { text: nf0.format(Number(r.valorIva || 0)), alignment: "right" },
                    { text: nf0.format(Number(r.valorTotal || 0)), alignment: "right" }
                ]));

                const totalBruto = this._sumByField(a, "valorBruto");
                const totalIva = this._sumByField(a, "valorIva");
                const totalTotal = this._sumByField(a, "valorTotal");

                const totalRow = [
                    { text: "Total", bold: true },
                    "",
                    "",
                    { text: nf0.format(totalBruto), bold: true, alignment: "right" },
                    { text: nf0.format(totalIva), bold: true, alignment: "right" },
                    { text: nf0.format(totalTotal), bold: true, alignment: "right" }
                ];

                content.push({
                    table: {
                        headerRows: 1,
                        widths: [50, 70, 80, 80, 90, 80],
                        body: [headerRow].concat(bodyRows).concat([totalRow])
                    },
                    fontSize: 10,
                    layout: {
                        hLineWidth: function () { return 0.8; },
                        vLineWidth: function () { return 0.8; },
                        paddingLeft: function () { return 4; },
                        paddingRight: function () { return 4; },
                        paddingTop: function () { return 3; },
                        paddingBottom: function () { return 3; }
                    }
                });

                if (idx < docKeys.length - 1) {
                    content.push({ text: "", pageBreak: "after" });
                }
            });

            return {
                pageSize: "A4",
                pageOrientation: "portrait",
                pageMargins: [40, 30, 40, 30],
                content: content,
                styles: {
                    th: { bold: true, alignment: "center" }
                },
                defaultStyle: { fontSize: 10 }
            };
        },

        _loadPDFMakeFromCDN_SoporteOxa: function () {
            if (window._loadingPDFMake) return;
            window._loadingPDFMake = true;

            const script1 = document.createElement('script');
            script1.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js';
            script1.onload = () => {
                const script2 = document.createElement('script');
                script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.js';
                script2.onload = () => {
                    window._loadingPDFMake = false;
                    this.onSoporteOxaPdf();
                };
                document.head.appendChild(script2);
            };
            script1.onerror = () => { window._loadingPDFMake = false; };
            document.head.appendChild(script1);
        },



        _loadPDFMakeFromCDN_SoporteIva: function () {
            if (window._loadingPDFMake) return;
            window._loadingPDFMake = true;

            const script1 = document.createElement('script');
            script1.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/pdfmake.min.js';
            script1.onload = () => {
                const script2 = document.createElement('script');
                script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/vfs_fonts.js';
                script2.onload = () => {
                    window._loadingPDFMake = false;
                    this.onSoporteIvaPdf();
                };
                document.head.appendChild(script2);
            };
            script1.onerror = () => { window._loadingPDFMake = false; };
            document.head.appendChild(script1);
        },



        _buildPdfMakeDocDefinition: function (aAll) {
            const nf0 = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

            const groups = this._groupBy(aAll, r => String(r.documentoreembolso || "SIN_DOCUMENTO"));
            const docKeys = Object.keys(groups);

            // anchos aproximados (basados en el autoTable previo)
            const widths = [35, 45, 45, 45, 45, 75, 45, 45, 45, 40, 40, 40, 40, 45]; // ✅ 14 columnas (sin IVA VIS)

            const content = [];

            docKeys.forEach((docKey, idx) => {
                const a = groups[docKey] || [];
                const h = a[0] || {};

                const cliente = (h.clienteniflargo && String(h.clienteniflargo).trim())
                    ? h.clienteniflargo
                    : (h.nit || "");

                const nombreCliente = h.nombre2 || h.nombre || "";
                const telefono = h.telefono || "";
                const proyecto = h.proyecto || h.definicionproyecto || "";
                const descProyecto = h.descripcionproyecto || "";
                const direccion = h.calle || "";

                const totalSoporte = this._sum(a, "valortotalcosto");

                /*content.push({
                    text: "Soporte de Reembolso",
                    style: "reportTitle",
                    alignment: "center",
                    margin: [0, 0, 0, 10]
                });*/

                // Resumen (2 columnas) - equivalente a kv() en jsPDF
                content.push({
                    layout: "noBorders",
                    table: {
                        widths: [90, "*", 90, "*"],
                        body: [
                            [{ text: "Documento:", bold: true }, String(docKey || ""), "", ""],
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
                const buildHeaderRow = () => ([
                    { text: "Clase\nDocumento", style: "tableHeader" },
                    { text: "Documento", style: "tableHeader" },
                    { text: "Fecha", style: "tableHeader" },
                    { text: "Referencia", style: "tableHeader" },
                    { text: "NIT", style: "tableHeader" },
                    { text: "Nombre", style: "tableHeader" },
                    { text: "Valor Total\nDel Costo", style: "tableHeader" },
                    { text: "IVA Mayor\nvalor del costo", style: "tableHeader" },
                    //{ text: "IVA VIS", style: "tableHeader" },
                    { text: "Valor Facturado\na Reembolsar", style: "tableHeader" },
                    { text: "Valor\nRte Fte", style: "tableHeader" },
                    { text: "Valor\nRte IVA", style: "tableHeader" },
                    { text: "Valor\nRte ICA", style: "tableHeader" },
                    { text: "Valor\nRte GAR", style: "tableHeader" },
                    { text: "Valor Neto-\nRTE", style: "tableHeader" }
                ]);

                const rowFor = (r) => ([
                    String(r.documenttype || r.clasedocumento || ""),
                    String(r.accountingdocument || r.documento || ""),
                    String(r.fecha || ""),
                    String(r.ledgergllineitem || r.referencia || ""),
                    String(r.nit || ""),
                    String(r.nombre || r.nombre2 || ""),
                    { text: nf0.format(Number(r.valortotalcosto || 0)), alignment: "right", noWrap: true },
                    { text: nf0.format(Number(r.ivamayorvalorcosto || 0)), alignment: "right", noWrap: true },
                    //{ text: nf0.format(Number(r.ivavis || 0)), alignment: "right" , noWrap: true},
                    { text: nf0.format(Number(r.valorfactareembolsar || 0)), alignment: "right", noWrap: true },
                    { text: nf0.format(Number(r.valorretefuente || 0)), alignment: "right", noWrap: true },
                    { text: nf0.format(Number(r.valorrteiva || 0)), alignment: "right", noWrap: true },
                    { text: nf0.format(Number(r.valorrteica || 0)), alignment: "right", noWrap: true },
                    { text: nf0.format(Number(r.valorrtegar || 0)), alignment: "right", noWrap: true },
                    { text: nf0.format(Number(r.valornetorte || 0)), alignment: "right", noWrap: true }
                ]);

                // ======================================================
                // ✅ Requisito: subtotalizar por Tipo de documento
                // (igual a la imagen: bloque por clase de documento + fila "Subtotal:")
                // ======================================================
                const aSorted = (a || []).slice().sort((x, y) => {
                    const tx = String(x?.documenttype || x?.clasedocumento || "");
                    const ty = String(y?.documenttype || y?.clasedocumento || "");
                    const c1 = tx.localeCompare(ty);
                    if (c1 !== 0) return c1;

                    const dx = String(x?.fecha || "");
                    const dy = String(y?.fecha || "");
                    const c2 = dx.localeCompare(dy);
                    if (c2 !== 0) return c2;

                    const ax = String(x?.accountingdocument || x?.documento || "");
                    const ay = String(y?.accountingdocument || y?.documento || "");
                    return ax.localeCompare(ay);
                });

                const groupsByTipo = this._groupBy(aSorted, r => String(r.documenttype || r.clasedocumento || "SIN_TIPO"));
                const tipoKeys = Object.keys(groupsByTipo).sort((x, y) => String(x).localeCompare(String(y)));

                // ======================================================
                // ✅ Requisito visual:
                // - Mostrar el detalle en BLOQUES por "Clase documento"
                // - Repetir encabezado por cada bloque
                // - Mostrar "Subtotal:" como BLOQUE separado (solo líneas horizontales)
                // ======================================================
                tipoKeys.forEach((tipoKey, tIdx) => {
                    const aTipo = groupsByTipo[tipoKey] || [];

                    // Tabla detalle del tipo (con encabezados)
                    const bodyTipo = [buildHeaderRow()];
                    (aTipo || []).forEach((r) => bodyTipo.push(rowFor(r)));



                    content.push({
                        table: {
                            headerRows: 1,
                            widths: widths,
                            body: bodyTipo
                        },
                        fontSize: 6,
                        margin: [0, 0, 0, 0],
                        layout: {
                            fillColor: function (rowIndex) {
                                return rowIndex === 0 ? "#CCCCCC" : null;
                            }
                        }
                    });

                    // Subtotal por tipo (bloque separado)
                    const subtotalValTotal = this._sum(aTipo, "valortotalcosto");
                    const subtotalIvaMayor = this._sum(aTipo, "ivamayorvalorcosto");
                    const subtotalFact = this._sum(aTipo, "valorfactareembolsar");
                    const subtotalRetFte = this._sum(aTipo, "valorretefuente");
                    const subtotalRteIva = this._sum(aTipo, "valorrteiva");
                    const subtotalRteIca = this._sum(aTipo, "valorrteica");
                    const subtotalRteGar = this._sum(aTipo, "valorrtegar");
                    const subtotalNeto = this._sum(aTipo, "valornetorte");

                    const subtotalRow = [
                        { text: "Subtotal:", colSpan: 6, bold: true, fontSize: 8, alignment: "left" },
                        "", "", "", "", "",
                        { text: nf0.format(subtotalValTotal), bold: true, fontSize: 7, alignment: "right" },
                        { text: nf0.format(subtotalIvaMayor), bold: true, fontSize: 7, alignment: "right" },
                        { text: nf0.format(subtotalFact), bold: true, fontSize: 7, alignment: "right" },
                        { text: nf0.format(subtotalRetFte), bold: true, fontSize: 7, alignment: "right" },
                        { text: nf0.format(subtotalRteIva), bold: true, fontSize: 7, alignment: "right" },
                        { text: nf0.format(subtotalRteIca), bold: true, fontSize: 7, alignment: "right" },
                        { text: nf0.format(subtotalRteGar), bold: true, fontSize: 7, alignment: "right" },
                        { text: nf0.format(subtotalNeto), bold: true, fontSize: 7, alignment: "right" }
                    ];


                    content.push({ text: " ", margin: [0, 4, 0, 2] });

                    content.push({
                        table: {
                            headerRows: 0,
                            widths: widths,
                            body: [subtotalRow]
                        },
                        margin: [0, 0, 0, 10],
                        layout: {
                            // Solo líneas horizontales para coincidir con el estilo de la imagen
                            hLineWidth: function (i, node) { return (i === 0 || i === node.table.body.length) ? 0.7 : 0; },
                            vLineWidth: function () { return 0; },
                            paddingTop: function () { return 6; },
                            paddingBottom: function () { return 6; }
                        }
                    });
                });

                // ======================================================
                // ✅ TOTAL GENERAL (suma de todos los subtotales / todo el detalle del documento)
                // ======================================================
                const totalValTotal = this._sum(a, "valortotalcosto");
                const totalIvaMayor = this._sum(a, "ivamayorvalorcosto");
                const totalFact = this._sum(a, "valorfactareembolsar");
                const totalRetFte = this._sum(a, "valorretefuente");
                const totalRteIva = this._sum(a, "valorrteiva");
                const totalRteIca = this._sum(a, "valorrteica");
                const totalRteGar = this._sum(a, "valorrtegar");
                const totalNeto = this._sum(a, "valornetorte");

                const totalGeneralRow = [
                    { text: "TOTAL GENERAL:", colSpan: 6, bold: true, fontSize: 8, alignment: "left" },
                    "", "", "", "", "",
                    { text: nf0.format(totalValTotal), bold: true, fontSize: 7, alignment: "right" },
                    { text: nf0.format(totalIvaMayor), bold: true, fontSize: 7, alignment: "right" },
                    { text: nf0.format(totalFact), bold: true, fontSize: 7, alignment: "right" },
                    { text: nf0.format(totalRetFte), bold: true, fontSize: 7, alignment: "right" },
                    { text: nf0.format(totalRteIva), bold: true, fontSize: 7, alignment: "right" },
                    { text: nf0.format(totalRteIca), bold: true, fontSize: 7, alignment: "right" },
                    { text: nf0.format(totalRteGar), bold: true, fontSize: 7, alignment: "right" },
                    { text: nf0.format(totalNeto), bold: true, fontSize: 7, alignment: "right" }
                ];

                content.push({ text: " ", margin: [0, 2, 0, 2] });

                content.push({
                    table: {
                        headerRows: 0,
                        widths: widths,
                        body: [totalGeneralRow]
                    },
                    margin: [0, 0, 0, 10],
                    layout: {
                        // mismo estilo del subtotal: solo líneas horizontales
                        hLineWidth: function (i, node) { return (i === 0 || i === node.table.body.length) ? 0.9 : 0; },
                        vLineWidth: function () { return 0; },
                        paddingTop: function () { return 7; },
                        paddingBottom: function () { return 7; }
                    }
                });


                // Espacio antes del bloque de certificación/firma
                content.push({ text: " ", margin: [0, 12, 0, 18] });

                // Bloque firma (equivalente al final del jsPDF)
                content.push({
                    text: "“Certifico que las cifras con los documentos soporte contenidas en este informe fueron tomadas de los libros de contabilidad tal como se informa en certificación adjunta”.",
                    fontSize: 8,
                    margin: [0, 10, 0, 12]
                });

                content.push({
                    canvas: [{ type: "line", x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5 }],
                    margin: [0, 40, 0, 4]
                });

                var datosRevisor = (Array.isArray(aAll) && aAll.length) ? (aAll[0] || {}) : {};

                content.push({ text: " ", bold: true, fontSize: 8 });
                content.push({ text: " ", bold: true, fontSize: 8 });
                content.push({ text: datosRevisor.nombrerevisor || "", bold: true, fontSize: 8 });
                content.push({ text: datosRevisor.descrevisor || "", fontSize: 8 });
                content.push({ text: datosRevisor.tarjetarevisor || "", fontSize: 8 });
                content.push({ text: "Ver certificación adjunta", italics: true, fontSize: 8 });

                if (idx < docKeys.length - 1) {
                    content.push({ text: "", pageBreak: "after" });
                }
            });

            return {
                pageSize: "A4",
                pageOrientation: "landscape",
                pageMargins: [25, 70, 25, 40],
                header: this._buildHeader("SOPORTE DE REEMBOLSO"),
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
                    reportTitle: {
                        fontSize: 14,
                        bold: true
                    },
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

        _formatDDMMYYYY: function (sISODate) {
            const s = String(sISODate || "").trim();
            if (!s) return "";
            const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!m) return s;
            return m[3] + "/" + m[2] + "/" + m[1];
        },

        _sumByField: function (arr, field) {
            return (arr || []).reduce((acc, it) => acc + Number(it?.[field] || 0), 0);
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
