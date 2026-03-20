import { create } from 'xmlbuilder2';

// ── TIPOS ────────────────────────────────────────────────────────────────────
export interface InvoiceXmlData {
    serieNumber: string;       // F001-00000001 o B001-00000001
    issueDate: string;         // YYYY-MM-DD
    issueTime: string;         // HH:MM:SS
    tipoComprobante: '01' | '03'; // 01=Factura, 03=Boleta
    currency: string;          // PEN
    paymentMethod: string;
    supplier: {
        ruc: string;
        businessName: string;
        address: string;
    };
    customer: {
        documentType: string;  // '1'=DNI '6'=RUC
        documentNumber: string;
        fullName: string;
    };
    items: Array<{
        description: string;
        quantity: number;
        unitValue: number;    // precio sin IGV
        unitPrice: number;    // precio con IGV
        totalTaxes: number;
    }>;
    totalTaxBase: number;
    totalIgv: number;
    totalAmount: number;
    hasDetraction?: boolean;
    detractionPercent?: number;
    detractionAmount?: number;
}

export class SunatXmlBuilder {

    static generateInvoiceXml(data: InvoiceXmlData): string {
        const tipo = data.tipoComprobante || '01';
        const esBoleta = tipo === '03';

        // En boletas el cliente puede ser genérico (DNI '1' o consumidor final '0')
        const tipoDocCliente = data.customer.documentType || (esBoleta ? '1' : '6');

        const doc = create({ version: '1.0', encoding: 'UTF-8' })
            .ele('Invoice', {
                'xmlns': 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
                'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
                'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
                'xmlns:ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
            });

        // ── Extensión para firma digital (Nubefact la reemplaza) ─────────────
        doc.ele('ext:UBLExtensions')
            .ele('ext:UBLExtension')
            .ele('ext:ExtensionContent').up().up().up();

        // ── Cabecera ─────────────────────────────────────────────────────────
        doc.ele('cbc:UBLVersionID').txt('2.1').up();
        doc.ele('cbc:CustomizationID').txt('2.0').up();
        doc.ele('cbc:ID').txt(data.serieNumber).up();
        doc.ele('cbc:IssueDate').txt(data.issueDate).up();
        doc.ele('cbc:IssueTime').txt(data.issueTime).up();

        // Tipo de comprobante (catálogo 01 SUNAT)
        doc.ele('cbc:InvoiceTypeCode', { listID: '0101' }).txt(tipo).up();

        // Leyenda: monto en letras (simplificado)
        doc.ele('cbc:Note', { languageLocaleID: '1000' })
            .txt(this.montoEnLetras(data.totalAmount)).up();

        doc.ele('cbc:DocumentCurrencyCode').txt(data.currency || 'PEN').up();

        // ── Emisor ────────────────────────────────────────────────────────────
        const supplier = doc.ele('cac:AccountingSupplierParty')
            .ele('cac:Party');
        supplier.ele('cac:PartyIdentification')
            .ele('cbc:ID', { schemeID: '6' }).txt(data.supplier.ruc).up().up();
        supplier.ele('cac:PartyName')
            .ele('cbc:Name').txt(data.supplier.businessName).up().up();
        supplier.ele('cac:PartyLegalEntity')
            .ele('cbc:RegistrationName').txt(data.supplier.businessName).up()
            .ele('cac:RegistrationAddress')
            .ele('cbc:AddressTypeCode').txt('0000').up().up().up();
        supplier.up().up();

        // ── Receptor ──────────────────────────────────────────────────────────
        const customer = doc.ele('cac:AccountingCustomerParty')
            .ele('cac:Party');
        customer.ele('cac:PartyIdentification')
            .ele('cbc:ID', { schemeID: tipoDocCliente })
            .txt(data.customer.documentNumber).up().up();
        customer.ele('cac:PartyLegalEntity')
            .ele('cbc:RegistrationName').txt(data.customer.fullName).up().up();
        customer.up().up();

        // ── Método de pago ────────────────────────────────────────────────────
        doc.ele('cac:PaymentMeans')
            .ele('cbc:PaymentMeansCode').txt('Contado').up()
            .ele('cbc:PaymentID').txt(data.paymentMethod || 'EFECTIVO').up().up();

        // ── Detracción (si aplica) ────────────────────────────────────────────
        if (data.hasDetraction && data.detractionAmount) {
            doc.ele('cac:PaymentTerms')
                .ele('cbc:ID').txt('Detraccion').up()
                .ele('cbc:PaymentPercent').txt(String(data.detractionPercent || 0)).up()
                .ele('cbc:Amount', { currencyID: 'PEN' })
                .txt(data.detractionAmount.toFixed(2)).up().up();
        }

        // ── Impuestos totales ─────────────────────────────────────────────────
        doc.ele('cac:TaxTotal')
            .ele('cbc:TaxAmount', { currencyID: 'PEN' })
            .txt(data.totalIgv.toFixed(2)).up()
            .ele('cac:TaxSubtotal')
            .ele('cbc:TaxableAmount', { currencyID: 'PEN' })
            .txt(data.totalTaxBase.toFixed(2)).up()
            .ele('cbc:TaxAmount', { currencyID: 'PEN' })
            .txt(data.totalIgv.toFixed(2)).up()
            .ele('cac:TaxCategory')
            .ele('cac:TaxScheme')
            .ele('cbc:ID').txt('1000').up()
            .ele('cbc:Name').txt('IGV').up()
            .ele('cbc:TaxTypeCode').txt('VAT').up()
            .up().up().up().up();

        // ── Totales del documento ─────────────────────────────────────────────
        doc.ele('cac:LegalMonetaryTotal')
            .ele('cbc:LineExtensionAmount', { currencyID: 'PEN' })
            .txt(data.totalTaxBase.toFixed(2)).up()
            .ele('cbc:TaxInclusiveAmount', { currencyID: 'PEN' })
            .txt(data.totalAmount.toFixed(2)).up()
            .ele('cbc:PayableAmount', { currencyID: 'PEN' })
            .txt(data.totalAmount.toFixed(2)).up().up();

        // ── Líneas de detalle ─────────────────────────────────────────────────
        data.items.forEach((item, idx) => {
            const itemTotal = item.quantity * item.unitValue;

            const line = doc.ele('cac:InvoiceLine');
            line.ele('cbc:ID').txt(String(idx + 1)).up();
            line.ele('cbc:InvoicedQuantity', { unitCode: 'NIU' })
                .txt(String(item.quantity)).up();
            line.ele('cbc:LineExtensionAmount', { currencyID: 'PEN' })
                .txt(itemTotal.toFixed(2)).up();

            // Precio con IGV
            line.ele('cac:Price')
                .ele('cbc:PriceAmount', { currencyID: 'PEN' })
                .txt(item.unitPrice.toFixed(2)).up().up();

            // Precio sin IGV (valor unitario)
            line.ele('cac:PricingReference')
                .ele('cac:AlternativeConditionPrice')
                .ele('cbc:PriceAmount', { currencyID: 'PEN' })
                .txt(item.unitValue.toFixed(2)).up()
                .ele('cbc:PriceTypeCode').txt('01').up().up().up();

            // IGV de la línea
            line.ele('cac:TaxTotal')
                .ele('cbc:TaxAmount', { currencyID: 'PEN' })
                .txt(item.totalTaxes.toFixed(2)).up()
                .ele('cac:TaxSubtotal')
                .ele('cbc:TaxableAmount', { currencyID: 'PEN' })
                .txt(item.unitValue.toFixed(2)).up()
                .ele('cbc:TaxAmount', { currencyID: 'PEN' })
                .txt(item.totalTaxes.toFixed(2)).up()
                .ele('cac:TaxCategory')
                .ele('cbc:ID').txt('S').up()
                .ele('cbc:Percent').txt('18').up()
                .ele('cac:TaxScheme')
                .ele('cbc:ID').txt('1000').up()
                .ele('cbc:Name').txt('IGV').up()
                .ele('cbc:TaxTypeCode').txt('VAT').up()
                .up().up().up().up();

            // Descripción del ítem
            line.ele('cac:Item')
                .ele('cbc:Description').txt(item.description).up().up();

            line.up();
        });

        return doc.end({ prettyPrint: true });
    }

    // ── Conversión de monto a letras (simplificada) ──────────────────────────
    private static montoEnLetras(monto: number): string {
        const entero = Math.floor(monto);
        const centavos = Math.round((monto - entero) * 100);
        return `SON ${entero} CON ${centavos.toString().padStart(2, '0')}/100 SOLES`;
    }
}
