# Google client cho đồng bộ Drive (người build app làm một lần)

Người dùng chỉ bấm **Settings → Data → Connect Google Drive…** rồi đăng nhập. Phần dưới đây chỉ người build Duckbook làm, một lần, để app có OAuth client của riêng nó.

## Cách app đăng nhập (để đối chiếu khi điền Console)

- Client loại **Desktop app** (installed app). Không có redirect URI trên web: app mở một listener tạm trên `http://127.0.0.1:<cổng ngẫu nhiên>`, dùng PKCE (S256) và `state` ([Google: native apps](https://developers.google.com/identity/protocols/oauth2/native-app)).
- Một scope duy nhất: `https://www.googleapis.com/auth/drive.file`, loại không nhạy cảm ([Google: Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)). Không xin email hay hồ sơ.
- Token lưu ở `sync-google.json` trong thư mục dữ liệu, không nằm trong backup. Sign out sẽ gọi Google để thu hồi token (nếu mất mạng thì bỏ qua bước này) rồi xóa file.
- Không có server Duckbook. Domain chỉ dùng cho trang chủ, chính sách quyền riêng tư và điều khoản.

## Các bước

Project hiện có là `duckbook-513214`, với một client **Desktop app** (file `google-client.json` ở gốc repo). **Dùng lại đúng project và client này**: `drive.file` gắn file trong Drive với client đã tạo ra chúng, nên đổi client thì các máy sẽ không thấy thư mục Duckbook Sync cũ nữa. Chỉ tạo project hoặc client mới khi cố ý chuyển sang client khác.

1. <https://console.cloud.google.com/>, chọn project `duckbook-513214`, kiểm tra **Google Drive API** đã bật.
2. **Clients**: kiểm tra client Desktop app hiện có trùng `client_id` trong `google-client.json`. Chỉ khi chưa có client mới tạo: **Create client → Desktop app**, tải JSON về và lưu thành `google-client.json` ở gốc repo (git bỏ qua file này). Bản web localhost đọc file đó khi server khởi động (restart bằng `Duckbook.cmd`); app desktop nhúng nó lúc build (`npm run desktop:build`).
3. **Xác minh domain** trong [Google Search Console](https://search.google.com/search-console), đăng nhập bằng tài khoản là Owner hoặc Editor của project:
   - Add property → **Domain** → `khoadev.id.vn`.
   - Google đưa ra một bản ghi TXT dạng `google-site-verification=<mã của Google>`. Thêm bản ghi đó vào DNS trên Cloudflare: type `TXT`, name `@`, content là nguyên chuỗi Google đưa.
   - Đợi DNS cập nhật rồi bấm **Verify** trong Search Console. Giữ bản ghi TXT sau khi xác minh xong.
4. **Google Auth Platform → Branding**:
   - App name: `Duckbook`. User support email: `ndkhoa1000@gmail.com`.
   - App logo: tùy chọn. Tải logo lên thì Google xét duyệt trước khi hiện logo.
   - App home page: `https://duckbook.khoadev.id.vn/`
   - Privacy policy: `https://duckbook.khoadev.id.vn/privacy`
   - Terms of service: `https://duckbook.khoadev.id.vn/terms`
   - Authorized domains: `khoadev.id.vn` (đã xác minh ở bước 3).
   - Developer contact email: `ndkhoa1000@gmail.com`.
5. **Data access**: thêm scope `https://www.googleapis.com/auth/drive.file`. Đây không phải scope nhạy cảm hay hạn chế, nên không cần xét duyệt scope.
6. **Audience**: External → **Publish app** để sang **In production**. Khi còn Testing, chỉ email trong danh sách *Test users* đăng nhập được và phải đăng nhập lại sau 7 ngày.
7. Nếu muốn màn hình đăng nhập hiện tên và logo của app thay vì chỉ hiện domain, gửi **brand verification** trong Branding / Verification center. Yêu cầu do Google quy định và có thể thay đổi, nên đọc [Google: brand verification](https://support.google.com/cloud/answer/15549049) trước khi gửi. Trang chủ phải mô tả app và dẫn tới trang privacy, URL privacy phải trùng với URL đã khai trong Console.

Một file `google-client.json` trong thư mục dữ liệu của một máy sẽ được dùng thay cho client nhúng sẵn (dùng khi thử nghiệm).

Gỡ quyền: Settings → Data → Stop syncing → Stop and sign out, hoặc <https://myaccount.google.com/permissions>.

## Trang web công khai

Mã nguồn ở `site/public`. Chạy `npm run site:build`, kết quả nằm ở `site/dist/public` (file tĩnh) và `site/dist/worker.js` (một Cloudflare Worker module chứa sẵn mọi file). Kiểm tra bằng `npm run test:site`. Email liên hệ khai báo trong `site/build.ts`. Trang web không có đăng nhập và không nối tới sổ nào.

Triển khai: Cloudflare Worker `duckbook-public` (do Supervisor đẩy lên), gắn custom domain `duckbook.khoadev.id.vn`. Mã Worker và phiên bản sẽ ghi vào đây sau khi trang đã chạy công khai.
