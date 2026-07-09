"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCache = loadCache;
exports.getClient = getClient;
exports.saveClient = saveClient;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
let cache = {};
function loadCache() {
    const cachePath = config_1.config.clientsCachePath;
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(cachePath)) {
        fs.writeFileSync(cachePath, JSON.stringify({}), 'utf-8');
        (0, logger_1.log)('ClientCache', 'Created new clients cache file');
        return;
    }
    try {
        const raw = fs.readFileSync(cachePath, 'utf-8');
        cache = JSON.parse(raw);
        (0, logger_1.log)('ClientCache', `Loaded ${Object.keys(cache).length} cached clients`);
    }
    catch (err) {
        (0, logger_1.error)('ClientCache', `Failed to load cache: ${err.message}`);
        cache = {};
    }
}
function getClient(telegramId) {
    return cache[telegramId] ?? null;
}
function saveClient(customer) {
    cache[customer.telegramId] = customer;
    try {
        const cachePath = config_1.config.clientsCachePath;
        const dir = path.dirname(cachePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
        (0, logger_1.log)('ClientCache', `Saved client ${customer.name} (${customer.telegramId})`);
    }
    catch (err) {
        (0, logger_1.error)('ClientCache', `Failed to save client cache: ${err.message}`);
    }
}
//# sourceMappingURL=clientCache.js.map