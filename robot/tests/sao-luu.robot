*** Settings ***
Documentation       Sao lưu, nhập lại và xoá sạch — ba thao tác duy nhất có thể làm mất trắng sổ
...                 sách. Chạy trên trình duyệt thật nên file được tải xuống thật rồi nạp lại thật,
...                 chứ không mô phỏng: chính cú `link.click()` và cú đọc `File` là chỗ hay hỏng.
Resource            ../resources/app.resource
Resource            ../resources/sales.resource
Library             OperatingSystem
Library             Collections
Library             String
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           sao-luu


*** Variables ***
${NÚT_SAO_LƯU}      css=button:has-text("SAO LƯU RA FILE")
${Ô_CHỌN_FILE}      css=input[aria-label="Chọn file sao lưu"]
${SHEET_XOÁ}        css=[role=dialog][aria-label="Xoá toàn bộ dữ liệu"]


*** Test Cases ***
Sao lưu ra file thì file thật nằm trong máy và có đủ dữ liệu
    Mở Màn    /them/cai-dat
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
    Mở Màn    /them/cai-dat
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
    Mở Màn    /them/cai-dat
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

Sao lưu xong thì màn cài đặt ghi lại mốc lần cuối
    Mở Màn    /them/cai-dat
    Chờ Thấy Chữ    Chưa sao lưu lần nào
    Sao Lưu Ra File
    Chờ Thấy Chữ    Đã gửi yêu cầu tải bản sao
    Chờ Thấy Chữ    Lần cuối:

Nhập lại file sao lưu thì sổ quay về đúng lúc sao lưu
    [Documentation]    Vòng tròn đầy đủ: sao lưu → bán thêm → nhập lại. Đơn bán sau lúc sao lưu phải
    ...    biến mất, còn dữ liệu trong file phải về đủ.
    Mở Màn    /them/cai-dat
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
    Mở Màn    /them/cai-dat
    ${đường_dẫn}=    Sao Lưu Ra File

    Upload File By Selector    ${Ô_CHỌN_FILE}    ${đường_dẫn}
    Chờ Hộp Xác Nhận    Ghi đè toàn bộ dữ liệu?
    Chờ Thấy Chữ    2 đơn · 4 mặt hàng · 1 khách · 1 khoản chi · 0 giá riêng
    Xác Nhận Trong Hộp    Tải file an toàn

    Chờ Hộp Xác Nhận    Đã thấy file trong máy chưa?
    Chờ Thấy Chữ    sau bước này dữ liệu đang có trên máy không lấy lại được

Huỷ ở cửa đầu thì chưa đụng gì tới dữ liệu
    Mở Màn    /them/cai-dat
    ${đường_dẫn}=    Sao Lưu Ra File
    Bán Nhanh    Trà đá

    Mở Màn    /them/cai-dat
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${đường_dẫn}
    Chờ Hộp Xác Nhận    Ghi đè toàn bộ dữ liệu?
    Bỏ Qua Hộp Xác Nhận

    ${đơn}=    Đọc Bảng    orders
    Length Should Be    ${đơn}    3    Bấm Huỷ ở cửa đầu mà dữ liệu vẫn bị ghi đè.

Huỷ ở cửa thứ hai thì cũng vẫn chưa ghi đè
    Mở Màn    /them/cai-dat
    ${đường_dẫn}=    Sao Lưu Ra File
    Bán Nhanh    Trà đá

    Mở Màn    /them/cai-dat
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${đường_dẫn}
    Xác Nhận Trong Hộp    Tải file an toàn
    Chờ Hộp Xác Nhận    Đã thấy file trong máy chưa?
    Bỏ Qua Hộp Xác Nhận

    ${đơn}=    Đọc Bảng    orders
    Length Should Be    ${đơn}    3    Bấm Huỷ ở cửa thứ hai mà dữ liệu vẫn bị ghi đè.

Chọn nhầm file không phải bản sao lưu thì báo rõ và không hỏi tiếp
    ${rác}=    Set Variable    ${DOWNLOAD_DIR}/khong-phai-ban-sao-luu.json
    Create File    ${rác}    day khong phai JSON
    Mở Màn    /them/cai-dat
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${rác}

    Chờ Thấy Chữ    File này không phải file sao lưu
    Wait For Elements State    ${HỘP_XÁC_NHẬN}    detached
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${rác}

Nhập file sao lưu của app khác thì bị chặn ngay
    ${lạ}=    Set Variable    ${DOWNLOAD_DIR}/backup-app-khac.json
    Create File    ${lạ}    {"app":"mot-app-khac","version":1,"data":{}}
    Mở Màn    /them/cai-dat
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

Nhập File Sao Lưu
    [Arguments]    ${đường_dẫn}
    Mở Màn    /them/cai-dat
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${đường_dẫn}
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
    Wait For Elements State    ${NÚT_SAO_LƯU}    visible

Trang Phải Là Trang Mới
    ${còn_dấu}=    Evaluate JavaScript    ${None}    () => window.__truocKhiNapLai === true
    Should Not Be True    ${còn_dấu}    Trang chưa nạp lại xong.

Nút Không Được Khoá
    [Arguments]    ${nhãn}
    Wait For Elements State    css=button:has-text("${nhãn}")    enabled
