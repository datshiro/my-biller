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
    Mở Đơn
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
    ...    2026-09-15: chủ quán gửi ảnh phiếu, kêu dòng tổng tiền nhỏ, xin to hơn → dòng tổng
    ...    (Row strong) đổi 13px thành 15px theo yêu cầu. Thân bảng/địa chỉ/header giữ nguyên vì
    ...    chủ quán chưa kêu. Cỡ 15px còn phải xác minh lại khi in thật trên SPR02.
    Bán Nhanh    Phở bò
    Get Style    ${ĐỊA_CHỈ_PHIẾU}    font-size    ==    11px
    Get Style    ${Ô_TÊN_MÓN}    font-size    ==    11px
    Get Style    ${HEADER_BẢNG}    font-size    ==    10px
    Get Style    ${DÒNG_TỔNG_CỘNG}    font-size    ==    15px

Header cột đơn giá rút thành Đ.GIÁ
    [Documentation]    "Đơn giá" chiếm cột rộng nên cột tên món hẹp lại và tên dài vỡ thêm dòng.
    ...    Chuỗi viết hoa sẵn trong nguồn: Robot khớp text theo DOM, không theo `text-transform`.
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    Đ.GIÁ
    Không Được Thấy Chữ    Đơn giá

Phiếu liệt kê từng topping kèm giá dưới tên món, đơn giá đã gồm topping nên SL × Đ.GIÁ ra T.tiền
    [Documentation]    Khách phải thấy vì sao ly cà phê 20.000 tính 33.000: từng topping một dòng kèm giá
    ...    một ly, rồi tuỳ chọn và ghi chú. Đọc chữ từ DOM phiếu chứ không tin ảnh chụp.
    Cài Thực Đơn Đồ Uống
    Bán Hai Ly Cà Phê Có Topping
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    ${ô}=    Evaluate JavaScript    css=.receipt-view tbody tr
    ...    (row) => [...row.querySelectorAll('td')].map((td) => td.textContent)
    Should Contain    ${ô}[0]    + Trân châu x2
    Should Contain    ${ô}[0]    10.000
    Should Contain    ${ô}[0]    + Thạch
    Should Contain    ${ô}[0]    3.000
    Should Contain    ${ô}[0]    Ít đường, mang về
    Should Be Equal    ${ô}[1]    2
    Should Be Equal    ${ô}[2]    33.000    Đ.GIÁ phải đã gồm topping (20.000 + 10.000 + 3.000).
    Should Be Equal    ${ô}[3]    66.000

Ghi chú từng món hiện trên phiếu dưới tên món
    [Documentation]    Ghi chú từng dòng đã xuống sổ (ban-hang.robot) nhưng chưa từng lên tờ giấy
    ...    đưa bếp. Dòng note là dòng thứ ba trong ô tên món một cách CÓ CHỦ Ý — tiêu chí "tên món
    ...    không quá 2 dòng" chỉ tính phần tên.
    Mở Màn    /
    Chọn Món    Phở bò
    Sửa Dòng    Phở bò đặc biệt
    Điền Ô    Ghi chú    Đá riêng
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn

    Chờ Thấy Chữ    Đá riêng

Bản in giữ khung 360px chứ không trải rộng theo màn hình
    [Documentation]    `.receipt-view{width:auto !important}` là dòng đã làm chữ in ra **3,44mm**
    ...    trong khi cùng phiếu đó ra ảnh chỉ 2,60mm: nó cắt đứt khung 360px khỏi đường
    ...    `window.print()`, nên bản in bố cục lại theo bề ngang màn hình và bẻ dòng ở chỗ khác hẳn
    ...    tấm ảnh gửi khách. Nới `RECEIPT_WIDTH` KHÔNG chữa được — nó chỉ chạm đường ảnh.
    ...    Giờ khung giữ nguyên 360px rồi `transform: scale()` xuống 72mm, nên hai đường dùng chung
    ...    đúng một lượt bố cục.
    [Tags]    regression
    [Teardown]    Trả Media Về Mặc Định
    Bán Nhanh    Phở bò
    Emulate Media    media=print

    Get Style    css=.receipt-view    width    ==    360px
    ${bề_ngang}=    Evaluate JavaScript    css=.receipt-view
    ...    (view) => view.getBoundingClientRect().width
    Should Be True    abs(${bề_ngang} - 272.1) < 1
    ...    Phần mực trên giấy phải rộng đúng 72mm (272,1px); đo được ${bề_ngang}px.

Phiếu có một bản nhiệt ẩn rộng 360px, không lẫn vào tấm gửi khách và không in ra giấy A4
    [Documentation]    Node ẩn KHÔNG mang .receipt-view: e2e và các ca trên đếm tấm gửi khách bằng
    ...    class đó. Wrapper là .no-print nên @media print giấu đi — không ra tờ A4 thừa. Phiên này
    ...    là UA desktop (không Android): nút TCP (data-tcp-print, native) LẪN link RawBT (a[data-rawbt],
    ...    web Android) đều phải vắng — web thường không in nhiệt được đường nào.
    [Teardown]    Trả Media Về Mặc Định
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    ${n_nhiệt}=    Evaluate JavaScript    ${None}    () => document.querySelectorAll('[data-thermal]').length
    Should Be Equal As Integers    ${n_nhiệt}    1
    ${n_tấm}=    Evaluate JavaScript    ${None}    () => document.querySelectorAll('.receipt-view').length
    Should Be Equal As Integers    ${n_tấm}    1
    ${n_tcp}=    Evaluate JavaScript    ${None}    () => document.querySelectorAll('button[data-tcp-print]').length
    Should Be Equal As Integers    ${n_tcp}    0
    ${n_rawbt}=    Evaluate JavaScript    ${None}    () => document.querySelectorAll('a[data-rawbt]').length
    Should Be Equal As Integers    ${n_rawbt}    0
    ${rộng}=    Evaluate JavaScript    css=[data-thermal]    (n) => n.offsetWidth
    Should Be Equal As Integers    ${rộng}    360
    Emulate Media    media=print
    ${hiện}=    Evaluate JavaScript    css=[data-thermal]    (n) => getComputedStyle(n.parentElement).display
    Should Be Equal    ${hiện}    none

Luồng byte in nhiệt của phiếu 25 dòng là ESC/POS raster 576 chấm một dải và kết bằng lệnh cắt
    [Documentation]    Bản dev có nút ⬇ .bin; đọc file thật để kiểm mở đầu 1B 40, có header GS v 0
    ...    (1D 76 30 00 48 00 = 72 byte/hàng), kết 1D 56 42 05 (cắt). Robot KHÔNG mở TCP — đường gửi
    ...    tới máy in đo bằng biên bản pha 5. Bỏ qua ở chế độ remote: Pages preview là bản production,
    ...    không có nút .bin.
    Skip If    '${BASE_URL}'.startswith('https')    Bản production không có nút .bin
    Dựng Đơn Nhiều Dòng    25
    ${dòng}=    Evaluate JavaScript    css=[data-thermal]    (n) => n.querySelectorAll('tbody tr').length
    Should Be Equal As Integers    ${dòng}    25
    ${file}=    Tải File Bằng Nút    ⬇ .bin
    ${bytes}=    Get Binary File    ${file}
    ${đầu}=    Evaluate    list($bytes[:2])
    Should Be Equal    ${đầu}    ${{ [27, 64] }}    Luồng byte không mở đầu bằng ESC @.
    ${cuối}=    Evaluate    list($bytes[-4:])
    Should Be Equal    ${cuối}    ${{ [29, 86, 66, 5] }}    Luồng byte không kết bằng lệnh cắt GS V 66 5.
    ${có_header}=    Evaluate    bytes([29, 118, 48, 0, 72, 0]) in $bytes
    Should Be True    ${có_header}    Không thấy header GS v 0 (1D 76 30 00 48 00) — sai khổ 72 byte/hàng.

Nút in nhiệt web Android hỏi xác nhận trước; nút In trong hộp là link rawbt: dựng sẵn, không bấm
    [Documentation]    CI không có app RawBT: chỉ ĐỌC href nút "In", KHÔNG Click (Chrome treo ở hộp "mở ứng
    ...    dụng"). Bấm IN MÁY IN NHIỆT chỉ MỞ hộp xác nhận (chống bấm nhầm); nút "In" là a[data-rawbt] tiền tố
    ...    rawbt:data:image/png;base64,. Web Android không có nút TCP (data-tcp-print chỉ có trong app native).
    [Setup]    Mở Phiên Android Có Dữ Liệu Mẫu
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    Wait For Elements State    css=button:has-text("IN MÁY IN NHIỆT")    visible    timeout=20s
    Bấm Nút    IN MÁY IN NHIỆT
    Chờ Hộp Xác Nhận    In phiếu ra máy in nhiệt?
    Wait For Elements State    css=a[data-rawbt]    visible    timeout=20s
    ${href}=    Get Attribute    css=a[data-rawbt]    href
    Should Start With    ${href}    rawbt:data:image/png;base64,
    ${n_tcp}=    Evaluate JavaScript    ${None}    () => document.querySelectorAll('button[data-tcp-print]').length
    Should Be Equal As Integers    ${n_tcp}    0

Nút IN MÁY IN NHIỆT chỉ mở hộp xác nhận; Huỷ đóng hộp, không dựng link rawbt
    [Documentation]    Nút xác nhận chặn cú bấm nhầm in phí giấy. Trước khi bấm chưa có a[data-rawbt]; bấm
    ...    IN MÁY IN NHIỆT mở hộp và dựng đúng một a[data-rawbt]; Huỷ đóng hộp và gỡ luôn anchor (không điều
    ...    hướng rawbt:). KHÔNG bấm nút "In".
    [Setup]    Mở Phiên Android Có Dữ Liệu Mẫu
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    Wait For Elements State    css=button:has-text("IN MÁY IN NHIỆT")    visible    timeout=20s
    ${n0}=    Evaluate JavaScript    ${None}    () => document.querySelectorAll('a[data-rawbt]').length
    Should Be Equal As Integers    ${n0}    0
    Bấm Nút    IN MÁY IN NHIỆT
    Chờ Hộp Xác Nhận    In phiếu ra máy in nhiệt?
    ${n1}=    Evaluate JavaScript    ${None}    () => document.querySelectorAll('a[data-rawbt]').length
    Should Be Equal As Integers    ${n1}    1
    Bỏ Qua Hộp Xác Nhận
    Wait For Elements State    css=[role=alertdialog]    hidden    timeout=5s
    ${n2}=    Evaluate JavaScript    ${None}    () => document.querySelectorAll('a[data-rawbt]').length
    Should Be Equal As Integers    ${n2}    0

Ảnh trong link rawbt của phiếu 25 dòng rộng đúng 576 chấm, chỉ hai mức và là một dải
    [Documentation]    Giải mã href rawbt: → ảnh PNG 1-bit của encodePng1: rộng 576 (khổ máy in), chỉ hai
    ...    mức (đen/trắng), cao hơn 576 (một dải dài, không ô vuông). KHÔNG Click link. Cần /src import để
    ...    seed nhanh nên bỏ qua ở remote (Pages preview là bản production). Phiên có dữ liệu mẫu để đặt
    ...    được danh tính máy — createOrder đòi nó.
    [Setup]    Mở Phiên Android Có Dữ Liệu Mẫu
    Skip If    '${BASE_URL}'.startswith('https')    Bản production không seed được qua /src import
    Dựng Đơn Nhiều Dòng    25
    Wait For Elements State    css=button:has-text("IN MÁY IN NHIỆT")    visible    timeout=20s
    Bấm Nút    IN MÁY IN NHIỆT
    Chờ Hộp Xác Nhận    In phiếu ra máy in nhiệt?
    Wait For Elements State    css=a[data-rawbt]    visible    timeout=20s
    ${đo}=    Evaluate JavaScript    css=a[data-rawbt]
    ...    async (a) => { const r = await fetch(a.getAttribute('href').slice('rawbt:'.length)); const bm = await createImageBitmap(await r.blob()); const c = new OffscreenCanvas(bm.width, bm.height); const x = c.getContext('2d'); x.drawImage(bm, 0, 0); const d = x.getImageData(0, 0, bm.width, bm.height).data; const levels = new Set(); for (let i = 0; i < d.length; i += 4) levels.add(d[i]); return { w: bm.width, h: bm.height, levels: levels.size }; }
    Should Be Equal As Integers    ${đo}[w]    576
    Should Be True    ${đo}[levels] <= 2
    Should Be True    ${đo}[h] > 576
    ${dòng}=    Evaluate JavaScript    css=[data-thermal]    (n) => n.querySelectorAll('tbody tr').length
    Should Be Equal As Integers    ${dòng}    25

Bản nhiệt của khách nợ cũ ghi nợ cũ và tổng phải trả đúng theo sổ
    [Documentation]    Ca tiền: đối chiếu chữ trên [data-thermal] với sổ thật (Đọc Bảng), không chỉ
    ...    tin con số trên màn. Giao diện hiện đúng mà sổ ghi sai là kiểu hỏng tệ nhất của app này.
    Bán Nợ Cho Khách    Phở bò    Anh Hùng
    Chờ Thấy Chữ    TỔNG PHẢI TRẢ
    ${khách}=    Đọc Bảng    customers
    ${hùng}=    Evaluate    [c for c in $khách if c['name'] == 'Anh Hùng'][0]
    ${đơn}=    Đọc Bảng    orders
    ${nợ}=    Evaluate
    ...    sum(max(0, o['total'] - o['paidAmount']) for o in $đơn if o['customerId'] == ${hùng}[id] and o['status'] != 'void')
    Should Be Equal As Integers    ${nợ}    155000
    ...    Nợ trong sổ khác 155.000 — bộ mẫu đã đổi, sửa lại ca.
    ${chữ}=    Evaluate JavaScript    css=[data-thermal]    (n) => n.textContent
    Should Contain    ${chữ}    100.000 đ    Bản nhiệt thiếu dòng nợ cũ đúng số.
    Should Contain    ${chữ}    155.000 đ    Bản nhiệt thiếu tổng phải trả đúng số.


Thông tin quán: ba vị trí logo chìm chọn được từng nút, mức đậm chỉ có ở giữa tem và bên phải
    [Documentation]    Mỗi nút vị trí phải sáng đúng một lần (`aria-pressed`) và ba nút mức đậm chỉ hiện khi logo
    ...    chìm — ở góc trên phải logo in đặc nên không có mức. Lưu xong đọc thẳng IndexedDB: vị trí là
    ...    `position` + `align` (`align` là trường riêng để máy 2.10.0 không kẹt đồng bộ vì giá trị lạ).
    ...    Không có `Sleep` nên chạy nhanh trên CI; muốn xem từng bước thì chạy có cửa sổ, chậm 1 giây mỗi thao tác:
    ...    `ROBOT_HEADED=1 ROBOT_SLOW_MO=1s ./robot/run.sh -t "Thông tin quán: ba vị trí*" robot/tests/phieu.robot`
    Mở Màn    /them/cai-dat
    Click    css=button:has-text("Thông tin cửa hàng")
    Upload File By Selector    css=[data-shop-logo-input]    ${CURDIR}/../resources/logo-mau.png
    Wait For Elements State    css=[data-shop-logo-preview]    visible
    Check Checkbox    css=[data-label-watermark] input[type="checkbox"]

    Chọn Vị Trí Logo Chìm    Giữa tem
    Mức Đậm Logo Chìm Phải Hiện
    Chọn Mức Đậm Logo Chìm    Nhạt
    Chọn Mức Đậm Logo Chìm    Vừa
    Chọn Mức Đậm Logo Chìm    Đậm

    Chọn Vị Trí Logo Chìm    Bên phải
    Mức Đậm Logo Chìm Phải Hiện
    Chọn Mức Đậm Logo Chìm    Nhạt
    Chọn Mức Đậm Logo Chìm    Đậm

    Chọn Vị Trí Logo Chìm    Góc trên phải
    Get Element Count    css=[data-label-watermark] button:text-is("Nhạt")    ==    0
    Get Element Count    css=[data-label-watermark] button:text-is("Vừa")    ==    0
    Get Element Count    css=[data-label-watermark] button:text-is("Đậm")    ==    0

    Chọn Vị Trí Logo Chìm    Bên phải
    Bấm Nút    LƯU THÔNG TIN
    Wait For Condition    Url    ==    ${BASE_URL}/them/cai-dat
    ${logo}=    Đọc Logo Quán
    Should Be Equal    ${logo}[watermark]    {"enabled":true,"position":"center","strength":"dark","align":"right"}
    ...    Vị trí hoặc mức đậm trong sổ khác lựa chọn cuối trên màn hình.

Thông tin quán: cài logo, xem bản đen trắng, lưu vào sổ, gỡ được, chặn ảnh quá lớn
    [Documentation]    Logo lưu thành PNG đen trắng trong bản ghi shop của sổ chung (#51), nên đọc thẳng
    ...    IndexedDB chứ không chỉ tin ảnh xem trước: giao diện hiện đúng mà sổ ghi sai là kiểu hỏng tệ nhất.
    ...    Trần 40 000 ký tự vì oplog không bao giờ dọn và mỗi lần lưu thông tin quán chép logo hai lần.
    Cài Logo Quán
    ${logo}=    Đọc Logo Quán
    Should Be True    ${logo}[png]    Logo trong sổ không phải data URL PNG.
    Should Be True    0 < ${logo}[length] < 40000    Logo trong sổ dài ${logo}[length] ký tự.
    Should Be Equal    ${logo}[watermark]    {"enabled":false,"position":"center","strength":"light","align":"center"}

    Reload
    Mở Màn    /them/cai-dat
    Click    css=button:has-text("Thông tin cửa hàng")
    Wait For Elements State    css=[data-shop-logo-preview]    visible

    Bấm Nút    Gỡ logo
    Wait For Elements State    css=[data-shop-logo-preview]    detached
    Bấm Nút    LƯU THÔNG TIN
    Wait For Condition    Url    ==    ${BASE_URL}/them/cai-dat
    ${logo}=    Đọc Logo Quán
    Should Be Equal As Integers    ${logo}[length]    0    Gỡ logo rồi mà sổ vẫn còn logo.

    # Ảnh chụp camera (vài chục MB) bị chặn trước khi giải mã: giải mã cỡ gốc làm treo máy yếu.
    ${quá_lớn}=    Set Variable    ${OUTPUT_DIR}/anh-qua-lon.png
    Evaluate    open($quá_lớn, 'wb').write(bytes(6 * 1024 * 1024))
    Click    css=button:has-text("Thông tin cửa hàng")
    Upload File By Selector    css=[data-shop-logo-input]    ${quá_lớn}
    Chờ Thấy Chữ    Ảnh quá lớn
    Get Element Count    css=[data-shop-logo-preview]    ==    0

Thông tin quán: tem xem trước đổi theo vị trí và mức đậm của logo chìm
    [Documentation]    Trước đây ảnh xem trước chỉ có logo đứng một mình nên Giữa tem và Bên phải trông giống hệt
    ...    nhau (#60). Tem xem trước giờ dựng bằng chính đường in; ca này đọc điểm ảnh của canvas trên Chrome thật,
    ...    theo vùng, như ca "In tem:" đọc byte TSPL. Tem 50×30 = 400×240 chấm: nửa trái x 0–200, nửa phải
    ...    x 220–390, ô góc trên phải x 340–392 × y 10–58. So `trái_góc == trái_gốc` tuyệt đối dựa vào việc đầu tem
    ...    chế độ góc chỉ chừa chỗ bên phải (`label-view.tsx`) mà không làm dịch chữ ở nửa trái — đổi bố cục đầu tem
    ...    thì sửa phép so này chứ đừng nới nó.
    Mở Màn    /them/cai-dat
    Click    css=button:has-text("Thông tin cửa hàng")
    Upload File By Selector    css=[data-shop-logo-input]    ${CURDIR}/../resources/logo-mau.png
    Chờ Tem Xem Trước Dựng Xong
    ${trái_gốc}=    Đếm Mực Tem Xem Trước    0    0    200    240
    ${phải_gốc}=    Đếm Mực Tem Xem Trước    220    30    390    190
    ${góc_gốc}=    Đếm Mực Tem Xem Trước    340    10    392    58

    Check Checkbox    css=[data-label-watermark] input[type="checkbox"]
    Click    css=[data-label-watermark] button:text-is("Giữa tem")
    Chờ Tem Xem Trước Dựng Xong
    ${trái_giữa}=    Đếm Mực Tem Xem Trước    0    0    200    240
    ${phải_giữa}=    Đếm Mực Tem Xem Trước    220    30    390    190
    Should Be True    ${trái_giữa} > ${trái_gốc} + 200    Giữa tem không có logo ở nửa trái.
    Should Be True    ${phải_giữa} > ${phải_gốc} + 200    Giữa tem không có logo ở nửa phải.

    Click    css=[data-label-watermark] button:text-is("Bên phải")
    Chờ Tem Xem Trước Dựng Xong
    ${trái_phải}=    Đếm Mực Tem Xem Trước    0    0    200    240
    ${phải_phải}=    Đếm Mực Tem Xem Trước    220    30    390    190
    Should Be Equal As Integers    ${trái_phải}    ${trái_gốc}    Bên phải mà nửa trái tem vẫn có logo.
    Should Be True    ${phải_phải} > ${phải_gốc} + 200    Bên phải không có logo ở nửa phải.
    Should Be True    ${trái_giữa} > ${trái_phải}    Giữa tem và Bên phải cho cùng một ảnh xem trước.

    Click    css=[data-label-watermark] button:text-is("Nhạt")
    Chờ Tem Xem Trước Dựng Xong
    ${phải_nhạt}=    Đếm Mực Tem Xem Trước    220    30    390    190
    Click    css=[data-label-watermark] button:text-is("Đậm")
    Chờ Tem Xem Trước Dựng Xong
    ${phải_đậm}=    Đếm Mực Tem Xem Trước    220    30    390    190
    Should Be True    ${phải_đậm} > ${phải_nhạt}    Mức Đậm không nhiều mực hơn mức Nhạt.

    Click    css=[data-label-watermark] button:text-is("Góc trên phải")
    Chờ Tem Xem Trước Dựng Xong
    ${góc}=    Đếm Mực Tem Xem Trước    340    10    392    58
    ${trái_góc}=    Đếm Mực Tem Xem Trước    0    0    200    240
    Should Be True    ${góc} > ${góc_gốc} + 300    Góc trên phải không có logo đặc.
    Should Be Equal As Integers    ${trái_góc}    ${trái_gốc}    Logo góc lấn sang nửa trái tem.

In tem: mỗi phần một tem đánh số i/n, gửi tới máy in TEM chứ không phải máy in phiếu
    [Documentation]    Chrome thật đóng vai APK (cầu nối Capacitor giả, `gia-lap-apk.cjs`) nên lái được nút
    ...    IN TEM thật và đọc được đúng byte TSPL app định gửi. Số tem đối chiếu với orderLines trong
    ...    IndexedDB (tổng số lượng làm tròn lên từng dòng), không chỉ tin chữ trên nút.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Mở Màn    /them/cai-dat
    Điền Ô    Địa chỉ IP máy in    192.168.1.50
    Click    css=button:text-is("LƯU")
    Chờ Thấy Chữ    Đã lưu 192.168.1.50:9100
    Điền Ô    Địa chỉ IP máy in tem    192.168.1.60
    Bấm Nút    LƯU MÁY IN TEM
    Chờ Thấy Chữ    Đã lưu 192.168.1.60:9100 · tem 50×30 mm

    Mở Màn    /
    Chọn Món    Trà đá    2
    Chọn Món    Cà phê sữa
    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${mã_đơn}=    Set Variable    ${đơn}[id]
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == $mã_đơn]
    ${số_tem}=    Evaluate    sum(math.ceil(d['qty']) for d in $của_đơn)    modules=math
    Should Be Equal As Integers    ${số_tem}    3

    Click    css=button[data-label-print]
    Chờ Hộp Xác Nhận    In 3 tem cho đơn ${đơn}[code]?
    Chờ Thấy Chữ    tới máy in tem 192.168.1.60:9100
    Xác Nhận Trong Hộp    In tem
    Chờ Thấy Chữ    Đã gửi 3 tem tới máy in 192.168.1.60:9100.

    ${jobs}=    Evaluate JavaScript    ${None}    () => window.__printJobs.map((j) => ({ ...j, text: atob(j.base64) }))
    Length Should Be    ${jobs}    1    Một lần bấm phải ra đúng một job.
    Should Be Equal    ${jobs}[0][host]    192.168.1.60
    Should Be Equal As Integers    ${jobs}[0][port]    9100
    ${tspl}=    Set Variable    ${jobs}[0][text]
    Should Start With    ${tspl}    SIZE 50 mm,30 mm\r\nGAP 2 mm,0 mm\r\n
    Should Be Equal As Integers    ${{ $tspl.count('PRINT 1,1') }}    3
    Should Contain    ${tspl}    "1/3"
    Should Contain    ${tspl}    "3/3"
    Should Not Contain    ${tspl}    "4/3"
    # Ảnh tem phải có mực: chụp hỏng ra tờ trắng trơn (toàn 0xFF trong TSPL) thì đếm lệnh vẫn đủ.
    ${mực}=    Evaluate JavaScript    ${None}
    ...    () => { const t = atob(window.__printJobs[0].base64); const head = 'BITMAP 0,0,50,240,0,';
    ...    const at = t.indexOf(head) + head.length; let ink = 0;
    ...    for (let i = at; i < at + 50 * 240; i++) if (t.charCodeAt(i) !== 0xff) ink++; return ink }
    Should Be True    ${mực} > 100    Ảnh tem gần như trắng trơn — khâu chụp tem hỏng.
    # Mỗi tem mang món của chính nó: hai tem Trà đá chung một ảnh, tem Cà phê sữa là ảnh khác.
    ${giống}=    Evaluate JavaScript    ${None}
    ...    () => { const t = atob(window.__printJobs[0].base64); const head = 'BITMAP 0,0,50,240,0,';
    ...    const imgs = []; for (let at = t.indexOf(head); at !== -1; at = t.indexOf(head, at + 1))
    ...    imgs.push(t.slice(at + head.length, at + head.length + 50 * 240));
    ...    return [imgs.length, imgs[0] === imgs[1], imgs[1] === imgs[2]] }
    Should Be Equal    ${giống}    ${{ [3, True, False] }}

In tem: hình chìm giữa tem thêm logo chấm thưa mà số thứ tự vẫn sạch
    [Documentation]    Logo chìm (#51) được ghép sau khi chụp ảnh tem nên chỉ thấy trong byte TSPL gửi đi, không
    ...    thấy trên DOM. So cùng một đơn in hai lần: logo đã cài nhưng tắt, rồi bật ở giữa tem mức Vừa. Vùng
    ...    giữa phải thêm mực; số `i/n` máy in tự vẽ vẫn còn và ô của nó không bị logo lấn.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    ${đơn}=    Cài Máy In Tem Và Chốt Đơn Ba Ly
    Cài Logo Quán
    ${tắt}=    In Tem Của Đơn    ${đơn}
    Cài Logo Quán    Giữa tem    Vừa
    ${bật}=    In Tem Của Đơn    ${đơn}

    ${giữa_tắt}=    Đếm Mực Vùng    ${tắt}    100    60    300    170
    ${giữa_bật}=    Đếm Mực Vùng    ${bật}    100    60    300    170
    Should Be True    ${giữa_bật} > ${giữa_tắt} + 200
    ...    Vùng giữa tem chỉ thêm ${giữa_bật} - ${giữa_tắt} chấm mực — logo chìm không lên tem.
    ${tspl}=    Evaluate    base64.b64decode($bật).decode('latin-1')    modules=base64
    Should Contain    ${tspl}    "1/3"
    Should Contain    ${tspl}    "3/3"
    ${số_tắt}=    Đếm Mực Vùng    ${tắt}    300    200    400    240
    ${số_bật}=    Đếm Mực Vùng    ${bật}    300    200    400    240
    Should Be Equal As Integers    ${số_bật}    ${số_tắt}    Logo lấn vào ô số thứ tự.

In tem: hình chìm bên phải chỉ thêm mực ở nửa phải, nửa trái giữ nguyên
    [Documentation]    Vị trí "Bên phải" là logo chìm chấm thưa dồn về nửa phải vùng chữ, cùng chiều cao với giữa
    ...    tem. So cùng một đơn in hai lần (logo đã cài nhưng tắt, rồi bật Bên phải mức Vừa): nửa phải thêm mực,
    ...    nửa trái — nơi tên món và ghi chú bắt đầu — không đổi một chấm; ô số `i/n` không bị logo lấn.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    ${đơn}=    Cài Máy In Tem Và Chốt Đơn Ba Ly
    Cài Logo Quán
    ${tắt}=    In Tem Của Đơn    ${đơn}
    Cài Logo Quán    Bên phải    Vừa
    ${bật}=    In Tem Của Đơn    ${đơn}

    ${phải_tắt}=    Đếm Mực Vùng    ${tắt}    220    30    390    190
    ${phải_bật}=    Đếm Mực Vùng    ${bật}    220    30    390    190
    Should Be True    ${phải_bật} > ${phải_tắt} + 200
    ...    Nửa phải tem chỉ thêm ${phải_bật} - ${phải_tắt} chấm mực — logo chìm bên phải không lên tem.
    ${trái_tắt}=    Đếm Mực Vùng    ${tắt}    0    0    200    240
    ${trái_bật}=    Đếm Mực Vùng    ${bật}    0    0    200    240
    Should Be Equal As Integers    ${trái_bật}    ${trái_tắt}    Logo bên phải lấn sang nửa trái tem.
    ${số_tắt}=    Đếm Mực Vùng    ${tắt}    300    200    400    240
    ${số_bật}=    Đếm Mực Vùng    ${bật}    300    200    400    240
    Should Be Equal As Integers    ${số_bật}    ${số_tắt}    Logo lấn vào ô số thứ tự.

In tem: logo đã cài nhưng tắt hình chìm thì tem y hệt khi chưa có logo
    [Documentation]    Khoá "tắt là y như cũ" của #51: cài logo mà chưa bật hình chìm không được đổi một byte
    ...    nào của lệnh TSPL. Hai lần chụp html-to-image cách nhau một lần lưu cài đặt — nếu ca này chập
    ...    chờn thì khâu chụp không tất định, phải tìm nguyên nhân chứ đừng nới assert.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    ${đơn}=    Cài Máy In Tem Và Chốt Đơn Ba Ly
    ${gốc}=    In Tem Của Đơn    ${đơn}
    Cài Logo Quán
    ${sau}=    In Tem Của Đơn    ${đơn}
    Should Be True    $gốc == $sau    TSPL đổi chỉ vì đã cài logo trong khi hình chìm đang tắt.

In tem: logo nhỏ ở góc trên phải in đặc, tên quán vẫn in
    [Documentation]    Chế độ góc in logo đặc cỡ ~6 mm (làm mờ ở cỡ đó thì không nhận ra) và đầu tem chừa chỗ cho
    ...    nó, kể cả khi quán chưa đặt tên — không thì tên món trồi lên dưới logo. Ô góc trên phải tem
    ...    50×30 là x 344–390, y 10–56.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    ${đơn}=    Cài Máy In Tem Và Chốt Đơn Ba Ly
    Cài Logo Quán
    ${tắt}=    In Tem Của Đơn    ${đơn}
    Cài Logo Quán    Góc trên phải
    ${bật}=    In Tem Của Đơn    ${đơn}
    ${góc_tắt}=    Đếm Mực Vùng    ${tắt}    340    10    392    58
    ${góc_bật}=    Đếm Mực Vùng    ${bật}    340    10    392    58
    Should Be True    ${góc_bật} > ${góc_tắt} + 300    Góc trên phải không có logo đặc.
    ${tên_quán}=    Đếm Mực Vùng    ${bật}    20    0    150    30
    Should Be True    ${tên_quán} > 0    Dòng tên quán biến mất khi có logo ở góc.

    # Quán chưa đặt tên: đầu tem vẫn phải cao bằng logo, nếu không tên món trồi lên và bị khoét xuyên logo.
    Xoá Thông Tin Quán
    ${không_tên}=    In Tem Của Đơn    ${đơn}
    ${góc_không_tên}=    Đếm Mực Vùng    ${không_tên}    340    10    392    58
    Should Be Equal As Integers    ${góc_không_tên}    ${góc_bật}
    ...    Quán chưa đặt tên thì chữ trên tem lấn vào logo góc.

In tem: ghi chú dài hơn khổ tem thì in tiếp sang tem sau, các tem của một ly đi liền nhau và chung số
    [Documentation]    Trước đây ghi chú bị cắt ở hai dòng (`line-clamp`) nên người pha không thấy nửa sau.
    ...    Giờ phần thừa sang tem kế, mỗi tem lặp đầu tem + tên món và có dấu "tr k/m". Đo trên Chrome thật
    ...    vì chia trang dựa vào chiều cao chữ thật. Số thứ tự `i/n` đếm theo LY, không theo tờ giấy: đơn hai
    ...    ly thì mọi tem chỉ mang "1/2" hoặc "2/2", không bao giờ "3/2". Thân tem 50×30 chỉ còn ~4 dòng chữ nên
    ...    ghi chú thử dài ~8 dòng (6 câu × ~65 ký tự) để chắc chắn tràn — đừng rút ngắn vì tưởng thừa. Không assert
    ...    số trang cố định vì nó phụ thuộc font; chỉ đòi ≥ 2 và đối chiếu mọi số khác với số đo được.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Mở Màn    /them/cai-dat
    Điền Ô    Địa chỉ IP máy in    192.168.1.50
    Click    css=button:text-is("LƯU")
    Chờ Thấy Chữ    Đã lưu 192.168.1.50:9100
    Điền Ô    Địa chỉ IP máy in tem    192.168.1.60
    Bấm Nút    LƯU MÁY IN TEM
    Chờ Thấy Chữ    Đã lưu 192.168.1.60:9100 · tem 50×30 mm

    ${câu}=    Set Variable    không lấy ống hút, để đá riêng ra túi nylon, gói kỹ giúp em nhé
    ${ghi_chú}=    Evaluate    ' '.join([$câu] * 6)
    Mở Màn    /
    Chọn Món    Trà đá
    Chọn Món    Cà phê sữa
    Sửa Dòng    Cà phê sữa
    Điền Ô    Ghi chú    ${ghi_chú}
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${dòng}=    Đọc Bảng    orderLines
    ${đơn}=    Đơn Mới Nhất
    ${cà_phê}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id'] and d['name'] == 'Cà phê sữa'][0]
    Should Be Equal    ${cà_phê}[note]    ${ghi_chú}    Ghi chú chưa xuống sổ nguyên vẹn — tem in từ sổ sẽ thiếu chữ.

    # Các tem dựng sẵn trong DOM: Trà đá một tem, Cà phê sữa từ hai tem trở lên. `Chốt Đơn` chỉ chờ URL nên
    # phải chờ tem dựng xong rồi mới đếm.
    Get Element Count    css=[data-label]    >=    3
    ${tem}=    Evaluate JavaScript    ${None}
    ...    () => [...document.querySelectorAll('[data-label]')].map((n) => ({
    ...    text: n.textContent, body: n.querySelector('[data-label-body]').textContent }))
    ${số_trang}=    Evaluate    len($tem) - 1
    Should Be True    ${số_trang} >= 2    Ghi chú dài mà chỉ ra một tem — phần thừa vẫn bị cắt mất.
    Should Not Contain    ${tem}[0][text]    tr${SPACE}    Tem Trà đá một tờ không được có dấu phụ trang.
    FOR    ${k}    IN RANGE    1    ${số_trang} + 1
        ${t}=    Set Variable    ${tem}[${k}]
        Should Contain    ${t}[text]    Cà phê sữa    Tem tiếp phải lặp lại tên món.
        Should Contain    ${t}[text]    tr ${k}/${số_trang}    Thiếu dấu phụ trang đúng số.
    END
    ${thân}=    Evaluate    ' '.join(t['body'] for t in $tem[1:])
    Should Be Equal    ${thân}    ${ghi_chú}    Ghép các tem tiếp lại không ra đúng ghi chú — mất chữ hoặc lặp chữ.

    Click    css=button[data-label-print]
    Chờ Hộp Xác Nhận    In 2 tem cho đơn ${đơn}[code]?
    Xác Nhận Trong Hộp    In tem
    Chờ Thấy Chữ    Đã gửi 2 tem (${{ 1 + $số_trang }} tờ giấy, ${{ $số_trang - 1 }} tờ là phần ghi chú dài) tới máy in 192.168.1.60:9100.
    ${tspl}=    Evaluate JavaScript    ${None}    () => atob(window.__printJobs[0].base64)
    Should Be Equal As Integers    ${{ $tspl.count('PRINT 1,1') }}    ${{ 1 + $số_trang }}
    Should Be Equal As Integers    ${{ $tspl.count('"1/2"') }}    1
    Should Be Equal As Integers    ${{ $tspl.count('"2/2"') }}    ${số_trang}
    Should Not Contain    ${tspl}    "3/2"
    Should Contain    ${tspl}    TEXT
    Should Contain    ${tspl}    ,"3",0,1,1,"1/2"
    Should Not Contain    ${tspl}    ,"4",0

In tem: ba hạng mục theo thứ tự tuỳ chọn, topping, ghi chú khách, và số thứ tự đếm theo ly
    [Documentation]    Thân tem không còn là một khối ghi chú: tuỳ chọn, topping (có dấu +) và lời dặn của
    ...    khách là ba khối riêng đúng thứ tự người pha đọc. Hai ly nên số thứ tự là "1/2" và "2/2".
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Mở Màn    /them/cai-dat
    Điền Ô    Địa chỉ IP máy in    192.168.1.50
    Click    css=button:text-is("LƯU")
    Chờ Thấy Chữ    Đã lưu 192.168.1.50:9100
    Điền Ô    Địa chỉ IP máy in tem    192.168.1.60
    Bấm Nút    LƯU MÁY IN TEM
    Chờ Thấy Chữ    Đã lưu 192.168.1.60:9100 · tem 50×30 mm
    Cài Thực Đơn Đồ Uống
    Bán Hai Ly Cà Phê Có Topping

    Get Element Count    css=[data-label]    >=    1
    ${thân}=    Evaluate JavaScript    ${None}
    ...    () => [...document.querySelectorAll('[data-label-body] p')].map((p) => p.textContent)
    ${đọc}=    Evaluate    ' '.join($thân)
    Should Be Equal    ${đọc}    Ít đường + Trân châu x2, Thạch mang về
    ...    Thân tem không đúng thứ tự tuỳ chọn, topping, ghi chú khách.

    Click    css=button[data-label-print]
    Xác Nhận Trong Hộp    In tem
    Chờ Thấy Chữ    Đã gửi 2 tem
    ${tspl}=    Evaluate JavaScript    ${None}    () => atob(window.__printJobs[0].base64)
    Should Contain    ${tspl}    "1/2"
    Should Contain    ${tspl}    "2/2"
    Should Not Contain    ${tspl}    "3/2"

In tem: chưa cài máy in tem thì báo kèm đường vào Cài đặt, không gửi gì
    [Documentation]    Không có khổ và IP thì không được đoán — gửi tem tới máy in phiếu là in ra giấy phí.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Bán Nhanh    Trà đá
    Click    css=button[data-label-print]
    Xác Nhận Trong Hộp    In tem
    Chờ Thấy Chữ    Chưa cài máy in tem.
    Chờ Thấy Chữ    Vào Cài đặt › MÁY IN TEM
    ${jobs}=    Evaluate JavaScript    ${None}    () => window.__printJobs.length
    Should Be Equal As Integers    ${jobs}    0

In tem: trên web không có nút IN TEM, khổ tem lưu được và còn sau khi tải lại
    [Documentation]    Web không mở được TCP nên nút IN TEM chỉ có trong APK. Mục MÁY IN TEM vẫn hiện để
    ...    cài trước; khoá riêng `may-in-tem` để tem không chạy nhầm sang máy in phiếu.
    Bán Nhanh    Trà đá
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    Get Element Count    css=button[data-label-print]    ==    0

    Mở Màn    /them/cai-dat
    Điền Ô    Địa chỉ IP máy in tem    192.168.1.60
    Điền Ô    Rộng tem (mm)    50
    Điền Ô    Cao tem (mm)    25
    Bấm Nút    LƯU MÁY IN TEM
    Chờ Thấy Chữ    Đã lưu 192.168.1.60:9100 · tem 50×25 mm
    ${lưu}=    Evaluate JavaScript    ${None}    () => localStorage.getItem('may-in-tem')
    Should Be Equal    ${lưu}    {"host":"192.168.1.60","port":9100,"widthMm":50,"heightMm":25,"gapMm":2}
    ${máy_in_phiếu}=    Evaluate JavaScript    ${None}    () => localStorage.getItem('may-in')
    Should Be Equal    ${máy_in_phiếu}    ${None}
    Reload
    ${rộng}=    Đọc Ô    Rộng tem (mm)
    Should Be Equal    ${rộng}    50

APK: Back từ phiếu về chi tiết đơn rồi về danh sách
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Mở Màn    /don
    Chờ Thấy Chữ    Đơn hàng
    Mở Dòng Đơn Đầu
    ${id}=    Id Đơn Đang Mở
    Bấm Nút    XEM PHIẾU
    Wait For Condition    Url    contains    /phieu
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG

    Bấm Back Android
    Get Url    ==    ${BASE_URL}/don/${id}
    Bấm Back Android
    Get Url    ==    ${BASE_URL}/don
    ${thu_app}=    Số Lần Thu App
    Should Be Equal As Integers    ${thu_app}    0    Back từ phiếu thu app thay vì lùi về chi tiết đơn.

APK: máy chưa ghép mở app không gọi Worker remote nào
    [Documentation]    Bản Vite dev với shim APK giả chỉ được gọi Worker local: cờ native chỉ trỏ Worker remote ở bản
    ...    dựng, nên Robot và CI không bao giờ chạm Worker production. Shim chặn và ghi mọi `fetch` tới `*.workers.dev`.
    ...    Đối chứng dương: heartbeat lúc mở app đã được thử tới Worker local, nên danh sách rỗng không phải vì
    ...    app chưa gọi gì. Đối chứng âm: một `fetch` cố ý tới `*.workers.dev` bị chặn và được ghi lại.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Skip If    '%{ROBOT_REMOTE=0}' == '1'    Ở remote, bundle staging cố ý gọi Worker staging.
    Wait Until Keyword Succeeds    15x    1s    Heartbeat Local Đã Được Thử

    ${trước}=    Số Lần Gọi Worker Remote
    Should Be Equal As Integers    ${trước}    0    App trong shim APK đã gọi Worker remote.

    ${kết_quả}=    Evaluate JavaScript    ${None}
    ...    () => fetch('https://kiem-chan.workers.dev/x').then(() => 'qua', () => 'chan')
    Should Be Equal    ${kết_quả}    chan    Shim không chặn fetch tới *.workers.dev.
    ${sau}=    Số Lần Gọi Worker Remote
    Should Be Equal As Integers    ${sau}    1    Shim không ghi lại fetch tới *.workers.dev.

*** Keywords ***
Chờ Tem Xem Trước Dựng Xong
    [Documentation]    Canvas tem xem trước dựng lại sau mỗi lần đổi cấu hình (có trễ ngắn để khỏi dựng theo từng phím
    ...    gõ). `data-ready` về false ngay khi cấu hình đổi, nên chờ true là chờ đúng ảnh của cấu hình mới.
    Wait For Elements State    css=canvas[data-label-preview][data-ready="true"]    attached    timeout=15s

Đếm Mực Tem Xem Trước
    [Documentation]    Số chấm tối trong vùng [x0, x1) × [y0, y1) của canvas tem xem trước (400×240 chấm).
    [Arguments]    ${x0}    ${y0}    ${x1}    ${y1}
    ${mực}=    Evaluate JavaScript    css=canvas[data-label-preview]
    ...    (canvas, [x0, y0, x1, y1]) => { const { data, width } = canvas.getContext('2d')
    ...    .getImageData(0, 0, canvas.width, canvas.height); let ink = 0;
    ...    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[(y * width + x) * 4] < 128) ink++
    ...    return ink }
    ...    arg=${{ [int($x0), int($y0), int($x1), int($y1)] }}
    RETURN    ${mực}

Chọn Vị Trí Logo Chìm
    [Documentation]    Bấm một nút vị trí rồi khẳng định đúng nút đó sáng và hai nút kia tắt.
    [Arguments]    ${nhãn}
    Click    css=[data-label-watermark] button:text-is("${nhãn}")
    FOR    ${vị_trí}    IN    Giữa tem    Bên phải    Góc trên phải
        ${sáng}=    Set Variable If    $vị_trí == $nhãn    true    false
        Get Attribute    css=[data-label-watermark] button:text-is("${vị_trí}")    aria-pressed    ==    ${sáng}
    END

Mức Đậm Logo Chìm Phải Hiện
    FOR    ${mức}    IN    Nhạt    Vừa    Đậm
        Wait For Elements State    css=[data-label-watermark] button:text-is("${mức}")    visible
    END

Chọn Mức Đậm Logo Chìm
    [Arguments]    ${nhãn}
    Click    css=[data-label-watermark] button:text-is("${nhãn}")
    Get Attribute    css=[data-label-watermark] button:text-is("${nhãn}")    aria-pressed    ==    true

Cài Máy In Tem Và Chốt Đơn Ba Ly
    [Documentation]    Máy in tem LAN giả ở 192.168.1.60, khổ mặc định 50×30, rồi chốt một đơn ba ly (Trà đá ×2,
    ...    Cà phê sữa) như ca "In tem: mỗi phần một tem…". Trả về đơn vừa chốt.
    Mở Màn    /them/cai-dat
    Điền Ô    Địa chỉ IP máy in tem    192.168.1.60
    Bấm Nút    LƯU MÁY IN TEM
    Chờ Thấy Chữ    Đã lưu 192.168.1.60:9100 · tem 50×30 mm
    Mở Màn    /
    Chọn Món    Trà đá    2
    Chọn Món    Cà phê sữa
    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    RETURN    ${đơn}

In Tem Của Đơn
    [Documentation]    Mở phiếu của đơn, bấm IN TEM và trả base64 của lệnh TSPL vừa gửi. `__printJobs` cộng dồn
    ...    trong một trang nên lấy job CUỐI, không phải job đầu.
    [Arguments]    ${đơn}
    Mở Màn    /don/${đơn}[id]/phieu
    Click    css=button[data-label-print]
    Chờ Hộp Xác Nhận    In 3 tem cho đơn ${đơn}[code]?
    Xác Nhận Trong Hộp    In tem
    Chờ Thấy Chữ    Đã gửi 3 tem
    ${b64}=    Evaluate JavaScript    ${None}    () => window.__printJobs.at(-1).base64
    RETURN    ${b64}

Đếm Mực Vùng
    [Documentation]    Số chấm mực trong vùng [x0, x1) × [y0, y1) của ảnh tem ĐẦU TIÊN (tem 1/3) trong lệnh TSPL.
    ...    TSPL đảo bit so với ESC/POS: bit 0 là mực. Tem 50×30 = 400×240 chấm, 50 byte mỗi hàng.
    [Arguments]    ${b64}    ${x0}    ${y0}    ${x1}    ${y1}
    ${mực}=    Evaluate JavaScript    ${None}
    ...    ([b64, x0, y0, x1, y1]) => { const t = atob(b64); const head = 'BITMAP 0,0,50,240,0,';
    ...    const at = t.indexOf(head) + head.length; let ink = 0;
    ...    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    ...    const byte = t.charCodeAt(at + y * 50 + (x >> 3)); if (!(byte & (0x80 >> (x & 7)))) ink++ }
    ...    return ink }
    ...    arg=${{ [$b64, int($x0), int($y0), int($x1), int($y1)] }}
    RETURN    ${mực}
Dựng Đơn Nhiều Dòng
    [Documentation]    Seed một đơn ${số_dòng} dòng qua repository (như e2e `buildReceiptWithLines`)
    ...    rồi mở phiếu — nhanh hơn bấm tay từng món. Nút .bin và node bản nhiệt vẫn là UI thật.
    [Arguments]    ${số_dòng}
    ${id}=    Evaluate JavaScript    ${None}
    ...    async (n) => {
    ...        const orders = await import('/src/db/repositories/orders.ts')
    ...        const { id } = await orders.createOrder({
    ...            customerId: null, customerName: 'Khách lẻ',
    ...            lines: Array.from({ length: n }, (_, i) => ({
    ...                itemId: null, name: 'Món ' + (i + 1), unit: 'phần', unitPrice: 25000, costPrice: null, qty: 1,
    ...            })),
    ...            discount: 0, surcharge: 0, soldAt: Date.now(), note: '',
    ...            payment: { amount: 25000 * n, method: 'cash', note: '' },
    ...        })
    ...        return id
    ...    }
    ...    arg=${số_dòng}
    Mở Màn    /don/${id}/phieu
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG


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

Trả Media Về Mặc Định
    [Documentation]    `media=${None}` KHÔNG reset — nó gửi `not_set` và wrapper bỏ qua. Phải
    ...    `media=null` mới tắt emulation. Đặt ở Teardown để ca chết giữa chừng cũng không bỏ lại
    ...    page ở media print.
    Emulate Media    media=null

Heartbeat Local Đã Được Thử
    ${đã_thử}=    Evaluate JavaScript    ${None}    () => sessionStorage.getItem('__localHeartbeatSeen') === '1'
    Should Be True    ${đã_thử}    Heartbeat lúc mở app chưa được thử tới Worker local.

Số Lần Gọi Worker Remote
    ${số}=    Evaluate JavaScript    ${None}    () => JSON.parse(sessionStorage.getItem('__remoteCalls') || '[]').length
    RETURN    ${số}
