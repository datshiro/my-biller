*** Settings ***
Documentation       Khu `/admin` chỉ đọc của người vận hành, chạy trên app thật và Worker local thật. Trạng thái
...                 Worker local tồn tại qua các lượt chạy (D1 có sổ và nhịp báo của lượt trước), nên mọi phép so
...                 chỉ đọc bên trong khối `data-shop-id` hoặc `data-install-id` của đúng sổ/máy ca vừa dựng.
...                 Mật khẩu xem chỉ nằm trong bộ nhớ trang: mở lại trang là phải đăng nhập lại.
Resource            ../resources/hai-may.resource
Library             OperatingSystem
Library             String
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Teardown       Đóng Hai Máy
Test Tags           shard-a

*** Variables ***
${Ô_MẬT_KHẨU_XEM}       xpath=//label[normalize-space()="Mật khẩu xem"]/following::input[1]
${NÚT_VÀO}              css=button:text-is("Vào")
${NÚT_THOÁT}            css=button:text-is("Thoát")
${NÚT_CÁC_SỔ}           css=button:text-is("Các sổ")
${NÚT_MÁY_CHƯA_GHÉP}    css=button:text-is("Máy chưa ghép")
${NÚT_ĐÃ_GHÉP_SAU}      css=button:text-is("Đã ghép sau đó")
${NEO_ĐỒNG_BỘ}          css=[role=status][aria-label="Neo đồng bộ"]
${KHOÁ_NHỊP_BÁO}        my-biller:heartbeat-at
@{NÚT_CHỈ_ĐỌC}          Vào    Thoát    Tải thêm    Đơn    Khách    Công nợ    Các sổ    Máy chưa ghép    Đã ghép sau đó

*** Test Cases ***
Admin chặn sai mật khẩu và chặn ADMIN_SECRET
    [Documentation]    Hai secret tách nhau: mật khẩu sai và cả secret tạo quán (ADMIN_SECRET) đều không mở được
    ...    khu xem. Lộ secret tạo quán không được kéo theo quyền đọc sổ của mọi quán.
    Cần Secret Xem Local
    New Context    viewport=${VIEWPORT}
    New Page    ${BASE_URL}/admin
    # Trình duyệt không được đề nghị lưu secret xem vào trình quản lý mật khẩu.
    Get Attribute    ${Ô_MẬT_KHẨU_XEM}    autocomplete    ==    off
    Fill Text    ${Ô_MẬT_KHẨU_XEM}    sai-mat-khau
    Click    ${NÚT_VÀO}
    Chờ Thấy Chữ    Sai mật khẩu
    Không Được Thấy Chữ    Các sổ

    # Mở lại trang để chữ "Sai mật khẩu" của lần trước không làm phép chờ dưới đây đạt sẵn.
    Mở Màn    /admin
    Wait For Elements State    ${Ô_MẬT_KHẨU_XEM}    visible
    Không Được Thấy Chữ    Sai mật khẩu
    Nhập Mật Khẩu Từ Biến Môi Trường    ROBOT_WORKER_ADMIN_SECRET
    Chờ Thấy Chữ    Sai mật khẩu
    Wait For Elements State    ${NÚT_THOÁT}    detached

Admin hiện sổ, máy và số tiền khớp Đối soát và IndexedDB
    [Documentation]    Số của một sổ trên admin (số đơn, còn nợ, doanh thu) phải bằng từng đồng với màn Đối soát của
    ...    máy A và với giá trị tính lại từ IndexedDB của A. Đọc trong khối `data-shop-id` của chính sổ này.
    Cần Secret Xem Local
    Mở Hai Máy Đã Ghép
    Chọn Máy A
    Bán Nợ Cho Khách    Trà đá    Anh Hùng
    Mở Màn    /
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Điền Tiền Khách Đưa    20000
    Chờ Thấy Chữ    Còn nợ lại
    Click    ${NÚT_CHỌN_KHÁCH_NỢ}
    Chọn Khách Trong Sheet    Anh Hùng
    Chốt Đơn
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    40x    500ms    Bản Sao Máy Phải Đuổi Kịp Sổ Chung    ${MÁY_A_PAGE}

    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /them/doi-soat
    Wait For Elements State    ${NEO_ĐỒNG_BỘ}:has-text("✓ Khớp sổ chung")    visible    timeout=25s
    ${đs_đơn}=    Get Text    xpath=//span[normalize-space()="Đơn (gồm đơn đã hủy)"]/following-sibling::span[1]
    ${đs_doanh_thu}=    Đọc Ô Số    DOANH THU
    ${đs_còn_nợ}=    Đọc Ô Số    CÒN NỢ
    ${sổ_máy}=    Tổng Tiền Tính Từ IndexedDB    ${MÁY_A_PAGE}
    ${shop_id}=    Mã Sổ Của Máy    ${MÁY_A_PAGE}
    ${rút_gọn}=    Rút Gọn Mã    ${shop_id}

    ${khối}=    Set Variable    css=[data-shop-id="${shop_id}"]
    # Admin mở ở context riêng: trang /admin không chạy đồng bộ, mở trên trang của A là A ngừng kéo và không bao giờ
    # báo hết tụt. Worker ghi tiến độ kéo tối đa một lần mỗi 60 giây mỗi máy, nên chờ quá 60 giây cộng một nhịp kéo.
    New Context    viewport=${VIEWPORT}
    New Page    ${BASE_URL}/admin
    Wait Until Keyword Succeeds    90s    2s    Sổ Trên Admin Đã Báo Máy A Hết Tụt    ${shop_id}
    Get Text    ${khối} >> css=a    ==    Sổ: ${rút_gọn}
    Get Text    ${khối}    *=    Máy A · Quầy A
    ${ad_đơn}=    Số Nguyên Trong    ${khối} >> css=[data-field="orderCount"]
    ${ad_còn_nợ_chữ}=    Get Text    ${khối} >> css=[data-field="debtTotal"]
    ${ad_doanh_thu_chữ}=    Get Text    ${khối} >> css=[data-field="revenue"]
    ${ad_còn_nợ}=    Số Nguyên Trong    ${khối} >> css=[data-field="debtTotal"]
    ${ad_doanh_thu}=    Số Nguyên Trong    ${khối} >> css=[data-field="revenue"]

    Should Be Equal    ${ad_còn_nợ_chữ}    ${đs_còn_nợ}    Còn nợ trên admin khác Đối soát.
    Should Be Equal    ${ad_doanh_thu_chữ}    ${đs_doanh_thu}    Doanh thu trên admin khác Đối soát.
    Should Be Equal As Integers    ${ad_đơn}    ${đs_đơn}    Số đơn trên admin khác Đối soát.
    Should Be Equal As Integers    ${ad_đơn}    ${sổ_máy}[orders]    Số đơn trên admin khác IndexedDB của A.
    Should Be Equal As Integers    ${ad_còn_nợ}    ${sổ_máy}[debt]    Còn nợ trên admin khác IndexedDB của A.
    Should Be Equal As Integers    ${ad_doanh_thu}    ${sổ_máy}[revenue]    Doanh thu trên admin khác IndexedDB của A.
    Should Be True    ${ad_còn_nợ} > 0    Ca phải có nợ thật để phép so có nghĩa.

Admin duyệt đơn, dòng đơn, khách và công nợ, không có nút ghi
    [Documentation]    Chi tiết một sổ cho xem đủ đơn kèm dòng đơn, khách và công nợ của đúng sổ đó, và trên trang
    ...    không có nút nào ngoài các nút đọc (không thu hồi, không sửa, không xoá).
    Cần Secret Xem Local
    Mở Hai Máy Đã Ghép
    Chọn Máy A
    Mở Màn    /them/khach-hang/moi
    Điền Ô    Tên khách hàng *    Chú Bảy Admin
    Bấm Nút    LƯU KHÁCH HÀNG
    Chờ Thấy Chữ    Chú Bảy Admin
    Mở Màn    /
    Chọn Món    Trà đá
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Chọn Hình Thức Trả    Bán nợ
    Click    ${NÚT_CHỌN_KHÁCH_NỢ}
    Chọn Khách Trong Sheet    Chú Bảy Admin
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    ${khách}=    Đọc Bảng    customers    ${MÁY_A_PAGE}
    ${khách_gid}=    Evaluate    next(row['gid'] for row in $khách if row['name'] == 'Chú Bảy Admin')
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    ${shop_id}=    Mã Sổ Của Máy    ${MÁY_A_PAGE}

    Mở Admin Trên Trang Đang Đứng    /admin/so/${shop_id}
    Wait For Elements State    css=[data-shop-id="${shop_id}"]    visible
    ${hàng_đơn}=    Set Variable    css=[data-entity-key="${đơn}[gid]"]
    Wait For Elements State    ${hàng_đơn}    visible
    Get Text    ${hàng_đơn}    *=    Trà đá
    Get Text    ${hàng_đơn}    *=    Phở bò
    Nút Trên Trang Chỉ Là Nút Đọc

    Click    css=button:text-is("Khách")
    Wait For Elements State    css=[data-entity-key="${khách_gid}"]    visible
    Get Text    css=[data-entity-key="${khách_gid}"]    *=    Chú Bảy Admin
    Nút Trên Trang Chỉ Là Nút Đọc

    Click    css=button:text-is("Công nợ")
    ${hàng_nợ}=    Set Variable    css=[data-customer-gid="${khách_gid}"]
    Wait For Elements State    ${hàng_nợ}    visible
    Get Text    ${hàng_nợ}    *=    Chú Bảy Admin
    ${nợ}=    Số Nguyên Trong    ${hàng_nợ} >> css=span.money
    Should Be Equal As Integers    ${nợ}    ${đơn}[total]    Công nợ trên admin khác tổng đơn nợ trong IndexedDB.
    Should Be Equal As Integers    ${đơn}[paidAmount]    0
    Nút Trên Trang Chỉ Là Nút Đọc

Máy chưa ghép hiện mã máy và số lượng, không có chi tiết
    [Documentation]    Máy chưa ghép (kể cả lúc chưa đặt tên) hiện trên admin bằng mã máy và số lượng do máy tự báo;
    ...    sau khi bán, số đơn và còn nợ bằng giá trị tính từ IndexedDB của máy đó, và không lộ tên khách nào.
    Cần Secret Xem Local
    ${context_c}=    New Context    viewport=${VIEWPORT}
    ${page_c}=    New Page    ${BASE_URL}/
    Chờ Máy Đã Gửi Nhịp Báo
    ${install_c}=    Mã Cài Đặt Của Máy    ${page_c}
    ${khối_c}=    Set Variable    css=[data-install-id="${install_c}"]

    New Context    viewport=${VIEWPORT}
    ${page_admin}=    New Page    ${BASE_URL}/admin/may-chua-ghep
    Đăng Nhập Admin
    Wait For Elements State    css=[data-group="unpaired"] [data-install-id="${install_c}"]    visible
    ${đơn_lúc_đầu}=    Số Nguyên Trong    ${khối_c} >> css=[data-field="orderCount"]
    Should Be Equal As Integers    ${đơn_lúc_đầu}    0

    Switch Page    ${page_c}    context=ALL    browser=ALL
    Mở Màn    /ghep-may
    Đặt Tên Máy Hiện Tại    Quầy C    C
    Nạp Dữ Liệu Mẫu
    Mở Màn    /them/khach-hang/moi
    Điền Ô    Tên khách hàng *    Cô Tám Chưa Ghép
    Bấm Nút    LƯU KHÁCH HÀNG
    Chờ Thấy Chữ    Cô Tám Chưa Ghép
    Bán Nợ Cho Khách    Cơm tấm    Cô Tám Chưa Ghép
    # Lượt mở app trước đã báo số 0 và mốc 15 phút chặn báo lại; xoá mốc là thao tác của trình duyệt kiểm thử.
    LocalStorage Remove Item    ${KHOÁ_NHỊP_BÁO}
    Mở Màn    /
    Chờ Máy Đã Gửi Nhịp Báo
    ${sổ_c}=    Tổng Tiền Tính Từ IndexedDB    ${page_c}
    Mở Màn    /them/cai-dat
    ${dòng_máy}=    Get Text    text=/Mã máy: / >> nth=0
    ${mã_máy_cài_đặt}=    Evaluate    re.search(r'Mã máy: (\\S+)', $dòng_máy).group(1)    modules=re

    Switch Page    ${page_admin}    context=ALL    browser=ALL
    Wait Until Keyword Succeeds    20x    1s    Máy Trên Admin Phải Báo Số Đơn    ${install_c}    ${sổ_c}[orders]
    Get Text    ${khối_c} >> text=/Mã máy: /    ==    Mã máy: ${mã_máy_cài_đặt}
    ${còn_nợ}=    Số Nguyên Trong    ${khối_c} >> css=[data-field="debtTotal"]
    Should Be Equal As Integers    ${còn_nợ}    ${sổ_c}[debt]    Còn nợ máy C báo khác IndexedDB của C.
    Should Be True    ${còn_nợ} > 0    Ca phải có nợ thật để phép so có nghĩa.
    ${chữ_khối}=    Get Text    ${khối_c}
    Should Not Contain    ${chữ_khối}    Cô Tám Chưa Ghép
    Should Not Contain    ${chữ_khối}    Anh Hùng

Máy chưa ghép chuyển sang Đã ghép sau đó khi ghép
    [Documentation]    Máy đã từng báo là chưa ghép, khi ghép vào một sổ thì trên admin chuyển sang nhóm "Đã ghép sau
    ...    đó" kèm đúng mã sổ, và không còn nằm trong nhóm "Chưa ghép".
    Cần Secret Xem Local
    Mở Hai Máy Đã Ghép
    ${shop_id}=    Mã Sổ Của Máy    ${MÁY_A_PAGE}
    ${rút_gọn}=    Rút Gọn Mã    ${shop_id}
    ${context_c}=    New Context    viewport=${VIEWPORT}
    ${page_c}=    New Page    ${BASE_URL}/ghep-may
    Đặt Tên Máy Hiện Tại    Quầy C    C
    Chờ Máy Đã Gửi Nhịp Báo
    ${install_c}=    Mã Cài Đặt Của Máy    ${page_c}

    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /ghep-may
    Wait For Elements State    css=button:has-text("TẠO MÃ GHÉP")    visible
    ${failure_keyword}=    Register Keyword To Run On Failure    NONE
    TRY
        Bấm Nút    TẠO MÃ GHÉP
        Wait For Elements State    css=p.font-mono    visible
        ${mức_log}=    Set Log Level    NONE
        ${pair_code}=    Get Text    css=p.font-mono
        Set Test Variable    ${PAIR_CODE}    ${pair_code}
        Set Log Level    ${mức_log}
        Switch Page    ${page_c}    context=ALL    browser=ALL
        Fill Secret    ${MÃ_GHÉP_INPUT}    $PAIR_CODE
        Bấm Nút    GHÉP MÁY NÀY
        Chờ Máy Hoàn Tất Ghép    ${page_c}    Quầy C
    FINALLY
        Register Keyword To Run On Failure    ${failure_keyword}
    END

    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /admin/may-chua-ghep
    Đăng Nhập Admin
    Wait For Elements State    css=[data-total]    visible
    Wait For Elements State    css=[data-group="unpaired"] [data-install-id="${install_c}"]    detached
    Click    ${NÚT_ĐÃ_GHÉP_SAU}
    ${khối_c}=    Set Variable    css=[data-group="paired"] [data-install-id="${install_c}"]
    Wait For Elements State    ${khối_c}    visible
    Get Text    ${khối_c}    *=    đã ghép vào Sổ ${rút_gọn}

    Mở Màn Trên Máy    ${page_c}    /them/cai-dat
    Chờ Thấy Chữ    Sổ: ${rút_gọn} · Máy C

Chuỗi Sổ ở Cài đặt trùng chuỗi trên admin
    [Documentation]    Cài đặt của máy và trang admin phải nói cùng một mã sổ rút gọn, nguyên văn, để người vận hành
    ...    đọc mã trên máy người bán là tìm được đúng sổ.
    Cần Secret Xem Local
    Mở Hai Máy Đã Ghép
    ${shop_id}=    Mã Sổ Của Máy    ${MÁY_A_PAGE}
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /them/cai-dat
    Chờ Thấy Chữ    · Máy A
    ${dòng_máy}=    Get Text    text=/Sổ: .* · Máy A/ >> nth=0
    ${sổ_cài_đặt}=    Evaluate    re.search(r'Sổ: \\S+', $dòng_máy).group(0)    modules=re

    Mở Admin Trên Trang Đang Đứng    /admin/so/${shop_id}
    Wait For Elements State    css=[data-shop-id="${shop_id}"]    visible
    ${sổ_admin}=    Get Text    css=[data-shop-id="${shop_id}"] >> css=a
    Should Be Equal    ${sổ_admin}    ${sổ_cài_đặt}    Chuỗi Sổ ở Cài đặt khác chuỗi trên admin.

Máy tự huỷ ghép gửi heartbeat ngay
    [Documentation]    Bấm "Huỷ ghép máy này" thì máy báo nhịp ngay, không đợi lượt 6 giờ: `data-last-seen` của máy B trên
    ...    admin phải tăng và phiên bản không còn rỗng. Không đòi B quay về nhóm "Chưa ghép": B vừa ghép trong cùng ca
    ...    (dưới 10 phút) nên server cố ý giữ trạng thái đã ghép, để nhịp báo gửi trước lúc ghép mà tới muộn không xoá
    ...    nó; việc xoá sau cửa sổ 10 phút do test Vitest của Worker khẳng định.
    Cần Secret Xem Local
    Mở Hai Máy Đã Ghép
    ${install_b}=    Mã Cài Đặt Của Máy    ${MÁY_B_PAGE}

    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /admin/may-chua-ghep
    Đăng Nhập Admin
    ${t1}=    Lần Báo Của Máy Trên Admin    ${install_b}

    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_B_PAGE}
    Wait Until Keyword Succeeds    40x    500ms    Bản Sao Máy Phải Đuổi Kịp Sổ Chung    ${MÁY_B_PAGE}
    Mở Màn Trên Máy    ${MÁY_B_PAGE}    /ghep-may
    Danh Sách Máy Đã Tải
    Wait For Elements State    css=button:text-is("Huỷ ghép máy này")    enabled
    Click    css=button:text-is("Huỷ ghép máy này")
    Chờ Hộp Xác Nhận    Huỷ ghép “Quầy B”?
    # `text-is`: `has-text("Huỷ ghép")` khớp cả nút "Huỷ" của hộp.
    Click    ${HỘP_XÁC_NHẬN} >> css=button:text-is("Huỷ ghép")
    Chờ Thấy Chữ    Máy này đã rời sổ chung

    Switch Page    ${MÁY_A_PAGE}    context=ALL    browser=ALL
    Wait Until Keyword Succeeds    20x    1s    Máy Trên Admin Phải Báo Sau    ${install_b}    ${t1}

Người vận hành mở admin không thành máy chưa ghép
    [Documentation]    Mở `/admin` không được gửi nhịp báo: sau hơn một nhịp mở app (3 giây), tổng máy chưa ghép vẫn
    ...    như cũ. Nếu trang admin chạy runner hay heartbeat, trình duyệt của người vận hành sẽ thành một máy chưa ghép.
    Cần Secret Xem Local
    New Context    viewport=${VIEWPORT}
    New Page    ${BASE_URL}/admin/may-chua-ghep
    Đăng Nhập Admin
    ${n1}=    Tổng Máy Chưa Ghép
    # Chờ một khoảng cố định là đúng ở đây: đang kiểm một việc KHÔNG được xảy ra, không có trạng thái nào để chờ.
    Sleep    5s
    Click    ${NÚT_CÁC_SỔ}
    Wait For Elements State    css=h1:text-is("Các sổ")    visible
    Click    ${NÚT_MÁY_CHƯA_GHÉP}
    ${n2}=    Tổng Máy Chưa Ghép
    Should Be Equal As Integers    ${n2}    ${n1}    Mở trang admin làm tăng số máy chưa ghép.
    ${nhịp}=    LocalStorage Get Item    ${KHOÁ_NHỊP_BÁO}
    Should Be Equal    ${nhịp}    ${None}    Trang admin đã gửi nhịp báo.

*** Keywords ***
Chờ Máy Đã Gửi Nhịp Báo
    [Documentation]    App gửi nhịp báo 3 giây sau khi mở, lâu hơn khoảng thử lại mặc định của assertion Browser,
    ...    nên chờ tới khi mốc gửi xuất hiện.
    Wait Until Keyword Succeeds    15s    500ms    LocalStorage Get Item    ${KHOÁ_NHỊP_BÁO}    !=    ${None}

Cần Secret Xem Local
    [Documentation]    Bỏ ca khi chạy remote hoặc thiếu secret xem. Đọc biến môi trường trong Python để giá trị
    ...    secret không bao giờ thành đối số keyword (đối số có thể vào log).
    ${có}=    Evaluate
    ...    os.environ.get('ROBOT_REMOTE', '0') != '1' and bool(os.environ.get('ROBOT_WORKER_ADMIN_VIEW_SECRET'))
    ...    modules=os
    Skip If    not ${có}    Thiếu secret xem (remote).

Nhập Mật Khẩu Từ Biến Môi Trường
    [Documentation]    Điền secret lấy từ biến môi trường rồi bấm Vào. Log tắt lúc đọc, `Fill Secret` không ghi giá trị.
    [Arguments]    ${tên_biến}
    ${mức_log}=    Set Log Level    NONE
    TRY
        ${secret}=    Get Environment Variable    ${tên_biến}
        Set Test Variable    ${ADMIN_PASSWORD}    ${secret}
    FINALLY
        Set Log Level    ${mức_log}
    END
    ${failure_keyword}=    Register Keyword To Run On Failure    NONE
    TRY
        Fill Secret    ${Ô_MẬT_KHẨU_XEM}    $ADMIN_PASSWORD
    FINALLY
        Register Keyword To Run On Failure    ${failure_keyword}
    END
    Click    ${NÚT_VÀO}

Đăng Nhập Admin
    [Documentation]    Gọi lại sau mỗi lần mở/tải lại trang: secret chỉ sống trong bộ nhớ trang.
    Wait For Elements State    ${Ô_MẬT_KHẨU_XEM}    visible
    Nhập Mật Khẩu Từ Biến Môi Trường    ROBOT_WORKER_ADMIN_VIEW_SECRET
    Wait For Elements State    ${NÚT_THOÁT}    visible

Mở Admin Trên Trang Đang Đứng
    [Arguments]    ${đường_dẫn}
    Mở Màn    ${đường_dẫn}
    Đăng Nhập Admin

Sổ Trên Admin Đã Báo Máy A Hết Tụt
    [Documentation]    Tiến độ kéo là lần báo gần nhất của máy, nên mở lại trang tới khi máy A báo `tụt 0`.
    [Arguments]    ${shop_id}
    Mở Admin Trên Trang Đang Đứng    /admin/so/${shop_id}
    ${máy_a}=    Set Variable    css=[data-shop-id="${shop_id}"] [data-device-letter="A"]
    Wait For Elements State    ${máy_a}    visible
    ${chữ}=    Get Text    ${máy_a}
    Should Match Regexp    ${chữ}    tụt 0(\\D|$)

Số Nguyên Trong
    [Documentation]    Số nguyên ghép từ mọi chữ số trong phần tử: "1.250.000 đ" → 1250000.
    [Arguments]    ${selector}
    ${chữ}=    Get Text    ${selector}
    ${số}=    Evaluate    int(re.sub(r'\\D', '', $chữ) or '0')    modules=re
    RETURN    ${số}

Tổng Tiền Tính Từ IndexedDB
    [Documentation]    Số đơn (gồm đơn huỷ), doanh thu (đơn không huỷ) và còn nợ (phần chưa trả của đơn không huỷ có
    ...    khách) tính thẳng từ bảng `orders`, cùng định nghĩa với Đối soát.
    [Arguments]    ${page}
    ${orders}=    Đọc Bảng    orders    ${page}
    ${sổ}=    Evaluate
    ...    {'orders': len($orders), 'revenue': sum(o['total'] for o in $orders if o['status'] != 'void'), 'debt': sum(max(0, o['total'] - o['paidAmount']) for o in $orders if o['status'] != 'void' and o.get('customerId') is not None)}
    RETURN    ${sổ}

Mã Sổ Của Máy
    [Arguments]    ${page}
    ${rows}=    Đọc Bảng    deviceState    ${page}
    ${connection}=    Evaluate    [row for row in $rows if row['key'] == 'connection']
    Length Should Be    ${connection}    1    Máy chưa có dòng connection.
    RETURN    ${connection}[0][shopId]

Mã Cài Đặt Của Máy
    [Arguments]    ${page}
    ${rows}=    Đọc Bảng    deviceState    ${page}
    ${install}=    Evaluate    [row for row in $rows if row['key'] == 'install']
    Length Should Be    ${install}    1    Máy chưa có dòng install.
    RETURN    ${install}[0][installId]

Rút Gọn Mã
    [Documentation]    Như `shortId`: bốn ký tự đầu, dấu `…`, ba ký tự cuối.
    [Arguments]    ${id}
    ${rút_gọn}=    Evaluate    $id[:4] + '…' + $id[-3:]
    RETURN    ${rút_gọn}

Nút Trên Trang Chỉ Là Nút Đọc
    ${nút}=    Get Elements    css=button
    FOR    ${một_nút}    IN    @{nút}
        ${chữ}=    Get Text    ${một_nút}
        ${chữ}=    Strip String    ${chữ}
        Should Contain    ${NÚT_CHỈ_ĐỌC}    ${chữ}    Nút "${chữ}" không thuộc tập nút chỉ đọc.
    END

Tải Lại Danh Sách Máy Chưa Ghép
    [Documentation]    Chuyển sang Các sổ rồi về Máy chưa ghép trong app (không tải lại trang, không mất phiên), mở
    ...    nhóm "Đã ghép sau đó" để mọi máy đều hiện.
    Click    ${NÚT_CÁC_SỔ}
    Wait For Elements State    css=h1:text-is("Các sổ")    visible
    Click    ${NÚT_MÁY_CHƯA_GHÉP}
    Wait For Elements State    css=[data-total]    visible
    Click    ${NÚT_ĐÃ_GHÉP_SAU}

Lần Báo Của Máy Trên Admin
    [Arguments]    ${install_id}
    Wait For Elements State    css=[data-total]    visible
    Click    ${NÚT_ĐÃ_GHÉP_SAU}
    ${khối}=    Set Variable    css=[data-install-id="${install_id}"]
    Wait For Elements State    ${khối}    visible
    ${lần_báo}=    Get Attribute    ${khối}    data-last-seen
    RETURN    ${lần_báo}

Máy Trên Admin Phải Báo Sau
    [Arguments]    ${install_id}    ${mốc}
    Tải Lại Danh Sách Máy Chưa Ghép
    ${khối}=    Set Variable    css=[data-install-id="${install_id}"]
    Wait For Elements State    ${khối}    visible    timeout=2s
    ${lần_báo}=    Get Attribute    ${khối}    data-last-seen
    Should Be True    int(${lần_báo}) > int(${mốc})    Máy chưa báo nhịp mới sau khi huỷ ghép.
    ${chữ}=    Get Text    ${khối}
    Should Not Contain    ${chữ}    Bản —    Nhịp báo mới phải mang phiên bản app.

Máy Trên Admin Phải Báo Số Đơn
    [Arguments]    ${install_id}    ${số_đơn}
    Tải Lại Danh Sách Máy Chưa Ghép
    ${khối}=    Set Variable    css=[data-install-id="${install_id}"]
    Wait For Elements State    ${khối}    visible    timeout=2s
    ${đơn}=    Số Nguyên Trong    ${khối} >> css=[data-field="orderCount"]
    Should Be Equal As Integers    ${đơn}    ${số_đơn}    Máy chưa báo số đơn mới.

Tổng Máy Chưa Ghép
    Wait For Elements State    css=[data-total]    visible
    ${tổng}=    Get Attribute    css=[data-total]    data-total
    RETURN    ${tổng}
