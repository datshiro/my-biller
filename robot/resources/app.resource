*** Settings ***
Documentation    Nền chung cho mọi suite: mở trình duyệt, dựng phiên sạch, nạp dữ liệu mẫu,
...              và các locator dùng lại ở nhiều màn.
...
...              Mỗi test chạy trong một `New Context` riêng — context của Playwright là một hồ sơ
...              trình duyệt trắng, nên IndexedDB rỗng và không test nào ăn dữ liệu của test khác.
Library          Browser    enable_playwright_debug=disabled    jsextension=${CURDIR}/../libraries/gia-lap-apk.cjs
Library          OperatingSystem
Library          Collections

*** Variables ***
${BASE_URL}         http://localhost:5175
${HEADLESS}         True
# Độ trễ chèn vào mỗi thao tác Playwright. 0s cho CI; `ROBOT_HEADED=1` của run.sh nâng lên để mắt theo kịp.
${SLOW_MO}          0s
# Bề ngang máy Android phổ thông. Ca 320px đã có bộ Playwright lo, ở đây kiểm luồng nghiệp vụ.
&{VIEWPORT}         width=390    height=844
${DOWNLOAD_DIR}     ${CURDIR}/../downloads
# UA Android để `isAndroidWeb()` bật (hiện nút/khối RawBT). Chrome desktop mặc định không có "Android".
${UA_ANDROID}       Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36

# --- Locator dùng chung -------------------------------------------------------------------
${NAV_BAN}          css=nav a:has-text("Bán")
${NAV_DON}          css=nav a:has-text("Đơn")
${NAV_CHI_PHI}      css=nav a:has-text("Chi phí")
${NAV_BAO_CAO}      css=nav a:has-text("Báo cáo")
${NAV_THEM}         css=nav a:has-text("Thêm")
${LƯỚI_MẶT_HÀNG}    css=[aria-label="Mặt hàng"]
${NÚT_THU_TIỀN}     css=button:has-text("THU TIỀN")
${SHEET}            css=[role=dialog]
${HỘP_XÁC_NHẬN}     css=[role=alertdialog]

*** Keywords ***
# --- Vòng đời -----------------------------------------------------------------------------

Mở Trình Duyệt Cho Suite
    [Documentation]    Chrome thật của máy, đúng thứ người bán chạy — không phải bản chromium đóng gói.
    New Browser    chromium    headless=${HEADLESS}    channel=chrome    slowMo=${SLOW_MO}
    Set Browser Timeout    15s

Đóng Trình Duyệt Cuối Suite
    Close Browser    ALL

Mở Phiên Sạch
    [Documentation]    Context mới = IndexedDB rỗng. Dùng làm Test Setup khi test tự dựng dữ liệu.
    New Context    viewport=${VIEWPORT}    acceptDownloads=${True}
    New Page    ${BASE_URL}/

Mở Phiên Có Dữ Liệu Mẫu
    [Documentation]    Phiên sạch rồi nạp bộ mẫu: 4 mặt hàng, 1 khách, 2 đơn, 1 khoản chi.
    Mở Phiên Sạch
    Nạp Dữ Liệu Mẫu

Mở Phiên Android
    [Documentation]    Như `Mở Phiên Sạch` nhưng UA Android → `isAndroidWeb()` bật, hiện nút/khối RawBT.
    ...    Ca dùng phiên này chỉ ĐỌC href `rawbt:`, KHÔNG bao giờ Click (CI không có handler `rawbt:`,
    ...    Chrome treo ở hộp "mở ứng dụng").
    New Context    viewport=${VIEWPORT}    acceptDownloads=${True}    userAgent=${UA_ANDROID}
    New Page    ${BASE_URL}/

Mở Phiên Android Có Dữ Liệu Mẫu
    [Documentation]    Phiên Android rồi nạp bộ mẫu — cho ca RawBT cần bán từ mặt hàng mẫu.
    Mở Phiên Android
    Nạp Dữ Liệu Mẫu

Mở Phiên APK Giả Có Dữ Liệu Mẫu
    [Documentation]    Chrome thật đóng vai APK: init script `gia-lap-apk.cjs` cài cầu nối Capacitor giả TRƯỚC
    ...    khi app nạp, nên `isNativeApp()` bật và nút chỉ-có-trong-APK hiện ra. Job in bị giữ lại ở
    ...    `window.__printJobs` thay vì mở socket — đường TCP thật vẫn chỉ đo được trên máy thật.
    New Context    viewport=${VIEWPORT}    acceptDownloads=${True}
    Gia Lap Apk
    New Page    ${BASE_URL}/
    Nạp Dữ Liệu Mẫu

Đóng Phiên
    Close Context

Nạp Dữ Liệu Mẫu
    [Documentation]    Nút chỉ hiện ở bản dev — đó là lý do bộ test này chạy trên `vite`, không phải bản build.
    Go To    ${BASE_URL}/them
    ${nút}=    Set Variable    css=button:has-text("Nạp dữ liệu mẫu")
    Wait For Elements State    ${nút}    visible
    Click    ${nút}
    # Mặt hàng được ghi trước khách, đơn và chi phí. Chờ đủ cả bộ thay vì chỉ nhìn "4 món", nếu không
    # runner nhanh có thể bắt đầu test trong lúc seed vẫn đang ghi những bảng còn lại.
    Wait Until Keyword Succeeds    30x    500ms    Bộ Dữ Liệu Mẫu Phải Sẵn Sàng
    Chờ Thấy Chữ    4 món

Bộ Dữ Liệu Mẫu Phải Sẵn Sàng
    [Documentation]    Đối chiếu mốc hoàn tất trong IndexedDB thật; mọi bảng đều có số bản ghi cố định.
    [Arguments]    ${page}=${None}
    ${mặt_hàng}=    Đọc Bảng    items    ${page}
    Length Should Be    ${mặt_hàng}    4    Bộ mẫu chưa ghi đủ mặt hàng.
    ${khách_hàng}=    Đọc Bảng    customers    ${page}
    Length Should Be    ${khách_hàng}    1    Bộ mẫu chưa ghi đủ khách hàng.
    ${đơn_hàng}=    Đọc Bảng    orders    ${page}
    Length Should Be    ${đơn_hàng}    2    Bộ mẫu chưa ghi đủ đơn hàng.
    ${chi_phí}=    Đọc Bảng    expenses    ${page}
    Length Should Be    ${chi_phí}    1    Bộ mẫu chưa ghi đủ chi phí.

# --- Điều hướng ---------------------------------------------------------------------------

Mở Màn
    [Documentation]    Đi thẳng bằng URL. Dùng khi test không quan tâm đường đi, chỉ cần đứng đúng màn.
    [Arguments]    ${đường_dẫn}
    Go To    ${BASE_URL}${đường_dẫn}

Chờ Thấy Chữ
    [Documentation]    Bộ `text=` khớp phần tử **nhỏ nhất** chứa chữ, không như `:has-text` vốn khớp
    ...    cả tổ tiên lên tới <html> và làm Playwright báo vi phạm strict mode. Không đặt chữ trong
    ...    nháy kép: có nháy là khớp tuyệt đối, mà câu trên giao diện thường còn dấu chấm hoặc nút
    ...    nằm cùng thẻ. `nth=0` để một chữ xuất hiện hai chỗ vẫn không làm hỏng phép chờ.
    [Arguments]    ${chữ}
    Wait For Elements State    text=${chữ} >> nth=0    visible

Không Được Thấy Chữ
    [Arguments]    ${chữ}
    Wait For Elements State    text=${chữ} >> nth=0    detached

# --- Ô nhập -------------------------------------------------------------------------------
# `TextField`/`MoneyInput` sinh id bằng `useId()` nên id đổi mỗi lần render — bám theo nhãn thay vì id.

Ô Theo Nhãn
    [Arguments]    ${nhãn}
    RETURN    xpath=//label[normalize-space()="${nhãn}"]/following::input[1]

Điền Ô
    [Arguments]    ${nhãn}    ${giá_trị}
    Fill Text    ${{ 'xpath=//label[normalize-space()="%s"]/following::input[1]' % $nhãn }}    ${giá_trị}

Đọc Ô
    [Documentation]    Chữ đang nằm trong ô — `Get Text` đọc textContent nên với <input> phải lấy property.
    [Arguments]    ${nhãn}
    ${giá_trị}=    Get Property
    ...    ${{ 'xpath=//label[normalize-space()="%s"]/following::input[1]' % $nhãn }}    value
    RETURN    ${giá_trị}

Bấm Nút
    [Arguments]    ${nhãn}
    Click    css=button:has-text("${nhãn}")

Nút Phải Bị Khoá
    [Arguments]    ${nhãn}
    Wait For Elements State    css=button:has-text("${nhãn}")    disabled

Tải File Bằng Nút
    [Documentation]    Bấm một nút tải rồi trả đường dẫn thật của file rơi xuống máy. Mẫu như
    ...    `Sao Lưu Ra File` của sao-luu.robot — mỗi context có chỗ cất riêng nên không tự đặt tên.
    [Arguments]    ${nhãn}
    ${hứa}=    Promise To Wait For Download
    Click    css=button:has-text("${nhãn}")
    ${tải}=    Wait For    ${hứa}
    RETURN    ${tải}[saveAs]

# --- Chip chọn ----------------------------------------------------------------------------
# `SelectChip` là nút duy nhất mang `aria-pressed`, nên bám theo đó là tách được khỏi các dòng
# danh sách vốn cũng chứa cùng chữ (tên loại chi hiện lại ở phụ đề từng dòng).

Chọn Chip
    [Arguments]    ${nhãn}
    Click    ${{ 'css=button[aria-pressed]:text-is("%s")' % $nhãn }}

Chip Đang Chọn
    [Arguments]    ${nhãn}
    ${trạng_thái}=    Get Attribute
    ...    ${{ 'css=button[aria-pressed]:text-is("%s")' % $nhãn }}    aria-pressed
    RETURN    ${trạng_thái}

# --- Hộp xác nhận -------------------------------------------------------------------------
# Nút trong hộp thường trùng chữ với nút đã mở ra chính nó ("Huỷ đơn", "Xoá"), nên luôn phải
# thu hẹp vào trong `[role=alertdialog]` rồi mới bấm.

Chờ Hộp Xác Nhận
    [Arguments]    ${tiêu_đề}
    Wait For Elements State    ${{ 'css=[role=alertdialog][aria-label="%s"]' % $tiêu_đề }}    visible

Xác Nhận Trong Hộp
    [Arguments]    ${nhãn}
    Click    ${HỘP_XÁC_NHẬN} >> css=button:has-text("${nhãn}")

Bỏ Qua Hộp Xác Nhận
    Click    ${HỘP_XÁC_NHẬN} >> css=button:text-is("Huỷ")

# --- Đọc thẳng IndexedDB ------------------------------------------------------------------
# Giao diện có thể hiện đúng mà dữ liệu ghi sai (và ngược lại). Vài ca cần soi tận sổ.

Đọc Bảng
    [Documentation]    Toàn bộ bản ghi của một bảng trong IndexedDB thật, dạng list of dict.
    ...    Có thể truyền page của máy khác; keyword trả page về chỗ đang đứng kể cả khi đọc hỏng.
    ...    `Switch Page` trả về page *sau* lượt chuyển chứ không phải page cũ, nên chỗ đang đứng phải
    ...    hỏi bằng `CURRENT` trước khi chuyển đi. `deviceState` luôn che token và deviceId trước khi
    ...    giá trị có cơ hội đi vào output.xml/log.html.
    [Arguments]    ${tên_bảng}    ${page}=${None}
    IF    $page is not None
        ${page_trước}=    Switch Page    CURRENT
        Switch Page    ${page}    context=ALL    browser=ALL
    END
    TRY
        ${rows}=    Evaluate JavaScript    ${None}
        ...    async (store) => {
        ...        const db = await new Promise((resolve, reject) => {
        ...            const open = indexedDB.open('my-biller')
        ...            open.onsuccess = () => resolve(open.result)
        ...            open.onerror = () => reject(open.error)
        ...        })
        ...        const rows = await new Promise((resolve, reject) => {
        ...            const request = db.transaction(store, 'readonly').objectStore(store).getAll()
        ...            request.onsuccess = () => resolve(request.result)
        ...            request.onerror = () => reject(request.error)
        ...        })
        ...        db.close()
        ...        if (store !== 'deviceState') return rows
        ...        return rows.map((row) => {
        ...            const safe = { ...row }
        ...            if ('token' in safe) {
        ...                safe.hasToken = typeof safe.token === 'string' && safe.token.length > 0
        ...                delete safe.token
        ...            }
        ...            delete safe.deviceId
        ...            return safe
        ...        })
        ...    }
        ...    arg=${tên_bảng}
    FINALLY
        IF    $page is not None
            Switch Page    ${page_trước}    context=ALL    browser=ALL
        END
    END
    RETURN    ${rows}

Đơn Mới Nhất
    [Documentation]    Đơn có `id` lớn nhất — đơn vừa lên trong test.
    ${orders}=    Đọc Bảng    orders
    Should Not Be Empty    ${orders}    Chưa có đơn nào trong IndexedDB.
    ${cuối}=    Evaluate    max($orders, key=lambda row: row['id'])
    RETURN    ${cuối}

Mở Chi Tiết Đơn Mới Nhất
    ${đơn}=    Đơn Mới Nhất
    Mở Màn    /don/${đơn}[id]
    Chờ Thấy Chữ    MẶT HÀNG


# --- Đọc con số trên màn ------------------------------------------------------------------

Đọc Ô Số
    [Documentation]    StatBox Báo cáo, khối lãi/lỗ, ô TỔNG NỢ Công nợ và bốn tổng Đối soát đều là
    ...    <span> nhãn rồi <span> số ngay sau nó. Có thể truyền page của máy khác; keyword trả page về
    ...    chỗ đang đứng kể cả khi đọc hỏng — xem ghi chú `Switch Page` ở `Đọc Bảng`.
    [Arguments]    ${nhãn}    ${page}=${None}
    IF    $page is not None
        ${page_trước}=    Switch Page    CURRENT
        Switch Page    ${page}    context=ALL    browser=ALL
    END
    TRY
        ${số}=    Get Text    ${{ 'xpath=//span[normalize-space()="%s"]/following-sibling::span[1]' % $nhãn }}
    FINALLY
        IF    $page is not None
            Switch Page    ${page_trước}    context=ALL    browser=ALL
        END
    END
    RETURN    ${số}

Cài Logo Quán
    [Documentation]    Chọn ảnh mẫu tổng hợp `logo-mau.png` (repo public — không dùng logo thật của quán) ở
    ...    Thông tin cửa hàng. `${vị_trí}` = chữ trên nút vị trí ("Giữa tem"/"Bên phải"/"Góc trên phải") thì
    ...    bật luôn hình chìm; `${mức}` = "Nhạt"/"Vừa"/"Đậm" (không có ở góc trên phải). Lưu xong màn tự lùi — chờ theo URL,
    ...    xem `Xoá Thông Tin Quán`.
    [Arguments]    ${vị_trí}=${None}    ${mức}=${None}
    Mở Màn    /them/cai-dat
    Click    css=button:has-text("Thông tin cửa hàng")
    Upload File By Selector    css=[data-shop-logo-input]    ${CURDIR}/logo-mau.png
    Wait For Elements State    css=[data-shop-logo-preview]    visible
    IF    $vị_trí is not None
        Check Checkbox    css=[data-label-watermark] input[type="checkbox"]
        Click    css=[data-label-watermark] button:text-is("${vị_trí}")
    END
    IF    $mức is not None
        Click    css=[data-label-watermark] button:text-is("${mức}")
    END
    Bấm Nút    LƯU THÔNG TIN
    Wait For Condition    Url    ==    ${BASE_URL}/them/cai-dat

Đọc Logo Quán
    [Documentation]    Đọc thẳng bản ghi `settings/shop` trong IndexedDB nhưng KHÔNG trả chuỗi logo (dài, vô
    ...    nghĩa trong log): chỉ tiền tố có đúng PNG không, độ dài, và cấu hình hình chìm dạng JSON.
    [Arguments]    ${page}=${None}
    IF    $page is not None
        ${page_trước}=    Switch Page    CURRENT
        Switch Page    ${page}    context=ALL    browser=ALL
    END
    TRY
        ${logo}=    Evaluate JavaScript    ${None}
        ...    async () => {
        ...        const db = await new Promise((resolve, reject) => {
        ...            const open = indexedDB.open('my-biller')
        ...            open.onsuccess = () => resolve(open.result)
        ...            open.onerror = () => reject(open.error)
        ...        })
        ...        const row = await new Promise((resolve, reject) => {
        ...            const request = db.transaction('settings', 'readonly').objectStore('settings').get('shop')
        ...            request.onsuccess = () => resolve(request.result)
        ...            request.onerror = () => reject(request.error)
        ...        })
        ...        db.close()
        ...        const logo = row?.value?.logo ?? null
        ...        return {
        ...            png: typeof logo === 'string' && logo.startsWith('data:image/png;base64,'),
        ...            length: typeof logo === 'string' ? logo.length : 0,
        ...            watermark: JSON.stringify(row?.value?.labelWatermark ?? null),
        ...        }
        ...    }
    FINALLY
        IF    $page is not None
            Switch Page    ${page_trước}    context=ALL    browser=ALL
        END
    END
    RETURN    ${logo}
