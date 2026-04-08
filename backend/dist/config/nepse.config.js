"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nepseConfig = void 0;
exports.nepseConfig = {
    brokerSlabs: [
        { max: 50000, rate: 0.0036 },
        { max: 500000, rate: 0.0033 },
        { max: 2000000, rate: 0.0031 },
        { max: 10000000, rate: 0.0027 },
        { max: null, rate: 0.0024 },
    ],
    commissionSplit: {
        broker: 0.794,
        nepse: 0.2,
        sebon: 0.006,
    },
    sebonFee: {
        equity: 0.00015,
        debenture: 0.0001,
        other: 0.00005,
    },
    dpCharge: 25,
    cgt: {
        listedShortTerm: 0.075,
        listedLongTerm: 0.05,
        unlistedIndividual: 0.1,
        entity: 0.1,
    },
};
//# sourceMappingURL=nepse.config.js.map