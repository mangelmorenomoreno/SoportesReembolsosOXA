sap.ui.define([
    "sap/m/MessageBox"
], function (MessageBox) {
    "use strict";
    const LOGO_BASE64 = "data:image/jpeg;base64,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";
    return {

        generateFormatoFromEndpoint: function (aItems) {
            if (typeof pdfMake === "undefined") {
                MessageBox.error("pdfMake no está cargado.");
                return;
            }

            const o = aItems[0];

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
                                        image: LOGO_BASE64,
                                        width: 120,
                                        margin: [0, 0, 0, 10]
                                    },
                                    {
                                        text: [
                                            { text: "Empresa\n", bold: true },
                                            o.namecliente + "\n",
                                            o.streetname + "\n",
                                            o.cityname + "\n\n",
                                            "Teléfono: " + o.phonenumber
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
                                                    text: [
                                                        { text: o.namecliente + "\n", bold: true },
                                                        o.streetname + "\n",
                                                        o.phonenumber + "\n",
                                                        "Colombia * Suramerica\n",
                                                        { text: "www.via40express.com", bold: true }
                                                    ],
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
                                                            text: "REEMBOLSO DÉBITO",
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
                                                        ["Grupo CeCo", o.groupcostcenter],
                                                        ["Nombre Grupo CeCo", o.nombregrupoceco],
                                                        ["Moneda:", o.companycodecurrency],
                                                        ["Condición de pago:", o.paymenttermsname],
                                                        ["Dirección:", o.streetname]
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
                            widths: ["8%", "15%", "37%", "10%", "15%", "15%"],
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
                                    { text: this._formatCurrency(it.amountincompanycodecurrency), alignment: "right" },
                                    { text: this._formatCurrency(it.amountincompanycodecurrency), alignment: "right" }
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
