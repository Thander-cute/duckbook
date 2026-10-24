# Duckbook: kế hoạch desktop và Android

**Status:** roadmap draft; chỉ slice chuyển web hiện tại thành Electron desktop dưới đây được owner cho phép triển khai. Các slice roadmap 0–8 phía sau vẫn là đề xuất tương lai, không phải prerequisite của desktop conversion.
**Ngày:** 2026-10-25.
**Decision link:** `docs/DECISIONS.md`, Production direction, 2026-10-25.

## Slice hiện tại: web app thành Electron desktop

**Status:** implemented on branch `desktop` (2026-10-25), chờ owner dùng thử; limits ghi ở Done when.
**Decision link:** DECISIONS.md, 2026-10-25, desktop conversion authorization.

**Why (owner):** "làm cái app hiện tại web app thành desktop app được rồi, cái t kêu thì chưa".

**Scope:**
- In: đóng gói web app hiện tại thành Electron desktop; giữ notebook UI và các chức năng đang có; quản lý khởi động/dừng local runtime, cửa sổ, single-instance, local save và cách mở app hằng ngày. Lead chọn chi tiết đóng gói phù hợp với nền hiện tại.
- Out: Android, sync, account/cloud, Google Drive/Calendar, encryption mới, thiết kế lại UI, viết lại kiến trúc vì roadmap tương lai, bắt làm archive format mới hay mobile prototype trước desktop.

**Data impact:** mục tiêu không đổi page shape/key hay định dạng dữ liệu. Lead xác định cách desktop kết nối local storage hiện tại và xử lý vòng đời server an toàn, không tạo hai writer/server tranh chấp hoặc tự thay/migrate dữ liệu thật. Giữ backup, PIN access lock, ảnh, version checks và recovery đang có. Browser-local preferences và legacy localStorage không tự xuất hiện trong Electron profile; không tự chuyển/xóa, phải mô tả hành vi thực tế. Tests dùng synthetic data directory và port riêng, không đọc/query/copy dữ liệu thật hay chạy dev trên 5317.

**Done when:**
- [x] App desktop mở trực tiếp, hiển thị notebook hiện tại; Day/photos/import kiểm tra trong bản đóng gói. Chưa đi tay hết từng chức năng trong Electron; web regression 26 checks dùng cùng UI.
- [x] Khởi động lại app/runtime, mở app lần hai, đóng cửa sổ khi đang save và server cũ được xử lý rõ; không mất acknowledged saves.
- [x] PIN, ảnh, backup/restore và lỗi lưu giữ đúng hành vi hiện tại (cùng server code + tests); request ngoài origin bị chặn trong session.
- [x] Electron renderer cô lập quyền Node; navigation/new windows bị chặn; API cần token của lần chạy (giới hạn, không tuyệt đối với phần mềm cùng user).
- [x] Build/đóng gói chạy trên máy Windows này, PATH không có Node. Chưa chạy installer, chưa thử máy Windows sạch, chưa thử IME tiếng Việt trong Electron.
- [x] typecheck, 19 unit/API tests, 26 browser checks, upgrade, 4 packaged smoke groups, packaged import UI pass. Một lần trong lúc phát triển runtime mở nhầm DB web mặc định rồi dừng vì EADDRINUSE; theo code thì không ghi nội dung (xem handback).
- [x] Không đổi schema/page key; API_LEVEL giữ nguyên.

**Implementation (Lead decisions within this slice, 2026-10-25; branch `desktop`):**
- Windows first. Electron main runs the existing `server/` code in a utility process with Electron's own Node; the window loads the built notebook from a fixed loopback port (not 5317) so browser-local preferences keep one origin. No Node install needed.
- Desktop data lives in its own folder under the app's user data, never `%LOCALAPPDATA%\Duckbook`. The web version and Duckbook.cmd keep working on their own data, so there are never two writers on one database.
- Moving over is explicit: Settings → Data → bring in pages and photos from the browser version. The source is opened read-only, refused while the web server runs, photos verified by hash, desktop pages backed up before replace and read back after. Legacy browser localStorage and browser-local preferences (Paper, Habit marks) do not carry over by themselves.
- Per-launch token injected by the app on every API request; API calls without this launch's token are refused. This raises the bar for other local programs but is not a guarantee against software already running as the same Windows user, which could read app memory or files.
- The browser version's database is only read when the person asks in the app (first-run screen or Settings → Data); startup never looks at it. Renderer: context isolation, sandbox, no Node, navigation and new windows blocked.
- Closing the window flushes pending edits first (`window.duckbookFlush`) and asks before closing with unsaved edits.
- Single instance; unsigned per-user installer plus unpacked build for local use. No auto-update, signing, sync or encryption in this slice.

**Handoff:** existing Claude Lead `e98c461a-9802-4802-912b-f67854dfc7df` phụ trách desktop delivery/frontend. Planning session kết thúc sau cập nhật tài liệu, không khởi động implementation. Sau handoff Lead có thể chỉnh các tài liệu này theo phạm vi đã duyệt. Không cần xin lại phép cho desktop conversion đã được owner cho phép.

## Roadmap tương lai — chưa cho phép triển khai

Các đoạn còn lại ghi lại yêu cầu/recommendation trước khi owner thu hẹp phạm vi. Chúng không mở rộng slice hiện tại và không áp đặt rewrite/storage migration lên desktop conversion.

## Why

**Owner từng nêu hướng tương lai:** chức năng web hiện tại cơ bản đã đủ; tiến tới production, ưu tiên UI/UX; có desktop và Android; dữ liệu riêng tư do người dùng nắm; có thể sync cùng tài khoản, chọn nơi lưu như Google Drive hoặc tự lưu; kết nối Google Calendar. Owner đã chọn Electron + React Native và nói dùng chung code không quan trọng. Các mục này hiện được hoãn ngoài desktop conversion ở trên.

**Agent đề xuất:** Windows trước cho desktop, Android là app độc lập; local-first với SQLite; hoàn thiện offline và recovery trước sync; Calendar đọc trước, ghi sau. Đây là đề xuất, không phải những chi tiết owner đã duyệt. Không đặt thời hạn hay cam kết hiệu năng trước khi đo trên release build.

## Scope

- In: Electron desktop + React, React Native Android, notebook flows hiện có, lưu bền vững, chuyển dữ liệu có kiểm chứng, backup đủ ảnh, thiết kế privacy/recovery, một provider sync đầu tiên, Calendar tùy chọn, đóng gói/phát hành.
- Out: triển khai ngay trong lượt lập plan; marketplace, AI, cộng tác nhiều người, thêm tính năng planner không liên quan; ép chung UI/package/database schema; thay notebook style chưa được đồng ý.
- Windows là phạm vi desktop đề xuất đầu tiên. macOS/Linux/iOS và hosted web editor không nằm trong mốc đầu; cần quyết định riêng nếu muốn bổ sung.
- Web hiện tại tiếp tục hoạt động trong giai đoạn chuyển tiếp. Không mở local server ra Internet hay dùng nó làm server sync.

## Kiến trúc đề xuất

| Thành phần | Quyết định / đề xuất |
|---|---|
| Desktop | **Đã chọn:** Electron + React; TypeScript đề xuất cho implementation |
| Android | **Đã chọn:** React Native; UI native, không nhúng website notebook |
| Local storage | **Đề xuất:** mỗi app có SQLite riêng và vùng lưu ảnh riêng |
| Dùng chung | Tùy chọn; ưu tiên tài liệu định dạng, fixtures và bộ kiểm tra tương thích hơn shared runtime |
| Sync | **Đề xuất:** thay đổi có version, outbox bền vững, mã hóa trước upload |
| Remote | Chưa chọn; một provider ở mốc đầu, không triển khai đồng loạt |
| Calendar | Connector riêng với cache và mapping event/task riêng |
| Tài khoản | Chưa chọn; local-only không cần tài khoản là đề xuất |

```text
Electron / React                          React Native / Android
UI desktop                                UI mobile
    |                                         |
preload API hẹp                            app service / native modules
    |                                         |
storage service                           storage service
SQLite + ảnh + outbox                     SQLite + ảnh + outbox
    |                                         |
sync implementation                       sync implementation
    +------ cùng giao thức / vault -----------+
                       |
               remote đã mã hóa

Mỗi app -> OAuth Google -> Calendar connector (opt-in)
```

**Desktop:** renderer chỉ dựng UI; tắt Node integration, bật context isolation và sandbox, chỉ expose các lệnh nghiệp vụ qua preload. Main process kiểm tra IPC sender/payload, quản lý vòng đời và cửa sổ. Storage/crypto chạy qua service ở utility process hoặc worker thích hợp để thao tác nặng không chặn UI/main. Chỉ tải nội dung app đóng gói; kiểm soát navigation và URL mở ngoài. Không expose SQL tùy ý hay đường dẫn filesystem cho renderer. Đây là thiết kế ứng dụng theo [hướng dẫn bảo mật Electron](https://www.electronjs.org/docs/latest/tutorial/security).

**Android:** navigation và màn hình riêng theo touch; storage native, lifecycle và photo picker của Android. JavaScript không được giả định luôn chạy khi app bị background/kill. Sync lúc mở/resume là đường chính; background là bổ sung best-effort. Native module Kotlin chỉ khi cần API hệ điều hành, không phải một UI app thứ ba.

**Tooling Android đề xuất:** React Native với Expo development build và build Android tại máy/CI của dự án, nếu đáp ứng SQLite, key storage và native worker. Expo là lựa chọn tooling cần xác minh trong slice 0, không phải cam kết dùng cloud/EAS, Expo Go hay OTA updates. React Native khuyến nghị framework cho app mới nhưng vẫn cho phép setup không framework. [React Native setup](https://reactnative.dev/docs/environment-setup).

**SQLite binding:** chọn trong slice 0 bằng release-build test về transaction, khóa DB, encryption, backup và native packaging. `expo-sqlite` là candidate Android; binding desktop phải tương thích Electron runtime. Không giả định `node:sqlite` của Node hệ thống sẽ chạy y nguyên trong Electron. Nếu dùng native addon, kiểm tra ABI/rebuild trong installer thực tế. [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/), [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules).

Không tạo shared package chỉ để chia sẻ vài type. Có thể bắt đầu hai thư mục app độc lập cùng repository, giữ web ở vị trí cũ; mỗi app có build riêng. Thứ bắt buộc khớp là ý nghĩa dữ liệu, archive format và sync protocol, không phải cấu trúc thư mục hay bảng SQLite giống nhau.

## UI/UX mục tiêu

Giữ màu giấy, typography, mực, logo và tính chất notebook. Mọi thay đổi đáng kể về layout/behavior phải được review bằng prototype trước khi code production.

| Flow | Desktop | Android đề xuất |
|---|---|---|
| Day | Notebook rộng, keyboard navigation | Một cột, ghi nhanh, ô nhập luôn thấy khi bật bàn phím |
| Week | Giữ matrix/habit và liên kết task | Chuyển section rõ ràng, không thu nhỏ cả spread vào điện thoại |
| Month | Calendar, ghi chú range và photo marks | Calendar + phần chi tiết ngày; tạo range bằng chọn đầu/cuối |
| Focus | Canvas và drag bằng chuột | Canvas có zoom/pan và cách chọn/chuyển note không cần kéo chính xác; list là phương án cần review |
| Reflect | Đọc/viết dài bằng bàn phím | Cuộn đọc thoải mái, giữ vị trí và text selection |
| Settings | Data, Privacy, Add-ons rõ trạng thái | Kết nối/recovery có hướng dẫn ngắn, không bắt đăng nhập để viết local |

Ghi nhận baseline hiệu năng bằng notebook synthetic nhiều năm và ảnh mẫu. Đo cold start, mở Day/Week/Month, typing/IME, cuộn và memory ở release build trên một Windows máy mục tiêu và một Android tầm trung; đặt ngân sách sau baseline ở slice 0. Không dùng con số desktop để suy ra mobile.

## Data impact và privacy

**Lượt lập plan:** không đổi schema, API_LEVEL, persistence hay dữ liệu. Những thay đổi sau đây chỉ là thiết kế cho các slice tương lai.

- App mới dùng data directory riêng khi thử nghiệm; không tự mở DB thật của bản web. Chuyển qua archive do owner chủ động xuất/chọn; agent chỉ test synthetic.
- Archive có manifest/version, documents, toàn bộ ảnh và checksum; bản encrypted bổ sung xác thực mật mã. JSON cũ thiếu ảnh phải báo rõ, không giả vờ import đầy đủ.
- Import vào staging, kiểm tra trước, backup đích trước replace, commit rồi read-back verify; thất bại giữ bản nguồn và recovery path. Không xóa dữ liệu cũ hay browser copy tự động.
- Kiểm tra archive chống path traversal, file quá lớn, manifest hỏng và phiên bản chưa hỗ trợ; không restore nửa bộ rồi báo thành công.
- Local save phải xác nhận sau durable transaction. Pending edit không chỉ nằm trong React state khi hiện “Saved”. Khi có sync, state và outbox commit cùng transaction.
- Backup độc lập với sync: xóa/lỗi sync không được đồng thời xóa mọi bản phục hồi. Retention và cleanup ảnh phải tính cả backup còn giữ.
- PIN hiện tại là khóa truy cập. Đề xuất production có encryption cho vault local, ảnh, archive và remote; chốt phạm vi encryption trước phát hành public. Bản offline thử nghiệm plaintext phải mô tả đúng giới hạn.
- Recovery secret/pairing bảo vệ vault key; không lấy PIN sáu số làm khóa cloud. OS key storage bảo vệ khóa trên thiết bị nhưng không thay backup/recovery. Android uninstall/restore có thể mất khóa: cần kiểm tra khôi phục sạch, không chỉ reopen app. [SecureStore lifecycle](https://docs.expo.dev/versions/latest/sdk/securestore/).
- Mất mọi thiết bị và recovery secret thì không thể hứa khôi phục E2EE. Reset tài khoản và giải mã dữ liệu là hai việc khác nhau.
- Không log nội dung planner/token/key; không bật analytics, AI, crash upload hoặc tự động backup Android chứa plaintext. Cấu hình OS backup phải phù hợp key lifecycle và lựa chọn user.
- Một thiết bị đã sao chép nội dung không thể bị “xóa từ xa” chỉ bằng revoke. Thiết kế revoke/rotate phải nêu rõ bảo vệ các thay đổi tương lai tới đâu.

## Sync và account

**Đề xuất ban đầu:** tài khoản storage xác định nơi lưu; vault ID xác định notebook; key/recovery xác định quyền giải mã. Không bắt xây account backend Duckbook trước khi có lý do sản phẩm. Nếu chọn managed relay thì phải plan account lifecycle và metadata riêng.

**Lựa chọn provider cần chốt trước slice 5:**

| Provider | Phù hợp khi | Điều cần giải quyết |
|---|---|---|
| Google Drive của user | Muốn kết nối quen thuộc và user sở hữu dung lượng | OAuth/scopes, semantics đồng thời và use case được phép |
| Một endpoint WebDAV tự host | Ưu tiên tự giữ nơi lưu, chấp nhận setup | URL/credentials, HTTPS, tính nhất quán và hành vi server cụ thể |
| Relay mã hóa do Duckbook vận hành | Ưu tiên onboarding đơn giản | Account, chi phí vận hành, metadata và availability |

Ưu tiên khảo sát Drive theo mong muốn user; không lấy việc chưa chốt Drive làm lý do chặn offline apps. Drive API terms có điều khoản cần đồng ý trước bằng văn bản cho backup app/user content; xác minh use case chính xác trước khi phát hành integration, không đổi tên backup thành sync để coi như đã giải quyết. [Drive API terms](https://developers.google.com/workspace/drive/api/terms). Research này không kết luận mọi document-sync đều bị cấm.

Sync protocol v1 đề xuất cần có: IDs ổn định, causal/base versions, batches nguyên tử, retry idempotent, tombstones, schema/protocol version gates và attachment references. Không đồng bộ file SQLite đang mở; không dùng timestamp máy làm thứ tự quyết định duy nhất.

Sửa khác trường/item có thể merge khi an toàn; cùng journal text thì giữ cả hai bản. Delete/edit conflict phải phục hồi được. Move task giữa Focus/Week/Day phải giữ một work item nhất quán. Old client gặp dữ liệu mới không được normalize rồi ghi mất field.

Remote chỉ nhận ciphertext và metadata tối thiểu; ảnh upload/verify trước khi publish commit tham chiếu. Chỉ clear outbox khi xác nhận remote đã nhận bền vững; apply vào local rồi mới advance cursor. Checkpoint/cleanup không được bỏ thay đổi thiết bị offline chưa xử lý. Restore cần một nhánh/vault mới hoặc transition được sync hiểu, không reset revision tùy tiện.

UX phải phân biệt: saved locally, syncing, synced, offline, needs attention. Đổi account không tự merge hai vault; disconnect giữ local copy và nói rõ dữ liệu remote có được giữ hay xóa.

## Google Calendar

Đề xuất đọc lịch user chọn trước; ghi event chỉ qua thao tác “Schedule” rõ ràng. Dùng calendar Duckbook riêng cho time blocks, giữ task/event mapping riêng với nội dung journal. Đánh dấu task done không tự xóa event; xóa event không tự xóa task.

OAuth qua system browser/native authorization phù hợp, token lưu tại thiết bị. Xin read scope lúc connect và write scope lúc bật publishing; xác minh requirements trước public release. `calendar.app.created` là candidate cho app-created calendar. [Google OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).

Cache Calendar tách riêng. Dùng incremental sync; HTTP 410 rebuild cache, không xóa notebook hay outbound intent. Kiểm tra all-day, timezone/DST, recurring exceptions, remote delete/edit và retry event-create không trùng. [Calendar incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync).

Nội dung event gửi Google không nằm trong bảo đảm E2EE notebook; preview trường sẽ gửi và cho dùng title chung. Không xuất journal/reflection/photos sang Calendar tự động. Sync khi mở/resume trước; push webhook là slice riêng nếu thật sự cần backend.

## Slice 0: UX và tính khả thi kỹ thuật

**Status:** draft. **Decision link:** stack đã chọn; scope prototype needs agreement.

**Why:** owner ưu tiên UI/UX và giải pháp phù hợp. Agent đề xuất kiểm chứng các điểm có thể đổi implementation trước khi làm toàn app.

**Scope:** prototype Day/Week trên Electron và RN; Vietnamese IME/selection, keyboard, ảnh, resize, Back/resume, một local transaction và restore synthetic. Chốt tooling, SQLite/crypto candidates và metric budgets. Không so sánh framework đã bỏ, không sync production hay dùng tài khoản thật.

**Data impact:** chỉ fixture và data dir tạm; không migration dữ liệu thật.

**Done when:**
- [ ] Owner review notebook desktop và mobile flow qua prototype.
- [ ] Release build Windows/Android ghi-mở lại được dữ liệu synthetic; force-kill sau acknowledged save không mất edit.
- [ ] Có kết quả IME, keyboard, ảnh, baseline hiệu năng và dependency compatibility; ghi rõ điểm chưa đạt.
- [ ] Build Electron và Android local được; chọn SQLite/encryption route có bằng chứng khả thi.
- [ ] Existing pages/data unaffected; web typecheck/build pass nếu chạm tooling chung; UI desktop kiểm tra trong renderer, Android trên thiết bị thật.

## Slice 1: Archive và nền tảng tương thích dữ liệu

**Status:** draft. **Decision link:** needs decision. **Depends on:** slice 0.

**Why:** chuyển từ web sang app phải mang đủ notebook và ảnh, khôi phục độc lập.

**Scope:** đặc tả archive/version, synthetic fixtures, importer/exporter, migration preview, backup/verify/rollback. Bổ sung đường export đầy đủ cho web nếu được duyệt. Out: sync, tự đọc DB thật, đổi planner behavior.

**Data impact:** format mới; schema local từng app có thể khác. Giữ legacy JSON import với cảnh báo ảnh thiếu. Bump API_LEVEL nếu thay page shape/key shared.

**Done when:**
- [ ] Export -> import vào đích sạch khớp documents và bytes ảnh; archive hỏng/phiên bản mới bị từ chối rõ ràng.
- [ ] Import thất bại không mất dữ liệu đích; có backup trước replace và verify sau write.
- [ ] Fixture chung kiểm tra cùng ý nghĩa dữ liệu ở cả hai app, không yêu cầu cùng source code.
- [ ] Existing data unaffected; typecheck/build, persistence tests và browser flow pass khi thay web; test:upgrade nếu thay schema.

## Slice 2: Desktop offline dùng hằng ngày

**Status:** draft. **Decision link:** Electron đã chọn; scope implementation needs agreement. **Depends on:** 0, 1.

**Why:** thay launcher/browser bằng app desktop hoàn chỉnh, giữ notebook experience.

**Scope:** Day/Week/Month/Focus/Reflect/Settings hiện có, ảnh, timer, lock, local saves, backup/restore; installer thử nghiệm; single-instance và window lifecycle. Không thêm planner feature hoặc cloud connection.

**Data impact:** app directory riêng, import chủ động; không cho web và Electron cùng ghi DB cũ. Dùng code cũ nếu có ích nhưng không là tiêu chí nghiệm thu.

**Done when:**
- [ ] Feature checklist hiện có đạt; timer phục hồi theo thời gian, không phụ thuộc setInterval còn chạy khi suspend.
- [ ] Restart/crash/close khi đang save báo đúng trạng thái và không mất acknowledged edits.
- [ ] IPC kiểm tra quyền/input; renderer không có quyền Node/filesystem trực tiếp.
- [ ] Installer chạy trên Windows sạch không yêu cầu Node cài sẵn; backup/recovery thử trên profile synthetic.
- [ ] Desktop UI kiểm tra thật; typecheck/build, test phù hợp và web regression nếu ảnh hưởng web; dữ liệu cũ nguyên vẹn.

## Slice 3: Android offline dùng hằng ngày

**Status:** draft. **Decision link:** React Native đã chọn; mobile layout needs agreement. **Depends on:** 0, 1; có thể chạy song song slice 2.

**Why:** trải nghiệm trên điện thoại phải phù hợp touch, không thu nhỏ desktop.

**Scope:** các planner flows hiện có với layout được duyệt, local DB/ảnh, archive, lock, lifecycle, timer. Day/Week là vertical slice đầu, rồi Month/Focus/Reflect/Settings. Không coi subset này là parity hoàn tất; không yêu cầu background sync ở đây.

**Data impact:** Android app-private storage; cùng archive semantics, không cần cùng DB schema desktop.

**Done when:**
- [ ] UI native trên thiết bị thật: IME tiếng Việt, keyboard, selection, Back, font scale và action không cần hover.
- [ ] Cold start, offline, force-stop, process recreation, permission denied và hết dung lượng đều có kết quả rõ.
- [ ] Import/restore archive của desktop khớp notebook và ảnh; ảnh cũ không bị xóa khi hủy thao tác.
- [ ] Release APK build/install được; test domain/storage và native flows pass; dữ liệu/app web không đổi.

## Slice 4: Vault mã hóa và recovery

**Status:** draft. **Decision link:** needs decision. **Depends on:** 1 và storage foundations của 2/3.

**Why:** privacy cần bao gồm key lifecycle và recovery, không chỉ màn PIN.

**Scope:** threat model được duyệt; crypto format dùng thư viện chuẩn; encrypted local DB/ảnh/archive, OS key protection, recovery/thiết bị mới. Chốt khóa tự động và plaintext cache/temp cleanup. Out: tự viết crypto primitives, hứa chống malware trên thiết bị đã unlock.

**Data impact:** migration plaintext -> encrypted tạo bản mới, verify trước khi owner quyết định xử lý bản cũ. Không hứa secure erase; backup cũ có thể vẫn plaintext.

**Done when:**
- [ ] Recovery từ archive trên thiết bị sạch không phụ thuộc key của máy cũ.
- [ ] Key sai/tampering/interruption thất bại rõ; dữ liệu nguồn và recovery path còn nguyên.
- [ ] Khóa che nội dung và chặn đọc qua service; PIN không được mô tả là encryption secret.
- [ ] Cross-client crypto fixtures, native builds và tests pass; rà soát secrets/log/temp/OS backup theo threat model.

## Slice 5: Sync hai thiết bị qua một provider

**Status:** draft. **Decision link:** account/provider/protocol needs decision. **Depends on:** 2, 3, 4.

**Why:** cùng notebook dùng trên desktop/điện thoại, vẫn viết được khi offline.

**Scope:** một provider được chọn, onboarding/connect, recovery/pairing, outbox, merge/conflict UI, ảnh, reconnect/revoke, version gates. Out: collaboration, nhiều provider cùng lúc, realtime guarantee.

**Data impact:** IDs/version/causal metadata và outbox local; remote ciphertext. Phải plan migration field cụ thể trước implementation.

**Done when:**
- [ ] Hai máy cùng sửa offline rồi reconnect: giữ mọi edit hoặc hiện conflict có thể phục hồi.
- [ ] Retry/duplicate/reordered delivery không nhân task; move Focus/Week/Day giữ invariant.
- [ ] Delete/edit, clock skew, quota full, revoked token, missing photo, interrupted upload và old client được kiểm tra.
- [ ] Restore + sync không làm hồi sinh/xóa dữ liệu ngoài ý muốn; delayed device không mất update sau compaction.
- [ ] UI phân biệt local/sync; tests bằng tài khoản/endpoint test và dữ liệu synthetic; cả hai release builds pass.

## Slice 6: Google Calendar đọc

**Status:** draft. **Decision link:** needs decision. **Depends on:** app foundations; không phụ thuộc chọn sync provider.

**Scope:** OAuth opt-in, chọn calendars, cache, Day/Week overlay, refresh/disconnect. Out: ghi event và xuất nội dung planner.

**Data impact:** cache/tokens riêng; không biến events thành notebook tasks tự động.

**Done when:**
- [ ] Scope đúng flow; token refresh/revoke và disconnect không xóa notebook.
- [ ] Recurrence/timezone/DST/all-day fixtures và 410 resync đạt.
- [ ] Offline cache có trạng thái cập nhật; UI/build/test hai app pass với dữ liệu test.

## Slice 7: Google Calendar time blocks

**Status:** draft. **Decision link:** needs decision. **Depends on:** 6; nếu nhiều thiết bị publish, cần cơ chế mapping tương thích slice 5.

**Scope:** explicit Schedule, preview, app-created calendar, task-event mapping, edit/delete policy. Out: auto-export journal, tự mời người khác.

**Data impact:** mapping ID/version và durable outgoing intent; quy định quyền ghi giữa hai thiết bị để không tạo trùng.

**Done when:**
- [ ] Retry hoặc hai thiết bị xử lý cùng intent không nhân event; external edit không bị ghi đè im lặng.
- [ ] Completion/event deletion có semantics được duyệt; event payload không lộ journal.
- [ ] Narrow scopes/consent và native UI được kiểm tra; cả hai build và integration tests pass.

## Slice 8: Phát hành production

**Status:** draft. **Decision link:** release audience/distribution needs decision. **Depends on:** các slice thuộc release đã chọn.

**Scope:** signed desktop installer và update artifacts; Android signing/distribution; compatibility gates, upgrade recovery, privacy/help docs, opt-in diagnostics nếu duyệt. Offline preview có thể ra sau 2/3; bản sync production cần 4/5. Calendar optional, không phải blocker cho offline/sync release.

**Data impact:** migration có backup; down-version không được ghi phá schema mới. Rollback executable không tự động rollback database.

**Done when:**
- [ ] Install/update bị ngắt, phiên bản cũ gặp DB/protocol mới, uninstall/reinstall và clean-device restore được thử với fixture.
- [ ] Signing keys có quy trình giữ/phục hồi; updater xác thực artifact; không silently enable remote code updates Android.
- [ ] Chính sách privacy đúng chức năng đang ship; account disconnect/delete và remote retention được giải thích rõ.
- [ ] Đạt ngân sách hiệu năng slice 0, native release checks; existing typecheck/build/test/browser/upgrade chạy khi liên quan.

## Điều kiện chung và bước kế tiếp

Mọi slice ở trên là draft. Sau khi owner đồng ý slice cụ thể mới viết code; chi tiết UI chưa rõ cần prototype review trong slice 0. Đây là yêu cầu working agreement, không yêu cầu duyệt lại stack đã chốt. [Mẫu slice](../templates/slice-plan.md).

Tests dùng synthetic fixtures và server tạm qua DUCKBOOK_DATA_DIR/DUCKBOOK_PORT; không dùng port 5317, không đọc/copy/query `%LOCALAPPDATA%\Duckbook` thật. Thay page shape/key trong `schema.ts` phải bump API_LEVEL; update instructions phải có restart server và chạy test:upgrade. Không coi docs-only plan là đã test app.

Đề xuất bắt đầu **slice 0**, tiếp theo **slice 1**, rồi **2 và 3 độc lập/song song**. Chốt privacy trước slice 4, provider/account trước slice 5, Calendar semantics trước 6/7. Không cần quyết định hết các mục này mới làm prototype offline.

Những lựa chọn cần owner quyết định theo thời điểm: Windows-only cho desktop đầu tiên; UX mobile; phạm vi mã hóa và recovery; provider/account; Calendar đọc-only hay thêm time blocks; audience và kênh phát hành. Chúng không được tự động chuyển sang Decided khi plan này được tạo.
