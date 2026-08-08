*** Settings ***
Documentation       Màn Bán hàng — luồng kiếm ra tiền của app. Kiểm tận IndexedDB ở những ca
...                 liên quan tới số tiền, vì giao diện hiện đúng mà sổ ghi sai là kiểu hỏng tệ nhất.
Resource            ../resources/app.resource
Resource            ../resources/sales.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           ban-hang


*** Test Cases ***
Bán tiền mặt trả đủ thì đơn ghi đã thu hết
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Chờ Thấy Chữ    55.000 đ
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[total]    55000
    Should Be Equal As Integers    ${đơn}[paidAmount]    55000
    Should Be Equal    ${đơn}[status]    paid

Chọn món nhiều lần thì số lượng cộng dồn và tổng tiền nhân lên
    Mở Màn    /
    Chọn Món    Trà đá    3
    Chờ Thấy Chữ    TRONG ĐƠN
    Chờ Thấy Chữ    9.000 đ
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[total]    9000

Khách đưa dư thì hiện đúng tiền thối
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Điền Tiền Khách Đưa    100000
    Chờ Thấy Chữ    Tiền thối
    Chờ Thấy Chữ    45.000 đ
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[paidAmount]    55000

Khách trả thiếu thì phần thiếu thành nợ của khách
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Điền Tiền Khách Đưa    20000
    Chờ Thấy Chữ    Còn nợ lại
    Click    ${NÚT_CHỌN_KHÁCH_NỢ}
    Chọn Khách Trong Sheet    Anh Hùng
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[paidAmount]    20000
    Should Be Equal    ${đơn}[status]    partial
    Should Not Be Equal    ${đơn}[customerId]    ${None}

Bán nợ toàn bộ thì sổ ghi chưa thu đồng nào
    Bán Nợ Cho Khách    Phở bò    Anh Hùng

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[paidAmount]    0
    Should Be Equal    ${đơn}[status]    unpaid

    ${phiếu_thu}=    Đọc Bảng    payments
    ${của_đơn}=    Evaluate    [p for p in $phiếu_thu if p['orderId'] == $đơn['id']]
    Should Be Empty    ${của_đơn}    Bán nợ mà vẫn ghi phiếu thu.

Đi chọn khách rồi quay lại thì vẫn đang là Bán nợ
    [Documentation]    Chốt chặn của MR #1: `method` từng là state trong sheet, mà sheet bị gỡ khỏi
    ...    cây lúc đi chọn khách — quay lại là về mặc định "tiền mặt, đưa đủ" và đơn nợ bị ghi
    ...    thành đã thu đủ.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Chọn Hình Thức Trả    Bán nợ
    Click    ${NÚT_CHỌN_KHÁCH_NỢ}
    Chọn Khách Trong Sheet    Anh Hùng

    ${đang_chọn}=    Hình Thức Đang Chọn    Bán nợ
    Should Be Equal    ${đang_chọn}    true    Quay lại sheet thu tiền mà hình thức không còn là "Bán nợ".
    Chờ Thấy Chữ    Ghi nợ toàn bộ

Trả thiếu rồi mới chọn khách thì số đã đưa giữ nguyên
    [Documentation]    Cùng gốc với ca trên, nhưng cho `given`: đi chọn khách xong số tiền khách
    ...    đưa phải còn nguyên, không nhảy về "đưa đủ".
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Điền Tiền Khách Đưa    20000
    Click    ${NÚT_CHỌN_KHÁCH_NỢ}
    Chọn Khách Trong Sheet    Anh Hùng
    Chờ Thấy Chữ    Còn nợ lại
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[paidAmount]    20000

Chưa chọn khách thì sheet nói rõ nợ phải có chủ
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Chọn Hình Thức Trả    Bán nợ
    Chờ Thấy Chữ    Nợ phải có chủ
    Wait For Elements State    ${NÚT_CHỌN_KHÁCH_NỢ}    visible

Giảm giá và phụ thu đổi đúng tổng cộng
    Mở Màn    /
    Chọn Món    Phở bò
    Bấm Nút    Giảm giá / phụ thu
    Điền Ô    Giảm giá    5000
    Điền Ô    Phụ thu    2000
    Bấm Nút    ÁP DỤNG

    Chờ Thấy Chữ    52.000 đ
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[subtotal]    55000
    Should Be Equal As Integers    ${đơn}[discount]    5000
    Should Be Equal As Integers    ${đơn}[surcharge]    2000
    Should Be Equal As Integers    ${đơn}[total]    52000

Giảm giá lớn hơn tiền hàng thì bị chặn
    Mở Màn    /
    Chọn Món    Trà đá
    Bấm Nút    Giảm giá / phụ thu
    Điền Ô    Giảm giá    99000
    Chờ Thấy Chữ    Giảm giá không được lớn hơn tiền hàng
    Nút Phải Bị Khoá    ÁP DỤNG

Sửa dòng trong giỏ đổi được số lượng và đơn giá riêng
    Mở Màn    /
    Chọn Món    Trà đá
    Click    css=button[aria-label="Sửa Trà đá"]
    Điền Ô    Số lượng    4
    Điền Ô    Đơn giá riêng cho đơn này    5000
    Bấm Nút    XONG

    Chờ Thấy Chữ    20.000 đ
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[total]    20000

    ${món}=    Đọc Bảng    items
    ${trà}=    Evaluate    [i for i in $món if i['name'] == 'Trà đá'][0]
    Should Be Equal As Integers    ${trà}[unitPrice]    3000    Giá riêng của đơn không được sửa giá trong danh mục.

Bỏ món khỏi giỏ thì giỏ trống và nút thu tiền biến mất
    Mở Màn    /
    Chọn Món    Trà đá
    Click    css=button[aria-label="Sửa Trà đá"]
    Bấm Nút    Bỏ món này khỏi đơn
    Wait For Elements State    ${NÚT_THU_TIỀN}    detached

Gõ "2 pho" rồi Enter thì thêm đúng 2 phở
    Mở Màn    /
    Gõ Vào Ô Tìm Món    2 pho
    Keyboard Key    press    Enter
    Chờ Thấy Chữ    TRONG ĐƠN
    Chờ Thấy Chữ    110.000 đ

Lọc theo nhóm chỉ hiện món của nhóm đó
    Mở Màn    /
    Click    css=button:has-text("Đồ uống")
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Trà đá")    visible
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Phở bò")    detached

Đơn đang lên dở sống sót qua một lần tải lại trang
    Mở Màn    /
    Chọn Món    Phở bò
    Chờ Thấy Chữ    TRONG ĐƠN
    Chờ Nháp Giỏ Được Lưu
    Reload
    Chờ Thấy Chữ    Đã khôi phục đơn đang lên dở
    Chờ Thấy Chữ    55.000 đ

Bán xong thì nháp biến mất, mở lại không khôi phục đơn vừa bán
    [Documentation]    Nháp sống sót qua một lượt bán là mầm của đơn trùng: mở lại màn Bán hàng
    ...    thấy đúng những món vừa bán nằm sẵn trong giỏ, rất dễ bấm bán lần nữa.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Phở bò
    Chờ Nháp Giỏ Được Lưu
    Mở Sheet Thu Tiền
    Chốt Đơn

    Nháp Giỏ Phải Trống
    Mở Màn    /
    Chờ Thấy Chữ    HÔM NAY
    Không Được Thấy Chữ    Đã khôi phục đơn đang lên dở
    Wait For Elements State    ${NÚT_THU_TIỀN}    detached

Doanh thu hôm nay trên thanh tiêu đề cộng thêm đơn vừa bán
    Mở Màn    /
    ${trước}=    Get Text    css=header:has-text("HÔM NAY") >> css=span.money
    Bán Nhanh    Phở bò
    Mở Màn    /
    ${sau}=    Get Text    css=header:has-text("HÔM NAY") >> css=span.money
    Should Not Be Equal    ${trước}    ${sau}    Bán xong mà doanh thu hôm nay không đổi.

Chốt đơn xong nhảy thẳng sang phiếu để gửi khách
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Chốt Đơn
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    Chờ Thấy Chữ    Quán Cơm Bà Tư
