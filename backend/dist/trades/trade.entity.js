"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradeEntity = void 0;
const typeorm_1 = require("typeorm");
let TradeEntity = class TradeEntity {
    id;
    symbol;
    isBuy;
    price;
    qty;
    broker;
    totalValue;
    brokerFee;
    sebonFee;
    dpFee;
    cgtRate;
    cgtAmount;
    netCostOrProceeds;
    purchasedAt;
    soldAt;
    holdingDays;
    sector;
    notes;
    createdAt;
    updatedAt;
};
exports.TradeEntity = TradeEntity;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)(),
    __metadata("design:type", Number)
], TradeEntity.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 20 }),
    __metadata("design:type", String)
], TradeEntity.prototype, "symbol", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', name: 'is_buy' }),
    __metadata("design:type", Boolean)
], TradeEntity.prototype, "isBuy", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'numeric', precision: 14, scale: 4 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "price", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'qty' }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "qty", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100 }),
    __metadata("design:type", String)
], TradeEntity.prototype, "broker", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'numeric', precision: 16, scale: 2, name: 'total_value' }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "totalValue", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'numeric', precision: 16, scale: 2, name: 'broker_fee' }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "brokerFee", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'numeric', precision: 16, scale: 2, name: 'sebon_fee' }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "sebonFee", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'numeric', precision: 16, scale: 2, name: 'dp_fee' }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "dpFee", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'numeric', precision: 8, scale: 5, name: 'cgt_rate', default: 0 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "cgtRate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'numeric', precision: 16, scale: 2, name: 'cgt_amount', default: 0 }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "cgtAmount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'numeric', precision: 16, scale: 2, name: 'net_cost_or_proceeds' }),
    __metadata("design:type", Number)
], TradeEntity.prototype, "netCostOrProceeds", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', name: 'purchased_at', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "purchasedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', name: 'sold_at', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "soldAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'integer', name: 'holding_days', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "holdingDays", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 100, nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "sector", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], TradeEntity.prototype, "notes", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], TradeEntity.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], TradeEntity.prototype, "updatedAt", void 0);
exports.TradeEntity = TradeEntity = __decorate([
    (0, typeorm_1.Entity)({ name: 'trades' })
], TradeEntity);
//# sourceMappingURL=trade.entity.js.map