import * as fs from 'fs';
import * as path from 'path';
import { Customer } from '../types';
import { config } from '../config';
import { log, error } from '../utils/logger';

interface ClientCache {
  [telegramId: string]: Customer;
}

let cache: ClientCache = {};

export function loadCache(): void {
  const cachePath = config.clientsCachePath;
  const dir = path.dirname(cachePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(cachePath)) {
    fs.writeFileSync(cachePath, JSON.stringify({}), 'utf-8');
    log('ClientCache', 'Created new clients cache file');
    return;
  }

  try {
    const raw = fs.readFileSync(cachePath, 'utf-8');
    cache = JSON.parse(raw) as ClientCache;
    log('ClientCache', `Loaded ${Object.keys(cache).length} cached clients`);
  } catch (err) {
    error('ClientCache', `Failed to load cache: ${(err as Error).message}`);
    cache = {};
  }
}

export function getClient(telegramId: string): Customer | null {
  return cache[telegramId] ?? null;
}

export function saveClient(customer: Customer): void {
  cache[customer.telegramId] = customer;
  try {
    const cachePath = config.clientsCachePath;
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
    log('ClientCache', `Saved client ${customer.name} (${customer.telegramId})`);
  } catch (err) {
    error('ClientCache', `Failed to save client cache: ${(err as Error).message}`);
  }
}
