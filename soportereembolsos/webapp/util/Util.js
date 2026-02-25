sap.ui.define([
    "sap/m/MessageBox"
], function (MessageBox) {
    "use strict";
    const LOGO_BASE64_SUMAPAZ = "data:image/jpeg;base64,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";
    const LOGO_BASE64_CONCONCRETO = "data:image/jpeg;base64,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"
    const REEMBOLSO_DEBITO = "REEMBOLSO DÉBITO";
    const REEMBOLSO_CREDITO = "REEMBOLSO CRÉDITO";
    const TIPO_REEMBOLSO_MAP = {
        RB: REEMBOLSO_DEBITO,
        RC: REEMBOLSO_CREDITO
    };
    function _getLogoBySociedad(sSociedad) {
        return sSociedad === "4813"
            ? LOGO_BASE64_SUMAPAZ
            : LOGO_BASE64_CONCONCRETO;
    };
    function _getTituloReembolso(tipodocument) {
        return TIPO_REEMBOLSO_MAP[tipodocument] || REEMBOLSO_DEBITO;
    };
    function _getHeaderInfo(o) {
        const sociedad = String(o.sociedad).trim();

        if (sociedad === "4813") {
            return [
                { text: o.namesociedad + "\n", bold: true },
                { text: o.citynamesociedad, bold: true },
                " / Teléfono " + o.phonenumbersociedad + "\n",
                { text: "Colombia * Suramerica\n", bold: true },
                { text: "www.via40express.com", bold: true }
            ];
        }

        return [
            { text: o.namesociedad + "\n", bold: true },
            { text: o.citynamesociedad, bold: true },
            " / Teléfono " + o.phonenumbersociedad + "\n",
            { text: "Colombia * Suramerica\n", bold: true },
            { text: "www.conconcreto.com", bold: true }
        ];
    };
    function _getCentroInfo(o) {
        const sociedad = String(o.sociedad).trim();
        if (sociedad === "4813") {
            return [
                ["Grupo CeCo", o.groupcostcenter || ""],
                ["Nombre Grupo CeCo", o.nombregrupoceco || ""]
            ];
        }

        return [
            ["Proyecto", o.proyecto || ""],
            ["Nombre Proyecto", o.nombreproyecto || ""]
        ];
    };
    function _getDetailInfo(o) {
        const sociedad = String(o.sociedad).trim();
        if (sociedad === "4813") {
            return [
                ["Condición de pago:", o.paymenttermsname || ""],
                ["Moneda:", o.companycodecurrency || ""],
                ["Dirección", o.streetname || ""]
            ];
        }
        return [];
    };
    function _getConvenioText(o) {
        const sociedad = String(o.sociedad || "").trim();

        if (sociedad !== "4813") {
            return [
                "\n\n",
                { text: "CONVENIO\n\n", bold: true },
                { text: "PRESENTAR ESTE DOCUMENTO A LA HORA DE REALIZAR EL PAGO", bold: true }
            ];
        }

        return [];
    };
    return {

        generateFormatoFromEndpoint: function (aItems) {
            if (typeof pdfMake === "undefined") {
                MessageBox.error("pdfMake no está cargado.");
                return;
            }

            const o = aItems[0];
            const sTitulo = _getTituloReembolso(o.tipodocument);
            const sLogo = _getLogoBySociedad(o.sociedad);
            const sHeaderInfo = _getHeaderInfo(o);
            const aCentroInfo = _getCentroInfo(o);
            const aDetailInfo = _getDetailInfo(o);
            const docDefinition = {
                pageSize: "A4",
                pageMargins: [40, 40, 70, 40],
                header: function (currentPage, pageCount) {
                    return {
                        columns: [
                            { text: "" },
                            {
                                text: `PÁGINA: ${currentPage} / ${pageCount}`,
                                alignment: "right",
                                fontSize: 9,
                                margin: [0, 20, 40, 0]
                            }
                        ]
                    };
                },

                content: [

                    {
                        columns: [
                            {
                                width: "50%",
                                stack: [
                                    {
                                        image: sLogo,
                                        width: 120,
                                        margin: [0, 0, 0, 10]
                                    },
                                    {
                                        text: [
                                            { text: "Empresa\n", bold: true },
                                            o.namecliente + "\n",
                                            o.streetname + "\n",
                                            o.cityname + "\n\n",
                                            "Teléfono: " + o.phonenumber,
                                            ..._getConvenioText(o)
                                        ],
                                        fontSize: 9
                                    }
                                ]
                            },
                            {
                                width: "50%",
                                stack: [
                                    {
                                        margin: [0, 0, 0, 8],
                                        table: {
                                            widths: ["100%"],
                                            body: [[
                                                {
                                                    text: sHeaderInfo,
                                                    fontSize: 8,
                                                    alignment: "left"
                                                }
                                            ]]
                                        },
                                        layout: "noBorders"
                                    },
                                    {
                                        stack: [
                                            {
                                                table: {
                                                    widths: ["100%"],
                                                    body: [[
                                                        {
                                                            text: sTitulo,
                                                            alignment: "center",
                                                            bold: true,
                                                            fontSize: 12,
                                                            fillColor: "#E6E6E6",
                                                            margin: [0, 4, 0, 4]
                                                        }
                                                    ]]
                                                },
                                                layout: "noBorders"
                                            },
                                            {
                                                table: {
                                                    widths: ["40%", "60%"],
                                                    body: [
                                                        ["N° Documento:", o.accountingdocument],
                                                        ["Fecha:", o.creationdate],
                                                        ["NIT Cliente:", o.taxnumber],
                                                        ["Cliente:", o.namecliente],
                                                        ...aCentroInfo,
                                                        ...aDetailInfo,
                                                    ]
                                                },
                                                layout: {
                                                    hLineWidth: function (i, node) {
                                                        return (i === 0 || i === node.table.body.length) ? 1 : 0;
                                                    },
                                                    vLineWidth: function (i, node) {
                                                        return (i === 0 || i === node.table.widths.length) ? 1 : 0;
                                                    },
                                                    hLineColor: () => "#000",
                                                    vLineColor: () => "#000",
                                                    paddingLeft: () => 6,
                                                    paddingRight: () => 6,
                                                    paddingTop: () => 4,
                                                    paddingBottom: () => 4
                                                },
                                                fontSize: 9
                                            }
                                        ],
                                        margin: [0, 10, 0, 0]
                                    }
                                ]
                            }
                        ]
                    },

                    { text: "\n" },

                    {
                        table: {
                            headerRows: 1,
                            widths: ["8%", "14%", "35%", "10%", "16%", "17%"],
                            body: [
                                [
                                    { text: "Item", style: "tableHeader" },
                                    { text: "Código", style: "tableHeader" },
                                    { text: "Descripción", style: "tableHeader" },
                                    { text: "Cant Pedido", style: "tableHeader" },
                                    { text: "Precio Unitario", style: "tableHeader" },
                                    { text: "Valor", style: "tableHeader" }
                                ],
                                ...aItems.map(it => ([
                                    it.item,
                                    it.codigo,
                                    it.descripcion,
                                    it.cantidad,
                                    { text: this._formatCurrency(it.amountincompanycodecurrency), alignment: "right", noWrap: true },
                                    { text: this._formatCurrency(it.amountincompanycodecurrency), alignment: "right", noWrap: true }
                                ]))
                            ]
                        },
                        layout: "lightHorizontalLines",
                        fontSize: 9
                    },

                    { text: "\n" },

                    {
                        columns: [
                            { width: "*", text: "" },
                            {
                                width: "40%",
                                table: {
                                    widths: ["50%", "50%"],
                                    body: [
                                        ["Subtotal", this._formatCurrency(o.amountincompanycodecurrency)],
                                        [{ text: "TOTAL", bold: true }, { text: this._formatCurrency(o.amountincompanycodecurrency), bold: true }]
                                    ]
                                },
                                layout: "lightHorizontalLines",
                                fontSize: 10
                            }
                        ]
                    }
                ],

                styles: {
                    title: {
                        fontSize: 14,
                        bold: true,
                        alignment: "center",
                        fillColor: "#E6E6E6",
                        margin: [0, 0, 0, 5]
                    },
                    tableHeader: {
                        bold: true
                    },
                    titleBox: {
                        fontSize: 12,
                        bold: true,
                        alignment: "center",
                        fillColor: "#e6e6e6c9",
                        margin: [0, 0, 0, 0],
                        padding: [5, 5, 5, 5]
                    }
                }
            };

            pdfMake.createPdf(docDefinition)
                .download(`REEMBOLSO_${o.accountingdocument}.pdf`);
        },
        formatFechaYYYYMMDD: function (sFecha) {
            if (!sFecha) return "";
            if (sFecha.includes("T")) {
                sFecha = sFecha.split("T")[0];
            }
            if (sFecha.includes("-")) {
                return sFecha.replaceAll("-", "");
            }
            return sFecha;
        },
        _formatCurrency: function (value) {
            return new Intl.NumberFormat("es-CO", {
                style: "currency",
                currency: "COP",
                minimumFractionDigits: 0
            }).format(value || 0);
        }

    };
});
