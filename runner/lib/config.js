import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ENGINE_PATH = path.join(ROOT, 'extension', 'fs-engine.js');
export const BASE_URL = 'https://banhang.shopee.vn';
export const LIST_PATH = '/portal/marketing/shop-flash-sale/list?type=0';

const DEFAULTS = {
  qty: 15,
  mode: 'one',             // tồn kho < qty → đặt fallbackQty (1). 'min' = đặt bằng tồn kho
  fallbackQty: 1,
  maxRetry: 4,
  skipUnfixable: true,
  preSubmitDelayMs: 1500,
  parallelSlots: 8,        // số tab chạy song song trong 1 shop
  staggerMs: 300,          // tab thứ i bắt đầu trễ i×staggerMs (tránh 8 request cùng 1 mili-giây)
  jitterMs: 300,           // + ngẫu nhiên 0..jitterMs
  maxAttemptsPerSlot: 3,   // 1 slot lỗi mà vẫn còn trống → thử lại
  retryBackoffMs: 2000,    // chờ trước khi thử lại (nhân theo số lần)
  circuitBreaker: 4,       // N slot lỗi liên tiếp → dừng shop
  repairEmpty: true,       // xoá flash sale RỖNG (0 sản phẩm) của ngày đích rồi tạo lại
  maxRounds: 2,            // số vòng tối đa: dọn rỗng → tạo khung giờ trống
};

export function loadConfig(file) {
  const p = file ? path.resolve(file) : path.join(ROOT, 'config', 'shops.json');
  if (!fs.existsSync(p)) {
    throw new Error(`Không thấy ${p}. Hãy copy config/shops.example.json thành config/shops.json rồi sửa.`);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const shops = (raw.shops || []).filter((s) => s && s.id);
  if (!shops.length) throw new Error('config: chưa khai báo shop nào trong "shops".');
  const ids = new Set();
  for (const s of shops) {
    if (!/^[\w-]+$/.test(s.id)) throw new Error(`config: id "${s.id}" chỉ được chứa chữ, số, _ hoặc -`);
    if (ids.has(s.id)) throw new Error(`config: trùng id "${s.id}"`);
    ids.add(s.id);
  }
  return {
    file: p,
    defaults: { ...DEFAULTS, ...(raw.defaults || {}) },
    browser: { channel: 'chrome', headless: false, slowMo: 0, ...(raw.browser || {}) },
    parallelShops: raw.parallelShops ?? true, // true = tất cả shop cùng lúc; số = tối đa N shop cùng lúc; false = lần lượt
    logRetentionDays: raw.logRetentionDays ?? 30,
    shops,
  };
}

/** --shop a,b  --dry-run  --headless  --date YYYY-MM-DD  --config path */
export function parseArgs(argv) {
  const out = { shops: null, dryRun: false, headless: null, date: null, config: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--shop' || a === '-s') out.shops = next().split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--dry-run' || a === '--dry') out.dryRun = true;
    else if (a === '--headless') out.headless = true;
    else if (a === '--headed') out.headless = false;
    else if (a === '--date') out.date = next();
    else if (a === '--config') out.config = next();
    else if (a === '--slots') out.slots = Math.max(1, parseInt(next(), 10) || 1);
    else if (a === '--sequential') out.sequential = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-') && !out.shops) out.shops = [a];
  }
  if (out.date && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new Error(`--date phải có dạng YYYY-MM-DD (nhận: ${out.date})`);
  return out;
}

export function profileDir(shopId) {
  return path.join(ROOT, 'profiles', shopId);
}
