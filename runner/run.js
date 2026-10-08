#!/usr/bin/env node
/**
 * Chạy hằng ngày: tạo Flash Sale cho tất cả khung giờ NGÀY MAI của từng shop.
 * Mặc định: các shop chạy SONG SONG (mỗi shop 1 Chrome), mỗi shop mở tối đa 8 tab song song (1 tab / khung giờ).
 *
 *   node runner/run.js                     # tất cả shop trong config/shops.json
 *   node runner/run.js --shop shop1        # 1 shop
 *   node runner/run.js --dry-run           # kiểm tra, KHÔNG tạo gì
 *   node runner/run.js --date 2026-10-07   # chạy bù cho 1 ngày cụ thể
 *   node runner/run.js --slots 3           # tối đa 3 tab song song mỗi shop
 *   node runner/run.js --sequential        # các shop chạy lần lượt
 *   node runner/run.js --headless          # không hiện cửa sổ Chrome
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, parseArgs } from './lib/config.js';
import { createLogger, logDirFor, cleanupOldLogs, acquireLock, vnTime } from './lib/logger.js';
import { openShopContext } from './lib/browser.js';
import { runShop } from './lib/job.js';

const HELP = 'Cách dùng: node runner/run.js [--shop id1,id2] [--dry-run] [--date YYYY-MM-DD] [--slots N] [--sequential] [--headless|--headed] [--config file]';

/** Chạy fn cho từng phần tử với tối đa `limit` cái cùng lúc, giữ nguyên thứ tự kết quả. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  });
  await Promise.all(lanes);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return 0; }
  const cfg = loadConfig(args.config);
  const release = acquireLock();
  const logDir = logDirFor();
  const runLog = createLogger(logDir, 'run');
  try {
    cleanupOldLogs(cfg.logRetentionDays);
    const shops = cfg.shops.filter((s) => (args.shops ? args.shops.includes(s.id) : s.enabled !== false));
    if (!shops.length) throw new Error(`Không có shop nào để chạy (lọc: ${args.shops || 'enabled'})`);
    const shopLimit = args.sequential || cfg.parallelShops === false ? 1
      : (typeof cfg.parallelShops === 'number' ? cfg.parallelShops : shops.length);
    runLog.info(`Bắt đầu: ${shops.map((s) => s.id).join(', ')} — ${shopLimit} shop song song, tối đa ${args.slots || cfg.defaults.parallelSlots} tab/shop${args.dryRun ? ' [DRY-RUN]' : ''}${args.date ? ` ngày ${args.date}` : ' (ngày mai)'}`);

    const t0 = Date.now();
    const summary = { startedAt: new Date().toISOString(), dryRun: args.dryRun, date: args.date, shops: [] };
    summary.shops = await pool(shops, shopLimit, async (shop) => {
      const log = createLogger(logDir, shop.id);
      const shopCfg = { ...cfg.defaults, ...(shop.overrides || {}), ...(args.slots ? { parallelSlots: args.slots } : {}) };
      let ctx;
      try {
        ctx = await openShopContext(cfg.browser, shop, { headless: args.headless ?? undefined });
        return await runShop(ctx, shop, shopCfg, log, { dryRun: args.dryRun, date: args.date });
      } catch (e) {
        log.error(`CRASH: ${e && e.stack ? e.stack : e}`);
        return { shop: shop.id, name: shop.name, status: 'CRASH', error: String(e && e.message) };
      } finally {
        if (ctx) await ctx.close().catch(() => {});
      }
    });
    summary.finishedAt = new Date().toISOString();
    summary.seconds = Math.round((Date.now() - t0) / 1000);
    const file = path.join(logDir, `summary-${vnTime().replace(/:/g, '')}.json`);
    fs.writeFileSync(file, JSON.stringify(summary, null, 2));

    const okStatuses = new Set(['OK', 'OK_WITH_ERRORS', 'DRY_RUN']);
    console.log(`\n================ TỔNG KẾT (${summary.seconds}s) ================`);
    for (const s of summary.shops) {
      const n = s.slots ? s.slots.length : 0;
      console.log(`${okStatuses.has(s.status) ? '✔' : '✘'} ${s.shop.padEnd(10)} ${String(s.status).padEnd(16)} ngày ${s.date || '-'}  tạo mới ${n}  còn trống ${s.remainingFree ?? '-'}${s.seconds != null ? `  ${s.seconds}s` : ''}${s.error ? '  ' + s.error : ''}`);
    }
    console.log(`Log: ${logDir}`);
    runLog.info(`Xong sau ${summary.seconds}s. Tổng kết: ${file}`);
    return summary.shops.every((s) => okStatuses.has(s.status)) ? 0 : 1;
  } finally {
    release();
  }
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(2);
});
