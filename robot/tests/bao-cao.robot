*** Settings ***
Documentation       Màn Báo cáo — chỗ người bán nhìn để biết hôm nay lời hay lỗ.
...
...                 Bộ mẫu: đơn hôm qua 116.000 (thu đủ, giá vốn 61.000), đơn hôm nay 150.000
...                 (thu 50.000, giá vốn 80.000), khoản chi hôm qua 1.200.000.
...                 Các ca chốt số cứng chỉ dùng kỳ "Hôm nay" và "7 ngày" — hai kỳ đó không đổi
...                 theo ngày trong tháng, còn kỳ "Tháng" thì mùng 1 sẽ rơi mất phần hôm qua.
Resource            ../resources/app.resource
Resource            ../resources/sales.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           bao-cao


*** Variables ***
${SHEET_KHOẢNG}     css=[role=dialog][aria-label="Chọn khoảng ngày"]
${SHEET_THU_NỢ}     css=[role=dialog][aria-label="Thu nợ · Anh Hùng"]
# Nhãn kỳ như report.label in hoa trong khối LỢI NHUẬN/LỖ (use-report.ts).
&{NHÃN_KỲ}          Hôm nay=HÔM NAY    7 ngày=7 NGÀY QUA


*** Test Cases ***
Kỳ Hôm nay chốt đúng lãi, doanh thu, đã thu và giá vốn
    [Documentation]    150.000 doanh thu − 80.000 giá vốn − 0 chi phí = 70.000 lãi. Khoản chi của
    ...    bộ mẫu nằm ở hôm qua nên không được kéo vào đây.
    Mở Báo Cáo Kỳ    Hôm nay
    Chờ Thấy Chữ    LỢI NHUẬN
    ${lãi}=    Đọc Ô Số    LỢI NHUẬN HÔM NAY
    Should Be Equal    ${lãi}    70.000 đ
    ${doanh_thu}=    Đọc Ô Số    DOANH THU
    Should Be Equal    ${doanh_thu}    150.000
    ${đã_thu}=    Đọc Ô Số    ĐÃ THU
    Should Be Equal    ${đã_thu}    50.000
    ${giá_vốn}=    Đọc Ô Số    GIÁ VỐN
    Should Be Equal    ${giá_vốn}    80.000

Kỳ 7 ngày gộp cả đơn hôm qua và khoản chi hôm qua nên thành lỗ
    Mở Báo Cáo Kỳ    7 ngày
    Chờ Thấy Chữ    LỖ
    ${doanh_thu}=    Đọc Ô Số    DOANH THU
    Should Be Equal    ${doanh_thu}    266.000
    ${chi_phí}=    Đọc Ô Số    CHI PHÍ
    Should Be Equal    ${chi_phí}    1.200.000
    ${lỗ}=    Đọc Ô Số    LỖ 7 NGÀY QUA
    # 266.000 − 141.000 giá vốn − 1.200.000 chi phí.
    Should Be Equal    ${lỗ}    1.075.000 đ

Báo cáo viết thẳng công thức tính ra con số lãi
    [Documentation]    Con số lãi không nói tính từ đâu thì người bán không dám tin.
    Mở Báo Cáo Kỳ    Hôm nay
    Chờ Thấy Chữ    Doanh thu 150.000 − Giá vốn 80.000 − Chi phí 0

Chênh giữa doanh thu và đã thu được giải thích là khách còn nợ
    Mở Báo Cáo Kỳ    Hôm nay
    Chờ Thấy Chữ    là khách còn nợ kỳ này
    Chờ Thấy Chữ    chênh 100.000 đ

Thu hết nợ thì dòng giải thích phần chênh biến mất
    [Documentation]    Đơn nợ của bộ mẫu bán hôm nay, nên thu xong là "Đã thu" bằng đúng "Doanh thu"
    ...    và không còn gì để giải thích. Còn dòng chênh nghĩa là báo cáo đang kể một khoản không có thật.
    Mở Báo Cáo Kỳ    Hôm nay
    Chờ Thấy Chữ    là khách còn nợ kỳ này

    Mở Màn    /cong-no
    Click    css=button:has-text("Anh Hùng")
    Click    ${SHEET_THU_NỢ} >> css=button:has-text("THU ")
    # Sheet chỉ đóng sau khi phiếu thu và paidAmount đã được ghi xong.
    Wait For Elements State    ${SHEET_THU_NỢ}    detached

    Mở Báo Cáo Kỳ    Hôm nay
    ${đã_thu}=    Đọc Ô Số    ĐÃ THU
    Should Be Equal    ${đã_thu}    150.000
    Không Được Thấy Chữ    là khách còn nợ kỳ này

Bán thêm một đơn thì doanh thu hôm nay cộng lên
    Mở Báo Cáo Kỳ    Hôm nay
    ${trước}=    Đọc Ô Số    DOANH THU
    Should Be Equal    ${trước}    150.000

    Bán Nhanh    Phở bò
    Mở Báo Cáo Kỳ    Hôm nay
    ${sau}=    Đọc Ô Số    DOANH THU
    Should Be Equal    ${sau}    205.000

Bảng bán chạy nhất xếp theo doanh thu của món
    Mở Báo Cáo Kỳ    7 ngày
    Chờ Thấy Chữ    Bán chạy nhất
    Chờ Thấy Chữ    Cơm tấm sườn
    Chờ Thấy Chữ    Phở bò đặc biệt
    Chờ Thấy Chữ    SL 3
    Chờ Thấy Chữ    lãi 63.000

Ô khách còn nợ đưa thẳng sang màn công nợ
    Mở Báo Cáo Kỳ    Hôm nay
    Chờ Thấy Chữ    KHÁCH CÒN NỢ
    Chờ Thấy Chữ    1 khách · tính trên toàn bộ đơn chưa trả đủ
    Click    css=a[href="/cong-no"]
    Chờ Thấy Chữ    TỔNG NỢ

Kỳ tự chọn lấy đúng khoảng ngày đã chọn
    Mở Màn    /bao-cao
    Chọn Chip    Tuỳ chọn
    Wait For Elements State    ${SHEET_KHOẢNG}    visible
    ${hôm_nay}=    Evaluate    datetime.date.today().isoformat()    datetime
    Điền Ô    Từ ngày    ${hôm_nay}
    Điền Ô    Đến ngày    ${hôm_nay}
    Bấm Nút    XEM BÁO CÁO

    Wait For Elements State    ${SHEET_KHOẢNG}    detached
    ${nhãn_kỳ}=    Evaluate    datetime.date.today().strftime('%d/%m – %d/%m/%Y')    datetime
    Chờ Thấy Chữ    ${nhãn_kỳ}
    ${doanh_thu}=    Đọc Ô Số    DOANH THU
    Should Be Equal    ${doanh_thu}    150.000

Chọn ngày đầu sau ngày cuối thì không xem được
    Mở Màn    /bao-cao
    Chọn Chip    Tuỳ chọn
    ${hôm_nay}=    Evaluate    datetime.date.today().isoformat()    datetime
    ${hôm_qua}=    Evaluate    (datetime.date.today() - datetime.timedelta(days=1)).isoformat()    datetime
    Điền Ô    Đến ngày    ${hôm_qua}
    Điền Ô    Từ ngày    ${hôm_nay}

    Chờ Thấy Chữ    Ngày đầu đang sau ngày cuối
    Nút Phải Bị Khoá    XEM BÁO CÁO

Kỳ không có đơn cũng không có khoản chi thì nói rõ chứ không để trống
    Mở Màn    /bao-cao
    # Chờ "DOANH THU" chứ đừng chờ "LỖ": bộ mẫu chi vào hôm qua nên mùng 1 khoản đó thuộc tháng
    # trước, tháng này hoá ra có lãi và chữ "LỖ" không hiện. Đây chỉ là bước chờ trang tải, khẳng
    # định thật nằm ở dòng dưới.
    Chờ Thấy Chữ    DOANH THU
    Click    css=button[aria-label="Tháng trước"]
    Click    css=button[aria-label="Tháng trước"]
    Chờ Thấy Chữ    chưa có đơn nào và cũng chưa ghi khoản chi nào

Không xem trước được tháng chưa tới
    Mở Màn    /bao-cao
    Chờ Thấy Chữ    DOANH THU
    Wait For Elements State    css=button[aria-label="Tháng sau"]    disabled


*** Keywords ***
Mở Báo Cáo Kỳ
    [Arguments]    ${kỳ}
    Mở Màn    /bao-cao
    Chọn Chip    ${kỳ}
    ${đang_chọn}=    Chip Đang Chọn    ${kỳ}
    Should Be Equal    ${đang_chọn}    true
    # Chip đổi ngay nhưng con số đi qua truy vấn bất đồng bộ, nên một lúc sau khi bấm màn vẫn hiện số
    # của kỳ mặc định (Tháng). Nhãn LỢI NHUẬN/LỖ đổi cùng lượt render với con số: chờ nó rồi mới đọc.
    Wait For Elements State    ${{ 'xpath=//span[contains(normalize-space(), "%s")]' % $NHÃN_KỲ[$kỳ] }}    visible

Đọc Ô Số
    [Documentation]    Cả StatBox lẫn khối lãi/lỗ đều là <span> nhãn rồi <span> số ngay sau nó.
    [Arguments]    ${nhãn}
    ${số}=    Get Text    ${{ 'xpath=//span[normalize-space()="%s"]/following-sibling::span[1]' % $nhãn }}
    RETURN    ${số}
