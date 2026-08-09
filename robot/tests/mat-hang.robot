*** Settings ***
Documentation       Danh mục Mặt hàng — thêm, sửa, ngừng bán, xoá. Món có bán được ngay ở màn
...                 Bán hàng hay không mới là thước đo, không phải dòng vừa hiện trong danh sách.
Resource            ../resources/app.resource
Resource            ../resources/sales.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           mat-hang


*** Test Cases ***
Danh sách hiện đủ món của bộ mẫu kèm số đếm
    [Documentation]    Số đếm ở đầu màn từng bị bỏ mất trong lúc dọn code — MR #1 trả lại.
    [Tags]    regression
    Mở Màn    /them/mat-hang
    Chờ Thấy Chữ    Mặt hàng
    Chờ Thấy Chữ    4 món
    Chờ Thấy Chữ    Phở bò đặc biệt
    Chờ Thấy Chữ    Cà phê sữa

Thêm mặt hàng mới rồi bán được ngay
    Mở Màn    /them/mat-hang
    Bấm Nút    Thêm mặt hàng
    Điền Ô    Tên mặt hàng *    Bún bò
    Điền Ô    Giá bán *    40000
    Điền Ô    Giá nhập (tuỳ chọn)    22000
    Bấm Nút    LƯU MẶT HÀNG

    Chờ Thấy Chữ    5 món
    Chờ Thấy Chữ    Bún bò

    Mở Màn    /
    Chọn Món    Bún bò
    Chờ Thấy Chữ    40.000 đ

Thiếu tên hoặc giá bán thì không lưu được
    Mở Màn    /them/mat-hang/moi
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    Nhập tên mặt hàng
    Chờ Thấy Chữ    Nhập giá bán

    Điền Ô    Tên mặt hàng *    Chỉ có tên
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    Nhập giá bán
    Wait For Condition    Url    contains    /them/mat-hang/moi

Sửa giá bán thì danh sách và màn Bán hàng đổi theo
    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Trà đá")
    Điền Ô    Giá bán *    5000
    Bấm Nút    LƯU MẶT HÀNG

    Chờ Thấy Chữ    5.000
    Mở Màn    /
    Chọn Món    Trà đá
    Chờ Thấy Chữ    5.000 đ

Giá nhập cao hơn giá bán chỉ cảnh báo chứ vẫn lưu được
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    Món bán lỗ
    Điền Ô    Giá bán *    10000
    Điền Ô    Giá nhập (tuỳ chọn)    15000
    Chờ Thấy Chữ    Giá nhập
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    Món bán lỗ

Ngừng bán thì món biến khỏi lưới bán hàng nhưng còn trong danh mục
    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Cà phê sữa")
    Bấm Nút    Ngừng bán mặt hàng này

    Chờ Thấy Chữ    Ngừng bán
    Chờ Thấy Chữ    4 món

    Mở Màn    /
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Cà phê sữa")    detached

Bán lại món đã ngừng thì nó về lại lưới bán hàng
    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Cà phê sữa")
    Bấm Nút    Ngừng bán mặt hàng này
    Chờ Thấy Chữ    Ngừng bán

    Click    css=button:has-text("Cà phê sữa")
    Bấm Nút    Bán lại mặt hàng này
    # Form chỉ điều hướng sau khi updateItem hoàn tất; không cắt ngang lần ghi đó bằng Go To kế tiếp.
    Wait For Condition    Url    ==    ${BASE_URL}/them/mat-hang

    Mở Màn    /
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Cà phê sữa")    visible

Xoá mặt hàng phải qua hộp xác nhận
    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Trà đá")
    Bấm Nút    Xoá hẳn
    Chờ Hộp Xác Nhận    Xoá mặt hàng?
    Bỏ Qua Hộp Xác Nhận

    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    4 món
    Chờ Thấy Chữ    Trà đá

Xoá mặt hàng chưa từng bán thì danh mục còn lại đúng số món
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    Món xoá thử
    Điền Ô    Giá bán *    12000
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    5 món

    Click    css=button:has-text("Món xoá thử")
    Bấm Nút    Xoá hẳn
    Xác Nhận Trong Hộp    Xoá

    Chờ Thấy Chữ    4 món
    Không Được Thấy Chữ    Món xoá thử

Món đã từng bán thì không xoá được, chỉ ngừng bán
    [Documentation]    Xoá món đã bán là làm rỗng ruột phiếu cũ — tên và giá lúc bán nằm ở dòng đơn,
    ...    nhưng người bán vẫn cần món còn trong danh mục để đối chiếu. App phải chặn và nói rõ lý do.
    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Trà đá")
    Bấm Nút    Xoá hẳn
    Xác Nhận Trong Hộp    Xoá

    Chờ Thấy Chữ    hãy chọn "Ngừng bán" thay vì xoá
    Mở Màn    /them/mat-hang
    Chờ Thấy Chữ    4 món
    Chờ Thấy Chữ    Trà đá

Tìm mặt hàng lọc đúng theo tên không dấu
    Mở Màn    /them/mat-hang
    Fill Text    css=input[type=search]    pho
    Chờ Thấy Chữ    Phở bò đặc biệt
    Không Được Thấy Chữ    Cà phê sữa

Tìm không ra thì báo rõ chứ không để danh sách trống trơn
    Mở Màn    /them/mat-hang
    Fill Text    css=input[type=search]    khongcomon
    Chờ Thấy Chữ    Không có mặt hàng nào khớp

Đổi nhóm của mặt hàng thì lọc theo nhóm ở màn Bán hàng đi theo
    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Trà đá")
    Select Options By    css=select[aria-label="Nhóm"]    label    Đồ ăn
    Bấm Nút    LƯU MẶT HÀNG

    Mở Màn    /
    Click    css=button:has-text("Đồ ăn")
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Trà đá")    visible
