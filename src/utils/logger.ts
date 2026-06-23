import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { ChangeLogEntry } from '../types';

function timestamp(): string {
  return new Date().toISOString();
}

export function log(context: string, message: string, data?: unknown): void {
  const extra = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  console.log(`${timestamp()} [INFO] [${context}] ${message}${extra}`);
}

export function warn(context: string, message: string, data?: unknown): void {
  const extra = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  console.warn(`${timestamp()} [WARN] [${context}] ${message}${extra}`);
}

export function error(context: string, message: string, data?: unknown): void {
  const extra = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  console.error(`${timestamp()} [ERROR] [${context}] ${message}${extra}`);
}

export function logChange(entry: ChangeLogEntry): void {
  try {
    const logPath = config.logPath;
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch (err) {
    error('Logger', `Failed to write change log: ${(err as Error).message}`);
  }
}
