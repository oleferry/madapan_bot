import 'dotenv/config';
import { config } from './config';
import { loadCache } from './services/clientCache';
import { launchBot } from './bot/telegramBot';
import { scheduleDailySummary } from './jobs/dailySummaryJob';
import { log } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

async function main(): Promise<void> {
  // Ensure dirs exist
  fs.mkdirSync(path.dirname(config.logPath), { recursive: true });
  fs.mkdirSync(path.dirname(config.clientsCachePath), { recursive: true });

  loadCache();
  const bot = await launchBot();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduleDailySummary(bot as any);

  log('main', `Bot started. DRY_RUN=${config.dryRun}`);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch(console.error);
