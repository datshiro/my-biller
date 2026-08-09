*** Settings ***
Documentation       Danh mục Khách hàng và trang chi tiết khách — nơi công nợ có chủ.
Resource            ../resources/app.resource
Resource            ../resources/sales.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           khach-hang


*** Test Cases ***
Danh sách hiện khách của bộ mẫu kèm số đếm
    Mở Màn    /them/khach-hang
    Chờ Thấy Chữ    1 khách
    Chờ Thấy Chữ    Anh Hùng
    Chờ Thấy Chữ    0912 345 678

Thêm khách mới rồi ghi nợ được cho khách đó
    Mở Màn    /them/khach-hang
    Bấm Nút    Thêm khách hàng
    Điền Ô    Tên khách hàng *    Chị Hoa
    Điền Ô    Số điện thoại    0988 111 222
    Bấm Nút    LƯU KHÁCH HÀNG

    Chờ Thấy Chữ    2 khách
    Chờ Thấy Chữ    Chị Hoa

    Bán Nợ Cho Khách    Trà đá    Chị Hoa
    ${đơn}=    Đơn Mới Nhất
    Should Be Equal    ${đơn}[customerName]    Chị Hoa
    Should Be Equal    ${đơn}[status]    unpaid

Thiếu tên thì không lưu được khách
    Mở Màn    /them/khach-hang/moi
    Bấm Nút    LƯU KHÁCH HÀNG
    Chờ Thấy Chữ    Nhập tên khách hàng
    Wait For Condition    Url    contains    /them/khach-hang/moi

Trùng số điện thoại thì app nhắc trước khi lưu
    Mở Màn    /them/khach-hang/moi
    Điền Ô    Tên khách hàng *    Người trùng số
    Điền Ô    Số điện thoại    0912 345 678
    Chờ Thấy Chữ    Số này đang trùng với
    Chờ Thấy Chữ    Anh Hùng

Sửa thông tin khách thì trang chi tiết đổi theo
    Mở Chi Tiết Khách    Anh Hùng
    Bấm Nút    Sửa thông tin
    Điền Ô    Địa chỉ    45 Nguyễn Huệ
    Bấm Nút    LƯU KHÁCH HÀNG
    Chờ Thấy Chữ    45 Nguyễn Huệ

Trang chi tiết hiện đúng số đã mua và số còn nợ
    Mở Chi Tiết Khách    Anh Hùng
    Chờ Thấy Chữ    Đã mua
    Chờ Thấy Chữ    Còn nợ
    Chờ Thấy Chữ    Lịch sử đơn
    # Bộ mẫu: 3 cơm tấm + 1 cà phê = 155.000, giảm 5.000 → đơn 150.000, trả trước 50.000 → nợ 100.000.
    Chờ Thấy Chữ    150.000
    Chờ Thấy Chữ    100.000

Bán thêm một đơn nợ thì số còn nợ của khách cộng lên
    Bán Nợ Cho Khách    Trà đá    Anh Hùng
    Mở Chi Tiết Khách    Anh Hùng
    Chờ Thấy Chữ    103.000

Khách còn nợ mới có nút thu nợ
    Mở Chi Tiết Khách    Anh Hùng
    Wait For Elements State    css=button:has-text("THU NỢ")    visible

Khách chưa có đơn nào thì không có nút thu nợ
    Mở Màn    /them/khach-hang/moi
    Điền Ô    Tên khách hàng *    Khách mới tinh
    Bấm Nút    LƯU KHÁCH HÀNG
    Mở Chi Tiết Khách    Khách mới tinh
    Chờ Thấy Chữ    chưa có đơn nào
    Wait For Elements State    css=button:has-text("THU NỢ")    detached

Không cho xoá khách đã có đơn
    [Documentation]    Xoá đi thì công nợ và lịch sử mua mất chủ, không phục hồi được.
    Mở Chi Tiết Khách    Anh Hùng
    Click    css=button:text-is("Xoá")
    Xác Nhận Trong Hộp    Xoá
    Chờ Thấy Chữ    không xoá được

    Mở Màn    /them/khach-hang
    Chờ Thấy Chữ    1 khách

Xoá được khách chưa có đơn nào
    Mở Màn    /them/khach-hang/moi
    Điền Ô    Tên khách hàng *    Khách xoá thử
    Bấm Nút    LƯU KHÁCH HÀNG
    Chờ Thấy Chữ    2 khách

    Mở Chi Tiết Khách    Khách xoá thử
    Click    css=button:text-is("Xoá")
    Xác Nhận Trong Hộp    Xoá

    Chờ Thấy Chữ    1 khách
    Không Được Thấy Chữ    Khách xoá thử

Tìm khách theo số điện thoại
    Mở Màn    /them/khach-hang
    Fill Text    css=input[type=search]    0912
    Chờ Thấy Chữ    Anh Hùng

    Fill Text    css=input[type=search]    0000
    Chờ Thấy Chữ    Không có khách nào khớp

Thêm khách nhanh ngay trong lúc bán
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Chọn Hình Thức Trả    Bán nợ
    Click    ${NÚT_CHỌN_KHÁCH_NỢ}
    Bấm Nút    Thêm khách mới
    Điền Ô    Tên khách *    Khách vãng lai
    Bấm Nút    LƯU VÀ CHỌN
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal    ${đơn}[customerName]    Khách vãng lai
    Should Be Equal    ${đơn}[status]    unpaid


Đặt giá riêng cho khách thì sổ ghi đúng số đó
    [Documentation]    Ca dính tiền: đọc thẳng IndexedDB chứ không tin con số trên màn.
    Mở Bảng Giá Của Khách    Anh Hùng
    Điền Ô    Phở bò đặc biệt    38000
    Bấm Nút    LƯU BẢNG GIÁ

    Chờ Thấy Chữ    1 món có giá riêng
    ${giá}=    Đọc Bảng    customerPrices
    Length Should Be    ${giá}    1
    Should Be Equal As Integers    ${giá}[0][unitPrice]    38000

Giá riêng bằng 0 là giá thật, không phải ô trống
    [Documentation]    Món tặng kèm. Hiểu 0 thành "chưa đặt" là món tặng bị tính đủ tiền.
    Mở Bảng Giá Của Khách    Anh Hùng
    Điền Ô    Trà đá    0
    Bấm Nút    LƯU BẢNG GIÁ

    Chờ Thấy Chữ    1 món có giá riêng
    ${giá}=    Đọc Bảng    customerPrices
    Length Should Be    ${giá}    1
    Should Be Equal As Integers    ${giá}[0][unitPrice]    0

Sửa giá lần hai rồi xoá trắng ô thì sổ theo đúng từng bước
    [Documentation]    Lưu lần hai đi qua đúng đường từng đẻ ConstraintError: khoá chính là ++id còn
    ...    uniqueness nằm ở &[customerId+itemId], nên put không mang id cũ là rollback cả transaction
    ...    và mọi ô người bán vừa gõ mất sạch.
    [Tags]    regression
    Mở Bảng Giá Của Khách    Anh Hùng
    Điền Ô    Phở bò đặc biệt    38000
    Bấm Nút    LƯU BẢNG GIÁ
    Chờ Thấy Chữ    1 món có giá riêng

    Bấm Nút    Bảng giá sỉ
    Điền Ô    Phở bò đặc biệt    40000
    Bấm Nút    LƯU BẢNG GIÁ
    Chờ Thấy Chữ    1 món có giá riêng
    ${giá}=    Đọc Bảng    customerPrices
    Length Should Be    ${giá}    1
    Should Be Equal As Integers    ${giá}[0][unitPrice]    40000

    Bấm Nút    Bảng giá sỉ
    Điền Ô    Phở bò đặc biệt    ${EMPTY}
    Bấm Nút    LƯU BẢNG GIÁ
    Chờ Thấy Chữ    Chưa đặt
    ${giá}=    Đọc Bảng    customerPrices
    Should Be Empty    ${giá}

Món đã có giá riêng nổi lên đầu danh sách
    Mở Bảng Giá Của Khách    Anh Hùng
    Điền Ô    Trà đá    2000
    Bấm Nút    LƯU BẢNG GIÁ
    Chờ Thấy Chữ    1 món có giá riêng

    Bấm Nút    Bảng giá sỉ
    # Theo tên thì "Cà phê sữa" đứng đầu; đặt giá riêng cho Trà đá là nó phải vượt lên.
    # Chữ hoa là do `label-xs` đặt `text-transform: uppercase`, không phải tên món viết hoa.
    ${đầu}=    Get Text    css=label >> nth=0
    Should Be Equal    ${đầu}    TRÀ ĐÁ

Rời màn bảng giá khi còn ô chưa lưu thì app hỏi lại
    Mở Bảng Giá Của Khách    Anh Hùng
    Điền Ô    Phở bò đặc biệt    38000
    Click    css=button[aria-label="Quay lại"]
    Chờ Hộp Xác Nhận    Bỏ những gì đang nhập?


*** Keywords ***
Mở Chi Tiết Khách
    [Arguments]    ${tên}
    Mở Màn    /them/khach-hang
    Click    css=button:has-text("${tên}")
    Chờ Thấy Chữ    Lịch sử đơn

Mở Bảng Giá Của Khách
    [Arguments]    ${tên}
    Mở Chi Tiết Khách    ${tên}
    Bấm Nút    Bảng giá sỉ
    Chờ Thấy Chữ    Để trống là bán giá lẻ
