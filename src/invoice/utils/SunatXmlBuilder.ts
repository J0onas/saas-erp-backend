import { create } from 'xmlbuilder2';

export interface CompanyInfo {
    ruc: string;
    businessName: string;
    addressCode: string;
}

export interface CustomerInfo {
    documentType: string;
    documentNumber: string;
    fullName: string;
}

export interface InvoiceItem {
    id: number;
    description: string;
    quantity: number;
    unitValue: number;
    unitPrice: number;
    totalTaxes: number;
}

export interface InvoicePayload {
    serieNumber: string;
    issueDate: string;
    issueTime: string;
    currency: string;
    supplier: CompanyInfo;
    customer: CustomerInfo;
    items: InvoiceItem[];
    totalTaxBase: number;
    totalIgv: number;
    totalAmount: number;
}

export class SunatXmlBuilder {
    public static generateInvoiceXml(data: InvoicePayload): string {
        // 1. Iniciamos el documento raíz
        const doc = create({ version: '1.0', encoding: 'UTF-8' })
            .ele('Invoice', {
                'xmlns': 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
                'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
                'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
                'xmlns:ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2'
            });

        // 2. Zona de Firma Digital
        doc.ele('ext:UBLExtensions')
            .ele('ext:UBLExtension')
            .ele('ext:ExtensionContent');

        // 3. Datos Cabecera
        doc.ele('cbc:UBLVersionID').txt('2.1');
        doc.ele('cbc:CustomizationID').txt('2.0');
        doc.ele('cbc:ID').txt(data.serieNumber);
        doc.ele('cbc:IssueDate').txt(data.issueDate);
        doc.ele('cbc:IssueTime').txt(data.issueTime);
        doc.ele('cbc:InvoiceTypeCode', { listID: '0101' }).txt('01');
        doc.ele('cbc:DocumentCurrencyCode').txt(data.currency);

        // 4. Datos del Emisor (Supplier)
        const supplier = doc.ele('cac:AccountingSupplierParty').ele('cac:Party');
        supplier.ele('cac:PartyIdentification').ele('cbc:ID', { schemeID: '6' }).txt(data.supplier.ruc);
        supplier.ele('cac:PartyName').ele('cbc:Name').dat(data.supplier.businessName);
        
        const supplierAddress = supplier.ele('cac:PartyLegalEntity');
        supplierAddress.ele('cbc:RegistrationName').dat(data.supplier.businessName);
        supplierAddress.ele('cac:RegistrationAddress').ele('cbc:AddressTypeCode').txt(data.supplier.addressCode);

        // 5. Datos del Cliente (Customer)
        const customer = doc.ele('cac:AccountingCustomerParty').ele('cac:Party');
        customer.ele('cac:PartyIdentification').ele('cbc:ID', { schemeID: data.customer.documentType }).txt(data.customer.documentNumber);
        customer.ele('cac:PartyLegalEntity').ele('cbc:RegistrationName').dat(data.customer.fullName);

        // 6. Totales e Impuestos Globales
        const taxTotal = doc.ele('cac:TaxTotal');
        taxTotal.ele('cbc:TaxAmount', { currencyID: data.currency }).txt(data.totalIgv.toFixed(2));
        
        const taxSubtotal = taxTotal.ele('cac:TaxSubtotal');
        taxSubtotal.ele('cbc:TaxableAmount', { currencyID: data.currency }).txt(data.totalTaxBase.toFixed(2));
        taxSubtotal.ele('cbc:TaxAmount', { currencyID: data.currency }).txt(data.totalIgv.toFixed(2));
        
        const taxCategory = taxSubtotal.ele('cac:TaxCategory');
        taxCategory.ele('cbc:ID', { schemeID: 'UN/ECE 5305', schemeName: 'Tax Category Identifier', schemeAgencyName: 'United Nations Economic Commission for Europe' }).txt('S');
        
        const taxScheme = taxCategory.ele('cac:TaxScheme');
        taxScheme.ele('cbc:ID', { schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }).txt('1000');
        taxScheme.ele('cbc:Name').txt('IGV');
        taxScheme.ele('cbc:TaxTypeCode').txt('VAT');

        // 7. Importes Totales
        const legalTotal = doc.ele('cac:LegalMonetaryTotal');
        legalTotal.ele('cbc:LineExtensionAmount', { currencyID: data.currency }).txt(data.totalTaxBase.toFixed(2));
        legalTotal.ele('cbc:TaxInclusiveAmount', { currencyID: data.currency }).txt(data.totalAmount.toFixed(2));
        legalTotal.ele('cbc:PayableAmount', { currencyID: data.currency }).txt(data.totalAmount.toFixed(2));

        // 8. Líneas de Detalle (Items)
        for (const item of data.items) {
            const line = doc.ele('cac:InvoiceLine');
            line.ele('cbc:ID').txt(item.id.toString());
            line.ele('cbc:InvoicedQuantity', { unitCode: 'NIU' }).txt(item.quantity.toFixed(2));
            line.ele('cbc:LineExtensionAmount', { currencyID: data.currency }).txt((item.unitValue * item.quantity).toFixed(2));
            
            const pricing = line.ele('cac:PricingReference').ele('cac:AlternativeConditionPrice');
            pricing.ele('cbc:PriceAmount', { currencyID: data.currency }).txt(item.unitPrice.toFixed(2));
            pricing.ele('cbc:PriceTypeCode').txt('01');
            
            line.ele('cac:Item').ele('cbc:Description').dat(item.description);
            line.ele('cac:Price').ele('cbc:PriceAmount', { currencyID: data.currency }).txt(item.unitValue.toFixed(2));
        }

        // Retornamos el XML en texto string
        return doc.end({ prettyPrint: true });
    }
}