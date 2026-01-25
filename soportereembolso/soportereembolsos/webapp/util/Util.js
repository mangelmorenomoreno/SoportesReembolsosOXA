sap.ui.define([
    "sap/m/MessageBox"
], function (MessageBox) {
    "use strict";

    return {

        generateFormatoFromEndpoint: function (aItems) {
            if (typeof pdfMake === "undefined") {
                MessageBox.error("pdfMake no está cargado. Verifique manifest.json");
                return;
            }
            if (!Array.isArray(aItems) || !aItems.length) {
                MessageBox.warning("No hay datos para generar el PDF.");
                return;
            }
            const content = [];

            content.push({ text: "DATA DETALLE REEMBOLSO", style: "header" });
            content.push({ text: " " });

            aItems.forEach(function (item, index) {
                content.push({
                    text: `Registro ${index + 1}`,
                    style: "subheader",
                    margin: [0, 10, 0, 5]
                });

                Object.keys(item).forEach(function (key) {
                    content.push({
                        text: `${key}: ${item[key]}`,
                        fontSize: 9
                    });
                });
            });

            const docDefinition = {
                pageSize: "A4",
                pageMargins: [40, 40, 40, 40],
                content: content,
                styles: {
                    header: {
                        fontSize: 14,
                        bold: true
                    },
                    subheader: {
                        fontSize: 11,
                        bold: true
                    }
                }
            };

            pdfMake.createPdf(docDefinition)
                .download(`REEMBOLSO_${aItems[0].accountingdocument || "TEST"}.pdf`);
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
        }
    };
});
