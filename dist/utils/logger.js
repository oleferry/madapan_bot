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
exports.log = log;
exports.warn = warn;
exports.error = error;
exports.logChange = logChange;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const config_1 = require("../config");
function timestamp() {
    return new Date().toISOString();
}
function log(context, message, data) {
    const extra = data !== undefined ? ` ${JSON.stringify(data)}` : '';
    console.log(`${timestamp()} [INFO] [${context}] ${message}${extra}`);
}
function warn(context, message, data) {
    const extra = data !== undefined ? ` ${JSON.stringify(data)}` : '';
    console.warn(`${timestamp()} [WARN] [${context}] ${message}${extra}`);
}
function error(context, message, data) {
    const extra = data !== undefined ? ` ${JSON.stringify(data)}` : '';
    console.error(`${timestamp()} [ERROR] [${context}] ${message}${extra}`);
}
function logChange(entry) {
    try {
        const logPath = config_1.config.logPath;
        const dir = path.dirname(logPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const line = JSON.stringify(entry) + '\n';
        fs.appendFileSync(logPath, line, 'utf-8');
    }
    catch (err) {
        error('Logger', `Failed to write change log: ${err.message}`);
    }
}
//# sourceMappingURL=logger.js.map