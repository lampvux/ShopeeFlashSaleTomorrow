import path from 'node:path';
import { BASE_URL, LIST_PATH } from './config.js';
import { readProfileShop } from './browser.js';

const ENGINE_KEYS = ['qty', 'mode', 'fallbackQty', 'maxRetry', 'skipUnfixable', 'preSubmitDelayMs'];
const isNavError = (e) => /context was destroyed|navigat|Target closed/i.test(String(e && e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (n) => Math.floor(Math.random() * (n || 0));

/**
 * Chạy 1 shop. Các khung giờ trống của ngày đích được chia cho tối đa `parallelSlots` tab chạy SONG SONG.
 * Mỗi tab được GIAO CỐ ĐỊNH 1 slot (không tranh nhau):
 *   create?from=<mẫu> → chọn đúng slot đó → SL → Bật (+retry) → Xác nhận → slot tiếp theo trong hàng đợi.
 */
export async function runShop(context, shop, cfg, log, opts = {}) {
  const base = opts.baseUrl || BASE_URL;
  const page0 = context.pages()[0] || (await context.newPage());
  const res = {
    shop: shop.id, name: shop.name, startedAt: new Date().toISOString(),
    status: 'OK', date: null, slots: [], errors: [], incomplete: [], remainingFree: null,
  };
  const t0 = Date.now();
  const engineCfg = Object.fromEntries(ENGINE_KEYS.map((k) => [k, cfg[k]]));
  engineCfg.dryRun = !!opts.dryRun;

  const shot = async (page, tag) => {
    try {
      const f = log.shotPath(`${shop.id}-${tag}`);
      await page.screenshot({ path: f });
      log.info(`Ảnh chụp: ${path.basename(f)}`);
    } catch { /* bỏ qua */ }
  };
  const engineReady = (page) => page.waitForFunction(() => !!window.__FSA, null, { timeout: 30000 });

  async function gotoList(page) {
    await page.goto(base + LIST_PATH, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await engineReady(page);
    await page.waitForFunction(() => ['list', 'login'].includes(window.__FSA.pageKind()), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
    return page.evaluate(() => window.__FSA.pageKind());
  }

  // ---- 1. Phiên đăng nhập + đúng shop
  const kind = await gotoList(page0);
  let info = null;
  if (kind === 'list') info = await page0.evaluate(() => window.__FSA.getShopInfo()).catch(() => null);
  if (kind !== 'list' || !info) {
    res.status = 'SESSION_EXPIRED';
    log.error(`Chưa đăng nhập / phiên hết hạn. Chạy: npm run login -- ${shop.id}`);
    await shot(page0, 'login');
    return res;
  }
  res.shopName = info.name;
  res.shopId = info.shopId;
  const saved = readProfileShop(shop.id);
  if (saved && saved.shopId && saved.shopId !== info.shopId) {
    res.status = 'WRONG_SHOP';
    log.error(`Profile ${shop.id} đang đăng nhập shop "${info.name}" (${info.shopId}) nhưng lúc login đã lưu "${saved.name}" (${saved.shopId}). Dừng để an toàn.`);
    return res;
  }
  log.info(`Shop: ${info.name} (${info.shopId})${opts.dryRun ? '  [DRY-RUN — không tạo gì]' : ''}`);

  // ---- 2. Ngày đích → (dọn flash sale rỗng) → khung giờ trống → chạy song song; lặp tối đa maxRounds vòng
  const target = await page0.evaluate((d) => (d ? window.__FSA.vnDate(d) : window.__FSA.vnTomorrow()), opts.date || null);
  engineCfg.target = target;
  res.date = target.label;
  const doRepair = cfg.repairEmpty !== false;
  const maxRounds = opts.dryRun ? 1 : Math.max(1, cfg.maxRounds || 1);
  const short = (s) => s.slice(0, 5);
  res.repaired = [];
  res.repairFailed = [];
  let templateId = null;
  let freeAtStart = null;
  let stopShop = false;

  /** Xoá flash sale RỖNG (0 sản phẩm) của ngày đích — sót lại từ lần chạy lỗi — để tạo lại cho đúng. */
  async function repair(round) {
    if (!doRepair) return;
    if (!/shop-flash-sale\/list/.test(page0.url())) await gotoList(page0);
    let rep;
    try { rep = await page0.evaluate(([t, d]) => window.__FSA.repairEmpty(t, { dryRun: d }), [target, !!opts.dryRun]); }
    catch (e) { log.warn(`Không kiểm tra được flash sale rỗng: ${String(e && e.message).split('\n')[0]}`); return; }
    log.json('repair', { round, rep });
    if (!rep.found) return;
    const names = (arr) => arr.map((d) => `${short(d.label)} id=${d.id}`).join(', ');
    if (opts.dryRun) { log.info(`[DRY-RUN] Có ${rep.found} flash sale RỖNG sẽ bị xoá & tạo lại khi chạy thật: ${names(rep.deleted)}`); return; }
    if (rep.deleted.length) log.warn(`Đã xoá ${rep.deleted.length} flash sale RỖNG (0 sản phẩm) để tạo lại: ${names(rep.deleted)}`);
    for (const f of rep.failed) log.error(`Không xoá được flash sale rỗng ${f.label} id=${f.id}: ${f.message}`);
    res.repaired.push(...rep.deleted);
    res.repairFailed.push(...rep.failed);
    if (rep.deleted.length) await sleep(1500); // để Shopee giải phóng khung giờ
  }

  for (let round = 1; round <= maxRounds && !stopShop; round++) {
    const R = round > 1 ? `[Vòng ${round}] ` : '';
    await repair(round);
    if (!/banhang\.shopee\.vn/.test(page0.url())) await gotoList(page0);
    const free = await page0.evaluate((t) => window.__FSA.getFreeSlots(t), target);
    if (freeAtStart === null) freeAtStart = free.length;
    log.info(`${R}Ngày ${target.label}: còn ${free.length} khung giờ trống${free.length ? ' → ' + free.map((s) => short(s.label)).join(', ') : ''}`);
    if (!free.length) break;

    templateId = templateId || shop.templateFlashSaleId || (await page0.evaluate(() => window.__FSA.getTemplateId()));
    if (!templateId) {
      res.errors.push({ message: 'Không có flash sale nào để sao chép' });
      log.error('Không có flash sale mẫu để sao chép.');
      break;
    }
    await runPool(free, R);
    if (stopShop || opts.dryRun || round >= maxRounds) break;

    // Còn flash sale rỗng / khung giờ trống → vòng sau (dọn rỗng rồi tạo lại)
    await gotoList(page0);
    const after = await page0.evaluate((t) => window.__FSA.getCreatedForDay(t), target).catch(() => []);
    const empties = doRepair ? after.filter((c) => !c.items && !c.enabledItems).length : 0;
    const freeAfter = (await page0.evaluate((t) => window.__FSA.getFreeSlots(t), target).catch(() => [])).length;
    if (!empties && !freeAfter) break;
    log.warn(`Sau vòng ${round}: ${empties} flash sale rỗng, ${freeAfter} khung giờ còn trống → chạy vòng ${round + 1}`);
  }

  /** Chạy 1 vòng: các khung giờ `free` chia cho tối đa parallelSlots tab. */
  async function runPool(free, R) {
    const parallel = Math.max(1, Math.min(cfg.parallelSlots || 1, free.length));
    log.info(`${R}Mẫu: flash sale ${templateId}. Chạy SONG SONG ${parallel} tab cho ${free.length} khung giờ.`);
    const queue = free.map((slot) => ({ slot, attempts: 0 }));
    let stopAll = false;
    let failStreak = 0;
    let templateRefresh = null;
    const stop = (msg) => { stopAll = true; stopShop = true; log.error(msg); };

    // ---- 1 khung giờ trên 1 tab
    async function runOneSlot(page, job, tag) {
      try {
        await page.goto(`${base}/portal/marketing/shop-flash-sale/create?from=${templateId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await engineReady(page);
        const rep = await page.evaluate((c) => window.__FSA.prepareSlot(c), { ...engineCfg, slotIds: [job.slot.id] });
        log.json('prepare', { tag, slot: job.slot.label, attempt: job.attempts, rep });
        if (rep.status === 'none') return { ok: false, status: 'none' };
        if (rep.status === 'dry-run') return { ok: true, dry: true, rep };
        if (!rep.ok) {
          await shot(page, `loi-${short(job.slot.label).replace(':', 'h')}-${job.attempts}`);
          return { ok: false, status: rep.status, code: rep.code, message: rep.message, flashSaleCreated: !!rep.flashSaleCreated, stillClosed: rep.enable && rep.enable.stillClosed };
        }
        const q = rep.quantities, en = rep.enable;
        const list = (arr, f) => arr.slice(0, 12).map(f).join('; ') + (arr.length > 12 ? `; …(+${arr.length - 12})` : '');
        if (q.locked && q.locked.length) log.info(`${tag} Bỏ qua ${q.locked.length}/${q.total} phân loại bị khoá (hết hàng / không tham gia được): ${list(q.locked, (a) => a.name)}`);
        if (q.adjusted.length) {
          const how = cfg.mode === 'min' ? 'SL theo tồn kho' : `SL=${cfg.fallbackQty}`;
          log.info(`${tag} Tồn kho < ${q.qty} → ${how}: ${list(q.adjusted, (a) => `${a.name} (kho ${a.stock})=${a.qty}`)}`);
        }
        if (en.fixed.length) log.warn(`${tag} Báo lỗi khi Bật → đặt SL=${cfg.fallbackQty} rồi Bật lại: ${list(en.fixed, (f) => `${f.name} (${f.msg})`)}`);
        if (en.skipped.length) log.warn(`${tag} Bỏ chọn ${en.skipped.length} dòng không bật được: ${list(en.skipped, (f) => `${f.name} (${f.msg})`)}`);
        if (en.refused && en.refused.length) log.warn(`${tag} Shopee không bật ${en.refused.length} phân loại (không báo lỗi) → bỏ qua: ${list(en.refused, (f) => `${f.name} (kho ${f.stock}, SL ${f.qty}${f.switchLocked ? ', công tắc bị khoá' : ''}${f.hint ? `, ${f.hint}` : ''})`)}`);
        if (rep.verify && !rep.verify.error) log.info(`${tag} Shopee đã lưu: bật ${rep.verify.enabled}/${rep.verify.total} phân loại`);

        try { await page.evaluate((c) => window.__FSA.submit(c), engineCfg); }
        catch (e) { if (!isNavError(e)) throw e; }
        let navigated = await page.waitForURL(/shop-flash-sale\/list/, { timeout: 30000 }).then(() => true).catch(() => false);
        if (!navigated) {
          const chk = await page.evaluate(() => window.__FSA.postSubmitCheck(8000)).catch(() => null);
          navigated = !!(chk && chk.navigated);
          // Sản phẩm đã được lưu ở bước Bật, nên slot vẫn coi là xong; chỉ cảnh báo.
          if (!navigated) { await shot(page, `xacnhan-${short(job.slot.label).replace(':', 'h')}`); log.warn(`${tag} Sau Xác nhận chưa về danh sách: ${JSON.stringify(chk)}`); }
        }
        return { ok: true, rep, navigated };
      } catch (e) {
        await shot(page, `crash-${short(job.slot.label).replace(':', 'h')}`);
        return { ok: false, status: 'exception', message: String(e && e.message).split('\n')[0] };
      }
    }

    async function slotStillFree(page, slotId) {
      try {
        if (!/banhang\.shopee\.vn/.test(page.url())) await gotoList(page);
        await engineReady(page);
        const f = await page.evaluate((t) => window.__FSA.getFreeSlots(t), target);
        return f.some((s) => s.id === slotId);
      } catch { return null; } // không biết
    }

    // ---- worker = 1 tab
    async function worker(page, wi) {
      await sleep(wi * (cfg.staggerMs || 0) + rand(cfg.jitterMs));
      for (;;) {
        if (stopAll) return;
        const job = queue.shift();
        if (!job) return;
        job.attempts++;
        const tag = `${R}[${short(job.slot.label)}|tab${wi + 1}]`;
        log.info(`${tag} bắt đầu${job.attempts > 1 ? ` (lần ${job.attempts})` : ''}`);
        const r = await runOneSlot(page, job, tag);

        if (r.ok && r.dry) {
          res.dryRunSlots = (res.dryRunSlots || []).concat(r.rep.slot.label);
          log.info(`${tag} DRY-RUN OK: chọn được slot ${r.rep.slot.label} (${r.rep.rows} phân loại, ${r.rep.selectable} tham gia được), đã Hủy.`);
          continue;
        }
        if (r.ok) {
          failStreak = 0;
          const en = r.rep.enable, q = r.rep.quantities;
          const v = r.rep.verify && !r.rep.verify.error ? r.rep.verify : null;
          res.slots.push({ slot: r.rep.slot.formLabel || r.rep.slot.label, start: job.slot.start, timeslotId: job.slot.id, tab: wi + 1, attempts: job.attempts, rows: r.rep.rows, open: en.open, locked: (q.locked || []).length, adjusted: q.adjusted.length, fixed: en.fixed.length, skipped: en.skipped.length, refused: (en.refused || []).length, savedEnabled: v ? v.enabled : null });
          log.info(`${tag} ✔ Đã tạo ${r.rep.slot.formLabel || job.slot.label} — bật ${v ? v.enabled : en.open}/${en.total} phân loại`);
          continue;
        }
        if (r.status === 'none') { log.warn(`${tag} slot không còn trống (đã có flash sale) — bỏ qua.`); continue; }

        log.error(`${tag} Lỗi ${r.code || r.status}: ${r.message}`);
        if (r.code === 'NO_SELECTABLE' && !r.flashSaleCreated) {
          res.errors.push({ slot: job.slot.label, attempts: job.attempts, code: r.code, message: r.message });
          stop('Flash sale mẫu không còn phân loại nào tham gia được (hết hàng) → dừng shop. Đổi mẫu (templateFlashSaleId) hoặc nhập thêm hàng.');
          return;
        }
        // Mẫu bị xoá giữa chừng → lấy lại mẫu 1 lần (dùng chung cho mọi tab)
        if (r.code === 'TEMPLATE_INVALID') {
          if (shop.templateFlashSaleId) { stop('Flash sale mẫu đã ghim (templateFlashSaleId) không còn → dừng shop.'); }
          else {
            templateRefresh = templateRefresh || page.evaluate(() => window.__FSA.getTemplateId()).catch(() => null);
            const fresh = await templateRefresh;
            templateRefresh = null;
            if (fresh && fresh !== templateId) { log.warn(`Đổi mẫu sang ${fresh}`); templateId = fresh; }
          }
        }
        const stillFree = r.flashSaleCreated ? false : await slotStillFree(page, job.slot.id);
        if (!stopAll && stillFree !== false && job.attempts < (cfg.maxAttemptsPerSlot || 2)) {
          const wait = (cfg.retryBackoffMs || 2000) * job.attempts + rand(1000);
          log.warn(`${tag} Slot vẫn trống → thử lại sau ${Math.round(wait / 1000)}s`);
          await sleep(wait);
          queue.push(job);
          continue;
        }
        res.errors.push({ slot: job.slot.label, timeslotId: job.slot.id, attempts: job.attempts, status: r.status, code: r.code, message: r.message, flashSaleCreated: stillFree === false, stillClosed: r.stillClosed });
        if (stillFree === false) log.error(`${tag} Flash sale có thể ĐÃ được tạo nhưng chưa hoàn tất — sẽ kiểm tra/dọn ở vòng sau hoặc bước tổng kết.`);
        failStreak++;
        if (failStreak >= (cfg.circuitBreaker || 4)) stop(`${failStreak} slot lỗi liên tiếp → dừng shop này để an toàn.`);
      }
    }

    const pages = [page0];
    for (let i = 1; i < parallel; i++) pages.push(await context.newPage());
    await Promise.all(pages.map((p, i) => worker(p, i)));
    for (const p of pages.slice(1)) await p.close().catch(() => {});
    if (queue.length) log.warn(`Còn ${queue.length} slot chưa chạy (đã dừng).`);
  }

  if (opts.dryRun) {
    res.status = 'DRY_RUN';
    const n = res.dryRunSlots ? res.dryRunSlots.length : 0;
    log.info(`DRY-RUN xong trong ${Math.round((Date.now() - t0) / 1000)}s: ${n}/${freeAtStart || 0} slot chọn được, không tạo gì.`);
    if (freeAtStart && n < freeAtStart) res.status = 'PARTIAL';
    return res;
  }

  // ---- 3. Kiểm tra lại toàn bộ ngày đích
  await gotoList(page0);
  const created = await page0.evaluate((t) => window.__FSA.getCreatedForDay(t), target);
  res.slots.sort((a, b) => a.start - b.start);
  res.dayCreated = created;
  res.incomplete = created.filter((c) => !c.enabledItems);
  // Đối chiếu với dữ liệu Shopee: slot bị báo lỗi nhưng flash sale thực tế ĐÃ có sản phẩm bật → không phải lỗi
  const okSlots = new Set(created.filter((c) => c.enabledItems > 0).map((c) => c.timeslotId));
  // (slot đã được tạo lại ở vòng sau thì lỗi là thật — đã tự xử lý — giữ ở errors)
  const redone = new Set(res.slots.map((x) => String(x.timeslotId)));
  res.warnings = res.errors.filter((e) => e.timeslotId && okSlots.has(String(e.timeslotId)) && !redone.has(String(e.timeslotId)));
  res.errors = res.errors.filter((e) => !res.warnings.includes(e));
  for (const w of res.warnings) log.warn(`[${w.slot.slice(0, 5)}] Báo lỗi "${w.code || w.status}" nhưng Shopee đã lưu flash sale có sản phẩm bật → coi là đã tạo.`);
  try {
    const day = await page0.evaluate((t) => window.__FSA.verifyDay(t), target);
    res.dayVerify = day.map((d) => ({ label: d.label, id: d.id, enabled: d.enabled, total: d.total, error: d.error }));
    log.json('verifyDay', day);
  } catch (e) { log.warn(`Không kiểm tra được chi tiết phân loại: ${String(e && e.message).split('\n')[0]}`); }
  res.remainingFree = (await page0.evaluate((t) => window.__FSA.getFreeSlots(t), target)).length;
  res.seconds = Math.round((Date.now() - t0) / 1000);
  const vMap = Object.fromEntries((res.dayVerify || []).map((d) => [d.id, d]));
  const fmtFs = (c) => { const d = vMap[c.id]; return `${c.label.slice(0, 5)}:${c.enabledItems}sp${d && d.total ? `/${d.enabled}pl` : ''}`; };
  log.info(`Tổng kết ${target.label} (${res.seconds}s): ${created.length} flash sale [${created.map(fmtFs).join(', ')}], còn trống ${res.remainingFree} (sp = sản phẩm bật, pl = phân loại bật)`);
  if (res.incomplete.length) {
    log.warn(`Flash sale RỖNG (0 sản phẩm bật): ${res.incomplete.map((c) => `${c.label} id=${c.id}`).join('; ')}. `
      + `Chạy lại cho ngày này${opts.date ? '' : ` (--date ${target.iso})`} để tự xoá & tạo lại, hoặc xoá tay bằng "Thêm → Xóa".`);
  }
  if (res.incomplete.length) res.status = 'INCOMPLETE';
  else if (res.remainingFree > 0) res.status = 'PARTIAL';
  else if (res.errors.length) res.status = 'OK_WITH_ERRORS';
  res.finishedAt = new Date().toISOString();
  return res;
}
