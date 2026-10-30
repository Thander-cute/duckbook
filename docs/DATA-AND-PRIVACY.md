# Dữ liệu và quyền riêng tư

## Dữ liệu nằm ở đâu

| Thứ | Vị trí |
|---|---|
| Các trang sổ | `%LOCALAPPDATA%\Duckbook\duckbook.sqlite` (ví dụ `C:\Users\<bạn>\AppData\Local\Duckbook`) |
| Bản sao lưu | `%LOCALAPPDATA%\Duckbook\backups\*.sqlite` |
| Ảnh của ngày | `%LOCALAPPDATA%\Duckbook\photos\*.jpg`. Mỗi ảnh là một file JPEG đã thu nhỏ, tên file là mã băm nội dung. Trang ngày chỉ ghi tên file. |
| Nhật ký server | `%LOCALAPPDATA%\Duckbook\logs\server.log`. Chỉ ghi sự kiện (khởi động, backup, import), không ghi nội dung sổ. |
| Bản cũ trong trình duyệt | `localStorage['duckbook:v1']` của `http://localhost:5317`. Chỉ đọc. Bản này chỉ bị xóa khi bạn tự bấm "Remove old copy", và nút đó chỉ hiện ra sau khi dữ liệu đã chuyển sang database và được xác minh khớp. |

Không có gì được gửi ra ngoài máy. Server chỉ nghe trên `127.0.0.1` và `::1`. Không có tài khoản, không đồng bộ, không telemetry, không AI. Font chữ được đóng gói sẵn trong app, không tải từ mạng.

## Ghi dữ liệu

- Mỗi trang (tháng, tuần, ngày, cài đặt) là một dòng trong SQLite. Dòng nào cũng có số revision tăng dần, không bao giờ dùng lại.
- Lúc lưu, server kiểm tra revision. Nếu tab khác đã sửa cùng trang thì server từ chối và báo xung đột. Không có chuyện ghi đè trong im lặng.
- SQLite chạy chế độ WAL với `synchronous=FULL`: lần lưu nào đã được xác nhận thì vẫn còn sau khi mất điện hoặc tắt ngang tiến trình. Test đã kiểm tra bằng cách giết server giữa lúc đang ghi.
- Lưu thất bại thì app báo rõ ("Not saved…") và tự thử lại.

## Sao lưu

- Tự động sao lưu mỗi khoảng 4 giờ nếu có thay đổi, lúc khởi động, và luôn sao lưu trước khi import hoặc restore.
- Mỗi bản sao lưu được kiểm tra ngay sau khi tạo: chạy `integrity_check` của SQLite và so mã băm nội dung. Bản nào không đạt sẽ bị bỏ, không lưu lại.
- Giữ 30 bản tự động và 20 bản thủ công hoặc trước thao tác. Restore nằm trong Settings → Backups. Trước khi restore, app sao lưu trang hiện tại, và sau khi restore thì xác minh lại nội dung.
- **Ảnh không nằm trong file sao lưu `.sqlite`.** File ảnh chỉ có một bản trong thư mục `photos` và được giữ lại chừng nào trang hiện tại *hoặc* bất kỳ bản sao lưu nào còn trỏ tới nó. Vì vậy restore bản nào cũng có đủ ảnh. Gỡ ảnh khỏi một ngày không xóa file ngay; server chỉ dọn file khi không còn trang hay bản sao lưu nào cần tới (và file đã cũ hơn một ngày).
- **Giới hạn:** bản sao lưu nằm trên cùng ổ đĩa với dữ liệu. Nếu hỏng hoặc mất ổ, mất máy, thì mất cả hai. Hãy thỉnh thoảng chép thư mục `backups` **và** `photos` ra nơi khác (USB, ổ ngoài). App chưa tự làm việc này.

## Khóa PIN: làm được gì và không làm được gì

Khóa PIN là tùy chọn, bật trong Settings → Privacy lock: 6 chữ số, tự khóa sau một khoảng không dùng, hoặc bấm biểu tượng ổ khóa, hoặc phím `L`.

**Làm được:**
- Che toàn bộ nội dung: khi khóa, app gỡ hẳn các trang khỏi trang web, không chỉ phủ lớp mờ lên trên. Tiêu đề tab cũng không còn tên task.
- Server từ chối mọi yêu cầu đọc, ghi, sao lưu hoặc xuất dữ liệu khi chưa nhập đúng PIN, kể cả ảnh.
- Ảnh được tab giữ trong bộ nhớ (không lưu vào cache của trình duyệt), và bị xóa khỏi bộ nhớ ngay khi khóa.
- Sai 5 lần thì phải chờ, thời gian chờ tăng dần đến 15 phút.
- Khởi động lại server thì app khóa lại.
- Trang web khác mở trong trình duyệt không gửi được yêu cầu tới server này: server kiểm tra Host, Origin và một header riêng của app.

**Không làm được:**
- **Không mã hóa.** Người hoặc chương trình nào mở được file trong tài khoản Windows của bạn vẫn đọc được `duckbook.sqlite`, các bản sao lưu, thư mục ảnh và file export. Điều này bao gồm cả các AI agent có quyền đọc ổ đĩa.
- Không chống được ai đó đang dùng chính tab đã mở khóa, hoặc người có toàn quyền trên máy.
- Mã PIN 6 số chỉ là khóa nhanh, không thay được mật khẩu Windows hay mã hóa ổ đĩa (BitLocker hoặc Device Encryption). Muốn bảo vệ khi mất máy thì nên bật mã hóa ổ đĩa của Windows.

Mã hóa dữ liệu trên ổ đĩa đang được để ngỏ, chưa làm (xem `docs/DECISIONS.md`).

## Export và import

- **Export JSON** tạo một file văn bản đọc được, không mã hóa. Hãy cất ở nơi riêng tư.
- File export **không chứa ảnh**, chỉ chứa tên file ảnh. Nhập file đó trên máy khác thì ô ảnh hiện "Not on this computer". Muốn mang ảnh theo thì chép cả thư mục `photos`.
- **Import** kiểm tra dữ liệu trước khi nhập. File không phải dữ liệu duckbook bị từ chối. Giá trị nào lạ sẽ được để riêng, không bị bỏ đi. Trước khi thay thế trang hiện tại, app luôn sao lưu.

## Đồng bộ qua Google Drive (không mã hóa)

- Chỉ chạy khi bạn kết nối trong Settings → Data. Bạn tự tạo OAuth client; xem [hướng dẫn thiết lập](GOOGLE-DRIVE-SYNC-SETUP.md). Không có server Duckbook: mỗi máy nói chuyện thẳng với Google Drive.
- **Không mã hóa.** Mọi trang (nhật ký, task, reflection…) và ảnh của ngày được lưu thành file đọc được trong thư mục **"Duckbook Sync"** trên Drive của bạn. Google và bất kỳ ai vào được tài khoản Google đó đọc được chúng. Bản có mã hóa (mã khôi phục) sẽ làm sau.
- Quyền xin là `drive.file`: app chỉ thấy các file chính nó tạo, không đọc phần còn lại của Drive.
- Mỗi máy chỉ tạo file của riêng nó (`ops-<máy>-<số>.json`, `photo-<hash>.jpg`) và không sửa hay xóa file của máy khác. File SQLite đang dùng không bao giờ được đặt lên Drive.
- Token nằm trong **`sync-google.json`** cạnh notebook, dạng văn bản rõ, không nằm trong `duckbook.sqlite` hay các bản sao lưu. Khóa PIN không mã hóa file này.
- Lưu trên máy không chờ mạng. Sync chạy nền: vài giây sau khi lưu, khi quay lại cửa sổ, và mỗi phút. Lỗi (mất mạng, hết quyền, file hỏng) hiện trong Settings → Data; file hỏng không được áp dụng.
- **Dùng notebook từ Drive** thay toàn bộ trang trên máy này, sau một bản sao lưu đã kiểm tra ("Before taking the Drive notebook"). **Gộp cả hai** giữ trang của cả hai bên; ô nào hai bên có chữ khác nhau thì giữ cả hai đoạn, nối tiếp nhau.
- **Stop syncing** giữ nguyên trang trên máy và file trên Drive. **Sign out** thu hồi token tại Google rồi xóa `sync-google.json`. Không có gì trên Drive bị xóa; muốn xóa thì tự xóa thư mục "Duckbook Sync".
