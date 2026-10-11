*** Settings ***
Documentation    Máy thứ ba chạy bản phát hành cũ THẬT (2.19.0, dựng bằng `robot/may-cu.sh`) ghép vào cùng
...              Durable Object với hai máy bản mới. Bản cũ chỉ được kiểm bằng chính code của nó: giao diện
...              và luật đồng bộ của nó là thứ máy đang chạy ngoài quán, không phải thứ ta nhớ về nó.
Resource         hai-may.resource
Library          Process

*** Variables ***
${MÁY_CŨ_URL}               http://127.0.0.1:5176
# Màn thu tiền của bản cũ: chưa có bước xác nhận đơn, nút chốt là XONG & XUẤT PHIẾU.
${SHEET_THU_TIỀN_CŨ}        css=[role=dialog][aria-label="Thu tiền"]
${NÚT_XONG_CŨ}              css=button:has-text("XONG & XUẤT PHIẾU")

*** Keywords ***
Dựng Máy Cũ
    [Documentation]    Build một lần (giữ ở robot/.may-cu/) rồi phục vụ suốt suite; gọi lại khi đã chạy thì thôi.
    ...    Bản cũ chạy ở hostname local nên chỉ nối Worker local: lượt remote (staging) bỏ qua ca máy cũ.
    Skip If    '%{ROBOT_REMOTE=0}' == '1'    Bản 2.19.0 chỉ nối Worker local 127.0.0.1:8787.
    ${đang_chạy}=    Get Variable Value    ${MÁY_CŨ_ĐANG_CHẠY}    ${False}
    IF    ${đang_chạy}    RETURN
    ${build}=    Run Process    robot/may-cu.sh    build    timeout=15 min
    ...    stdout=robot/results/may-cu-build.log    stderr=STDOUT
    Should Be Equal As Integers    ${build.rc}    0    Không dựng được bản cũ. Xem robot/results/may-cu-build.log.
    Start Process    robot/may-cu.sh    serve    alias=may-cu
    ...    stdout=robot/results/may-cu.log    stderr=STDOUT
    Set Suite Variable    ${MÁY_CŨ_ĐANG_CHẠY}    ${True}
    Wait Until Keyword Succeeds    60x    500ms    Máy Cũ Phải Trả Trang

Máy Cũ Phải Trả Trang
    Process Should Be Running    may-cu    Máy cũ dừng trước khi sẵn sàng. Xem robot/results/may-cu.log.
    ${html}=    Evaluate    __import__('urllib.request').request.urlopen('${MÁY_CŨ_URL}/', timeout=2).read().decode()
    Should Contain    ${html}    <title>my-biller — Bán hàng</title>

Tắt Máy Cũ
    ${đang_chạy}=    Get Variable Value    ${MÁY_CŨ_ĐANG_CHẠY}    ${False}
    IF    ${đang_chạy}    Terminate Process    may-cu
    Set Suite Variable    ${MÁY_CŨ_ĐANG_CHẠY}    ${False}

Ghép Máy Cũ
    [Documentation]    Máy A tạo mã ghép, máy cũ (C) ghép vào sổ đang có dữ liệu rồi kéo hết về.
    Dựng Máy Cũ
    Mở Màn Trên Máy    ${MÁY_A_PAGE}    /ghep-may
    ${failure_keyword}=    Register Keyword To Run On Failure    NONE
    TRY
        Bấm Nút    TẠO MÃ GHÉP
        Wait For Elements State    css=p.font-mono    visible
        ${mức_log}=    Set Log Level    NONE
        ${pair_code}=    Get Text    css=p.font-mono
        Set Test Variable    ${PAIR_CODE_CŨ}    ${pair_code}
        Set Log Level    ${mức_log}

        ${context_c}=    New Context    viewport=${VIEWPORT}    acceptDownloads=${True}
        ${page_c}=    New Page    ${MÁY_CŨ_URL}/ghep-may
        Set Test Variable    ${MÁY_CŨ_PAGE}    ${page_c}
        Đặt Tên Máy Hiện Tại    Quầy cũ    C
        Fill Secret    ${MÃ_GHÉP_INPUT}    $PAIR_CODE_CŨ
        Bấm Nút    GHÉP MÁY NÀY
        Chờ Máy Hoàn Tất Ghép    ${MÁY_CŨ_PAGE}    Quầy cũ
    FINALLY
        Register Keyword To Run On Failure    ${failure_keyword}
    END
    Wait Until Keyword Succeeds    80x    500ms    Bản Sao Máy Phải Đuổi Kịp Sổ Chung    ${MÁY_CŨ_PAGE}

Chọn Máy Cũ
    Switch Page    ${MÁY_CŨ_PAGE}    context=ALL    browser=ALL

Mở Màn Máy Cũ
    [Arguments]    ${đường_dẫn}
    Chọn Máy Cũ
    Go To    ${MÁY_CŨ_URL}${đường_dẫn}

Máy Cũ Bán Cà Phê Sữa Kèm Topping
    [Documentation]    Một ly cà phê sữa kèm một phần topping, đúng luồng của bản cũ: chạm món mở sheet thực đơn.
    [Arguments]    ${topping}
    Mở Màn Máy Cũ    /
    Chọn Món    Cà phê sữa
    Click    ${{ 'css=button[aria-label="Thêm %s"]' % $topping }}
    Bấm Thêm Vào Đơn
    Máy Cũ Chốt Đơn

Máy Cũ Thêm Topping Vào Nhóm Đồ Uống
    [Documentation]    Sửa thực đơn bằng chính sheet "Tuỳ chọn & topping" của bản cũ, thêm một dòng topping cuối.
    [Arguments]    ${tên}    ${giá}
    ${nhóm}=    Nhóm Món Trên Máy    ${MÁY_CŨ_PAGE}    Đồ uống
    ${dòng}=    Evaluate    len($nhóm['toppingMenu']) + 1
    Mở Màn Máy Cũ    /them/nhom-mat-hang
    Click    css=button:has-text("Đồ uống")
    Bấm Nút    Tuỳ chọn & topping
    Wait For Elements State    css=[role=dialog] >> text=Tên topping ${{ ${dòng} - 1 }}    visible
    Bấm Nút    ＋ Thêm topping
    Điền Ô    Tên topping ${dòng}    ${tên}
    Điền Ô    Giá topping ${dòng}    ${giá}
    Click    css=[role=dialog] >> css=button:text-is("LƯU")
    Wait For Elements State    css=[role=dialog]    detached

Máy Cũ Chốt Đơn
    [Documentation]    Thu tiền theo luồng của bản cũ: THU TIỀN → sheet "Thu tiền" → XONG & XUẤT PHIẾU.
    Đóng Đơn
    Click    css=button:text-is("THU TIỀN")
    Wait For Elements State    ${SHEET_THU_TIỀN_CŨ}    visible
    Click    ${NÚT_XONG_CŨ}
    Wait For Condition    Url    contains    /phieu

Máy Cũ Không Bị Từ Chối Event Nào
    [Documentation]    Event bị sổ chung từ chối thì bản cũ cuộn ngược đuôi hàng đợi và để lại một câu báo;
    ...    hàng đợi rỗng mà không có câu báo nào nghĩa là mọi thao tác của máy cũ đã lên sổ nguyên vẹn.
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_CŨ_PAGE}
    ${state}=    Đọc Bảng    deviceState    ${MÁY_CŨ_PAGE}
    ${báo}=    Evaluate    [row.get('message') for row in $state if row.get('key') == 'notice']
    Should Be Empty    ${báo}    Máy cũ nhận câu báo từ sổ chung: ${báo}

Nhóm Món Trên Máy
    [Arguments]    ${page}    ${tên}
    ${nhóm}=    Đọc Bảng    itemGroups    ${page}
    ${khớp}=    Evaluate    [g for g in $nhóm if g['name'] == $tên]
    Length Should Be    ${khớp}    1
    RETURN    ${khớp}[0]

Menu Topping Trên Máy Phải Là
    [Documentation]    `toppingMenu` của nhóm món trên một máy, dạng [(tên, giá)].
    [Arguments]    ${page}    ${tên_nhóm}    ${kỳ_vọng}
    ${nhóm}=    Nhóm Món Trên Máy    ${page}    ${tên_nhóm}
    ${menu}=    Evaluate    [(t['name'], t['price']) for t in $nhóm['toppingMenu']]
    Should Be Equal    ${menu}    ${kỳ_vọng}

Mở Quán Bằng Máy Cũ
    [Documentation]    Quán do máy 2.19.0 mở và dùng trước khi có máy bản mới nào: máy cũ là máy đầu tiên ghép bằng
    ...    mã khởi tạo, sổ chung chưa từng nhận request `catalog-v2` nên chưa di trú.
    Dựng Máy Cũ
    ${context_c}=    New Context    viewport=${VIEWPORT}    acceptDownloads=${True}
    ${page_c}=    New Page    ${MÁY_CŨ_URL}/ghep-may
    Set Test Variable    ${MÁY_CŨ_PAGE}    ${page_c}
    Đặt Tên Máy Hiện Tại    Quầy cũ    C
    ${mức_log}=    Set Log Level    NONE
    TRY
        Environment Variable Should Be Set    ROBOT_WORKER_ADMIN_SECRET
        ${bootstrap_code}=    Tạo Quán Thử Qua Worker    ${WORKER_URL}
        Set Test Variable    ${BOOTSTRAP_CODE}    ${bootstrap_code}
    FINALLY
        Set Log Level    ${mức_log}
    END
    ${failure_keyword}=    Register Keyword To Run On Failure    NONE
    TRY
        Fill Secret    ${MÃ_GHÉP_INPUT}    $BOOTSTRAP_CODE
        Bấm Nút    GHÉP MÁY NÀY
        Chờ Máy Hoàn Tất Ghép    ${MÁY_CŨ_PAGE}    Quầy cũ
    FINALLY
        Register Keyword To Run On Failure    ${failure_keyword}
    END

Ghép Máy Mới Vào Quán Của Máy Cũ
    [Documentation]    Máy cũ tạo mã, máy bản mới (A) ghép vào sổ đang có dữ liệu do máy cũ ghi.
    Mở Màn Máy Cũ    /ghep-may
    ${failure_keyword}=    Register Keyword To Run On Failure    NONE
    TRY
        Bấm Nút    TẠO MÃ GHÉP
        Wait For Elements State    css=p.font-mono    visible
        ${mức_log}=    Set Log Level    NONE
        ${pair_code}=    Get Text    css=p.font-mono
        Set Test Variable    ${PAIR_CODE_MỚI}    ${pair_code}
        Set Log Level    ${mức_log}

        ${context_a}=    New Context    viewport=${VIEWPORT}    acceptDownloads=${True}
        ${page_a}=    New Page    ${BASE_URL}/ghep-may
        Set Test Variable    ${MÁY_A_PAGE}    ${page_a}
        Đặt Tên Máy Hiện Tại    Quầy A    A
        Fill Secret    ${MÃ_GHÉP_INPUT}    $PAIR_CODE_MỚI
        Bấm Nút    GHÉP MÁY NÀY
        Chờ Máy Hoàn Tất Ghép    ${MÁY_A_PAGE}    Quầy A
    FINALLY
        Register Keyword To Run On Failure    ${failure_keyword}
    END

Máy Cũ Tạo Nhóm Đồ Uống Có Thực Đơn
    [Documentation]    Nhóm "Đồ uống" với một nhóm tuỳ chọn (Đường) và hai topping (Trân châu 5.000, Thạch 3.000),
    ...    tạo và cài bằng chính màn của bản cũ.
    Mở Màn Máy Cũ    /them/nhom-mat-hang
    Click    css=button:has-text("＋ Thêm nhóm") >> nth=0
    Điền Ô    Tên    Đồ uống
    Click    css=[role=dialog] >> css=button:text-is("LƯU")
    Wait For Elements State    css=[role=dialog]    detached
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
    Wait Until Keyword Succeeds    20x    250ms    Menu Topping Trên Máy Phải Là    ${MÁY_CŨ_PAGE}    Đồ uống
    ...    ${{ [('Trân châu', 5000), ('Thạch', 3000)] }}
