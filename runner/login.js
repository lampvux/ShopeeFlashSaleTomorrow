#!/usr/bin/env node
/**
 * Đăng nhập 1 lần cho mỗi shop (phiên được lưu trong profiles/<id>).
 *   node runner/login.js shop1
 * Mật khẩu/OTP do BẠN tự nhập trong cửa sổ Chrome — script không đọc, không lưu.
 */
import readline from 'node:readline';
import { loadConfig, BASE_URL, LIST_PATH } from './lib/config.js';
import { openShopContext, writeProfileShop } from './lib/browser.js';

async function main() {
  const argv = process.argv.slice(2);
  const ci = argv.indexOf('--config');
  const cfg = loadConfig(ci >= 0 ? argv[ci + 1] : null);
  const id = argv.find((a, i) => !a.startsWith('-') && !(ci >= 0 && i === ci + 1));
  const shop = cfg.shops.find((s) => s.id === id);
  if (!shop) {
    console.log(`Cách dùng: npm run login -- <id>\nCác shop trong config: ${cfg.shops.map((s) => s.id).join(', ')}`);
    return 1;
  }
  const ctx = await openShopContext(cfg.browser, shop, { headless: false });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(BASE_URL + LIST_PATH, { waitUntil: 'domcontentloaded' });
  console.log(`\n→ Cửa sổ Chrome cho "${shop.id}" đã mở. Hãy đăng nhập ĐÚNG shop "${shop.name || shop.id}" (kể cả OTP).`);
  console.log('  Script tự nhận biết khi đăng nhập xong. (Ctrl+C để huỷ)\n');

  let stop = false;
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', () => { stop = true; });

  let info = null;
  for (let i = 0; i < 600 && !stop && !info; i++) { // tối đa ~20 phút
    await page.waitForTimeout(2000);
    try {
      if (!/banhang\.shopee\.vn/.test(page.url())) continue;
      info = await page.evaluate(() => (window.__FSA ? window.__FSA.getShopInfo() : null));
    } catch { /* đang chuyển trang */ }
  }
  rl.close();
  if (info) {
    writeProfileShop(shop.id, info);
    console.log(`✔ Đã đăng nhập: ${info.name} (shop_id ${info.shopId}). Phiên được lưu cho "${shop.id}".`);
    if (!/shop-flash-sale\/list/.test(page.url())) await page.goto(BASE_URL + LIST_PATH).catch(() => {});
    await page.waitForTimeout(3000);
  } else {
    console.log('✘ Chưa xác nhận được đăng nhập.');
  }
  await ctx.close();
  return info ? 0 : 1;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e.message || e); process.exit(2); });
