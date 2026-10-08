/* Mock SPA cho banhang.shopee.vn — chỉ để test. Class/DOM giống trang thật. */
(function () {
  const VN = 7 * 3600;
  const pad = (n) => String(n).padStart(2, '0');
  const vn = (ts) => new Date((ts + VN) * 1000);
  const hm = (ts) => `${pad(vn(ts).getUTCHours())}:${pad(vn(ts).getUTCMinutes())}`;
  const dmy = (ts) => `${pad(vn(ts).getUTCDate())}-${pad(vn(ts).getUTCMonth() + 1)}-${vn(ts).getUTCFullYear()}`;
  const api = (p, q = {}) => fetch(`/api/marketing/v4/shop_flash_sale/${p}/?${new URLSearchParams({ SPC_CDS: 'mock', SPC_CDS_VER: 2, ...q })}`).then((r) => r.json());
  const post = (p, body) => fetch(`/api/marketing/v4/shop_flash_sale/${p}/?SPC_CDS_VER=2`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const app = document.getElementById('app');
  const OPT = window.__MOCK_OPTS || {};
  const go = (url) => { history.pushState({}, '', url); route(); };
  const toast = (msg) => { const t = document.createElement('div'); t.className = 'eds-toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); };
  window.addEventListener('popstate', route);

  function route() {
    if (location.pathname.includes('/shop-flash-sale/create')) return renderCreate(new URLSearchParams(location.search).get('from'));
    return renderList();
  }

  // ------------------------------------------------------------------ LIST
  async function renderList() {
    app.innerHTML = '<h2>Flash Sale Của Shop</h2><table><tbody id="rows"></tbody></table>';
    const r = await api('get_shop_flash_sale_list', { offset: 0, limit: 10, type: 0 });
    const tb = document.getElementById('rows');
    for (const f of r.data.flash_sale_list) {
      const tr = document.createElement('tr');
      tr.className = 'eds-table__row valign-top';
      tr.innerHTML = `<td><div class="time-slot">${hm(f.start_time)} ${dmy(f.start_time)} - ${hm(f.end_time)}</div></td><td>Bật Flash Sale ${f.enabled_item_count}</td>
        <td class="is-last"><button type="button" class="eds-button eds-button--link">Chỉnh sửa</button><button type="button" class="eds-button eds-button--link copy">Sao chép</button></td>`;
      tr.querySelector('.copy').onclick = () => go(`/portal/marketing/shop-flash-sale/create?from=${f.flash_sale_id}`);
      tb.appendChild(tr);
    }
  }

  // ------------------------------------------------------------------ CREATE
  async function renderCreate(fromId) {
    app.innerHTML = '<div class="loading">Đang tải…</div>';
    await new Promise((r) => setTimeout(r, 300));
    const t = await api('mock_template', { flash_sale_id: fromId });
    if (t.code !== 0) return go('/portal/marketing/shop-flash-sale/list?type=0'); // mẫu không còn → về list (SPA)
    const itemByModel = Object.fromEntries(t.data.items.map((i) => [i.model_id, i]));
    let flashSaleId = null;
    let chosenSlot = null;

    const cards = t.data.products.map((p) => `
      <div class="table-card edit-mode"><div class="table-card-header"><label class="eds-checkbox item-selector"><input type="checkbox" class="eds-checkbox__input"></label><span>${p.name}</span></div>
      <div class="inner-rows">${p.models.map((m) => `
        <div class="inner-row" data-model-id="${m.model_id}" data-item-id="${p.item_id}" data-max="${m.max}" data-refuse="${m.refuse ? 1 : 0}" data-price="${(itemByModel[m.model_id] || m).input_promo_price || m.promo}">
          <label class="eds-checkbox item-selector${OPT.lockZeroStock && m.stock === 0 ? ' eds-checkbox--disabled' : ''}"><input type="checkbox" class="eds-checkbox__input"${OPT.lockZeroStock && m.stock === 0 ? ' disabled' : ''}></label>
          <div class="variation"><div class="ellipsis-content single">${m.variation}</div></div>
          <div class="original-price"><p>₫${m.price}</p></div>
          <div class="campaign-stock"><div class="eds-form-item"><div class="eds-input form-item"><div class="eds-input__inner eds-input__inner--normal"><input type="text" class="eds-input__input" value="${m.stock}"></div><p class="eds-input__error-msg"></p></div></div></div>
          <p class="current-stock">${m.stock}</p>
          <div class="enable-disable"><div class="eds-switch eds-switch--close eds-switch--normal eds-switch--disabled"></div></div>
        </div>`).join('')}</div></div>`).join('');

    app.innerHTML = `
      <div class="info-item"><div>Khung thời gian</div><div class="info-item-content"><span class="slot-text"></span><button type="button" class="eds-button eds-button--primary eds-button--outline time-slot-btn">Lựa chọn khung giờ</button></div></div>
      <div class="products-container-content">
        <div class="shopee-fixed-top-card"><div class="fixed-container">
          <div class="batch-setting-wrapper"><form class="eds-form batch-setting-panel" autocomplete="off">
            <div class="panel-left"><div class="batch-setting-title">Chỉnh sửa hàng loạt</div><div class="batch-setting-subtitle">đã chọn <strong>0</strong> phân loại hàng</div></div>
            <div class="panel-input"><div class="discount"><div class="eds-input discount-input"><div class="eds-input__inner"><input class="eds-input__input"></div></div></div>
              <div class="campaign-stock"><div class="eds-input form-item"><div class="eds-input__inner"><input class="eds-input__input" id="batch-stock"></div></div></div></div>
            <div class="panel-actions"><div class="form-item-row actions">
              <button type="button" class="eds-button eds-button--normal eds-button--disabled action-button" id="b-upd" disabled>Cập nhật hàng loạt</button>
              <div class="eds-popover action-button"><div class="eds-popover__ref"><button type="button" class="eds-button eds-button--normal eds-button--disabled" id="b-on" disabled>Bật</button></div></div>
              <div class="eds-popover action-button"><div class="eds-popover__ref"><button type="button" class="eds-button eds-button--normal eds-button--disabled" disabled>Tắt</button></div></div>
              <button type="button" class="eds-button eds-button--normal eds-button--disabled action-button" disabled>Xóa</button>
            </div></div>
          </form></div>
          <div class="table-header product-table edit-mode"><label class="eds-checkbox item-selector"><input type="checkbox" class="eds-checkbox__input" id="all"></label><div class="variation">Phân loại hàng</div></div>
        </div></div>
        <form class="eds-form product-table edit-mode"><div class="drag-container">${cards}</div></form>
      </div>
      <div class="footer"><button type="button" class="eds-button eds-button--normal">Hủy</button>
        <div class="eds-popover confirm-btn"><div class="eds-popover__ref"><button type="button" class="eds-button eds-button--primary eds-button--normal eds-button--disabled" id="f-ok" disabled>Xác nhận</button></div></div></div>
      <div class="eds-modal diagnosis-result-modal"><div class="eds-modal__box" style="display:none"><div class="eds-modal__header">Quy trình đã được quay lại</div><div class="eds-modal__footer"><button class="eds-button eds-button--primary">Xác nhận</button></div></div></div>
      <div class="eds-modal modal" id="slot-modal"><div class="eds-modal__box" style="display:none"><div class="eds-modal__content">
        <div class="eds-modal__header">Chọn khung giờ Flash sale Của Shop</div>
        <div class="eds-modal__body"><section class="left"><div class="eds-picker-header">
            <i class="eds-icon eds-picker-header__prev">«</i><i class="eds-icon eds-picker-header__prev">‹</i>
            <span class="eds-picker-header__label clickable" id="lbl-m"></span><span class="eds-picker-header__label clickable" id="lbl-y"></span>
            <i class="eds-icon eds-picker-header__next" id="next-m">›</i><i class="eds-icon eds-picker-header__next">»</i></div>
            <div class="eds-date-table__rows" id="days"></div></section>
          <section class="right"><table><tbody id="slots"></tbody></table></section></div>
        <div class="eds-modal__footer"><button type="button" class="eds-button eds-button--normal" id="m-cancel">Hủy</button><button type="button" class="eds-button eds-button--primary eds-button--disabled confirm-btn" id="m-ok" disabled>Xác nhận</button></div>
      </div></div></div>`;

    const $ = (s) => app.querySelector(s);
    const rows = () => [...app.querySelectorAll('.inner-row')];
    const selectable = () => rows().filter((r) => !r.querySelector('input[type=checkbox]').disabled);
    const setDisabled = (b, d) => { b.disabled = d; b.classList.toggle('eds-button--disabled', d); };
    const refresh = () => {
      const sel = rows().filter((r) => r.querySelector('input[type=checkbox]').checked);
      $('.batch-setting-subtitle strong').textContent = sel.length;
      setDisabled($('#b-upd'), !sel.length);
      setDisabled($('#b-on'), !sel.length || !chosenSlot);
      $('#all').checked = sel.length > 0 && sel.length === selectable().length;
    };
    app.querySelectorAll('.inner-row input[type=checkbox]').forEach((c) => c.addEventListener('change', refresh));
    // Giống trang thật: ô tổng chỉ chọn các dòng không bị khoá; bấm lại khi đã chọn hết = BỎ CHỌN tất cả
    $('#all').addEventListener('change', (e) => { selectable().forEach((r) => { r.querySelector('input[type=checkbox]').checked = e.target.checked; }); refresh(); });
    $('#b-upd').onclick = () => {
      const v = $('#batch-stock').value;
      if (!v) return;
      rows().filter((r) => r.querySelector('input[type=checkbox]').checked).forEach((r) => { const i = r.querySelector('.campaign-stock input'); if (!i.disabled) i.value = v; });
    };
    rows().forEach((r) => r.querySelector('.campaign-stock input').addEventListener('input', () => clearErr(r)));
    function clearErr(r) { r.querySelector('.eds-input__inner').classList.remove('error'); r.querySelector('.rule-error')?.remove(); }

    $('#b-on').onclick = async () => {
      const sel = rows().filter((r) => r.querySelector('input[type=checkbox]').checked && !r.querySelector('.eds-switch--open'));
      const bad = sel.filter((r) => { const q = +r.querySelector('.campaign-stock input').value; return !(q >= 1 && q <= +r.dataset.max); });
      bad.forEach((r) => {
        clearErr(r);
        r.querySelector('.eds-input__inner').classList.add('error');
        const e = document.createElement('div'); e.className = 'rule-error';
        e.textContent = `Số lượng kho phải lớn hơn 1 và nhỏ hơn ${+r.dataset.max + 1}.`;
        r.querySelector('.campaign-stock').appendChild(e);
      });
      if (bad.length) return; // 1 dòng lỗi chặn tất cả (giống trang thật)
      const willOpen = new Set(sel);
      const items = rows().map((r) => ({ item_id: +r.dataset.itemId, model_id: +r.dataset.modelId, input_promo_price: +r.dataset.price, stock: +r.querySelector('.campaign-stock input').value, status: willOpen.has(r) || r.querySelector('.eds-switch--open') ? 1 : 0 }));
      const res = await post('set_shop_flash_sale_items', { flash_sale_id: flashSaleId, items });
      if (res.code !== 0) { toast(res.message); return; }
      // dòng "refuse": Shopee không bật, không báo lỗi → công tắc vẫn tắt
      sel.filter((r) => r.dataset.refuse !== '1').forEach((r) => { r.querySelector('.eds-switch').className = 'eds-switch eds-switch--open eds-switch--normal'; r.querySelector('.campaign-stock input').disabled = true; });
    };
    $('#f-ok').onclick = async () => {
      await post('set_item_sequence', { flash_sale_id: flashSaleId, display_sequence_list: [] });
      setTimeout(() => go('/portal/marketing/shop-flash-sale/list?type=0'), 600);
    };

    // ---- popup khung giờ
    const modal = $('#slot-modal');
    const box = modal.querySelector('.eds-modal__box');
    const now = new Date(Date.now() + VN * 1000);
    let cur = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 };
    let selDay = { ...cur, d: now.getUTCDate() };
    let free = [];
    async function loadFree() {
      const start = Date.UTC(cur.y, cur.m - 1, 1) / 1000 - VN, end = Date.UTC(cur.y, cur.m, 1) / 1000 - VN - 1;
      free = (await api('get_time_slot_id', { start_time: start, end_time: end })).data;
    }
    const dayStart = (o) => Date.UTC(o.y, o.m - 1, o.d) / 1000 - VN;
    function renderDays() {
      $('#lbl-m').textContent = `Tháng ${cur.m}`; $('#lbl-y').textContent = cur.y;
      const n = new Date(Date.UTC(cur.y, cur.m, 0)).getUTCDate();
      let h = '';
      for (let d = 1; d <= n; d++) {
        const ds = dayStart({ ...cur, d }); const cnt = free.filter((s) => s.start_time >= ds && s.start_time < ds + 86400).length;
        const sel = selDay.y === cur.y && selDay.m === cur.m && selDay.d === d;
        h += `<div class="eds-date-table__cell normal${sel ? ' selected' : ''}" data-d="${d}"><span class="eds-date-table__cell-inner normal"><div class="${cnt ? 'timeslots valid' : 'no-timeslot valid'}"><p class="date-text">${d}</p>${cnt ? `<p class="slots-count">${cnt} khung giờ</p>` : ''}</div></span></div>`;
      }
      $('#days').innerHTML = h;
      $('#days').querySelectorAll('.eds-date-table__cell').forEach((c) => c.addEventListener('click', () => { selDay = { ...cur, d: +c.dataset.d }; renderDays(); setTimeout(renderSlots, 150); }));
    }
    function renderSlots() {
      const ds = dayStart(selDay);
      const list = free.filter((s) => s.start_time >= ds && s.start_time < ds + 86400);
      $('#slots').innerHTML = list.map((s) => `<tr class="eds-table__row"><td><div class="slot"><label class="eds-radio"><input type="radio" name="slot" class="eds-radio__input" value="${s.timeslot_id}"><span class="eds-radio__indicator"></span><span class="eds-radio__label">${hm(s.start_time)}:00 - ${hm(s.end_time)}:00</span></label></div></td><td>Số sản phẩm tham gia 10</td></tr>`).join('');
      setDisabled($('#m-ok'), true);
      $('#slots').querySelectorAll('input').forEach((i) => i.addEventListener('change', () => setDisabled($('#m-ok'), false)));
    }
    $('#next-m').onclick = async () => { cur = cur.m === 12 ? { y: cur.y + 1, m: 1 } : { y: cur.y, m: cur.m + 1 }; await loadFree(); renderDays(); };
    $('.time-slot-btn').onclick = async () => { await loadFree(); renderDays(); renderSlots(); box.style.display = ''; };
    $('#m-cancel').onclick = () => { box.style.display = 'none'; };
    $('#m-ok').onclick = async () => {
      const v = $('#slots').querySelector('input:checked')?.value;
      if (!v) return;
      const r = await post('set_shop_flash_sale', { time_slot_id: Number(v) }); // ⚠️ tạo flash sale ngay
      if (r.code !== 0) { toast(r.message); return; } // giống trang thật: popup vẫn mở + toast báo lỗi
      flashSaleId = r.data.flash_sale_id;
      chosenSlot = free.find((s) => String(s.timeslot_id) === v);
      // stuckModal: mô phỏng tab nền của Chrome — hiệu ứng đóng popup không chạy nên popup vẫn hiện
      if (!OPT.stuckModal) box.style.display = 'none';
      $('.slot-text').textContent = `${hm(chosenSlot.start_time)} ${dmy(chosenSlot.start_time).replace(/-/g, '/')} ~ ${hm(chosenSlot.end_time)}`;
      $('.time-slot-btn').textContent = 'Sửa';
      selectable().forEach((r) => r.querySelector('.eds-switch').classList.remove('eds-switch--disabled'));
      setDisabled($('#f-ok'), false);
      refresh();
    };
    refresh();
  }

  route();
})();
