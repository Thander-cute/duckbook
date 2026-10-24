# Duckbook: biến *The Present Day Planner* thành web app

> Phân tích gốc (2026-10-19). Những gì đã quyết định sau đó nằm ở [docs/DECISIONS.md](docs/DECISIONS.md); cấu trúc dữ liệu thật nằm ở `src/lib/schema.ts`.

## 1. Cuốn sách làm đúng điều gì

*The Present Day Planner* (Chi Nguyễn, The Present Writer) không chỉ là một cuốn sổ có bảng biểu. Nó là **một nhịp sống được thiết kế sẵn**:

| Bước | Trang | Phương pháp | Câu hỏi người dùng tự trả lời |
|---|---|---|---|
| 1 | Monthly planning | Chủ đề tháng + 3 mục tiêu + lịch + mood tracker | Tháng này mình muốn trở thành gì? |
| 2 | Weekly notes | Viết tự do (brain dump) | Tuần này có những gì? |
| 3 | Weekly planning | Ma trận Eisenhower A/B/C/D + habit tracker | Việc nào quan trọng, việc nào gấp? |
| 4 | Daily planning | Biết ơn + Pomodoro + ghi chú + một câu tổng kết | Hôm nay làm gì, mất bao nhiêu "quả cà chua"? |
| 5 | Weekly reflection | Check-in / Success / Lesson / Future | Tuần này mình thế nào, tuần sau cải thiện gì? |

Triết lý cốt lõi (theo trang giới thiệu sách):
- **Cân bằng, không ép năng suất.** Tác giả không chấm điểm năng suất và không cổ vũ kiểu "hustle".
- **Lập kế hoạch thực tế** để tránh kỳ vọng quá cao rồi kiệt sức. Trang daily chỉ có khoảng 5 dòng task.
- **Công việc và đời sống liên quan với nhau:** biết ơn, thói quen, self-care và phản tư nằm cạnh to-do.
- **Không ghi sẵn ngày:** bắt đầu lúc nào cũng được, bỏ một ngày không sao.
- **Thiết kế tối giản:** ô vừa đủ cho mục đích, mực xanh nhạt, chữ serif, nhiều khoảng trắng, nền dot-grid.

## 2. Giấy làm tốt gì, app làm tốt hơn ở đâu

**Giữ nguyên từ giấy (đây là linh hồn của sản phẩm):**
- Bố cục **trang đôi (spread)**. Màn hình desktop ngang rất hợp với hai trang sổ mở ra.
- Nhịp 5 bước, đúng thứ tự và đúng tên.
- Cảm giác "viết": chữ serif, nét mực navy trên giấy trắng, đường kẻ xanh nhạt, dot grid. Có tùy chọn font viết tay.
- Giới hạn có chủ đích: 3 mục tiêu tháng, khoảng 5 task mỗi ngày, 10 vòng pomodoro.

**Thêm những gì giấy không làm được (nhưng không thêm tiếng ồn):**
1. **Các trang nối với nhau.** Task brain dump ở Weekly notes được kéo vào ma trận. Task A/B trong tuần được đưa vào Today chỉ bằng một click. Tick xong ở Today thì ma trận cũng tick theo.
2. **Pomodoro thật.** Bấm ▶ cạnh task để chạy 25 phút; xong một phiên thì một vòng tròn tự tô. Vẫn là "vòng tròn tô mực" như trong sách, không phải đồng hồ đếm phức tạp.
3. **Reflection có dữ liệu.** Trang phản tư hiện lại 7 câu "My day in one sentence" của tuần, các task đã xong, habit, và chủ đề + mục tiêu tháng. Như vậy bước "Review the monthly pages" trở thành việc nhìn thấy được, không chỉ là một ô tick.
4. **Lịch tháng ↔ ngày.** Ghi chú ô lịch hiện lại trên trang ngày tương ứng. Lịch tháng cũng liệt kê "biggest goal" của từng tuần.

**Cố ý không làm** (giữ đúng tinh thần sách):
- Không streak, không điểm số, không badge đỏ "quá hạn", không thông báo thúc ép.
- Không tag, project, priority 1–4: ma trận Eisenhower là đủ.
- Không đăng nhập. Dữ liệu nằm trên máy, xuất/nhập được bằng JSON.

## 3. Nguyên tắc UX

1. **Mở app là đang ở "Today".** Đó là trang dùng nhiều nhất.
2. **Không có nút "Lưu".** Gõ là lưu.
3. **Mọi chỗ trống đều là chỗ để viết.** Không form, không modal để nhập liệu.
4. **Một màn = một spread.** Trang trái là việc chính, trang phải là ngữ cảnh hỗ trợ.
5. **Dùng hoàn toàn được bằng bàn phím:** `← →` lùi/tiến, `T` về hôm nay, `M W D R` chuyển trang.
6. **Chữ nhỏ dịu dàng thay cho cảnh báo.** Ví dụ khi thêm task thứ 6: "Five is plenty. Still add another?"

## 4. Kiến trúc thông tin

```
Top bar: duckbook · [1 Month] [2·3 Week] [4 Day] [5 Reflect] · ‹ kỳ hiện tại › Today · ⚙
│
├─ Month   (trái) Chọn tháng · "This month will be" · Notes · Mon–Wed (số tuần ở lề: mở tuần, xem goal/reflection)
│          (phải) Goals of the month (3) · Thu–Sun
├─ Week    (trái) ② WEEKLY notes: Biggest goal · Tasks of the week (chưa phân loại) · ghi chú dot-grid
│          (phải) ③ WEEKLY planning: ma trận A/C/B/D (kéo thả) · Habit tracker · Self-care
├─ Day     (trái) ④ DAILY planning: thứ · lời nhắn · Grateful for · Tasks + pomodoro · Notes · One sentence
│          (phải) This week: biggest goal · task A/B để thêm vào hôm nay · habit hôm nay · lịch tháng
└─ Reflect (trái) ⑤ WEEKLY reflection: Check-in/Success/Lesson/Future · không gian viết thêm · ☐ Review monthly
           (phải) Look back: 7 câu một-ngày · đã xong tuần này · theme + goals tháng · habit
```

## 5. Ngôn ngữ thiết kế (học từ sách)

- **Màu:** nền bàn `#EEF1F8`; giấy `#FFFFFF`; mực `#26346B`; nét kẻ `#C5CEE6`; tô nhạt `#DFE5F3`; tô vừa `#B7C4E4` (ô A).
- **Chữ:** Newsreader cho cả nhãn và nội dung. Tiêu đề trang theo kiểu sách: `WEEKLY` chữ hoa và *planning* in nghiêng. Có thể chuyển sang Dancing Script cho nội dung người dùng viết (font này hỗ trợ tiếng Việt).
- **Chi tiết:** số bước nằm trong vòng tròn mảnh, dot-grid 18px, đường kẻ một nét, nhãn nhỏ in hoa giãn chữ, chữ cái A/B/C/D nằm trong vòng tròn navy.
- Đổ bóng rất nhẹ cho trang giấy, có gáy sách ở giữa spread.

## 6. Ý tưởng ban đầu chưa bàn tới

Giao diện tiếng Việt, in/xuất PDF một tuần, chế độ tối "mực trắng". (Mobile và sync đã nằm trong mục Open của DECISIONS.)
