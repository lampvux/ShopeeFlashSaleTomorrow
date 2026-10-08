/*!
 * Shopee Flash Sale Tomorrow — shared DOM engine
 * Dùng chung cho: Playwright runner (runner/) và Chrome extension (extension/).
 * Chạy trong trang banhang.shopee.vn. Không lưu/gửi cookie đi đâu cả.
 *
 * Tất cả selector nằm trong SEL — nếu Shopee đổi giao diện, chỉ cần sửa ở đây.
 */
(function (root) {
  'use strict';
  if (root.__FSA && root.__FSA.version) return;

  const VERSION = '1.1.1';
  const VN_OFFSET_SEC = 7 * 3600; // Asia/Ho_Chi_Minh, không có DST

  // ---------------------------------------------------------------- selectors
  const SEL = {
    create: {
      productRow: '.inner-row[data-model-id]',
      timeSlotBtn: 'button.time-slot-btn',
      headerCheckbox: '.table-header.product-table label.eds-checkbox',
      rowCheckbox: 'label.eds-checkbox.item-selector',
      selectedSubtitle: '.batch-setting-subtitle',
      batchPanel: '.batch-setting-panel',
      batchStockInput: '.batch-setting-panel .panel-input .campaign-stock input.eds-input__input',
      rowStockInput: '.campaign-stock input.eds-input__input',
      rowCurrentStock: '.current-stock',
      rowVariation: '.variation',
      rowSwitch: '.eds-switch',
      rowStockError: '.campaign-stock .rule-error, .campaign-stock .eds-input__inner.error',
      rowAnyError: '.rule-error, .eds-input__inner.error, .eds-form-item__error',
      footerConfirm: '.footer .confirm-btn button',
    },
    modal: {
      root: '.eds-modal',
      box: '.eds-modal__box',
      header: '.eds-modal__header',
      footer: '.eds-modal__footer',
      dateCell: '.eds-date-table__cell',
      dateText: 'p.date-text',
      headerLabel: '.eds-picker-header__label',
      nextIcon: '.eds-picker-header__next', // [0] = tháng sau, [1] = năm sau
      radioLabel: 'label.eds-radio',
      radioInput: 'input.eds-radio__input',
    },
    toast: '.eds-toast, .eds-message, .eds-notification',
    text: {
      slotModalTitle: /khung giờ/i,
      batchUpdate: /^Cập nhật/, // "Cập nhật hàng loạt" hoặc "Cập nhật được chọn"
      enable: /^Bật$/,
      confirm: /^Xác nhận$/,
      cancel: /^Hủy$/,
      backToList: /Quay lại trang Danh sách/,
    },
  };

  // ---------------------------------------------------------------- utils
  class FsaError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');

  async function waitFor(fn, { timeout = 15000, interval = 200, label = 'điều kiện' } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { const v = fn(); if (v) return v; } catch (_) { /* retry */ }
      await sleep(interval);
    }
    throw new FsaError('TIMEOUT', `Hết thời gian chờ: ${label} (${timeout}ms)`);
  }

  const isVisible = (el) => !!el && el.getClientRects().length > 0;
  const isDisabled = (btn) => !btn || btn.disabled || btn.classList.contains('eds-button--disabled');
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  function findBtn(scope, re) {
    return [...(scope || document).querySelectorAll('button')].find((b) => re.test(txt(b)) && isVisible(b));
  }

  /** Gán giá trị cho input do Vue quản lý (v-model nghe sự kiện input/change). */
  function setVal(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function isChecked(label) {
    if (!label) return false;
    const inp = label.querySelector('input');
    return (inp && inp.checked) || /checked/.test(label.className);
  }

  function visibleToasts() {
    return [...document.querySelectorAll(SEL.toast)].filter(isVisible).map((e) => txt(e).slice(0, 200)).filter(Boolean);
  }

  function modalBoxVisible(modal) {
    const box = modal && modal.querySelector(SEL.modal.box);
    return !!box && box.style.display !== 'none' && isVisible(box);
  }
  function visibleModals() {
    return [...document.querySelectorAll(SEL.modal.root)].filter(modalBoxVisible);
  }
  function findSlotModal() {
    return [...document.querySelectorAll(SEL.modal.root)].find((m) =>
      SEL.text.slotModalTitle.test(txt(m.querySelector(SEL.modal.header))));
  }

  // ---------------------------------------------------------------- date / api
  /** Ngày mai theo giờ Việt Nam, kèm khoảng timestamp [00:00, 23:59:59]. */
  function vnTomorrow(nowMs = Date.now()) {
    const vn = new Date(nowMs + VN_OFFSET_SEC * 1000);
    const startTs = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + 1) / 1000 - VN_OFFSET_SEC;
    const t = new Date((startTs + VN_OFFSET_SEC) * 1000);
    const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, d = t.getUTCDate();
    return { y, m, d, startTs, endTs: startTs + 86400 - 1, label: `${pad(d)}/${pad(m)}/${y}`, iso: `${y}-${pad(m)}-${pad(d)}` };
  }
  /** Ngày cụ thể 'YYYY-MM-DD' theo giờ Việt Nam (dùng khi muốn chạy bù cho 1 ngày khác). */
  function vnDate(ymd) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ymd || '').trim());
    if (!m) throw new FsaError('BAD_DATE', `Ngày không hợp lệ: ${ymd} (cần YYYY-MM-DD)`);
    const y = +m[1], mo = +m[2], d = +m[3];
    const startTs = Date.UTC(y, mo - 1, d) / 1000 - VN_OFFSET_SEC;
    return { y, m: mo, d, startTs, endTs: startTs + 86400 - 1, label: `${pad(d)}/${pad(mo)}/${y}`, iso: `${y}-${pad(mo)}-${pad(d)}` };
  }
  function fmtVn(ts) {
    const t = new Date((ts + VN_OFFSET_SEC) * 1000);
    return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} ${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}`;
  }

  function spcCds() {
    const m = document.cookie.match(/(?:^|;\s*)SPC_CDS=([^;]+)/);
    return m ? m[1] : '';
  }
  /** GET chỉ-đọc tới API nội bộ mà chính trang Seller Center đang gọi. */
  async function apiGet(path, params = {}) {
    const qs = new URLSearchParams({ SPC_CDS: spcCds(), SPC_CDS_VER: '2', ...params });
    const res = await fetch(`/api/marketing/v4/shop_flash_sale/${path}/?${qs}`, { credentials: 'include' });
    if (!res.ok) throw new FsaError('API_HTTP', `${path}: HTTP ${res.status}`);
    const j = await res.json();
    if (j.code !== 0) throw new FsaError('API', `${path}: ${j.message || j.code}`);
    return j.data;
  }

  /**
   * flash_sale_id của dòng trên cùng trang danh sách (giống bấm "Sao chép" dòng đầu),
   * bỏ qua flash sale rỗng (0 sản phẩm bật) để không sao chép nhầm bản lỗi.
   */
  async function getTemplateId() {
    const data = await apiGet('get_shop_flash_sale_list', { offset: 0, limit: 10, type: 0 });
    const list = (data && data.flash_sale_list) || [];
    const fs = list.find((f) => f.enabled_item_count > 0 && f.status === 1) || list[0];
    return fs ? String(fs.flash_sale_id) : null;
  }

  /** Các khung giờ CÒN TRỐNG (chưa tạo) của ngày t. API chỉ trả slot chưa dùng. */
  async function getFreeSlots(t = vnTomorrow()) {
    const data = await apiGet('get_time_slot_id', { start_time: t.startTs, end_time: t.endTs });
    return (data || [])
      .filter((s) => s.start_time >= t.startTs && s.start_time <= t.endTs)
      .map((s) => ({ id: String(s.timeslot_id), start: s.start_time, end: s.end_time, label: `${fmtVn(s.start_time)} → ${fmtVn(s.end_time)}` }));
  }

  /** Shop đang đăng nhập (để chắc chắn profile đúng shop). */
  async function getShopInfo() {
    const qs = new URLSearchParams({ SPC_CDS: spcCds(), SPC_CDS_VER: '2' });
    const res = await fetch(`/api/selleraccount/shop_info/?${qs}`, { credentials: 'include' });
    const j = await res.json();
    if (j.code !== 0 || !j.data) throw new FsaError('NOT_LOGGED_IN', `shop_info: ${j.message || j.code}`);
    return { shopId: String(j.data.shop_id), name: j.data.name };
  }

  /** Flash sale đã tạo cho ngày t (để báo cáo / dọn flash sale rỗng). */
  async function getCreatedForDay(t = vnTomorrow()) {
    const data = await apiGet('get_shop_flash_sale_list', { offset: 0, limit: 100, type: 1 });
    return ((data && data.flash_sale_list) || [])
      .filter((f) => f.start_time >= t.startTs && f.start_time <= t.endTs && f.status !== 0)
      .map((f) => ({ id: String(f.flash_sale_id), timeslotId: String(f.timeslot_id), start: f.start_time, label: fmtVn(f.start_time), enabledItems: f.enabled_item_count, items: f.item_count, status: f.status }))
      .sort((a, b) => a.start - b.start);
  }

  /**
   * Toàn bộ phân loại đã lưu trong 1 flash sale — NGUỒN SỰ THẬT (API của Shopee), không phụ thuộc giao diện.
   * get_shop_flash_sale_item phân trang theo SẢN PHẨM (total_count = số sản phẩm), mỗi trang trả mọi phân loại của các sản phẩm đó.
   */
  async function getFlashSaleModels(flashSaleId) {
    const byId = new Map();
    const names = {};
    let total = 1;
    for (let offset = 0, guard = 0; offset < total && guard < 40; offset += 50, guard++) {
      const d = await apiGet('get_shop_flash_sale_item', { flash_sale_id: flashSaleId, offset, limit: 50 });
      total = (d && d.total_count) || 0;
      let info = d && d.model_info_str;
      if (typeof info === 'string') { try { info = JSON.parse(info); } catch (_) { info = null; } }
      for (const list of Object.values(info || {})) for (const m of list || []) names[String(m.modelid)] = m.name;
      const items = (d && d.items) || [];
      for (const m of items) {
        byId.set(String(m.model_id), {
          modelId: String(m.model_id), itemId: String(m.item_id), status: m.status, stock: m.stock,
          reason: m.reject_reason || '', unqualified: m.unqualified_conditions || [],
        });
      }
      if (!items.length) break;
    }
    return [...byId.values()].map((m) => ({ ...m, name: names[m.modelId] || '' }));
  }

  /** Kiểm tra 1 flash sale: bao nhiêu phân loại đang BẬT (status 1) và các phân loại còn tắt kèm lý do Shopee ghi. */
  async function verifyFlashSale(flashSaleId) {
    const models = await getFlashSaleModels(flashSaleId);
    const off = models.filter((m) => m.status !== 1);
    return {
      id: String(flashSaleId), total: models.length, enabled: models.length - off.length,
      off: off.map((m) => ({ modelId: m.modelId, name: m.name, status: m.status, reason: m.reason, unqualified: m.unqualified })),
    };
  }

  /** Flash sale của khung giờ timeslotId trong ngày t (null nếu chưa có). */
  async function findBySlot(t, timeslotId) {
    return (await getCreatedForDay(t)).find((c) => c.timeslotId === String(timeslotId)) || null;
  }

  /** Báo cáo cả ngày: mỗi flash sale bật bao nhiêu phân loại. Dùng ở bước tổng kết. */
  async function verifyDay(t = vnTomorrow()) {
    const out = [];
    for (const c of await getCreatedForDay(t)) {
      try { out.push({ ...c, ...(await verifyFlashSale(c.id)) }); }
      catch (e) { out.push({ ...c, error: e.message }); }
    }
    return out;
  }

  /**
   * Xoá MỘT flash sale RỖNG (0 sản phẩm) sắp diễn ra — gửi đúng request mà nút "Thêm → Xóa"
   * của Seller Center gửi: POST set_shop_flash_sale {flash_sale_id, time_slot_id, status: 0 (DELETED)}.
   * Kiểm tra lại ngay trước khi xoá; flash sale có sản phẩm hoặc đã/đang diễn ra thì TỪ CHỐI.
   */
  async function deleteEmptyFlashSale(flashSaleId, hint = {}) {
    const got = await apiGet('get_shop_flash_sale', { flash_sale_id: flashSaleId });
    if (!got) throw new FsaError('NOT_FOUND', `Không thấy flash sale ${flashSaleId}`);
    const fs = {
      status: got.status,
      start_time: got.start_time ?? hint.start,
      timeslot_id: got.timeslot_id ?? hint.timeslotId,
      item_count: got.item_count ?? hint.items,
      enabled_item_count: got.enabled_item_count ?? hint.enabledItems,
    };
    const nowSec = Date.now() / 1000;
    if (fs.status === 0) return { id: String(flashSaleId), already: true };
    if (fs.item_count === undefined || fs.timeslot_id === undefined || fs.start_time === undefined) {
      throw new FsaError('UNKNOWN_STATE', `Không đọc đủ thông tin flash sale ${flashSaleId} — không xoá`);
    }
    if (fs.item_count > 0 || (fs.enabled_item_count || 0) > 0) {
      throw new FsaError('NOT_EMPTY', `Flash sale ${flashSaleId} có ${fs.item_count} sản phẩm — không xoá`);
    }
    if (!(fs.start_time > nowSec)) throw new FsaError('NOT_UPCOMING', `Flash sale ${flashSaleId} đã/đang diễn ra — không xoá`);
    const qs = new URLSearchParams({ SPC_CDS: spcCds(), SPC_CDS_VER: '2' });
    const res = await fetch(`/api/marketing/v4/shop_flash_sale/set_shop_flash_sale/?${qs}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flash_sale_id: Number(flashSaleId), time_slot_id: Number(fs.timeslot_id), status: 0 }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.code !== 0) throw new FsaError('DELETE_FAILED', `Xoá flash sale ${flashSaleId} thất bại: ${j.message || res.status}`);
    return { id: String(flashSaleId), label: fmtVn(fs.start_time), timeslotId: String(fs.timeslot_id) };
  }

  /**
   * Dọn các flash sale RỖNG của ngày t (sót lại từ lần chạy lỗi) để khung giờ trống trở lại
   * và được tạo lại đúng. Chỉ đụng tới flash sale 0 sản phẩm, sắp diễn ra, đúng ngày t.
   */
  async function repairEmpty(t = vnTomorrow(), { dryRun = false } = {}) {
    const empties = (await getCreatedForDay(t)).filter((c) => !c.items && !c.enabledItems && c.start > Date.now() / 1000);
    const deleted = [], failed = [];
    for (const e of empties) {
      if (dryRun) { deleted.push({ id: e.id, label: e.label, dryRun: true }); continue; }
      try { deleted.push(await deleteEmptyFlashSale(e.id, e)); }
      catch (err) { failed.push({ id: e.id, label: e.label, message: err.message }); }
      await sleep(400);
    }
    return { found: empties.length, deleted, failed };
  }

  function pageKind() {
    if (/accounts\.shopee\./.test(location.host) || /\/account\/signin|\/login/.test(location.pathname)) return 'login';
    if (/\/shop-flash-sale\/create/.test(location.pathname)) return 'create';
    if (/\/shop-flash-sale\/list/.test(location.pathname)) return 'list';
    return 'other';
  }

  // ---------------------------------------------------------------- create page
  const rows = () => [...document.querySelectorAll(SEL.create.productRow)];
  const rowInput = (r) => r.querySelector(SEL.create.rowStockInput);
  const rowStock = (r) => parseInt(txt(r.querySelector(SEL.create.rowCurrentStock)).replace(/\D/g, ''), 10);
  const rowOpen = (r) => /--open/.test((r.querySelector(SEL.create.rowSwitch) || {}).className || '');
  const rowInfo = (r) => ({ modelId: r.getAttribute('data-model-id'), name: txt(r.querySelector(SEL.create.rowVariation)).slice(0, 60) });
  const rowChecked = (r) => isChecked(r.querySelector(SEL.create.rowCheckbox));
  /** Shopee khoá ô tích của phân loại không tham gia được (vd. tồn kho 0). */
  const rowSelectable = (r) => {
    const l = r.querySelector(SEL.create.rowCheckbox);
    const i = l && l.querySelector('input');
    return !!l && !(i && i.disabled) && !/disabled/.test(l.className);
  };
  const checkedRows = () => rows().filter(rowChecked);
  const switchLocked = (r) => /--disabled/.test((r.querySelector(SEL.create.rowSwitch) || {}).className || '');
  /** Gợi ý vì sao 1 dòng không bật được: chữ trong các phần tử báo lỗi/cảnh báo/tooltip của dòng đó. */
  const rowHint = (r) => {
    const bits = new Set();
    r.querySelectorAll('[class*="error"],[class*="warn"],[class*="invalid"],[class*="unqualif"],[class*="tooltip"],[class*="tips"],[title]').forEach((e) => {
      const t = (e.getAttribute('title') || txt(e)).slice(0, 80);
      if (t) bits.add(t);
    });
    return [...bits].slice(0, 3).join(' | ');
  };
  /** Sau khi chọn khung giờ, công tắc của các dòng tham gia được sẽ mở khoá (dòng bị khoá thì không bao giờ). */
  const switchesUnlocked = () => rows().some((r) => {
    const sw = r.querySelector(SEL.create.rowSwitch);
    return sw && !/--disabled/.test(sw.className);
  });

  async function waitCreateReady(timeout = 30000) {
    const r = await waitFor(() => {
      if (pageKind() === 'list') return 'REDIRECTED';
      return rows().length > 0 && document.querySelector(SEL.create.timeSlotBtn) ? 'READY' : null;
    }, { timeout, label: 'trang tạo Flash Sale tải xong' });
    if (r === 'REDIRECTED') throw new FsaError('TEMPLATE_INVALID', 'Trang tạo bị chuyển về danh sách (mẫu sao chép không còn).');
    await sleep(500);
    return rows().length;
  }

  async function openSlotModal() {
    const btn = await waitFor(() => document.querySelector(SEL.create.timeSlotBtn), { label: 'nút Lựa chọn khung giờ' });
    btn.click();
    return waitFor(() => { const m = findSlotModal(); return modalBoxVisible(m) ? m : null; }, { timeout: 10000, label: 'popup chọn khung giờ' });
  }

  function closeModal(modal) {
    const c = findBtn(modal.querySelector(SEL.modal.footer), SEL.text.cancel);
    if (c) c.click();
  }

  const radioValues = (modal) => [...modal.querySelectorAll(SEL.modal.radioInput)].map((i) => i.value);

  async function selectDate(modal, t) {
    for (let i = 0; i < 3; i++) {
      const labels = [...modal.querySelectorAll(SEL.modal.headerLabel)].map(txt);
      const mm = parseInt((labels[0] || '').replace(/\D/g, ''), 10);
      const yy = parseInt((labels[1] || '').replace(/\D/g, ''), 10);
      if (mm === t.m && yy === t.y) break;
      const next = modal.querySelectorAll(SEL.modal.nextIcon)[0];
      if (!next) break;
      next.click();
      await sleep(600);
    }
    // Luôn tìm lại ô ngày (lịch có thể được vẽ lại sau mỗi click)
    const findCell = () => [...modal.querySelectorAll(SEL.modal.dateCell)].find((c) =>
      !/out-of-month|is-empty/.test(c.className) && txt(c.querySelector(SEL.modal.dateText)) === String(t.d));
    const cell = findCell();
    if (!cell) throw new FsaError('DATE_NOT_FOUND', `Không thấy ngày ${t.label} trong lịch`);
    const before = radioValues(modal).join(',');
    (cell.querySelector(SEL.modal.dateText) || cell).click();
    await waitFor(() => /selected/.test((findCell() || {}).className || ''), { timeout: 5000, label: `chọn ngày ${t.label}` });
    await waitFor(() => radioValues(modal).join(',') !== before || (findCell() || document).querySelector('.no-timeslot'), { timeout: 4000 }).catch(() => {});
    await sleep(400);
    return findCell() || cell;
  }

  /**
   * Chọn khung giờ ngày t.
   * ⚠️ Bấm "Xác nhận" của popup = Shopee TẠO flash sale ngay (POST set_shop_flash_sale).
   *    Vì vậy dryRun chỉ chọn radio rồi bấm Hủy.
   */
  async function pickSlot(t, allowedIds, { dryRun = false } = {}) {
    const modal = await openSlotModal();
    await sleep(400);
    const cell = await selectDate(modal, t);
    let cands = [...modal.querySelectorAll(SEL.modal.radioLabel)].filter((l) => {
      const i = l.querySelector('input');
      return i && !i.disabled && isVisible(l);
    });
    if (allowedIds) cands = cands.filter((l) => allowedIds.includes(l.querySelector('input').value));
    if (!cands.length) {
      closeModal(modal);
      await sleep(400);
      return { status: 'none', dayHasNoSlot: !!cell.querySelector('.no-timeslot') };
    }
    const label = cands[0];
    const id = label.querySelector('input').value;
    const text = txt(label);
    label.click();
    await sleep(300);
    if (dryRun) {
      closeModal(modal);
      await sleep(400);
      return { status: 'dry-run', timeslotId: id, label: text };
    }
    const ok = findBtn(modal.querySelector(SEL.modal.footer), SEL.text.confirm);
    await waitFor(() => !isDisabled(ok), { timeout: 5000, label: 'nút Xác nhận của popup khung giờ' });
    const toastsBefore = new Set(visibleToasts());
    ok.click();
    // Thành công = công tắc Bật/Tắt được mở khoá (Vue cập nhật ngay cả khi tab ở nền),
    // HOẶC popup đóng. Không chỉ dựa vào popup đóng: ở tab nền Chrome dừng hiệu ứng đóng popup
    // nên popup có thể "kẹt" dù flash sale đã tạo xong (lỗi TIMEOUT 07/10).
    // Bị từ chối (vd. thao tác quá nhanh) → popup vẫn mở + có thông báo.
    const outcome = await waitFor(() => {
      if (switchesUnlocked()) return 'unlocked';
      if (!modalBoxVisible(modal)) return 'closed';
      const fresh = visibleToasts().find((s) => !toastsBefore.has(s));
      return fresh ? `toast:${fresh}` : null;
    }, { timeout: 25000, label: 'xác nhận khung giờ (công tắc mở khoá hoặc popup đóng)' });
    if (outcome.startsWith('toast:')) {
      closeModal(modal);
      throw new FsaError('CREATE_REJECTED', `Shopee từ chối tạo slot ${text}: ${outcome.slice(6)}`);
    }
    await waitFor(switchesUnlocked, { timeout: 15000, label: 'công tắc Bật/Tắt được mở khoá' });
    const btn = document.querySelector(SEL.create.timeSlotBtn);
    const info = txt(btn && btn.closest('.info-item')).replace(/^Khung thời gian\s*/, '').replace(txt(btn), '').trim();
    return { status: 'picked', timeslotId: id, label: text, formLabel: info };
  }

  /**
   * Bước 5: tích ô "Phân loại hàng" (chọn tất cả) — GIỐNG LÀM TAY: Shopee chỉ chọn các dòng tham gia được,
   * dòng bị khoá (tồn kho 0…) bỏ qua. Không bao giờ bấm lại ô tổng khi đã có dòng được chọn
   * (bấm lại = BỎ CHỌN tất cả — lỗi SELECT_ALL 98/120 ngày 07/10).
   */
  async function selectRows() {
    const total = rows().length;
    for (let i = 0; i < 2 && checkedRows().length === 0; i++) {
      document.querySelector(SEL.create.headerCheckbox).click();
      await waitFor(() => checkedRows().length > 0, { timeout: 4000 }).catch(() => {});
    }
    const selected = checkedRows();
    if (!selected.length) throw new FsaError('NO_SELECTABLE', `Không chọn được phân loại nào (0/${total})`);
    const locked = rows().filter((r) => !rowChecked(r)).map(rowInfo);
    return { total, selected: selected.length, locked };
  }

  /**
   * Bước 3–4: SL = qty → Cập nhật hàng loạt (chỉ áp cho các dòng đã chọn).
   * Dòng có tồn kho < qty: mode 'one' (mặc định) → đặt fallbackQty (1) luôn, đúng quy trình làm tay;
   * mode 'min' → đặt bằng tồn kho. Dòng còn báo lỗi sẽ được hạ về 1 ở bước Bật.
   */
  async function applyQuantities(cfg) {
    const qty = cfg.qty;
    const sel = await selectRows();
    const bInp = await waitFor(() => document.querySelector(SEL.create.batchStockInput), { label: 'ô SL hàng loạt' });
    setVal(bInp, qty);
    await sleep(300);
    const upd = findBtn(document.querySelector(SEL.create.batchPanel), SEL.text.batchUpdate);
    if (!upd) throw new FsaError('NO_BATCH_BTN', 'Không thấy nút Cập nhật hàng loạt');
    await waitFor(() => !isDisabled(upd), { timeout: 5000, label: 'nút Cập nhật hàng loạt' });
    upd.click();
    await waitFor(() => checkedRows().every((r) => { const i = rowInput(r); return !i || i.disabled || i.value === String(qty); }),
      { timeout: 8000, label: `áp SL ${qty} cho các dòng đã chọn` });
    const adjusted = [];
    if (cfg.mode === 'one' || cfg.mode === 'min') {
      for (const r of checkedRows()) {
        const stock = rowStock(r);
        const inp = rowInput(r);
        if (inp && !inp.disabled && Number.isFinite(stock) && stock < qty) {
          const v = cfg.mode === 'min' ? Math.max(1, stock) : cfg.fallbackQty;
          setVal(inp, v);
          adjusted.push({ ...rowInfo(r), stock, qty: v });
        }
      }
      if (adjusted.length) await sleep(400);
    }
    return { total: sel.total, selected: sel.selected, locked: sel.locked, qty, adjusted };
  }

  function enableStats() {
    const all = rows();
    const selected = all.filter((r) => isChecked(r.querySelector(SEL.create.rowCheckbox)));
    const closedSelected = selected.filter((r) => !rowOpen(r));
    return { total: all.length, open: all.filter(rowOpen).length, selected: selected.length, closedSelected };
  }

  /**
   * Bước 6 + 6.1: Bật; dòng báo lỗi SL → đặt fallbackQty → Bật lại, tới khi bật được.
   * Dòng Shopee KHÔNG bật mà cũng KHÔNG báo lỗi (công tắc bị khoá, phân loại không đủ điều kiện…) trong khi
   * các dòng khác đã bật → Shopee từ chối dòng đó: bỏ chọn + ghi vào `refused` (cảnh báo, không phải lỗi).
   * Trước đây các dòng này làm cả khung giờ bị báo "enable-failed" dù flash sale đã bật đủ sản phẩm (log 08/10 tối).
   */
  async function enableAll(cfg) {
    const panel = document.querySelector(SEL.create.batchPanel);
    const fixed = [];
    const skipped = [];
    const refused = [];
    let attempts = 0;
    let silent = 0;
    for (attempts = 1; attempts <= cfg.maxRetry + 1; attempts++) {
      const bat = findBtn(panel, SEL.text.enable);
      if (!bat) throw new FsaError('NO_ENABLE_BTN', 'Không thấy nút Bật');
      if (isDisabled(bat)) { await selectRows(); }
      const openBefore = enableStats().open;
      let lastOpen = -1;
      let lastChange = Date.now();
      bat.click();
      // Chờ: bật hết, hoặc có dòng báo lỗi, hoặc số dòng đã bật tăng rồi đứng yên 1,5s
      await waitFor(() => {
        const s = enableStats();
        if (s.closedSelected.length === 0) return true;
        if (s.closedSelected.some((r) => r.querySelector(SEL.create.rowAnyError))) return true;
        if (s.open !== lastOpen) { lastOpen = s.open; lastChange = Date.now(); }
        return s.open > openBefore && Date.now() - lastChange > 1500;
      }, { timeout: 6000 }).catch(() => {});
      await sleep(500);

      const s = enableStats();
      if (s.closedSelected.length === 0) break;

      const errRows = s.closedSelected.filter((r) => r.querySelector(SEL.create.rowAnyError));
      if (errRows.length) {
        silent = 0;
        for (const r of errRows) {
          const msg = txt(r.querySelector('.rule-error')) || 'lỗi không rõ';
          const inp = rowInput(r);
          const isStockErr = !!r.querySelector(SEL.create.rowStockError);
          if (isStockErr && inp && !inp.disabled && inp.value !== String(cfg.fallbackQty)) {
            fixed.push({ ...rowInfo(r), from: inp.value, to: cfg.fallbackQty, msg });
            setVal(inp, cfg.fallbackQty);
          } else if (cfg.skipUnfixable) {
            const cb = r.querySelector(SEL.create.rowCheckbox);
            if (cb && isChecked(cb)) cb.click(); // bỏ chọn để không chặn các dòng khác
            skipped.push({ ...rowInfo(r), msg });
          }
        }
        await sleep(400);
        continue;
      }

      // Không dòng nào báo lỗi mà vẫn còn dòng chưa bật
      silent++;
      if (s.open > 0 && silent >= 2) {
        // Shopee đã bật các dòng khác (đã lưu) nhưng 2 lần liền không bật các dòng này → Shopee từ chối
        for (const r of s.closedSelected) {
          refused.push({ ...rowInfo(r), stock: rowStock(r), qty: (rowInput(r) || {}).value, switchLocked: switchLocked(r), hint: rowHint(r) });
          const cb = r.querySelector(SEL.create.rowCheckbox);
          if (cb && isChecked(cb)) cb.click();
        }
        await sleep(300);
        break;
      }
      await sleep(1000); // chưa bật được dòng nào (lưu lỗi / mạng chậm) → bấm Bật lại
    }
    const s = enableStats();
    return {
      ok: s.closedSelected.length === 0 && s.open > 0,
      attempts, open: s.open, total: s.total, fixed, skipped, refused,
      stillClosed: s.closedSelected.map((r) => ({ ...rowInfo(r), hint: rowHint(r) })),
    };
  }

  /** Bước 7: cuộn xuống cuối, chờ, bấm Xác nhận. Trang sẽ tự chuyển về danh sách. */
  async function submit(cfg = {}) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(cfg.preSubmitDelayMs ?? 1500);
    const btn = await waitFor(() => {
      const b = document.querySelector(SEL.create.footerConfirm);
      return b && !isDisabled(b) ? b : null;
    }, { timeout: 10000, label: 'nút Xác nhận cuối trang' });
    btn.click();
    return { clicked: true, at: Date.now() };
  }

  /** Sau khi bấm Xác nhận: chờ về trang list, hoặc bấm "Quay lại trang Danh sách" nếu có popup thành công. */
  async function postSubmitCheck(timeout = 30000) {
    const t0 = Date.now();
    const toasts = new Set();
    while (Date.now() - t0 < timeout) {
      if (pageKind() === 'list') return { navigated: true, toasts: [...toasts] };
      document.querySelectorAll(SEL.toast).forEach((e) => { const s = txt(e); if (s) toasts.add(s.slice(0, 200)); });
      for (const m of visibleModals()) {
        const back = findBtn(m, SEL.text.backToList);
        if (back) { back.click(); await sleep(1000); continue; }
        if (!SEL.text.slotModalTitle.test(txt(m.querySelector(SEL.modal.header)))) {
          return { navigated: false, blockedByModal: txt(m).slice(0, 300), toasts: [...toasts] };
        }
      }
      await sleep(300);
    }
    return { navigated: pageKind() === 'list', timeout: true, toasts: [...toasts] };
  }

  /**
   * Toàn bộ 1 vòng trên trang create, DỪNG TRƯỚC nút Xác nhận cuối trang.
   * Không bao giờ throw — luôn trả về object báo cáo.
   */
  async function prepareSlot(cfg) {
    const report = { engine: VERSION, startedAt: new Date().toISOString() };
    try {
      const t = cfg.target || vnTomorrow();
      report.date = t.label;
      report.rows = await waitCreateReady();
      let allowed = null;
      try { allowed = (await getFreeSlots(t)).map((s) => s.id); }
      catch (e) { report.warn = `Không đọc được API khung giờ, dùng DOM: ${e.message}`; }
      if (cfg.slotIds && cfg.slotIds.length) {
        // Chạy song song: tab này CHỈ được lấy đúng slot đã giao, không tranh slot của tab khác
        const want = cfg.slotIds.map(String);
        allowed = allowed ? allowed.filter((id) => want.includes(id)) : want;
        report.assigned = want;
      }
      if (allowed && allowed.length === 0) return { ...report, ok: true, status: 'none' };
      // Kiểm tra TRƯỚC điểm không quay lại (Xác nhận popup = tạo flash sale):
      // không còn phân loại nào tham gia được thì dừng, tránh tạo flash sale rỗng.
      report.selectable = rows().filter((r) => rowSelectable(r) && rowStock(r) !== 0).length;
      if (report.selectable === 0) {
        throw new FsaError('NO_SELECTABLE', `Mẫu có ${report.rows} phân loại nhưng không phân loại nào tham gia được (tồn kho 0 / bị khoá) — chưa tạo gì`);
      }
      const pick = await pickSlot(t, allowed, { dryRun: !!cfg.dryRun });
      if (pick.status === 'none') return { ...report, ok: true, status: 'none' };
      report.slot = pick;
      if (pick.status === 'dry-run') return { ...report, ok: true, status: 'dry-run', freeSlots: allowed };
      report.flashSaleCreated = true; // từ đây flash sale đã tồn tại trên Shopee
      report.quantities = await applyQuantities(cfg);
      report.enable = await enableAll(cfg);
      // Xác minh bằng dữ liệu Shopee đã lưu (không chỉ nhìn công tắc trên giao diện)
      try {
        const fs = await findBySlot(t, pick.timeslotId);
        report.verify = fs ? await verifyFlashSale(fs.id) : { error: 'không thấy flash sale của khung giờ này' };
      } catch (e) { report.verify = { error: e.message }; }
      const v = report.verify;
      const savedOn = v && !v.error ? v.enabled : null;
      if (savedOn === 0 || (savedOn === null && !report.enable.ok)) {
        const en = report.enable;
        const why = en.stillClosed.slice(0, 5).map((r) => r.name + (r.hint ? ` (${r.hint})` : '')).join('; ');
        return { ...report, ok: false, status: 'enable-failed', message: `Không bật được phân loại nào (Shopee lưu ${savedOn ?? '?'} phân loại bật)${why ? ` — còn tắt: ${why}` : ''}` };
      }
      return { ...report, ok: true, status: 'ready' };
    } catch (e) {
      return { ...report, ok: false, status: 'error', code: e.code || 'ERR', message: e.message };
    }
  }

  root.__FSA = {
    version: VERSION,
    SEL,
    DEFAULTS: { qty: 15, mode: 'one', fallbackQty: 1, maxRetry: 4, skipUnfixable: true, preSubmitDelayMs: 1500, dryRun: false, parallelSlots: 8, repairEmpty: true },
    LIST_URL: '/portal/marketing/shop-flash-sale/list?type=0',
    createUrl: (id) => `/portal/marketing/shop-flash-sale/create?from=${encodeURIComponent(id)}`,
    vnTomorrow, vnDate, fmtVn, pageKind,
    getTemplateId, getFreeSlots, getCreatedForDay, getShopInfo,
    deleteEmptyFlashSale, repairEmpty, getFlashSaleModels, verifyFlashSale, verifyDay, findBySlot,
    prepareSlot, submit, postSubmitCheck,
    _: { waitFor, sleep, setVal, rows, enableStats, applyQuantities, enableAll, pickSlot, selectRows },
  };
})(typeof window !== 'undefined' ? window : globalThis);
