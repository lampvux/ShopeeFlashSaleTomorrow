/*
 * Service worker = BỘ ĐIỀU PHỐI duy nhất cho chế độ nhiều tab.
 *  - Tab điều khiển (controller): tab bạn bấm Chạy; đọc slot trống → "init" → cuối cùng tổng kết.
 *  - Worker (mặc định mỗi worker 1 cửa sổ xếp lưới): được GIAO 1 slot; làm xong báo "jobResult" → nhận slot tiếp theo hoặc bị đóng.
 *  - Tổng kết còn flash sale rỗng / khung giờ trống → controller dọn rỗng rồi "init" vòng 2.
 * Mọi thay đổi trạng thái đi qua đây, tuần tự bằng khoá → các tab không bao giờ tranh nhau 1 slot.
 * Trạng thái nằm trong chrome.storage.local["run"] (service worker có thể bị tắt/bật lại bất kỳ lúc nào).
 */
const BASE = 'https://banhang.shopee.vn';
const LIST = BASE + '/portal/marketing/shop-flash-sale/list?type=0';
const createUrl = (id) => `${BASE}/portal/marketing/shop-flash-sale/create?from=${encodeURIComponent(id)}`;
const ACTIVE = new Set(['start', 'running', 'finalizing']);
const TERMINAL = new Set(['done', 'failed', 'skipped']);
const WORK_TIMEOUT_MS = 4 * 60 * 1000;

let lock = Promise.resolve();
function withLock(fn) {
  const p = lock.then(fn, fn);
  lock = p.catch(() => {});
  return p;
}
const getRun = async () => (await chrome.storage.local.get('run')).run || null;
const saveRun = (run) => chrome.storage.local.set({ run });

function addLog(run, level, msg) {
  run.log.push({ t: Date.now(), level, msg });
  if (run.log.length > 800) run.log.splice(0, run.log.length - 800);
}
function badge(run) {
  const jobs = run.jobs || [];
  const done = jobs.filter((j) => j.status === 'done').length;
  let text = jobs.length ? `${done}/${jobs.length}` : '…';
  let color = '#ee4d2d';
  if (run.phase === 'done') {
    const good = run.status === 'OK' || run.status === 'DRY_RUN';
    text = good ? '✓' : '!';
    color = good ? '#2e7d32' : '#c62828';
  }
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}
const ctxFor = (run) => ({ target: run.target, cfg: run.cfg, templateId: run.templateId, round: run.round || 1 });
const allTerminal = (run) => run.jobs.length > 0 && run.jobs.every((j) => TERMINAL.has(j.status));

/** Chia màn hình thành lưới cho n cửa sổ worker (không chồng lên nhau → Chrome coi là đang hiển thị). */
function tile(n, scr) {
  const S = scr && scr.width > 0 ? scr : { left: 0, top: 0, width: 1600, height: 900 };
  const cols = n <= 2 ? n : n <= 4 ? 2 : 4;
  const rowsN = Math.ceil(n / cols);
  const w = Math.max(500, Math.floor(S.width / cols));
  const h = Math.max(400, Math.floor(S.height / rowsN));
  return Array.from({ length: n }, (_, i) => ({
    left: Math.round(S.left + (i % cols) * Math.min(w, S.width / cols)),
    top: Math.round(S.top + Math.floor(i / cols) * Math.min(h, S.height / rowsN)),
    width: w,
    height: h,
  }));
}

/** Giao slot đang chờ cho tabId. Trả về { job, waitMs } hoặc null. */
function assignNext(run, tabId) {
  if (run.stopRequested) return null;
  const now = Date.now();
  const pending = run.jobs.filter((j) => j.status === 'pending').sort((a, b) => (a.retryAt || 0) - (b.retryAt || 0));
  const job = pending[0];
  if (!job) return null;
  job.status = 'assigned';
  job.tabId = tabId;
  return { job, waitMs: Math.max(0, (job.retryAt || 0) - now) };
}

async function closeWorker(run, tabId) {
  if (tabId && tabId !== run.controllerTabId) await chrome.tabs.remove(tabId).catch(() => {});
}

function maybeFinalize(run) {
  if (run.phase === 'running' && (allTerminal(run) || (run.stopRequested && !run.jobs.some((j) => j.status === 'working' || j.status === 'assigned')))) {
    run.phase = 'finalizing';
    addLog(run, 'info', 'Tất cả khung giờ đã xử lý xong → tổng kết.');
  }
}

const handlers = {
  whoami: async (_m, sender) => ({ tabId: sender.tab ? sender.tab.id : null }),

  /** popup → bắt đầu */
  start: async (m) => {
    const run = m.run;
    await saveRun(run);
    await chrome.storage.local.remove('stop');
    badge(run);
    await chrome.tabs.update(run.controllerTabId, { url: LIST, active: true });
    return { ok: true };
  },

  /** content script hỏi: tab này đang đóng vai gì? */
  role: async (_m, sender) => {
    const run = await getRun();
    const tabId = sender.tab && sender.tab.id;
    if (!run || !ACTIVE.has(run.phase) || !tabId) return { role: 'none' };
    if (tabId === run.controllerTabId) return { role: 'controller', phase: run.phase, ctx: ctxFor(run), jobs: run.jobs, stopRequested: !!run.stopRequested };
    const job = (run.jobs || []).find((j) => j.tabId === tabId && (j.status === 'assigned' || j.status === 'working'));
    if (job && run.phase === 'running') return { role: 'worker', job, ctx: ctxFor(run) };
    return { role: 'none' };
  },

  log: async (m) => {
    const run = await getRun();
    if (!run) return {};
    addLog(run, m.level || 'info', m.msg);
    await saveRun(run);
    return {};
  },

  /**
   * controller → danh sách slot cần tạo; mở các worker.
   * Mặc định mỗi worker là 1 CỬA SỔ riêng, xếp lưới cho cùng hiện trên màn hình: Chrome dừng hiệu ứng
   * (requestAnimationFrame) ở tab nền nên popup khung giờ của Shopee có thể "kẹt" (lỗi TIMEOUT 07/10).
   * round > 1 = vòng tạo lại sau khi đã dọn flash sale rỗng.
   */
  init: async (m) => {
    const run = await getRun();
    const round = m.round || 1;
    const okPhase = round === 1 ? run && run.phase === 'start' : run && run.phase === 'finalizing' && round > (run.round || 1);
    if (!okPhase) return { ok: false };
    run.shopName = m.shopName || run.shopName;
    run.templateId = m.templateId || run.templateId;
    run.round = round;
    const fresh = m.slots.map((s) => ({ slotId: s.id, label: s.label, start: s.start, status: 'pending', attempts: 0, tabId: null, round }));
    run.jobs = (round === 1 ? [] : run.jobs || []).concat(fresh);
    run.phase = 'running';
    const n = Math.max(1, Math.min(run.cfg.parallelSlots || 1, fresh.length));
    const useWindows = run.cfg.windows !== false;
    addLog(run, 'info', `${round > 1 ? `[Vòng ${round}] ` : ''}Mẫu ${run.templateId}. Mở ${n} ${useWindows ? 'cửa sổ' : 'tab'} song song cho ${fresh.length} khung giờ.`);
    await saveRun(run);
    const controller = await chrome.tabs.get(run.controllerTabId).catch(() => null);
    const boxes = useWindows ? tile(n, m.screen) : [];
    for (let i = 0; i < n; i++) {
      // mở trống trước, giao slot, rồi mới tải trang (các worker bắt đầu lệch nhau staggerMs)
      let tabId;
      if (useWindows) {
        const w = await chrome.windows.create({ url: 'about:blank', focused: true, type: 'normal', ...boxes[i] })
          .catch(() => chrome.windows.create({ url: 'about:blank', focused: true }));
        tabId = w.tabs[0].id;
      } else {
        const tab = await chrome.tabs.create({ url: 'about:blank', active: false, index: controller ? controller.index + 1 + i : undefined });
        tabId = tab.id;
      }
      const a = assignNext(run, tabId);
      if (a) addLog(run, 'info', `[${a.job.label.slice(0, 5)}] → ${useWindows ? 'cửa sổ' : 'tab'} ${i + 1}`);
      await saveRun(run);
      await new Promise((r) => setTimeout(r, run.cfg.staggerMs || 300));
      await chrome.tabs.update(tabId, { url: createUrl(run.templateId) }).catch(() => {});
    }
    await saveRun(run);
    badge(run);
    return { ok: true };
  },

  jobStart: async (m, sender) => {
    const run = await getRun();
    const job = run && run.jobs.find((j) => j.slotId === m.slotId && j.tabId === sender.tab.id);
    if (!job) return { ok: false };
    job.status = 'working';
    job.attempts++;
    job.startedAt = Date.now();
    await saveRun(run);
    return { ok: true, attempts: job.attempts };
  },

  /** worker → kết quả 1 slot; trả về slot tiếp theo cho tab này (hoặc đóng tab) */
  jobResult: async (m, sender) => {
    const run = await getRun();
    const tabId = sender.tab.id;
    const job = run && run.jobs.find((j) => j.slotId === m.slotId && j.tabId === tabId);
    if (!job) return { next: null };
    const tag = `[${job.label.slice(0, 5)}]`;
    job.finishedAt = Date.now();
    job.result = m.result || null;
    if (m.ok) {
      job.status = 'done';
      addLog(run, 'info', m.dry ? `${tag} DRY-RUN OK (đã Hủy, không tạo)` : `${tag} ✔ ${m.result.slot} — bật ${m.result.open}/${m.result.total}`);
      for (const w of m.warnings || []) addLog(run, 'warn', `${tag} ${w}`);
    } else if (m.skipped) {
      job.status = 'skipped';
      addLog(run, 'warn', `${tag} ${m.message || 'bỏ qua'}`);
    } else {
      job.error = m.message;
      addLog(run, 'error', `${tag} Lỗi ${m.code || ''}: ${m.message}`);
      const maxAttempts = run.cfg.maxAttemptsPerSlot || 3;
      if (!run.stopRequested && m.stillFree !== false && job.attempts < maxAttempts && !m.fatal) {
        job.status = 'pending';
        job.retryAt = Date.now() + (run.cfg.retryBackoffMs || 2000) * job.attempts;
        job.tabId = null;
        addLog(run, 'warn', `${tag} slot vẫn trống → sẽ thử lại (lần ${job.attempts + 1})`);
      } else {
        job.status = 'failed';
        job.flashSaleCreated = m.stillFree === false;
        run.errors.push({ slot: job.label, code: m.code, message: m.message, flashSaleCreated: job.flashSaleCreated });
        if (m.fatal) { run.stopRequested = true; run.fatal = m.code; }
      }
    }
    const next = assignNext(run, tabId);
    maybeFinalize(run);
    await saveRun(run);
    badge(run);
    if (!next) await closeWorker(run, tabId);
    return { next: next ? next.job : null, waitMs: next ? next.waitMs : 0, ctx: ctxFor(run) };
  },

  /** controller → ghi kết quả cuối */
  finish: async (m) => {
    const run = await getRun();
    if (!run) return {};
    Object.assign(run, m.patch || {});
    run.phase = 'done';
    run.finishedAt = Date.now();
    addLog(run, m.level || 'info', m.msg);
    await saveRun(run);
    badge(run);
    for (const j of run.jobs || []) if (j.tabId && !TERMINAL.has(j.status)) await closeWorker(run, j.tabId);
    return {};
  },

  /** popup → dừng: không giao slot mới, đánh dấu các slot chưa làm là bỏ qua */
  stop: async () => {
    const run = await getRun();
    if (!run || !ACTIVE.has(run.phase)) return {};
    run.stopRequested = true;
    for (const j of run.jobs || []) if (j.status === 'pending') j.status = 'skipped';
    addLog(run, 'warn', 'Đã yêu cầu dừng.');
    if (run.phase === 'start') { run.phase = 'done'; run.status = 'STOPPED'; }
    maybeFinalize(run);
    await saveRun(run);
    badge(run);
    return {};
  },

  /** controller định kỳ: slot treo quá lâu → coi như lỗi */
  watchdog: async () => {
    const run = await getRun();
    if (!run || run.phase !== 'running') return {};
    let changed = false;
    for (const j of run.jobs) {
      if (j.status === 'working' && Date.now() - j.startedAt > WORK_TIMEOUT_MS) {
        j.status = 'failed'; j.error = 'quá thời gian'; changed = true;
        run.errors.push({ slot: j.label, message: 'quá thời gian' });
        addLog(run, 'error', `[${j.label.slice(0, 5)}] treo quá ${WORK_TIMEOUT_MS / 60000} phút → bỏ`);
        await closeWorker(run, j.tabId);
      }
    }
    if (changed) { maybeFinalize(run); await saveRun(run); badge(run); }
    return {};
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = msg && handlers[msg.type];
  if (!h) return false;
  withLock(() => h(msg, sender)).then(sendResponse, (e) => sendResponse({ error: String(e && e.message) }));
  return true; // trả lời bất đồng bộ
});

// Người dùng tự đóng 1 tab worker giữa chừng
chrome.tabs.onRemoved.addListener((tabId) => withLock(async () => {
  const run = await getRun();
  if (!run || run.phase !== 'running') return;
  const job = run.jobs.find((j) => j.tabId === tabId && (j.status === 'assigned' || j.status === 'working'));
  if (!job) return;
  job.status = 'failed';
  job.error = 'tab bị đóng';
  run.errors.push({ slot: job.label, message: 'tab bị đóng giữa chừng' });
  addLog(run, 'warn', `[${job.label.slice(0, 5)}] tab bị đóng giữa chừng`);
  maybeFinalize(run);
  await saveRun(run);
  badge(run);
}));
