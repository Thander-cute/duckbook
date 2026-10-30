# Thiết lập đồng bộ Google Drive

Duckbook chưa phải app đã đăng ký với Google, nên bạn tự tạo một OAuth client, làm một lần. Mọi máy dùng **cùng một** client: với quyền `drive.file`, client nào tạo file thì chỉ client đó thấy.

1. Vào <https://console.cloud.google.com/>, tạo project (ví dụ `duckbook`).
2. **APIs & Services → Library**: bật **Google Drive API**.
3. **Google Auth Platform** (OAuth consent screen):
   - Branding: tên app, email hỗ trợ.
   - Audience: **External**. Rồi bấm **Publish app** để chuyển sang **In production**. Nếu để ở Testing, Google bắt đăng nhập lại sau 7 ngày và sync sẽ ngừng.
   - Data access: thêm scope `https://www.googleapis.com/auth/drive.file`.
4. **Clients → Create client → Desktop app**, rồi tải file JSON về.
5. Lưu file đó với tên **`google-client.json`** vào thư mục dữ liệu trên **mỗi** máy:
   - bản web (localhost): `%LOCALAPPDATA%\Duckbook`
   - app desktop: `%APPDATA%\duckbook\notebook`
6. Mở Duckbook → Settings → Data → **Connect Google Drive…**, đăng nhập trong trình duyệt.
   - Máy đầu tiên: **Start syncing this notebook**.
   - Máy sau: **Use the notebook from Drive** (trang trên máy này được sao lưu trước) hoặc **Merge both…**.

Google có thể hiện cảnh báo "app chưa được xác minh" vì đây là client riêng của bạn; chọn tiếp tục nếu đúng là project của bạn.

Gỡ quyền bất cứ lúc nào: Settings → Data → Stop syncing → Stop and sign out, hoặc trong <https://myaccount.google.com/permissions>.
