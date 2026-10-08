const F = window.__FSA;
const $ = (s) => document.querySelector(s);
const LIST = 'https://banhang.shopee.vn' + F.LIST_URL;
const pad = (n) => String(n).padStart(2, '0');
const fmt = (ms) => { const d = new Date(ms + 7 * 3600e3); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const STATUS_TEXT = {
  OK: 'Hoàn tất', DRY_RUN: 'Dry-run xong', PARTIAL: 'Chưa đủ khung giờ', INCOMPLETE: 'Có flash sale rỗng',
  OK_WITH_ERRORS: 'Xong (có lỗi đã xử lý)', ERROR: 'Lỗi', SESSION_EXPIRED: 'Chưa đăng nhập', STOPPED: 'Đã dừng',
};
const JOB_ICON = { pending: '⏳', assigned: '🔄', working: '🔄', done: '✅', failed: '⚠️', skipped: '⏭' };

const t = F.vnTomorrow();
$('#date').value = `${t.y}-${pad(t.m)}-${pad(t.d)}`;

// Nhớ lựa chọn lần trước (trừ ngày & dry-run)
const OPT_KEYS = { qty: 'value', par: 'value', mode: 'value', repair: 'checked', windows: 'checked' };
chrome.storage.local.get('opts').then(({ opts }) => {
  for (const [k, prop] of Object.entries(OPT_KEYS)) if (opts && opts[k] !== undefined) $('#' + k)[prop] = opts[k];
});
const saveOpts = () => chrome.storage.local.set({ opts: Object.fromEntries(Object.entries(OPT_KEYS).map(([k, prop]) => [k, $('#' + k)[prop]])) });

async function shopeeTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true, url: 'https://banhang.shopee.vn/*' });
  if (active) return active;
  const [any] = await chrome.tabs.query({ url: 'https://banhang.shopee.vn/*' });
  return any || null;
}

async function showShop() {
  const tab = await shopeeTab();
  if (!tab) { $('#shop').textContent = 'Không thấy tab banhang.shopee.vn — bấm Chạy để mở.'; return; }
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'shopInfo' });
    $('#shop').textContent = r && r.ok ? `Shop: ${r.name} (${r.shopId})` : 'Tab Shopee chưa đăng nhập.';
  } catch { $('#shop').textContent = 'Tab Shopee đang tải… (mở lại popup)'; }
}

async function start() {
  const qty = parseInt($('#qty').value, 10);
  const par = Math.min(8, Math.max(1, parseInt($('#par').value, 10) || 1));
  if (!(qty >= 1)) return alert('SL không hợp lệ');
  let target;
  try { target = F.vnDate($('#date').value); } catch (e) { return alert(e.message); }
  await saveOpts();
  let tab = await shopeeTab();
  if (!tab) tab = await chrome.tabs.create({ url: LIST, active: true });
  const run = {
    id: crypto.randomUUID(),
    controllerTabId: tab.id,
    phase: 'start',
    target,
    cfg: {
      ...F.DEFAULTS, qty, mode: $('#mode').value || 'one', dryRun: $('#dry').checked,
      repairEmpty: $('#repair').checked, windows: $('#windows').checked, maxRounds: 2,
      parallelSlots: par, staggerMs: 300, maxAttemptsPerSlot: 3, retryBackoffMs: 2000,
    },
    jobs: [], errors: [],
    log: [{ t: Date.now(), level: 'info', msg: `Bắt đầu cho ngày ${target.label}, ${par} tab song song` }],
    startedAt: Date.now(),
  };
  await chrome.runtime.sendMessage({ type: 'start', run });
  render(run);
}
window.__startForTest = start; // dùng trong test tự động

const stop = () => chrome.runtime.sendMessage({ type: 'stop' });

async function download() {
  const { run } = await chrome.storage.local.get('run');
  if (!run) return;
  const lines = run.log.map((l) => `[${fmt(l.t)}] ${l.level.toUpperCase().padEnd(5)} ${l.msg}`).join('\n');
  const blob = new Blob([lines + '\n\n' + JSON.stringify(run, null, 2)], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `flashsale-${(run.shopName || 'shop').replace(/\W+/g, '_')}-${run.target.label.replace(/\//g, '-')}.log`;
  a.click();
}

function render(run) {
  const st = $('#state');
  if (!run) { st.dataset.phase = 'idle'; st.textContent = 'Chưa chạy.'; return; }
  st.dataset.phase = run.phase;
  st.dataset.status = run.status || '';
  const running = run.phase !== 'done';
  const jobs = run.jobs || [];
  const done = jobs.filter((j) => j.status === 'done').length;
  const secs = Math.round(((run.finishedAt || Date.now()) - run.startedAt) / 1000);
  st.innerHTML = running
    ? `<b>Đang chạy${run.round > 1 ? ` (vòng ${run.round})` : ''}</b> — ngày ${run.target.label}: ${done}/${jobs.length || '?'} khung giờ xong (${secs}s)${run.errors.length ? `, lỗi ${run.errors.length}` : ''}`
    : `<b>${STATUS_TEXT[run.status] || run.status}</b> — ngày ${run.target.label}: tạo mới ${done}${run.remainingFree != null ? `, còn trống ${run.remainingFree}` : ''} (${secs}s)`;
  $('#start').disabled = running;
  $('#stop').disabled = !running;
  $('#jobs').innerHTML = jobs.map((j) => `<div class="j ${j.status}" title="${(j.error || '').replace(/"/g, '&quot;')}">${JOB_ICON[j.status] || ''} ${j.label.slice(0, 5)}${j.round > 1 ? ` <small>v${j.round}</small>` : ''}</div>`).join('');
  const box = $('#log');
  box.innerHTML = '';
  for (const l of run.log.slice(-200)) {
    const div = document.createElement('div');
    div.className = `l-${l.level}`;
    div.textContent = `[${fmt(l.t)}] ${l.msg}`;
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

$('#start').onclick = start;
$('#stop').onclick = stop;
$('#dl').onclick = download;
chrome.storage.onChanged.addListener((ch) => { if (ch.run) render(ch.run.newValue); });
chrome.storage.local.get('run').then(({ run }) => render(run));
showShop();
