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
    Chờ Thấy Chữ    Xem đơn
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
    Mở Đơn
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
    Mở Đơn
    Bấm Nút    Giảm giá / phụ thu
    Điền Ô    Giảm giá    99000
    Chờ Thấy Chữ    Giảm giá không được lớn hơn tiền hàng
    Nút Phải Bị Khoá    ÁP DỤNG

Sửa dòng trong giỏ đổi được số lượng và đơn giá riêng
    Mở Màn    /
    Chọn Món    Trà đá
    Sửa Dòng    Trà đá
    Điền Ô    Số lượng    4
    Bấm Nút    Đổi giá
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
    Sửa Dòng    Trà đá
    Click    ${SHEET} >> css=button:text-is("Bỏ món")
    Wait For Elements State    ${NÚT_THU_TIỀN}    detached

Gõ "2 pho" rồi Enter thì thêm đúng 2 phở
    Mở Màn    /
    Gõ Vào Ô Tìm Món    2 pho
    Keyboard Key    press    Enter
    Chờ Thấy Chữ    Xem đơn
    Chờ Thấy Chữ    110.000 đ

Lọc theo nhóm chỉ hiện món của nhóm đó
    Mở Màn    /
    Click    css=button:has-text("Đồ uống")
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Trà đá")    visible
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Phở bò")    detached

Đơn đang lên dở sống sót qua một lần tải lại trang
    Mở Màn    /
    Chọn Món    Phở bò
    Chờ Thấy Chữ    Xem đơn
    Chờ Nháp Giỏ Được Lưu
    Reload
    Chờ Thấy Chữ    Đã khôi phục đơn đang lên dở
    Chờ Thấy Chữ    55.000 đ

Rời màn Bán hàng rồi quay lại không phải là "khôi phục đơn"
    [Documentation]    Banner "Đã khôi phục đơn đang lên dở" trước đây dựng lại theo từng lần dựng màn
    ...    Bán hàng, tức hiện lên mỗi lần bấm sang màn khác rồi quay lại — dù người bán chưa hề đóng
    ...    app. Một câu sai sự thật, mà ngay cạnh nó là nút "Bỏ đi" xoá sạch giỏ đang lên.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Phở bò
    Chờ Thấy Chữ    Xem đơn
    Chờ Nháp Giỏ Được Lưu

    # Đi bằng thanh nav như người bán. `Mở Màn` là nạp lại trang, tức mở ra một phiên mới — đúng lúc
    # banner *phải* hiện, nên dùng nó ở đây là kiểm nhầm chuyện khác.
    Click    ${NAV_THEM}
    Chờ Thấy Chữ    4 món
    Click    ${NAV_BAN}

    Chờ Thấy Chữ    Xem đơn
    Không Được Thấy Chữ    Đã khôi phục đơn đang lên dở
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
    Chờ Thấy Chữ    KHÁCH
    Không Được Thấy Chữ    Đã khôi phục đơn đang lên dở
    Wait For Elements State    ${NÚT_THU_TIỀN}    detached

Chốt đơn xong nhảy thẳng sang phiếu để gửi khách
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Chốt Đơn
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    Chờ Thấy Chữ    Quán Cơm Bà Tư

Bật SỈ thì giỏ tính theo giá riêng của khách, sổ ghi đúng giá đó
    Đặt Giá Sỉ    Anh Hùng    Phở bò đặc biệt    45000
    Mở Màn    /
    Chọn Món    Phở bò
    Bật Giá Sỉ Cho Khách    Anh Hùng
    Chờ Thấy Chữ    45.000 đ
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[total]    45000
    Should Be Equal    ${đơn}[customerName]    Anh Hùng

    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id']]
    Length Should Be    ${của_đơn}    1
    Should Be Equal As Integers    ${của_đơn}[0][unitPrice]    45000
    ...    Màn hiện giá sỉ mà sổ ghi giá lẻ — đúng kiểu hỏng tệ nhất của app này.

Món khách chưa có giá riêng vẫn bán giá lẻ khi đang SỈ
    Đặt Giá Sỉ    Anh Hùng    Phở bò đặc biệt    45000
    Mở Màn    /
    Chọn Món    Phở bò
    Chọn Món    Trà đá
    Bật Giá Sỉ Cho Khách    Anh Hùng
    Chờ Thấy Chữ    48.000 đ
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[total]    48000

    ${dòng}=    Đọc Bảng    orderLines
    ${trà}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id'] and d['name'] == 'Trà đá'][0]
    Should Be Equal As Integers    ${trà}[unitPrice]    3000    Món không có giá riêng bị kéo theo giá sỉ.

Chạm SỈ khi chưa chọn khách thì app bắt chọn khách trước
    Mở Màn    /
    Chọn Món    Phở bò
    Đóng Đơn
    Chọn Chip    SỈ
    Chờ Thấy Chữ    Chọn khách

    ${đang}=    Chip Đang Chọn    SỈ
    Should Be Equal    ${đang}    false    Bật SỈ mà chưa có khách thì chưa có bảng giá nào để tra.

Đổi sang khách khác khi đang SỈ thì mọi đơn giá là của khách mới
    Đặt Giá Sỉ    Anh Hùng    Phở bò đặc biệt    45000
    Mở Màn    /them/khach-hang
    Bấm Nút    Thêm khách hàng
    Điền Ô    Tên khách hàng *    Chị Hoa
    Bấm Nút    LƯU KHÁCH HÀNG
    Chờ Thấy Chữ    2 khách
    Đặt Giá Sỉ    Chị Hoa    Phở bò đặc biệt    30000

    Mở Màn    /
    Chọn Món    Phở bò
    Bật Giá Sỉ Cho Khách    Anh Hùng
    Chờ Thấy Chữ    45.000 đ

    Đóng Đơn

    Click    ${NÚT_KHÁCH_TRÊN_ĐẦU}
    Chọn Khách Trong Sheet    Chị Hoa
    Chờ Thấy Chữ    30.000 đ
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal    ${đơn}[customerName]    Chị Hoa
    Should Be Equal As Integers    ${đơn}[total]    30000
    ...    Header hiện tên khách mới mà giá vẫn là của khách cũ.

Chọn "Khách lẻ" khi đang SỈ thì công tắc về Lẻ và giỏ về giá lẻ
    Đặt Giá Sỉ    Anh Hùng    Phở bò đặc biệt    45000
    Mở Màn    /
    Chọn Món    Phở bò
    Bật Giá Sỉ Cho Khách    Anh Hùng
    Chờ Thấy Chữ    45.000 đ

    Đóng Đơn

    Click    ${NÚT_KHÁCH_TRÊN_ĐẦU}
    Chọn Khách Trong Sheet    Khách lẻ
    Chờ Thấy Chữ    55.000 đ

    ${đang}=    Chip Đang Chọn    SỈ
    Should Be Equal    ${đang}    false    Khách lẻ không có bảng giá riêng nào để tra.

Đơn đang lên dở ở giá sỉ được tính lại theo bảng giá hiện tại sau khi tải lại trang
    Đặt Giá Sỉ    Anh Hùng    Phở bò đặc biệt    45000
    Mở Màn    /
    Chọn Món    Phở bò
    Bật Giá Sỉ Cho Khách    Anh Hùng
    Chờ Thấy Chữ    45.000 đ
    Chờ Nháp Giỏ Được Lưu

    Đặt Giá Sỉ    Anh Hùng    Phở bò đặc biệt    40000
    Mở Màn    /
    Chờ Thấy Chữ    Đã khôi phục đơn đang lên dở
    Chờ Thấy Chữ    40.000 đ

    ${đang}=    Chip Đang Chọn    SỈ
    Should Be Equal    ${đang}    true    Nháp SỈ khôi phục mà công tắc về Lẻ thì món thêm sau vào giá lẻ.

Giảm giá trước rồi bật SỈ thì thanh tổng cảnh báo tiền hàng đã tụt
    [Documentation]    `calcOrderTotals` kẹp giảm giá về bằng tiền hàng **trong im lặng**, nên một cú
    ...    chạm công tắc kéo TỔNG CỘNG về 0 và đơn 0đ đó vẫn ghi là trả đủ. Guard của sheet Giảm giá
    ...    chỉ chạy lúc gõ, không chạy lại sau khi đổi giá.
    Đặt Giá Sỉ    Anh Hùng    Phở bò đặc biệt    5000
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Đơn
    Bấm Nút    Giảm giá / phụ thu
    Điền Ô    Giảm giá    50000
    Bấm Nút    ÁP DỤNG
    Chờ Thấy Chữ    5.000 đ

    Bật Giá Sỉ Cho Khách    Anh Hùng
    Chờ Thấy Chữ    vẫn còn giảm giá

Giá gõ tay trùng đúng giá sỉ vẫn là hai dòng riêng, tắt SỈ thì tách lại đúng
    [Documentation]    Khoá dòng giỏ trước đây không có `priceSource`, nên khi giá sỉ trùng đúng giá
    ...    người bán đã gõ tay thì `upsert` coi hai dòng là một: nó giữ dòng cũ và chỉ cộng `qty`.
    ...    Dòng gộp mang nhãn `manual`, mà tắt SỈ không đụng dòng `manual` — nên cả hai tô bán ở giá
    ...    sỉ thay vì một tô sỉ một tô lẻ. Mất 10.000đ, không một dòng cảnh báo. Ca này dựng dữ liệu
    ...    **cố ý trùng số**; đặt hai giá khác nhau là không bao giờ chạm tới lỗi.
    [Tags]    regression
    Đặt Giá Sỉ    Anh Hùng    Phở bò đặc biệt    45000
    Mở Màn    /
    Chọn Món    Phở bò
    Sửa Dòng    Phở bò đặc biệt
    Bấm Nút    Đổi giá
    Điền Ô    Đơn giá riêng cho đơn này    45000
    Bấm Nút    XONG

    Chọn Món    Phở bò
    Chờ Thấy Chữ    100.000 đ

    Bật Giá Sỉ Cho Khách    Anh Hùng
    Chờ Thấy Chữ    90.000 đ
    Mở Đơn
    ${dòng_giỏ}=    Get Element Count    css=button[aria-label="Sửa Phở bò đặc biệt"]
    Should Be Equal As Integers    ${dòng_giỏ}    2
    ...    Dòng gõ tay bị dòng danh mục gộp vào — tắt SỈ sẽ không hoàn nguyên được nữa.

    Đóng Đơn

    Click    ${NÚT_KHÁCH_TRÊN_ĐẦU}
    Chọn Khách Trong Sheet    Khách lẻ
    Chờ Thấy Chữ    100.000 đ
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[total]    100000

    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    sorted([d['unitPrice'] for d in $dòng if d['orderId'] == $đơn['id']])
    Should Be Equal    ${của_đơn}    ${{ [45000, 55000] }}
    ...    Sổ ghi một dòng qty 2 ở giá sỉ: tô thứ hai lẽ ra bán giá lẻ.

Thêm được món mới ngay từ lưới bán hàng
    [Documentation]    Lối vào form thêm món trên màn Bán hàng trước đây chỉ nằm ở empty state của
    ...    lưới. Vừa có món đầu tiên là empty state biến mất, và màn Bán hàng — màn người bán ở lì
    ...    cả ngày — hết sạch đường tạo món kế tiếp. Ca này khoá lại lối đó, và khoá luôn việc món
    ...    vừa thêm phải bán được ngay chứ không chỉ hiện ra trong danh mục.
    [Tags]    regression
    Mở Màn    /
    Click    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Thêm mặt hàng")
    Điền Ô    Tên mặt hàng *    Bánh mì
    Điền Ô    Giá bán *    20000
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    5 món

    ${món}=    Đọc Bảng    items
    ${bánh_mì}=    Evaluate    [d for d in $món if d['name'] == 'Bánh mì'][0]
    Should Be Equal As Integers    ${bánh_mì}[unitPrice]    20000
    ...    Màn hình hiện đúng giá mà sổ ghi số khác thì mọi đơn bán món này đều sai.

    # Về bằng thanh nav như người bán, không nhảy thẳng URL: lưu xong app đứng ở màn Mặt hàng chứ
    # không tự quay lại chỗ bán, nên đường về phải là một phần của ca chứ không được giấu đi.
    Click    ${NAV_BAN}
    Chọn Món    Bánh mì
    Chờ Thấy Chữ    20.000 đ

Gõ tên món chưa có thì vẫn thêm được món ngay tại chỗ, kèm tên đã gõ
    [Documentation]    Ô thêm món nằm trong lưới, mà nhánh "không khớp" thay lưới bằng một dòng chữ —
    ...    nên gõ đúng tên một món chưa có, tức lúc muốn tạo nó nhất, thì lối tạo lại biến mất. Ca này
    ...    khoá cả lối đó lẫn việc tên vừa gõ được mang sang form thay vì bắt gõ lại.
    [Tags]    regression
    Mở Màn    /
    Gõ Vào Ô Tìm Món    bánh mì
    Chờ Thấy Chữ    Không có món nào khớp
    Bấm Nút    Thêm mặt hàng

    ${tên}=    Đọc Ô    Tên mặt hàng *
    Should Be Equal    ${tên}    bánh mì    Tên vừa gõ ở ô tìm không được mang sang, người bán phải gõ lại.

    Điền Ô    Giá bán *    20000
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    5 món

    ${món}=    Đọc Bảng    items
    ${bánh_mì}=    Evaluate    [d for d in $món if d['name'] == 'bánh mì'][0]
    Should Be Equal As Integers    ${bánh_mì}[unitPrice]    20000

Gõ thẳng số lượng vào giỏ rồi bấm ngay THU TIỀN thì sổ ghi đúng số vừa gõ
    Mở Màn    /
    Chọn Món    Phở bò
    Gõ Số Lượng    Phở bò đặc biệt    50
    Chờ Thấy Chữ    2.750.000
    # Cố ý KHÔNG chạm ra ngoài ô trước: đây đúng là cửa sổ blur-vs-click. Đi thẳng từ ô đang focus
    # sang THU TIỀN, vì đó là thao tác thật của người bán đang vội.
    Mở Sheet Thu Tiền
    Chờ Thấy Chữ    2.750.000 đ
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[total]    2750000

    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id']]
    Should Be Equal As Numbers    ${của_đơn}[0][qty]    50
    ...    Màn hiện 50 ly mà sổ ghi số khác — đúng kiểu hỏng tệ nhất của app này.
    Should Be Equal As Integers    ${của_đơn}[0][amount]    2750000

Xoá trắng ô số lượng thì dòng còn nguyên, rời ô là ô hiện lại số đang có
    Mở Màn    /
    Chọn Món    Trà đá    2
    Gõ Số Lượng    Trà đá    ${EMPTY}
    Chờ Thấy Chữ    Trà đá
    Keyboard Key    press    Tab

    ${số}=    Đọc Số Lượng    Trà đá
    Should Be Equal    ${số}    2    Xoá trắng ô để gõ lại mà mất luôn số cũ trong giỏ.
    Chờ Thấy Chữ    6.000 đ

Gõ 0 rồi rời ô thì món đó biến khỏi đơn, món còn lại vào sổ nguyên vẹn
    Mở Màn    /
    Chọn Món    Phở bò
    Chọn Món    Trà đá    3
    Gõ Số Lượng    Phở bò đặc biệt    0
    Keyboard Key    press    Tab
    Wait For Elements State    css=button[aria-label="Sửa Phở bò đặc biệt"]    detached
    Chờ Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn

    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[total]    9000

    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id']]
    Length Should Be    ${của_đơn}    1    Món gõ 0 vẫn còn trong sổ.
    Should Be Equal    ${của_đơn}[0][name]    Trà đá
    Should Be Equal As Numbers    ${của_đơn}[0][qty]    3

Gõ 0 lỡ tay rồi bấm Hoàn lại thì món về nguyên vẹn cả số lượng lẫn giá
    [Documentation]    `0` là phím ĐẦU của "0,5". Người bán gõ dở rồi bị khách gọi, chạm thẳng
    ...    THU TIỀN — `onBlur` chạy trước và món biến mất. Nếu đó là dòng duy nhất thì footer
    ...    THU TIỀN cũng bị tháo theo (`count > 0` gác nó), giỏ trắng giữa lúc bán. Giữ quyết định
    ...    "0 là bỏ món" nhưng bắt buộc có đường về.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Phở bò
    Gõ Số Lượng    Phở bò đặc biệt    0
    Keyboard Key    press    Tab
    Chờ Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn

    Bấm Nút    Hoàn lại
    Mở Đơn
    Wait For Elements State    css=button[aria-label="Sửa Phở bò đặc biệt"]    visible

    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id']]
    Length Should Be    ${của_đơn}    1
    Should Be Equal    ${của_đơn}[0][name]    Phở bò đặc biệt
    Should Be Equal As Numbers    ${của_đơn}[0][qty]    1
    Should Be Equal As Integers    ${của_đơn}[0][unitPrice]    55000

Gõ 1.000 vào ô số lượng trong giỏ thì không âm thầm thành 1 hay 2,5
    [Documentation]    Bẫy tiền tố DƯƠNG, khác bẫy tiền tố "0". Gõ từng phím, "1.000" đi qua "1.0"
    ...    rồi "1.00" — cả hai ĐỌC ĐƯỢC là 1 nên đã commit vào giỏ trước khi tới ký tự cuối. Tới lúc
    ...    rời ô thì giỏ đã mang số sai rồi; vẽ lại từ giỏ chỉ đóng dấu cái sai đó. Chủ quán quen gõ
    ...    kiểu tiền tệ, định đặt một nghìn ly mà sổ ghi 1 ly thì không một lỗi nào hiện ra.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Trà đá    3
    Gõ Số Lượng    Trà đá    1.000
    Keyboard Key    press    Tab

    Chờ Thấy Chữ    không đọc được
    ${số}=    Đọc Số Lượng    Trà đá
    Should Be Equal    ${số}    3    Số lượng phải về đúng giá trị lúc vào ô, không giữ lại số commit dở.

    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id']]
    Should Be Equal As Numbers    ${của_đơn}[0][qty]    3
    ...    Sổ ghi số commit dở của "1.000" thay vì số lượng thật.

Gõ dở 1.000 rồi bấm Esc đóng sheet đơn thì sổ vẫn ghi số lượng cũ
    [Documentation]    Ô số lượng nằm trong sheet "Xem đơn". Esc tháo cả sheet khỏi cây mà React không gọi
    ...    `onBlur` của ô đang gõ, nên bước "1.000 không đọc được thì trả số lúc vào ô" từng bị bỏ qua:
    ...    "1.0" đã chốt 1 vào giỏ, đóng sheet là sổ ghi 1 ly thay vì 3, không một dòng cảnh báo.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Trà đá    3
    Gõ Số Lượng    Trà đá    1.000
    Keyboard Key    press    Escape
    Wait For Elements State    ${SHEET_ĐƠN}    detached
    Chờ Thấy Chữ    không đọc được
    Chờ Thấy Chữ    Xem đơn · 3 món

    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id']]
    Should Be Equal As Numbers    ${của_đơn}[0][qty]    3
    ...    Đóng sheet bằng Esc giữa lúc gõ dở mà sổ ghi số commit dở.

Bấm cộng sau khi đã gõ tay thì ô và sổ cùng nhích lên một
    Mở Màn    /
    Chọn Món    Phở bò
    Gõ Số Lượng    Phở bò đặc biệt    50
    Click    css=li:has(button[aria-label="Sửa Phở bò đặc biệt"]) >> css=button[aria-label="Thêm một"]

    ${số}=    Đọc Số Lượng    Phở bò đặc biệt
    Should Be Equal    ${số}    51    Ô nhập không vẽ lại theo giỏ — phím gõ tiếp sẽ commit từ nền sai.
    Chờ Thấy Chữ    2.805.000

    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id']]
    Should Be Equal As Numbers    ${của_đơn}[0][qty]    51

Gõ 1.000 vào sheet sửa dòng thì báo lỗi chứ không âm thầm thành 1
    [Documentation]    `parseQtyInput` coi cả `.` lẫn `,` là dấu THẬP PHÂN, nên "1.000" ra đúng số 1.
    ...    Lỗi này đã sống trong bản đang chạy ở hai chỗ — sheet sửa dòng và ô tìm món. Ca này khoá
    ...    đường sheet.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Trà đá
    Sửa Dòng    Trà đá
    Điền Ô    Số lượng    1.000
    Chờ Thấy Chữ    Số lượng không đọc được
    Nút Phải Bị Khoá    XONG

    Điền Ô    Số lượng    1000
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id']]
    Should Be Equal As Numbers    ${của_đơn}[0][qty]    1000

Gõ 0 rồi đổi khách sang giá SỈ thì nút Hoàn lại biến mất, không chèn giá cũ vào giỏ mới
    [Documentation]    Nút Hoàn lại giữ ảnh chụp của dòng lúc bị gỡ, kèm giá theo bảng giá của khách
    ...    CŨ. Bấm Hoàn lại sau khi đã đổi nền giá là chèn một dòng giá cũ vào giỏ của khách mới, và
    ...    không gì tính lại nó cho tới lần bật/tắt SỈ sau.
    Đặt Giá Sỉ    Anh Hùng    Phở bò đặc biệt    45000
    Mở Màn    /
    Chọn Món    Phở bò
    Chọn Món    Trà đá
    Gõ Số Lượng    Phở bò đặc biệt    0
    Keyboard Key    press    Tab
    Chờ Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn

    Bật Giá Sỉ Cho Khách    Anh Hùng
    Không Được Thấy Chữ    Hoàn lại
    Không Được Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn


Ghi chú từng món theo dòng xuống sổ, dòng không ghi chú là chuỗi rỗng chứ không phải thiếu trường
    [Documentation]    Trước đây `note` chỉ sống trong giỏ rồi rơi mất lúc chốt: màn hình hiện đúng,
    ...    sổ ghi thiếu. Ca này khoá đường UI → IndexedDB. Dòng thứ hai cố ý KHÔNG có ghi chú để
    ...    khoá luôn phần chuẩn hoá: đọc ra phải là '' để chỗ dùng không phải tự đoán undefined.
    Mở Màn    /
    Chọn Món    Phở bò
    Chọn Món    Trà đá
    Sửa Dòng    Phở bò đặc biệt
    Điền Ô    Ghi chú    ít hành, mang về
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${phở}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id'] and d['name'] == 'Phở bò đặc biệt'][0]
    Should Be Equal    ${phở}[note]    ít hành, mang về
    ...    Ghi chú gõ ở giỏ không xuống tới sổ — người bếp không thấy thứ người bán đã ghi.
    ${trà}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id'] and d['name'] == 'Trà đá'][0]
    Should Be Equal    ${trà}[note]    ${EMPTY}    Dòng không ghi chú phải là '' chứ không thiếu trường.

Đánh dấu đá chung rồi thêm tiếp thì hai nhóm ly nằm trên hai dòng riêng
    [Documentation]    Ca thật của chủ quán: cùng một món, 3 ly đá chung + 2 ly đá riêng. Hôm nay
    ...    người bán không diễn đạt được chuyện đó — cùng món cùng giá thì `upsert` gộp về một dòng.
    ...    Đọc thẳng sổ chứ không tin con số trên màn: gộp nhầm thì bếp pha 5 ly cùng một kiểu đá,
    ...    mà tổng tiền vẫn đúng nên không lỗi nào hiện ra.
    Mở Màn    /
    Chọn Món    Phở bò
    Gõ Số Lượng    Phở bò đặc biệt    3
    Keyboard Key    press    Tab
    Sửa Dòng    Phở bò đặc biệt
    Chọn Chip    Đá chung
    Bấm Nút    XONG

    Chọn Món    Phở bò
    Gõ Số Lượng    Phở bò đặc biệt    2
    Keyboard Key    press    Tab
    Sửa Dòng    Phở bò đặc biệt
    Chọn Chip    Đá riêng
    Bấm Nút    XONG

    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == ${đơn}[id]]
    Length Should Be    ${của_đơn}    2
    ...    Hai nhóm ly bị gộp về một dòng — bếp sẽ pha 5 ly cùng một kiểu đá.
    ${chung}=    Evaluate    [d for d in $của_đơn if d['options'] == ['Đá chung']][0]
    ${riêng}=    Evaluate    [d for d in $của_đơn if d['options'] == ['Đá riêng']][0]
    Should Be Equal As Numbers    ${chung}[qty]    3    Số ly đá chung xuống sổ sai.
    Should Be Equal As Numbers    ${riêng}[qty]    2    Số ly đá riêng xuống sổ sai.

Chọn chip đá không đụng vào ô ghi chú: nhãn xuống `options`, chữ gõ tay xuống `note`
    [Documentation]    Chip từng NỐI nhãn vào ô ghi chú; giờ nhãn nằm riêng ở `options` để tem và phiếu
    ...    in được từng hạng mục. Đối chiếu tận sổ vì kiểu hỏng này có tiền lệ: màn hình hiện đúng,
    ...    sổ ghi thiếu — ở đây là nhãn rơi mất hoặc chui nhầm vào `note`.
    Mở Màn    /
    Chọn Món    Phở bò
    Sửa Dòng    Phở bò đặc biệt
    Điền Ô    Ghi chú    ít đường
    Chọn Chip    Đá riêng
    ${ghi_chú}=    Đọc Ô    Ghi chú
    Should Be Equal    ${ghi_chú}    ít đường    Chip đá vẫn ghi chữ vào ô ghi chú.
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${phở}=    Evaluate    [d for d in $dòng if d['orderId'] == ${đơn}[id]][0]
    Should Be Equal    ${phở}[note]    ít đường
    ...    Chữ người bán tự gõ bị chip đè — bếp mất nửa yêu cầu của khách.
    Should Be Equal    ${phở}[options]    ${{ ['Đá riêng'] }}
    ...    Nhãn đá không xuống `options` của dòng.

Bấm lại chip đang chọn thì gỡ đúng nhãn đó, ghi chú gõ tay còn nguyên
    Mở Màn    /
    Chọn Món    Phở bò
    Sửa Dòng    Phở bò đặc biệt
    Điền Ô    Ghi chú    ít đường
    Chọn Chip    Đá riêng
    Chọn Chip    Đá riêng

    ${ghi_chú}=    Đọc Ô    Ghi chú
    Should Be Equal    ${ghi_chú}    ít đường
    ${đang_chọn}=    Chip Đang Chọn    Đá riêng
    Should Be Equal    ${đang_chọn}    false

Hai chip đá loại trừ nhau: bấm cái này thì cái kia tự tắt
    [Documentation]    Một ly không thể vừa đá chung vừa đá riêng. Muốn cả hai kiểu thì đó là HAI
    ...    DÒNG — đúng thứ tính năng này làm, nên hai chip không được phép cùng bật.
    Mở Màn    /
    Chọn Món    Phở bò
    Sửa Dòng    Phở bò đặc biệt
    Điền Ô    Ghi chú    ít đường
    Chọn Chip    Đá chung
    Chọn Chip    Đá riêng

    ${riêng}=    Chip Đang Chọn    Đá riêng
    Should Be Equal    ${riêng}    true
    ${chung}=    Chip Đang Chọn    Đá chung
    Should Be Equal    ${chung}    false
    ${ghi_chú}=    Đọc Ô    Ghi chú
    Should Be Equal    ${ghi_chú}    ít đường

Tuỳ chọn và topping của nhóm món xuống sổ: giá ly cộng topping, đối chiếu IndexedDB
    [Documentation]    Tiền là chỗ hỏng tệ nhất của app này: màn hình hiện đúng mà sổ ghi sai. Ca này lên
    ...    đúng một đơn 2 ly cà phê (20.000) + trân châu ×2 (5.000/phần) + thạch (3.000) rồi đọc thẳng
    ...    `orderLines` và `orders`: thành tiền = (20.000 + 10.000 + 3.000) × 2 = 66.000, `unitPrice`
    ...    vẫn là giá ly, topping mang giá LÚC BÁN.
    Cài Thực Đơn Đồ Uống
    Mở Màn    /
    Chọn Món    Cà phê sữa
    Click    ${SHEET} >> css=button[aria-label="Thêm một"]
    Chọn Chip    Ít đường
    Click    css=button[aria-label="Thêm Trân châu"]
    Click    css=button[aria-label="Thêm Trân châu"]
    Click    css=button[aria-label="Thêm Thạch"]
    Chờ Thấy Chữ    Mỗi ly: 33.000
    Điền Ô    Ghi chú    mang về
    Bấm Thêm Vào Đơn
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == ${đơn}[id]]
    Length Should Be    ${của_đơn}    1
    ${ly}=    Set Variable    ${của_đơn}[0]
    Should Be Equal As Integers    ${ly}[unitPrice]    20000    `unitPrice` phải là giá ly, không gồm topping.
    Should Be Equal As Integers    ${ly}[amount]    66000    Thành tiền xuống sổ không gồm đúng tiền topping.
    Should Be Equal    ${ly}[options]    ${{ ['Ít đường'] }}
    Should Be Equal    ${ly}[note]    mang về
    ${topping}=    Set Variable    ${{ [(t['name'], t['unitPrice'], t['qty']) for t in $ly['toppings']] }}
    Should Be Equal    ${topping}    ${{ [('Trân châu', 5000, 2), ('Thạch', 3000, 1)] }}
    ...    Topping không xuống sổ kèm giá lúc bán.
    Should Be Equal As Integers    ${đơn}[subtotal]    66000
    Should Be Equal As Integers    ${đơn}[total]    66000    Tổng đơn lệch tổng các dòng.

Món có thực đơn riêng: chạm là mở sheet chọn, đóng sheet mà không THÊM thì món không vào đơn
    [Documentation]    Món thuộc nhóm có tuỳ chọn hay topping (Đồ uống) hỏi trước rồi mới vào giỏ; món của
    ...    nhóm không có thực đơn riêng (Cơm tấm, nhóm Đồ ăn) vẫn một chạm là vào. Đóng sheet là đổi ý,
    ...    giỏ và sổ không được có món đó.
    Cài Thực Đơn Đồ Uống
    Mở Màn    /
    Chọn Món    Cà phê sữa
    Wait For Elements State    ${SHEET} >> css=button:has-text("THÊM")    visible
    Click    ${SHEET} >> css=button[aria-label="Đóng"]
    Wait For Elements State    ${SHEET}    detached

    Chọn Món    Cơm tấm
    Chờ Thấy Chữ    Xem đơn · 1 món
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d['name'] for d in $dòng if d['orderId'] == ${đơn}[id]]
    Should Be Equal    ${của_đơn}    ${{ ['Cơm tấm sườn'] }}    Món đóng sheet không THÊM vẫn lọt vào sổ.

Chip ghi chú lấy từ ghi chú đã bán gần đây và ghi đúng cụm đó xuống sổ
    [Documentation]    Chip là các cụm ghi chú hay dùng trong những dòng đã bán trên máy này. Chạm chip
    ...    chỉ thêm đúng cụm đó vào ô ghi chú; dòng xuống sổ mang đúng chữ như người bán tự gõ.
    Mở Màn    /
    Chọn Món    Phở bò
    Sửa Dòng    Phở bò đặc biệt
    Điền Ô    Ghi chú    không hành, mang về
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn

    Mở Màn    /
    Chọn Món    Trà đá
    Sửa Dòng    Trà đá
    Click    ${SHEET} >> css=[aria-label="Ghi chú gần đây"] >> css=button:text-is("mang về")
    ${ghi_chú}=    Đọc Ô    Ghi chú
    Should Be Equal    ${ghi_chú}    mang về
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${trà}=    Evaluate    [d for d in $dòng if d['orderId'] == ${đơn}[id]][0]
    Should Be Equal    ${trà}[note]    mang về    Chip ghi chú không xuống sổ đúng cụm đã chạm.

Ghi chú gõ trùng chữ một lựa chọn thì không thành chip ghi chú
    [Documentation]    Bản trước 2.8.0 ghi "Đá riêng" thẳng vào ghi chú dòng. Thành chip ghi chú thì nó nằm
    ...    ngay dưới chip tuỳ chọn Đá riêng cùng chữ, chạm nhầm là lách luật loại trừ của nhóm Đá.
    Mở Màn    /
    Chọn Món    Phở bò
    Sửa Dòng    Phở bò đặc biệt
    Điền Ô    Ghi chú    Đá riêng, mang về
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn

    Mở Màn    /
    Chọn Món    Cơm tấm
    Sửa Dòng    Cơm tấm sườn
    Wait For Elements State    ${SHEET} >> css=[aria-label="Ghi chú gần đây"] >> css=button:text-is("mang về")    visible
    Get Element Count    ${SHEET} >> css=[aria-label="Ghi chú gần đây"] >> css=button:text-is("Đá riêng")    ==    0

Lời dặn dài cả câu không thành chip ghi chú làm sheet tràn ngang
    [Documentation]    Chip không xuống dòng, nên một ghi chú dài không có ", " thành chip rộng hơn khổ màn và
    ...    đẩy sheet tràn ngang. Cụm quá dài không lên chip; cụm ngắn vẫn lên.
    Mở Màn    /
    Chọn Món    Phở bò
    Sửa Dòng    Phở bò đặc biệt
    Điền Ô    Ghi chú    không lấy ống hút để đá riêng ra túi nylon gói kỹ giúp em, cay
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn

    Mở Màn    /
    Chọn Món    Cơm tấm
    Sửa Dòng    Cơm tấm sườn
    Wait For Elements State    ${SHEET} >> css=[aria-label="Ghi chú gần đây"] >> css=button:text-is("cay")    visible
    Get Element Count    ${SHEET} >> css=[aria-label="Ghi chú gần đây"] >> css=button    ==    1
    # Đo mép từng chip với mép sheet: thân sheet tự cuộn nên `scrollWidth` của dialog không lộ phần tràn.
    ${lọt}=    Evaluate JavaScript    ${SHEET}
    ...    (sheet) => [...sheet.querySelectorAll('[aria-label="Ghi chú gần đây"] button')].every((chip) => chip.getBoundingClientRect().right <= sheet.getBoundingClientRect().right + 0.5)
    Should Be True    ${lọt}    Chip ghi chú thò ra ngoài mép sheet.

Bỏ món trong sheet sửa rồi bấm Hoàn lại thì dòng về nguyên vẹn cả giá riêng lẫn ghi chú
    [Documentation]    Nút "Bỏ món" nằm sát XONG ở chân sheet nên dễ chạm nhầm; nó đi chung đường Hoàn lại
    ...    với gõ 0. Hoàn lại phải đặt lại đúng dòng cũ — đối chiếu sổ chứ không chỉ con số trên màn.
    Mở Màn    /
    Chọn Món    Phở bò
    Chọn Món    Cơm tấm
    Sửa Dòng    Phở bò đặc biệt
    Bấm Nút    Đổi giá
    Điền Ô    Đơn giá riêng cho đơn này    40000
    Điền Ô    Ghi chú    ít hành
    Bấm Nút    XONG

    Sửa Dòng    Phở bò đặc biệt (ít hành)
    Click    ${SHEET} >> css=button:text-is("Bỏ món")
    Chờ Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn
    Bấm Nút    Hoàn lại
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${phở}=    Evaluate    [d for d in $dòng if d['orderId'] == $đơn['id'] and d['name'] == 'Phở bò đặc biệt'][0]
    Should Be Equal As Numbers    ${phở}[qty]    1    Hoàn lại không đưa đúng số lượng về.
    Should Be Equal As Integers    ${phở}[unitPrice]    40000    Hoàn lại làm mất giá riêng của dòng.
    Should Be Equal    ${phở}[note]    ít hành    Hoàn lại làm mất ghi chú của dòng.

Hai ly cùng món khác topping là hai dòng riêng; thêm topping cho ly trơn thì gộp vào dòng cùng topping
    [Documentation]    Gộp nhầm hai ly khác topping là bán thiếu hoặc thừa tiền topping mà không lỗi nào
    ...    hiện ra. Khoá dòng gồm cả tuỳ chọn lẫn topping; sửa dòng làm khoá trùng thì cộng số lượng.
    Cài Thực Đơn Đồ Uống
    Mở Màn    /
    Chọn Món    Cà phê sữa
    Click    css=button[aria-label="Thêm Trân châu"]
    Bấm Thêm Vào Đơn
    Chọn Món    Cà phê sữa
    Bấm Thêm Vào Đơn
    Chờ Thấy Chữ    Xem đơn · 2 món

    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    sorted([d for d in $dòng if d['orderId'] == ${đơn}[id]], key=lambda d: d['amount'])
    Length Should Be    ${của_đơn}    2    Hai ly khác topping bị gộp về một dòng.
    Should Be Equal As Integers    ${của_đơn}[0][amount]    20000
    Should Be Equal As Integers    ${của_đơn}[1][amount]    25000

Thêm topping cho ly trơn đến mức trùng dòng có sẵn thì gộp số lượng, không đẻ dòng thứ ba
    Cài Thực Đơn Đồ Uống
    Mở Màn    /
    Chọn Món    Cà phê sữa
    Click    css=button[aria-label="Thêm Trân châu"]
    Bấm Thêm Vào Đơn
    Chọn Món    Cà phê sữa
    Bấm Thêm Vào Đơn
    Sửa Dòng    Cà phê sữa
    Click    css=button[aria-label="Thêm Trân châu"]
    Bấm Nút    XONG

    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == ${đơn}[id]]
    Length Should Be    ${của_đơn}    1    Hai ly cùng topping không gộp thành một dòng.
    Should Be Equal As Numbers    ${của_đơn}[0][qty]    2
    Should Be Equal As Integers    ${của_đơn}[0][amount]    50000

Bấm Đã hiểu để dọn banner bỏ món, không phải bấm Hoàn lại
    [Documentation]    Bỏ món bằng cách gõ 0 thường là CỐ Ý, và banner sống tới hết đơn. Trước đây nút
    ...    duy nhất trên banner là "Hoàn lại", nên người bán muốn dọn banner phải bấm đúng cái nút
    ...    chèn dòng — mà `upsert` cộng dồn qty: bỏ 3 tô, chạm lại món 3 lần, bấm Hoàn lại theo quán
    ...    tính ⇒ sổ ghi 6 tô. Phải luôn có một lối thoát không đụng vào tiền.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Phở bò
    Gõ Số Lượng    Phở bò đặc biệt    3
    Keyboard Key    press    Tab
    Gõ Số Lượng    Phở bò đặc biệt    0
    Keyboard Key    press    Tab
    Chờ Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn

    Chọn Món    Phở bò
    Chọn Món    Phở bò
    Chọn Món    Phở bò
    Bấm Nút    Đã hiểu
    Không Được Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn

    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == ${đơn}[id]]
    Length Should Be    ${của_đơn}    1
    Should Be Equal As Numbers    ${của_đơn}[0][qty]    3
    ...    Số lượng bị cộng dồn — banner bỏ món đã đẩy người bán vào nút chèn dòng.

Gõ 0 trong sheet sửa dòng cũng bỏ món VÀ cũng có đường hoàn lại
    [Documentation]    Hai đường cùng nói "0 là bỏ món" mà chỉ một đường dựng được banner hoàn lại thì
    ...    quy tắc đó có ngoại lệ không ai ghi ở đâu — gỡ nhầm từ sheet là mất dòng không lối về.
    Mở Màn    /
    Chọn Món    Phở bò
    Sửa Dòng    Phở bò đặc biệt
    Điền Ô    Số lượng    0
    Bấm Nút    XONG
    Chờ Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn

    Bấm Nút    Hoàn lại
    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == ${đơn}[id]]
    Length Should Be    ${của_đơn}    1    Hoàn lại từ sheet không đưa dòng trở lại giỏ.

Cụm không đọc được ở ô tìm món ở lại trong ô, không biến mất theo cụm đã thêm
    [Documentation]    Người bán gõ "1.000 pho bo + 2 tra da" là định đặt một nghìn tô. Trước đây trà đá
    ...    được thêm, ô tìm món bị xoá trắng, và cụm phở biến mất không dấu vết — tệ hơn mất dòng ở
    ...    giỏ, vì ở giỏ ít ra còn nhìn thấy.
    [Tags]    regression
    Mở Màn    /
    Gõ Vào Ô Tìm Món    1.000 pho bo + 2 tra da
    Keyboard Key    press    Enter
    Chờ Thấy Chữ    Chưa đọc được

    ${còn_lại}=    Get Property    css=input[type=search]    value
    Should Be Equal    ${còn_lại}    1.000 pho bo
    ...    Cụm chưa đọc được đã bị xoá khỏi ô — người bán không còn gì để đối chiếu.

    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == ${đơn}[id]]
    Length Should Be    ${của_đơn}    1
    Should Be Equal    ${của_đơn}[0][name]    Trà đá

Thêm món qua ô tìm món không được nuốt cảnh báo đang đứng
    [Documentation]    Banner đang đứng có thể là cảnh báo giỏ mang giá LẺ trong khi công tắc là SỈ.
    ...    Nuốt nó đi là để đơn chốt ở giá sai không dấu vết. Ô tìm món chỉ được ĐẶT cảnh báo của
    ...    chính nó, không được dọn của người khác.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Phở bò
    Gõ Số Lượng    Phở bò đặc biệt    0
    Keyboard Key    press    Tab
    Chờ Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn

    Gõ Vào Ô Tìm Món    2 tra da
    Keyboard Key    press    Enter
    Chờ Thấy Chữ    Trà đá
    Chờ Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn

Hoàn lại biến mất khi món đã tự quay lại giỏ, không hứa suông
    [Documentation]    `restoreLine` cố ý không làm gì khi dòng đã quay lại giỏ, vì `upsert` cộng dồn
    ...    qty. Nhưng nút vẫn hiện thì nó hứa suông theo hướng IM: bỏ 3 tô, chạm lại 1 lần, bấm Hoàn
    ...    lại tưởng lấy được 3 — sổ ghi 1, không con số nào nhảy để người bán kịp thấy.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Phở bò
    Gõ Số Lượng    Phở bò đặc biệt    3
    Keyboard Key    press    Tab
    Gõ Số Lượng    Phở bò đặc biệt    0
    Keyboard Key    press    Tab
    Chờ Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn

    Chọn Món    Phở bò
    Không Được Thấy Chữ    Hoàn lại
    Chờ Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn

    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == ${đơn}[id]]
    Length Should Be    ${của_đơn}    1
    Should Be Equal As Numbers    ${của_đơn}[0][qty]    1
    ...    Nút biến mất là chưa đủ: sổ phải ghi 1 tô, không phải 3 hay 4.

Bấm − ở số lượng 1 cũng bỏ món VÀ cũng có đường hoàn lại
    [Documentation]    `bumpQty` xuống 0 đi thẳng vào `removeLine` trong reducer, không qua handler
    ...    dựng banner. Nút − là ô 44px nằm sát ô số lượng ở màn 320px — đường chạm nhầm dễ nhất cả
    ...    màn — và nếu đó là dòng duy nhất thì footer THU TIỀN cũng bị tháo theo.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Phở bò
    Chọn Món    Trà đá
    Bớt Một    Phở bò đặc biệt
    Chờ Thấy Chữ    Đã bỏ Phở bò đặc biệt khỏi đơn

    Bấm Nút    Hoàn lại
    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${dòng}=    Đọc Bảng    orderLines
    ${của_đơn}=    Evaluate    [d for d in $dòng if d['orderId'] == ${đơn}[id]]
    Length Should Be    ${của_đơn}    2    Hoàn lại sau khi bấm − không đưa dòng trở lại giỏ.
    ${theo_tên}=    Evaluate    {d['name']: d['qty'] for d in $của_đơn}
    Should Be Equal As Numbers    ${theo_tên}[Phở bò đặc biệt]    1
    ...    Đếm dòng thôi thì hoàn lại SAI số lượng vẫn xanh.
    Should Be Equal As Numbers    ${theo_tên}[Trà đá]    1

Gõ cả ô toàn thứ không đọc được thì phải báo, không im lặng tuyệt đối
    [Documentation]    Nhánh hỏng NẶNG hơn (không đọc được cụm nào) trước đây im hơn nhánh hỏng nhẹ
    ...    (đọc được một nửa) — bấm Enter không gì xảy ra, người bán bấm lại, vẫn không gì.
    [Tags]    regression
    Mở Màn    /
    Gõ Vào Ô Tìm Món    1.000 pho bo
    Keyboard Key    press    Enter
    Chờ Thấy Chữ    Chưa đọc được

Phụ thu gõ thừa số 0 không đẩy tổng đơn vượt trần làm sập màn thu tiền
    [Documentation]    Phụ thu từng không có trần: 9.007.199.254.740.991 cộng tiền hàng hiện tổng lệch một
    ...    đồng, bấm THU TIỀN thì `assertMoney` ném và ErrorBoundary nuốt đơn đang lên dở. Ô giờ dừng ở
    ...    999.999.999; đơn chốt với đúng con số đó.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Đơn
    Bấm Nút    Giảm giá / phụ thu
    Điền Ô    Phụ thu    999999999
    ${ô_phụ_thu}=    Ô Theo Nhãn    Phụ thu
    Type Text    ${ô_phụ_thu}    0    clear=${False}
    Chờ Thấy Chữ    Tối đa 999.999.999 đ.
    Bấm Nút    ÁP DỤNG
    Chờ Thấy Chữ    1.000.054.999 đ
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[surcharge]    999999999    Sổ ghi sai phụ thu.
    Should Be Equal As Integers    ${đơn}[total]    1000054999    Sổ ghi sai tổng đơn.

Khách đưa gõ thừa số 0 thì ô giữ số cũ, đơn vẫn trả đủ chứ không thành nợ
    [Documentation]    Ô tiền bỏ phím vượt trần thay vì trả `null`; ở ô Khách đưa, `null` nghĩa là khách chưa
    ...    đưa đồng nào và đơn trả đủ sẽ âm thầm thành đơn nợ.
    [Tags]    regression
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Điền Tiền Khách Đưa    999999999
    ${ô_khách_đưa}=    Ô Theo Nhãn    Khách đưa
    Type Text    ${ô_khách_đưa}    0    clear=${False}
    Chờ Thấy Chữ    Tối đa 999.999.999 đ.
    Chờ Thấy Chữ    999.944.999 đ
    Chốt Đơn

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal    ${đơn}[status]    paid    Phím thừa ở ô Khách đưa biến đơn trả đủ thành đơn nợ.
    Should Be Equal As Integers    ${đơn}[paidAmount]    ${đơn}[total]    Sổ ghi sai số khách đã trả.

APK: Back khi sheet đơn đang mở chỉ đóng sheet, giỏ giữ nguyên
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Mở Màn    /
    Chọn Món    Phở bò
    Chọn Món    Trà đá
    Mở Đơn
    Wait For Elements State    ${SHEET_ĐƠN}    visible
    ${giỏ_trước}=    Wait Until Keyword Succeeds    10x    200ms    Đọc Dòng Giỏ Nháp Phải Có    2

    Bấm Back Android
    Wait For Elements State    ${SHEET_ĐƠN}    detached
    Get Url    ==    ${BASE_URL}/
    ${thu_app}=    Số Lần Thu App
    Should Be Equal As Integers    ${thu_app}    0    Back khi sheet đang mở mà app thu xuống nền.
    # Nháp ghi trễ ~300 ms: đợi qua khoảng đó, nếu Back có đổi giỏ thì nháp đã kịp đổi.
    Sleep    600ms
    ${giỏ_sau}=    Đọc Dòng Giỏ Nháp Phải Có    2
    Should Be Equal    ${giỏ_sau}    ${giỏ_trước}    Back đóng sheet mà làm đổi số lượng trong giỏ nháp.

APK: màn chặn dữ liệu trả Back cho Android, không giữ người bán lại
    [Documentation]    Hồi quy suýt lọt khi sửa #65: plugin App (thêm vào để nhận Back) nuốt Back khi chưa có
    ...    listener, nên màn ngoài router (màn chặn dữ liệu) không lùi được mà cũng không thoát được. Màn Bán
    ...    phải bật handler và có đúng một listener; khi màn chặn hiện, handler phải tắt và không còn listener nào
    ...    để Back trả về cho Android.
    [Tags]    regression
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Mở Màn    /
    Chờ Thấy Chữ    Phở bò
    Wait Until Keyword Succeeds    10x    200ms    Cờ Back Của Plugin Phải Là    True

    Nâng Version Sổ Trên Máy
    Chờ Thấy Chữ    Cần cập nhật app
    Wait Until Keyword Succeeds    10x    200ms    Cờ Back Của Plugin Phải Là    False
    Back Android Không Có Listener

APK: Back khi đang lưu thu tiền bị nuốt, sổ ghi đúng một phiếu thu
    [Documentation]    Lỗi cũ (#72): Back trên APK đóng luôn sheet Thu tiền giữa lúc đang lưu đơn. Sheet biến mất
    ...    nên người bán tưởng đã huỷ, nhưng lệnh ghi vẫn chạy nốt rồi app nhảy sang phiếu. Ca này giữ lệnh ghi treo
    ...    bằng một giao dịch IndexedDB khác trên `orders`, bấm Back trong lúc treo, rồi nhả: sheet vẫn mở, app không
    ...    thu xuống nền, và `payments` chỉ có đúng một dòng cho đơn.
    [Tags]    regression
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Giữ Ghi Sổ Lại
    Click    ${NÚT_XONG}
    Chờ Thấy Chữ    Đang lưu…

    Bấm Back Android
    # Back đóng sheet là một lần vẽ lại sau lệnh Back: đợi qua nó rồi mới kiểm sheet còn mở.
    Sleep    300ms
    Wait For Elements State    ${SHEET_THU_TIỀN}    visible
    Chờ Thấy Chữ    Đang lưu…
    Get Url    ==    ${BASE_URL}/
    ${thu_app}=    Số Lần Thu App
    Should Be Equal As Integers    ${thu_app}    0    Back khi đang lưu mà app thu xuống nền.

    Nhả Ghi Sổ Ra
    Wait For Condition    Url    contains    /phieu
    ${đơn}=    Đơn Mới Nhất
    ${mã_đơn}=    Set Variable    ${đơn}[id]
    ${thu}=    Đọc Bảng    payments
    ${dòng_thu}=    Evaluate    [dòng for dòng in $thu if dòng['orderId'] == $mã_đơn]
    Length Should Be    ${dòng_thu}    1    Sổ phải có đúng một dòng thu cho đơn vừa bán, không được ghi hai lần.
    Should Be Equal As Integers    ${dòng_thu}[0][amount]    ${đơn}[total]    Số tiền trong dòng thu không khớp tổng đơn.


*** Keywords ***
Nâng Version Sổ Trên Máy
    [Documentation]    Mở IndexedDB của app ở version cao hơn — như một bản app mới hơn trên cùng máy — để app
    ...    hiện màn chặn "Cần cập nhật app".
    Evaluate JavaScript    ${None}
    ...    async () => {
    ...        const db = (await indexedDB.databases()).find((d) => d.name === 'my-biller')
    ...        await new Promise((resolve, reject) => {
    ...            const request = indexedDB.open(db.name, db.version + 1)
    ...            request.onsuccess = () => { request.result.close(); resolve() }
    ...            request.onerror = () => reject(request.error)
    ...        })
    ...    }

Đọc Dòng Giỏ Nháp Phải Có
    [Documentation]    Tên và số lượng từng dòng trong nháp giỏ ở localStorage. Nháp ghi trễ khoảng 300 ms sau mỗi
    ...    lần đổi giỏ, nên dùng với `Wait Until Keyword Succeeds` để chờ nháp đủ số dòng.
    [Arguments]    ${số_dòng}
    ${dòng}=    Evaluate JavaScript    ${None}
    ...    () => JSON.parse(localStorage.getItem('${KHOÁ_NHÁP_GIỎ}')).lines.map((line) => ({ name: line.name, qty: line.qty }))
    Length Should Be    ${dòng}    ${số_dòng}    Nháp giỏ chưa có đủ ${số_dòng} dòng.
    RETURN    ${dòng}

*** Test Cases ***
Thứ hạng bán chạy giữ trong ca: quay lại trong app thì lưới không xếp lại, tải lại trang mới xếp theo đơn mới
    [Documentation]    Mốc của bộ mẫu: không có đơn mới thì Cơm tấm sườn (135.000) đứng đầu lưới Tất cả, Phở bò đặc biệt
    ...    (110.000) thứ hai. Thứ hạng đọc một lần cho mỗi lượt tải trang. Bán thêm một Phở bò đặc biệt (55.000) thì
    ...    Phở lên 165.000 và vượt Cơm tấm, nhưng quay lại màn bán bằng nút "Quay lại" của phiếu rồi tab "Bán" (điều
    ...    hướng trong app, không tải lại trang) vẫn phải thấy Cơm tấm đầu lưới. Chỉ sau khi tải lại trang Phở mới lên đầu.
    ...    Ca bắt đầu ở màn Thêm sau khi nạp mẫu và vào màn Bán bằng tab, để nút "Quay lại" về đúng tài liệu cũ:
    ...    nếu lượt quay lại có tải lại trang thì thứ hạng đọc lại và ca không kiểm được gì.
    ...    Chọn nhóm Đồ ăn thì về thứ tự tên: Cơm tấm sườn trước Phở bò đặc biệt.
    Click    css=nav >> css=a[href="/"]
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button >> nth=0 >> text=Cơm tấm sườn    visible
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Chốt Đơn

    Click    css=button[aria-label="Quay lại"]
    Wait For Elements State    css=nav >> css=a[href="/"]    visible
    Click    css=nav >> css=a[href="/"]
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button >> nth=0 >> text=Cơm tấm sườn    visible

    Mở Màn    /
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button >> nth=0 >> text=Phở bò đặc biệt    visible
    Click    css=[role=group][aria-label="Nhóm"] >> css=button:has-text("Đồ ăn")
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button >> nth=0 >> text=Cơm tấm sườn    visible
    ${ô_thứ_hai}=    Get Text    ${LƯỚI_MẶT_HÀNG} >> css=button >> nth=1
    Should Contain    ${ô_thứ_hai}    Phở bò đặc biệt

    ${đơn}=    Đơn Mới Nhất
    Should Be Equal As Integers    ${đơn}[total]    55000
    Should Be Equal As Integers    ${đơn}[paidAmount]    55000
    ${đơn_hàng}=    Đọc Bảng    orders
    Length Should Be    ${đơn_hàng}    3    Phải có hai đơn của bộ mẫu và một đơn vừa bán.
