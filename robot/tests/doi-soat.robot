*** Settings ***
Documentation       Màn Đối soát — bốn tổng toàn sổ và số dòng từng bảng, để so máy này với Báo cáo,
...                 Công nợ và (ở suite hai máy) với máy khác. Bộ mẫu: đơn hôm qua 116.000 thu đủ, đơn
...                 hôm nay 150.000 mới thu 50.000, khoản chi hôm qua 1.200.000 → toàn sổ Doanh thu
...                 266.000, Đã thu 166.000, Chi phí 1.200.000, Còn nợ 100.000. Bộ mẫu đổi thì sửa số ở
...                 đây, ở bao-cao.robot và cong-no.robot cùng lúc — đừng nới điều kiện so.
Resource            ../resources/app.resource
Resource            ../resources/sales.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           doi-soat


*** Test Cases ***
Bốn tổng của Đối soát bằng đúng số của Báo cáo và Công nợ
    [Documentation]    (a) Đối soát dùng MoneyText nên chuỗi có hậu tố " đ"; StatBox Báo cáo và ô TỔNG NỢ
    ...    Công nợ dùng formatAmount nên không có — khi so phải nối thêm " đ" vào số của hai màn kia.
    ...    (b) Kỳ "7 ngày" bao trọn bộ mẫu (đơn hôm qua, đơn hôm nay, khoản chi hôm qua). Nếu sau này
    ...    bộ mẫu có dòng cũ hơn 7 ngày thì phép so này sai và phải đổi cách so, không phải nới số.
    Mở Màn Đối Soát
    ${doanh_thu}=    Đọc Ô Số    DOANH THU
    ${đã_thu}=    Đọc Ô Số    ĐÃ THU
    ${chi_phí}=    Đọc Ô Số    CHI PHÍ
    ${còn_nợ}=    Đọc Ô Số    CÒN NỢ
    Should Be Equal    ${doanh_thu}    266.000 đ
    Should Be Equal    ${đã_thu}    166.000 đ
    Should Be Equal    ${chi_phí}    1.200.000 đ
    Should Be Equal    ${còn_nợ}    100.000 đ

    Mở Màn    /bao-cao
    Chọn Chip    7 ngày
    # Chip đổi ngay nhưng con số đi qua truy vấn bất đồng bộ; nhãn kỳ đổi cùng lượt render với con số.
    Wait For Elements State    xpath=//span[contains(normalize-space(), "7 NGÀY QUA")]    visible
    ${bc_doanh_thu}=    Đọc Ô Số    DOANH THU
    ${bc_đã_thu}=    Đọc Ô Số    ĐÃ THU
    ${bc_chi_phí}=    Đọc Ô Số    CHI PHÍ
    Should Be Equal    ${doanh_thu}    ${bc_doanh_thu} đ
    Should Be Equal    ${đã_thu}    ${bc_đã_thu} đ
    Should Be Equal    ${chi_phí}    ${bc_chi_phí} đ

    Mở Màn    /cong-no
    Chờ Thấy Chữ    TỔNG NỢ
    ${cn_tổng_nợ}=    Đọc Ô Số    TỔNG NỢ
    Should Be Equal    ${còn_nợ}    ${cn_tổng_nợ} đ

Phiếu đã trả lại khách không được cộng vào Đã thu
    [Documentation]    Đơn huỷ không tính doanh thu, phiếu hoàn tiền không tính đã thu: sau khi bán rồi
    ...    hoàn, bốn tổng phải trở lại đúng bộ mẫu. Ca dùng khách lẻ (customerId null) nên KHÔNG chạm
    ...    nhánh tín dụng trừ nợ của ledgerTotals — nhánh đó chỉ có ca Vitest ở src/domain phủ. Nút hoàn
    ...    tiền chỉ hiện tại chi tiết đơn khi đơn khách lẻ đã huỷ. Đối chiếu thẳng bảng payments vì màn
    ...    hiện đúng mà sổ ghi sai là kiểu hỏng tệ nhất.
    ${đơn}=    Bán Nhanh Rồi Huỷ Và Trả Lại Tiền    Phở bò

    Mở Màn Đối Soát
    ${doanh_thu}=    Đọc Ô Số    DOANH THU
    ${đã_thu}=    Đọc Ô Số    ĐÃ THU
    ${chi_phí}=    Đọc Ô Số    CHI PHÍ
    ${còn_nợ}=    Đọc Ô Số    CÒN NỢ
    Should Be Equal    ${doanh_thu}    266.000 đ
    Should Be Equal    ${đã_thu}    166.000 đ
    Should Be Equal    ${chi_phí}    1.200.000 đ
    Should Be Equal    ${còn_nợ}    100.000 đ

    ${phiếu_thu}=    Đọc Bảng    payments
    ${của_đơn}=    Evaluate    [p for p in $phiếu_thu if p['orderId'] == $đơn['id']]
    Length Should Be    ${của_đơn}    1
    Should Be Equal As Integers    ${của_đơn}[0][allocatedOrderId]    0
    Should Be Equal    ${của_đơn}[0][unallocatedStatus]    refunded


*** Keywords ***
Mở Màn Đối Soát
    [Documentation]    Khối tổng chỉ render sau khi truy vấn 9 bảng xong; chờ tiêu đề khối rồi mới đọc số.
    Mở Màn    /them/doi-soat
    Chờ Thấy Chữ    TỔNG TOÀN SỔ
