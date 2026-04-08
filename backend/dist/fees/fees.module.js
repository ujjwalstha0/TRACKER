"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeesModule = void 0;
const common_1 = require("@nestjs/common");
const fees_service_1 = require("./fees.service");
const fees_controller_1 = require("./fees.controller");
let FeesModule = class FeesModule {
};
exports.FeesModule = FeesModule;
exports.FeesModule = FeesModule = __decorate([
    (0, common_1.Module)({
        providers: [fees_service_1.FeesService],
        controllers: [fees_controller_1.FeesController],
        exports: [fees_service_1.FeesService],
    })
], FeesModule);
//# sourceMappingURL=fees.module.js.map