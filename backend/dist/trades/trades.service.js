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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradesService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const fees_service_1 = require("../fees/fees.service");
const trade_entity_1 = require("./trade.entity");
let TradesService = class TradesService {
    tradesRepository;
    feesService;
    constructor(tradesRepository, feesService) {
        this.tradesRepository = tradesRepository;
        this.feesService = feesService;
    }
    async create(dto) {
        const holdingDays = dto.purchasedAt && dto.soldAt
            ? this.computeHoldingDays(dto.purchasedAt, dto.soldAt)
            : null;
        const fee = this.feesService.calculate({
            symbol: dto.symbol,
            side: dto.isBuy ? 'buy' : 'sell',
            instrumentType: dto.instrumentType,
            entityType: dto.entityType,
            listingType: dto.listingType,
            price: dto.price,
            quantity: dto.qty,
            holdingDays: holdingDays ?? undefined,
            buyPricePerShare: dto.buyPricePerShare,
        });
        const netCostOrProceeds = dto.isBuy ? fee.totalBuyInCost : fee.netSellProceeds;
        const trade = this.tradesRepository.create({
            symbol: dto.symbol.toUpperCase(),
            isBuy: dto.isBuy,
            price: dto.price,
            qty: dto.qty,
            broker: dto.broker,
            totalValue: fee.grossValue,
            brokerFee: fee.brokerCommission,
            sebonFee: fee.sebonTransactionFee,
            dpFee: fee.dpCharge,
            cgtRate: fee.cgtRate,
            cgtAmount: fee.cgtAmount,
            netCostOrProceeds,
            purchasedAt: dto.purchasedAt ?? null,
            soldAt: dto.soldAt ?? null,
            holdingDays,
            sector: dto.sector ?? null,
            notes: dto.notes ?? null,
        });
        return this.tradesRepository.save(trade);
    }
    findAll() {
        return this.tradesRepository.find({ order: { id: 'DESC' } });
    }
    async findOne(id) {
        const trade = await this.tradesRepository.findOne({ where: { id } });
        if (!trade) {
            throw new common_1.NotFoundException('Trade not found');
        }
        return trade;
    }
    async remove(id) {
        await this.findOne(id);
        await this.tradesRepository.delete({ id });
    }
    computeHoldingDays(purchasedAt, soldAt) {
        const start = new Date(purchasedAt);
        const end = new Date(soldAt);
        const ms = end.getTime() - start.getTime();
        return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
    }
};
exports.TradesService = TradesService;
exports.TradesService = TradesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(trade_entity_1.TradeEntity)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        fees_service_1.FeesService])
], TradesService);
//# sourceMappingURL=trades.service.js.map