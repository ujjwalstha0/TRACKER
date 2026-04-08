"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeesService = void 0;
const common_1 = require("@nestjs/common");
const nepse_config_1 = require("../config/nepse.config");
let FeesService = class FeesService {
    calculate(input) {
        const grossValue = this.round2(input.price * input.quantity);
        const brokerRate = this.resolveBrokerRate(grossValue);
        const brokerCommission = this.round2(grossValue * brokerRate);
        const commissionSplit = {
            broker: this.round2(brokerCommission * nepse_config_1.nepseConfig.commissionSplit.broker),
            nepse: this.round2(brokerCommission * nepse_config_1.nepseConfig.commissionSplit.nepse),
            sebonInside: this.round2(brokerCommission * nepse_config_1.nepseConfig.commissionSplit.sebon),
        };
        const sebonTransactionFee = this.round2(grossValue * nepse_config_1.nepseConfig.sebonFee[input.instrumentType]);
        const dpCharge = input.side === 'sell' ? nepse_config_1.nepseConfig.dpCharge : 0;
        const cgtRate = input.side === 'sell' ? this.resolveCgtRate(input) : 0;
        const realizedProfit = input.side === 'sell' && input.buyPricePerShare
            ? this.round2((input.price - input.buyPricePerShare) * input.quantity)
            : 0;
        const taxableProfit = Math.max(0, realizedProfit);
        const cgtAmount = this.round2(taxableProfit * cgtRate);
        const totalFeesExcludingCgt = this.round2(brokerCommission + sebonTransactionFee + dpCharge);
        const totalBuyInCost = this.round2(input.side === 'buy' ? grossValue + totalFeesExcludingCgt : 0);
        const netSellProceeds = this.round2(input.side === 'sell' ? grossValue - totalFeesExcludingCgt - cgtAmount : 0);
        return {
            grossValue,
            brokerCommission,
            commissionSplit,
            sebonTransactionFee,
            dpCharge,
            cgtRate,
            cgtAmount,
            totalFeesExcludingCgt,
            totalBuyInCost,
            netSellProceeds,
        };
    }
    resolveBrokerRate(tradeValue) {
        for (const slab of nepse_config_1.nepseConfig.brokerSlabs) {
            if (slab.max === null || tradeValue <= slab.max) {
                return slab.rate;
            }
        }
        return nepse_config_1.nepseConfig.brokerSlabs[nepse_config_1.nepseConfig.brokerSlabs.length - 1].rate;
    }
    resolveCgtRate(input) {
        if (input.entityType === 'entity') {
            return nepse_config_1.nepseConfig.cgt.entity;
        }
        if (input.listingType === 'unlisted') {
            return nepse_config_1.nepseConfig.cgt.unlistedIndividual;
        }
        if ((input.holdingDays ?? 0) > 365) {
            return nepse_config_1.nepseConfig.cgt.listedLongTerm;
        }
        return nepse_config_1.nepseConfig.cgt.listedShortTerm;
    }
    round2(value) {
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }
};
exports.FeesService = FeesService;
exports.FeesService = FeesService = __decorate([
    (0, common_1.Injectable)()
], FeesService);
//# sourceMappingURL=fees.service.js.map