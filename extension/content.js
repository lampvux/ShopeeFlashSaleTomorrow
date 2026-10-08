/*
 * Content script — mỗi tab banhang.shopee.vn hỏi background "tôi đóng vai gì?":
 *   controller: đọc slot trống → init → chờ → tổng kết
 *   worker:     làm đúng 1 slot được giao → báo kết quả → nhận slot tiếp / bị đóng
 * Chạy được cả khi trang reload lẫn khi Shopee chuyển trang kiểu SPA.
 */
(() => {
  const F = window.__FSA;
  if (!F || window.__FSA_CONTENT__) return;
  window.__FSA_CONTENT__ = true;

  const send = (type, data = {}) => chrome.runtime.sendMessage({ type, ...data });
  const log = (msg, level = 'info') => send('log', { msg, level }).catch(() => {});
  let busy = false;
  let working = null; // slotId đang làm trong lần tải trang này

  // ------------------------------------------------------------ controller
  async function controller(r) {
    const kind = F.pageKind();
    if (kind === 'login') return send('finish', { msg: 'Chưa đăng nhập Shopee Seller Center.', level: 'warn', patch: { status: 'SESSION_EXPIRED' } });
    if (r.phase === 'start') {
      if (kind !== 'list') { location.href = F.LIST_URL; return; }
      const info = await F.getShopInfo().catch(() => null);
      if (!info) return send('finish', { msg: 'Chưa đăng nhập Shopee Seller Center.', level: 'warn', patch: { status: 'SESSION_EXPIRED' } });
      const t = r.ctx.target;
      const cfg = r.ctx.cfg;
      await log(`Shop: ${info.name} — ngày ${t.label}${cfg.dryRun ? ' [DRY-RUN]' : ''}`);
      await repair(r);
      const free = await F.getFreeSlots(t);
      await log(`Ngày ${t.label}: còn ${free.length} khung giờ trống${free.length ? ' → ' + free.map((s) => s.label.slice(0, 5)).join(', ') : ''}`);
      if (!free.length) return finalize(r, info.name);
      const templateId = cfg.templateId || (await F.getTemplateId());
      if (!templateId) return send('finish', { msg: 'Không có flash sale nào để sao chép.', level: 'error', patch: { status: 'ERROR' } });
      await send('init', { shopName: info.name, templateId, slots: free, round: 1, screen: screenBox() });
      return;
    }
    if (r.phase === 'running') { await send('watchdog'); return; }
    if (r.phase === 'finalizing') {
      if (kind !== 'list') { location.href = F.LIST_URL; return; }
      return finalize(r);
    }
  }

  const screenBox = () => ({ left: screen.availLeft || 0, top: screen.availTop || 0, width: screen.availWidth, height: screen.availHeight });

  /** Xoá flash sale RỖNG (0 sản phẩm) của ngày đích — sót lại từ lần chạy lỗi — để tạo lại cho đúng. */
  async function repair(r) {
    const cfg = r.ctx.cfg;
    if (cfg.repairEmpty === false) return { found: 0, deleted: [] };
    let rep;
    try { rep = await F.repairEmpty(r.ctx.target, { dryRun: !!cfg.dryRun }); }
    catch (e) { await log(`Không kiểm tra được flash sale rỗng: ${e.message}`, 'warn'); return { found: 0, deleted: [] }; }
    if (!rep.found) return rep;
    const names = (arr) => arr.map((d) => `${d.label.slice(0, 5)} (id ${d.id})`).join(', ');
    if (cfg.dryRun) await log(`[DRY-RUN] Có ${rep.found} flash sale RỖNG sẽ bị xoá & tạo lại khi chạy thật: ${names(rep.deleted)}`, 'warn');
    else if (rep.deleted.length) await log(`Đã xoá ${rep.deleted.length} flash sale RỖNG (0 sản phẩm) để tạo lại: ${names(rep.deleted)}`, 'warn');
    for (const f of rep.failed || []) await log(`Không xoá được flash sale rỗng ${f.label} (id ${f.id}): ${f.message}`, 'error');
    if (!cfg.dryRun && rep.deleted.length) await F._.sleep(1500); // để Shopee giải phóng khung giờ
    return rep;
  }

  async function finalize(r, shopName) {
    const t = r.ctx.target;
    const cfg = r.ctx.cfg;
    const dry = cfg.dryRun;
    const round = r.ctx.round || 1;
    const maxRounds = Math.max(1, cfg.maxRounds || 2);
    let created = await F.getCreatedForDay(t);
    let free = await F.getFreeSlots(t);
    const empties = created.filter((c) => !c.items && !c.enabledItems);

    // Còn flash sale rỗng / khung giờ trống → dọn rỗng rồi chạy thêm 1 vòng (tối đa maxRounds)
    if (!dry && !r.stopRequested && cfg.repairEmpty !== false && round < maxRounds && (r.jobs || []).length && (empties.length || free.length)) {
      await log(`Sau vòng ${round}: ${empties.length} flash sale rỗng, ${free.length} khung giờ trống → chạy vòng ${round + 1}`, 'warn');
      await repair(r);
      free = await F.getFreeSlots(t);
      const templateId = r.ctx.templateId || cfg.templateId || (await F.getTemplateId());
      if (free.length && templateId) {
        const ok = await send('init', { templateId, slots: free, round: round + 1, screen: screenBox() });
        if (ok && ok.ok) return;
      }
      created = await F.getCreatedForDay(t);
    }

    const incomplete = created.filter((c) => !c.enabledItems);
    // Đối chiếu với dữ liệu Shopee: khung giờ bị báo lỗi nhưng flash sale thực tế ĐÃ có sản phẩm bật → tính là đã tạo
    const okSlots = new Set(created.filter((c) => c.enabledItems > 0).map((c) => c.timeslotId));
    // (khung giờ đã được tạo lại ở vòng 2 thì lỗi vòng 1 là thật — đã tự xử lý — giữ nguyên)
    const doneSlots = new Set((r.jobs || []).filter((j) => j.status === 'done').map((j) => String(j.slotId)));
    const jobs = (r.jobs || []).map((j) => (j.status === 'failed' && okSlots.has(String(j.slotId)) && !doneSlots.has(String(j.slotId)) ? { ...j, status: 'done', recovered: true } : j));
    for (const j of jobs.filter((x) => x.recovered)) await log(`[${j.label.slice(0, 5)}] Báo lỗi lúc chạy nhưng Shopee đã lưu flash sale có sản phẩm bật → tính là đã tạo.`, 'warn');
    let detail = '';
    if (!dry) {
      try {
        const day = await F.verifyDay(t);
        const vMap = Object.fromEntries(day.map((d) => [d.id, d]));
        detail = created.map((c) => { const d = vMap[c.id]; return d && d.total ? `${c.label.slice(0, 5)}: ${d.enabled}/${d.total}` : null; }).filter(Boolean).join(', ');
      } catch (_) { /* chỉ để báo cáo */ }
    }
    const failed = jobs.filter((j) => j.status === 'failed').length;
    let status = 'OK';
    if (dry) status = jobs.every((j) => j.status === 'done') ? 'DRY_RUN' : 'PARTIAL';
    else if (incomplete.length) status = 'INCOMPLETE';
    else if (free.length) status = 'PARTIAL';
    else if (failed) status = 'OK_WITH_ERRORS';
    const made = jobs.filter((j) => j.status === 'done').length;
    let msg = dry
      ? `DRY-RUN xong: ${made}/${jobs.length} khung giờ chọn được, không tạo gì.`
      : `Ngày ${t.label}: ${created.length} flash sale [${created.map((c) => `${c.label.slice(0, 5)}:${c.enabledItems}sp`).join(', ')}], còn trống ${free.length}. Tạo mới lần này: ${made}.`;
    if (detail) msg += ` Phân loại bật (Shopee đã lưu): ${detail}.`;
    if (incomplete.length) msg += ` Flash sale RỖNG: ${incomplete.map((c) => c.label).join(', ')} — bấm Chạy lại cho ngày này để tự xoá & tạo lại, hoặc xoá tay bằng "Thêm → Xóa".`;
    await send('finish', { msg, level: status === 'OK' || status === 'DRY_RUN' ? 'info' : 'warn', patch: { status, jobs, dayCreated: created, incomplete, remainingFree: free.length, ...(shopName ? { shopName } : {}) } });
  }

  // ------------------------------------------------------------ worker
  async function worker(r) {
    const { job, ctx } = r;
    if (working === job.slotId) return; // đang làm trong lần tải trang này
    const kind = F.pageKind();
    if (kind === 'login') return result(job, { ok: false, code: 'SESSION_EXPIRED', message: 'Chưa đăng nhập', fatal: true });
    if (job.status === 'working') {
      // Trang bị tải lại giữa chừng (không phải do script) → báo lỗi, background quyết định thử lại
      return result(job, { ok: false, code: 'RELOADED', message: 'Trang bị tải lại giữa chừng', stillFree: await isFree(ctx, job.slotId) });
    }
    if (kind !== 'create') { location.href = F.createUrl(ctx.templateId); return; }

    working = job.slotId;
    await send('jobStart', { slotId: job.slotId });
    const rep = await F.prepareSlot({ ...ctx.cfg, target: ctx.target, slotIds: [job.slotId] });
    if (rep.status === 'none') return result(job, { ok: false, skipped: true, message: 'slot không còn trống (đã có flash sale)' });
    if (rep.status === 'dry-run') return result(job, { ok: true, dry: true, result: { slot: rep.slot.label } });
    if (!rep.ok) {
      const stillFree = rep.flashSaleCreated ? false : await isFree(ctx, job.slotId);
      // Mẫu không còn phân loại nào tham gia được → slot nào cũng sẽ lỗi y hệt → dừng cả lượt chạy
      const fatal = rep.code === 'NO_SELECTABLE' && !rep.flashSaleCreated;
      return result(job, { ok: false, code: rep.code || rep.status, message: rep.message, stillFree, fatal });
    }
    const q = rep.quantities, en = rep.enable;
    const warnings = [];
    const list = (arr, f) => arr.slice(0, 12).map(f).join('; ') + (arr.length > 12 ? `; …(+${arr.length - 12})` : '');
    if (q.locked && q.locked.length) warnings.push(`Bỏ qua ${q.locked.length}/${q.total} phân loại bị khoá (hết hàng / không tham gia được): ${list(q.locked, (a) => a.name)}`);
    if (q.adjusted.length) warnings.push(`Tồn kho < ${q.qty} → ${ctx.cfg.mode === 'min' ? 'SL theo tồn kho' : `SL=${ctx.cfg.fallbackQty}`}: ${list(q.adjusted, (a) => `${a.name} (kho ${a.stock})=${a.qty}`)}`);
    if (en.fixed.length) warnings.push(`Báo lỗi khi Bật → đặt SL=${ctx.cfg.fallbackQty} rồi Bật lại: ${list(en.fixed, (f) => `${f.name} (${f.msg})`)}`);
    if (en.skipped.length) warnings.push(`Bỏ chọn ${en.skipped.length} dòng không bật được: ${list(en.skipped, (f) => `${f.name} (${f.msg})`)}`);
    if (en.refused && en.refused.length) warnings.push(`Shopee không bật ${en.refused.length} phân loại (không báo lỗi) → bỏ qua: ${list(en.refused, (f) => `${f.name} (kho ${f.stock}, SL ${f.qty}${f.switchLocked ? ', công tắc bị khoá' : ''}${f.hint ? `, ${f.hint}` : ''})`)}`);
    const v = rep.verify && !rep.verify.error ? rep.verify : null;
    await F.submit(ctx.cfg);
    // Shopee tự về trang danh sách (SPA). Sản phẩm đã lưu ở bước Bật nên kể cả không về cũng coi là xong.
    await F._.waitFor(() => F.pageKind() === 'list', { timeout: 30000 }).catch(() => warnings.push('Sau Xác nhận chưa về danh sách'));
    return result(job, { ok: true, warnings, result: { slot: rep.slot.formLabel || rep.slot.label, open: v ? v.enabled : en.open, total: en.total, locked: (q.locked || []).length, fixed: en.fixed.length, skipped: en.skipped.length, refused: (en.refused || []).length, adjusted: q.adjusted.length } });
  }

  async function isFree(ctx, slotId) {
    try { return (await F.getFreeSlots(ctx.target)).some((s) => s.id === slotId); } catch { return null; }
  }

  async function result(job, data) {
    const resp = await send('jobResult', { slotId: job.slotId, ...data }).catch(() => null);
    working = null;
    if (resp && resp.next) {
      if (resp.waitMs) await F._.sleep(resp.waitMs);
      location.href = F.createUrl(resp.ctx.templateId); // tab này nhận slot tiếp theo
    }
    // không có slot tiếp → background tự đóng tab
  }

  // ------------------------------------------------------------ vòng lặp
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const r = await send('role').catch(() => null);
      if (!r || r.role === 'none') return;
      if (r.role === 'controller') await controller(r);
      else if (r.role === 'worker') await worker(r);
    } catch (e) {
      log(`Lỗi không mong muốn: ${e && e.message}`, 'error');
      if (working) { const slotId = working; working = null; await send('jobResult', { slotId, ok: false, code: 'EXCEPTION', message: String(e && e.message) }).catch(() => {}); }
    } finally {
      busy = false;
    }
  }
  setInterval(tick, 1500);
  setTimeout(tick, 600);

  // popup hỏi thông tin shop của tab này
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg && msg.type === 'shopInfo') {
      F.getShopInfo().then((i) => sendResponse({ ok: true, ...i })).catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });
})();
