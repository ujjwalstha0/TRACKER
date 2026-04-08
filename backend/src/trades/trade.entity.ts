import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'trades' })
export class TradeEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 20 })
  symbol!: string;

  @Column({ type: 'boolean', name: 'is_buy' })
  isBuy!: boolean;

  @Column({ type: 'numeric', precision: 14, scale: 4 })
  price!: number;

  @Column({ type: 'integer', name: 'qty' })
  qty!: number;

  @Column({ type: 'varchar', length: 100 })
  broker!: string;

  @Column({ type: 'numeric', precision: 16, scale: 2, name: 'total_value' })
  totalValue!: number;

  @Column({ type: 'numeric', precision: 16, scale: 2, name: 'broker_fee' })
  brokerFee!: number;

  @Column({ type: 'numeric', precision: 16, scale: 2, name: 'sebon_fee' })
  sebonFee!: number;

  @Column({ type: 'numeric', precision: 16, scale: 2, name: 'dp_fee' })
  dpFee!: number;

  @Column({ type: 'numeric', precision: 8, scale: 5, name: 'cgt_rate', default: 0 })
  cgtRate!: number;

  @Column({ type: 'numeric', precision: 16, scale: 2, name: 'cgt_amount', default: 0 })
  cgtAmount!: number;

  @Column({ type: 'numeric', precision: 16, scale: 2, name: 'net_cost_or_proceeds' })
  netCostOrProceeds!: number;

  @Column({ type: 'date', name: 'purchased_at', nullable: true })
  purchasedAt!: string | null;

  @Column({ type: 'date', name: 'sold_at', nullable: true })
  soldAt!: string | null;

  @Column({ type: 'integer', name: 'holding_days', nullable: true })
  holdingDays!: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  sector!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
