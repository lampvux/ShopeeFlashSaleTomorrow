# Hướng dẫn sử dụng — Shopee Flash Sale Ngày Mai

> Tài liệu chi tiết cách chạy. Bản tóm tắt nhanh ở `README.md` tại thư mục gốc.

## Tổng quan

Mỗi ngày chỉ cần một lệnh `npm start`, hoặc để Task Scheduler tự chạy lúc 20:00. Lệnh này tạo Flash Sale cho mọi khung giờ còn trống của ngày mai ở cả 3 shop: SL 15; phân loại tồn kho dưới 15 đặt SL 1; phân loại hết hàng (ô tích bị Shopee khoá) tự bỏ qua; dòng nào Shopee vẫn báo lỗi thì hạ về 1 rồi bấm Bật lại. Flash sale RỖNG (0 sản phẩm) sót lại từ lần chạy lỗi trước được tự xoá rồi tạo lại.

Có 2 cách chạy, dùng chung một engine (`extension/fs-engine.js`):

| | Playwright runner | Chrome extension |
| --- | --- | --- |
| Dùng khi | Muốn tự động hoàn toàn theo lịch | Muốn bấm tay, không cần cài Node |
| Kích hoạt | `npm start` hoặc Task Scheduler 20:00 | Popup ⚡ → Chạy |
| Đăng nhập | 1 lần cho mỗi shop bằng `npm run login` | Dùng luôn phiên Chrome đang mở |
| Song song | 3 shop × 8 tab | 8 cửa sổ nhỏ xếp lưới cho mỗi shop (mỗi shop một Chrome profile) |
| Thời gian (ước tính) | 30–60 giây cho cả 3 shop | khoảng 1 phút mỗi shop |
| Log | thư mục `logs\<ngày>\` | trong popup + nút Tải log |

Khuyên dùng: runner chạy theo lịch là chính, extension để chạy tay nhanh khi cần.

Các con số thời gian ở trên được ước tính từ bản mô phỏng Seller Center. Thời gian thật của từng shop sẽ có trong log sau lần chạy đầu tiên.

### Một lần chạy làm gì

```
npm start  (hoặc Task Scheduler 20:00)
        │
        ▼
3 shop chạy CÙNG LÚC, mỗi shop một cửa sổ Chrome:
        │
        ├─ 1. Kiểm tra đăng nhập và đúng shop
        ├─ 2. Xoá flash sale RỖNG (0 sản phẩm) của ngày đích nếu có
        │     → đọc khung giờ còn trống, chọn flash sale mẫu
        │
        ├─ chia khung giờ cho tối đa 8 tab chạy song song:
        │     tab1=00:00  tab2=02:00  tab3=09:00  tab4=12:00
        │     tab5=15:00  tab6=17:00  tab7=19:00  tab8=21:00
        │
        │     mỗi tab làm ĐÚNG một khung giờ được giao:
        │     sao chép mẫu → chọn khung giờ → tích ô Phân loại hàng
        │       (dòng hết hàng bị khoá → tự bỏ qua) → SL 15 (tồn dưới 15 → 1)
        │       → Bật → Xác nhận
        │     dòng báo lỗi → SL 1 → Bật lại
        │     Shopee từ chối vì quá nhanh → tự thử lại khi slot còn trống
        │
        ├─ còn flash sale rỗng / khung giờ trống → vòng 2 (xoá rỗng → tạo lại)
        │
        └─ 3. Tổng kết: đếm lại flash sale, báo slot rỗng hoặc còn trống
        │
        ▼
Bảng TỔNG KẾT + log theo ngày
```

Mỗi tab chỉ được giao một khung giờ cố định, nên các tab không bao giờ giành nhau hay tạo trùng một slot.

## Cài đặt lần đầu

Chỉ làm một lần, mất khoảng 10 phút.

1. Cài **Node.js 18 trở lên** (bản LTS tại nodejs.org). Kiểm tra bằng lệnh `node -v`.
2. Cài **Google Chrome** nếu máy chưa có.
3. Mở PowerShell trong thư mục `E:\Work\Personal Projects\ShopeeFlashSaleTomorrow` (Shift + chuột phải vào vùng trống → Open PowerShell window here).
4. Cài thư viện: `npm install`
5. Tạo file cấu hình: `copy config\shops.example.json config\shops.json`
6. Mở `config\shops.json` và sửa 3 shop. `id` là tên thư mục profile: chỉ gồm chữ không dấu, số, `_`, `-` (ví dụ `pear`). `name` là tên dễ nhớ. Các khoá khác xem phần Cấu hình.
7. Kiểm tra: `node runner/run.js --help` in ra dòng "Cách dùng…" là đã cài xong.

Máy không có Google Chrome thì chạy thêm `npx playwright install chromium`. Script sẽ tự chuyển sang Chromium của Playwright.

## Đăng nhập từng shop

Mỗi shop chỉ cần đăng nhập một lần. Phiên đăng nhập được lưu trong `profiles\<id>` và dùng lại cho các lần chạy sau.

```
npm run login -- shop1
npm run login -- shop2
npm run login -- shop3
```

1. Một cửa sổ Chrome mở ra ở trang Seller Center.
2. Bạn tự đăng nhập **đúng shop** ứng với `id` đó, kể cả OTP. Script không đọc và không lưu mật khẩu.
3. Script tự nhận ra khi đăng nhập xong, in `✔ Đã đăng nhập: <tên shop> (shop_id …)` rồi tự đóng cửa sổ. Muốn huỷ thì bấm Ctrl+C.

Một số điểm cần biết:

- Script ghi lại `shop_id` vào profile. Nếu sau này profile đó bị đăng nhập nhầm sang shop khác, lần chạy sẽ dừng với trạng thái `WRONG_SHOP` để không tạo nhầm.
- Cần đăng nhập lại khi log báo `SESSION_EXPIRED`, khi bạn đổi mật khẩu, hoặc khi Shopee bắt xác minh lại.
- Mỗi profile chỉ mở được ở một nơi tại một thời điểm. Hãy đóng cửa sổ login trước khi chạy.

## Chạy runner và các option dòng lệnh

Lệnh chuẩn hằng ngày là `npm start`: 3 shop song song, mỗi shop 8 tab, tạo cho ngày mai. Trước lần chạy thật đầu tiên, hãy chạy `npm run dry`.

| Option | Tác dụng | Ví dụ | Khi nào dùng |
| --- | --- | --- | --- |
| (không option) | Chạy mọi shop có `enabled` khác `false`, cho ngày mai | `npm start` | Hằng ngày |
| `--dry-run` | Kiểm tra đăng nhập, mẫu, chọn thử từng khung giờ rồi bấm Hủy. **Không tạo gì** | `npm run dry` | Lần đầu, sau khi đổi cấu hình, khi Shopee đổi giao diện |
| `--shop id1,id2` | Chỉ chạy các shop đã nêu, kể cả shop đang `enabled: false` | `--shop shop1,shop3` | Chạy lại 1 shop bị lỗi |
| `--date YYYY-MM-DD` | Tạo cho một ngày cụ thể thay vì ngày mai | `--date 2026-10-08` | Chạy bù khi lỡ lịch, tạo trước cho ngày khác |
| `--slots N` | Tối đa N tab song song mỗi shop (ghi đè `parallelSlots`) | `--slots 3` | Máy yếu, hoặc Shopee chặn vì thao tác quá nhanh |
| `--sequential` | Các shop chạy lần lượt thay vì cùng lúc | `--sequential` | RAM thấp |
| `--headless` | Không hiện cửa sổ Chrome | `--headless` | VPS, hoặc không muốn cửa sổ bật lên |
| `--headed` | Luôn hiện cửa sổ (ghi đè `browser.headless: true`) | `--headed` | Muốn quan sát từng bước |
| `--config file` | Dùng file cấu hình khác | `--config config\test.json` | Thử cấu hình mới mà không sửa file chính |
| `--help` | In cách dùng | `node runner/run.js --help` | Quên cú pháp |

Các option ghép được với nhau, ví dụ:

```
node runner/run.js --shop shop2 --date 2026-10-08 --slots 4 --dry-run
```

- Chạy qua npm thì đặt option sau dấu `--`: `npm start -- --shop shop1`.
- Cuối mỗi lần chạy, bảng **TỔNG KẾT** in ra trạng thái, số slot tạo mới, số slot còn trống và thời gian của từng shop.
- Mã thoát: `0` = mọi shop OK, `1` = có shop chưa OK, `2` = lỗi cấu hình hoặc đang có lần chạy khác.
- Mỗi thời điểm chỉ có một lần chạy, nhờ file khoá `logs\.run.lock`. Khoá tự hết hạn sau 2 giờ.
- Chạy lại bao nhiêu lần cũng không tạo trùng, vì script chỉ làm các khung giờ còn trống.

## Cấu hình config/shops.json

Mọi thiết lập lâu dài nằm trong `config\shops.json`. Option dòng lệnh chỉ áp dụng cho lần chạy đó. Mặc định đã là cấu hình khuyên dùng; thường bạn chỉ cần sửa danh sách `shops`.

**`defaults`**: áp dụng cho mọi shop

| Khoá | Mặc định | Ý nghĩa | Gợi ý |
| --- | --- | --- | --- |
| `qty` | 15 | SL sản phẩm khuyến mãi đặt hàng loạt | Đổi khi muốn SL khác |
| `mode` | `"one"` | `"one"`: tồn kho dưới `qty` thì đặt `fallbackQty` (1) ngay. `"min"`: đặt bằng tồn kho. `"fixed"`: luôn đặt `qty`, dòng lỗi mới hạ về `fallbackQty` | Giữ `"one"` (đúng quy trình làm tay) |
| `fallbackQty` | 1 | SL đặt cho dòng Shopee báo lỗi | Giữ 1 (theo quy trình của bạn) |
| `maxRetry` | 4 | Số lần bấm Bật lại trong cùng một khung giờ | Giữ |
| `skipUnfixable` | true | Dòng vẫn lỗi dù SL = 1 (ví dụ tồn kho 0) thì bỏ chọn, để các dòng khác vẫn bật được | Giữ true |
| `preSubmitDelayMs` | 1500 | Chờ (ms) sau khi cuộn xuống cuối trang rồi mới bấm Xác nhận | 1000–2000 |
| `parallelSlots` | 8 | Số tab chạy song song trong một shop. 1 = lần lượt | 8; giảm nếu máy yếu hoặc bị chặn |
| `staggerMs` | 300 | Tab thứ i bắt đầu trễ i × staggerMs, để các lệnh tạo không bắn cùng lúc | Tăng lên 800–1000 nếu bị chặn |
| `jitterMs` | 300 | Cộng thêm thời gian ngẫu nhiên 0..jitterMs cho mỗi tab | Giữ |
| `maxAttemptsPerSlot` | 3 | Số lần thử cho một khung giờ. Chỉ thử lại khi slot vẫn còn trống | 3–5 |
| `retryBackoffMs` | 2000 | Chờ trước khi thử lại, nhân theo số lần thử | Giữ |
| `circuitBreaker` | 4 | Số khung giờ lỗi liên tiếp thì dừng shop đó | Giữ |
| `repairEmpty` | true | Trước khi tạo, xoá các flash sale **RỖNG** (0 sản phẩm, chưa diễn ra) của ngày đích rồi tạo lại khung giờ đó. Không bao giờ đụng flash sale có sản phẩm | Giữ true |
| `maxRounds` | 2 | Số vòng tối đa. Hết vòng 1 mà còn flash sale rỗng hoặc khung giờ trống thì chạy thêm vòng nữa | 2 |

> File `config\shops.json` tạo từ bản cũ có `"mode": "min"`. Hãy đổi thành `"mode": "one"` (hoặc xoá dòng đó) để phân loại tồn kho dưới 15 được đặt SL 1.

**Các khoá cấp trên**

| Khoá | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `browser.channel` | `"chrome"` | Dùng Google Chrome đã cài. Để trống thì dùng Chromium của Playwright |
| `browser.headless` | false | true = không hiện cửa sổ Chrome |
| `browser.slowMo` | 0 | Làm chậm mỗi lệnh Playwright N ms. Chỉ để quan sát hoặc gỡ lỗi |
| `parallelShops` | true | true = mọi shop cùng lúc. Một số N = tối đa N shop cùng lúc. false = lần lượt |
| `logRetentionDays` | 30 | Tự xoá log cũ hơn N ngày. 0 = giữ mãi |

**`shops`**: mỗi shop một dòng

| Khoá | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `id` | có | Tên thư mục profile và tên file log. Chỉ gồm chữ không dấu, số, `_`, `-` |
| `name` | không | Tên dễ nhớ, hiện trong log |
| `enabled` | không | `false` = bỏ qua khi chạy mặc định (vẫn chạy được bằng `--shop`) |
| `templateFlashSaleId` | không | Ghim một flash sale mẫu cố định. Mặc định lấy dòng trên cùng còn sản phẩm bật. Nếu mẫu ghim bị xoá, shop đó dừng |
| `overrides` | không | Ghi đè bất kỳ khoá nào của `defaults` cho riêng shop này |

Ví dụ: shop 3 dùng SL 10 và chỉ 4 tab, shop 2 tạm nghỉ:

```
"shops": [
  { "id": "pear",  "name": "PEAR STUDIO" },
  { "id": "shop2", "name": "Shop 2", "enabled": false },
  { "id": "shop3", "name": "Shop 3", "overrides": { "qty": 10, "parallelSlots": 4 } }
]
```

## Lên lịch tự động 20:00

Sau khi đăng ký, Windows tự chạy `npm start` lúc 20:00 mỗi ngày. Bạn không phải làm gì thêm, chỉ cần xem log khi có báo lỗi.

| Việc | Lệnh (PowerShell, trong thư mục dự án) |
| --- | --- |
| Đăng ký chạy 20:00 | `powershell -ExecutionPolicy Bypass -File scheduler\register-task.ps1` |
| Đổi giờ, ví dụ 19:30 | `powershell -ExecutionPolicy Bypass -File scheduler\register-task.ps1 -At "19:30"` |
| Chạy thử ngay | `Start-ScheduledTask -TaskName ShopeeFlashSaleTomorrow` |
| Xem lần chạy gần nhất | `Get-ScheduledTaskInfo -TaskName ShopeeFlashSaleTomorrow` |
| Gỡ lịch | `powershell -ExecutionPolicy Bypass -File scheduler\unregister-task.ps1` |
| Chạy tay bằng chuột | Double-click `scheduler\run-daily.cmd` |

- Task chạy khi bạn **đang đăng nhập Windows**, vì cần mở được cửa sổ Chrome. Khoá màn hình thì vẫn chạy, Sign out thì không.
- *Wake to run*: máy đang Sleep sẽ được đánh thức để chạy.
- *Start when available*: máy tắt lúc 20:00 thì task chạy ngay khi máy bật lại.
- Nếu máy bật lại **sau 00:00**, "ngày mai" đã thành ngày kế tiếp. Khi đó chạy bù cho hôm nay bằng `node runner/run.js --date <hôm nay>`; script chỉ tạo được các khung giờ chưa bắt đầu.
- Log của task nằm ở `logs\scheduler.log`. Muốn đổi thiết lập cho mọi lần chạy theo lịch (số tab, SL…) thì sửa `config\shops.json`, không cần đăng ký lại task.

**Chạy trên VPS ở Việt Nam**

1. Thuê **Windows VPS đặt tại Việt Nam**, nên có từ 8 GB RAM nếu chạy 3 shop × 8 tab. IP nước ngoài hoặc datacenter lạ dễ bị Shopee bắt xác minh.
2. RDP vào VPS, làm lại các bước Cài đặt, Đăng nhập và Lên lịch **ngay trên VPS**. Không copy thư mục `profiles` từ PC sang.
3. Khi thoát RDP, hãy đóng cửa sổ RDP chứ **không Sign out**, để phiên Windows vẫn đăng nhập. Cách khác là bật auto-logon.
4. Tuỳ chọn: đặt `browser.headless: true` để Chrome không hiện cửa sổ.

## Chrome extension

Extension chạy ngay trong Chrome bạn đang dùng, không cần Node và không cần đăng nhập riêng. Chạy một lần mất một cú bấm cho mỗi shop.

**Cài đặt (mỗi Chrome profile một lần)**

1. Mở `chrome://extensions` và bật **Developer mode** (góc trên bên phải).
2. Bấm **Load unpacked**, chọn thư mục `extension` trong dự án.
3. Ghim icon ⚡ lên thanh công cụ.
4. Lặp lại ở **mỗi Chrome profile** ứng với mỗi shop.

Sau khi sửa code, bấm nút tải lại (↻) của extension trong `chrome://extensions`.

**Các option trong popup**

| Option | Mặc định | Ý nghĩa |
| --- | --- | --- |
| Ngày tạo | Ngày mai (giờ Việt Nam) | Ngày cần tạo. Đổi để chạy bù hoặc tạo trước |
| SL sản phẩm khuyến mãi | 15 | Giống `qty` của runner |
| Số cửa sổ chạy song song | 8 | 1–8, mỗi cửa sổ một khung giờ |
| Tồn kho < SL thì | đặt SL = 1 | Giống `mode` của runner: đặt SL = 1 (`one`), đặt SL = tồn kho (`min`), giữ SL, lỗi mới đặt 1 (`fixed`) |
| Tự xoá flash sale RỖNG của ngày này rồi tạo lại | bật | Giống `repairEmpty`. Chạy thêm vòng 2 nếu vòng 1 còn sót |
| Mỗi khung giờ 1 cửa sổ riêng | bật | Tắt = mở tab nền như bản cũ (dễ kẹt popup khung giờ, không khuyên dùng) |
| Dry-run | tắt | Chọn thử từng khung giờ rồi bấm Hủy, không tạo gì |
| **Chạy** | | Bắt đầu trên tab Shopee đang mở (chưa có tab thì tự mở) |
| **Dừng** | | Không giao khung giờ mới; các tab đang chạy làm nốt rồi đóng |
| **Tải log** | | Lưu file log của lần chạy gần nhất |

**Cách dùng**

1. Mở tab `banhang.shopee.vn` của shop cần chạy.
2. Bấm ⚡, kiểm tra dòng tên shop ở đầu popup cho đúng, rồi bấm **Chạy**.
3. Extension mở tối đa 8 cửa sổ nhỏ xếp kín màn hình, mỗi cửa sổ một khung giờ, và tự đóng khi xong. Popup hiện ô trạng thái của từng khung giờ: ⏳ đang chờ, 🔄 đang làm, ✅ xong, ⚠️ lỗi, ⏭ bỏ qua (`v2` = vòng 2). Icon ⚡ hiện số khung giờ đã xong, ví dụ `5/8`, rồi ✓ khi hoàn tất.
4. Có thể đóng popup, quá trình vẫn tiếp tục. **Đừng thu nhỏ (minimize), che kín hay thao tác trên các cửa sổ đang chạy.** Lỡ đóng một cửa sổ thì khung giờ đó bị đánh dấu lỗi.

Vì sao dùng cửa sổ thay cho tab: Chrome dừng hiệu ứng giao diện ở tab nền, nên popup chọn khung giờ của Shopee có thể đứng yên dù flash sale đã được tạo (lỗi `TIMEOUT … đóng popup khung giờ` trong log 07/10). Bản 1.1 vừa nhận biết thành công qua công tắc Bật/Tắt được mở khoá, vừa mở mỗi khung giờ trong một cửa sổ đang hiển thị.

Extension nhớ các lựa chọn của lần chạy trước (trừ ngày và dry-run).

## Các kịch bản hay dùng

Tìm tình huống của bạn trong bảng dưới đây rồi chạy đúng lệnh ở cột bên phải.

| Tình huống | Làm gì |
| --- | --- |
| Lần đầu sau khi cài | `npm run dry`, xem log OK rồi `npm start` |
| Hằng ngày | Không làm gì, Task Scheduler tự chạy 20:00. Sáng hôm sau xem `logs\scheduler.log` |
| Một shop báo `SESSION_EXPIRED` | `npm run login -- shop2` rồi `npm start -- --shop shop2` |
| Lỡ lịch, đã qua 00:00 | `node runner/run.js --date 2026-10-07` (ngày hôm nay), chỉ tạo được khung giờ chưa bắt đầu |
| Tạo trước cho 2 ngày tới | Chạy hai lần: `--date 2026-10-07` rồi `--date 2026-10-08` |
| Chạy giữa chừng bị lỗi hoặc tắt máy | Chạy lại `npm start`. Script chỉ làm khung giờ còn trống, không tạo trùng |
| Có flash sale RỖNG (0 sản phẩm) sau lần chạy lỗi | Chạy lại cho đúng ngày đó: `node runner/run.js --shop <id> --date <ngày>`, hoặc extension chọn đúng ngày rồi bấm Chạy. Flash sale rỗng được tự xoá rồi tạo lại |
| Log có nhiều `CREATE_REJECTED` | Giảm `parallelSlots` xuống 4 và tăng `staggerMs` lên 800 trong config, rồi `npm start` |
| Máy chậm, RAM thấp | `npm start -- --slots 3 --sequential`, hoặc sửa `parallelSlots` / `parallelShops` trong config |
| Muốn xem script làm từng bước | `node runner/run.js --dry-run --headed --slots 1 --shop shop1` |
| Tạm ngừng một shop | `"enabled": false` cho shop đó trong config |
| Muốn SL khác 15 | Sửa `defaults.qty`, hoặc `overrides.qty` cho riêng một shop |
| Luôn sao chép từ một flash sale cố định | Đặt `templateFlashSaleId` (id lấy từ link `create?from=...`) |
| Shopee đổi giao diện, lỗi `TIMEOUT` hàng loạt | `npm run dry` để xem ảnh chụp, sửa selector trong `extension/fs-engine.js`, chạy `npm test` |
| Cần chạy tay trên máy không có Node | Dùng Chrome extension |

## Đọc log và trạng thái

Mỗi lần chạy ghi vào `logs\<YYYY-MM-DD>\`. Chỉ cần xem bảng TỔNG KẾT; có shop nào khác `OK` thì mở file log của shop đó.

| File | Nội dung |
| --- | --- |
| `<shop>.log` | Log dễ đọc, theo từng khung giờ và từng tab |
| `<shop>.jsonl` | Dữ liệu chi tiết từng lần thử, dùng khi cần gỡ lỗi |
| `summary-HHMMSS.json` | Tổng kết của cả lần chạy |
| `run.log` | Lúc bắt đầu, lúc kết thúc |
| `*.png` | Ảnh chụp màn hình lúc lỗi |
| `logs\scheduler.log` | Đầu ra của các lần Task Scheduler chạy |

**Trạng thái của từng shop**

| Trạng thái | Nghĩa | Cần làm |
| --- | --- | --- |
| `OK` | Ngày đích đủ khung giờ | Không |
| `OK_WITH_ERRORS` | Đủ khung giờ, có lỗi nhưng đã tự xử lý | Xem log nếu muốn |
| `DRY_RUN` | Chạy thử xong, không tạo gì | Không |
| `PARTIAL` | Vẫn còn khung giờ trống | Xem log và ảnh, rồi chạy lại |
| `INCOMPLETE` | Vẫn còn flash sale rỗng (0 sản phẩm bật) sau 2 vòng | Chạy lại cho ngày đó (tự xoá & tạo lại), hoặc xoá tay bằng "Thêm → Xóa" theo id trong log |
| `SESSION_EXPIRED` | Phiên đăng nhập hết hạn | `npm run login -- <id>` |
| `WRONG_SHOP` | Profile đang đăng nhập nhầm shop | Đăng nhập lại đúng shop |
| `CRASH` | Lỗi hệ thống (profile bị khoá, mất mạng…) | Xem log, chạy lại |

**Các dòng log hay gặp**

| Dòng log | Nghĩa |
| --- | --- |
| `[09:00\|tab3] bắt đầu` | Tab 3 bắt đầu làm khung giờ 09:00 |
| `Đã xoá N flash sale RỖNG (0 sản phẩm) để tạo lại` | Dọn flash sale rỗng sót lại từ lần lỗi trước |
| `Bỏ qua 22/120 phân loại bị khoá (hết hàng …)` | Ô tích các phân loại này bị Shopee khoá (thường do tồn kho 0), giống khi bạn làm tay |
| `Tồn kho < 15 → SL=1: M,Trắng (kho 4)=1` | Các phân loại tồn dưới 15 được đặt SL 1 |
| `Báo lỗi khi Bật → đặt SL=1 rồi Bật lại` | Shopee báo lỗi SL (ví dụ "Số lượng kho phải lớn hơn 1 và nhỏ hơn 4."), script hạ về 1 rồi bật lại |
| `Bỏ chọn N dòng không bật được` | Vẫn lỗi dù SL = 1, bỏ chọn để các dòng khác bật được |
| `✔ Đã tạo ... — bật 98/120` | Khung giờ xong, số phân loại đã bật trên tổng (phần còn lại là dòng bị khoá) |
| `Sau vòng 1: … → chạy vòng 2` | Còn flash sale rỗng hoặc khung giờ trống, tự chạy thêm một vòng |
| `Shopee không bật N phân loại (không báo lỗi) → bỏ qua: …` | Shopee giữ các phân loại này ở trạng thái Tắt mà không hiện lỗi trên dòng (ví dụ công tắc bị khoá, không đủ điều kiện). Các phân loại khác vẫn bật bình thường; khung giờ vẫn tính là xong |
| `Shopee đã lưu: bật 95/120 phân loại` | Số phân loại đang bật, đọc trực tiếp từ dữ liệu Shopee đã lưu |
| `Báo lỗi lúc chạy nhưng Shopee đã lưu flash sale có sản phẩm bật → tính là đã tạo` | Bước tổng kết đối chiếu với Shopee: khung giờ này thật ra đã xong |
| `Lỗi CREATE_REJECTED` | Shopee từ chối tạo (ví dụ thao tác quá nhanh) |
| `Slot vẫn trống → thử lại sau Ns` | Sẽ tự thử lại, không cần làm gì |
| `Flash sale RỖNG (0 sản phẩm bật): …` | Sau 2 vòng vẫn còn rỗng; chạy lại cho ngày đó |
| `N slot lỗi liên tiếp → dừng shop này` | Ngắt an toàn; xem ảnh chụp để biết lý do |

## Xử lý sự cố

Hầu hết sự cố chỉ cần sửa một chỗ rồi chạy lại `npm start`. Script không bao giờ tạo trùng.

| Hiện tượng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| `Không thấy ...config\shops.json` | Chưa tạo file cấu hình | `copy config\shops.example.json config\shops.json` |
| `Đang có 1 lần chạy khác (lock ...)` | Một lần chạy khác chưa xong, hoặc lần trước bị tắt ngang | Chờ chạy xong. Chắc chắn không còn chạy thì xoá `logs\.run.lock` |
| `Profile ... đang được mở bởi 1 cửa sổ Chrome khác` | Cửa sổ login hoặc lần chạy trước còn mở | Đóng cửa sổ Chrome của profile đó |
| `SESSION_EXPIRED` | Phiên Shopee hết hạn | `npm run login -- <id>` |
| `WRONG_SHOP` | Profile đang đăng nhập shop khác với lúc login | Đăng nhập lại đúng shop. Nếu cố ý đổi shop cho profile thì xoá `profiles\<id>\shop.json` rồi login lại |
| Nhiều `CREATE_REJECTED`, kết quả `PARTIAL` | Shopee chặn vì tạo quá nhanh | Giảm `parallelSlots` (ví dụ 4), tăng `staggerMs` (ví dụ 800), chạy lại |
| `INCOMPLETE` | Flash sale đã tạo nhưng bị ngắt trước bước Bật, và 2 vòng tự sửa chưa xong | Chạy lại cho ngày đó. Nếu log báo `Không xoá được flash sale rỗng` thì xoá tay bằng "Thêm → Xóa" rồi chạy lại |
| `SELECT_ALL … Chỉ chọn được 98/120 phân loại` | Bản 1.0: mẫu có phân loại hết hàng (ô tích bị khoá) | Đã sửa ở bản 1.1 — cập nhật code, tải lại extension |
| `TIMEOUT … đóng popup khung giờ` (extension) | Bản 1.0: tab nền của Chrome làm popup khung giờ đứng yên | Đã sửa ở bản 1.1 — cập nhật code, tải lại extension; để bật "Mỗi khung giờ 1 cửa sổ riêng" |
| `enable-failed` dù flash sale đã có sản phẩm bật (bản 1.1.0) | Vài phân loại Shopee không cho bật và không báo lỗi; bản cũ đòi 100% phân loại đã chọn phải bật | Đã sửa ở bản 1.1.1 — cập nhật code, tải lại extension. Flash sale đã tạo vẫn dùng được |
| `NO_SELECTABLE` | Flash sale mẫu không còn phân loại nào có hàng | Nhập thêm hàng, hoặc đặt `templateFlashSaleId` sang flash sale khác. Script dừng **trước** khi tạo nên không sinh flash sale rỗng |
| `TEMPLATE_INVALID` | Flash sale mẫu bị xoá trong lúc chạy | Runner tự lấy mẫu mới. Nếu đang ghim `templateFlashSaleId` thì đổi sang id còn tồn tại |
| `TIMEOUT` ở hầu hết khung giờ | Shopee đổi giao diện hoặc mạng chậm | Xem ảnh `.png` trong log. Nếu giao diện đổi thì sửa `SEL` trong `extension/fs-engine.js` |
| Máy đơ, quạt kêu to | 24 tab quá nặng | `--slots 4` hoặc `"parallelShops": 1` |
| Task Scheduler không chạy | Windows chưa đăng nhập, hoặc Node không có trong PATH | `Get-ScheduledTaskInfo -TaskName ShopeeFlashSaleTomorrow`, xem `logs\scheduler.log` |
| Báo không tìm thấy Chrome | Máy chưa cài Google Chrome | Cài Chrome, hoặc `npx playwright install chromium` |
| `npm test` báo thiếu browser | Test dùng Chromium của Playwright | `npx playwright install chromium` |
| Extension không phản hồi | Tab Shopee mở trước khi cài hoặc tải lại extension | Tải lại tab Shopee (F5) rồi bấm Chạy |

Sau khi sửa selector, chạy `npm test` (test trên bản mô phỏng) rồi `npm run dry` trên shop thật trước khi chạy thật.

## Lưu ý an toàn và bảo mật

- Thư mục `profiles\` chứa phiên đăng nhập Shopee của 3 shop. **Không chia sẻ, không đưa lên cloud hay Git** (đã có sẵn trong `.gitignore`).
- Script không lưu mật khẩu và không gửi dữ liệu đi đâu ngoài `banhang.shopee.vn`. Nó gọi trực tiếp các API **đọc** mà chính trang Seller Center vẫn gọi. Thao tác ghi đi qua giao diện, giống bạn tự bấm — trừ một ngoại lệ: xoá flash sale RỖNG (`repairEmpty`) gửi đúng request mà nút "Thêm → Xóa" gửi. Script kiểm tra lại ngay trước khi xoá và chỉ xoá flash sale **0 sản phẩm, chưa diễn ra, đúng ngày đích**. Tắt bằng `"repairEmpty": false` hoặc bỏ tích trong popup.
- Trên Shopee, bấm Xác nhận trong popup chọn khung giờ là **tạo flash sale ngay lập tức**. Dry-run luôn dừng trước bước này nên không bao giờ tạo gì.
- Lần chạy thật đầu tiên với bản 1.1, hãy xem log có `CREATE_REJECTED` hoặc `Không xoá được flash sale rỗng` không.
- Trong lúc script đang chạy, đừng thao tác trên các cửa sổ hoặc tab Chrome mà nó mở.
- Tự động hoá Seller Center có thể không nằm trong phạm vi Điều khoản của Shopee. Về lâu dài, phương án chính thức là Shopee Open Platform API (`v2.shop_flash_sale.*`).

## Thay đổi bản 1.1.1 (07/10/2026, tối)

Sửa báo lỗi nhầm trong log `flashsale-Pear_club-08-10-2026 1.log`: 7 khung giờ báo `enable-failed: Không bật được tất cả phân loại` nhưng cả 7 flash sale đều đã tạo, có 9 sản phẩm bật như mẫu.

| | Bản 1.1.0 | Bản 1.1.1 |
| --- | --- | --- |
| Phân loại Shopee không bật mà không báo lỗi | Bấm Bật lại 5 lần (~40 giây), rồi báo cả khung giờ thất bại và **không bấm Xác nhận** | Sau 2 lần, bỏ chọn các phân loại đó, ghi tên và lý do vào log, rồi bấm Xác nhận như bình thường (~15 giây) |
| Cách xác định "đã bật được" | Đếm công tắc trên giao diện | Đọc dữ liệu Shopee đã lưu (`get_shop_flash_sale_item`): chỉ thất bại khi Shopee lưu **0** phân loại bật |
| Tổng kết | "Tạo mới lần này: 0", trạng thái `OK_WITH_ERRORS` | Đối chiếu từng khung giờ với Shopee; khung giờ thực tế đã có sản phẩm bật thì tính là đã tạo. Kèm số phân loại bật của từng flash sale |

Các flash sale ngày 08/10 tạo bởi bản 1.1.0 vẫn dùng được: sản phẩm đã được lưu ở bước Bật. Bước Xác nhận bị bỏ qua chỉ lưu thứ tự hiển thị sản phẩm.

## Thay đổi bản 1.1 (07/10/2026)

Sửa các lỗi trong log `flashsale-Pear_club-08-10-2026.log` (extension, 8 tab, cả 8 khung giờ ngày 08/10 bị tạo ra nhưng rỗng):

| Lỗi | Nguyên nhân | Đã sửa |
| --- | --- | --- |
| `SELECT_ALL: Chỉ chọn được 98/120 phân loại` (12:00, 15:00, 17:00, 19:00, 21:00) | 22 phân loại tồn kho 0 bị Shopee khoá ô tích; bản cũ đòi chọn đủ 120 và bấm lại ô tổng — bấm lại lại BỎ CHỌN hết | Chọn giống làm tay: chỉ bấm ô tổng một lần, chấp nhận dòng bị khoá, ghi log danh sách bỏ qua |
| `TIMEOUT: đóng popup khung giờ (12000ms)` (00:00, 02:00, 09:00) | Tab nền: Chrome dừng hiệu ứng đóng popup dù flash sale đã tạo | Nhận biết thành công bằng công tắc Bật/Tắt được mở khoá; extension mở mỗi khung giờ trong một cửa sổ hiển thị |
| 8 flash sale rỗng còn lại trên Shopee | Lỗi xảy ra sau khi popup đã tạo flash sale | Tự xoá flash sale rỗng của ngày đích rồi tạo lại (đầu lượt chạy + vòng 2) |
| Dòng tồn kho 4 báo "Số lượng kho phải lớn hơn 1 và nhỏ hơn 4." | SL 15 lớn hơn tồn kho | Mặc định `mode: "one"`: tồn kho dưới 15 đặt SL 1 ngay, rồi mới Bật |
| (phòng ngừa) mẫu không còn phân loại nào có hàng | — | Dừng trước khi tạo (`NO_SELECTABLE`), không sinh flash sale rỗng |

