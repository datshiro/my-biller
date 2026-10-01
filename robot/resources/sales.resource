*** Settings ***
Documentation    Thao tác trên màn Bán hàng — dùng lại ở suite Bán hàng, Đơn hàng, Công nợ, Báo cáo.
Resource         app.resource

*** Variables ***
${SHEET_THU_TIỀN}       css=[role=dialog][aria-label="Thu tiền"]
${NÚT_XONG}             css=button:has-text("XONG & XUẤT PHIẾU")
${NÚT_CHỌN_KHÁCH_NỢ}    css=button:has-text("CHỌN KHÁCH ĐỂ GHI NỢ")
${KHOÁ_NHÁP_GIỎ}        my-biller:cart-draft
${NÚT_KHÁCH_TRÊN_ĐẦU}    css=header >> css=button:has-text("KHÁCH")

*** Keywords ***
Chọn Món
    [Documentation]    Chạm ô mặt hàng trong lưới. Mỗi lần chạm thêm 1 vào giỏ.
    [Arguments]    ${tên}    ${lần}=1
    FOR    ${i}    IN RANGE    ${lần}
        Click    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("${tên}")
    END

Gõ Vào Ô Tìm Món
    [Arguments]    ${chữ}
    Fill Text    css=input[type=search]    ${chữ}

Mở Sheet Thu Tiền
    Click    ${NÚT_THU_TIỀN}
    Wait For Elements State    ${SHEET_THU_TIỀN}    visible

Chọn Hình Thức Trả
    [Documentation]    "Tiền mặt" | "Chuyển khoản" | "Bán nợ"
    [Arguments]    ${hình_thức}
    Click    ${SHEET_THU_TIỀN} >> css=button:has-text("${hình_thức}")

Hình Thức Đang Chọn
    [Arguments]    ${hình_thức}
    ${trạng_thái}=    Get Attribute
    ...    ${SHEET_THU_TIỀN} >> css=button:has-text("${hình_thức}")    aria-pressed
    RETURN    ${trạng_thái}

Điền Tiền Khách Đưa
    [Arguments]    ${số_tiền}
    Điền Ô    Khách đưa    ${số_tiền}

Chốt Đơn
    [Documentation]    Bấm XONG rồi chờ app nhảy sang màn phiếu — đó là dấu hiệu đơn đã ghi xong.
    ...    Chỉ mỗi route phiếu tận cùng bằng `/phieu`, nên `contains` là đủ chặt.
    Click    ${NÚT_XONG}
    Wait For Condition    Url    contains    /phieu

Chọn Khách Trong Sheet
    [Arguments]    ${tên}
    Click    css=[role=dialog] >> css=button:has-text("${tên}")

Chờ Nháp Giỏ Được Lưu
    [Documentation]    `useCart` hoãn 300ms mới ghi nháp. Tải lại trang sớm hơn là chưa có gì để
    ...    khôi phục — chờ đúng thứ mình đang kiểm thay vì ngủ một khoảng đoán mò.
    LocalStorage Get Item    ${KHOÁ_NHÁP_GIỎ}    !=    ${None}

Nháp Giỏ Phải Trống
    LocalStorage Get Item    ${KHOÁ_NHÁP_GIỎ}    ==    ${None}

Thêm Mặt Hàng
    [Documentation]    Thêm một món qua đúng form người bán dùng. Ở chung đây vì hai suite cần nó
    ...    (mat-hang lẫn khach-hang); chép vào từng suite là mỗi lần đổi nhãn ô lại phải sửa hai chỗ,
    ...    mà suite đỏ lại chỉ về màn không hề đổi.
    ...    Bỏ trống `${đơn_vị}` là món không có đơn vị — bộ dữ liệu mẫu không có món nào như vậy.
    [Arguments]    ${tên}    ${giá_bán}    ${đơn_vị}=${EMPTY}
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    ${tên}
    Điền Ô    Giá bán *    ${giá_bán}
    IF    "${đơn_vị}" != ""
        Chọn Chip    ${đơn_vị}
    END
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    ${tên}

Đặt Giá Sỉ
    [Documentation]    Đặt giá riêng cho một món của một khách, đi đúng đường người bán đi:
    ...    Khách hàng → chi tiết → Bảng giá sỉ. Không cấy thẳng vào IndexedDB, vì ca dùng nó
    ...    cần biết cả hai màn còn khớp nhau.
    [Arguments]    ${tên_khách}    ${tên_món}    ${giá}
    Mở Màn    /them/khach-hang
    Click    css=button:has-text("${tên_khách}")
    Bấm Nút    Bảng giá sỉ
    Chờ Thấy Chữ    Để trống là bán giá lẻ
    Điền Ô    ${tên_món}    ${giá}
    Bấm Nút    LƯU BẢNG GIÁ
    Chờ Thấy Chữ    món có giá riêng

Bật Giá Sỉ Cho Khách
    [Documentation]    Chạm SỈ khi chưa có khách thì app mở màn chọn khách trước — hai bước này
    ...    luôn đi liền nhau.
    [Arguments]    ${tên}
    Chọn Chip    SỈ
    Chọn Khách Trong Sheet    ${tên}

Bán Nhanh
    [Documentation]    Một lượt bán tiền mặt trả đủ. Dùng khi test cần "có sẵn một đơn" chứ không kiểm luồng bán.
    [Arguments]    ${tên_món}    ${lần}=1
    Mở Màn    /
    Chọn Món    ${tên_món}    ${lần}
    Mở Sheet Thu Tiền
    Chốt Đơn

Bán Nhanh Rồi Huỷ Và Trả Lại Tiền
    [Documentation]    Bán tiền mặt cho khách lẻ, huỷ đơn ngay tại chi tiết đơn rồi bấm "Đã trả lại khách".
    ...    Ba bước chờ giữa các hộp là bắt buộc — bỏ một bước là bấm vào hộp chưa mở. Trả về dict đơn
    ...    vừa bán để ca gọi đối chiếu bảng payments.
    [Arguments]    ${tên_món}
    Bán Nhanh    ${tên_món}
    ${đơn}=    Đơn Mới Nhất
    Mở Chi Tiết Đơn Mới Nhất
    Bấm Nút    Huỷ đơn
    Chờ Hộp Xác Nhận    Huỷ đơn này?
    Chờ Thấy Chữ    xử lý ngay tại chi tiết đơn
    Xác Nhận Trong Hộp    Huỷ đơn
    Chờ Thấy Chữ    Khoản thu chờ xử lý
    Bấm Nút    Đã trả lại khách
    Chờ Hộp Xác Nhận    Đã trả lại tiền cho khách?
    Xác Nhận Trong Hộp    Xác nhận
    # Nút "Đã trả lại khách" trùng chữ với nhãn trạng thái sau khi hoàn; phải chờ cặp nút biến mất mới
    # chắc phiếu đã được ghi lại — chờ chữ trùng đó là chờ trống, và Go To ngay sau có thể cắt ngang ghi.
    Không Được Thấy Chữ    Bỏ có ghi vết
    Chờ Thấy Chữ    Đã trả lại khách
    RETURN    ${đơn}

Bán Nợ Cho Khách
    [Documentation]    Bán ghi nợ toàn bộ cho một khách đã có sẵn.
    [Arguments]    ${tên_món}    ${tên_khách}
    Mở Màn    /
    Chọn Món    ${tên_món}
    Mở Sheet Thu Tiền
    Chọn Hình Thức Trả    Bán nợ
    Click    ${NÚT_CHỌN_KHÁCH_NỢ}
    Chọn Khách Trong Sheet    ${tên_khách}
    Chốt Đơn

Gõ Số Lượng
    [Documentation]    Ô số lượng inline trong giỏ. Ô này KHÔNG có <label> (hàng dưới của dòng giỏ
    ...    không đủ chỗ ở 320px — xem comment cart-lines.tsx), nên `Điền Ô` bám <label> lái không tới.
    ...    `Type Text` gõ TỪNG PHÍM để đi đúng đường commit-theo-phím của app; `Fill Text` chỉ bắn một
    ...    sự kiện `input` nên không đo được đường đó — mà chính đường đó là chỗ "1.000" hoá thành 1.
    [Arguments]    ${tên_món}    ${số}
    Type Text    ${{ 'css=input[aria-label="Số lượng %s"]' % $tên_món }}    ${số}    clear=True

Bớt Một
    [Documentation]    `aria-label="Bớt một"` giống nhau ở MỌI dòng giỏ, nên phải neo theo ô số lượng
    ...    của đúng dòng đó — bốc thẳng theo nhãn là strict-mode violation ngay khi giỏ có hai món.
    [Arguments]    ${tên_món}
    Click    ${{ 'css=li:has(input[aria-label="Số lượng %s"]) button[aria-label="Bớt một"]' % $tên_món }}

Đọc Số Lượng
    [Arguments]    ${tên_món}
    ${giá_trị}=    Get Property    ${{ 'css=input[aria-label="Số lượng %s"]' % $tên_món }}    value
    RETURN    ${giá_trị}

Cài Thực Đơn Đồ Uống
    [Documentation]    Cài nhóm Đồ uống đúng đường chủ quán đi: Nhóm mặt hàng › nhóm › Tuỳ chọn & topping.
    ...    Một nhóm tuỳ chọn (Đường: Ít đường, Không đường) và hai topping (Trân châu 5.000, Thạch 3.000).
    ...    Chờ lưu xong bằng cách đọc lại sổ, không đoán theo thời gian.
    Mở Màn    /them/nhom-mat-hang
    Click    css=button:has-text("Đồ uống")
    Bấm Nút    Tuỳ chọn & topping
    Bấm Nút    ＋ Thêm nhóm tuỳ chọn
    Điền Ô    Tên nhóm tuỳ chọn 1    Đường
    Điền Ô    Các lựa chọn của nhóm 1    Ít đường, Không đường
    Bấm Nút    ＋ Thêm topping
    Điền Ô    Tên topping 1    Trân châu
    Điền Ô    Giá topping 1    5000
    Bấm Nút    ＋ Thêm topping
    Điền Ô    Tên topping 2    Thạch
    Điền Ô    Giá topping 2    3000
    Click    css=[role=dialog] >> css=button:text-is("LƯU")
    Wait Until Keyword Succeeds    20x    250ms    Nhóm Đồ Uống Phải Có Thực Đơn

Nhóm Đồ Uống Phải Có Thực Đơn
    ${nhóm}=    Đọc Bảng    itemGroups
    ${đồ_uống}=    Evaluate    [g for g in $nhóm if g['name'] == 'Đồ uống'][0]
    Should Be Equal    ${đồ_uống}[optionGroups]    ${{ [{'name': 'Đường', 'choices': ['Ít đường', 'Không đường']}] }}
    ${menu}=    Evaluate    [(t['name'], t['price']) for t in $đồ_uống['toppingMenu']]
    Should Be Equal    ${menu}    ${{ [('Trân châu', 5000), ('Thạch', 3000)] }}

Bán Hai Ly Cà Phê Có Topping
    [Documentation]    Hai ly cà phê sữa (20.000) + Ít đường + trân châu ×2 + thạch + ghi chú "mang về":
    ...    mỗi ly 33.000, thành tiền 66.000. Cần đã cài thực đơn qua `Cài Thực Đơn Đồ Uống`.
    Mở Màn    /
    Chọn Món    Cà phê sữa
    Click    css=button[aria-label="Sửa Cà phê sữa"]
    Điền Ô    Số lượng    2
    Chọn Chip    Ít đường
    Click    css=button[aria-label="Thêm Trân châu"]
    Click    css=button[aria-label="Thêm Trân châu"]
    Click    css=button[aria-label="Thêm Thạch"]
    Điền Ô    Ghi chú    mang về
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn
