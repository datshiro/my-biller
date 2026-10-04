*** Settings ***
Documentation       Sao lưu, nhập lại và xoá sạch — ba thao tác duy nhất có thể làm mất trắng sổ
...                 sách. Chạy trên trình duyệt thật nên file được tải xuống thật rồi nạp lại thật,
...                 chứ không mô phỏng: chính cú `link.click()` và cú đọc `File` là chỗ hay hỏng.
Resource            ../resources/app.resource
Resource            ../resources/sales.resource
Library             OperatingSystem
Library             Collections
Library             String
Library             ../libraries/so_no.py
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           sao-luu


*** Variables ***
${NÚT_SAO_LƯU}      css=button:has-text("SAO LƯU RA FILE")
${Ô_CHỌN_FILE}      css=input[aria-label="Chọn file sao lưu"]
${SHEET_XOÁ}        css=[role=dialog][aria-label="Xoá toàn bộ dữ liệu"]
${SHEET_CHẾ_ĐỘ}     css=[role=dialog][aria-label="Khôi phục từ file"]
${SHEET_GỘP}        css=[role=dialog][aria-label="Gộp file vào sổ trên máy"]
${NÚT_GỘP}          css=[role=dialog][aria-label="Gộp file vào sổ trên máy"] >> css=button:text-is("GỘP")


*** Test Cases ***
Sao lưu ra file thì file thật nằm trong máy và có đủ dữ liệu
    Mở Màn    /them/sao-luu
    ${đường_dẫn}=    Sao Lưu Ra File

    ${nội_dung}=    Get File    ${đường_dẫn}
    ${bản_sao}=    Evaluate    json.loads($nội_dung)    json
    Should Be Equal    ${bản_sao}[app]    my-biller
    Length Should Be    ${bản_sao}[data][items]    4
    Length Should Be    ${bản_sao}[data][orders]    2
    Length Should Be    ${bản_sao}[data][customers]    1
    Length Should Be    ${bản_sao}[data][expenses]    1

Bản sao chưa có dữ liệu bán hàng phải được cảnh báo trước khi tải
    [Documentation]    Trước đây Safari rỗng vẫn tải ngay và ghi mốc, khiến người bán tưởng đã giữ
    ...    được sổ trong PWA. Cửa này phải chặn cú tải và mốc cho tới khi họ chủ động xác nhận.
    [Tags]    regression
    [Setup]    Mở Phiên Sạch
    Mở Màn    /them/sao-luu
    Theo Dõi Yêu Cầu Tải

    Click    ${NÚT_SAO_LƯU}
    Chờ Hộp Xác Nhận    Bản sao này chưa có dữ liệu bán hàng
    Wait Until Keyword Succeeds    30x    100ms    Focus Phải Ở Nút    Huỷ
    Keyboard Key    press    Tab
    Focus Phải Ở Nút    Vẫn tải bản sao này
    Keyboard Key    press    Tab
    Focus Phải Ở Nút    Huỷ
    Keyboard Key    press    Escape
    Wait For Elements State    ${HỘP_XÁC_NHẬN}    detached
    Wait Until Keyword Succeeds    30x    100ms    Focus Phải Ở Nút    SAO LƯU RA FILE
    ${số_tải}=    Số Yêu Cầu Tải
    Should Be Equal As Integers    ${số_tải}    0    App đã phát download trước khi người bán xác nhận.

    Click    ${NÚT_SAO_LƯU}
    Chờ Hộp Xác Nhận    Bản sao này chưa có dữ liệu bán hàng
    ${settings}=    Đọc Bảng    settings
    ${mốc}=    Evaluate
    ...    next((row['value']['lastBackupAt'] for row in $settings if row['key'] == 'app'), None)
    Should Be Equal    ${mốc}    ${None}    Cảnh báo chưa được xác nhận mà app đã ghi mốc sao lưu.

    ${hứa}=    Promise To Wait For Download
    Xác Nhận Trong Hộp    Vẫn tải bản sao này
    ${tải}=    Wait For    ${hứa}
    Wait For Elements State    ${HỘP_XÁC_NHẬN}    detached
    Wait Until Keyword Succeeds    30x    100ms    Focus Phải Ở Nút    SAO LƯU RA FILE
    ${nội_dung}=    Get File    ${tải}[saveAs]
    ${bản_sao}=    Evaluate    json.loads($nội_dung)    json
    Length Should Be    ${bản_sao}[data][orders]    0
    Length Should Be    ${bản_sao}[data][items]    0
    Length Should Be    ${bản_sao}[data][customers]    0
    Length Should Be    ${bản_sao}[data][expenses]    0
    Length Should Be    ${bản_sao}[data][customerPrices]    0
    ${số_tải}=    Số Yêu Cầu Tải
    Should Be Equal As Integers    ${số_tải}    1    Xác nhận một lần phải phát đúng một download.

Sao lưu xong thì chia sẻ đúng file JSON vừa tải
    [Documentation]    Robot giữ phần user-reachable contract: CTA chỉ hiện sau download và chuyển
    ...    đúng tên đề xuất, MIME và bytes. Native share sheet thật được kiểm riêng trên iPhone.
    Mở Màn    /them/sao-luu
    Giả Lập Chia Sẻ File
    Không Được Thấy Chữ    CHIA SẺ FILE VỪA SAO LƯU

    ${hứa}=    Promise To Wait For Download
    Click    ${NÚT_SAO_LƯU}
    ${tải}=    Wait For    ${hứa}
    Chờ Thấy Chữ    CHIA SẺ FILE VỪA SAO LƯU
    Click    css=button:has-text("CHIA SẺ FILE VỪA SAO LƯU")
    ${đã_chia_sẻ}=    Wait Until Keyword Succeeds    30x    100ms    Đọc Bản Sao Đã Chia Sẻ
    ${nội_dung}=    Get File    ${tải}[saveAs]

    Should Be Equal    ${đã_chia_sẻ}[name]    ${tải}[suggestedFilename]
    Should Be Equal    ${đã_chia_sẻ}[type]    application/json
    Should Be Equal    ${đã_chia_sẻ}[text]    ${nội_dung}
    Không Được Thấy Chữ    CHIA SẺ FILE VỪA SAO LƯU

Sao lưu xong thì màn sao lưu ghi lại mốc lần cuối
    Mở Màn    /them/sao-luu
    Chờ Thấy Chữ    Chưa sao lưu lần nào
    Sao Lưu Ra File
    Chờ Thấy Chữ    Đã yêu cầu tải file
    Chờ Thấy Chữ    Lần cuối:

Web: sau sao lưu chỉ nói đã yêu cầu tải, không khẳng định đã lưu
    [Documentation]    `<a download>` không báo lại file đã lưu hay tên cuối cùng, nên trên web màn chỉ được nói
    ...    "Đã yêu cầu tải" kèm tên đề xuất — "Đã lưu" dành cho APK, nơi plugin đọc lại tên thật.
    Mở Màn    /them/sao-luu
    Sao Lưu Ra File
    Chờ Thấy Chữ    Đã yêu cầu tải file
    Chờ Thấy Chữ    my-biller-backup-
    Chờ Thấy Chữ    Hãy mở thư mục Tải về để chắc file đã có
    Không Được Thấy Chữ    Đã lưu

APK giả: sao lưu ghi đúng một file vào Tải về và hiện tên thật
    [Documentation]    Trong WebView của APK, `<a download>` với blob bị nuốt im lặng mà mốc sao lưu vẫn đóng
    ...    dấu — người bán tưởng có file. Nay APK đi qua plugin DownloadFile (ở đây là cầu nối giả):
    ...    đúng một file JSON đủ bảng, màn hiện "Đã lưu: Download/<tên thật>", lần hai trùng tên thì hiện
    ...    tên hệ thống đã đổi, và mốc sao lưu có giá trị. Đường MediaStore thật chỉ nghiệm được trên máy.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Mở Màn    /them/sao-luu
    Click    ${NÚT_SAO_LƯU}
    Chờ Thấy Chữ    Đã lưu: Download/my-biller-backup-
    ${đã_lưu}=    Evaluate JavaScript    ${None}    () => window.__savedFiles
    Length Should Be    ${đã_lưu}    1    App phải ghi đúng một file vào Tải về.
    Should Be Equal    ${đã_lưu}[0][mimeType]    application/json
    ${bản_sao}=    Evaluate    json.loads($đã_lưu[0]['text'])    json
    Should Be Equal    ${bản_sao}[app]    my-biller
    Length Should Be    ${bản_sao}[data][items]    4
    Length Should Be    ${bản_sao}[data][orders]    2
    Length Should Be    ${bản_sao}[data][customers]    1
    Length Should Be    ${bản_sao}[data][expenses]    1
    Chờ Thấy Chữ    Đã lưu: Download/${đã_lưu}[0][filename].
    ${settings}=    Đọc Bảng    settings
    ${mốc}=    Evaluate
    ...    next((row['value']['lastBackupAt'] for row in $settings if row['key'] == 'app'), None)
    Should Not Be Equal    ${mốc}    ${None}    Plugin đã lưu xong mà mốc sao lưu chưa được ghi.

    Wait For Elements State    ${NÚT_SAO_LƯU}    enabled
    Click    ${NÚT_SAO_LƯU}
    ${tên}=    Evaluate    $đã_lưu[0]['filename'].replace('.json', ' (1).json')
    Chờ Thấy Chữ    Đã lưu: Download/${tên}.
    Không Được Thấy Chữ    Đã yêu cầu tải

APK giả: ghi file thất bại thì báo lỗi và không đóng dấu sao lưu
    [Documentation]    Plugin báo lỗi (hết chỗ, từ chối quyền) nghĩa là không có file trong Tải về: màn phải báo
    ...    lỗi, mốc sao lưu giữ nguyên chưa có và banner nhắc vẫn còn.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Mở Màn    /them/sao-luu
    Evaluate JavaScript    ${None}    () => { window.__failSave = true }
    Click    ${NÚT_SAO_LƯU}
    Wait For Elements State    css=[role=alert]    visible
    Chờ Thấy Chữ    bộ nhớ đầy
    Không Được Thấy Chữ    Đã lưu:
    ${settings}=    Đọc Bảng    settings
    ${mốc}=    Evaluate
    ...    next((row['value']['lastBackupAt'] for row in $settings if row['key'] == 'app'), None)
    Should Be Equal    ${mốc}    ${None}    Plugin báo lỗi mà app vẫn ghi mốc sao lưu.
    # Banner nhắc ("Chưa sao lưu lần nào. Mất máy là mất sạch dữ liệu.") vẫn còn.
    Chờ Thấy Chữ    Mất máy là mất

Ghi đè cho xem trước số trong file và số đang có trên máy, chưa ghi gì trước khi xác nhận
    Mở Màn    /them/sao-luu
    ${đường_dẫn}=    Sao Lưu Ra File
    Bán Nhanh    Trà đá

    Mở Màn    /them/sao-luu
    Chọn File Để Ghi Đè    ${đường_dẫn}
    Chờ Hộp Xác Nhận    Ghi đè toàn bộ dữ liệu?
    Chờ Thấy Chữ    File có 2 đơn
    Chờ Thấy Chữ    Đang có trên máy: 3 đơn
    Chờ Thấy Chữ    mất phần chưa có trong file
    ${đơn}=    Đọc Bảng    orders
    Length Should Be    ${đơn}    3    Mới xem trước mà sổ đã bị ghi đè.

Ghi đè xong báo cáo khớp, sổ đúng bằng file, thẻ hiện một lần
    [Documentation]    Sau khi ghi app tự tải lại trang; báo cáo đối chiếu (kỳ vọng tính từ file ⟷ đọc lại
    ...    trên máy) sống qua lần tải đó trong sessionStorage và chỉ hiện một lần. Tổng nợ trên thẻ phải bằng
    ...    nợ tính thẳng từ `Đọc Bảng orders` + `payments`, số dòng bằng file. Ca "báo cáo bắt được khi
    ...    lệch" không làm ở đây: Robot không chen được vào giữa lúc ghi và lúc đọc đối chiếu — ca đó ở
    ...    Vitest (src/db/__tests__/backup.test.ts "cố tình làm lệch", sao-luu-page.test.tsx thẻ LỆCH).
    Mở Màn    /them/sao-luu
    ${đường_dẫn}=    Sao Lưu Ra File
    ${bản_sao}=    Evaluate    json.loads(open($đường_dẫn, encoding='utf-8').read())    json
    Bán Nợ Cho Khách    Cà phê sữa    Anh Hùng

    Nhập File Sao Lưu    ${đường_dẫn}

    Chờ Thấy Chữ    Khôi phục khớp
    FOR    ${bảng}    IN    orders    customers    items    payments
        ${dòng}=    Đọc Bảng    ${bảng}
        ${trong_file}=    Get Length    ${bản_sao}[data][${bảng}]
        Length Should Be    ${dòng}    ${trong_file}    Bảng ${bảng} sau ghi đè không bằng file.
    END
    ${orders}=    Đọc Bảng    orders
    ${payments}=    Đọc Bảng    payments
    ${nợ}=    Tong No    ${orders}    ${payments}
    ${nợ_chữ}=    Dinh Dang Vnd    ${nợ}
    ${trên_thẻ}=    Get Text    css=[aria-label="Báo cáo khôi phục"] tr:has-text("Tổng nợ") >> css=td >> nth=2
    Should Be Equal    ${trên_thẻ}    ${nợ_chữ}    Tổng nợ trên thẻ không bằng nợ tính từ sổ.

    Reload
    Wait For Elements State    ${NÚT_SAO_LƯU}    visible
    Không Được Thấy Chữ    Khôi phục khớp

Gộp không mất đơn bán sau lần sao lưu
    [Documentation]    Lý do Gộp tồn tại: khôi phục file cũ mà không xoá những gì bán sau lần sao lưu đó. Đơn bán nợ
    ...    sau khi sao lưu vẫn còn, mọi gid trong file có trong sổ, và Tổng nợ trên thẻ bằng nợ tính từ Đọc Bảng.
    Mở Màn    /them/sao-luu
    ${f}=    Sao Lưu Ra File
    ${bản_sao}=    Evaluate    json.loads(open($f, encoding='utf-8').read())    json
    Bán Nợ Cho Khách    Cà phê sữa    Anh Hùng
    ${mới}=    Đơn Mới Nhất

    Mở Xem Trước Gộp    ${f}
    ${thẻ}=    Get Element Count    css=[data-conflict-gid]
    Should Be Equal As Integers    ${thẻ}    0
    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp

    ${đơn}=    Đọc Bảng    orders
    ${còn}=    Evaluate    [o for o in $đơn if o['gid'] == '${mới}[gid]']
    Length Should Be    ${còn}    1    Gộp làm mất đơn bán sau lần sao lưu.
    FOR    ${bảng}    IN    orders    customers    items    payments
        ${dòng}=    Đọc Bảng    ${bảng}
        ${thiếu}=    Evaluate    sorted({r['gid'] for r in $bản_sao['data'][$bảng]} - {r['gid'] for r in $dòng})
        Should Be Empty    ${thiếu}    Bảng ${bảng} thiếu dòng của file sau khi gộp.
    END
    ${payments}=    Đọc Bảng    payments
    ${nợ}=    Tong No    ${đơn}    ${payments}
    ${nợ_chữ}=    Dinh Dang Vnd    ${nợ}
    ${trên_thẻ}=    Get Text    css=[aria-label="Báo cáo khôi phục"] tr:has-text("Tổng nợ") >> css=td >> nth=2
    Should Be Equal    ${trên_thẻ}    ${nợ_chữ}    Tổng nợ trên thẻ không bằng nợ tính từ sổ.

Gộp: bản mới hơn thắng, bản cũ hơn thua
    [Documentation]    Sao lưu F1 (Trà đá 3.000), sửa giá thành 4.000, sao lưu F2; Ghi đè F1 đưa máy về giá cũ với mốc
    ...    cũ. Gộp F2 thì giá mới hơn trong file thắng; gộp tiếp F1 (cũ hơn) thì giữ giá trên máy.
    ${món}=    Đọc Bảng    items
    ${trà}=    Evaluate    next(i for i in $món if i['name'] == 'Trà đá')
    Mở Màn    /them/sao-luu
    ${f1}=    Sao Lưu Ra File
    Mở Màn    /them/mat-hang/${trà}[id]
    Điền Ô    Giá bán *    4000
    Bấm Nút    LƯU MẶT HÀNG
    Wait Until Keyword Succeeds    30x    200ms    Giá Món Phải Là    ${trà}[gid]    4000
    Mở Màn    /them/sao-luu
    ${f2}=    Sao Lưu Ra File

    Nhập File Sao Lưu    ${f1}
    Giá Món Phải Là    ${trà}[gid]    3000

    Mở Xem Trước Gộp    ${f2}
    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp
    Giá Món Phải Là    ${trà}[gid]    4000

    Mở Xem Trước Gộp    ${f1}
    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp
    Giá Món Phải Là    ${trà}[gid]    4000

Gộp: Thêm riêng khoản thu của đơn đã huỷ trên máy không để khoản thu trừ vào đơn huỷ
    [Documentation]    Lỗi cũ: recalcAll duyệt payments bằng each(async …) không chờ lần sửa, nên dòng cuối trừ vào
    ...    đơn đã huỷ không được bỏ phân bổ khi chạy trong khoá nhập. Bán có thu tiền cho Anh Hùng, sao lưu, huỷ
    ...    đơn trên máy rồi Gộp file chọn Thêm riêng: khoản thêm vào phải về chưa trừ (đơn đã huỷ), không khoản
    ...    nào còn trừ vào đơn huỷ, và nợ Anh Hùng tính từ sổ bằng số "Nợ sau gộp" đã hiện.
    [Tags]    regression
    ${đơn}=    Bán Có Thu Tiền Cho Anh Hùng    Cà phê sữa
    ${phiếu}=    Đọc Bảng    payments
    ${khoản}=    Evaluate    next(p for p in $phiếu if p['orderId'] == ${đơn}[id])
    Mở Màn    /them/sao-luu
    ${f}=    Sao Lưu Ra File
    Huỷ Đơn Đang Mở    ${đơn}

    Mở Xem Trước Gộp    ${f}
    Chọn Cho Xung Đột    ${khoản}[gid]    Thêm riêng
    Chờ Thấy Chữ    ra y như Giữ bản trên máy
    Chờ Thấy Chữ    Anh Hùng: hiện 80.000 đ → sau gộp 60.000 đ
    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp

    ${sau}=    Đọc Bảng    payments
    ${trừ_vào_đơn_huỷ}=    Evaluate    [p for p in $sau if p['allocatedOrderId'] == ${đơn}[id]]
    Should Be Empty    ${trừ_vào_đơn_huỷ}    Còn khoản thu trừ vào đơn đã huỷ sau khi gộp.
    ${số_trước}=    Evaluate    len($phiếu) + 1
    Length Should Be    ${sau}    ${số_trước}
    ${nợ}=    Nợ Anh Hùng Từ Sổ
    Should Be Equal As Integers    ${nợ}    60000

Gộp: hai xung đột của cùng một khách — nợ sau gộp đúng theo cả bộ lựa chọn
    [Documentation]    Anh Hùng có hai khoản thu chưa trừ đơn (20.000 và 3.000); sao lưu; trên máy trả lại khoản 1 và
    ...    bỏ khoản 2. Gộp file: hai thẻ, không chọn sẵn, GỘP khoá tới khi chọn đủ; "Nợ sau gộp" đổi theo
    ...    đúng cả bộ lựa chọn (100.000 → 80.000 → 77.000). File an toàn tải xong trước khi gộp; sau gộp nợ
    ...    tính từ Đọc Bảng bằng đúng số cuối cùng đã hiện, số dòng payments không đổi.
    ${p1}=    Dựng Khoản Thu Chưa Trừ Của Anh Hùng    Cà phê sữa
    ${p2}=    Dựng Khoản Thu Chưa Trừ Của Anh Hùng    Trà đá
    Mở Màn    /them/sao-luu
    ${f}=    Sao Lưu Ra File
    Xử Lý Khoản Thu Của Anh Hùng    ${p1}    Đã trả lại khách    Xác nhận
    Xử Lý Khoản Thu Của Anh Hùng    ${p2}    Bỏ có ghi vết    Xác nhận
    ${trước}=    Đọc Bảng    payments
    ${đơn_trước}=    Đọc Bảng    orders

    Mở Xem Trước Gộp    ${f}
    Wait For Elements State    css=[data-conflict-gid="${p1}[gid]"]    visible
    Wait For Elements State    css=[data-conflict-gid="${p2}[gid]"]    visible
    ${đã_chọn}=    Get Element Count    css=[data-conflict-gid] input[type=radio]:checked
    Should Be Equal As Integers    ${đã_chọn}    0    Xem trước đã chọn sẵn thay người bán.
    Chờ Thấy Chữ    Anh Hùng: hiện 100.000 đ → sau gộp 100.000 đ
    Wait For Elements State    ${NÚT_GỘP}    disabled
    Chọn Cho Xung Đột    ${p1}[gid]    Lấy bản trong file
    Chờ Thấy Chữ    Anh Hùng: hiện 100.000 đ → sau gộp 80.000 đ
    Wait For Elements State    ${NÚT_GỘP}    disabled
    Chọn Cho Xung Đột    ${p2}[gid]    Lấy bản trong file
    Chờ Thấy Chữ    Anh Hùng: hiện 100.000 đ → sau gộp 77.000 đ

    ${an_toàn}=    Bấm Gộp Qua Cửa File An Toàn
    ${số_đơn_trước}=    Get Length    ${đơn_trước}
    Length Should Be    ${an_toàn}[data][orders]    ${số_đơn_trước}    File an toàn không phải sổ ngay trước khi gộp.
    ${chưa_ghi}=    Khoản Thu Theo Gid    ${p1}[gid]
    Should Be Equal    ${chưa_ghi}[unallocatedStatus]    refunded    Chưa qua cửa mà sổ đã bị gộp.
    Xác Nhận Gộp

    ${sau}=    Đọc Bảng    payments
    ${số_trước}=    Get Length    ${trước}
    Length Should Be    ${sau}    ${số_trước}
    FOR    ${khoản}    IN    ${p1}    ${p2}
        ${dòng}=    Khoản Thu Theo Gid    ${khoản}[gid]
        ${trạng_thái}=    Evaluate    $dòng.get('unallocatedStatus', 'pending')
        Should Be Equal    ${trạng_thái}    pending
    END
    ${nợ}=    Nợ Anh Hùng Từ Sổ
    Should Be Equal As Integers    ${nợ}    77000

Gộp: xung đột hoàn tiền — Giữ bản trên máy
    ${p}=    Dựng Khoản Thu Chưa Trừ Của Anh Hùng    Cà phê sữa
    Mở Màn    /them/sao-luu
    ${f}=    Sao Lưu Ra File
    Xử Lý Khoản Thu Của Anh Hùng    ${p}    Đã trả lại khách    Xác nhận
    ${trước}=    Đọc Bảng    payments
    Mở Xem Trước Gộp    ${f}
    Chờ Thấy Chữ    Chọn cái này thì nợ Anh Hùng sau gộp: 100.000 đ
    Chọn Cho Xung Đột    ${p}[gid]    Giữ bản trên máy
    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp

    ${dòng}=    Khoản Thu Theo Gid    ${p}[gid]
    Should Be Equal    ${dòng}[unallocatedStatus]    refunded
    ${sau}=    Đọc Bảng    payments
    ${số_trước}=    Get Length    ${trước}
    Length Should Be    ${sau}    ${số_trước}
    ${nợ}=    Nợ Anh Hùng Từ Sổ
    Should Be Equal As Integers    ${nợ}    100000

Gộp: xung đột đã bỏ — Lấy bản trong file
    ${p}=    Dựng Khoản Thu Chưa Trừ Của Anh Hùng    Cà phê sữa
    Mở Màn    /them/sao-luu
    ${f}=    Sao Lưu Ra File
    Xử Lý Khoản Thu Của Anh Hùng    ${p}    Bỏ có ghi vết    Xác nhận
    Mở Xem Trước Gộp    ${f}
    Chọn Cho Xung Đột    ${p}[gid]    Lấy bản trong file
    Chờ Thấy Chữ    Anh Hùng: hiện 100.000 đ → sau gộp 80.000 đ
    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp

    ${dòng}=    Khoản Thu Theo Gid    ${p}[gid]
    ${trạng_thái}=    Evaluate    $dòng.get('unallocatedStatus', 'pending')
    Should Be Equal    ${trạng_thái}    pending
    Should Be Equal As Integers    ${dòng}[id]    ${p}[id]
    ${nợ}=    Nợ Anh Hùng Từ Sổ
    Should Be Equal As Integers    ${nợ}    80000

Gộp: Thêm riêng cảnh báo tính hai lần và thêm đúng một khoản thu mới
    ${p}=    Dựng Khoản Thu Chưa Trừ Của Anh Hùng    Cà phê sữa
    Mở Màn    /them/sao-luu
    ${f}=    Sao Lưu Ra File
    Xử Lý Khoản Thu Của Anh Hùng    ${p}    Đã trả lại khách    Xác nhận
    ${trước}=    Đọc Bảng    payments
    Mở Xem Trước Gộp    ${f}
    Chờ Thấy Chữ    Có thể tính tiền hai lần
    Chọn Cho Xung Đột    ${p}[gid]    Thêm riêng
    Chờ Thấy Chữ    Anh Hùng: hiện 100.000 đ → sau gộp 80.000 đ
    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp

    ${sau}=    Đọc Bảng    payments
    ${gid_cũ}=    Evaluate    {row['gid'] for row in $trước}
    ${mới}=    Evaluate    list(filter(lambda row, cũ=$gid_cũ: row['gid'] not in cũ, $sau))
    Length Should Be    ${mới}    1    Thêm riêng phải thêm đúng một khoản thu.
    Should Be Equal As Integers    ${mới}[0][amount]    ${p}[amount]
    ${dòng}=    Khoản Thu Theo Gid    ${p}[gid]
    Should Be Equal    ${dòng}[unallocatedStatus]    refunded
    ${nợ}=    Nợ Anh Hùng Từ Sổ
    Should Be Equal As Integers    ${nợ}    80000

Gộp: khoản thu đã gắn sang đơn khác trên máy — Giữ bản trên máy
    ${p}=    Dựng Khoản Thu Chưa Trừ Của Anh Hùng    Cà phê sữa
    Mở Màn    /them/sao-luu
    ${f}=    Sao Lưu Ra File
    Xử Lý Khoản Thu Của Anh Hùng    ${p}    Gắn đơn còn nợ    Gắn vào đơn
    ${đã_gắn}=    Khoản Thu Theo Gid    ${p}[gid]
    ${đơn_trước}=    Đọc Bảng    orders
    ${trả_trước}=    Evaluate    next(o['paidAmount'] for o in $đơn_trước if o['id'] == ${đã_gắn}[allocatedOrderId])
    Mở Xem Trước Gộp    ${f}
    Chờ Thấy Chữ    Trừ vào đơn
    Chọn Cho Xung Đột    ${p}[gid]    Giữ bản trên máy
    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp

    ${dòng}=    Khoản Thu Theo Gid    ${p}[gid]
    Should Be Equal As Integers    ${dòng}[allocatedOrderId]    ${đã_gắn}[allocatedOrderId]
    ${đơn_sau}=    Đọc Bảng    orders
    ${trả_sau}=    Evaluate    next(o['paidAmount'] for o in $đơn_sau if o['id'] == ${đã_gắn}[allocatedOrderId])
    Should Be Equal As Integers    ${trả_sau}    ${trả_trước}
    ${nợ}=    Nợ Anh Hùng Từ Sổ
    Should Be Equal As Integers    ${nợ}    80000

Gộp cùng file hai lần không đổi sổ
    [Documentation]    Lựa chọn "Lấy bản trong file" làm máy giống file, nên lần gộp thứ hai cùng file không còn xung
    ...    đột và không đổi dòng nào ở chín bảng sổ.
    ${p}=    Dựng Khoản Thu Chưa Trừ Của Anh Hùng    Cà phê sữa
    Mở Màn    /them/sao-luu
    ${f}=    Sao Lưu Ra File
    Xử Lý Khoản Thu Của Anh Hùng    ${p}    Đã trả lại khách    Xác nhận
    Gộp Với Một Lựa Chọn    ${f}    ${p}[gid]    Lấy bản trong file
    Chờ Thấy Chữ    Đã yêu cầu tải file an toàn
    ${lần_một}=    Sổ Chín Bảng

    Mở Xem Trước Gộp    ${f}
    ${thẻ}=    Get Element Count    css=[data-conflict-gid]
    Should Be Equal As Integers    ${thẻ}    0    Lần gộp thứ hai vẫn còn xung đột.
    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp
    ${lần_hai}=    Sổ Chín Bảng
    Dictionaries Should Be Equal    ${lần_hai}    ${lần_một}

File v1 cũ: Gộp phải cảnh báo nhân đôi trước, và không chết vì mã đơn không chữ
    [Documentation]    File v1/v2 không có mã toàn cục và mã đơn chưa có chữ máy (PBH-YYMMDD-NNN). Gộp vào sổ đã có
    ...    chính dữ liệu đó phải qua cửa cảnh báo nhân đôi; Huỷ thì không ghi gì; Vẫn gộp thì không lỗi, số
    ...    đơn và khoản thu gấp đôi, đơn từ file mang mã mới có chữ máy và giữ mã cũ ở originalCode.
    Mở Màn    /them/sao-luu
    ${f}=    Sao Lưu Ra File
    ${v1}=    Set Variable    ${DOWNLOAD_DIR}/ban-sao-v1.json
    ${văn_bản}=    Get File    ${f}
    ${nội_dung}=    Thanh V1    ${văn_bản}
    Create File    ${v1}    ${nội_dung}
    Nhập File Sao Lưu    ${v1}
    ${đơn_v1}=    Đọc Bảng    orders
    ${phiếu_v1}=    Đọc Bảng    payments
    ${mã_cũ}=    Evaluate    sorted(o['code'] for o in $đơn_v1)
    Should Match Regexp    ${mã_cũ}[0]    ^PBH-\\d{6}-\\d{3}$

    Mở Màn    /them/sao-luu
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${v1}
    Click    ${SHEET_CHẾ_ĐỘ} >> css=button:text-is("Gộp vào sổ trên máy")
    Chờ Hộp Xác Nhận    File từ bản cũ — gộp sẽ nhân đôi
    Chờ Thấy Chữ    Thường nên chọn Ghi đè
    Bỏ Qua Hộp Xác Nhận
    Wait For Elements State    ${SHEET_CHẾ_ĐỘ}    visible
    ${đơn}=    Đọc Bảng    orders
    Should Be Equal    ${đơn}    ${đơn_v1}    Huỷ ở cửa cảnh báo mà sổ đã đổi.

    Click    ${SHEET_CHẾ_ĐỘ} >> css=button:text-is("Gộp vào sổ trên máy")
    Xác Nhận Trong Hộp    Vẫn gộp
    Wait For Elements State    ${SHEET_GỘP}    visible
    Chờ Thấy Chữ    được cấp mã mới vì trùng mã trên máy
    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp

    ${đơn_sau}=    Đọc Bảng    orders
    ${phiếu_sau}=    Đọc Bảng    payments
    ${hai_lần}=    Evaluate    len($đơn_v1) * 2
    Length Should Be    ${đơn_sau}    ${hai_lần}
    ${hai_lần}=    Evaluate    len($phiếu_v1) * 2
    Length Should Be    ${phiếu_sau}    ${hai_lần}
    ${đổi_mã}=    Evaluate    [o for o in $đơn_sau if o['originalCode']]
    ${số_đơn_v1}=    Get Length    ${đơn_v1}
    Length Should Be    ${đổi_mã}    ${số_đơn_v1}
    FOR    ${o}    IN    @{đổi_mã}
        Should Match Regexp    ${o}[code]    ^PBH-\\d{6}-A\\d{3}$
        Should Contain    ${mã_cũ}    ${o}[originalCode]
    END
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${v1}

Gộp liệt kê thứ sẽ thêm lại; Huỷ ở cửa file an toàn thì không ghi gì
    [Documentation]    App không có bia mộ nên món đã xoá sau lần sao lưu sẽ quay lại khi gộp: xem trước phải liệt kê
    ...    tên. Huỷ ở cửa "Đã thấy file an toàn" là chưa ghi gì; gộp thật thì món về đúng gid cũ.
    Thêm Mặt Hàng    Bánh mì ốp la    15000
    ${món}=    Đọc Bảng    items
    ${bánh_mì}=    Evaluate    next(i for i in $món if i['name'] == 'Bánh mì ốp la')
    Mở Màn    /them/sao-luu
    ${f}=    Sao Lưu Ra File
    Xoá Mặt Hàng Chưa Bán    ${bánh_mì}

    Mở Xem Trước Gộp    ${f}
    Chờ Thấy Chữ    Sẽ thêm vào máy — có thể gồm thứ bạn đã xoá sau lần sao lưu này
    Chờ Thấy Chữ    Mặt hàng: Bánh mì ốp la
    Bấm Gộp Qua Cửa File An Toàn
    Bỏ Qua Hộp Xác Nhận
    Wait For Elements State    ${SHEET_GỘP}    visible
    Mặt Hàng Theo Gid Không Còn    ${bánh_mì}[gid]

    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp
    ${món_sau}=    Đọc Bảng    items
    ${về}=    Evaluate    [i for i in $món_sau if i['gid'] == '${bánh_mì}[gid]']
    Length Should Be    ${về}    1    Món đã xoá không về đúng gid cũ.

APK giả: gộp lưu file an toàn qua plugin rồi gộp luôn; plugin lỗi thì không ghi gì
    [Documentation]    Trong APK plugin báo lại file an toàn đã lưu thật nên không có cửa "Đã thấy file"; plugin lỗi
    ...    thì dừng, báo lỗi, chưa ghi gì.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Thêm Mặt Hàng    Bánh mì ốp la    15000
    ${món}=    Đọc Bảng    items
    ${bánh_mì}=    Evaluate    next(i for i in $món if i['name'] == 'Bánh mì ốp la')
    Mở Màn    /them/sao-luu
    Click    ${NÚT_SAO_LƯU}
    Chờ Thấy Chữ    Đã lưu: Download/
    ${đã_lưu}=    Evaluate JavaScript    ${None}    () => window.__savedFiles
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/ban-sao-apk.json
    Create File    ${f}    ${đã_lưu}[0][text]
    Xoá Mặt Hàng Chưa Bán    ${bánh_mì}

    Mở Xem Trước Gộp    ${f}
    Evaluate JavaScript    ${None}    () => { window.__failSave = true }
    Click    ${NÚT_GỘP}
    Wait For Elements State    ${SHEET_GỘP} >> css=[role=alert]    visible
    Chờ Thấy Chữ    bộ nhớ đầy
    Mặt Hàng Theo Gid Không Còn    ${bánh_mì}[gid]

    Evaluate JavaScript    ${None}    () => { window.__failSave = false }
    Đánh Dấu Trang Hiện Tại
    Click    ${NÚT_GỘP}
    Chờ Nạp Lại Xong
    Chờ Thấy Chữ    Khôi phục khớp
    # Thẻ báo cáo luôn nói file an toàn ra đâu, kể cả khi khớp — đó là đường về của người bán.
    Chờ Thấy Chữ    Đã lưu file an toàn: Download/my-biller-backup-
    ${món_sau}=    Đọc Bảng    items
    ${về}=    Evaluate    [i for i in $món_sau if i['gid'] == '${bánh_mì}[gid]']
    Length Should Be    ${về}    1
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

Nhập lại file sao lưu thì sổ quay về đúng lúc sao lưu
    [Documentation]    Vòng tròn đầy đủ: sao lưu → bán thêm → nhập lại. Đơn bán sau lúc sao lưu phải
    ...    biến mất, còn dữ liệu trong file phải về đủ.
    Mở Màn    /them/sao-luu
    ${đường_dẫn}=    Sao Lưu Ra File

    Bán Nhanh    Phở bò
    ${đơn}=    Đọc Bảng    orders
    Length Should Be    ${đơn}    3

    Nhập File Sao Lưu    ${đường_dẫn}

    ${sau}=    Đọc Bảng    orders
    Length Should Be    ${sau}    2    Đơn bán sau lúc sao lưu vẫn còn — file không được ghi đè.
    ${món}=    Đọc Bảng    items
    Length Should Be    ${món}    4

Nhập file thì phải qua đủ hai cửa xác nhận
    [Documentation]    Cửa thứ hai tồn tại vì cú tải file an toàn có thể bị webview nuốt trong im
    ...    lặng — bắt người bán tự mắt thấy file rồi mới cho đi tiếp.
    Mở Màn    /them/sao-luu
    ${đường_dẫn}=    Sao Lưu Ra File

    Chọn File Để Ghi Đè    ${đường_dẫn}
    Chờ Hộp Xác Nhận    Ghi đè toàn bộ dữ liệu?
    Chờ Thấy Chữ    2 đơn · 4 mặt hàng · 1 khách · 1 khoản chi · 0 giá riêng
    Xác Nhận Trong Hộp    Tải file an toàn

    Chờ Hộp Xác Nhận    Đã thấy file trong máy chưa?
    Chờ Thấy Chữ    sau bước này dữ liệu đang có trên máy không lấy lại được

Huỷ ở cửa đầu thì chưa đụng gì tới dữ liệu
    Mở Màn    /them/sao-luu
    ${đường_dẫn}=    Sao Lưu Ra File
    Bán Nhanh    Trà đá

    Mở Màn    /them/sao-luu
    Chọn File Để Ghi Đè    ${đường_dẫn}
    Chờ Hộp Xác Nhận    Ghi đè toàn bộ dữ liệu?
    Bỏ Qua Hộp Xác Nhận

    ${đơn}=    Đọc Bảng    orders
    Length Should Be    ${đơn}    3    Bấm Huỷ ở cửa đầu mà dữ liệu vẫn bị ghi đè.

Huỷ ở cửa thứ hai thì cũng vẫn chưa ghi đè
    Mở Màn    /them/sao-luu
    ${đường_dẫn}=    Sao Lưu Ra File
    Bán Nhanh    Trà đá

    Mở Màn    /them/sao-luu
    Chọn File Để Ghi Đè    ${đường_dẫn}
    Xác Nhận Trong Hộp    Tải file an toàn
    Chờ Hộp Xác Nhận    Đã thấy file trong máy chưa?
    Bỏ Qua Hộp Xác Nhận

    ${đơn}=    Đọc Bảng    orders
    Length Should Be    ${đơn}    3    Bấm Huỷ ở cửa thứ hai mà dữ liệu vẫn bị ghi đè.

Cài đặt dẫn tới màn Sao lưu & khôi phục, còn banner nhắc thì mở thẳng màn đó
    [Documentation]    Sao lưu/khôi phục dời khỏi Cài đặt sang màn riêng; Cài đặt chỉ còn một dòng dẫn tới.
    Mở Màn    /them/cai-dat
    Không Được Thấy Chữ    SAO LƯU RA FILE
    Click    css=button:has-text("Sao lưu & khôi phục")
    Wait For Condition    Url    ==    ${BASE_URL}/them/sao-luu
    Wait For Elements State    ${NÚT_SAO_LƯU}    visible
    Chờ Thấy Chữ    Chưa sao lưu lần nào

    Mở Màn    /
    Click    css=a:has-text("Sao lưu ngay")
    Wait For Condition    Url    ==    ${BASE_URL}/them/sao-luu

File sao lưu đã mất đuôi .json (qua Zalo/Drive) vẫn chọn được và tới hộp xác nhận
    [Documentation]    Lỗi cũ: ô chọn file đặt accept="application/json,.json", nên file gửi qua Zalo/Drive
    ...    về máy mang MIME application/octet-stream hoặc mất đuôi bị bộ chọn Android làm mờ — người
    ...    bán không nhập lại được bản sao của chính mình. Nay ô chọn không lọc theo loại; nội dung vẫn
    ...    được parseBackupFile kiểm trước khi chạm DB.
    [Tags]    regression
    Mở Màn    /them/sao-luu
    ${đường_dẫn}=    Sao Lưu Ra File
    ${có_lọc}=    Evaluate JavaScript    ${Ô_CHỌN_FILE}    (input) => input.hasAttribute('accept')
    Should Not Be True    ${có_lọc}    Ô chọn file còn lọc theo loại file.
    ${nội_dung}=    Get File    ${đường_dẫn}
    ${txt}=    Set Variable    ${DOWNLOAD_DIR}/ban-sao-qua-zalo.txt
    Create File    ${txt}    ${nội_dung}
    Bán Nhanh    Trà đá

    Mở Màn    /them/sao-luu
    Chọn File Để Ghi Đè    ${txt}
    Chờ Hộp Xác Nhận    Ghi đè toàn bộ dữ liệu?
    Chờ Thấy Chữ    2 đơn · 4 mặt hàng · 1 khách · 1 khoản chi · 0 giá riêng
    Bỏ Qua Hộp Xác Nhận
    ${đơn}=    Đọc Bảng    orders
    Length Should Be    ${đơn}    3    Huỷ ở hộp xác nhận mà dữ liệu đã bị đụng.
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${txt}

Chọn nhầm file không phải bản sao lưu thì báo rõ và không hỏi tiếp
    ${rác}=    Set Variable    ${DOWNLOAD_DIR}/khong-phai-ban-sao-luu.json
    Create File    ${rác}    day khong phai JSON
    Mở Màn    /them/sao-luu
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${rác}

    Chờ Thấy Chữ    File này không phải file sao lưu
    Wait For Elements State    ${HỘP_XÁC_NHẬN}    detached
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${rác}

Nhập file sao lưu của app khác thì bị chặn ngay
    ${lạ}=    Set Variable    ${DOWNLOAD_DIR}/backup-app-khac.json
    Create File    ${lạ}    {"app":"mot-app-khac","version":1,"data":{}}
    Mở Màn    /them/sao-luu
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${lạ}

    Chờ Thấy Chữ    File sao lưu của ứng dụng khác
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${lạ}

Xoá sạch phải gõ đúng chữ xác nhận
    Mở Màn    /them/cai-dat
    Bấm Nút    Xoá toàn bộ dữ liệu
    Wait For Elements State    ${SHEET_XOÁ}    visible
    Nút Phải Bị Khoá    SAO LƯU RỒI XOÁ

    Điền Ô    Gõ XOA    XO
    Nút Phải Bị Khoá    SAO LƯU RỒI XOÁ

    Điền Ô    Gõ XOA    XOA
    Nút Không Được Khoá    SAO LƯU RỒI XOÁ

Xoá sạch thì tải file an toàn về trước rồi mới xoá
    [Documentation]    Đưa file ra tay người bán **trước** khi xoá là toàn bộ đường về của họ.
    Mở Màn    /them/cai-dat
    ${đường_dẫn}=    Xoá Toàn Bộ Dữ Liệu

    ${nội_dung}=    Get File    ${đường_dẫn}
    ${bản_sao}=    Evaluate    json.loads($nội_dung)    json
    Length Should Be    ${bản_sao}[data][orders]    2    File an toàn phải chứa dữ liệu ngay trước lúc xoá.

    ${đơn}=    Đọc Bảng    orders
    Should Be Empty    ${đơn}
    ${món}=    Đọc Bảng    items
    Should Be Empty    ${món}

Xoá sạch xong thì màn Bán hàng về trạng thái chưa có gì
    Mở Màn    /them/cai-dat
    Xoá Toàn Bộ Dữ Liệu
    Mở Màn    /
    Chờ Thấy Chữ    Chưa có mặt hàng nào

Nhập lại được file an toàn tải về ngay trước lúc xoá
    [Documentation]    Đường về phải đi được thật, không chỉ có file nằm đó. Đây là ca chốt: xoá sạch
    ...    rồi dựng lại toàn bộ sổ sách từ đúng file mà app đã tự đưa cho người bán.
    Mở Màn    /them/cai-dat
    ${đường_dẫn}=    Xoá Toàn Bộ Dữ Liệu

    Nhập File Sao Lưu    ${đường_dẫn}

    ${đơn}=    Đọc Bảng    orders
    Length Should Be    ${đơn}    2
    Mở Màn    /
    Chờ Thấy Chữ    Phở bò đặc biệt

Nút kiểm tra bản mới báo thẳng khi bản đang chạy chưa có chế độ offline
    [Documentation]    Dev server không sinh service worker, nên đây là trạng thái duy nhất Robot lái
    ...    tới được của nút này. Đường có bản mới thật (hai bản build, SW thật) nằm ở
    ...    e2e-recovery/app-update.spec.ts.
    Skip If    $BASE_URL.startswith('https://')    Bản deploy có service worker; ca này chỉ có nghĩa trên dev server.
    Mở Màn    /them/cai-dat
    Click    css=button:has-text("KIỂM TRA BẢN MỚI")
    Chờ Thấy Chữ    Chưa có chế độ offline trên bản này
    Nút Không Được Khoá    KIỂM TRA BẢN MỚI

Máy in: IP sai thì báo lỗi và không ghi vào sổ máy
    [Documentation]    Cấu hình máy in sai còn tệ hơn không có — IN THỬ sẽ treo chờ một IP không tồn
    ...    tại. Nên sai định dạng thì hiện lỗi và KHÔNG lưu localStorage.
    Mở Màn    /them/cai-dat
    Điền Ô    Địa chỉ IP máy in    999.1.1.1
    Click    css=button:text-is("LƯU")
    Chờ Thấy Chữ    không hợp lệ
    ${lưu}=    Evaluate JavaScript    ${None}    () => localStorage.getItem('may-in')
    Should Be Equal    ${lưu}    ${None}    IP sai mà vẫn ghi vào sổ máy.

Máy in: lưu IP đúng thì ghi đúng JSON và còn sau khi tải lại
    [Documentation]    IP hợp lệ → ghi localStorage 'may-in' đúng dạng và điền lại vào ô sau khi reload
    ...    (WebView Android không dọn localStorage như iOS — D3).
    Mở Màn    /them/cai-dat
    Điền Ô    Địa chỉ IP máy in    192.168.1.50
    Điền Ô    Cổng    9100
    Click    css=button:text-is("LƯU")
    Chờ Thấy Chữ    Đã lưu 192.168.1.50:9100
    ${lưu}=    Evaluate JavaScript    ${None}    () => localStorage.getItem('may-in')
    Should Be Equal    ${lưu}    {"host":"192.168.1.50","port":9100}
    Reload
    ${ô}=    Đọc Ô    Địa chỉ IP máy in
    Should Be Equal    ${ô}    192.168.1.50    IP không còn trong ô sau khi tải lại.

Máy in: trên web nút IN THỬ bị khoá và có dòng chú thích chỉ in được trong app
    [Documentation]    Web không mở được TCP nên IN THỬ (đường TCP) phải khoá kể cả khi IP hợp lệ, kèm
    ...    dòng giải thích. Đường in của web là RawBT (pha 3) / 📤 CHIA SẺ.
    Mở Màn    /them/cai-dat
    Điền Ô    Địa chỉ IP máy in    192.168.1.50
    Click    css=button:text-is("LƯU")
    Wait For Elements State    css=button:text-is("IN THỬ")    disabled
    Chờ Thấy Chữ    Chỉ in được trong app Android

Nhận in Bluetooth: trên web nút BẬT NHẬN IN bị khoá kể cả khi lần trước đã bật
    [Documentation]    Server RFCOMM chỉ có trong APK. Web phải khoá nút kèm dòng giải thích, và cờ đã-bật trong
    ...    localStorage (từ APK hay gõ tay) không được làm web thử mở Bluetooth.
    Mở Màn    /them/cai-dat
    Evaluate JavaScript    ${None}    () => localStorage.setItem('nhan-in-bluetooth', '1')
    Reload
    Chờ Thấy Chữ    NHẬN IN QUA BLUETOOTH
    Wait For Elements State    css=button:text-is("BẬT NHẬN IN")    disabled
    Chờ Thấy Chữ    Chỉ nhận in qua Bluetooth trong app Android

Máy in web Android: IN THỬ QUA RAWBT hỏi xác nhận; nút In thử là link rawbt: dựng sẵn, không bấm
    [Documentation]    Web Android in qua RawBT: khối IN QUA RAWBT trên khối IP có link cài RawBT (Play, mở
    ...    tab mới). Bấm IN THỬ QUA RAWBT chỉ MỞ hộp xác nhận (chặn bấm nhầm); nút "In thử" trong hộp là
    ...    <a data-rawbt> ảnh PNG dựng sẵn. KHÔNG Click nút In thử (CI treo ở hộp "mở ứng dụng"). Giải mã ảnh
    ...    tờ mẫu: rộng 576, cao hơn 180 (thước sampleBitmap + phần chữ SampleSheet).
    [Setup]    Mở Phiên Android
    Mở Màn    /them/cai-dat
    Chờ Thấy Chữ    IN QUA RAWBT
    ${play}=    Get Attribute    css=a:has-text("Cài RawBT")    href
    Should Contain    ${play}    ru.a402d.rawbtprinter
    ${target}=    Get Attribute    css=a:has-text("Cài RawBT")    target
    Should Be Equal    ${target}    _blank
    Wait For Elements State    css=button:has-text("IN THỬ QUA RAWBT")    visible    timeout=20s
    Bấm Nút    IN THỬ QUA RAWBT
    Chờ Hộp Xác Nhận    In thử qua RawBT?
    Wait For Elements State    css=a[data-rawbt]    visible    timeout=20s
    ${href}=    Get Attribute    css=a[data-rawbt]    href
    Should Start With    ${href}    rawbt:data:image/png;base64,
    ${đo}=    Evaluate JavaScript    css=a[data-rawbt]
    ...    async (a) => { const r = await fetch(a.getAttribute('href').slice('rawbt:'.length)); const bm = await createImageBitmap(await r.blob()); return { w: bm.width, h: bm.height }; }
    Should Be Equal As Integers    ${đo}[w]    576
    Should Be True    ${đo}[h] > 180

Máy đã có tên đổi được tên và chữ cái từ Cài đặt, mã phiếu mới mang chữ mới
    [Documentation]    Trang tên máy từng chỉ tới được khi máy chưa có tên, và mở bằng URL thì hai ô trống:
    ...    form lấy giá trị đầu lúc `useLiveQuery` còn `undefined`. Ghép máy báo trùng chữ cái mà không có
    ...    đường nào để đổi.
    [Tags]    regression
    Mở Màn    /them/cai-dat
    Click    css=button:has-text("Máy bán hàng")
    Chờ Thấy Chữ    Máy mẫu · chữ A
    Bấm Nút    Đổi tên hoặc chữ cái
    Chờ Thấy Chữ    Tên máy bán hàng
    ${tên}=    Đọc Ô    Tên dễ nhận ra
    ${chữ}=    Đọc Ô    Chữ cái của máy
    Should Be Equal    ${tên}    Máy mẫu    Trang đổi tên mở ra không điền sẵn tên máy đang dùng.
    Should Be Equal    ${chữ}    A    Trang đổi tên mở ra không điền sẵn chữ cái đang dùng.

    Điền Ô    Chữ cái của máy    B
    Bấm Nút    LƯU TÊN MÁY
    Chờ Thấy Chữ    Máy mẫu · chữ B
    ${máy}=    Đọc Bảng    deviceState
    ${danh_tính}=    Evaluate    next(row for row in $máy if row['key'] == 'identity')
    Should Be Equal    ${danh_tính}[letter]    B    Sổ máy chưa ghi chữ cái mới.

    Mở Màn    /
    Chọn Món    Trà đá
    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    Should Match Regexp    ${đơn}[code]    -B\\d{3}$    Đơn mới chưa mang chữ cái mới của máy.

*** Keywords ***
Theo Dõi Yêu Cầu Tải
    Evaluate JavaScript    ${None}
    ...    () => {
    ...        window.__backupDownloadClicks = 0
    ...        const originalClick = HTMLAnchorElement.prototype.click
    ...        HTMLAnchorElement.prototype.click = function() {
    ...            if (this.download) window.__backupDownloadClicks += 1
    ...            return originalClick.call(this)
    ...        }
    ...    }

Số Yêu Cầu Tải
    ${số_tải}=    Evaluate JavaScript    ${None}    () => window.__backupDownloadClicks ?? 0
    RETURN    ${số_tải}

Giả Lập Chia Sẻ File
    Evaluate JavaScript    ${None}
    ...    () => {
    ...        window.__sharedBackup = null
    ...        Object.defineProperty(navigator, 'canShare', {
    ...            configurable: true,
    ...            value: (data) => data.files?.length === 1 && data.files[0]?.type === 'application/json',
    ...        })
    ...        Object.defineProperty(navigator, 'share', {
    ...            configurable: true,
    ...            value: async (data) => {
    ...                const file = data.files?.[0]
    ...                if (!file) throw new Error('Thiếu file chia sẻ trong ca Robot.')
    ...                window.__sharedBackup = {
    ...                    name: file.name,
    ...                    type: file.type,
    ...                    text: await file.text(),
    ...                }
    ...            },
    ...        })
    ...    }

Đọc Bản Sao Đã Chia Sẻ
    ${đã_chia_sẻ}=    Evaluate JavaScript    ${None}    () => window.__sharedBackup
    Should Not Be Equal    ${đã_chia_sẻ}    ${None}    Native share stub chưa nhận được file.
    RETURN    ${đã_chia_sẻ}

Focus Phải Ở Nút
    [Arguments]    ${nhãn}
    ${focus}=    Evaluate JavaScript    ${None}    () => document.activeElement?.textContent?.trim() ?? ''
    Should Be Equal    ${focus}    ${nhãn}

Sao Lưu Ra File
    [Documentation]    Trả về đường dẫn thật của file vừa rơi xuống máy. Không tự đặt tên file: mỗi
    ...    test có context riêng nên Playwright cất vào một chỗ riêng, khỏi lo hai test giẫm tên nhau.
    ${hứa}=    Promise To Wait For Download
    Click    ${NÚT_SAO_LƯU}
    ${tải}=    Wait For    ${hứa}
    RETURN    ${tải}[saveAs]

Xoá Toàn Bộ Dữ Liệu
    [Documentation]    Đi hết đường xoá sạch và trả về đường dẫn file an toàn app tự tải về.
    Bấm Nút    Xoá toàn bộ dữ liệu
    Điền Ô    Gõ XOA    XOA
    ${hứa}=    Promise To Wait For Download
    Bấm Nút    SAO LƯU RỒI XOÁ
    ${tải}=    Wait For    ${hứa}

    Chờ Hộp Xác Nhận    Đã thấy file trong máy chưa?
    Đánh Dấu Trang Hiện Tại
    Xác Nhận Trong Hộp    Đã thấy — xoá tất cả
    Chờ Nạp Lại Xong
    RETURN    ${tải}[saveAs]

Chọn File Để Ghi Đè
    [Documentation]    Chọn file rồi chọn chế độ Ghi đè ở hộp "Khôi phục từ file".
    [Arguments]    ${đường_dẫn}
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${đường_dẫn}
    Wait For Elements State    ${SHEET_CHẾ_ĐỘ}    visible
    Click    ${SHEET_CHẾ_ĐỘ} >> css=button:text-is("Ghi đè")

Mở Xem Trước Gộp
    [Arguments]    ${đường_dẫn}
    Mở Màn    /them/sao-luu
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${đường_dẫn}
    Wait For Elements State    ${SHEET_CHẾ_ĐỘ}    visible
    Click    ${SHEET_CHẾ_ĐỘ} >> css=button:text-is("Gộp vào sổ trên máy")
    Wait For Elements State    ${SHEET_GỘP}    visible

Chọn Cho Xung Đột
    [Arguments]    ${gid}    ${nhãn}
    Click    css=[data-conflict-gid="${gid}"] >> text=${nhãn}

Bấm Gộp Qua Cửa File An Toàn
    [Documentation]    Trên web bấm GỘP thì app tải file an toàn của sổ hiện tại rồi dừng ở cửa "Đã thấy file an
    ...    toàn". Chờ cú tải xong và đọc được JSON trên đĩa TRƯỚC khi bấm tiếp: gộp xong trang tự tải lại, cú tải
    ...    chưa xong lúc đó là mất file. Trả về nội dung file an toàn.
    ${hứa}=    Promise To Wait For Download
    Click    ${NÚT_GỘP}
    ${tải}=    Wait For    ${hứa}
    Chờ Hộp Xác Nhận    Đã thấy file an toàn trong Tải về?
    ${nội_dung}=    Get File    ${tải}[saveAs]
    ${an_toàn}=    Evaluate    json.loads($nội_dung)    json
    RETURN    ${an_toàn}

Xác Nhận Gộp
    Đánh Dấu Trang Hiện Tại
    Xác Nhận Trong Hộp    Đã thấy — gộp
    Chờ Nạp Lại Xong
    Chờ Thấy Chữ    Khôi phục khớp

Gộp Với Một Lựa Chọn
    [Documentation]    Gộp file có đúng một xung đột khoản thu, trả lời nó, đi hết cửa file an toàn.
    [Arguments]    ${đường_dẫn}    ${gid}    ${nhãn}
    Mở Xem Trước Gộp    ${đường_dẫn}
    Wait For Elements State    ${NÚT_GỘP}    disabled
    Chọn Cho Xung Đột    ${gid}    ${nhãn}
    Bấm Gộp Qua Cửa File An Toàn
    Xác Nhận Gộp

Bán Có Thu Tiền Cho Anh Hùng
    [Documentation]    Bán món cho Anh Hùng trả đủ tiền mặt; trả về đơn vừa bán.
    [Arguments]    ${món}
    Mở Màn    /
    Chọn Món    ${món}
    Click    ${NÚT_KHÁCH_TRÊN_ĐẦU}
    Chọn Khách Trong Sheet    Anh Hùng
    Mở Sheet Thu Tiền
    Chốt Đơn
    ${đơn}=    Đơn Mới Nhất
    RETURN    ${đơn}

Huỷ Đơn Đang Mở
    [Arguments]    ${đơn}
    Mở Màn    /don/${đơn}[id]
    Chờ Thấy Chữ    MẶT HÀNG
    Bấm Nút    Huỷ đơn
    Chờ Hộp Xác Nhận    Huỷ đơn này?
    Xác Nhận Trong Hộp    Huỷ đơn
    Chờ Thấy Chữ    Đơn này đã huỷ

Dựng Khoản Thu Chưa Trừ Của Anh Hùng
    [Documentation]    App không có trả trước hay thu dư: khoản thu chưa trừ đơn nào của một khách có tên chỉ sinh
    ...    ra khi huỷ một đơn đã thu tiền. Bán món cho Anh Hùng trả tiền mặt rồi huỷ đơn; Anh Hùng vẫn nợ đơn
    ...    mẫu 100.000 đ nên tín dụng trừ nợ thấy được. Trả về dòng payments.
    [Arguments]    ${món}
    ${đơn}=    Bán Có Thu Tiền Cho Anh Hùng    ${món}
    Huỷ Đơn Đang Mở    ${đơn}
    ${phiếu}=    Đọc Bảng    payments
    ${của_đơn}=    Evaluate    [p for p in $phiếu if p['orderId'] == ${đơn}[id]]
    Length Should Be    ${của_đơn}    1
    Should Be Equal As Integers    ${của_đơn}[0][allocatedOrderId]    0
    RETURN    ${của_đơn}[0]

Mã Anh Hùng
    ${khách}=    Đọc Bảng    customers
    ${id}=    Evaluate    next(c['id'] for c in $khách if c['name'] == 'Anh Hùng')
    RETURN    ${id}

Xử Lý Khoản Thu Của Anh Hùng
    [Documentation]    Trên trang khách: "Đã trả lại khách" / "Bỏ có ghi vết" / "Gắn đơn còn nợ" cho đúng khoản
    ...    (tìm theo số tiền), rồi chờ sổ ghi xong.
    [Arguments]    ${khoản}    ${nút}    ${xác_nhận}
    ${id}=    Mã Anh Hùng
    Mở Màn    /them/khach-hang/${id}
    Chờ Thấy Chữ    Lịch sử thu tiền
    ${tiền}=    Dinh Dang Vnd    ${khoản}[amount]
    Click    xpath=//li[.//span[normalize-space()="${tiền}"]]//button[normalize-space()="${nút}"]
    Wait For Elements State    ${HỘP_XÁC_NHẬN}    visible
    Xác Nhận Trong Hộp    ${xác_nhận}
    Wait Until Keyword Succeeds    30x    200ms    Khoản Thu Phải Đã Đổi    ${khoản}

Khoản Thu Phải Đã Đổi
    [Arguments]    ${khoản}
    ${dòng}=    Khoản Thu Theo Gid    ${khoản}[gid]
    ${trước}=    Evaluate    ($khoản.get('unallocatedStatus', 'pending'), $khoản['allocatedOrderId'])
    ${sau}=    Evaluate    ($dòng.get('unallocatedStatus', 'pending'), $dòng['allocatedOrderId'])
    Should Not Be Equal    ${sau}    ${trước}

Khoản Thu Theo Gid
    [Arguments]    ${gid}
    ${phiếu}=    Đọc Bảng    payments
    ${dòng}=    Evaluate    next(p for p in $phiếu if p['gid'] == '${gid}')
    RETURN    ${dòng}

Mặt Hàng Theo Gid Không Còn
    [Arguments]    ${gid}
    ${món}=    Đọc Bảng    items
    ${còn}=    Evaluate    [i for i in $món if i['gid'] == '${gid}']
    Should Be Empty    ${còn}

Giá Món Phải Là
    [Arguments]    ${gid}    ${giá}
    ${món}=    Đọc Bảng    items
    ${dòng}=    Evaluate    next(i for i in $món if i['gid'] == '${gid}')
    Should Be Equal As Integers    ${dòng}[unitPrice]    ${giá}

Xoá Mặt Hàng Chưa Bán
    [Arguments]    ${món}
    Mở Màn    /them/mat-hang/${món}[id]
    Bấm Nút    Xoá hẳn
    Chờ Hộp Xác Nhận    Xoá mặt hàng?
    Xác Nhận Trong Hộp    Xoá
    Wait Until Keyword Succeeds    30x    200ms    Mặt Hàng Theo Gid Không Còn    ${món}[gid]

Nợ Anh Hùng Từ Sổ
    [Documentation]    Nợ tính thẳng từ Đọc Bảng orders + payments (robot/libraries/so_no.py), không tin màn.
    ${orders}=    Đọc Bảng    orders
    ${payments}=    Đọc Bảng    payments
    ${id}=    Mã Anh Hùng
    ${nợ}=    No Cua Khach    ${orders}    ${payments}    ${id}
    RETURN    ${nợ}

Sổ Chín Bảng
    ${sổ}=    Create Dictionary
    FOR    ${bảng}    IN    itemGroups    items    customers    customerPrices    orders    orderLines    payments
    ...    expenseCategories    expenses
        ${dòng}=    Đọc Bảng    ${bảng}
        Set To Dictionary    ${sổ}    ${bảng}=${dòng}
    END
    RETURN    ${sổ}

Nhập File Sao Lưu
    [Arguments]    ${đường_dẫn}
    Mở Màn    /them/sao-luu
    Chọn File Để Ghi Đè    ${đường_dẫn}
    Chờ Hộp Xác Nhận    Ghi đè toàn bộ dữ liệu?
    # Cửa an toàn cũng tải một file nữa về — nuốt cú tải đó để nó không lẫn vào phép chờ sau.
    ${hứa}=    Promise To Wait For Download
    Xác Nhận Trong Hộp    Tải file an toàn
    Wait For    ${hứa}

    Chờ Hộp Xác Nhận    Đã thấy file trong máy chưa?
    Đánh Dấu Trang Hiện Tại
    Xác Nhận Trong Hộp    Đã thấy — ghi đè
    Chờ Nạp Lại Xong

Đánh Dấu Trang Hiện Tại
    Evaluate JavaScript    ${None}    () => { window.__truocKhiNapLai = true }

Chờ Nạp Lại Xong
    [Documentation]    Cả nhập lẫn xoá đều kết thúc bằng `window.location.reload()`, mà cú nạp lại đó
    ...    commit chậm hơn nhịp render cuối — chờ theo DOM thì nút cũ của trang **cũ** vẫn đang hiện
    ...    và phép chờ qua sớm, để rồi lệnh kế tiếp chết giữa lúc trang đổi. Dấu mốc đặt trên `window`
    ...    là thứ duy nhất chắc chắn biến mất cùng document cũ.
    Wait Until Keyword Succeeds    30x    500ms    Trang Phải Là Trang Mới
    Wait For Elements State    css=header h1    visible

Trang Phải Là Trang Mới
    ${còn_dấu}=    Evaluate JavaScript    ${None}    () => window.__truocKhiNapLai === true
    Should Not Be True    ${còn_dấu}    Trang chưa nạp lại xong.

Nút Không Được Khoá
    [Arguments]    ${nhãn}
    Wait For Elements State    css=button:has-text("${nhãn}")    enabled
