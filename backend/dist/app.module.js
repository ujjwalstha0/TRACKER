"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const fees_module_1 = require("./fees/fees.module");
const reports_module_1 = require("./reports/reports.module");
const simulation_module_1 = require("./simulation/simulation.module");
const trade_entity_1 = require("./trades/trade.entity");
const trades_module_1 = require("./trades/trades.module");
const watchlist_module_1 = require("./watchlist/watchlist.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forRoot({
                type: 'postgres',
                host: process.env.DB_HOST ?? 'localhost',
                port: Number(process.env.DB_PORT ?? 5432),
                username: process.env.DB_USER ?? 'postgres',
                password: process.env.DB_PASSWORD ?? 'postgres',
                database: process.env.DB_NAME ?? 'nepse_tracker',
                entities: [trade_entity_1.TradeEntity],
                synchronize: false,
            }),
            fees_module_1.FeesModule,
            trades_module_1.TradesModule,
            watchlist_module_1.WatchlistModule,
            simulation_module_1.SimulationModule,
            reports_module_1.ReportsModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map