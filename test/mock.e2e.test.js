/**
 * Test end-to-end trên mock Seller Center (không cần mạng / tài khoản Shopee).
 *   node test/mock.e2e.test.js            → Playwright runner
 *   node test/mock.e2e.test.js --ext      → thêm test Chrome extension
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createState, installMock, vnDayStart } from './mock/server.js';
import { runShop } from '../runner/lib/job.js';
import { createLogger } from '../runner/lib/logger.js';
import { ENGINE_PATH, ROOT } from '../runner/lib/config.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fsa-test-'));
const CFG = { qty: 15, mode: 'one', fallbackQty: 1, maxRetry: 4, skipUnfixable: true, preSubmitDelayMs: 200, parallelSlots: 8, staggerMs: 100, jitterMs: 100, maxAttemptsPerSlot: 3, retryBackoffMs: 500, circuitBreaker: 4, repairEmpty: true, maxRounds: 2 };
const HOURS = [0, 2, 9, 12, 15, 17, 19, 21];
const SHOP = { id: 'mocktest', name: 'Mock' };
const results = [];

async function withCtx(state, fn) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await installMock(ctx, state);
  await ctx.addInitScript({ path: ENGINE_PATH });
  try { return await fn(ctx); } finally { await browser.close(); }
}
const tomorrowFs = (state, start = vnDayStart(1)) => state.flashSales.filter((f) => f.status !== 0 && f.start_time >= start && f.start_time < start + 86400);
const count = (state, p) => state.requests.filter((r) => r.path.endsWith(`/${p}/`)).length;

const ONLY_EXT = process.argv.includes('--only-ext');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7); // chạy test có tên chứa chuỗi này
async function test(name, fn) {
  if (ONLY_EXT && !name.startsWith('Extension')) return;
  if (ONLY && !name.includes(ONLY)) return;
  const t0 = Date.now();
  try { await fn(); results.push([true, name, Date.now() - t0]); console.log(`✔ ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push([false, name]); console.error(`✘ ${name}\n   ${e.stack || e}`); }
}
const log = (n) => createLogger(TMP, n, { quiet: true });

// --------------------------------------------------------------------------- runner
const spread = (st) => { const t = st.createTimes || []; return t.length ? (Math.max(...t) - Math.min(...t)) / 1000 : 0; };
const checkItems = (st, fss, mode = 'one') => {
  const byVar = Object.fromEntries(st.products.flatMap((p) => p.models).map((m) => [m.model_id, m.variation]));
  for (const f of fss) {
    const m = Object.fromEntries(f.items.map((i) => [byVar[i.model_id], i]));
    assert.equal(m['Đen,S'].stock, 15); assert.equal(m['Đen,S'].status, 1);
    assert.equal(m['Đen,L'].stock, mode === 'min' ? 7 : 1, `tồn 7 → SL ${mode === 'min' ? 7 : 1}`);
    assert.equal(m['Đen,L'].status, 1);
    assert.equal(m['Xám,M'].stock, 1, 'giới hạn ẩn → báo lỗi → SL 1');
    assert.equal(m['Xám,M'].status, 1);
    assert.equal(m['Xám,L'].status, 0, 'tồn 0 → bị khoá, không bật');
  }
};

/** Giống mẫu của Pear.club (log 08/10): 120 phân loại, 22 phân loại tồn kho 0 (bị khoá ô tích), 1 phân loại tồn 4. */
function pearProducts() {
  const P = [];
  let mid = 7000000, zero = 0;
  for (let i = 0; i < 12; i++) {
    const models = [];
    for (let j = 0; j < 10; j++) {
      const idx = i * 10 + j;
      let stock = 50 + (idx * 7) % 300;
      if (idx % 5 === 3 && zero < 22) { stock = 0; zero++; }
      models.push({ model_id: ++mid, variation: `${['S', 'M', 'L', 'XL', '2XL'][j % 5]},${j >= 5 ? 'Trắng' : 'Đen'}#${idx}`, price: 300000, promo: 199000, stock, max: stock });
    }
    P.push({ item_id: 50000000000 + i, name: `[MOCK] Pear SP ${i + 1}`, models });
  }
  Object.assign(P[1].models[6], { stock: 4, max: 4, variation: 'M,Trắng' });
  return P;
}
const checkPear = (st, fss) => {
  const models = st.products.flatMap((p) => p.models);
  for (const f of fss) {
    const it = Object.fromEntries(f.items.map((i) => [i.model_id, i]));
    for (const m of models) {
      const i = it[m.model_id];
      if (m.stock === 0) assert.ok(!i || i.status === 0, `${m.variation}: tồn 0 không được bật`);
      else if (m.stock < 15) { assert.equal(i.stock, 1, `${m.variation}: tồn ${m.stock} → SL 1`); assert.equal(i.status, 1); }
      else { assert.equal(i.stock, 15, m.variation); assert.equal(i.status, 1); }
    }
  }
};

await test('8 tab song song: tạo đủ 8 khung giờ, mỗi slot đúng 1 lần, SL đúng quy tắc', async () => {
  const st = createState({ latencyMs: 100 });
  const t0 = Date.now();
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, CFG, log('parallel8')));
  const secs = (Date.now() - t0) / 1000;
  assert.equal(res.status, 'OK', JSON.stringify(res.errors));
  assert.equal(res.slots.length, 8);
  assert.equal(new Set(res.slots.map((x) => x.tab)).size, 8, 'dùng đủ 8 tab');
  assert.equal(count(st, 'set_shop_flash_sale'), 8, 'không tạo trùng');
  assert.equal(tomorrowFs(st).length, 8);
  checkItems(st, tomorrowFs(st));
  assert.ok(spread(st) < 6, `8 lệnh tạo nằm trong ${spread(st)}s (song song)`);
  console.log(`   ↳ 1 shop × 8 slot: ${secs.toFixed(1)}s, 8 lệnh tạo trong ${spread(st).toFixed(1)}s`);
});

await test('Shopee chặn vì tạo quá nhanh → tự thử lại, vẫn đủ 8, không trùng', async () => {
  const st = createState({ latencyMs: 50, rateLimit: { max: 3, windowMs: 3000 } });
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, { ...CFG, maxAttemptsPerSlot: 5, retryBackoffMs: 1500 }, log('ratelimit')));
  assert.ok(st.rejected > 0, 'mock phải từ chối ít nhất 1 lần');
  assert.equal(res.remainingFree, 0, JSON.stringify(res.errors));
  assert.equal(tomorrowFs(st).length, 8);
  assert.equal(count(st, 'set_shop_flash_sale') - st.rejected, 8, 'đúng 8 lệnh tạo thành công');
  console.log(`   ↳ bị từ chối ${st.rejected} lần, tự thử lại thành công`);
});

await test('3 shop song song × 8 tab: mỗi shop đủ 8 khung giờ', async () => {
  const states = [1, 2, 3].map(() => createState({ latencyMs: 100 }));
  const t0 = Date.now();
  const results = await Promise.all(states.map((st, i) => withCtx(st, (ctx) => runShop(ctx, { id: `shop${i + 1}`, name: `S${i + 1}` }, CFG, log(`multi${i + 1}`)))));
  const secs = (Date.now() - t0) / 1000;
  results.forEach((r, i) => { assert.equal(r.status, 'OK', `shop${i + 1}: ${JSON.stringify(r.errors)}`); assert.equal(tomorrowFs(states[i]).length, 8); });
  console.log(`   ↳ 3 shop × 8 slot = 24 tab: ${secs.toFixed(1)}s`);
});

await test('Chạy lại lần 2 không tạo trùng (idempotent)', async () => {
  const st = createState();
  await withCtx(st, async (ctx) => {
    await runShop(ctx, SHOP, CFG, log('idem1'));
    const before = count(st, 'set_shop_flash_sale');
    const res2 = await runShop(ctx, SHOP, CFG, log('idem2'));
    assert.equal(res2.status, 'OK');
    assert.equal(res2.slots.length, 0);
    assert.equal(count(st, 'set_shop_flash_sale'), before);
  });
});

await test('Dry-run 8 tab song song không gửi request tạo nào', async () => {
  const st = createState();
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, CFG, log('dry'), { dryRun: true }));
  assert.equal(res.status, 'DRY_RUN');
  assert.equal(res.dryRunSlots.length, 8);
  assert.equal(count(st, 'set_shop_flash_sale'), 0);
  assert.equal(count(st, 'set_shop_flash_sale_items'), 0);
  assert.equal(tomorrowFs(st).length, 0);
});

await test('Chế độ 1 tab, tắt repairEmpty: slot đã có được bỏ qua; flash sale rỗng → INCOMPLETE', async () => {
  const d1 = vnDayStart(1);
  const st = createState({ preCreated: [{ start: d1 }, { start: d1 + 2 * 3600, empty: true }] });
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, { ...CFG, parallelSlots: 1, repairEmpty: false }, log('pre')));
  assert.equal(res.slots.length, 6);
  assert.equal(res.incomplete.length, 1);
  assert.equal(res.status, 'INCOMPLETE');
  assert.equal(tomorrowFs(st).length, 8);
  assert.equal((st.deleted || []).length, 0);
});

await test('Flash sale RỖNG sót lại từ lần lỗi trước → tự xoá rồi tạo lại → OK', async () => {
  const d1 = vnDayStart(1);
  const st = createState({ preCreated: [{ start: d1 }, { start: d1 + 2 * 3600, empty: true }, { start: d1 + 9 * 3600, empty: true }, { start: d1 + 12 * 3600, empty: true }] });
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, CFG, log('repair')));
  assert.equal(res.status, 'OK', JSON.stringify(res.errors));
  assert.equal(st.deleted.length, 3, 'xoá đúng 3 flash sale rỗng');
  assert.equal(res.repaired.length, 3);
  assert.equal(res.slots.length, 7, '7 khung giờ được tạo (00:00 đã có sẵn)');
  const fss = tomorrowFs(st);
  assert.equal(fss.length, 8);
  assert.ok(fss.every((f) => f.items.some((i) => i.status === 1)), 'không còn flash sale rỗng');
});

await test('Dry-run có flash sale rỗng → chỉ báo, KHÔNG xoá', async () => {
  const d1 = vnDayStart(1);
  const st = createState({ preCreated: [{ start: d1, empty: true }] });
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, CFG, log('dryrepair'), { dryRun: true }));
  assert.equal(res.status, 'DRY_RUN');
  assert.equal((st.deleted || []).length, 0);
  assert.equal(count(st, 'set_shop_flash_sale'), 0);
});

await test('Mẫu như Pear.club (98/120 chọn được, 1 dòng tồn 4) + popup kẹt → 8 khung giờ OK, tồn thấp = 1', async () => {
  const st = createState({ products: pearProducts(), stuckModal: true, latencyMs: 50 });
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, CFG, log('pear')));
  assert.equal(res.status, 'OK', JSON.stringify(res.errors));
  assert.equal(res.slots.length, 8);
  assert.ok(res.slots.every((x) => x.locked === 22), 'bỏ qua đúng 22 dòng bị khoá');
  assert.equal(count(st, 'set_shop_flash_sale'), 8);
  checkPear(st, tomorrowFs(st));
});

await test('Shopee âm thầm không bật 3 phân loại (log Pear.club 08/10 tối) → vẫn OK, không báo lỗi nhầm, có Xác nhận', async () => {
  const products = pearProducts();
  for (const [i, j] of [[0, 1], [4, 2], [9, 7]]) products[i].models[j].refuse = true;
  const st = createState({ products, latencyMs: 50 });
  const t0 = Date.now();
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, CFG, log('refuse')));
  const secs = (Date.now() - t0) / 1000;
  assert.equal(res.status, 'OK', JSON.stringify(res.errors));
  assert.equal(res.slots.length, 8);
  assert.ok(res.slots.every((x) => x.refused === 3 && x.savedEnabled === 95), JSON.stringify(res.slots));
  assert.equal(count(st, 'set_item_sequence'), 8, 'phải bấm Xác nhận cuối trang ở cả 8 khung giờ');
  assert.ok(res.dayVerify.every((d) => d.enabled === 95));
  assert.ok(secs < 40, `không được chờ hết maxRetry (${secs}s)`);
  console.log(`   ↳ ${secs.toFixed(1)}s`);
});

await test('Báo lỗi lúc chạy nhưng Shopee đã lưu sản phẩm bật → đối chiếu lại, không tính là lỗi', async () => {
  // engine cũ báo enable-failed dù flash sale đã bật: mô phỏng bằng cách bắt engine trả lỗi giả sau khi Bật
  const st = createState({ latencyMs: 20 });
  const res = await withCtx(st, async (ctx) => {
    await ctx.addInitScript(() => {
      const t = setInterval(() => {
        const F = window.__FSA;
        if (!F || F.__patched) return;
        clearInterval(t);
        F.__patched = true;
        const orig = F.prepareSlot;
        F.prepareSlot = async (c) => { const r = await orig(c); return r.ok && r.status === 'ready' ? { ...r, ok: false, status: 'enable-failed', message: 'giả lập báo lỗi nhầm' } : r; };
      }, 20);
    });
    return runShop(ctx, SHOP, { ...CFG, parallelSlots: 4, circuitBreaker: 100 }, log('recon'));
  });
  assert.equal(res.errors.length, 0, JSON.stringify(res.errors));
  assert.equal(res.warnings.length, 4 + 4);
  assert.equal(res.status, 'OK');
  assert.equal(tomorrowFs(st).length, 8);
});

await test('Mẫu không còn phân loại nào có hàng → NO_SELECTABLE, dừng, không tạo flash sale rỗng', async () => {
  const products = pearProducts().map((p) => ({ ...p, models: p.models.map((m) => ({ ...m, stock: 0, max: 0 })) }));
  const st = createState({ products });
  const t0 = Date.now();
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, CFG, log('allzero')));
  assert.equal(count(st, 'set_shop_flash_sale'), 0, 'không được tạo gì');
  assert.ok(res.errors.some((e) => e.code === 'NO_SELECTABLE'), JSON.stringify(res.errors));
  assert.equal(res.status, 'PARTIAL');
  assert.ok(Date.now() - t0 < 30000);
});

await test('Lưu sản phẩm lỗi → flash sale rỗng → vòng 2 tự xoá & tạo lại', async () => {
  const d1 = vnDayStart(1);
  // maxRetry 1 → 2 lần Bật: lần 1 sửa dòng lỗi SL, lần 2 lưu → lỗi (itemsFail 1) → flash sale rỗng
  const st = createState({ itemsFail: 1, preCreated: HOURS.slice(0, 7).map((h) => ({ start: d1 + h * 3600 })) });
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, { ...CFG, maxRetry: 1 }, log('round2')));
  assert.equal(st.itemsFailed, 1);
  assert.equal((st.deleted || []).length, 1, 'xoá flash sale rỗng của vòng 1');
  assert.equal(res.status, 'OK_WITH_ERRORS', JSON.stringify(res));
  assert.equal(res.remainingFree, 0);
  assert.equal(res.incomplete.length, 0);
  assert.equal(tomorrowFs(st).length, 8);
  assert.ok(tomorrowFs(st).every((f) => f.items.some((i) => i.status === 1)));
});

await test('Phiên hết hạn → SESSION_EXPIRED, không làm gì', async () => {
  const st = createState({ loggedIn: false });
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, CFG, log('login')));
  assert.equal(res.status, 'SESSION_EXPIRED');
  assert.equal(st.requests.length, 0);
});

await test('Ngày đích sang tháng sau (--date ngày 1) → bấm sang tháng, song song 4 tab', async () => {
  const st = createState();
  const now = new Date(Date.now() + 7 * 3600e3);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const ymd = first.toISOString().slice(0, 10);
  const res = await withCtx(st, (ctx) => runShop(ctx, SHOP, { ...CFG, parallelSlots: 4, mode: 'min' }, log('month'), { date: ymd }));
  assert.equal(res.status, 'OK', JSON.stringify(res.errors));
  const ds = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1) / 1000 - 7 * 3600;
  assert.equal(tomorrowFs(st, ds).length, 8);
  checkItems(st, tomorrowFs(st, ds), 'min');
});

await test('Mẫu ghim không còn → dừng nhanh, không tạo gì, không lặp vô hạn', async () => {
  const st = createState();
  const t0 = Date.now();
  const res = await withCtx(st, (ctx) => runShop(ctx, { ...SHOP, templateFlashSaleId: '123' }, CFG, log('tpl')));
  assert.ok(res.errors.length >= 1);
  assert.equal(res.errors[0].code, 'TEMPLATE_INVALID');
  assert.equal(res.status, 'PARTIAL');
  assert.equal(count(st, 'set_shop_flash_sale'), 0);
  assert.ok(Date.now() - t0 < 30000, 'phải dừng nhanh');
});

// --------------------------------------------------------------------------- extension
async function runExtension(st, { par = 8, dry = false, mode = null, windows = true, repair = true } = {}) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsa-ext-'));
  const extPath = path.join(ROOT, 'extension');
  const ctx = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  });
  try {
    await installMock(ctx, st);
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const extId = sw.url().split('/')[2];
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto('https://banhang.shopee.vn/portal/marketing/shop-flash-sale/list?type=0');
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.fill('#qty', '15');
    await popup.fill('#par', String(par));
    if (dry) await popup.check('#dry');
    if (mode) await popup.selectOption('#mode', mode);
    if (!windows) await popup.uncheck('#windows');
    if (!repair) await popup.uncheck('#repair');
    let maxTabs = 0;
    const timer = setInterval(() => { maxTabs = Math.max(maxTabs, ctx.pages().filter((p) => p.url().includes('/shop-flash-sale/')).length); }, 300);
    await popup.evaluate(() => window.__startForTest());
    await popup.waitForFunction(() => document.querySelector('#state')?.dataset.phase === 'done', null, { timeout: 240000, polling: 1000 });
    clearInterval(timer);
    const status = await popup.$eval('#state', (e) => e.dataset.status);
    const fullLog = await popup.evaluate(() => chrome.storage.local.get('run').then(({ run }) => run.log.map((l) => l.msg).join('\n')));
    const logText = fullLog.slice(-3000);
    const openTabs = ctx.pages().filter((p) => p.url().includes('/shop-flash-sale/create')).length;
    const windowsUsed = await sw.evaluate(() => chrome.windows.getAll().then((w) => w.length)).catch(() => null);
    return { status, logText, fullLog, maxTabs, openTabs, windowsUsed };
  } finally {
    await ctx.close();
  }
}

if (process.argv.includes('--ext') || ONLY_EXT) {
  await test('Extension: 8 cửa sổ song song từ popup, đủ 8 khung giờ, tự đóng', async () => {
    const st = createState({ latencyMs: 100 });
    const t0 = Date.now();
    const r = await runExtension(st, { par: 8 });
    assert.equal(r.status, 'OK', r.logText);
    assert.equal(tomorrowFs(st).length, 8);
    assert.equal(count(st, 'set_shop_flash_sale'), 8, 'không tạo trùng');
    checkItems(st, tomorrowFs(st));
    assert.ok(r.maxTabs >= 8, `phải mở ≥8 tab (thấy ${r.maxTabs})`);
    assert.equal(r.openTabs, 0, 'cửa sổ worker phải tự đóng');
    console.log(`   ↳ ${((Date.now() - t0) / 1000).toFixed(1)}s, tối đa ${r.maxTabs} tab Shopee cùng lúc, 8 lệnh tạo trong ${spread(st).toFixed(1)}s`);
  });

  await test('Extension (chế độ tab): bị chặn vì quá nhanh → background giao lại slot, vẫn đủ 8', async () => {
    const st = createState({ latencyMs: 50, rateLimit: { max: 3, windowMs: 3000 } });
    const r = await runExtension(st, { par: 8, windows: false });
    assert.ok(st.rejected > 0);
    assert.equal(tomorrowFs(st).length, 8, r.logText);
    assert.ok(['OK', 'OK_WITH_ERRORS'].includes(r.status), r.status + '\n' + r.logText);
    console.log(`   ↳ bị từ chối ${st.rejected} lần, trạng thái ${r.status}`);
  });

  await test('Extension: tái hiện log Pear.club 08/10 (3 rỗng sót lại, 98/120, popup kẹt) → dọn & tạo đủ 8', async () => {
    const d1 = vnDayStart(1);
    const st = createState({ products: pearProducts(), stuckModal: true, latencyMs: 50,
      preCreated: [0, 2, 9].map((h) => ({ start: d1 + h * 3600, empty: true })) });
    const r = await runExtension(st, { par: 8 });
    assert.equal(r.status, 'OK', r.logText);
    assert.equal(st.deleted.length, 3, 'xoá 3 flash sale rỗng');
    assert.equal(tomorrowFs(st).length, 8);
    checkPear(st, tomorrowFs(st));
    assert.match(r.fullLog, /Đã xoá 3 flash sale RỖNG/);
    assert.match(r.fullLog, /Bỏ qua 22\/120 phân loại bị khoá/);
  });

  await test('Extension: Shopee âm thầm không bật 3 phân loại → OK, đủ 8, ghi rõ phân loại bị từ chối', async () => {
    const products = pearProducts();
    for (const [i, j] of [[0, 1], [4, 2], [9, 7]]) products[i].models[j].refuse = true;
    const st = createState({ products, latencyMs: 50 });
    const r = await runExtension(st, { par: 8 });
    assert.equal(r.status, 'OK', r.fullLog);
    assert.equal(tomorrowFs(st).length, 8);
    assert.equal(count(st, 'set_item_sequence'), 8, 'phải bấm Xác nhận');
    assert.match(r.fullLog, /Shopee không bật 3 phân loại/);
    assert.match(r.fullLog, /Tạo mới lần này: 8/);
    assert.doesNotMatch(r.fullLog, /enable-failed/);
  });

  await test('Extension: lưu sản phẩm lỗi → vòng 2 tự dọn & tạo lại', async () => {
    const d1 = vnDayStart(1);
    // maxRetry 4 → 5 lần Bật: 1 lần sửa dòng lỗi + 4 lần lưu lỗi → flash sale rỗng → vòng 2
    const st = createState({ itemsFail: 4, preCreated: HOURS.slice(0, 7).map((h) => ({ start: d1 + h * 3600 })) });
    const r = await runExtension(st, { par: 8 });
    assert.equal((st.deleted || []).length, 1, r.logText);
    assert.equal(tomorrowFs(st).length, 8);
    assert.ok(tomorrowFs(st).every((f) => f.items.some((i) => i.status === 1)), r.logText);
    assert.ok(['OK', 'OK_WITH_ERRORS'].includes(r.status), r.status + '\n' + r.logText);
    assert.match(r.fullLog, /vòng 2/i);
  });

  await test('Extension: dry-run 8 tab không tạo gì', async () => {
    const st = createState();
    const r = await runExtension(st, { par: 8, dry: true });
    assert.equal(r.status, 'DRY_RUN', r.logText);
    assert.equal(count(st, 'set_shop_flash_sale'), 0);
  });
}

const failed = results.filter((r) => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} test đạt. Log: ${TMP}`);
process.exit(failed ? 1 : 0);
