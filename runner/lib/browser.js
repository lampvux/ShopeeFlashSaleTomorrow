import fs from 'node:fs';
import { chromium } from 'playwright';
import { ENGINE_PATH, profileDir } from './config.js';

/**
 * Mở Chrome với profile riêng của shop (cookie/phiên đăng nhập lưu trong profiles/<id>).
 * Engine được nạp sẵn vào mọi trang qua addInitScript.
 */
export async function openShopContext(browserCfg, shop, { headless } = {}) {
  const dir = profileDir(shop.id);
  fs.mkdirSync(dir, { recursive: true });
  const opts = {
    headless: headless ?? browserCfg.headless ?? false,
    slowMo: browserCfg.slowMo || 0,
    viewport: null,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
      // 8 tab chạy song song: không cho Chrome làm chậm tab/cửa sổ đang ở nền
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  };
  if (browserCfg.channel) opts.channel = browserCfg.channel;

  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(dir, opts);
  } catch (e) {
    if (/ProcessSingleton|already in use|SingletonLock/i.test(e.message)) {
      throw new Error(`Profile ${shop.id} đang được mở bởi 1 cửa sổ Chrome khác. Đóng cửa sổ đó rồi chạy lại.`);
    }
    if (opts.channel && /(not found|Executable|distribution)/i.test(e.message)) {
      // Máy không cài Google Chrome → dùng Chromium của Playwright (npx playwright install chromium)
      delete opts.channel;
      ctx = await chromium.launchPersistentContext(dir, opts);
    } else {
      throw e;
    }
  }
  await ctx.addInitScript({ path: ENGINE_PATH });
  return ctx;
}

/** shop.json trong profile: ghi lại shop nào đã login, để phát hiện login nhầm shop. */
export function readProfileShop(shopId) {
  try { return JSON.parse(fs.readFileSync(`${profileDir(shopId)}/shop.json`, 'utf8')); } catch { return null; }
}
export function writeProfileShop(shopId, info) {
  fs.writeFileSync(`${profileDir(shopId)}/shop.json`, JSON.stringify({ ...info, savedAt: new Date().toISOString() }, null, 2));
}
