*** Settings ***
Documentation       Màn Phiếu bán hàng — tờ giấy duy nhất khách nhìn thấy. Sai ở đây là sai trước
...                 mặt khách, nên kiểm cả nội dung lẫn việc ảnh PNG có dựng nổi trên trình duyệt thật.
Resource            ../resources/app.resource
Resource            ../resources/sales.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           phieu


*** Variables ***
${LINES_PER_PAGE}    10
${NÚT_ẢNH_PHIẾU}    css=button:has-text("CHIA SẺ QUA ZALO"), button:has-text("TẢI ẢNH PHIẾU")

# Token `--color-ink` (src/styles/index.css). Máy in nhiệt chỉ có đen hoặc trắng, nên mọi chữ trên
# phiếu phải ra đúng màu này — bất kỳ giá trị nào khác là một vùng bị dither thành chấm thưa.
${MÀU_MỰC}          rgb(20, 24, 29)
${ĐỊA_CHỈ_PHIẾU}    css=.receipt-view p:text-is("12 Lê Lợi, Q1")
${HEADER_BẢNG}      css=.receipt-view thead th >> nth=0
${Ô_TÊN_MÓN}        css=.receipt-view tbody td >> nth=0
${GHI_CHÚ_ĐƠN}      css=.receipt-view p:has-text("Ghi chú:")
${CHÂN_PHIẾU}       css=.receipt-view p:text-is("Cảm ơn quý khách!")
${DÒNG_TỔNG_CỘNG}    css=.receipt-view span:text-is("Tổng cộng")


*** Test Cases ***
Phiếu hiện đủ đầu phiếu: tên quán, số phiếu, khách và giờ bán
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    QUÁN CƠM BÀ TƯ
    Chờ Thấy Chữ    12 Lê Lợi, Q1
    Chờ Thấy Chữ    0909 123 456
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    Chờ Thấy Chữ    Khách lẻ

    ${đơn}=    Đơn Mới Nhất
    Chờ Thấy Chữ    Số: ${đơn}[code]

Phiếu liệt kê từng dòng hàng kèm số lượng, đơn giá và thành tiền
    Mở Màn    /
    Chọn Món    Phở bò    2
    Chọn Món    Trà đá
    Mở Sheet Thu Tiền
    Chốt Đơn

    Chờ Thấy Chữ    MẶT HÀNG
    Chờ Thấy Chữ    Phở bò đặc biệt
    Chờ Thấy Chữ    (tô)
    Chờ Thấy Chữ    Trà đá
    Chờ Thấy Chữ    110.000
    Chờ Thấy Chữ    113.000 đ

Đơn có giảm giá thì phiếu tách rõ tiền hàng và phần giảm
    [Documentation]    Chỉ in mỗi số cuối thì khách không biết đã được bớt — tách dòng ra mới thuyết phục.
    Mở Màn    /
    Chọn Món    Phở bò
    Bấm Nút    Giảm giá / phụ thu
    Điền Ô    Giảm giá    5000
    Bấm Nút    ÁP DỤNG
    Mở Sheet Thu Tiền
    Chốt Đơn

    Chờ Thấy Chữ    Hàng
    Chờ Thấy Chữ    55.000 đ
    Chờ Thấy Chữ    Giảm giá
    Chờ Thấy Chữ    Tổng cộng
    Chờ Thấy Chữ    50.000 đ

Đơn trả đủ thì phiếu ghi đã trả và không có dòng còn nợ
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    Đã trả (tiền mặt)
    Không Được Thấy Chữ    Còn nợ

Đơn bán nợ thì phiếu ghi rõ còn nợ bao nhiêu
    Bán Nợ Cho Khách    Phở bò    Anh Hùng
    Chờ Thấy Chữ    Anh Hùng
    Chờ Thấy Chữ    Còn nợ
    Chờ Thấy Chữ    55.000 đ

Ghi chú của đơn lên phiếu cho khách đọc được
    Bán Nhanh    Trà đá
    ${đơn}=    Đơn Mới Nhất
    Mở Màn    /don/${đơn}[id]
    Điền Ô    Ghi chú    Giao trước 5 giờ
    Bấm Nút    Lưu ghi chú
    Bấm Nút    XEM PHIẾU

    Chờ Thấy Chữ    Ghi chú: Giao trước 5 giờ

Chưa đặt tên quán thì phiếu mời thêm tên chứ không in dòng trống
    Xoá Thông Tin Quán
    Bán Nhanh    Trà đá
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    Không Được Thấy Chữ    QUÁN CƠM BÀ TƯ
    Chờ Thấy Chữ    Thêm tên quán vào phiếu

Đơn nhiều món thì phiếu tự chia trang và nút nói trước là mấy tấm
    [Documentation]    Quá ${LINES_PER_PAGE} dòng là phiếu tách tấm. Người bán phải biết mình sắp gửi
    ...    mấy tấm ảnh **trước** khi Zalo mở ra, nên số tấm nằm ngay trên nút.
    FOR    ${i}    IN RANGE    1    8
        Thêm Nhanh Mặt Hàng    Món số ${i}    ${i}000
    END

    Mở Màn    /
    Chọn Món    Phở bò
    Chọn Món    Cơm tấm
    Chọn Món    Trà đá
    Chọn Món    Cà phê
    FOR    ${i}    IN RANGE    1    8
        Chọn Món    Món số ${i}
    END
    Mở Sheet Thu Tiền
    Chốt Đơn

    Chờ Thấy Chữ    Trang 1/2
    Chờ Thấy Chữ    còn tiếp
    Chờ Thấy Chữ    Trang 2/2
    # Số tấm chỉ lên nhãn khi ảnh đã dựng xong — hai lần chụp canvas nên chờ rộng tay hơn.
    Wait For Elements State    css=button:has-text("(2 tấm)")    visible    timeout=45s

Trình duyệt thật dựng được ảnh phiếu để gửi đi
    [Documentation]    Nút đứng mãi ở "Đang chuẩn bị ảnh…" nghĩa là `renderReceiptPng` chết trên máy
    ...    thật — bộ test jsdom không bao giờ thấy được ca này. Linux Chrome không có Web Share API
    ...    nên app phải cho tải ảnh; trình duyệt hỗ trợ chia sẻ thì hiện nút Zalo.
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    Đang chuẩn bị ảnh
    Wait For Elements State    ${NÚT_ẢNH_PHIẾU}    visible    timeout=30s
    Wait For Elements State    ${NÚT_ẢNH_PHIẾU}    enabled
    Không Được Thấy Chữ    Không tạo được ảnh phiếu trên máy này

Từ phiếu bấm Chi tiết là sang trang chi tiết đơn
    Bán Nhanh    Phở bò
    Click    css=a:has-text("Chi tiết")
    Wait For Condition    Url    contains    /don/
    Chờ Thấy Chữ    MẶT HÀNG

Bấm quay lại từ phiếu thì không rơi ngược vào giỏ vừa bán
    [Documentation]    Phiếu thay chỗ màn Bán hàng trong lịch sử (`replace`), nên quay lại là về màn
    ...    đứng trước lúc bán. Rơi đúng vào giỏ vừa chốt mới là nguy: rất dễ bấm bán thêm lần nữa.
    Mở Màn    /don
    Click    ${NAV_BAN}
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Chốt Đơn

    Click    css=button[aria-label="Quay lại"]
    Chờ Thấy Chữ    Đơn hàng
    Wait For Elements State    ${NÚT_THU_TIỀN}    detached

Mở phiếu của đơn không tồn tại thì báo rõ và có lối về
    Mở Màn    /don/999999/phieu
    Chờ Thấy Chữ    Không tìm thấy đơn này
    Bấm Nút    Về danh sách đơn
    Chờ Thấy Chữ    Đơn hàng


Phiếu của khách còn nợ đơn cũ thì gộp thành một bill có nợ cũ và tổng phải trả
    Bán Nợ Cho Khách    Phở bò    Anh Hùng

    Chờ Thấy Chữ    Còn nợ
    Chờ Thấy Chữ    Nợ cũ
    Chờ Thấy Chữ    100.000 đ
    Chờ Thấy Chữ    TỔNG PHẢI TRẢ
    Chờ Thấy Chữ    155.000 đ

    # Bộ mẫu cho Anh Hùng nợ sẵn 100.000 (đơn 2: total 150.000, thu 50.000 — src/db/seed.ts).
    # Đối chiếu thẳng sổ: con số trên phiếu phải bằng tổng nợ THẬT của khách, không đếm đôi đơn
    # đang in. Giao diện hiện đúng mà sổ ghi sai là kiểu hỏng tệ nhất của app này.
    ${khách}=    Đọc Bảng    customers
    ${hùng}=    Evaluate    [c for c in $khách if c['name'] == 'Anh Hùng'][0]
    ${đơn}=    Đọc Bảng    orders
    # `${hùng}[id]` chứ không `$hùng['id']`: bên trong generator expression, Robot chỉ thấy globals
    # nên biến `$…` của scope ngoài khuất mất. `$đơn` thì được — iterable ngoài cùng vẫn tính ở scope này.
    ${nợ}=    Evaluate
    ...    sum(max(0, o['total'] - o['paidAmount']) for o in $đơn if o['customerId'] == ${hùng}[id] and o['status'] != 'void')
    Should Be Equal As Integers    ${nợ}    155000
    ...    Phiếu ghi tổng phải trả khác tổng nợ trong sổ — người bán sẽ đòi sai số tiền.

Phiếu của khách nợ cũ mà đơn này trả đủ thì gộp một dòng, không in hai dòng trùng số
    [Documentation]    Đơn hôm nay trả đủ nên không góp đồng nào vào nợ: "Nợ cũ" và "TỔNG PHẢI TRẢ"
    ...    ra ĐÚNG một con số. Hai dòng trùng nhau trên tờ giấy đưa tận tay khách đọc như lỗi in.
    ...    Gộp, nhưng KHÔNG bỏ trơn dòng nợ cũ — "TỔNG PHẢI TRẢ" đứng một mình ngay dưới "Đã trả"
    ...    sẽ bị đọc thành tổng của đơn hôm nay, mà 100.000 chẳng liên quan gì tới đơn này.
    Mở Màn    /
    Chọn Món    Phở bò
    Click    ${NÚT_KHÁCH_TRÊN_ĐẦU}
    Chọn Khách Trong Sheet    Anh Hùng
    Mở Sheet Thu Tiền
    Chốt Đơn

    Chờ Thấy Chữ    NỢ CŨ CÒN LẠI
    Chờ Thấy Chữ    100.000 đ
    Không Được Thấy Chữ    TỔNG PHẢI TRẢ
    Không Được Thấy Chữ    Còn nợ

    # Bộ mẫu cho Anh Hùng nợ sẵn 100.000 (đơn 2: total 150.000, thu 50.000 — src/db/seed.ts). Đơn
    # vừa bán trả đủ nên nợ THẬT không đổi. Đối chiếu thẳng sổ: con số gộp trên phiếu là tiền, và
    # giao diện hiện đúng mà sổ ghi sai là kiểu hỏng tệ nhất của app này.
    ${khách}=    Đọc Bảng    customers
    ${hùng}=    Evaluate    [c for c in $khách if c['name'] == 'Anh Hùng'][0]
    ${đơn}=    Đọc Bảng    orders
    ${nợ}=    Evaluate
    ...    sum(max(0, o['total'] - o['paidAmount']) for o in $đơn if o['customerId'] == ${hùng}[id] and o['status'] != 'void')
    Should Be Equal As Integers    ${nợ}    100000
    ...    Con số gộp trên phiếu phải bằng tổng nợ thật của khách trong sổ.

Phiếu khách lẻ không có dòng nợ cũ
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    Chờ Thấy Chữ    Khách lẻ
    Không Được Thấy Chữ    Nợ cũ
    Không Được Thấy Chữ    TỔNG PHẢI TRẢ

Đơn nợ đầu tiên của một khách thì phiếu chỉ có Còn nợ, không có dòng nợ cũ rỗng
    [Documentation]    Không dùng Anh Hùng được: bộ mẫu đã cho anh ấy nợ sẵn 100.000.
    Thêm Nhanh Khách    Chị Mai
    Bán Nợ Cho Khách    Trà đá    Chị Mai

    Chờ Thấy Chữ    Chị Mai
    Chờ Thấy Chữ    Còn nợ
    Chờ Thấy Chữ    3.000 đ
    Không Được Thấy Chữ    Nợ cũ
    # Nợ của đơn này ĐÃ là toàn bộ nợ của khách, nên khối gộp không có gì để nói thêm.
    Không Được Thấy Chữ    TỔNG PHẢI TRẢ

    ${khách}=    Đọc Bảng    customers
    ${mai}=    Evaluate    [c for c in $khách if c['name'] == 'Chị Mai'][0]
    ${đơn}=    Đọc Bảng    orders
    ${nợ}=    Evaluate
    ...    sum(max(0, o['total'] - o['paidAmount']) for o in $đơn if o['customerId'] == ${mai}[id])
    Should Be Equal As Integers    ${nợ}    3000


Phiếu của đơn đã huỷ không đòi tiền, dù sổ vẫn ghi paidAmount 0
    [Documentation]    `voidOrder` đặt `paidAmount = 0` nên đơn huỷ nào cũng có `total - paidAmount`
    ...    dương, trong khi đơn huỷ thì không nợ ai. Nút XEM PHIẾU hiện cho cả đơn huỷ và phiếu không
    ...    có dấu "đã huỷ" nào, nên đây là tờ giấy khách thật sự cầm. Trước khi có khối nợ luỹ kế,
    ...    phiếu này in "Còn nợ"; giờ cổng gộp nợ còn làm nó in thêm "TỔNG PHẢI TRẢ 0 đ" bên cạnh.
    [Tags]    regression
    Bán Nợ Cho Khách    Phở bò    Anh Hùng
    ${đơn}=    Đơn Mới Nhất
    Mở Màn    /don/${đơn}[id]
    Chờ Thấy Chữ    MẶT HÀNG
    Bấm Nút    Huỷ đơn
    Chờ Hộp Xác Nhận    Huỷ đơn này?
    Xác Nhận Trong Hộp    Huỷ đơn
    Chờ Thấy Chữ    Đơn này đã huỷ

    Bấm Nút    🧾 XEM PHIẾU
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    Không Được Thấy Chữ    Còn nợ
    Không Được Thấy Chữ    Nợ cũ
    Không Được Thấy Chữ    TỔNG PHẢI TRẢ


Phiếu không còn chữ xám: địa chỉ, header bảng và ghi chú đều màu mực
    [Documentation]    Đầu in nhiệt là 1-bit, không có mức xám: nó dither `#5a6673` thành lưới chấm
    ...    thưa, và trên giấy nhiệt lưới đó đọc ra "chữ mờ" — đúng lời chủ quán kêu, có ảnh in thử
    ...    làm bằng. Không chữa được bằng "in đậm hơn", chỉ chữa được bằng bỏ hẳn màu xám khỏi phiếu.
    ...    Gỡ ca này là mở lại đúng lỗi khách đã kêu.
    [Tags]    regression
    Bán Nhanh    Phở bò
    ${đơn}=    Đơn Mới Nhất
    Mở Màn    /don/${đơn}[id]
    Điền Ô    Ghi chú    Giao trước 5 giờ
    Bấm Nút    Lưu ghi chú
    Bấm Nút    XEM PHIẾU
    Chờ Thấy Chữ    Ghi chú: Giao trước 5 giờ

    Get Style    ${ĐỊA_CHỈ_PHIẾU}    color    ==    ${MÀU_MỰC}
    Get Style    ${HEADER_BẢNG}    color    ==    ${MÀU_MỰC}
    Get Style    ${GHI_CHÚ_ĐƠN}    color    ==    ${MÀU_MỰC}
    Get Style    ${CHÂN_PHIẾU}    color    ==    ${MÀU_MỰC}

Phiếu dùng cỡ chữ nhỏ cho thân bảng và địa chỉ
    [Documentation]    Bộ cỡ chữ do chủ quán tự thực nghiệm trên chính máy in nhiệt 80mm rồi chốt.
    ...    Con số px là quyết định của khách, không phải hằng số chọn cho đẹp — đổi phải hỏi lại.
    Bán Nhanh    Phở bò
    Get Style    ${ĐỊA_CHỈ_PHIẾU}    font-size    ==    11px
    Get Style    ${Ô_TÊN_MÓN}    font-size    ==    11px
    Get Style    ${HEADER_BẢNG}    font-size    ==    10px
    Get Style    ${DÒNG_TỔNG_CỘNG}    font-size    ==    13px

Header cột đơn giá rút thành Đ.GIÁ
    [Documentation]    "Đơn giá" chiếm cột rộng nên cột tên món hẹp lại và tên dài vỡ thêm dòng.
    ...    Chuỗi viết hoa sẵn trong nguồn: Robot khớp text theo DOM, không theo `text-transform`.
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    Đ.GIÁ
    Không Được Thấy Chữ    Đơn giá

Ghi chú từng món hiện trên phiếu dưới tên món
    [Documentation]    Ghi chú từng dòng đã xuống sổ (ban-hang.robot) nhưng chưa từng lên tờ giấy
    ...    đưa bếp. Dòng note là dòng thứ ba trong ô tên món một cách CÓ CHỦ Ý — tiêu chí "tên món
    ...    không quá 2 dòng" chỉ tính phần tên.
    Mở Màn    /
    Chọn Món    Phở bò
    Click    css=button[aria-label="Sửa Phở bò đặc biệt"]
    Điền Ô    Ghi chú    Đá riêng
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn

    Chờ Thấy Chữ    Đá riêng


*** Keywords ***
Thêm Nhanh Mặt Hàng
    [Arguments]    ${tên}    ${giá}
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    ${tên}
    Điền Ô    Giá bán *    ${giá}
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    ${tên}

Xoá Thông Tin Quán
    [Documentation]    Lưu xong màn tự `navigate(-1)`. React tháo form ngay khi router đổi state,
    ...    nhưng trình duyệt commit cú lùi đó chậm hơn — chờ theo DOM là chờ hụt, đi tiếp lúc đó sẽ
    ...    cắt ngang chuyến lùi và lệnh điều hướng kế tiếp chết với ERR_ABORTED. Phải chờ theo URL.
    Mở Màn    /them/cai-dat
    Click    css=button:has-text("Thông tin cửa hàng")
    Điền Ô    Tên cửa hàng    ${EMPTY}
    Điền Ô    Địa chỉ    ${EMPTY}
    Điền Ô    Số điện thoại    ${EMPTY}
    Bấm Nút    LƯU THÔNG TIN
    Wait For Condition    Url    ==    ${BASE_URL}/them/cai-dat

Thêm Nhanh Khách
    [Arguments]    ${tên}
    Mở Màn    /them/khach-hang/moi
    Điền Ô    Tên khách hàng *    ${tên}
    Bấm Nút    LƯU KHÁCH HÀNG
    Chờ Thấy Chữ    ${tên}
