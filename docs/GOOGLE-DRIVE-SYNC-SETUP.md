# Google client cho đồng bộ Drive (người build app làm một lần)

Người dùng chỉ bấm **Settings → Data → Connect Google Drive…** rồi đăng nhập. Phần dưới đây chỉ người build Duckbook làm, một lần, để app có OAuth client của riêng nó.

1. <https://console.cloud.google.com/>: tạo project, bật **Google Drive API**.
2. **Google Auth Platform**:
   - **Branding**: tên app và email hỗ trợ. **Không tải logo lên**: có logo thì Google bắt xác minh app (cần domain, trang chủ, chính sách quyền riêng tư) trước khi cho chuyển sang Production. Không có logo thì không cần, và hai ô *App domain* / *Authorized domains* để trống được.
   - **Data access**: thêm scope `https://www.googleapis.com/auth/drive.file` (không nhạy cảm).
   - **Audience**: External → **Publish app** để sang **In production**. Khi còn Testing, chỉ email trong danh sách *Test users* đăng nhập được và phải đăng nhập lại sau 7 ngày.
3. **Clients → Create client → Desktop app**, tải JSON về, lưu thành **`google-client.json`** ở thư mục gốc repo (git bỏ qua file này).
   - Bản web localhost đọc file đó khi server khởi động (restart bằng `Duckbook.cmd`).
   - App desktop nhúng nó lúc build (`npm run desktop:build`).

Một file `google-client.json` trong thư mục dữ liệu của một máy sẽ được dùng thay cho client nhúng sẵn (dùng khi thử nghiệm).

Gỡ quyền: Settings → Data → Stop syncing → Stop and sign out, hoặc <https://myaccount.google.com/permissions>.
