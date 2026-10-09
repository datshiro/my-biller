*** Settings ***
Documentation       Màn Công nợ và sheet Thu nợ. Bộ mẫu: Anh Hùng nợ 100.000 (đơn 150.000 đã trả
...                 trước 50.000). Mỗi ca đều đối chiếu lại bảng payments — thu tiền mà không ra
...                 phiếu thu thì lần sau đòi lại lần nữa.
Resource            ../resources/app.resource
Resource            ../resources/sales.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           cong-no


*** Variables ***
${SHEET_THU_NỢ}    css=[role=dialog][aria-label="Thu nợ · Anh Hùng"]


*** Test Cases ***
Màn công nợ hiện đúng tổng nợ và số khách
    Mở Màn    /cong-no
    Chờ Thấy Chữ    Công nợ
    Chờ Thấy Chữ    TỔNG NỢ
    Chờ Thấy Chữ    100.000
    Chờ Thấy Chữ    Anh Hùng
    Chờ Thấy Chữ    1 đơn

Thu hết nợ thì khách rời khỏi danh sách công nợ
    Mở Sheet Thu Nợ    Anh Hùng
    Chờ Thấy Chữ    Hết nợ
    Bấm Nút Thu

    Chờ Thấy Chữ    Chưa ai nợ tiền
    ${đơn}=    Đơn Mới Nhất
    Should Be Equal    ${đơn}[status]    paid
    Should Be Equal As Integers    ${đơn}[paidAmount]    150000

Thu một phần thì phần còn lại vẫn nằm trên sổ nợ
    Mở Sheet Thu Nợ    Anh Hùng
    Điền Ô    Thu bao nhiêu    40000
    Chờ Thấy Chữ    Còn nợ sau khi thu
    Chờ Thấy Chữ    60.000
    Bấm Nút Thu

    Chờ Thấy Chữ    60.000
    ${đơn}=    Đơn Mới Nhất
    Should Be Equal    ${đơn}[status]    partial
    Should Be Equal As Integers    ${đơn}[paidAmount]    90000

Thu nhiều hơn số khách nợ thì bị chặn
    [Documentation]    Thu dư là tạo ra tiền trong sổ mà thực tế không có — chặn ngay tại nút.
    Mở Sheet Thu Nợ    Anh Hùng
    Điền Ô    Thu bao nhiêu    200000
    Chờ Thấy Chữ    Khách chỉ còn nợ 100.000
    Nút Phải Bị Khoá    THU

Để trống số tiền thì chưa thu được
    Mở Sheet Thu Nợ    Anh Hùng
    Điền Ô    Thu bao nhiêu    0
    Nút Phải Bị Khoá    THU

Nút Trả hết điền đúng số khách đang nợ
    Mở Sheet Thu Nợ    Anh Hùng
    Điền Ô    Thu bao nhiêu    10000
    Bấm Nút    Trả hết
    ${số}=    Đọc Ô    Thu bao nhiêu
    Should Be Equal    ${số}    100.000

Mỗi lần thu ghi một phiếu thu riêng kèm hình thức đã chọn
    Mở Sheet Thu Nợ    Anh Hùng
    Điền Ô    Thu bao nhiêu    30000
    Click    ${SHEET_THU_NỢ} >> css=[aria-label="Hình thức thu"] >> css=button:has-text("Chuyển khoản")
    Bấm Nút Thu
    Chờ Thấy Chữ    70.000

    Mở Sheet Thu Nợ    Anh Hùng
    Điền Ô    Thu bao nhiêu    20000
    Bấm Nút Thu
    Chờ Thấy Chữ    50.000

    ${phiếu_thu}=    Đọc Bảng    payments
    ${sau_bán}=    Evaluate    [p for p in $phiếu_thu if p['amount'] in (30000, 20000)]
    Length Should Be    ${sau_bán}    2    Hai lần thu phải ra hai dòng riêng trong lịch sử.
    ${chuyển_khoản}=    Evaluate    [p for p in $phiếu_thu if p['method'] == 'transfer']
    Length Should Be    ${chuyển_khoản}    1    Hình thức chuyển khoản không được ghi vào phiếu thu.

Thu nợ từ trang khách hàng cũng vào cùng một sổ
    Mở Màn    /them/khach-hang
    Click    css=button:has-text("Anh Hùng")
    Bấm Nút    THU NỢ
    Wait For Elements State    ${SHEET_THU_NỢ}    visible
    Điền Ô    Thu bao nhiêu    100000
    Bấm Nút Thu

    Chờ Thấy Chữ    Lịch sử thu tiền
    Mở Màn    /cong-no
    Chờ Thấy Chữ    Chưa ai nợ tiền

Bán nợ thêm cho khách thì tổng nợ trên màn công nợ cộng lên
    Bán Nợ Cho Khách    Cơm tấm    Anh Hùng
    Mở Màn    /cong-no
    Chờ Thấy Chữ    145.000
    Chờ Thấy Chữ    2 đơn

Nợ mới phát sinh hôm nay thì ghi rõ là từ hôm nay
    Bán Nợ Cho Khách    Trà đá    Anh Hùng
    Mở Màn    /cong-no
    Chờ Thấy Chữ    từ hôm nay

APK: Back khi đang lưu thu nợ bị nuốt, sổ ghi đúng một phiếu thu
    [Documentation]    Lỗi cũ (#72): Back trên APK đóng luôn sheet Thu nợ giữa lúc đang lưu. Sheet biến mất nên
    ...    người bán không biết tiền đã vào sổ chưa và dễ thu lần nữa. Ca này treo lệnh ghi, bấm Back trong lúc
    ...    treo, rồi nhả: sheet vẫn mở tới khi lưu xong, app không thu xuống nền, và `payments` chỉ thêm đúng
    ...    một dòng 100.000 cho Anh Hùng.
    [Tags]    regression
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    ${trước}=    Đọc Bảng    payments
    Mở Sheet Thu Nợ    Anh Hùng
    Giữ Ghi Sổ Lại
    Click    ${SHEET_THU_NỢ} >> css=button:has-text("THU ")
    Chờ Thấy Chữ    Đang lưu…

    Bấm Back Android
    # Back đóng sheet là một lần vẽ lại sau lệnh Back: đợi qua nó rồi mới kiểm sheet còn mở.
    Sleep    300ms
    Wait For Elements State    ${SHEET_THU_NỢ}    visible
    Chờ Thấy Chữ    Đang lưu…
    Get Url    ==    ${BASE_URL}/cong-no
    ${thu_app}=    Số Lần Thu App
    Should Be Equal As Integers    ${thu_app}    0    Back khi đang lưu mà app thu xuống nền.

    Nhả Ghi Sổ Ra
    Wait For Elements State    ${SHEET_THU_NỢ}    detached
    Chờ Thấy Chữ    Chưa ai nợ tiền
    ${sau}=    Đọc Bảng    payments
    ${id_cũ}=    Evaluate    {dòng['id'] for dòng in $trước}
    ${mới}=    Evaluate    [dòng for dòng in $sau if dòng['id'] not in $id_cũ]
    Length Should Be    ${mới}    1    Thu nợ một lần phải ra đúng một dòng thu, không được ghi hai lần.
    Should Be Equal As Integers    ${mới}[0][amount]    100000    Dòng thu không đúng số nợ đã thu.


*** Keywords ***
Mở Sheet Thu Nợ
    [Arguments]    ${tên}
    Mở Màn    /cong-no
    Click    css=button:has-text("${tên}")
    Wait For Elements State    ${SHEET_THU_NỢ}    visible

Bấm Nút Thu
    [Documentation]    Nhãn nút mang sẵn số tiền ("THU 100.000 đ") nên bám theo chữ đầu, và phải
    ...    thu vào trong sheet vì trang khách hàng cũng có nút "THU NỢ".
    Click    ${SHEET_THU_NỢ} >> css=button:has-text("THU ")
    Wait For Elements State    ${SHEET_THU_NỢ}    detached
