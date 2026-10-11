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

Nhóm Đường tạo từ mẫu gắn vào nhóm Đồ uống thì màn bán chọn sẵn 100% đường và dòng đơn ghi đúng nhãn
    [Documentation]    Mẫu Đường điền sẵn năm mức và mặc định 100%; gắn vào nhóm món là mọi món trong nhóm nhận nhóm đó.
    ...    Máy bản mới không ghi thực đơn kiểu cũ: trường cũ trên nhóm món chỉ do Worker chiếu ra cho máy bản cũ.
    Mở Màn    /them/nhom-lua-chon/moi
    Bấm Nút    Mẫu Đường
    Bấm Nút    LƯU NHÓM
    Wait For Condition    Url    ==    ${BASE_URL}/them/nhom-lua-chon
    Chờ Thấy Chữ    chọn một
    ${nhóm_lc}=    Đọc Bảng    optionGroups
    ${đường}=    Evaluate    [(g['kind'], g['choices'], g['defaultChoice'], g['maxSelect']) for g in $nhóm_lc]
    Should Be Equal    ${đường}
    ...    ${{ [('choice', ['0% đường', '30% đường', '50% đường', '70% đường', '100% đường'], '100% đường', 1)] }}
    Gắn Nhóm Lựa Chọn Vào Nhóm Món    Đồ uống    Đường
    ${nhóm}=    Đọc Bảng    itemGroups
    ${đồ_uống}=    Evaluate    [g for g in $nhóm if g['name'] == 'Đồ uống'][0]
    Should Be Equal    ${đồ_uống}[optionGroupGids]    ${{ [$nhóm_lc[0]['gid']] }}
    Should Be Equal    ${đồ_uống}[optionGroups]    ${{ [] }}    Máy bản mới không được ghi thực đơn kiểu cũ.
    Should Be Equal    ${đồ_uống}[toppingMenu]    ${{ [] }}    Máy bản mới không được ghi thực đơn kiểu cũ.

    Mở Màn    /
    Chọn Món    Cà phê sữa
    ${chọn_sẵn}=    Chip Đang Chọn    100% đường
    Should Be Equal    ${chọn_sẵn}    true
    Chọn Chip    50% đường
    Bấm Thêm Vào Đơn
    Mở Sheet Thu Tiền
    Chốt Đơn
    ${dòng}=    Đọc Bảng    orderLines
    ${ly}=    Evaluate    [d for d in $dòng if d['name'] == 'Cà phê sữa' and d.get('options')]
    Length Should Be    ${ly}    1
    Should Be Equal    ${ly}[0][options]    ${{ ['50% đường'] }}
    Should Be Equal As Integers    ${ly}[0][amount]    20000

Món topping chỉ bán kèm không lên lưới, đang nằm trong nhóm topping thì không xoá được, bật Bán riêng được thì lên lưới
    [Documentation]    "Bán riêng được" của món topping chính là `isActive`. Xoá món đang là topping trong nhóm đang dùng
    ...    là để lại một phần tử trỏ vào chỗ trống, nên bị chặn kèm tên nhóm.
    Thêm Món Topping    Thạch    3000
    Chờ Thấy Chữ    Chỉ bán kèm
    Tạo Nhóm Topping    Topping Đồ uống    Thạch
    Gắn Nhóm Lựa Chọn Vào Nhóm Món    Đồ uống    Topping Đồ uống
    Mở Màn    /
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Cà phê sữa")    visible
    Get Element Count    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Thạch")    ==    0

    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Thạch")
    Bấm Nút    Xoá hẳn
    Xác Nhận Trong Hộp    Xoá
    Chờ Thấy Chữ    đang là topping trong nhóm “Topping Đồ uống”
    Món Phải Còn    Thạch

    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Thạch")
    Chọn Chip    Bán riêng được
    Bấm Nút    LƯU MẶT HÀNG
    Wait For Condition    Url    ==    ${BASE_URL}/them/mat-hang
    ${món}=    Đọc Bảng    items
    ${thạch}=    Evaluate    [(m['kind'], m['isActive'], m['unitPrice']) for m in $món if m['name'] == 'Thạch']
    Should Be Equal    ${thạch}    ${{ [('topping', 1, 3000)] }}
    Mở Màn    /
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Thạch")    visible

Ghi chú nhanh chọn được nhiều mục; nhãn trùng nhóm Đá hay nhóm khác cùng món bị chặn; nhóm đang gắn không lưu trữ được
    [Documentation]    Dòng đơn lưu nhãn phẳng, nên hai nhóm gắn cùng một món không được trùng nhãn (kể cả với nhóm Đá có
    ...    sẵn): trùng thì chọn ở nhóm này làm chip nhóm kia sáng theo. Chặn cả lúc lưu nhóm lẫn lúc gắn nhóm.
    Mở Màn    /them/nhom-lua-chon/moi
    Bấm Nút    Mẫu Ghi chú nhanh
    Bấm Nút    LƯU NHÓM
    Wait For Condition    Url    ==    ${BASE_URL}/them/nhom-lua-chon
    Gắn Nhóm Lựa Chọn Vào Nhóm Món    Đồ uống    Ghi chú nhanh

    Mở Màn    /them/nhom-lua-chon/moi
    Điền Ô    Tên nhóm *    Kiểu đá
    Điền Ô    Các lựa chọn *    Đá riêng
    Bấm Nút    LƯU NHÓM
    Chờ Thấy Chữ    nhóm Đá có sẵn
    Bảng Phải Có Số Dòng    optionGroups    1

    Tạo Nhóm Tuỳ Chọn    Độ ngọt    Ít ngọt, Ngọt vừa
    Mở Màn    /them/nhom-mat-hang
    Click    css=li >> css=button:has-text("Đồ uống")
    Click    css=[role=dialog] >> css=button:has-text("Nhóm lựa chọn ›")
    Click    css=[role=dialog] >> css=[role=group][aria-label="Nhóm lựa chọn"] >> css=button:text-is("Độ ngọt")
    Click    css=[role=dialog] >> css=button:text-is("LƯU")
    Chờ Thấy Chữ    “Ít ngọt” có ở cả nhóm
    ${nhóm}=    Đọc Bảng    itemGroups
    ${đồ_uống}=    Evaluate    [g for g in $nhóm if g['name'] == 'Đồ uống'][0]
    Length Should Be    ${đồ_uống}[optionGroupGids]    1    Nhóm trùng nhãn vẫn được gắn.
    Keyboard Key    press    Escape

    Mở Màn    /them/nhom-lua-chon
    Click    css=li >> css=button:has-text("Ghi chú nhanh")
    Bấm Nút    Lưu trữ nhóm này
    Chờ Thấy Chữ    Nhóm đang gắn vào nhóm món “Đồ uống”

    Mở Màn    /
    Chọn Món    Cà phê sữa
    Chọn Chip    Không hành
    Chọn Chip    Ít ngọt
    # Không dùng `Bấm Thêm Vào Đơn`: chip "Thêm cay" của mẫu Ghi chú nhanh cũng chứa chữ THÊM.
    Click    ${SHEET} >> css=button:has-text("THÊM ·")
    Wait For Elements State    ${SHEET}    detached
    Mở Sheet Thu Tiền
    Chốt Đơn
    ${dòng}=    Đọc Bảng    orderLines
    ${ly}=    Evaluate    [d for d in $dòng if d['name'] == 'Cà phê sữa' and d.get('options')]
    Should Be Equal    ${ly}[0][options]    ${{ ['Không hành', 'Ít ngọt'] }}

Gắn nhóm lựa chọn thẳng vào món ở form món; trùng nhãn với nhóm của nhóm món bị chặn; món đang là topping không đổi về món thường được
    [Documentation]    Món nhận nhóm gắn thẳng vào nó cộng nhóm của nhóm món, nên hai bên không được trùng nhãn — chặn
    ...    ngay ở form món, sổ không ghi gì. Món đang nằm trong nhóm topping mà đổi về món thường thì nhóm đó trỏ vào một
    ...    món màn bán không bán kèm được, nên cũng bị chặn kèm tên nhóm.
    Tạo Nhóm Tuỳ Chọn    Đường    Ít đường, Không đường
    Gắn Nhóm Lựa Chọn Vào Nhóm Món    Đồ uống    Đường
    Tạo Nhóm Tuỳ Chọn    Size    Nhỏ, Lớn
    Tạo Nhóm Tuỳ Chọn    Mức ngọt    Ít đường, Ngọt đầy

    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Cà phê sữa")
    Click    css=[role=group][aria-label="Nhóm lựa chọn"] >> css=button:text-is("Mức ngọt")
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    “Ít đường” có ở cả nhóm
    ${món}=    Đọc Bảng    items
    ${gắn}=    Evaluate    [m.get('optionGroupGids', []) for m in $món if m['name'] == 'Cà phê sữa'][0]
    Should Be Equal    ${gắn}    ${{ [] }}    Nhóm trùng nhãn vẫn được gắn vào món.

    Click    css=[role=group][aria-label="Nhóm lựa chọn"] >> css=button:text-is("Mức ngọt")
    Click    css=[role=group][aria-label="Nhóm lựa chọn"] >> css=button:text-is("Size")
    Bấm Nút    LƯU MẶT HÀNG
    Wait For Condition    Url    ==    ${BASE_URL}/them/mat-hang
    ${món}=    Đọc Bảng    items
    ${nhóm_lc}=    Đọc Bảng    optionGroups
    ${size}=    Evaluate    [g['gid'] for g in $nhóm_lc if g['name'] == 'Size']
    ${gắn}=    Evaluate    [m['optionGroupGids'] for m in $món if m['name'] == 'Cà phê sữa'][0]
    Should Be Equal    ${gắn}    ${size}
    Mở Màn    /
    Chọn Món    Cà phê sữa
    Wait For Elements State    css=button[aria-pressed]:text-is("Nhỏ")    visible
    Wait For Elements State    css=button[aria-pressed]:text-is("Ít đường")    visible
    Keyboard Key    press    Escape

    Thêm Món Topping    Thạch    3000
    Tạo Nhóm Topping    Topping Đồ uống    Thạch
    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Thạch")
    Chọn Chip    Là topping
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    gỡ khỏi nhóm trước khi đổi thành món thường
    ${món}=    Đọc Bảng    items
    ${thạch}=    Evaluate    [m['kind'] for m in $món if m['name'] == 'Thạch']
    Should Be Equal    ${thạch}    ${{ ['topping'] }}

Ghim món thì món lên ô đầu màn bán; bỏ ghim thì sổ ghi pinned 0 và món về chỗ cũ
    [Documentation]    Bỏ ghim phải ghi `pinned: 0` tường minh chứ không xoá khoá: thiếu khoá là "không biết", Worker
    ...    và gộp sao lưu sẽ giữ lại ghim cũ. Món đích là món không đứng đầu lưới, để thấy ghim thật sự đẩy nó lên.
    Mở Màn    /
    ${đầu_trước}=    Tên Ô Đầu Lưới Bán
    ${món}=    Đọc Bảng    items
    ${đích}=    Evaluate    [m for m in $món if m['isActive'] == 1 and m['name'] != $đầu_trước][0]

    Mở Màn    /them/mat-hang/${đích}[id]
    Bấm Nút    Ghim lên đầu màn bán
    Bấm Nút    LƯU MẶT HÀNG
    Wait For Condition    Url    ==    ${BASE_URL}/them/mat-hang
    Món Phải Có Ghim    ${đích}[gid]    1
    Mở Màn    /
    Ô Đầu Lưới Bán Phải Là    ${đích}[name]
    Get Element Count    ${LƯỚI_MẶT_HÀNG} >> css=[aria-label="Đã ghim"]    ==    1

    Mở Màn    /them/mat-hang/${đích}[id]
    Bấm Nút    Ghim lên đầu màn bán
    Bấm Nút    LƯU MẶT HÀNG
    Wait For Condition    Url    ==    ${BASE_URL}/them/mat-hang
    Món Phải Có Ghim    ${đích}[gid]    0
    Mở Màn    /
    Ô Đầu Lưới Bán Phải Là    ${đầu_trước}
    Get Element Count    ${LƯỚI_MẶT_HÀNG} >> css=[aria-label="Đã ghim"]    ==    0

Thực đơn của nhóm hiện ở màn Bán hàng: món trong nhóm có topping, món ngoài nhóm thì không
    Cài Thực Đơn Đồ Uống
    Mở Màn    /
    Chọn Món    Cà phê sữa
    Chờ Thấy Chữ    Trân châu
    Chọn Chip    Ít đường
    Bấm Thêm Vào Đơn

    Chọn Món    Phở bò
    Sửa Dòng    Phở bò đặc biệt
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

Đặt tên trùng một món có sẵn thì bị chặn, sổ không ghi món thứ hai
    [Documentation]    So không phân biệt hoa thường và bỏ dấu cách hai đầu. Món trùng đang ngừng bán cũng
    ...    tính: phiếu cũ của nó vẫn mang tên đó.
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    ${SPACE}phở BÒ đặc biệt${SPACE}
    Chờ Thấy Chữ    Đã có món “Phở bò đặc biệt”
    Điền Ô    Giá bán *    60000
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    Thêm mặt hàng
    ${mặt_hàng}=    Đọc Bảng    items
    Length Should Be    ${mặt_hàng}    4    Tên trùng vẫn lọt vào sổ thành món thứ hai.

    Điền Ô    Tên mặt hàng *    Phở bò tái
    Không Được Thấy Chữ    Đã có món
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    5 món

Sửa chính một món thì không bị chặn vì trùng tên của nó
    ${mặt_hàng}=    Đọc Bảng    items
    ${phở}=    Evaluate    next(row for row in $mặt_hàng if row['name'] == 'Phở bò đặc biệt')
    Mở Màn    /them/mat-hang/${phở}[id]
    Chờ Thấy Chữ    Sửa mặt hàng
    Điền Ô    Tên mặt hàng *    PHỞ BÒ ĐẶC BIỆT
    Không Được Thấy Chữ    Đã có món
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    PHỞ BÒ ĐẶC BIỆT
    ${sau}=    Đọc Bảng    items
    ${món}=    Evaluate    next(row for row in $sau if row['id'] == ${phở}[id])
    Should Be Equal    ${món}[name]    PHỞ BÒ ĐẶC BIỆT    Đổi hoa thường tên của chính món bị chặn nhầm.

Món đã trùng tên từ trước khi có luật chặn vẫn sửa được giá
    [Documentation]    Luật chặn trùng chỉ xét khi tên đổi. Xét cả lúc tên giữ nguyên thì sổ cũ đã có hai
    ...    món cùng tên sẽ kẹt: không sửa giá, không đổi nhóm được nữa. Giao diện không còn tạo được
    ...    món trùng, nên ca ghi thẳng bản trùng vào IndexedDB như một sổ cũ.
    ${id}=    Evaluate JavaScript    ${None}
    ...    async () => {
    ...        const db = await new Promise((resolve, reject) => {
    ...            const open = indexedDB.open('my-biller')
    ...            open.onsuccess = () => resolve(open.result)
    ...            open.onerror = () => reject(open.error)
    ...        })
    ...        const now = Date.now()
    ...        const id = await new Promise((resolve, reject) => {
    ...            const request = db.transaction('items', 'readwrite').objectStore('items').add({
    ...                gid: crypto.randomUUID(), name: 'Trà đá', groupId: null, unit: 'ly', unitPrice: 4000,
    ...                costPrice: null, isActive: 1, note: '', createdAt: now, updatedAt: now,
    ...            })
    ...            request.onsuccess = () => resolve(request.result)
    ...            request.onerror = () => reject(request.error)
    ...        })
    ...        db.close()
    ...        return id
    ...    }
    Mở Màn    /them/mat-hang/${id}
    Chờ Thấy Chữ    Sửa mặt hàng
    Không Được Thấy Chữ    Đã có món
    Điền Ô    Giá bán *    5000
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    5 món
    ${mặt_hàng}=    Đọc Bảng    items
    ${món}=    Evaluate    next(row for row in $mặt_hàng if row['id'] == ${id})
    Should Be Equal As Integers    ${món}[unitPrice]    5000    Món trùng tên từ trước không sửa được giá.

Bán lại món trùng tên với một món đang bán thì bị chặn và không ghi gì
    [Documentation]    Bấm "Bán lại mặt hàng này" mà tên trùng một món khác đang bán thì máy
    ...    chặn ngay trước khi ghi, không đợi một lượt đồng bộ Worker. Ca ghi thẳng một món "trà đá" ngừng
    ...    bán vào IndexedDB để giả dữ liệu có từ trước luật 2.9.0 — qua giao diện không tạo được món trùng.
    ${id}=    Chèn Món Cũ Trùng Tên    trà đá
    Mở Màn    /them/mat-hang/${id}
    Chờ Thấy Chữ    Sửa mặt hàng
    Bấm Nút    Bán lại mặt hàng này
    Chờ Thấy Chữ    Đã có món “Trà đá” đang bán
    Wait For Condition    Url    ==    ${BASE_URL}/them/mat-hang/${id}

    ${mặt_hàng}=    Đọc Bảng    items
    Length Should Be    ${mặt_hàng}    5
    ${món}=    Evaluate    next(row for row in $mặt_hàng if row['id'] == ${id})
    Should Be Equal As Integers    ${món}[isActive]    0
    ${trà_đá}=    Evaluate    next(row for row in $mặt_hàng if row['name'] == 'Trà đá')
    Should Be Equal As Integers    ${trà_đá}[isActive]    1

Bán lại món ngừng bán chỉ trùng tên với món ngừng bán khác thì được
    [Documentation]    Luật chặn chỉ xét món đang bán. Hai món cũ cùng tên đều đang ngừng bán thì bán lại
    ...    một món được, và món kia vẫn ngừng bán.
    ${id_cũ}=    Chèn Món Cũ Trùng Tên    Bánh bao
    ${id}=    Chèn Món Cũ Trùng Tên    Bánh bao
    Mở Màn    /them/mat-hang/${id}
    Chờ Thấy Chữ    Sửa mặt hàng
    Bấm Nút    Bán lại mặt hàng này
    Wait For Condition    Url    ==    ${BASE_URL}/them/mat-hang

    ${mặt_hàng}=    Đọc Bảng    items
    Length Should Be    ${mặt_hàng}    6
    ${món}=    Evaluate    next(row for row in $mặt_hàng if row['id'] == ${id})
    Should Be Equal As Integers    ${món}[isActive]    1
    ${món_cũ}=    Evaluate    next(row for row in $mặt_hàng if row['id'] == ${id_cũ})
    Should Be Equal As Integers    ${món_cũ}[isActive]    0    Món cũ cùng tên không được bật theo.


*** Keywords ***
Món Phải Còn
    [Arguments]    ${tên}
    ${món}=    Đọc Bảng    items
    ${khớp}=    Evaluate    [m for m in $món if m['name'] == $tên]
    Length Should Be    ${khớp}    1    Món “${tên}” không còn trong sổ.

Bảng Phải Có Số Dòng
    [Arguments]    ${bảng}    ${số_dòng}
    ${rows}=    Đọc Bảng    ${bảng}
    Length Should Be    ${rows}    ${số_dòng}

Chèn Món Cũ Trùng Tên
    [Documentation]    Ghi thẳng một món ngừng bán vào IndexedDB, giả dữ liệu trùng tên có từ trước luật
    ...    2.9.0 — form và nhập file đều chặn tên trùng nên không tạo lại được qua giao diện.
    [Arguments]    ${tên}
    ${id}=    Evaluate JavaScript    ${None}
    ...    async (tên) => {
    ...        const db = await new Promise((resolve, reject) => {
    ...            const open = indexedDB.open('my-biller')
    ...            open.onsuccess = () => resolve(open.result)
    ...            open.onerror = () => reject(open.error)
    ...        })
    ...        const now = Date.now()
    ...        const id = await new Promise((resolve, reject) => {
    ...            const request = db.transaction('items', 'readwrite').objectStore('items').add({
    ...                gid: crypto.randomUUID(), name: tên, groupId: null, unit: 'ly', unitPrice: 3000,
    ...                costPrice: null, isActive: 0, note: '', createdAt: now, updatedAt: now,
    ...            })
    ...            request.onsuccess = () => resolve(request.result)
    ...            request.onerror = () => reject(request.error)
    ...        })
    ...        db.close()
    ...        return id
    ...    }
    ...    arg=${tên}
    RETURN    ${id}
