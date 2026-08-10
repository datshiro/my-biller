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
