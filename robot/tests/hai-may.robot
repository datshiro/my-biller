*** Settings ***
Documentation       Hai máy bán hàng dùng chung một Durable Object thật. Mọi ca dính tiền đọc lại
...                 IndexedDB ở cả A và B; không đưa token hay mã ghép vào log Robot.
Resource            ../resources/hai-may.resource
Library             OperatingSystem
Library             String
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Hai Máy Đã Ghép
Test Teardown       Đóng Hai Máy
Test Tags           hai-may    regression

*** Variables ***
${NÚT_ẢNH_PHIẾU}    css=button:has-text("CHIA SẺ QUA ZALO"), button:has-text("TẢI ẢNH PHIẾU")

*** Test Cases ***
Đơn ở máy A hiện ở máy B mà không tải lại trang
    [Documentation]    Khóa lý do tồn tại của sổ chung: đơn đã chốt ở một quầy phải tự tới quầy kia.
    Chọn Máy A
    Click    ${NAV_BAN}
    Chọn Món    Trà đá
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${bắt_đầu}=    Evaluate    __import__('time').monotonic()
    ${hội_tụ}=    Run Keyword And Return Status
    ...    Wait Until Keyword Succeeds    30x    100ms    Bảng Máy Phải Có Số Dòng
    ...    orders    3    ${MÁY_B_PAGE}
    ${độ_trễ}=    Evaluate    __import__('time').monotonic() - ${bắt_đầu}
    IF    not ${hội_tụ}
        ${orders_a}=    Đọc Bảng    orders    ${MÁY_A_PAGE}
        ${orders_b}=    Đọc Bảng    orders    ${MÁY_B_PAGE}
        ${pending}=    Đọc Bảng    outbox    ${MÁY_A_PAGE}
        ${state}=    Đọc Bảng    deviceState    ${MÁY_A_PAGE}
        ${notice}=    Evaluate    [row.get('message') for row in $state if row.get('key') == 'notice']
        ${a_count}=    Get Length    ${orders_a}
        ${b_count}=    Get Length    ${orders_b}
        ${pending_count}=    Get Length    ${pending}
        Fail    Chưa hội tụ: A=${a_count}, B=${b_count}, outbox=${pending_count}, notice=${notice}
    END
    Should Be True    ${độ_trễ} <= 3.0    Đơn mất ${độ_trễ} giây mới hiện ở máy B.
    Hai Bảng Phải Cùng Gid Và Nội Dung    orders
    Hai Bảng Phải Cùng Gid Và Nội Dung    orderLines
    Hai Bảng Phải Cùng Gid Và Nội Dung    payments

Ba đơn tạo khi mất mạng lên sổ đúng một lần và phiếu vẫn tải được
    [Documentation]    Khóa lối bán lúc chập mạng: ba đơn nằm bền trong outbox, phiếu cuối vẫn dựng
    ...    và tải được, rồi cả ba hội tụ đúng một lần khi có mạng lại.
    Chọn Máy A
    Mở Màn    /
    Set Offline    ${True}
    FOR    ${index}    IN RANGE    3
        Chọn Món    Trà đá
        Mở Sheet Thu Tiền
        Chốt Đơn
        IF    ${index} < 2
            Click    css=a:has-text("Chi tiết")
            Click    ${NAV_BAN}
        END
    END

    Bảng Máy Phải Có Số Dòng    orders    5    ${MÁY_A_PAGE}
    Bảng Máy Phải Có Số Dòng    orders    2    ${MÁY_B_PAGE}
    ${pending}=    Đọc Bảng    outbox    ${MÁY_A_PAGE}
    Should Not Be Empty    ${pending}
    Wait For Elements State    ${NÚT_ẢNH_PHIẾU}    visible    timeout=30s
    Wait For Elements State    ${NÚT_ẢNH_PHIẾU}    enabled
    ${nhãn_nút}=    Get Text    ${NÚT_ẢNH_PHIẾU}
    IF    'TẢI ẢNH PHIẾU' in $nhãn_nút
        ${promise}=    Promise To Wait For Download
        Click    ${NÚT_ẢNH_PHIẾU}
        ${download}=    Wait For    ${promise}
        File Should Exist    ${download}[saveAs]
    ELSE
        Should Contain    ${nhãn_nút}    CHIA SẺ QUA ZALO
    END

    Set Offline    ${False}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    80x    500ms    Bảng Máy Phải Có Số Dòng
    ...    orders    5    ${MÁY_B_PAGE}
    Hai Bảng Phải Cùng Gid Và Nội Dung    orders
    Hai Bảng Phải Cùng Gid Và Nội Dung    orderLines
    Hai Bảng Phải Cùng Gid Và Nội Dung    payments

Hai máy mất mạng vẫn tạo mã phiếu khác nhau và hội tụ khi nối lại
    [Documentation]    Chữ máy phải chống đụng mã ngay tại chỗ, không mượn mạng hoặc đổi mã sau bán.
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /
    Mở Màn Trên Máy    ${MÁY_B_PAGE}    /
    Chọn Máy A
    Set Offline    ${True}
    Chọn Máy B
    Set Offline    ${True}

    Chọn Máy A
    Chọn Món    Trà đá
    Mở Sheet Thu Tiền
    Chốt Đơn
    ${orders_a}=    Đọc Bảng    orders    ${MÁY_A_PAGE}
    ${order_a}=    Evaluate    max($orders_a, key=lambda row: row['id'])
    Chọn Máy B
    Chọn Món    Trà đá
    Mở Sheet Thu Tiền
    Chốt Đơn
    ${orders_b}=    Đọc Bảng    orders    ${MÁY_B_PAGE}
    ${order_b}=    Evaluate    max($orders_b, key=lambda row: row['id'])

    Should Not Be Equal    ${order_a}[code]    ${order_b}[code]
    Should Match Regexp    ${order_a}[code]    ^PBH-\\d{6}-A\\d{3}$
    Should Match Regexp    ${order_b}[code]    ^PBH-\\d{6}-B\\d{3}$

    Set Offline    ${False}
    Chọn Máy A
    Set Offline    ${False}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Wait Until Keyword Succeeds    80x    500ms    Bảng Máy Phải Có Số Dòng
    ...    orders    4    ${MÁY_A_PAGE}
    Bảng Máy Phải Có Số Dòng    orders    4    ${MÁY_B_PAGE}
    # Outbox rỗng chỉ chứng minh Worker đã nhận thao tác. Phiếu thu còn sinh thêm bản order chuẩn
    # từ Worker, nên chờ đúng điều kiện hội tụ thay vì đọc giữa hai sự kiện hoặc Sleep cứng.
    Wait Until Keyword Succeeds    30x    100ms    Hai Bảng Phải Cùng Gid Và Nội Dung    orders

Thu nợ ở máy A thì máy B không còn đòi lại
    [Documentation]    Khóa lỗi hai cuốn sổ cùng đòi một khoản: tiền và dư nợ phải hội tụ ở cả hai máy.
    Chọn Máy B
    Mở Sheet Thu Nợ Hai Máy    Anh Hùng
    Chọn Máy A
    Mở Sheet Thu Nợ Hai Máy    Anh Hùng
    Điền Ô    Thu bao nhiêu    100000
    Bấm Nút Thu Hai Máy

    Wait Until Keyword Succeeds    40x    500ms    Hai Bảng Phải Cùng Gid Và Nội Dung    payments
    Chọn Máy B
    Click    css=[role=dialog][aria-label^="Thu nợ"] >> css=button:has-text("THU ")
    Chờ Thấy Chữ    Khách chỉ còn nợ 0 đ
    Mở Màn Trên Máy    ${MÁY_B_PAGE}    /cong-no
    Wait Until Keyword Succeeds    40x    500ms    Chờ Thấy Chữ    Chưa ai nợ tiền
    Hai Bảng Phải Cùng Gid Và Nội Dung    orders
    Hai Bảng Phải Cùng Gid Và Nội Dung    payments

Huỷ đơn ở máy A giữ phiếu thu trên cả hai máy
    [Documentation]    Lỗi cũ xoá tiền thật khi huỷ đơn; hai bản sao phải giữ phiếu và chỉ bỏ phân bổ.
    Chọn Máy A
    Bán Nhanh    Phở bò
    ${orders}=    Đọc Bảng    orders    ${MÁY_A_PAGE}
    ${order}=    Evaluate    max($orders, key=lambda row: row['id'])
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /don/${order}[id]
    Bấm Nút    Huỷ đơn
    Xác Nhận Trong Hộp    Huỷ đơn
    Chờ Thấy Chữ    Đơn này đã huỷ

    Wait Until Keyword Succeeds    40x    500ms    Đơn Theo Gid Phải Có Trạng Thái
    ...    ${order}[gid]    void    ${MÁY_B_PAGE}
    Hai Bảng Phải Cùng Gid Và Nội Dung    orders
    Hai Bảng Phải Cùng Gid Và Nội Dung    payments
    Phiếu Của Đơn Phải Chưa Phân Bổ    ${order}[gid]    ${MÁY_A_PAGE}
    Phiếu Của Đơn Phải Chưa Phân Bổ    ${order}[gid]    ${MÁY_B_PAGE}

Đóng tab dẫn đầu thì tab còn lại tiếp quản và vẫn đẩy đơn
    [Documentation]    Lease không được mắc kẹt ở tab đã đóng; epoch mới phải tiếp tục đường ghi.
    Chọn Máy A
    ${page_a2}=    New Page    ${BASE_URL}/
    Close Page    ${MÁY_A_PAGE}    context=ALL    browser=ALL
    Set Test Variable    ${MÁY_A_PAGE}    ${page_a2}

    Wait Until Keyword Succeeds    45x    500ms    Epoch Máy Phải Từ    ${MÁY_A_PAGE}    2
    Chọn Máy A
    Bán Nhanh    Trà đá
    Wait Until Keyword Succeeds    40x    500ms    Bảng Máy Phải Có Số Dòng
    ...    orders    3    ${MÁY_B_PAGE}

Máy chủ từ chối đơn ghi thì dòng cục bộ được hoàn lại
    [Documentation]    Một event có quan hệ cha sai không được nằm lại thành dữ liệu ma; thông báo
    ...    cũ không được che trạng thái đồng bộ mới và người bán có thể ẩn riêng nó.
    Chọn Máy A
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    Món bị từ chối
    Điền Ô    Giá bán *    12000
    Set Offline    ${True}
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    Món bị từ chối
    Làm Hỏng Quan Hệ Của Event Mặt Hàng    Món bị từ chối
    Set Offline    ${False}

    Wait Until Keyword Succeeds    40x    500ms    Mặt Hàng Không Được Tồn Tại
    ...    Món bị từ chối    ${MÁY_A_PAGE}
    Mặt Hàng Không Được Tồn Tại    Món bị từ chối    ${MÁY_B_PAGE}
    Chọn Máy A
    Chờ Thấy Chữ    Thiếu bản ghi cha itemGroups

    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    Món đang chờ sau từ chối
    Điền Ô    Giá bán *    15000
    Set Offline    ${True}
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    Thiếu bản ghi cha itemGroups
    Chờ Thấy Chữ    1 thay đổi đang nằm trên máy này
    Click    css=button[aria-label="Ẩn thông báo đồng bộ"]
    Không Được Thấy Chữ    Thiếu bản ghi cha itemGroups
    Chờ Thấy Chữ    1 thay đổi đang nằm trên máy này
    Set Offline    ${False}
    Wait Until Keyword Succeeds    40x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}

Máy đã ghép không lộ đường xoá, outbox và danh tính vẫn còn
    [Documentation]    Máy đã ghép chỉ được kéo lại bản sao đọc, không được lộ đường xoá/nhập có
    ...    thể làm mất thao tác chưa đẩy hoặc chìa khóa ghép máy.
    Chọn Máy A
    Mở Màn    /them/cai-dat
    Không Được Thấy Chữ    Xoá toàn bộ dữ liệu
    Không Được Thấy Chữ    Nhập từ file sao lưu
    Chờ Thấy Chữ    Kéo lại từ đầu

    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    Món đang chờ mạng
    Điền Ô    Giá bán *    13000
    Set Offline    ${True}
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    Món đang chờ mạng
    ${outbox}=    Đọc Bảng    outbox    ${MÁY_A_PAGE}
    Should Not Be Empty    ${outbox}
    ${device}=    Đọc Bảng    deviceState    ${MÁY_A_PAGE}
    ${connection}=    Evaluate    [row for row in $device if row['key'] == 'connection']
    Length Should Be    ${connection}    1
    Should Be True    ${connection}[0][hasToken]

File sao lưu ở máy đã ghép không chứa token hay mã máy
    [Documentation]    Khóa đường rò chìa khóa qua file người bán có thể gửi bằng Zalo.
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /them/cai-dat
    ${promise}=    Promise To Wait For Download
    Bấm Nút    SAO LƯU RA FILE
    ${download}=    Wait For    ${promise}
    ${text}=    Get File    ${download}[saveAs]

    Should Not Contain    ${text}    "deviceState"
    Should Not Contain    ${text}    "token"
    Should Not Contain    ${text}    "connection"

Máy bị thu hồi không ghi được vào sổ chung
    [Documentation]    Thu hồi phải có hiệu lực với socket đang mở và request kế tiếp của máy B.
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /ghep-may
    Wait Until Keyword Succeeds    20x    500ms    Chờ Thấy Chữ    Quầy B · chữ B
    Click    xpath=//p[normalize-space()="Quầy B · chữ B"]/ancestor::div[contains(@class,"rounded-card")]//button[contains(.,"Thu hồi")]
    Chờ Hộp Xác Nhận    Thu hồi “Quầy B”?
    Xác Nhận Trong Hộp    Thu hồi máy

    Chọn Máy B
    Chờ Thấy Chữ    Máy này đã bị thu hồi
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    Món từ máy bị thu hồi
    Điền Ô    Giá bán *    14000
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    Máy này đã bị thu hồi. Hãy ghép lại trước khi ghi thêm vào sổ.
    Wait Until Keyword Succeeds    20x    500ms    Mặt Hàng Không Được Tồn Tại
    ...    Món từ máy bị thu hồi    ${MÁY_A_PAGE}
    Mặt Hàng Không Được Tồn Tại    Món từ máy bị thu hồi    ${MÁY_B_PAGE}

Kéo lại từ đầu dựng đúng sổ tiền từ máy chủ
    [Documentation]    Xóa bản sao đọc không được làm đổi tổng đã thu hay công nợ của máy B.
    ${payments_trước}=    Đọc Bảng    payments    ${MÁY_B_PAGE}
    ${tổng_trước}=    Evaluate    sum(row['amount'] for row in $payments_trước)
    Mở Màn Trên Máy    ${MÁY_B_PAGE}    /them/cai-dat
    Bấm Nút    Kéo lại từ đầu

    Wait Until Keyword Succeeds    60x    500ms    Bảng Máy Phải Có Số Dòng
    ...    orders    2    ${MÁY_B_PAGE}
    ${payments_sau}=    Đọc Bảng    payments    ${MÁY_B_PAGE}
    ${tổng_sau}=    Evaluate    sum(row['amount'] for row in $payments_sau)
    Should Be Equal As Integers    ${tổng_sau}    ${tổng_trước}
    Hai Bảng Phải Cùng Gid Và Nội Dung    orders
    Hai Bảng Phải Cùng Gid Và Nội Dung    payments

Máy chủ từ chối sửa giá thì giá cũ trở lại trên cả hai máy
    [Documentation]    Event sửa phải mang ảnh trước; bị từ chối không được để giá ma trong bản sao A.
    Chọn Máy A
    ${items}=    Đọc Bảng    items    ${MÁY_A_PAGE}
    ${tea}=    Evaluate    [row for row in $items if row['name'] == 'Trà đá'][0]
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /them/mat-hang/${tea}[id]
    Điền Ô    Giá bán *    9000
    Set Offline    ${True}
    Bấm Nút    LƯU MẶT HÀNG
    Làm Hỏng Quan Hệ Của Event Mặt Hàng    Trà đá
    Set Offline    ${False}

    Wait Until Keyword Succeeds    40x    500ms    Giá Mặt Hàng Phải Là
    ...    Trà đá    3000    ${MÁY_A_PAGE}
    Giá Mặt Hàng Phải Là    Trà đá    3000    ${MÁY_B_PAGE}

Tab dẫn đầu bị treo thì epoch mới fence tab cũ
    [Documentation]    Giả lập lease của tab treo hết hạn trong khi tab cũ vẫn mở; khi tab cũ chạy
    ...    lại, nó không được giành lease hoặc áp batch bằng epoch cũ.
    Chọn Máy A
    ${page_a1}=    Set Variable    ${MÁY_A_PAGE}
    ${page_a2}=    New Page    ${BASE_URL}/
    Cho Lease Hiện Tại Hết Hạn
    Đánh Thức Runner Hiện Tại
    Set Test Variable    ${MÁY_A_PAGE}    ${page_a2}

    Wait Until Keyword Succeeds    45x    500ms    Epoch Máy Phải Từ    ${MÁY_A_PAGE}    2
    Switch Page    ${page_a1}    context=ALL    browser=ALL
    Đánh Thức Runner Hiện Tại
    Switch Page    ${page_a2}    context=ALL    browser=ALL
    Chọn Máy A
    Bán Nhanh    Trà đá
    Wait Until Keyword Succeeds    40x    500ms    Bảng Máy Phải Có Số Dòng
    ...    orders    3    ${MÁY_B_PAGE}
    Epoch Máy Phải Từ    ${MÁY_A_PAGE}    2
    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}

*** Keywords ***
Mở Sheet Thu Nợ Hai Máy
    [Arguments]    ${tên}
    Mở Màn    /cong-no
    Click    css=button:has-text("${tên}")
    Wait For Elements State    css=[role=dialog][aria-label="Thu nợ · ${tên}"]    visible

Bấm Nút Thu Hai Máy
    Click    css=[role=dialog][aria-label^="Thu nợ"] >> css=button:has-text("THU ")
    Wait For Elements State    css=[role=dialog][aria-label^="Thu nợ"]    detached

Đơn Theo Gid Phải Có Trạng Thái
    [Arguments]    ${gid}    ${trạng_thái}    ${page}
    ${orders}=    Đọc Bảng    orders    ${page}
    ${found}=    Evaluate    [row for row in $orders if row['gid'] == $gid]
    Length Should Be    ${found}    1
    Should Be Equal    ${found}[0][status]    ${trạng_thái}

Phiếu Của Đơn Phải Chưa Phân Bổ
    [Arguments]    ${order_gid}    ${page}
    ${orders}=    Đọc Bảng    orders    ${page}
    ${order}=    Evaluate    [row for row in $orders if row['gid'] == $order_gid][0]
    ${payments}=    Đọc Bảng    payments    ${page}
    ${found}=    Evaluate    [row for row in $payments if row['orderId'] == $order['id']]
    Length Should Be    ${found}    1    Phiếu thu của đơn đã biến mất.
    Should Be Equal As Integers    ${found}[0][allocatedOrderId]    0
