import PDFDocument from 'pdfkit';

export class PdfBuilder {
  static async generateInvoicePdf(invoiceData: any): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const buffers: Buffer[] = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          const pdfData = Buffer.concat(buffers);
          resolve(pdfData.toString('base64'));
        });

        // --- INICIO DEL DISEÑO DEL PDF MEJORADO Y CORREGIDO ---
        
        // 1. Cabecera (Empresa)
        doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a365d').text(invoiceData.supplier.businessName, { align: 'center' });
        doc.fontSize(10).font('Helvetica').fillColor('#4a5568').text(`RUC: ${invoiceData.supplier.ruc}`, { align: 'center' });
        doc.moveDown(2);

        // 2. Título de la Factura (En un elegante recuadro gris)
        const rectX = 170;
        const rectY = doc.y;
        doc.rect(rectX, rectY, 255, 45).fillAndStroke('#edf2f7', '#cbd5e0');
        
        doc.fillColor('#2d3748').fontSize(14).font('Helvetica-Bold').text('FACTURA ELECTRÓNICA', rectX, rectY + 10, { align: 'center', width: 255 });
        doc.fontSize(11).font('Helvetica').text(`${invoiceData.serieNumber}`, rectX, rectY + 28, { align: 'center', width: 255 });
        doc.y = rectY + 60; 

        // 3. Datos del Cliente
        doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold').text('Adquiriente:');
        doc.font('Helvetica').text(`Razón Social: ${invoiceData.customer.fullName}`);
        doc.text(`RUC/DNI: ${invoiceData.customer.documentNumber}`);
        doc.text(`Fecha de Emisión: ${invoiceData.issueDate} a las ${invoiceData.issueTime}`);
        
        // Mostramos el método de pago si existe
        if (invoiceData.paymentMethod) {
            doc.text(`Método de Pago: ${invoiceData.paymentMethod}`);
        }
        
        doc.text(`Moneda: Soles (PEN)`);
        doc.moveDown(2);

        // 4. Tabla de Productos - CABECERA
        const tableTop = doc.y;
        doc.font('Helvetica-Bold').fontSize(10);
        
        // Fondo gris para la cabecera de la tabla
        doc.rect(50, tableTop - 5, 495, 20).fill('#edf2f7');
        doc.fillColor('#000000');
        
        // Coordenadas absolutas para alineación perfecta
        doc.text('Descripción', 55, tableTop);
        doc.text('Cant.', 300, tableTop, { width: 40, align: 'center' });
        doc.text('Valor Unit.', 360, tableTop, { width: 80, align: 'right' });
        doc.text('Total', 460, tableTop, { width: 80, align: 'right' });

        doc.moveDown(1);

        // 5. Tabla de Productos - FILAS
        doc.font('Helvetica').fontSize(10);
        let currentY = doc.y;

        invoiceData.items.forEach((item: any) => {
          doc.text(item.description, 55, currentY, { width: 230 });
          doc.text(item.quantity.toString(), 300, currentY, { width: 40, align: 'center' });
          doc.text(`S/ ${item.unitValue.toFixed(2)}`, 360, currentY, { width: 80, align: 'right' });
          doc.text(`S/ ${item.unitPrice.toFixed(2)}`, 460, currentY, { width: 80, align: 'right' });
          
          currentY = doc.y + 15; // Bajamos 15 pixeles para la siguiente línea
        });

        // Línea sutil de cierre de tabla
        doc.moveTo(50, currentY).lineTo(545, currentY).strokeColor('#cbd5e0').stroke();
        currentY += 15;

        // 6. Totales (Alineados a la derecha con diseño corregido)
        doc.font('Helvetica').fontSize(10).fillColor('#4a5568');
        
        // --- COLUMNA DE ETIQUETAS MÁS ANCHA ---
        const labelX = 250; // Comienza más a la izquierda
        const labelWidth = 200; // Ancho mucho mayor
        // -------------------------------------

        doc.text('Op. Gravadas:', labelX, currentY, { width: labelWidth, align: 'right' });
        doc.fillColor('#000000').text(`S/ ${invoiceData.totalTaxBase.toFixed(2)}`, 460, currentY, { width: 80, align: 'right' });
        currentY += 15;

        doc.fillColor('#4a5568').text('IGV (18%):', labelX, currentY, { width: labelWidth, align: 'right' });
        doc.fillColor('#000000').text(`S/ ${invoiceData.totalIgv.toFixed(2)}`, 460, currentY, { width: 80, align: 'right' });
        currentY += 20;

        // Total de la factura
        doc.font('Helvetica-Bold').fontSize(12);
        doc.text('TOTAL DE LA FACTURA:', labelX - 10, currentY, { width: labelWidth + 10, align: 'right' });
        doc.text(`S/ ${invoiceData.totalAmount.toFixed(2)}`, 460, currentY, { width: 80, align: 'right' });

        // --- 6.1 MAGIA TRIBUTARIA CORREGIDA: SECCIÓN DE DETRACCIÓN ---
        if (invoiceData.hasDetraction && invoiceData.detractionAmount > 0) {
            currentY += 20;
            
            // Fila de resta (Rojo/Naranja con espacio de sobra para el texto largo)
            doc.font('Helvetica-Oblique').fontSize(9).fillColor('#e53e3e');
            doc.text(`(-) Detracción (${invoiceData.detractionPercent}%) depositada al Banco de la Nación:`, labelX, currentY, { width: labelWidth, align: 'right' });
            doc.text(`- S/ ${Number(invoiceData.detractionAmount).toFixed(2)}`, 460, currentY, { width: 80, align: 'right' });
            
            currentY += 25;

            // Fila de Neto a Cobrar (Azul Fuerte)
            const netoAPagar = invoiceData.totalAmount - invoiceData.detractionAmount;
            doc.font('Helvetica-Bold').fontSize(14).fillColor('#1e40af');
            doc.text('NETO A COBRAR:', labelX, currentY, { width: labelWidth, align: 'right' });
            doc.text(`S/ ${netoAPagar.toFixed(2)}`, 460, currentY, { width: 80, align: 'right' });
        }
        // -------------------------------------------------------------

        // 7. Pie de página dinámico anclado al final de la hoja A4
        const bottomY = doc.page.height - 80;
        doc.fontSize(8).font('Helvetica-Oblique').fillColor('#718096')
           .text('Representación impresa de la Factura Electrónica.', 50, bottomY, { align: 'center' })
           .text('Generado con tecnología NestJS para SaaS.', 50, bottomY + 12, { align: 'center' });

        // --- FIN DEL DISEÑO ---
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}