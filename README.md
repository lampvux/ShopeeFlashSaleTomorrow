# Shopee Flash Sale Ngày Mai

Tự động hoá việc mỗi ngày **sao chép Flash Sale của Shop sang tất cả khung giờ còn trống của ngày mai**, cho nhiều shop.
Mỗi khung giờ: SL khuyến mãi = 15; phân loại tồn kho < 15 đặt SL 1; phân loại hết hàng (ô tích bị Shopee khoá) tự bỏ qua; dòng nào Shopee vẫn báo lỗi thì đặt về 1 rồi bấm Bật lại. Cuối cùng bấm Xác nhận. Flash sale RỖNG sót lại từ lần lỗi trước được tự xoá rồi tạo lại.

Hướng dẫn đầy đủ: [`docs/huong-dan-su-dung.md`](docs/huong-dan-su-dung.md).

Có 2 cách chạy, **dùng chung 1 engine** (`extension/fs-engine.js`):

| | **A. Playwright runner** (tự chạy theo lịch) | **B. Chrome extension** (bấm 1 nút) |
|---|---|---|
| Chạy ở đâu | PC Windows / VPS Windows ở VN | Chrome bạn đang dùng hằng ngày |
| Song song | **3 shop cùng lúc** (3 Chrome), mỗi shop **8 tab** (1 tab/khung giờ) | 8 cửa sổ nhỏ xếp lưới/shop, mở và đóng tự động |
| Kích hoạt | Task Scheduler 20:00 mỗi ngày | Mở popup → **Chạy** |
| Đăng nhập | 1 lần cho mỗi shop (`npm run login -- shop1`), phiên được lưu trong `profiles/` | Dùng luôn phiên đang đăng nhập |
| 3 shop | tự chạy lần lượt 3 profile | mỗi shop 1 Chrome profile, cài extension ở mỗi profile |
| Log | `logs/<ngày>/` (text + jsonl + ảnh chụp lỗi) | trong popup + nút **Tải log** |

---

## Cơ chế thật của Shopee (đã kiểm chứng trên shop thật, 05/10/2026)

| Thao tác UI | Request gửi lên server | Ý nghĩa |
|---|---|---|
| Popup khung giờ → **Xác nhận** | `POST set_shop_flash_sale {time_slot_id}` | ⚠️ **Flash sale được tạo ngay lúc này** |
| **Bật** | `POST set_shop_flash_sale_items` (giá, SL, trạng thái) | Sản phẩm được lưu |
| Bật khi có ≥1 dòng lỗi | (không gửi gì) | **1 dòng lỗi chặn cả trang**, ví dụ "Số lượng kho phải lớn hơn 1 và nhỏ hơn 502." |
| **Xác nhận** cuối trang | `POST set_item_sequence` → về trang list sau ~2s (SPA) | Chỉ lưu thứ tự hiển thị |

Hệ quả cho thiết kế:
- **Dry-run** chỉ chọn khung giờ rồi bấm **Hủy**, nên không bao giờ tạo gì.
- Danh sách khung giờ còn trống đọc qua API chỉ-đọc `get_time_slot_id`, vốn chỉ trả slot chưa dùng. Nhờ đó **chạy lại bao nhiêu lần cũng không tạo trùng**.
- Nếu bị ngắt giữa "chọn slot" và "Bật", có thể còn lại flash sale rỗng. Lượt chạy sau (hoặc vòng 2 của chính lượt đó) **tự xoá flash sale rỗng** rồi tạo lại khung giờ đó (`repairEmpty`). Còn sót sau 2 vòng thì báo **INCOMPLETE** kèm id.
- Có phân loại Shopee **không bật mà cũng không báo lỗi** trên dòng. Engine bỏ qua các phân loại đó (ghi log), và xác định thành công bằng dữ liệu Shopee đã lưu (`get_shop_flash_sale_item`: `status`, `reject_reason`, `unqualified_conditions` của từng phân loại), không chỉ dựa vào công tắc trên giao diện.
- Phân loại tồn kho 0 bị Shopee **khoá ô tích**: ô "Phân loại hàng" chỉ chọn được các dòng còn lại (ví dụ 98/120). Bấm lại ô đó sẽ **bỏ chọn tất cả**, nên engine chỉ bấm một lần.
- Mẫu sao chép là flash sale trên cùng còn sản phẩm bật, tương đương bấm "Sao chép" ở dòng đầu.

Các thao tác **ghi** đi qua giao diện, giống hệt bạn tự bấm. Script gọi trực tiếp các API **đọc** (`get_*`, `shop_info`), đúng những API mà chính trang Seller Center vẫn gọi. Ngoại lệ duy nhất: xoá flash sale RỖNG gửi đúng request của nút "Thêm → Xóa" (`set_shop_flash_sale {flash_sale_id, time_slot_id, status: 0}`), sau khi kiểm tra lại là 0 sản phẩm, chưa diễn ra, đúng ngày đích.

---

## Chạy song song: 3 Chrome × 8 tab

```
Chrome shop1 ─┬─ tab1: 00:00   Chrome shop2 ─┬─ tab1: 00:00   Chrome shop3 ─┬─ …
              ├─ tab2: 02:00                 ├─ tab2: 02:00                 │
              ├─ …                           ├─ …                           │
              └─ tab8: 21:00                 └─ tab8: 21:00                 └─ …
```
- Mỗi tab được **giao cố định 1 khung giờ** (engine chỉ chọn đúng `slotIds` được giao), nên không có chuyện 2 tab giành cùng một slot hay tạo trùng.
- Các tab khởi động lệch nhau `staggerMs` (300ms) cộng thêm `jitterMs` ngẫu nhiên, để 8 lệnh tạo không bắn ra trong cùng một mili-giây.
- Nếu Shopee **từ chối** (ví dụ "thao tác quá nhanh"), engine nhận ra qua thông báo lỗi, kiểm tra slot vẫn còn trống rồi **tự thử lại** với thời gian chờ tăng dần (tối đa `maxAttemptsPerSlot` lần). Nếu `circuitBreaker` slot lỗi liên tiếp thì dừng shop đó để an toàn.
- Chrome được mở với các cờ chống làm chậm tab nền (`--disable-background-timer-throttling`…).

**Thời gian** (đo trên mock Seller Center có giả lập độ trễ mạng; trên shop thật sẽ chậm hơn vì trang tải lâu hơn):

| Chế độ | 1 shop × 8 slot | 3 shop × 8 slot |
|---|---|---|
| Lần lượt (1 tab) | ~50s | ~150s |
| **Song song 8 tab** | **~10s** | **~10s** (3 Chrome chạy cùng lúc) |

Ước tính trên shop thật: khoảng **30–60 giây cho cả 3 shop**, so với 6–9 phút nếu chạy lần lượt. Thời gian thật của từng shop có trong log và trong bảng tổng kết.

**Lưu ý:**
- 24 trang, mỗi trang khoảng 125 dòng, cần khoảng **4–6 GB RAM**. Máy yếu thì giảm xuống: `--slots 4` hoặc `"parallelShops": 2`.
- Chưa kiểm chứng được Shopee có giới hạn số lệnh tạo đồng thời không. Lần chạy thật đầu tiên, hãy xem log có dòng `CREATE_REJECTED` không. Nếu có nhiều, giảm `parallelSlots` hoặc tăng `staggerMs`.

---

## A. Playwright runner

### 1. Cài đặt (1 lần)
1. Cài **Node.js 18+** (https://nodejs.org) và **Google Chrome**.
2. Mở PowerShell trong thư mục này:
   ```powershell
   npm install
   copy config\shops.example.json config\shops.json
   ```
3. Sửa `config/shops.json`: mỗi shop 1 dòng, `id` là tên thư mục profile (ví dụ `pear`, `shop2`, `shop3`).
   > Máy không có Google Chrome thì chạy thêm `npx playwright install chromium`, script sẽ tự dùng Chromium.

### 2. Đăng nhập từng shop (1 lần, làm lại khi phiên hết hạn)
```powershell
npm run login -- pear
npm run login -- shop2
npm run login -- shop3
```
Một cửa sổ Chrome sẽ mở ra. Bạn tự đăng nhập **đúng shop** (kể cả OTP). Script tự nhận biết khi đăng nhập xong, ghi lại `shop_id` của profile đó (để lần sau phát hiện login nhầm shop) rồi đóng cửa sổ.
Script **không đọc và không lưu mật khẩu**. Phiên đăng nhập (cookie) nằm trong `profiles/<id>/`.

### 3. Chạy thử (không tạo gì)
```powershell
npm run dry                         # tất cả shop
node runner/run.js --dry-run --shop pear
```

### 4. Chạy thật
```powershell
npm start                           # tất cả shop, ngày mai
node runner/run.js --shop pear      # 1 shop
node runner/run.js --date 2026-10-08   # chạy bù cho 1 ngày cụ thể
node runner/run.js --headless       # không hiện cửa sổ
node runner/run.js --slots 3        # tối đa 3 tab song song mỗi shop
node runner/run.js --sequential     # các shop chạy lần lượt
```
Ví dụ tổng kết:
```
================ TỔNG KẾT (41s) ================
✔ pear       OK               ngày 07/10/2026  tạo mới 8  còn trống 0  38s
✔ shop2      OK               ngày 07/10/2026  tạo mới 8  còn trống 0  41s
✔ shop3      OK               ngày 07/10/2026  tạo mới 8  còn trống 0  35s
```

### 5. Lên lịch 20:00 mỗi ngày
```powershell
powershell -ExecutionPolicy Bypass -File scheduler\register-task.ps1            # 20:00
powershell -ExecutionPolicy Bypass -File scheduler\register-task.ps1 -At "19:30"
Start-ScheduledTask -TaskName ShopeeFlashSaleTomorrow                           # chạy thử ngay
powershell -ExecutionPolicy Bypass -File scheduler\unregister-task.ps1          # gỡ
```
- Task chạy khi bạn **đã đăng nhập Windows**, vì cần mở cửa sổ Chrome. Task có bật *Wake to run* (đánh thức máy khi đang Sleep) và *Start when available* (lỡ giờ thì chạy ngay khi máy bật lại).
- Nếu máy bật lại **sau 00:00** thì "ngày mai" đã thành ngày kế tiếp. Muốn bù cho hôm nay thì chạy `node runner/run.js --date <hôm nay>`.

### 6. Chạy trên VPS ở Việt Nam
- Nên dùng **Windows VPS đặt tại VN**: Shopee hay bắt xác minh khi đăng nhập từ IP nước ngoài hoặc IP datacenter lạ.
- RDP vào VPS, rồi làm lại các bước 1, 2, 5 *ngay trên VPS* (đăng nhập trực tiếp trên VPS, không copy profile từ PC sang).
- Để task chạy được khi bạn ngắt RDP, hãy để phiên Windows ở trạng thái đăng nhập (đóng cửa sổ RDP, **không Sign out**), hoặc bật auto-logon.
- VPS Linux cũng chạy được bằng `xvfb-run node runner/run.js`, nhưng bước đăng nhập cần VNC. Cách này không khuyến nghị.

### Cấu hình (`config/shops.json`)
| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `defaults.qty` | 15 | SL sản phẩm khuyến mãi |
| `defaults.mode` | `one` | `one`: tồn kho < qty thì đặt SL 1. `min`: đặt bằng tồn kho. `fixed`: giữ qty, lỗi mới đặt 1 |
| `defaults.fallbackQty` | 1 | SL đặt cho dòng Shopee báo lỗi |
| `defaults.maxRetry` | 4 | số lần bấm Bật lại |
| `defaults.skipUnfixable` | true | dòng vẫn lỗi dù SL=1 (ví dụ tồn kho 0) thì bỏ chọn để các dòng khác bật được |
| `defaults.preSubmitDelayMs` | 1500 | chờ sau khi cuộn xuống trước khi bấm Xác nhận |
| `defaults.parallelSlots` | 8 | số tab song song mỗi shop (1 = lần lượt) |
| `defaults.staggerMs` / `jitterMs` | 300 / 300 | tab thứ i bắt đầu trễ i×staggerMs, cộng thêm ngẫu nhiên |
| `defaults.maxAttemptsPerSlot` | 3 | số lần thử cho 1 slot (chỉ thử lại khi slot vẫn còn trống) |
| `defaults.retryBackoffMs` | 2000 | chờ trước khi thử lại (nhân theo số lần) |
| `defaults.circuitBreaker` | 4 | N slot lỗi liên tiếp → dừng shop |
| `defaults.repairEmpty` | true | xoá flash sale rỗng (0 sản phẩm, chưa diễn ra) của ngày đích rồi tạo lại |
| `defaults.maxRounds` | 2 | còn rỗng / còn trống sau vòng 1 thì chạy thêm vòng |
| `parallelShops` | true | true = tất cả shop cùng lúc · số N = tối đa N shop · false = lần lượt |
| `browser.channel` | `chrome` | dùng Google Chrome đã cài |
| `browser.headless` | false | true = không hiện cửa sổ |
| `shops[].templateFlashSaleId` | null | ghim 1 flash sale mẫu cố định (mặc định lấy dòng trên cùng) |
| `shops[].overrides` | – | ghi đè `defaults` cho riêng shop đó |

### Log & trạng thái
`logs/<YYYY-MM-DD>/`: `<shop>.log` (dễ đọc), `<shop>.jsonl` (chi tiết từng vòng), `summary-*.json`, ảnh chụp khi lỗi. Log cũ hơn 30 ngày tự xoá.

| Trạng thái | Nghĩa | Cần làm |
|---|---|---|
| `OK` | ngày đích đủ khung giờ | – |
| `OK_WITH_ERRORS` | đủ khung giờ, có lỗi đã tự xử lý | xem log |
| `PARTIAL` | còn khung giờ trống | xem log/ảnh, chạy lại |
| `INCOMPLETE` | còn flash sale rỗng sau 2 vòng | chạy lại cho ngày đó, hoặc xoá tay "Thêm → Xóa" |
| `SESSION_EXPIRED` | phiên hết hạn | `npm run login -- <id>` |
| `WRONG_SHOP` | profile đang đăng nhập shop khác | đăng nhập lại đúng shop |
| `CRASH` | lỗi hệ thống (profile bị khoá, mất mạng…) | xem log |

---

## B. Chrome extension

1. Mở `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục `extension/`.
2. Làm lại bước 1 ở **mỗi Chrome profile** ứng với mỗi shop.
3. Mở tab `banhang.shopee.vn` của shop → bấm icon ⚡ → kiểm tra ngày (mặc định là ngày mai), SL 15, **Số cửa sổ song song** (mặc định 8), **Tồn kho < SL thì đặt SL = 1** → **Chạy**.
   - Extension mở tối đa 8 **cửa sổ** nhỏ xếp kín màn hình, mỗi cửa sổ một khung giờ, và **tự đóng** khi xong. Popup hiện ô trạng thái của từng khung giờ (⏳ 🔄 ✅ ⚠️). Đừng thu nhỏ hay che các cửa sổ này.
   - Cửa sổ thay cho tab nền vì Chrome dừng hiệu ứng ở tab nền, làm popup khung giờ của Shopee đứng yên (lỗi `TIMEOUT` ngày 07/10).
   - Background của extension là bộ điều phối duy nhất: giao slot, thử lại slot bị Shopee chặn, tổng kết khi tất cả xong.
   - Có thể đóng popup. Đừng thao tác trên các tab đó cho tới khi xong (lỡ đóng một tab thì slot đó bị đánh dấu lỗi).
   - Tick **Tự xoá flash sale RỖNG** (mặc định bật) để dọn flash sale rỗng của ngày đó rồi tạo lại.
   - **Dừng** để dừng sau bước hiện tại. **Tải log** để lưu file log.
   - Tick **Dry-run** để kiểm tra mà không tạo gì.

---

## Khi Shopee đổi giao diện
Mọi selector nằm trong object `SEL` ở đầu `extension/fs-engine.js`. Sửa ở đó là cả runner lẫn extension đều nhận. Sau khi sửa:
```powershell
npm test                            # 16 test end-to-end runner trên mock Seller Center
node test/mock.e2e.test.js --ext    # + 6 test extension
node test/mock.e2e.test.js --only-ext
node test/mock.e2e.test.js "--only=Pear"   # chỉ chạy test có tên chứa "Pear"
```
rồi chạy `npm run dry` trên shop thật.

## Bảo mật
- `profiles/` chứa phiên đăng nhập Shopee. **Không chia sẻ, không commit, không đưa lên cloud.** Đã có sẵn trong `.gitignore`.
- Script không lưu mật khẩu và không gửi dữ liệu đi đâu ngoài `banhang.shopee.vn`.
- Tự động hoá Seller Center có thể không nằm trong phạm vi Điều khoản của Shopee. Phương án chính thức về lâu dài là **Shopee Open Platform API** (`v2.shop_flash_sale.*`). Engine đã tách riêng để sau này thay bằng API.

## Cấu trúc
```
extension/fs-engine.js   engine dùng chung (selector, chọn slot, SL, Bật+retry, Xác nhận)
extension/               Chrome extension (manifest, content.js, popup)
runner/                  Playwright runner (run.js, login.js, lib/)
scheduler/               Task Scheduler (run-daily.cmd, register-task.ps1)
config/                  shops.example.json → shops.json
test/                    mock Seller Center + test end-to-end
```
