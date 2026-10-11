*** Settings ***
Documentation       Hai máy bán hàng dùng chung một Durable Object thật. Mọi ca dính tiền đọc lại
...                 IndexedDB ở cả A và B; không đưa token hay mã ghép vào log Robot.
Resource            ../resources/hai-may.resource
Resource            ../resources/sao-luu.resource
Resource            ../resources/may-cu.resource
Library             OperatingSystem
Library             String
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Run Keywords    Tắt Máy Cũ    AND    Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Hai Máy Đã Ghép
Test Teardown       Đóng Hai Máy
Test Tags           hai-may    regression

*** Variables ***
${NÚT_ẢNH_PHIẾU}       css=button:has-text("CHIA SẺ QUA ZALO"), button:has-text("TẢI ẢNH PHIẾU")
${NEO_ĐỒNG_BỘ}         css=[role=status][aria-label="Neo đồng bộ"]
${Ô_CHỌN_FILE_CSV}     css=input[aria-label="Chọn file CSV"]

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
    ...    Wait Until Keyword Succeeds    30x    100ms    Ba Bảng Đơn Phải Cùng Gid Và Nội Dung
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

Logo và hình chìm cài ở máy A tới máy B
    [Documentation]    Cấu hình hình chìm trên tem là của cả sổ, không theo máy (chốt ở #51): bật ở quầy
    ...    này thì tem in ở quầy kia cũng có logo. Chỉ so độ dài logo và cấu hình — không đưa logo vào log.
    Chọn Máy A
    Cài Logo Quán    Bên phải
    ${ở_a}=    Đọc Logo Quán    ${MÁY_A_PAGE}
    Should Be Equal    ${ở_a}[watermark]    {"enabled":true,"position":"center","strength":"light","align":"right"}
    Logo Máy B Phải Hội Tụ Với    ${ở_a}

    Chọn Máy A
    Cài Logo Quán    Góc trên phải
    ${ở_a}=    Đọc Logo Quán    ${MÁY_A_PAGE}
    Should Be Equal    ${ở_a}[watermark]    {"enabled":true,"position":"corner","strength":"light","align":"center"}
    Logo Máy B Phải Hội Tụ Với    ${ở_a}

Heartbeat cục bộ giữ lease và đường sync realtime
    [Documentation]    Khóa lỗi poll mạng dài hơn TTL làm lease hết hạn: heartbeat cục bộ phải giữ
    ...    lease sống, còn WebSocket vẫn đưa đơn sang máy kia trong 3 giây.
    Sleep    20s
    Lease Máy Phải Còn Hạn    ${MÁY_A_PAGE}
    Lease Máy Phải Còn Hạn    ${MÁY_B_PAGE}

    Chọn Máy A
    Click    ${NAV_BAN}
    Chọn Món    Trà đá
    Mở Sheet Thu Tiền
    Chốt Đơn

    ${bắt_đầu}=    Evaluate    __import__('time').monotonic()
    Wait Until Keyword Succeeds    30x    100ms    Bảng Máy Phải Có Số Dòng
    ...    orders    3    ${MÁY_B_PAGE}
    ${độ_trễ}=    Evaluate    __import__('time').monotonic() - ${bắt_đầu}
    Should Be True    ${độ_trễ} <= 3.0    Đơn mất ${độ_trễ} giây mới hiện ở máy B.

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
    Hai Bảng Phải Hội Tụ    orders
    Hai Bảng Phải Hội Tụ    orderLines
    Hai Bảng Phải Hội Tụ    payments

Hai máy mất mạng vẫn tạo mã phiếu khác nhau và hội tụ khi nối lại
    [Documentation]    Chữ máy phải chống đụng mã ngay tại chỗ, không mượn mạng hoặc đổi mã sau bán.
    [Tags]    shard-a
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
    # Máy B hội tụ độc lập với máy A, không ăn theo. Đo ra hai máy cách nhau dưới 0,2s nên khẳng định
    # trần ở đây xanh gần như mọi lượt — rồi thua đúng lượt máy B chậm hơn, và thua tức thì vì nó
    # không có ngưỡng nào để chờ.
    Wait Until Keyword Succeeds    80x    500ms    Bảng Máy Phải Có Số Dòng
    ...    orders    4    ${MÁY_B_PAGE}
    # Outbox rỗng chỉ chứng minh Worker đã nhận thao tác. Phiếu thu còn sinh thêm bản order chuẩn
    # từ Worker, nên chờ đúng điều kiện hội tụ thay vì đọc giữa hai sự kiện hoặc Sleep cứng.
    Hai Bảng Phải Hội Tụ    orders

Thu nợ ở máy A thì máy B không còn đòi lại
    [Documentation]    Khóa lỗi hai cuốn sổ cùng đòi một khoản: tiền và dư nợ phải hội tụ ở cả hai máy.
    Chọn Máy B
    Mở Sheet Thu Nợ Hai Máy    Anh Hùng
    Chọn Máy A
    Mở Sheet Thu Nợ Hai Máy    Anh Hùng
    Điền Ô    Thu bao nhiêu    100000
    Bấm Nút Thu Hai Máy

    Hai Bảng Phải Hội Tụ    payments
    Chọn Máy B
    Click    css=[role=dialog][aria-label^="Thu nợ"] >> css=button:has-text("THU ")
    Chờ Thấy Chữ    Khách chỉ còn nợ 0 đ
    Mở Màn Trên Máy    ${MÁY_B_PAGE}    /cong-no
    Wait Until Keyword Succeeds    40x    500ms    Chờ Thấy Chữ    Chưa ai nợ tiền
    Hai Bảng Phải Hội Tụ    orders
    Hai Bảng Phải Hội Tụ    payments

Huỷ đơn ở máy A giữ phiếu thu trên cả hai máy
    [Documentation]    Lỗi cũ xoá tiền thật khi huỷ đơn; hai bản sao phải giữ phiếu và chỉ bỏ phân bổ.
    [Tags]    shard-a
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
    Hai Bảng Phải Hội Tụ    orders
    Hai Bảng Phải Hội Tụ    payments
    Phiếu Của Đơn Phải Chưa Phân Bổ    ${order}[gid]    ${MÁY_A_PAGE}
    Phiếu Của Đơn Phải Chưa Phân Bổ    ${order}[gid]    ${MÁY_B_PAGE}

Máy bản 2.19.0 thu nợ đơn Mang về thì sổ chung và máy kia vẫn giữ Mang về, phiếu vẫn in MANG VỀ
    [Documentation]    Máy 2.19.0 không biết `serviceMode`: đọc đơn rồi ghi lại hàng thiếu trường, và đẩy event `put`
    ...    của đơn thiếu trường đó khi thu tiền. Chưa có khung chạy app bản 2.19.0 thật, nên ca dựng đúng cái
    ...    nó gửi: máy B ngoại tuyến thu nợ, rồi gỡ `serviceMode` khỏi hàng đơn của B và khỏi event đơn còn
    ...    chờ trong outbox trước khi nối mạng. Worker dựng `put` từ bản đã lưu nên event phát lại phải còn
    ...    `takeaway`. Bằng chứng chính là máy A (và phiếu của nó); dòng kiểm ở máy B chỉ cho thấy code mới trên B
    ...    nhận lại cờ từ event phát lại, không phải hành vi của máy 2.19.0 thật. Đối chiếu cờ và tiền bằng `Đọc Bảng`.
    Chọn Máy A
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Click    ${CHIP_MANG_VỀ}
    Chọn Hình Thức Trả    Bán nợ
    Click    ${NÚT_CHỌN_KHÁCH_NỢ}
    Chọn Khách Trong Sheet    Anh Hùng
    Get Attribute    ${CHIP_MANG_VỀ}    aria-pressed    ==    true
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    Should Be Equal    ${đơn}[serviceMode]    takeaway
    Should Be Equal    ${đơn}[status]    unpaid
    Hai Bảng Phải Hội Tụ    orders

    Chọn Máy B
    ${orders_b}=    Đọc Bảng    orders    ${MÁY_B_PAGE}
    ${nợ}=    Evaluate    sum(o['total'] - o['paidAmount'] for o in $orders_b if o['customerName'] == 'Anh Hùng' and o['status'] != 'void')
    Should Be True    ${nợ} >= 55000
    Mở Sheet Thu Nợ Hai Máy    Anh Hùng
    Set Offline    ${True}
    Điền Ô    Thu bao nhiêu    ${nợ}
    Bấm Nút Thu Hai Máy
    ${gỡ}=    Gỡ Mang Về Như Máy Bản Cũ    ${đơn}[gid]
    Should Be True    ${gỡ} >= 1    Thu nợ không sinh event đơn nào trong outbox — ca không đo gì.
    Set Offline    ${False}

    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Hai Bảng Phải Hội Tụ    payments
    Hai Bảng Phải Hội Tụ    orders
    FOR    ${page}    IN    ${MÁY_A_PAGE}    ${MÁY_B_PAGE}
        ${orders}=    Đọc Bảng    orders    ${page}
        ${của_gid}=    Evaluate    [o for o in $orders if o['gid'] == $đơn['gid']][0]
        Should Be Equal    ${của_gid.get('serviceMode')}    takeaway    Event máy cũ làm mất cờ Mang về.
        Should Be Equal    ${của_gid}[status]    paid
        Should Be Equal As Integers    ${của_gid}[paidAmount]    ${của_gid}[total]
    END

    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /don/${đơn}[id]/phieu
    Chờ Thấy Chữ    MANG VỀ

Thiết bị cũ không ghi đè khoản thu đã hoàn ở thiết bị khác
    [Documentation]    Hai máy cùng mở khoản thu pending; quyết định hoàn tiền đã lên Worker phải là
    ...    terminal, nên lựa chọn “bỏ” từ bản sao offline cũ bị từ chối rồi hội tụ về refunded.
    [Tags]    shard-a
    Chọn Máy A
    Bán Nhanh    Phở bò
    ${orders_a}=    Đọc Bảng    orders    ${MÁY_A_PAGE}
    ${order_a}=    Evaluate    max($orders_a, key=lambda row: row['id'])
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /don/${order_a}[id]
    Bấm Nút    Huỷ đơn
    Xác Nhận Trong Hộp    Huỷ đơn
    Wait Until Keyword Succeeds    40x    500ms    Phiếu Của Đơn Phải Chưa Phân Bổ
    ...    ${order_a}[gid]    ${MÁY_B_PAGE}

    ${orders_b}=    Đọc Bảng    orders    ${MÁY_B_PAGE}
    ${order_b}=    Evaluate    [row for row in $orders_b if row['gid'] == $order_a['gid']][0]
    Mở Màn Trên Máy    ${MÁY_B_PAGE}    /don/${order_b}[id]
    Chờ Thấy Chữ    Khoản thu chờ xử lý
    Set Offline    ${True}

    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /don/${order_a}[id]
    Bấm Nút    Đã trả lại khách
    Xác Nhận Trong Hộp    Xác nhận
    Wait Until Keyword Succeeds    40x    500ms    Phiếu Của Đơn Phải Có Trạng Thái
    ...    ${order_a}[gid]    refunded    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    40x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}

    Chọn Máy B
    Bấm Nút    Bỏ có ghi vết
    Xác Nhận Trong Hộp    Xác nhận
    Phiếu Của Đơn Phải Có Trạng Thái    ${order_a}[gid]    discarded    ${MÁY_B_PAGE}
    Set Offline    ${False}

    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Wait Until Keyword Succeeds    80x    500ms    Phiếu Của Đơn Phải Có Trạng Thái
    ...    ${order_a}[gid]    refunded    ${MÁY_B_PAGE}
    # Hai phép chốt cuối cũng phải chờ được: thao tác bị từ chối ở trên đặt `resyncRequired`, nên sau
    # lượt hội tụ đầu vẫn còn một nhịp `resetReadReplica` xoá sạch 9 bảng rồi `pullAll` đổ lại. Đọc trần
    # rơi vào đúng khoảng trống đó thì thấy phiếu "biến mất" — đó là #33, không phải lỗi hội tụ.
    Wait Until Keyword Succeeds    40x    500ms    Phiếu Của Đơn Phải Có Trạng Thái
    ...    ${order_a}[gid]    refunded    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    40x    500ms    Phiếu Của Đơn Phải Có Trạng Thái
    ...    ${order_a}[gid]    refunded    ${MÁY_B_PAGE}

Đóng tab dẫn đầu thì tab còn lại tiếp quản và vẫn đẩy đơn
    [Documentation]    Lease không được mắc kẹt ở tab đã đóng; epoch mới phải tiếp tục đường ghi.
    [Tags]    shard-a
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
    ...    thể làm mất thao tác chưa đẩy hoặc chìa khóa ghép máy. Lời giải thích chỉ chỉ thêm đường huỷ ghép
    ...    ở màn Máy bán hàng — đường đó tự chặn khi còn thao tác chưa đẩy.
    Chọn Máy A
    Mở Màn    /them/cai-dat
    Chờ Thấy Chữ    Sao lưu & khôi phục
    Không Được Thấy Chữ    Xoá toàn bộ dữ liệu
    ${outbox_trước}=    Đọc Bảng    outbox    ${MÁY_A_PAGE}
    ${máy_trước}=    Đọc Bảng    deviceState    ${MÁY_A_PAGE}
    Mở Màn    /them/sao-luu
    Chờ Thấy Chữ    Máy này đã ghép sổ chung
    Chờ Thấy Chữ    làm trên một máy chưa ghép
    Wait For Elements State    css=button:text-is("Kéo lại từ đầu")    visible
    Không Được Thấy Chữ    Nhập từ file sao lưu
    Chờ Thấy Chữ    huỷ ghép máy này ở Cài đặt › Máy bán hàng
    ${outbox_sau}=    Đọc Bảng    outbox    ${MÁY_A_PAGE}
    ${máy_sau}=    Đọc Bảng    deviceState    ${MÁY_A_PAGE}
    Should Be Equal    ${outbox_sau}    ${outbox_trước}    Mở màn sao lưu trên máy đã ghép mà outbox đổi.
    ${khoá_trước}=    Evaluate    sorted(row['key'] for row in $máy_trước if row['key'] != 'lease')
    ${khoá_sau}=    Evaluate    sorted(row['key'] for row in $máy_sau if row['key'] != 'lease')
    Should Be Equal    ${khoá_sau}    ${khoá_trước}    Mở màn sao lưu trên máy đã ghép mà deviceState đổi.

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
    [Tags]    shard-a
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /them/sao-luu
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

    # Máy bị thu hồi không được thấy nút nhập file: ghi đè ở đây làm sổ máy lệch hẳn với sổ chung.
    Mở Màn    /them/sao-luu
    Chờ Thấy Chữ    Máy này đã bị thu hồi khỏi sổ chung
    Chờ Thấy Chữ    Cài đặt › Máy bán hàng
    Chờ Thấy Chữ    Dùng máy này như máy chưa ghép
    Không Được Thấy Chữ    Nhập từ file sao lưu

Kéo lại từ đầu dựng đúng sổ tiền từ máy chủ
    [Documentation]    Xóa bản sao đọc không được làm đổi tổng đã thu hay công nợ của máy B.
    [Tags]    shard-a
    ${payments_trước}=    Đọc Bảng    payments    ${MÁY_B_PAGE}
    ${tổng_trước}=    Evaluate    sum(row['amount'] for row in $payments_trước)
    Mở Màn Trên Máy    ${MÁY_B_PAGE}    /them/sao-luu
    Bấm Nút    Kéo lại từ đầu

    Wait Until Keyword Succeeds    60x    500ms    Bảng Máy Phải Có Số Dòng
    ...    orders    2    ${MÁY_B_PAGE}
    ${payments_sau}=    Đọc Bảng    payments    ${MÁY_B_PAGE}
    ${tổng_sau}=    Evaluate    sum(row['amount'] for row in $payments_sau)
    Should Be Equal As Integers    ${tổng_sau}    ${tổng_trước}
    Hai Bảng Phải Hội Tụ    orders
    Hai Bảng Phải Hội Tụ    payments

Máy chủ từ chối sửa giá thì giá cũ trở lại trên cả hai máy
    [Documentation]    Event sửa phải mang ảnh trước; bị từ chối không được để giá ma trong bản sao A.
    [Tags]    shard-a
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
    # `Bán Nhanh` đẩy HAI sự kiện: đơn rồi phiếu thu. Vòng chờ trên chỉ chứng minh sự kiện ĐƠN đã tới
    # máy B, nên khẳng định trần ở đây là đua với vòng đi-về của phiếu thu. Trên loopback vòng đó xong
    # trong khe giữa hai dòng nên ca luôn xanh; trên Worker thật nó thua chừng một nửa số lượt.
    Wait Until Keyword Succeeds    40x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}

Ghi chú từng món đi qua sổ chung và tới máy kia nguyên vẹn
    [Documentation]    Cửa tử của trường mới: zod strip khoá lạ TRONG IM LẶNG, và Worker dùng chính
    ...    `OrderLineSchema` để nhận event rồi THAY payload bằng bản đã parse. Worker chạy bản cũ sẽ
    ...    cắt mất `note` trước khi ghi vào sổ chung — máy A giữ ghi chú cục bộ, máy B không bao giờ
    ...    thấy, và không một lỗi nào hiện ra. Ca này phải nằm ở suite hai máy: máy chưa ghép đặt
    ...    `enabled = false` nên không sinh sự kiện sync nào, ca có xanh cũng chẳng chứng minh gì.
    Chọn Máy A
    Click    ${NAV_BAN}
    Chọn Món    Cà phê sữa
    Sửa Dòng    Cà phê sữa
    Điền Ô    Ghi chú    ít đường
    Bấm Nút    XONG
    Mở Sheet Thu Tiền
    Chốt Đơn

    Hai Bảng Phải Hội Tụ    orderLines

    # Lọc theo GHI CHÚ chứ không theo tên món: bộ mẫu đã có sẵn một dòng "Cà phê sữa" (seed.ts) nên
    # bốc phần tử [0] theo tên là bốc nhầm dòng seed, và ca sẽ xanh mà không đo gì. `orderId` cũng
    # không so được giữa hai máy — applier localize refs nên id là số cục bộ của từng máy.
    ${dòng_b}=    Đọc Bảng    orderLines    ${MÁY_B_PAGE}
    ${có_ghi_chú}=    Evaluate    [d for d in $dòng_b if d.get('note') == 'ít đường']
    Length Should Be    ${có_ghi_chú}    1
    ...    Ghi chú bị cắt trên đường qua sổ chung — máy B không thấy thứ máy A đã ghi.
    Should Be Equal    ${có_ghi_chú}[0][name]    Cà phê sữa

Tuỳ chọn, topping và thực đơn của nhóm món đi qua sổ chung và tới máy kia nguyên vẹn
    [Documentation]    Cùng cửa tử với ca ghi chú ngay trên, nhưng tiền hơn: Worker thay payload bằng bản
    ...    đã parse nên Worker chạy schema cũ XOÁ `toppings` và thực đơn khỏi sổ chung mà máy A vẫn
    ...    thấy đủ. Đọc `amount` ở máy B để chắc con số tiền đi cùng topping chứ không chỉ chữ.
    Chọn Máy A
    Cài Thực Đơn Đồ Uống
    Click    ${NAV_BAN}
    Chọn Món    Cà phê sữa
    Click    ${SHEET} >> css=button[aria-label="Thêm một"]
    Chọn Chip    Ít đường
    Click    css=button[aria-label="Thêm Trân châu"]
    Click    css=button[aria-label="Thêm Trân châu"]
    Click    css=button[aria-label="Thêm Thạch"]
    Điền Ô    Ghi chú    mang về
    Bấm Thêm Vào Đơn
    Mở Sheet Thu Tiền
    Chốt Đơn

    Hai Bảng Phải Hội Tụ    itemGroups
    Hai Bảng Phải Hội Tụ    orderLines

    Chọn Máy B
    ${nhóm_b}=    Đọc Bảng    itemGroups    ${MÁY_B_PAGE}
    ${đồ_uống}=    Evaluate    [g for g in $nhóm_b if g['name'] == 'Đồ uống'][0]
    Should Be Equal    ${đồ_uống}[optionGroups]    ${{ [{'name': 'Đường', 'choices': ['Ít đường', 'Không đường']}] }}
    ...    Thực đơn tuỳ chọn của nhóm bị cắt trên đường qua sổ chung.
    ${menu_b}=    Evaluate    [(t['name'], t['price']) for t in $đồ_uống['toppingMenu']]
    Should Be Equal    ${menu_b}    ${{ [('Trân châu', 5000), ('Thạch', 3000)] }}

    ${dòng_b}=    Đọc Bảng    orderLines    ${MÁY_B_PAGE}
    ${của_a}=    Evaluate    [d for d in $dòng_b if d.get('note') == 'mang về']
    Length Should Be    ${của_a}    1    Dòng có topping không tới máy B.
    ${ly}=    Set Variable    ${của_a}[0]
    Should Be Equal    ${ly}[options]    ${{ ['Ít đường'] }}    Tuỳ chọn bị cắt trên đường qua sổ chung.
    ${topping_b}=    Evaluate    [(t['name'], t['unitPrice'], t['qty']) for t in $ly['toppings']]
    Should Be Equal    ${topping_b}    ${{ [('Trân châu', 5000, 2), ('Thạch', 3000, 1)] }}
    ...    Topping bị cắt trên đường qua sổ chung — máy B thiếu thứ khách đã trả tiền.
    Should Be Equal As Integers    ${ly}[amount]    66000    Thành tiền ở máy B lệch máy A.

Màn Đối soát của hai máy nói cùng một con số
    [Documentation]    (a) Ca chỉ khoá TRẠNG THÁI CUỐI: hai máy cùng hiện "✓ Khớp sổ chung" với cùng số #,
    ...    bốn tổng bằng nhau, bảng payments giống nhau. (b) Nhánh "Còn N thay đổi chưa về máy này" cố tình
    ...    không assert ở đây vì nó phụ thuộc thời điểm quan sát: mở màn là một lần tải trang cứng, sau đó
    ...    ownerId mới bị lease của phiên trước chặn tới ~15 giây (src/db/sync/leader.ts) rồi poll local 2
    ...    giây mới claim được, nên "Còn N" khi tan ngay khi nán ~17 giây; nhánh đó đã có ca Vitest tất định
    ...    ở doi-soat-page.test.tsx. (c) Tiền điều kiện lastSeq A == B (đọc deviceState) triệt nguồn chớp
    ...    tắt đó: khi cả hai đã kéo hết thì "✓ Khớp" hiện sau một lượt GET /devices, không đợi lease.
    ...    Budget 25 giây (lease 15 + poll 2 + RTT) chỉ là lưới an toàn; dùng Wait For Elements State với
    ...    timeout tường minh chứ không bọc Chờ Thấy Chữ trong Wait Until Keyword Succeeds — Browser
    ...    Timeout 15 giây làm mỗi lượt thử tự chờ 15 giây, 40 lượt là ~10 phút mới đỏ. (d) Phải đọc hết
    ...    máy A TRƯỚC khi Chọn Máy B: Mở Màn Trên Máy đổi page, đọc A sau đó là đọc B rồi so B với chính B.
    ...    Chờ trên đúng phần tử neo chứ không chờ chữ trần: dòng hướng dẫn cuối màn cũng in "✓ Khớp sổ chung".
    [Tags]    shard-a
    Chọn Máy A
    Click    ${NAV_BAN}
    Chọn Món    Trà đá
    Mở Sheet Thu Tiền
    Chốt Đơn
    Hai Bảng Phải Hội Tụ    orders
    Hai Bảng Phải Hội Tụ    payments
    Wait Until Keyword Succeeds    40x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    40x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Wait Until Keyword Succeeds    40x    500ms    Hai Máy Phải Cùng lastSeq

    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /them/doi-soat
    Wait For Elements State    ${NEO_ĐỒNG_BỘ}:has-text("✓ Khớp sổ chung")    visible    timeout=25s
    ${neo_a}=    Get Text    ${NEO_ĐỒNG_BỘ}
    ${a}=    Đọc Bốn Tổng Đối Soát

    Chọn Máy B
    Mở Màn Trên Máy    ${MÁY_B_PAGE}    /them/doi-soat
    Wait For Elements State    ${NEO_ĐỒNG_BỘ}:has-text("✓ Khớp sổ chung")    visible    timeout=25s
    ${neo_b}=    Get Text    ${NEO_ĐỒNG_BỘ}
    ${b}=    Đọc Bốn Tổng Đối Soát

    Should Be Equal    ${neo_a}    ${neo_b}    Hai máy không đứng ở cùng một điểm của sổ chung.
    Should Be Equal    ${a}    ${b}    Cùng seq mà bốn tổng của hai máy lệch nhau.
    # Ghim một vế vào hằng: bộ mẫu 266.000/166.000 cộng đơn Trà đá 3.000 vừa bán tiền mặt.
    Should Be Equal    ${a}[doanh_thu]    269.000 đ
    Should Be Equal    ${a}[đã_thu]    169.000 đ
    Hai Bảng Phải Cùng Gid Và Nội Dung    payments

Máy mất mạng vẫn thấy hàng đợi của mình trên màn Đối soát
    [Documentation]    Mất mạng là lúc hàng đợi dài nhất, và số hàng đợi đọc cục bộ nên luôn có: câu neo
    ...    "Chưa có mạng" phải kèm số thay đổi chưa lên sổ chung, đếm theo txId (một đơn = một txId), so
    ...    với chính bảng outbox. Mở màn Đối soát một lần khi còn mạng rồi chỉ điều hướng trong app (không
    ...    Go To): dev server không có service worker, tải trang cứng lúc offline là trang lỗi của Chrome.
    ...    Có mạng lại: hàng đợi xả, bấm KIỂM TRA LẠI thì về "✓ Khớp" — nhánh lỗi không tự hỏi lại, nút là
    ...    đường ra; bọc retry vì Vite dev tải lại trang khi nối lại được websocket HMR.
    [Tags]    shard-a
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /them/doi-soat
    Chờ Thấy Chữ    TỔNG TOÀN SỔ
    Click    ${NAV_BAN}
    Set Offline    ${True}
    Chọn Món    Trà đá
    Mở Sheet Thu Tiền
    Chốt Đơn
    ${outbox}=    Đọc Bảng    outbox    ${MÁY_A_PAGE}
    Should Not Be Empty    ${outbox}
    ${số_tx}=    Evaluate    len({row['txId'] for row in $outbox})
    Click    css=a:has-text("Chi tiết")
    Click    ${NAV_THEM}
    Click    text=Cài đặt
    Click    text=Đối soát
    Wait For Elements State    ${NEO_ĐỒNG_BỘ}:has-text("Chưa có mạng")    visible    timeout=25s
    ${neo}=    Get Text    ${NEO_ĐỒNG_BỘ}
    Should Contain    ${neo}    ${số_tx} thay đổi trên máy này chưa lên sổ chung.

    Set Offline    ${False}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Hai Bảng Phải Hội Tụ    payments
    Wait Until Keyword Succeeds    40x    500ms    Hai Máy Phải Cùng lastSeq
    Chọn Máy A
    Wait Until Keyword Succeeds    8x    2s    Bấm Kiểm Tra Lại Rồi Phải Khớp

Đọc hỏng ở máy khác vẫn trả page về máy đang đứng
    [Tags]    regression
    [Documentation]    `Đọc Bảng` và `Đọc Ô Số` từng chỉ trả page về chỗ cũ sau khi đọc **thành công**:
    ...    lệnh `Switch Page` quay lại nằm sau phép đọc, không có TRY/FINALLY. Một phép đọc chéo hỏng
    ...    vì vậy bỏ page đứng lại ở máy kia, rồi keyword sau đó chết ở chỗ chẳng liên quan — ca ngoại
    ...    tuyến bên trên từng mất một lượt gỡ dài chỉ vì cái bẫy này. Đọc một bảng không tồn tại là
    ...    cách làm hỏng nhanh nhất: IndexedDB ném ngay ở `transaction()`, không phải chờ hết giờ.
    Chọn Máy A
    ${trước}=    Switch Page    CURRENT
    Run Keyword And Expect Error    *    Đọc Bảng    bảng_không_có_thật    ${MÁY_B_PAGE}
    ${sau}=    Switch Page    CURRENT
    Should Be Equal    ${sau}    ${trước}    Đọc hỏng bỏ page lại ở máy B.

Nhập file món ở máy A thì máy B có đủ món, nhóm và giá
    [Documentation]    Luồng nhập CSV đi đúng đường outbox nên đồng bộ như nhập tay.
    [Tags]    -regression    shard-a
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/hai-may-nhap-mon.csv
    Create File    ${f}    Nhóm,Tên món,Giá bán\nTráng miệng,Bánh flan,15000\nNước,Trà đá,3500
    Chọn Máy A
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE_CSV}    ${f}
    Chờ Thấy Chữ    1 món mới
    Chờ Thấy Chữ    1 món trùng
    Click    css=button:text-is("Cập nhật tất cả món trùng")
    Bấm Nút    NHẬP 2 MÓN

    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Hai Bảng Phải Hội Tụ    itemGroups
    Hai Bảng Phải Hội Tụ    items

    ${items_b}=    Đọc Bảng    items    ${MÁY_B_PAGE}
    ${groups_b}=    Đọc Bảng    itemGroups    ${MÁY_B_PAGE}
    ${trà_đá}=    Evaluate    next(i for i in $items_b if i['name'] == 'Trà đá')
    Should Be Equal As Integers    ${trà_đá}[unitPrice]    3500
    ${bánh_flan}=    Evaluate    next(i for i in $items_b if i['name'] == 'Bánh flan')
    ${nhóm_tráng_miệng}=    Evaluate    next(g for g in $groups_b if g['name'] == 'Tráng miệng')
    Should Be Equal As Integers    ${bánh_flan}[groupId]    ${nhóm_tráng_miệng}[id]
    [Teardown]    Run Keywords    Đóng Hai Máy    AND    Remove File    ${f}

Bán offline món trùng tên thì đơn vẫn còn trên cả hai máy và nối sang món có sẵn
    [Tags]    -regression
    [Documentation]    Khoá thiết kế: lỗi này chưa từng lên production. Trước đây, Worker trả
    ...    business-rejected sẽ cuộn mất đơn bán offline của máy sau khi món trùng tên bị từ chối.
    Chọn Máy A
    Mở Màn    /them/mat-hang/moi
    Set Offline    ${True}
    Chọn Máy B
    Mở Màn    /them/mat-hang/moi
    Set Offline    ${True}

    Chọn Máy A
    Điền Ô    Tên mặt hàng *    Bánh flan
    Điền Ô    Giá bán *    15000
    Bấm Nút    LƯU MẶT HÀNG

    Chọn Máy B
    Điền Ô    Tên mặt hàng *    Bánh flan
    Điền Ô    Giá bán *    16000
    Bấm Nút    LƯU MẶT HÀNG
    Bán Nhanh Khi Đang Ngoại Tuyến    Bánh flan
    Bán Nhanh Khi Đang Ngoại Tuyến    Bánh flan
    ${đơn_b_trước}=    Đọc Bảng    orders    ${MÁY_B_PAGE}
    ${dòng_b_trước}=    Đọc Bảng    orderLines    ${MÁY_B_PAGE}
    ${thu_b_trước}=    Đọc Bảng    payments    ${MÁY_B_PAGE}

    Chọn Máy A
    Set Offline    ${False}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Chọn Máy B
    Set Offline    ${False}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}

    Chờ Thấy Chữ    trùng tên món “Bánh flan” đang bán trong sổ chung
    Chờ Thấy Chữ    Máy này đã nối sang món có sẵn
    Chờ Thấy Chữ    15.000 đ

    Hai Bảng Phải Hội Tụ    items
    Hai Bảng Phải Hội Tụ    orders
    Wait Until Keyword Succeeds    80x    500ms    Dòng Đơn Hai Máy Phải Cùng Món
    Wait Until Keyword Succeeds    80x    500ms    Thu Của Hai Máy Phải Cùng Đơn

    ${items_a}=    Đọc Bảng    items    ${MÁY_A_PAGE}
    ${bánh_flan_a}=    Evaluate    [i for i in $items_a if i['name'] == 'Bánh flan']
    Length Should Be    ${bánh_flan_a}    1    Phải còn đúng một Bánh flan sau khi nối.
    Should Be Equal As Integers    ${bánh_flan_a}[0][unitPrice]    15000

    ${đơn_a}=    Đọc Bảng    orders    ${MÁY_A_PAGE}
    Length Should Be    ${đơn_a}    ${{ len($đơn_b_trước) }}
    ${dòng_a}=    Đọc Bảng    orderLines    ${MÁY_A_PAGE}
    ${dòng_bánh_flan_a}=    Evaluate    [l for l in $dòng_a if l['name'] == 'Bánh flan']
    Length Should Be    ${dòng_bánh_flan_a}    2
    FOR    ${dòng}    IN    @{dòng_bánh_flan_a}
        Should Be Equal As Integers    ${dòng}[itemId]    ${bánh_flan_a}[0][id]
        Should Be Equal As Integers    ${dòng}[unitPrice]    16000
    END
    ${thu_a}=    Đọc Bảng    payments    ${MÁY_A_PAGE}
    Length Should Be    ${thu_a}    ${{ len($thu_b_trước) }}

Hai máy cùng nhập một món mới lúc mất mạng thì chỉ món trùng được nối, các dòng khác vẫn lên
    [Tags]    -regression    shard-a
    [Documentation]    Nhập CSV cũng đi qua nhánh nối món giống hệt bán offline — không có lối
    ...    lái riêng nào bỏ qua luật tên trùng.
    Chọn Máy A
    Mở Màn    /them/nhap-file
    Set Offline    ${True}
    Chọn Máy B
    Mở Màn    /them/nhap-file
    Set Offline    ${True}

    ${f_a}=    Set Variable    ${DOWNLOAD_DIR}/hai-may-nhap-a.csv
    Create File    ${f_a}    Tên món,Giá bán\nBánh flan,15000
    Chọn Máy A
    Upload File By Selector    ${Ô_CHỌN_FILE_CSV}    ${f_a}
    Chờ Thấy Chữ    1 món mới
    Bấm Nút    NHẬP 1 MÓN

    ${f_b}=    Set Variable    ${DOWNLOAD_DIR}/hai-may-nhap-b.csv
    Create File    ${f_b}    Tên món,Giá bán\nXôi gấc,20000\nBánh flan,16000\nChè bưởi,18000
    Chọn Máy B
    Upload File By Selector    ${Ô_CHỌN_FILE_CSV}    ${f_b}
    Chờ Thấy Chữ    3 món mới
    Bấm Nút    NHẬP 3 MÓN

    Chọn Máy A
    Set Offline    ${False}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Chọn Máy B
    Set Offline    ${False}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Hai Bảng Phải Hội Tụ    items
    ${items_a}=    Đọc Bảng    items    ${MÁY_A_PAGE}
    ${bánh_flan}=    Evaluate    [i for i in $items_a if i['name'] == 'Bánh flan']
    Length Should Be    ${bánh_flan}    1
    Should Be Equal As Integers    ${bánh_flan}[0][unitPrice]    15000
    ${tên_còn_lại}=    Evaluate    sorted(i['name'] for i in $items_a if i['name'] in ('Xôi gấc', 'Chè bưởi'))
    Should Be Equal    ${tên_còn_lại}    ${{ ['Chè bưởi', 'Xôi gấc'] }}
    [Teardown]    Run Keywords    Đóng Hai Máy    AND    Remove File    ${f_a}    AND    Remove File    ${f_b}

Máy chưa thấy món trùng mà bán lại thì sổ chung chặn, chỉ món đó trở về như cũ, đơn sau đó vẫn còn
    [Tags]    -regression
    [Documentation]    Chốt cuối của Worker cho trường hợp máy CHƯA thấy món kia (vd đang mất mạng); trường
    ...    hợp máy đã thấy đủ dữ liệu thì form tự chặn sớm hơn ngay trên máy (ca ở mat-hang.robot).
    Chọn Máy A
    Mở Màn    /them/mat-hang/moi
    Set Offline    ${True}

    Chọn Máy B
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    Bánh
    Điền Ô    Giá bán *    10000
    Bấm Nút    LƯU MẶT HÀNG
    Click    css=button:has-text("Bánh")
    Bấm Nút    Ngừng bán mặt hàng này
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Set Offline    ${True}

    Chọn Máy A
    Điền Ô    Tên mặt hàng *    Bánh
    Điền Ô    Giá bán *    12000
    Bấm Nút    LƯU MẶT HÀNG
    Set Offline    ${False}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}

    Chọn Máy B
    Click    css=button:has-text("Bánh")
    Bấm Nút    Bán lại mặt hàng này
    Wait For Condition    Url    ==    ${BASE_URL}/them/mat-hang
    Bán Nhanh Khi Đang Ngoại Tuyến    Trà đá

    Set Offline    ${False}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Chờ Thấy Chữ    Không bán lại được món “Bánh”

    ${items_b}=    Đọc Bảng    items    ${MÁY_B_PAGE}
    ${bánh_b}=    Evaluate    [i for i in $items_b if i['name'] == 'Bánh' and i.get('unitPrice') == 10000]
    Length Should Be    ${bánh_b}    1
    Should Be Equal As Integers    ${bánh_b}[0][isActive]    0
    ${bánh_a}=    Evaluate    [i for i in $items_b if i['name'] == 'Bánh' and i.get('unitPrice') == 12000]
    Length Should Be    ${bánh_a}    1
    Should Be Equal As Integers    ${bánh_a}[0][isActive]    1
    # Bộ mẫu có 2 đơn; máy B thêm đúng 1 đơn Trà đá sau khi bán lại bị chặn.
    Wait Until Keyword Succeeds    80x    500ms    Bảng Máy Phải Có Số Dòng    orders    3    ${MÁY_B_PAGE}

Nhập khách ở máy A thì máy B có khách mới và khách cập nhật, hàng đợi rỗng
    [Documentation]    Khách nhập qua CSV đi cùng outbox với món, nên máy B phải thấy cả khách mới lẫn phần
    ...    cập nhật đúng như nhập tay.
    [Tags]    -regression    shard-a
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/hai-may-nhap-khach.csv
    Create File    ${f}    Tên,Số điện thoại,Địa chỉ\nChị Lan,0977111222,8 Nguyễn Huệ\nAnh Hùng,0912345678,5 Hai Bà Trưng
    Chọn Máy A
    Mở Màn    /them/nhap-file
    Click    css=button:text-is("Khách")
    Upload File By Selector    ${Ô_CHỌN_FILE_CSV}    ${f}
    Chờ Thấy Chữ    1 khách mới
    Chờ Thấy Chữ    1 khách trùng
    Click    css=button:text-is("Cập nhật tất cả khách trùng")
    Bấm Nút    NHẬP 2 KHÁCH

    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Hai Bảng Phải Hội Tụ    customers
    ${khách_b}=    Đọc Bảng    customers    ${MÁY_B_PAGE}
    Length Should Be    ${khách_b}    2
    ${chị_lan}=    Evaluate    next(c for c in $khách_b if c['name'] == 'Chị Lan')
    Should Be Equal    ${chị_lan}[address]    8 Nguyễn Huệ
    ${anh_hùng}=    Evaluate    next(c for c in $khách_b if c['name'] == 'Anh Hùng')
    Should Be Equal    ${anh_hùng}[address]    5 Hai Bà Trưng
    [Teardown]    Run Keywords    Đóng Hai Máy    AND    Remove File    ${f}

Huỷ ghép máy B giữ nguyên sổ tiền, máy A thấy B đã rời và B sao lưu khôi phục như máy chưa ghép
    [Tags]    -regression
    [Documentation]    Huỷ ghép không được đổi sổ tiền trên máy, phải làm máy kia thấy máy này đã rời, và để máy
    ...    vừa rời sao lưu rồi khôi phục được như một máy chưa ghép.
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Wait Until Keyword Succeeds    40x    500ms    Bản Sao Máy Phải Đuổi Kịp Sổ Chung    ${MÁY_B_PAGE}
    ${trước}=    Tổng Sổ Tiền Máy    ${MÁY_B_PAGE}
    Mở Màn Trên Máy    ${MÁY_B_PAGE}    /ghep-may
    Danh Sách Máy Đã Tải
    Chờ Thấy Chữ    RỜI SỔ CHUNG
    Click    css=button:text-is("Huỷ ghép máy này")
    Chờ Hộp Xác Nhận    Huỷ ghép “Quầy B”?
    Chờ Thấy Chữ    phải sao lưu rồi xoá sổ trên máy trước
    # `text-is`: `has-text("Huỷ ghép")` khớp cả nút "Huỷ" của hộp.
    Click    ${HỘP_XÁC_NHẬN} >> css=button:text-is("Huỷ ghép")
    # Câu báo lỗi mất mạng cũng chứa "máy này đã rời sổ chung", và `has-text` khớp cả nút "Huỷ ghép máy
    # này"; chờ đúng câu báo đã rời và đúng nhãn nút ghép.
    Chờ Thấy Chữ    giờ là sổ cục bộ
    Wait For Elements State    css=button:text-is("GHÉP MÁY NÀY")    visible

    ${sau}=    Tổng Sổ Tiền Máy    ${MÁY_B_PAGE}
    Should Be Equal    ${sau}    ${trước}    Huỷ ghép làm đổi sổ tiền trên máy.
    ${device}=    Đọc Bảng    deviceState    ${MÁY_B_PAGE}
    ${khoá}=    Evaluate    [row['key'] for row in $device]
    FOR    ${tên_khoá}    IN    connection    writeBlock    pairing    lease
        Should Not Contain    ${khoá}    ${tên_khoá}    Máy đã huỷ ghép vẫn còn khoá ${tên_khoá}.
    END
    Should Contain    ${khoá}    identity
    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}

    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /ghep-may
    Danh Sách Máy Đã Tải
    Không Được Thấy Chữ    Quầy B · chữ B

    Chọn Máy B
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    Món sau huỷ ghép
    Điền Ô    Giá bán *    15000
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    Món sau huỷ ghép
    # Máy chưa ghép ghi thẳng vào sổ cục bộ, không xếp hàng chờ lên sổ chung.
    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /them/mat-hang
    Chờ Thấy Chữ    Trà đá
    Mặt Hàng Không Được Tồn Tại    Món sau huỷ ghép    ${MÁY_A_PAGE}

    Chọn Máy B
    ${lúc_sao_lưu}=    Tổng Sổ Tiền Máy    ${MÁY_B_PAGE}
    Mở Màn    /them/sao-luu
    ${file}=    Sao Lưu Ra File
    Bán Nhanh    Trà đá
    Nhập File Sao Lưu    ${file}
    ${khôi_phục}=    Tổng Sổ Tiền Máy    ${MÁY_B_PAGE}
    Should Be Equal    ${khôi_phục}    ${lúc_sao_lưu}
    ...    Khôi phục trên máy vừa huỷ ghép không đưa sổ về đúng lúc sao lưu.

Còn thay đổi chưa lên sổ chung thì không huỷ ghép được cho tới khi đồng bộ xong
    [Tags]    -regression    shard-a
    [Documentation]    Bỏ hàng đợi khi huỷ ghép có thể bỏ nhầm thao tác đã lên sổ chung, nên nút huỷ ghép khoá
    ...    tới khi hàng đợi đẩy hết; thay đổi đó phải lên sổ chung trước khi máy rời.
    Chọn Máy B
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    Món chờ đồng bộ
    Điền Ô    Giá bán *    16000
    # Mất mạng lúc lưu để không tick nào đang bay kịp đẩy; có mạng lại thì lease đã thuộc tab treo.
    Set Offline    ${True}
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    Món chờ đồng bộ
    Giữ Lease Bằng Tab Treo
    Set Offline    ${False}
    ${outbox}=    Đọc Bảng    outbox    ${MÁY_B_PAGE}
    Should Not Be Empty    ${outbox}

    Mở Màn    /ghep-may
    Danh Sách Máy Đã Tải
    Chờ Thấy Chữ    Còn 1 thay đổi chưa lên sổ chung
    Wait For Elements State    css=button:text-is("Huỷ ghép máy này")    disabled

    Cho Lease Hiện Tại Hết Hạn
    Bấm Nút    Đồng bộ ngay
    Wait Until Keyword Succeeds    40x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Wait Until Keyword Succeeds    40x    500ms    Bản Sao Máy Phải Đuổi Kịp Sổ Chung    ${MÁY_B_PAGE}
    Wait For Elements State    css=button:text-is("Huỷ ghép máy này")    enabled
    Click    css=button:text-is("Huỷ ghép máy này")
    Chờ Hộp Xác Nhận    Huỷ ghép “Quầy B”?
    Click    ${HỘP_XÁC_NHẬN} >> css=button:text-is("Huỷ ghép")
    Chờ Thấy Chữ    giờ là sổ cục bộ
    Không Được Thấy Chữ    thay đổi ghi trong lúc huỷ ghép
    ${device}=    Đọc Bảng    deviceState    ${MÁY_B_PAGE}
    ${khoá}=    Evaluate    [row['key'] for row in $device]
    Should Not Contain    ${khoá}    connection    Máy đã huỷ ghép vẫn còn khoá connection.

    Wait Until Keyword Succeeds    40x    500ms    Món Phải Có Trên Máy    Món chờ đồng bộ    ${MÁY_A_PAGE}

Máy bị máy khác thu hồi dùng lại được như máy chưa ghép mà không đổi sổ
    [Tags]    -regression
    [Documentation]    Máy đã bị thu hồi có lối về sổ cục bộ: sổ giữ nguyên, hết khoá ghi, và mở lại nhập từ file.
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    ${trước}=    Tổng Sổ Tiền Máy    ${MÁY_B_PAGE}
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /ghep-may
    Wait Until Keyword Succeeds    20x    500ms    Chờ Thấy Chữ    Quầy B · chữ B
    Click    xpath=//p[normalize-space()="Quầy B · chữ B"]/ancestor::div[contains(@class,"rounded-card")]//button[contains(.,"Thu hồi")]
    Chờ Hộp Xác Nhận    Thu hồi “Quầy B”?
    Xác Nhận Trong Hộp    Thu hồi máy

    Chọn Máy B
    Chờ Thấy Chữ    Máy này đã bị thu hồi
    Mở Màn    /ghep-may
    Click    css=button:text-is("Dùng máy này như máy chưa ghép")
    Chờ Hộp Xác Nhận    Dùng máy này như máy chưa ghép?
    Chờ Thấy Chữ    ghép lại ngay bằng mã mới
    Xác Nhận Trong Hộp    Dùng như máy chưa ghép
    Chờ Thấy Chữ    giờ là sổ cục bộ
    ${device}=    Đọc Bảng    deviceState    ${MÁY_B_PAGE}
    ${khoá}=    Evaluate    [row['key'] for row in $device]
    Should Not Contain    ${khoá}    connection
    Should Not Contain    ${khoá}    writeBlock
    Should Not Contain    ${khoá}    notice
    ${sau}=    Tổng Sổ Tiền Máy    ${MÁY_B_PAGE}
    Should Be Equal    ${sau}    ${trước}    Về sổ cục bộ làm đổi sổ tiền trên máy.

    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    Món sau khi về cục bộ
    Điền Ô    Giá bán *    17000
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    Món sau khi về cục bộ
    Mở Màn    /them/sao-luu
    Wait For Elements State    css=button:has-text("Nhập từ file sao lưu")    visible

Huỷ ghép khi mất mạng báo cần mạng và máy vẫn ghép
    [Tags]    -regression    shard-a
    [Documentation]    Huỷ ghép cần mạng để máy kia biết; mất mạng thì báo rõ và máy vẫn ghép như cũ.
    Chọn Máy B
    # Mở màn trước khi mất mạng: Robot chạy trên Vite dev không có service worker, điều hướng lúc offline hỏng.
    Mở Màn    /ghep-may
    Danh Sách Máy Đã Tải
    Chờ Thấy Chữ    RỜI SỔ CHUNG
    Set Offline    ${True}
    Click    css=button:text-is("Huỷ ghép máy này")
    Click    ${HỘP_XÁC_NHẬN} >> css=button:text-is("Huỷ ghép")
    Chờ Thấy Chữ    Huỷ ghép cần mạng
    Wait For Elements State    css=button:has-text("TẠO MÃ GHÉP")    visible
    ${device}=    Đọc Bảng    deviceState    ${MÁY_B_PAGE}
    ${connection}=    Evaluate    [row for row in $device if row['key'] == 'connection']
    Length Should Be    ${connection}    1
    Should Be True    ${connection}[0][hasToken]
    ${khoá}=    Evaluate    [row['key'] for row in $device]
    Should Not Contain    ${khoá}    writeBlock
    Set Offline    ${False}
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /ghep-may
    Danh Sách Máy Đã Tải
    Chờ Thấy Chữ    Quầy B · chữ B

Cài đặt máy đã ghép hiện mã sổ rút gọn và chữ máy
    [Tags]    -regression
    [Documentation]    Dòng "Máy bán hàng" ở Cài đặt dựng chuỗi `Sổ:` từ `connection.shopId` thật của máy, để người bán
    ...    so bằng mắt hai máy có đang chung một sổ không. Hai máy đã ghép cùng sổ nên cùng mã, khác chữ máy.
    ${kỳ_vọng}=    Mã Sổ Rút Gọn Trên Máy    ${MÁY_B_PAGE}
    Mở Màn Trên Máy    ${MÁY_B_PAGE}    /them/cai-dat
    Chờ Thấy Chữ    Sổ: ${kỳ_vọng} · Máy B

    ${kỳ_vọng_a}=    Mã Sổ Rút Gọn Trên Máy    ${MÁY_A_PAGE}
    Should Be Equal    ${kỳ_vọng_a}    ${kỳ_vọng}    Hai máy đã ghép cùng sổ mà mã sổ khác nhau.
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /them/cai-dat
    Chờ Thấy Chữ    Sổ: ${kỳ_vọng_a} · Máy A

Huỷ ghép máy cuối cùng của quán thì hộp xác nhận cảnh báo nhưng vẫn cho huỷ
    [Tags]    -regression    shard-a
    [Documentation]    Máy hoạt động cuối cùng rời đi thì sổ chung không còn máy nào mở được: hộp xác nhận phải nói
    ...    điều đó khi chỉ còn một máy, im lặng khi còn máy khác, và mở hộp không được đổi gì trong sổ.
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    40x    500ms    Bản Sao Máy Phải Đuổi Kịp Sổ Chung    ${MÁY_A_PAGE}
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /ghep-may
    Danh Sách Máy Đã Tải
    Chờ Thấy Chữ    Quầy B · chữ B
    Click    css=button:text-is("Huỷ ghép máy này")
    Chờ Hộp Xác Nhận    Huỷ ghép “Quầy A”?
    Chờ Thấy Chữ    phải sao lưu rồi xoá sổ trên máy trước
    Không Được Thấy Chữ    máy cuối cùng còn ghép vào sổ chung
    Bỏ Qua Hộp Xác Nhận

    Click    xpath=//p[normalize-space()="Quầy B · chữ B"]/ancestor::div[contains(@class,"rounded-card")]//button[contains(.,"Thu hồi")]
    Chờ Hộp Xác Nhận    Thu hồi “Quầy B”?
    Xác Nhận Trong Hộp    Thu hồi máy
    Không Được Thấy Chữ    Quầy B · chữ B

    ${trước}=    Tổng Sổ Tiền Máy    ${MÁY_A_PAGE}
    ${device_trước}=    Đọc Bảng    deviceState    ${MÁY_A_PAGE}
    ${khoá_trước}=    Evaluate    sorted(row['key'] for row in $device_trước)
    Click    css=button:text-is("Huỷ ghép máy này")
    Chờ Hộp Xác Nhận    Huỷ ghép “Quầy A”?
    Chờ Thấy Chữ    máy cuối cùng còn ghép vào sổ chung
    Chờ Thấy Chữ    sổ chung không còn máy nào dùng được nữa
    ${lúc_hộp}=    Tổng Sổ Tiền Máy    ${MÁY_A_PAGE}
    Should Be Equal    ${lúc_hộp}    ${trước}    Mở hộp cảnh báo làm đổi sổ tiền trên máy.
    ${device_lúc_hộp}=    Đọc Bảng    deviceState    ${MÁY_A_PAGE}
    ${khoá_lúc_hộp}=    Evaluate    sorted(row['key'] for row in $device_lúc_hộp)
    Should Be Equal    ${khoá_lúc_hộp}    ${khoá_trước}    Mở hộp cảnh báo làm đổi deviceState.
    Should Contain    ${khoá_lúc_hộp}    connection
    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}

    Click    ${HỘP_XÁC_NHẬN} >> css=button:text-is("Huỷ ghép")
    Chờ Thấy Chữ    giờ là sổ cục bộ
    Wait For Elements State    css=button:text-is("GHÉP MÁY NÀY")    visible
    ${sau}=    Tổng Sổ Tiền Máy    ${MÁY_A_PAGE}
    Should Be Equal    ${sau}    ${trước}    Huỷ ghép máy cuối cùng làm đổi sổ tiền trên máy.
    ${device_sau}=    Đọc Bảng    deviceState    ${MÁY_A_PAGE}
    ${khoá_sau}=    Evaluate    [row['key'] for row in $device_sau]
    Should Not Contain    ${khoá_sau}    connection    Máy cuối cùng đã huỷ ghép vẫn còn khoá connection.

Nhóm lựa chọn tạo ở máy A tới máy B qua luồng danh mục, sổ chính không thêm event và đơn vẫn lên
    [Tags]    -regression
    [Documentation]    Nhóm lựa chọn đi oplog thứ hai (seq riêng) để máy bản cũ — đòi seq sổ chính liền nhau và kẹt khi
    ...    gặp bảng lạ — không bao giờ thấy nó. Bằng chứng: tạo nhóm thì `catalogLastSeq` của cả hai máy tiến còn
    ...    `lastSeq` sổ chính đứng yên; gắn nhóm vào món thì chỉ event món lên sổ chính. Chưa có màn cài nhóm, nên ca
    ...    gọi đúng hàm repository của app đang chạy (cùng module Vite) thay vì bấm nút; khung chạy app 2.19.0 thật
    ...    chưa có nên phần "máy cũ không kẹt" được chứng bằng sổ chính không đổi, không bằng máy cũ thật.
    ...    Đơn bán trên B vẫn lên A (đối chiếu bằng `Đọc Bảng`), và màn Đối soát của B đếm dòng "Nhóm lựa chọn".
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    40x    500ms    Hai Máy Phải Cùng lastSeq
    ${seq_trước}=    Con Trỏ Đồng Bộ Máy    ${MÁY_A_PAGE}    lastSeq

    Chọn Máy A
    ${gid}=    Tạo Nhóm Lựa Chọn Trên Máy Hiện Tại    Mức đường
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Hai Bảng Phải Hội Tụ    optionGroups
    FOR    ${page}    IN    ${MÁY_A_PAGE}    ${MÁY_B_PAGE}
        Wait Until Keyword Succeeds    40x    500ms    Con Trỏ Máy Phải Là    ${page}    catalogLastSeq    1
        Con Trỏ Máy Phải Là    ${page}    lastSeq    ${seq_trước}
    END
    ${nhóm_b}=    Đọc Bảng    optionGroups    ${MÁY_B_PAGE}
    Should Be Equal    ${nhóm_b}[0][gid]    ${gid}
    Should Be Equal    ${nhóm_b}[0][name]    Mức đường

    Chọn Máy A
    Gắn Nhóm Lựa Chọn Vào Món Trên Máy Hiện Tại    Trà đá    ${gid}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Hai Bảng Phải Hội Tụ    items
    ${seq_sau_gắn}=    Evaluate    ${seq_trước} + 1
    Wait Until Keyword Succeeds    40x    500ms    Con Trỏ Máy Phải Là    ${MÁY_B_PAGE}    lastSeq    ${seq_sau_gắn}
    Con Trỏ Máy Phải Là    ${MÁY_B_PAGE}    catalogLastSeq    1
    ${món_b}=    Đọc Bảng    items    ${MÁY_B_PAGE}
    ${trà_đá}=    Evaluate    [row for row in $món_b if row['name'] == 'Trà đá'][0]
    Should Be Equal    ${trà_đá}[optionGroupGids]    ${{ [$gid] }}

    Chọn Máy B
    Bán Nhanh    Phở bò
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Hai Bảng Phải Hội Tụ    orders
    Hai Bảng Phải Hội Tụ    payments

    Mở Màn Trên Máy    ${MÁY_B_PAGE}    /them/doi-soat
    Wait For Elements State    xpath=//span[normalize-space()="Nhóm lựa chọn"]/following-sibling::span[normalize-space()="1"]    visible

Nhóm lựa chọn và món topping cài ở máy A tới máy B giống từng gid, Worker chiếu thực đơn kiểu cũ cho máy bản cũ
    [Tags]    -regression
    [Documentation]    Món topping (sổ chính) và nhóm lựa chọn (luồng danh mục) cài trên A phải tới B giống hệt nhau từng gid,
    ...    nhóm Đồ uống gắn đúng hai nhóm, và trường thực đơn kiểu cũ trên nhóm món là phép chiếu Worker dựng cho máy
    ...    bản 2.19.0 (máy bản mới không tự ghi trường đó). Đường di trú menu cũ do máy 2.19.0 tạo nằm ở ca máy cũ riêng.
    Chọn Máy A
    Cài Thực Đơn Đồ Uống
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    80x    500ms    Bảng Máy Phải Có Số Dòng    optionGroups    2    ${MÁY_B_PAGE}
    Hai Bảng Phải Hội Tụ    optionGroups
    Hai Bảng Phải Hội Tụ    items
    Hai Bảng Phải Hội Tụ    itemGroups

    FOR    ${page}    IN    ${MÁY_A_PAGE}    ${MÁY_B_PAGE}
        ${món}=    Đọc Bảng    items    ${page}
        ${topping}=    Evaluate    sorted((m['name'], m['unitPrice'], m['isActive']) for m in $món if m.get('kind') == 'topping')
        Should Be Equal    ${topping}    ${{ [('Thạch', 3000, 0), ('Trân châu', 5000, 0)] }}
        ...    Mỗi topping phải là đúng một món chỉ bán kèm trên cả hai máy.
        ${nhóm_lc}=    Đọc Bảng    optionGroups    ${page}
        ${loại}=    Evaluate    sorted((g['kind'], g['name']) for g in $nhóm_lc)
        Should Be Equal    ${loại}    ${{ [('choice', 'Đường'), ('topping', 'Topping Đồ uống')] }}
        ${nhóm}=    Đọc Bảng    itemGroups    ${page}
        ${đồ_uống}=    Evaluate    [g for g in $nhóm if g['name'] == 'Đồ uống'][0]
        Should Be Equal    ${{ sorted($đồ_uống['optionGroupGids']) }}    ${{ sorted(g['gid'] for g in $nhóm_lc) }}
        ...    Nhóm Đồ uống chưa gắn đúng hai nhóm lựa chọn.
        Length Should Be    ${đồ_uống}[toppingMenu]    2    Worker chưa chiếu thực đơn kiểu cũ — máy bản cũ sẽ không có menu.
    END

    # Đơn vẫn bán và lên sổ chung như thường.
    Chọn Máy B
    Bán Nhanh    Phở bò
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Hai Bảng Phải Hội Tụ    orders

Máy bản 2.19.0 bán topping từ menu Worker chiếu ra, thêm topping được và bán theo giá máy mới vừa đổi
    [Documentation]    Tương thích ngược hai chiều, kiểm bằng bản 2.19.0 thật: máy cũ chỉ đọc thực đơn kiểu cũ trên nhóm
    ...    món, nên Worker phải chiếu nó từ nhóm lựa chọn; máy cũ sửa thực đơn thì Worker dịch sang mô hình mới. Đơn
    ...    của máy cũ phải lên sổ chung với đúng giá topping lúc bán — đối chiếu bằng IndexedDB của máy A.
    Chọn Máy A
    Cài Thực Đơn Đồ Uống
    Wait Until Keyword Succeeds    80x    500ms    Bảng Máy Phải Có Số Dòng    optionGroups    2    ${MÁY_A_PAGE}
    Ghép Máy Cũ
    Menu Topping Trên Máy Phải Là    ${MÁY_CŨ_PAGE}    Đồ uống    ${{ [('Trân châu', 5000), ('Thạch', 3000)] }}

    # Topping chỉ bán kèm (`isActive` 0) không lên lưới bán của máy cũ.
    Mở Màn Máy Cũ    /
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Cà phê sữa")    visible
    Get Element Count    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Trân châu")    ==    0

    Máy Cũ Bán Cà Phê Sữa Kèm Topping    Trân châu
    Máy Cũ Không Bị Từ Chối Event Nào
    Wait Until Keyword Succeeds    80x    500ms    Dòng Topping Trên Máy A Phải Có    Trân châu    5000    25000

    # Máy cũ thêm "Pudding" trong sheet của nó: máy mới thấy một món topping chỉ bán kèm nằm trong nhóm topping.
    Máy Cũ Thêm Topping Vào Nhóm Đồ Uống    Pudding    7000
    Máy Cũ Không Bị Từ Chối Event Nào
    Wait Until Keyword Succeeds    80x    500ms    Menu Topping Trên Máy Phải Là    ${MÁY_A_PAGE}    Đồ uống
    ...    ${{ [('Trân châu', 5000), ('Thạch', 3000), ('Pudding', 7000)] }}
    ${món}=    Đọc Bảng    items    ${MÁY_A_PAGE}
    ${pudding}=    Evaluate    [(m['kind'], m['isActive'], m['unitPrice']) for m in $món if m['name'] == 'Pudding']
    Should Be Equal    ${pudding}    ${{ [('topping', 0, 7000)] }}    Pudding phải thành đúng một món topping chỉ bán kèm.
    ${pudding_gid}=    Evaluate    [m['gid'] for m in $món if m['name'] == 'Pudding'][0]
    ${nhóm_lc}=    Đọc Bảng    optionGroups    ${MÁY_A_PAGE}
    ${trong_nhóm}=    Evaluate    [(g['name'], t['price']) for g in $nhóm_lc if g['kind'] == 'topping' for t in g['toppings'] if t['itemGid'] == $pudding_gid]
    Should Be Equal    ${trong_nhóm}    ${{ [('Topping Đồ uống', None)] }}

    # Máy mới đổi giá món topping Trân châu: máy cũ nhận menu mới và bán đúng giá mới.
    Chọn Máy A
    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Trân châu")
    Điền Ô    Giá bán *    6000
    Bấm Nút    LƯU MẶT HÀNG
    Wait For Condition    Url    ==    ${BASE_URL}/them/mat-hang
    Wait Until Keyword Succeeds    80x    500ms    Menu Topping Trên Máy Phải Là    ${MÁY_CŨ_PAGE}    Đồ uống
    ...    ${{ [('Trân châu', 6000), ('Thạch', 3000), ('Pudding', 7000)] }}
    Máy Cũ Bán Cà Phê Sữa Kèm Topping    Trân châu
    Máy Cũ Không Bị Từ Chối Event Nào
    Wait Until Keyword Succeeds    80x    500ms    Dòng Topping Trên Máy A Phải Có    Trân châu    6000    26000

Máy bản 2.19.0 mất mạng tạo món trùng tên topping chỉ bán kèm thì topping thành bán riêng, không sinh món trùng
    [Documentation]    Bản 2.19.0 tự chặn tên trùng với món nó đã có, nên món trùng chỉ lên tới Worker khi máy cũ chưa kéo
    ...    về món topping: máy cũ mất mạng, máy mới cài menu (tạo "Trân châu" chỉ bán kèm ở form món), máy cũ tạo
    ...    "Trân châu" rồi có mạng lại. Luật máy cũ ở Worker: bật topping đó thành bán riêng rồi trả `item-name-taken`, bản
    ...    cũ nối món vừa tạo vào topping sẵn có. Kiểm bằng bản 2.19.0 thật: hàng đợi máy cũ rỗng và câu báo đang hiện là
    ...    lời nối món của chính lượt này, không phải câu báo từ chối; sổ có đúng một
    ...    "Trân châu" là món topping đang bán, cả hai máy thấy nó trên lưới, và đơn máy cũ bán nó lên sổ thành một dòng
    ...    trỏ đúng món topping — đối chiếu IndexedDB máy A.
    Ghép Máy Cũ
    Mở Màn Máy Cũ    /them/mat-hang/moi
    Set Offline    ${True}

    Chọn Máy A
    Cài Thực Đơn Đồ Uống
    Wait Until Keyword Succeeds    80x    500ms    Bảng Máy Phải Có Số Dòng    optionGroups    2    ${MÁY_A_PAGE}

    Chọn Máy Cũ
    Điền Ô    Tên mặt hàng *    Trân châu
    Điền Ô    Giá bán *    8000
    Bấm Nút    LƯU MẶT HÀNG
    Wait For Condition    Url    ==    ${MÁY_CŨ_URL}/them/mat-hang
    Set Offline    ${False}
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_CŨ_PAGE}
    Wait Until Keyword Succeeds    80x    500ms    Trân Châu Phải Là Một Món Topping Đang Bán    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    80x    500ms    Trân Châu Phải Là Một Món Đang Bán Trên Máy Cũ

    Mở Màn Máy Cũ    /
    Chọn Món    Trân châu
    Máy Cũ Chốt Đơn
    # Bản cũ giữ một câu báo (ghi đè); câu đang hiện phải là lời nối món khi nhận `item-name-taken`, không phải từ chối.
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_CŨ_PAGE}
    ${state}=    Đọc Bảng    deviceState    ${MÁY_CŨ_PAGE}
    ${báo}=    Evaluate    [row.get('message') for row in $state if row.get('key') == 'notice']
    Should Contain    ${báo}[0]    Máy này đã nối sang món có sẵn; giá bán hiện tại của món là 5.000 đ.
    ${món_a}=    Đọc Bảng    items    ${MÁY_A_PAGE}
    ${id_a}=    Evaluate    next(m['id'] for m in $món_a if m['name'] == 'Trân châu')
    Wait Until Keyword Succeeds    80x    500ms    Dòng Trân Châu Bán Riêng Trên Máy A Phải Trỏ Món    ${id_a}

    Chọn Máy A
    Mở Màn    /
    Wait For Elements State    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Trân châu")    visible

Máy bản 2.19.0 xoá topping đang dùng hay sửa menu quá giới hạn thì không bị từ chối, máy mới thấy cảnh báo
    [Documentation]    Sổ chung không được từ chối event của máy cũ: bản cũ cuộn ngược cả các đơn làm sau event bị từ
    ...    chối. Xoá món đang là topping thành ghi lại bản đang lưu (món quay về máy cũ); tên topping dài quá giới hạn
    ...    của bản mới thì không dịch, để lại cảnh báo ở màn Máy của bản mới. Đơn bán sau đó vẫn lên sổ.
    Chọn Máy A
    Cài Thực Đơn Đồ Uống
    Wait Until Keyword Succeeds    80x    500ms    Bảng Máy Phải Có Số Dòng    optionGroups    2    ${MÁY_A_PAGE}
    Ghép Máy Cũ

    Mở Màn Máy Cũ    /them/mat-hang
    Click    css=button:has-text("Thạch")
    Bấm Nút    Xoá hẳn
    Xác Nhận Trong Hộp    Xoá
    Máy Cũ Không Bị Từ Chối Event Nào
    Wait Until Keyword Succeeds    80x    500ms    Món Phải Có Trên Máy    Thạch    ${MÁY_CŨ_PAGE}
    Món Phải Có Trên Máy    Thạch    ${MÁY_A_PAGE}

    Máy Cũ Thêm Topping Vào Nhóm Đồ Uống    Trân châu hoàng kim nướng than hoa loại đặc biệt    9000
    Máy Cũ Không Bị Từ Chối Event Nào
    Chọn Máy A
    Mở Màn    /ghep-may
    Chờ Thấy Chữ    MENU SỬA TRÊN MÁY BẢN CŨ
    Chờ Thấy Chữ    dài quá 40 ký tự
    Chờ Thấy Chữ    Quầy cũ ·

    Máy Cũ Bán Cà Phê Sữa Kèm Topping    Thạch
    Máy Cũ Không Bị Từ Chối Event Nào
    Wait Until Keyword Succeeds    80x    500ms    Dòng Topping Trên Máy A Phải Có    Thạch    3000    23000

Menu cũ do máy 2.19.0 cài trước khi có máy bản mới được di trú khi máy bản mới đầu tiên ghép vào
    [Documentation]    Đường di trú lười với dữ liệu do bản cũ thật ghi: sổ chưa từng thấy máy `catalog-v2`, máy bản mới
    ...    đầu tiên ghép vào thì Worker di trú cả sổ một lần — mỗi topping thành đúng một món chỉ bán kèm, nhóm món gắn
    ...    nhóm lựa chọn — còn máy cũ vẫn giữ nguyên thực đơn kiểu cũ và không bị từ chối event nào.
    [Setup]    Mở Quán Bằng Máy Cũ
    Máy Cũ Tạo Nhóm Đồ Uống Có Thực Đơn
    Máy Cũ Không Bị Từ Chối Event Nào
    Ghép Máy Mới Vào Quán Của Máy Cũ

    Wait Until Keyword Succeeds    80x    500ms    Bảng Máy Phải Có Số Dòng    optionGroups    2    ${MÁY_A_PAGE}
    ${món}=    Đọc Bảng    items    ${MÁY_A_PAGE}
    ${topping}=    Evaluate    sorted((m['name'], m['unitPrice'], m['isActive']) for m in $món if m.get('kind') == 'topping')
    Should Be Equal    ${topping}    ${{ [('Thạch', 3000, 0), ('Trân châu', 5000, 0)] }}
    ...    Mỗi topping trong menu cũ phải thành đúng một món chỉ bán kèm.
    ${nhóm_lc}=    Đọc Bảng    optionGroups    ${MÁY_A_PAGE}
    ${đồ_uống}=    Nhóm Món Trên Máy    ${MÁY_A_PAGE}    Đồ uống
    Should Be Equal    ${{ sorted($đồ_uống['optionGroupGids']) }}    ${{ sorted(g['gid'] for g in $nhóm_lc) }}

    Wait Until Keyword Succeeds    80x    500ms    Món Phải Có Trên Máy    Trân châu    ${MÁY_CŨ_PAGE}
    Menu Topping Trên Máy Phải Là    ${MÁY_CŨ_PAGE}    Đồ uống    ${{ [('Trân châu', 5000), ('Thạch', 3000)] }}
    ${nhóm_c}=    Nhóm Món Trên Máy    ${MÁY_CŨ_PAGE}    Đồ uống
    Should Be Equal    ${nhóm_c}[optionGroups]    ${{ [{'name': 'Đường', 'choices': ['Ít đường', 'Không đường']}] }}
    Mở Màn Máy Cũ    /
    Get Element Count    ${LƯỚI_MẶT_HÀNG} >> css=button:has-text("Trân châu")    ==    0
    Máy Cũ Không Bị Từ Chối Event Nào

Máy bản 2.19.0 sửa giá món đã ghim thì máy mới vẫn thấy ghim và món vẫn ở ô đầu
    [Documentation]    Bản 2.19.0 không biết `pinned`: nó bỏ khoá khi đọc rồi đẩy lên cả hàng thiếu khoá. Worker phải
    ...    giữ ghim đã lưu (thiếu khoá là "không biết", không phải bỏ ghim). Kiểm bằng bản cũ thật, đối chiếu IndexedDB
    ...    hai máy mới: giá mới tới nơi mà `pinned` vẫn là 1.
    Chọn Máy A
    ${món}=    Đọc Bảng    items    ${MÁY_A_PAGE}
    ${trà}=    Evaluate    next(m for m in $món if m['name'] == 'Trà đá')
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /them/mat-hang/${trà}[id]
    Bấm Nút    Ghim lên đầu màn bán
    Bấm Nút    LƯU MẶT HÀNG
    Wait For Condition    Url    ==    ${BASE_URL}/them/mat-hang
    Ghép Máy Cũ

    Mở Màn Máy Cũ    /them/mat-hang
    Click    css=button:has-text("Trà đá")
    Điền Ô    Giá bán *    7000
    Bấm Nút    LƯU MẶT HÀNG
    Wait For Condition    Url    ==    ${MÁY_CŨ_URL}/them/mat-hang
    Máy Cũ Không Bị Từ Chối Event Nào

    Wait Until Keyword Succeeds    80x    500ms    Giá Mặt Hàng Phải Là    Trà đá    7000    ${MÁY_A_PAGE}
    Món Phải Có Ghim    ${trà}[gid]    1    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    80x    500ms    Giá Mặt Hàng Phải Là    Trà đá    7000    ${MÁY_B_PAGE}
    Món Phải Có Ghim    ${trà}[gid]    1    ${MÁY_B_PAGE}
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /
    Ô Đầu Lưới Bán Phải Là    Trà đá

*** Keywords ***
Trân Châu Phải Là Một Món Topping Đang Bán
    [Arguments]    ${page}
    ${món}=    Đọc Bảng    items    ${page}
    ${khớp}=    Evaluate    [(m.get('kind'), m['isActive'], m['unitPrice']) for m in $món if m['name'] == 'Trân châu']
    Should Be Equal    ${khớp}    ${{ [('topping', 1, 5000)] }}    Sổ phải có đúng một Trân châu là món topping đang bán.

Trân Châu Phải Là Một Món Đang Bán Trên Máy Cũ
    ${món}=    Đọc Bảng    items    ${MÁY_CŨ_PAGE}
    ${khớp}=    Evaluate    [m['isActive'] for m in $món if m['name'] == 'Trân châu']
    Should Be Equal    ${khớp}    ${{ [1] }}    Máy cũ phải có đúng một Trân châu đang bán.

Dòng Trân Châu Bán Riêng Trên Máy A Phải Trỏ Món
    [Arguments]    ${item_id}
    ${dòng}=    Đọc Bảng    orderLines    ${MÁY_A_PAGE}
    ${khớp}=    Evaluate    [(d['itemId'], d['unitPrice'], d['qty'], d['amount'], d['toppings']) for d in $dòng if d['name'] == 'Trân châu']
    Should Be Equal    ${khớp}    ${{ [(${item_id}, 5000, 1, 5000, [])] }}    Đơn máy cũ bán Trân châu chưa lên sổ đúng món topping.

Dòng Topping Trên Máy A Phải Có
    [Documentation]    Đơn máy cũ bán đã lên sổ chung và về máy A: một dòng cà phê sữa kèm đúng một phần topping với
    ...    giá lúc bán và thành tiền đúng. Đọc IndexedDB của máy A, không tin con số trên màn máy cũ.
    [Arguments]    ${topping}    ${giá}    ${thành_tiền}
    ${dòng}=    Đọc Bảng    orderLines    ${MÁY_A_PAGE}
    ${khớp}=    Evaluate
    ...    [d for d in $dòng if d['name'] == 'Cà phê sữa' and [(t['name'], t['unitPrice'], t['qty']) for t in d.get('toppings', [])] == [($topping, int($giá), 1)]]
    Length Should Be    ${khớp}    1    Máy A chưa có dòng cà phê sữa kèm ${topping} giá ${giá}.
    Should Be Equal As Integers    ${khớp}[0][amount]    ${thành_tiền}

Ba Bảng Đơn Phải Cùng Gid Và Nội Dung
    Hai Bảng Phải Cùng Gid Và Nội Dung    orders
    Hai Bảng Phải Cùng Gid Và Nội Dung    orderLines
    Hai Bảng Phải Cùng Gid Và Nội Dung    payments

Mở Sheet Thu Nợ Hai Máy
    [Arguments]    ${tên}
    Mở Màn    /cong-no
    Click    css=button:has-text("${tên}")
    Wait For Elements State    css=[role=dialog][aria-label="Thu nợ · ${tên}"]    visible

Bấm Nút Thu Hai Máy
    Click    css=[role=dialog][aria-label^="Thu nợ"] >> css=button:has-text("THU ")
    Wait For Elements State    css=[role=dialog][aria-label^="Thu nợ"]    detached

Gỡ Mang Về Như Máy Bản Cũ
    [Documentation]    Làm hàng đơn và các event đơn còn chờ trong outbox của trang hiện tại giống hệt thứ máy
    ...    2.19.0 có: không có khoá `serviceMode`. Ghi thẳng IndexedDB nên không sinh event mới. Trả về số event
    ...    đã sửa.
    [Arguments]    ${gid}
    ${số}=    Evaluate JavaScript    ${None}
    ...    async (gid) => {
    ...        const db = await new Promise((resolve, reject) => {
    ...            const request = indexedDB.open('my-biller')
    ...            request.onsuccess = () => resolve(request.result)
    ...            request.onerror = () => reject(request.error)
    ...        })
    ...        let edited = 0
    ...        await new Promise((resolve, reject) => {
    ...            const tx = db.transaction(['outbox', 'orders'], 'readwrite')
    ...            const outbox = tx.objectStore('outbox')
    ...            outbox.getAll().onsuccess = (event) => {
    ...                for (const row of event.target.result) {
    ...                    if (row.table !== 'orders' || row.entityGid !== gid) continue
    ...                    if (row.after) delete row.after.serviceMode
    ...                    if (row.before) delete row.before.serviceMode
    ...                    outbox.put(row)
    ...                    edited++
    ...                }
    ...            }
    ...            const orders = tx.objectStore('orders')
    ...            orders.getAll().onsuccess = (event) => {
    ...                const row = event.target.result.find((order) => order.gid === gid)
    ...                if (!row) return reject(new Error('Không thấy đơn ' + gid))
    ...                delete row.serviceMode
    ...                orders.put(row)
    ...            }
    ...            tx.oncomplete = () => resolve()
    ...            tx.onerror = () => reject(tx.error)
    ...            tx.onabort = () => reject(tx.error)
    ...        })
    ...        db.close()
    ...        return edited
    ...    }
    ...    arg=${gid}
    RETURN    ${số}

Đơn Theo Gid Phải Có Trạng Thái
    [Arguments]    ${gid}    ${trạng_thái}    ${page}
    ${orders}=    Đọc Bảng    orders    ${page}
    ${found}=    Evaluate    [row for row in $orders if row['gid'] == $gid]
    Length Should Be    ${found}    1
    Should Be Equal    ${found}[0][status]    ${trạng_thái}

Phiếu Của Đơn Phải Chưa Phân Bổ
    [Documentation]    Chờ ĐỦ HAI bảng, không chỉ `payments`. Nhãn "Khoản thu chờ xử lý" trên màn chi
    ...    tiết đơn cần cả `order.status == 'void'` (`order-detail-page.tsx:58` → `voidedRetailOrder`),
    ...    nên chờ mỗi `allocatedOrderId == 0` là chờ hụt: máy nhận xong `payments` mà `orders` chưa về
    ...    thì keyword này đã xanh, trang render "Đã trả", và bước `Chờ Thấy Chữ` sau đó đếm ngược 15
    ...    giây trong lúc `orders` còn đang trên đường. Đúng cách ca "Thiết bị cũ không ghi đè khoản
    ...    thu đã hoàn" đỏ trên CI và trên staging — chỉ đỏ khi chạy cả bộ, chạy riêng thì không.
    [Arguments]    ${order_gid}    ${page}
    ${orders}=    Đọc Bảng    orders    ${page}
    ${order}=    Evaluate    [row for row in $orders if row['gid'] == $order_gid][0]
    Should Be Equal    ${order}[status]    void    Đơn chưa về trạng thái huỷ trên máy này.
    ${payments}=    Đọc Bảng    payments    ${page}
    ${found}=    Evaluate    [row for row in $payments if row['orderId'] == $order['id']]
    Length Should Be    ${found}    1    Phiếu thu của đơn đã biến mất.
    Should Be Equal As Integers    ${found}[0][allocatedOrderId]    0

Phiếu Của Đơn Phải Có Trạng Thái
    [Arguments]    ${order_gid}    ${trạng_thái}    ${page}
    ${orders}=    Đọc Bảng    orders    ${page}
    ${order}=    Evaluate    [row for row in $orders if row['gid'] == $order_gid][0]
    ${payments}=    Đọc Bảng    payments    ${page}
    ${found}=    Evaluate    [row for row in $payments if row['orderId'] == $order['id']]
    Length Should Be    ${found}    1    Phiếu thu của đơn đã biến mất.
    Should Be Equal As Integers    ${found}[0][allocatedOrderId]    0
    Should Be Equal    ${found}[0][unallocatedStatus]    ${trạng_thái}

Hai Máy Phải Cùng lastSeq
    [Documentation]    Tiền điều kiện của ca Đối soát: cả hai máy đã kéo hết sổ chung. `Đọc Bảng` che
    ...    token và deviceId của deviceState, `lastSeq` còn nguyên.
    ${a}=    Đọc Bảng    deviceState    ${MÁY_A_PAGE}
    ${b}=    Đọc Bảng    deviceState    ${MÁY_B_PAGE}
    ${seq_a}=    Evaluate    [row for row in $a if row['key'] == 'sync'][0]['lastSeq']
    ${seq_b}=    Evaluate    [row for row in $b if row['key'] == 'sync'][0]['lastSeq']
    Should Be Equal As Integers    ${seq_a}    ${seq_b}    Hai máy chưa cùng lastSeq (A=${seq_a}, B=${seq_b}).

Đọc Bốn Tổng Đối Soát
    [Documentation]    Bốn tổng toàn sổ trên page đang đứng, dạng dict để so hai máy. Khối tổng chỉ
    ...    render sau khi truy vấn 9 bảng xong nên chờ tiêu đề khối trước.
    Chờ Thấy Chữ    TỔNG TOÀN SỔ
    ${doanh_thu}=    Đọc Ô Số    DOANH THU
    ${đã_thu}=    Đọc Ô Số    ĐÃ THU
    ${chi_phí}=    Đọc Ô Số    CHI PHÍ
    ${còn_nợ}=    Đọc Ô Số    CÒN NỢ
    ${tổng}=    Create Dictionary    doanh_thu=${doanh_thu}    đã_thu=${đã_thu}    chi_phí=${chi_phí}    còn_nợ=${còn_nợ}
    RETURN    ${tổng}

Bấm Kiểm Tra Lại Rồi Phải Khớp
    [Documentation]    Nhánh lỗi không tự hỏi lại sổ chung; nút là đường ra. Nếu Vite dev vừa tải lại
    ...    trang khi nối mạng lại thì lượt mount mới đã hỏi rồi và neo đã khớp — khi đó không bấm.
    ${neo}=    Get Text    ${NEO_ĐỒNG_BỘ}
    IF    not $neo.startswith('✓ Khớp sổ chung')
        Click    css=button:has-text("Kiểm tra lại")
        Wait For Elements State    ${NEO_ĐỒNG_BỘ}:has-text("✓ Khớp sổ chung")    visible    timeout=5s
    END

Logo Máy B Phải Giống
    [Arguments]    ${ở_a}
    ${ở_b}=    Đọc Logo Quán    ${MÁY_B_PAGE}
    Should Be Equal    ${ở_b}    ${ở_a}    Máy B chưa nhận logo/cấu hình hình chìm của máy A.

Logo Máy B Phải Hội Tụ Với
    [Documentation]    `Cài Logo Quán` đi bằng `Go To`, tức tải lại trang: tab mới phải chờ lease 15 giây của tab cũ hết
    ...    hạn mới được đẩy — cùng ngân sách 40 × 500ms như các ca khác mở màn bằng URL. Hụt thì báo kèm hàng đợi và
    ...    thông báo đồng bộ của máy A để phân biệt chậm với kẹt.
    [Arguments]    ${ở_a}
    ${hội_tụ}=    Run Keyword And Return Status
    ...    Wait Until Keyword Succeeds    40x    500ms    Logo Máy B Phải Giống    ${ở_a}
    IF    not ${hội_tụ}
        ${pending}=    Đọc Bảng    outbox    ${MÁY_A_PAGE}
        ${state}=    Đọc Bảng    deviceState    ${MÁY_A_PAGE}
        ${notice}=    Evaluate    [row.get('message') for row in $state if row.get('key') == 'notice']
        ${bảng}=    Evaluate    [(row['table'], row['status']) for row in $pending]
        ${ở_b}=    Đọc Logo Quán    ${MÁY_B_PAGE}
        Fail    Máy B chưa nhận logo: B=${ở_b}, outbox A=${bảng}, notice A=${notice}
    END

Bán Nhanh Khi Đang Ngoại Tuyến
    [Documentation]    `Bán Nhanh` mở lại màn Bán bằng URL nên không chạy được khi máy đang offline. Keyword này
    ...    đi bằng tab "Bán" ở thanh đáy rồi bán như `Bán Nhanh`. Sau khi chốt, phiếu nằm ngoài thanh đáy nên
    ...    keyword lùi về màn Bán (giỏ đã trống) bằng điều hướng trong app (không tải lại trang) để lượt bán kế
    ...    tiếp còn tab "Bán" để bấm.
    [Arguments]    ${tên_món}
    Click    css=nav a:text-is("Bán")
    Chọn Món    ${tên_món}
    Mở Sheet Thu Tiền
    Chốt Đơn
    Go Back

Dòng Đơn Hai Máy Phải Cùng Món
    [Documentation]    `itemId` là khoá cục bộ của từng máy nên không so thẳng được. Quy về gid của món và của
    ...    dòng rồi so, để đo đúng việc mọi dòng đơn trỏ tới cùng một món trên cả hai máy.
    ${món_a}=    Đọc Bảng    items    ${MÁY_A_PAGE}
    ${món_b}=    Đọc Bảng    items    ${MÁY_B_PAGE}
    ${id_sang_gid_a}=    Evaluate    {m['id']: m['gid'] for m in $món_a}
    ${id_sang_gid_b}=    Evaluate    {m['id']: m['gid'] for m in $món_b}
    ${dòng_a}=    Đọc Bảng    orderLines    ${MÁY_A_PAGE}
    ${dòng_b}=    Đọc Bảng    orderLines    ${MÁY_B_PAGE}
    ${đích_a}=    Create List
    FOR    ${dòng}    IN    @{dòng_a}
        ${gid_món}=    Get From Dictionary    ${id_sang_gid_a}    ${dòng}[itemId]
        Append To List    ${đích_a}    ${dòng}[gid]|${gid_món}|${dòng}[qty]|${dòng}[unitPrice]
    END
    ${đích_b}=    Create List
    FOR    ${dòng}    IN    @{dòng_b}
        ${gid_món}=    Get From Dictionary    ${id_sang_gid_b}    ${dòng}[itemId]
        Append To List    ${đích_b}    ${dòng}[gid]|${gid_món}|${dòng}[qty]|${dòng}[unitPrice]
    END
    Sort List    ${đích_a}
    Sort List    ${đích_b}
    Should Be Equal    ${đích_a}    ${đích_b}    Dòng đơn hai máy chưa cùng trỏ tới một món.

Thu Của Hai Máy Phải Cùng Đơn
    [Documentation]    `orderId` là khoá cục bộ. Quy về gid của đơn rồi so, để mọi phiếu thu trên cả hai máy cùng
    ...    trỏ tới một đơn. Chỉ dùng cho ca mà mọi phiếu thu đều gắn với một đơn.
    ${đơn_a}=    Đọc Bảng    orders    ${MÁY_A_PAGE}
    ${đơn_b}=    Đọc Bảng    orders    ${MÁY_B_PAGE}
    ${id_sang_gid_a}=    Evaluate    {o['id']: o['gid'] for o in $đơn_a}
    ${id_sang_gid_b}=    Evaluate    {o['id']: o['gid'] for o in $đơn_b}
    ${thu_a}=    Đọc Bảng    payments    ${MÁY_A_PAGE}
    ${thu_b}=    Đọc Bảng    payments    ${MÁY_B_PAGE}
    ${đích_a}=    Create List
    FOR    ${thu}    IN    @{thu_a}
        ${gid_đơn}=    Get From Dictionary    ${id_sang_gid_a}    ${thu}[orderId]
        Append To List    ${đích_a}    ${thu}[gid]|${gid_đơn}|${thu}[amount]|${thu}[method]
    END
    ${đích_b}=    Create List
    FOR    ${thu}    IN    @{thu_b}
        ${gid_đơn}=    Get From Dictionary    ${id_sang_gid_b}    ${thu}[orderId]
        Append To List    ${đích_b}    ${thu}[gid]|${gid_đơn}|${thu}[amount]|${thu}[method]
    END
    Sort List    ${đích_a}
    Sort List    ${đích_b}
    Should Be Equal    ${đích_a}    ${đích_b}    Phiếu thu hai máy chưa cùng trỏ tới một đơn.

Mã Sổ Rút Gọn Trên Máy
    [Documentation]    Bốn ký tự đầu, dấu `…` và ba ký tự cuối của `shopId` trong dòng `connection` của máy.
    [Arguments]    ${page}
    ${rows}=    Đọc Bảng    deviceState    ${page}
    ${connection}=    Evaluate    [row for row in $rows if row['key'] == 'connection']
    Length Should Be    ${connection}    1    Máy chưa có dòng connection.
    ${shop_id}=    Set Variable    ${connection}[0][shopId]
    ${rút_gọn}=    Evaluate    $shop_id[:4] + '…' + $shop_id[-3:]
    RETURN    ${rút_gọn}

Con Trỏ Đồng Bộ Máy
    [Documentation]    `lastSeq` (sổ chính) hoặc `catalogLastSeq` (luồng danh mục) của hàng `sync`; thiếu khoá đọc là 0.
    [Arguments]    ${page}    ${khoá}
    ${state}=    Đọc Bảng    deviceState    ${page}
    ${giá_trị}=    Evaluate    [row for row in $state if row['key'] == 'sync'][0].get($khoá, 0)
    RETURN    ${giá_trị}

Con Trỏ Máy Phải Là
    [Arguments]    ${page}    ${khoá}    ${mong_đợi}
    ${giá_trị}=    Con Trỏ Đồng Bộ Máy    ${page}    ${khoá}
    Should Be Equal As Integers    ${giá_trị}    ${mong_đợi}    ${khoá} của máy là ${giá_trị}, mong đợi ${mong_đợi}.

Tạo Nhóm Lựa Chọn Trên Máy Hiện Tại
    [Documentation]    Gọi `createOptionGroup` của chính app đang chạy (Vite dev phục vụ cùng một module), nên đi
    ...    đúng `syncTransaction` và outbox như màn cài nhóm sẽ đi. Trả về gid của nhóm.
    [Arguments]    ${tên}
    ${gid}=    Evaluate JavaScript    ${None}
    ...    async (name) => {
    ...        const { createOptionGroup } = await import('/src/db/repositories/option-groups.ts')
    ...        const { db } = await import('/src/db/db.ts')
    ...        const id = await createOptionGroup({ kind: 'choice', name, required: 0, maxSelect: 1,
    ...            defaultChoice: null, sortOrder: 1, isActive: 1, choices: ['Ít đường', 'Không đường'] })
    ...        return (await db.optionGroups.get(id)).gid
    ...    }
    ...    arg=${tên}
    RETURN    ${gid}

Gắn Nhóm Lựa Chọn Vào Món Trên Máy Hiện Tại
    [Arguments]    ${tên_món}    ${gid}
    Evaluate JavaScript    ${None}
    ...    async ({ name, gid }) => {
    ...        const { updateItem } = await import('/src/db/repositories/items.ts')
    ...        const { db } = await import('/src/db/db.ts')
    ...        const item = await db.items.where('name').equals(name).first()
    ...        await updateItem(item.id, { optionGroupGids: [gid] })
    ...    }
    ...    arg=${{ {'name': $tên_món, 'gid': $gid} }}
