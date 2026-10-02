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
    # Form chỉ điều hướng sau khi updateItem hoàn tất; chờ mốc đó trước khi mở màn Bán hàng.
    Wait For Condition    Url    ==    ${BASE_URL}/them/mat-hang

    Mở Màn    /
    Click    css=button:has-text("Đồ ăn")
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Trà đá")    visible

Thực đơn tuỳ chọn của nhóm: lựa chọn trùng nhóm Đá có sẵn bị chặn kèm lý do, sổ không ghi gì
    [Documentation]    Nhãn lựa chọn lưu phẳng trên dòng đơn nên mỗi nhãn chỉ được thuộc một nhóm; "Đá riêng"
    ...    đã nằm ở nhóm Đá có sẵn. Chặn ở màn cài đặt thay vì để bấm nhóm này gỡ nhầm lựa chọn nhóm kia.
    Mở Màn    /them/nhom-mat-hang
    Click    css=button:has-text("Đồ uống")
    Bấm Nút    Tuỳ chọn & topping
    Bấm Nút    ＋ Thêm nhóm tuỳ chọn
    Điền Ô    Tên nhóm tuỳ chọn 1    Kiểu đá
    Điền Ô    Các lựa chọn của nhóm 1    Đá riêng
    Click    css=[role=dialog] >> css=button:text-is("LƯU")
    Chờ Thấy Chữ    chỉ thuộc một nhóm
    ${nhóm}=    Đọc Bảng    itemGroups
    ${đồ_uống}=    Evaluate    [g for g in $nhóm if g['name'] == 'Đồ uống'][0]
    Should Be Equal    ${đồ_uống}[optionGroups]    ${{ [] }}    Lựa chọn trùng vẫn ghi xuống sổ.

Thực đơn của nhóm hiện ở màn Bán hàng: món trong nhóm có topping, món ngoài nhóm thì không
    Cài Thực Đơn Đồ Uống
    Mở Màn    /
    Chọn Món    Cà phê sữa
    Click    css=button[aria-label="Sửa Cà phê sữa"]
    Chờ Thấy Chữ    Trân châu
    Chọn Chip    Ít đường
    Bấm Nút    XONG

    Chọn Món    Phở bò
    Click    css=button[aria-label="Sửa Phở bò đặc biệt"]
    Chờ Thấy Chữ    Đá chung
    Get Element Count    css=button[aria-label="Thêm Trân châu"]    ==    0
    Get Element Count    css=button[aria-pressed]:text-is("Ít đường")    ==    0

Gõ giá bán vượt 999.999.999 thì ô giữ số cũ, bán món đó không làm sập màn Bán hàng
    [Documentation]    Giá bán từng không có trần: lưu được 5.000.000.000.000.000 đ, chạm món hai lần là
    ...    `đơn giá × qty` vượt số nguyên an toàn, `assertMoney` ném trong render và ErrorBoundary nuốt cả
    ...    màn Bán hàng cùng đơn đang lên dở. Giờ phím làm vượt trần bị bỏ, ô giữ số cũ.
    [Tags]    regression
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    Mâm cỗ
    Điền Ô    Giá bán *    999999999
    ${ô_giá}=    Ô Theo Nhãn    Giá bán *
    Type Text    ${ô_giá}    0    clear=${False}
    Chờ Thấy Chữ    Tối đa 999.999.999 đ.
    ${giá}=    Đọc Ô    Giá bán *
    Should Be Equal    ${giá}    999.999.999    Phím thứ mười vẫn lọt vào ô giá bán.
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    5 món

    ${mặt_hàng}=    Đọc Bảng    items
    ${món}=    Evaluate    next(row for row in $mặt_hàng if row['name'] == 'Mâm cỗ')
    Should Be Equal As Integers    ${món}[unitPrice]    999999999    Sổ ghi sai giá của món vừa thêm.

    Mở Màn    /
    Chọn Món    Mâm cỗ    2
    Chờ Thấy Chữ    1.999.999.998 đ
    Không Được Thấy Chữ    App đang gặp lỗi
