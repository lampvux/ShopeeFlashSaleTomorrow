/**
 * Mock Shopee Seller Center (chỉ dùng để test offline).
 * Bắt chước đúng cấu trúc DOM + API nội bộ đã quan sát trên banhang.shopee.vn (10/2026):
 *  - chọn khung giờ + Xác nhận popup  → POST set_shop_flash_sale  (tạo flash sale ngay)
 *  - Bật                              → POST set_shop_flash_sale_items (1 dòng lỗi chặn tất cả)
 *  - Xác nhận cuối trang              → POST set_item_sequence → SPA về list
 *  - Thêm → Xóa                       → POST set_shop_flash_sale {flash_sale_id, time_slot_id, status: 0}
 * Tuỳ chọn mô phỏng lỗi thật: phân loại tồn kho 0 bị khoá ô tích (mặc định), stuckModal (popup khung giờ
 * không đóng — như tab nền của Chrome), itemsFail (N lần lưu sản phẩm đầu tiên bị lỗi).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = fs.readFileSync(path.join(HERE, 'app.js'), 'utf8');
const VN = 7 * 3600;
const HOURS = [[0, 2], [2, 9], [9, 12], [12, 15], [15, 17], [17, 19], [19, 21], [21, 24]];

export function vnDayStart(offsetDays = 0, now = Date.now()) {
  const d = new Date(now + VN * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offsetDays) / 1000 - VN;
}
export function dayStartOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 1000 - VN;
}

export function createState(opts = {}) {
  const nowSec = () => Math.floor(Date.now() / 1000);
  const slots = [];
  let sid = 9000000;
  for (let day = 0; day <= (opts.days ?? 40); day++) {
    const ds = vnDayStart(day);
    for (const [a, b] of HOURS) slots.push({ timeslot_id: ++sid, start_time: ds + a * 3600, end_time: ds + b * 3600 });
  }
  const products = opts.products || defaultProducts();
  const state = {
    loggedIn: opts.loggedIn ?? true,
    latencyMs: opts.latencyMs ?? 0,
    rateLimit: opts.rateLimit || null,
    stuckModal: !!opts.stuckModal,
    lockZeroStock: opts.lockZeroStock ?? true,
    itemsFail: opts.itemsFail || 0,
    shop: { shop_id: 1111, name: 'MOCK SHOP' },
    slots,
    products,
    flashSales: [],
    requests: [],
    nextFsId: 500000000000000,
    nowSec,
  };
  // Flash sale "hôm nay" làm mẫu: 1 slot hôm nay, đủ sản phẩm.
  const today = slots.find((s) => s.start_time >= vnDayStart(0) && s.start_time < vnDayStart(1));
  const fs0 = { flash_sale_id: ++state.nextFsId, timeslot_id: today.timeslot_id, start_time: today.start_time, end_time: today.end_time, status: 1, items: [] };
  for (const p of products) for (const m of p.models) fs0.items.push({ item_id: p.item_id, model_id: m.model_id, input_promo_price: m.promo, stock: 15, status: 1 });
  state.flashSales.push(fs0);
  for (const pre of opts.preCreated || []) { // slot đã tạo sẵn (ví dụ "00:00 ngày mai")
    const s = slots.find((x) => x.start_time === pre.start);
    state.flashSales.push({ flash_sale_id: ++state.nextFsId, timeslot_id: s.timeslot_id, start_time: s.start_time, end_time: s.end_time, status: 1, items: pre.empty ? [] : fs0.items.map((i) => ({ ...i })) });
  }
  return state;
}

function defaultProducts() {
  // 3 sản phẩm, 10 phân loại. Có các trường hợp: tồn 7 (<15), tồn 0, giới hạn ẩn 10 (tồn hiển thị 20).
  const P = [];
  let mid = 4100000;
  const mk = (item_id, name, rows) => P.push({ item_id, name, models: rows.map(([v, stock, max]) => ({ model_id: ++mid, variation: v, price: 260000, promo: 165000, stock, max: max ?? stock })) });
  mk(27744346471, '[MOCK] Quần Suông Nữ Q66', [['Đen,S', 470], ['Đen,M', 468], ['Đen,L', 7], ['Be,S', 454]]);
  mk(40026272577, '[MOCK] Quần nỉ Q86', [['Xám,S', 424], ['Xám,M', 20, 10], ['Xám,L', 0]]);
  mk(40026272999, '[MOCK] Quần Jean HOTTREND', [['Trắng,S', 583], ['Trắng,M', 585], ['Trắng,L', 584]]);
  return P;
}

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function shell(title, state) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;margin:0}.eds-modal__box{position:fixed;inset:40px;background:#fff;border:1px solid #999;overflow:auto}
.inner-row{display:flex;gap:8px;align-items:center;padding:2px}.eds-switch{width:30px;height:14px;background:#ccc;display:inline-block}.eds-switch--open{background:#2c2}
.eds-date-table__cell{display:inline-block;width:40px;cursor:pointer}.selected{background:#fdd}.rule-error{color:red;font-size:11px}.footer{padding:10px}</style>
<script>document.cookie='SPC_CDS=mock-cds; path=/';window.__MOCK_OPTS=${JSON.stringify({ stuckModal: state.stuckModal, lockZeroStock: state.lockZeroStock })};</script></head><body><div id="app"></div><script src="/__mock/app.js"></script></body></html>`;
}

export async function installMock(context, state) {
  await context.route('https://accounts.shopee.vn/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>Đăng nhập Shopee (mock)</h1></body></html>' }));
  await context.route('https://banhang.shopee.vn/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const q = Object.fromEntries(url.searchParams);
    if (p === '/__mock/app.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: APP_JS });

    if (p.startsWith('/portal/')) {
      if (!state.loggedIn) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><script>location.replace('https://accounts.shopee.vn/seller/login?next=' + encodeURIComponent(location.href))</script>` });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: shell('Shopee - Kênh Người bán (mock)', state) });
    }
    if (!p.startsWith('/api/')) return route.fulfill({ status: 404, body: 'not found' });
    if (!state.loggedIn) return json(route, { code: 2, message: 'not login' });
    if (state.latencyMs) await new Promise((r) => setTimeout(r, state.latencyMs));
    let body = null;
    try { body = req.postDataJSON(); } catch { /* GET */ }
    state.requests.push({ method: req.method(), path: p, query: q, body });

    const fsById = (id) => state.flashSales.find((f) => String(f.flash_sale_id) === String(id) && f.status !== 0);
    const usedSlots = new Set(state.flashSales.filter((f) => f.status !== 0).map((f) => f.timeslot_id));
    const view = (f) => ({ flash_sale_id: f.flash_sale_id, timeslot_id: f.timeslot_id, start_time: f.start_time, end_time: f.end_time, status: f.status, type: f.start_time > state.nowSec() ? 1 : 2, item_count: new Set(f.items.map((i) => i.item_id)).size, enabled_item_count: new Set(f.items.filter((i) => i.status === 1).map((i) => i.item_id)).size, ctime: state.nowSec() });

    switch (p) {
      case '/api/selleraccount/shop_info/':
        return json(route, { code: 0, data: { ...state.shop, shop_region: 'VN' } });
      case '/api/marketing/v4/shop_flash_sale/get_shop_flash_sale_list/': {
        let list = state.flashSales.filter((f) => f.status !== 0).sort((a, b) => b.start_time - a.start_time);
        if (q.type === '1') list = list.filter((f) => f.start_time > state.nowSec());
        const off = +q.offset || 0, lim = +q.limit || 10;
        return json(route, { code: 0, data: { total_count: list.length, flash_sale_list: list.slice(off, off + lim).map(view) } });
      }
      case '/api/marketing/v4/shop_flash_sale/get_shop_flash_sale/': {
        const f = fsById(q.flash_sale_id);
        return f ? json(route, { code: 0, data: view(f) }) : json(route, { code: 404, message: 'not found' });
      }
      case '/api/marketing/v4/shop_flash_sale/get_shop_flash_sale_item/': { // phân trang theo SẢN PHẨM như API thật
        const f = fsById(q.flash_sale_id);
        if (!f) return json(route, { code: 404, message: 'not found' });
        const itemIds = [...new Set(f.items.map((i) => i.item_id))];
        const off = +q.offset || 0, lim = +q.limit || 50;
        const page = new Set(itemIds.slice(off, off + lim));
        const models = Object.fromEntries(state.products.filter((p) => page.has(p.item_id)).map((p) => [p.item_id, p.models.map((m) => ({ itemid: p.item_id, modelid: m.model_id, name: m.variation, stock: m.stock }))]));
        const items = f.items.filter((i) => page.has(i.item_id)).map((i) => ({ model_id: i.model_id, item_id: i.item_id, status: i.status, stock: i.stock, input_promotion_price: i.input_promo_price, reject_reason: '', unqualified_conditions: i.unqualified || [] }));
        return json(route, { code: 0, data: { items, total_count: itemIds.length, item_info: [...page].map((id) => ({ itemid: id })), model_info_str: JSON.stringify(models) } });
      }
      case '/api/marketing/v4/shop_flash_sale/mock_template/': { // dữ liệu dựng trang create (thay cho nhiều API thật)
        const f = fsById(q.flash_sale_id);
        if (!f) return json(route, { code: 404, message: 'not found' });
        return json(route, { code: 0, data: { products: state.products, items: f.items } });
      }
      case '/api/marketing/v4/shop_flash_sale/get_time_slot_id/': {
        const from = Math.max(+q.start_time, state.nowSec());
        const data = state.slots.filter((s) => s.start_time >= from && s.start_time <= +q.end_time && !usedSlots.has(s.timeslot_id));
        return json(route, { code: 0, data });
      }
      case '/api/marketing/v4/shop_flash_sale/set_shop_flash_sale/': {
        if (body.flash_sale_id && body.status === 0) { // Thêm → Xóa
          const f = fsById(body.flash_sale_id);
          if (!f) return json(route, { code: 404, message: 'not found' });
          if (Number(body.time_slot_id) !== f.timeslot_id) return json(route, { code: 3, message: 'timeslot mismatch' });
          if (f.start_time <= state.nowSec()) return json(route, { code: 4, message: 'cannot delete ongoing/expired' });
          f.status = 0;
          (state.deleted = state.deleted || []).push(f.flash_sale_id);
          return json(route, { code: 0, data: {} });
        }
        if (state.rateLimit) { // giả lập Shopee chặn khi tạo quá nhiều trong thời gian ngắn
          const now = Date.now();
          state._creates = (state._creates || []).filter((x) => now - x < state.rateLimit.windowMs);
          if (state._creates.length >= state.rateLimit.max) { state.rejected = (state.rejected || 0) + 1; return json(route, { code: 429, message: 'Thao tác quá nhanh, vui lòng thử lại sau' }); }
          state._creates.push(now);
        }
        (state.createTimes = state.createTimes || []).push(Date.now());
        const s = state.slots.find((x) => x.timeslot_id === Number(body.time_slot_id));
        if (!s || usedSlots.has(s.timeslot_id)) return json(route, { code: 1, message: 'shop_flash_sale_already_exist' });
        const f = { flash_sale_id: ++state.nextFsId, timeslot_id: s.timeslot_id, start_time: s.start_time, end_time: s.end_time, status: 1, items: [] };
        state.flashSales.push(f);
        return json(route, { code: 0, data: { flash_sale_id: f.flash_sale_id } });
      }
      case '/api/marketing/v4/shop_flash_sale/set_shop_flash_sale_items/': {
        const f = fsById(body.flash_sale_id);
        if (!f) return json(route, { code: 404, message: 'not found' });
        if (state.itemsFail > 0) { state.itemsFail--; state.itemsFailed = (state.itemsFailed || 0) + 1; return json(route, { code: 500, message: 'Hệ thống bận, vui lòng thử lại' }); }
        // Phân loại "refuse": Shopee âm thầm không bật (không báo lỗi trên dòng) — như log Pear.club 08/10 tối
        const refuse = new Set(state.products.flatMap((p) => p.models).filter((m) => m.refuse).map((m) => m.model_id));
        f.items = body.items.map((i) => ({ item_id: i.item_id, model_id: i.model_id, input_promo_price: i.input_promo_price, stock: i.stock, status: refuse.has(i.model_id) ? 0 : i.status, unqualified: refuse.has(i.model_id) ? [1] : [] }));
        return json(route, { code: 0, data: { failed_items: [] } });
      }
      case '/api/marketing/v4/shop_flash_sale/set_item_sequence/':
        return json(route, { code: 0, data: {} });
      default:
        return json(route, { code: 0, data: {} });
    }
  });
}
