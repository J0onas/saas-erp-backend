import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('invoices') // El nombre exacto de la tabla en pgAdmin
export class InvoiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'customer_document', length: 15 })
  customerDocument: string;

  @Column({ name: 'total_amount', type: 'decimal', precision: 12, scale: 2 })
  totalAmount: number;

  @Column({ name: 'xml_ubl_status', default: 'PENDING' })
  xmlUblStatus: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}