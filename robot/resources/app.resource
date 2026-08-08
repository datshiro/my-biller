*** Settings ***
Documentation    Nền chung cho mọi suite: mở trình duyệt, dựng phiên sạch, nạp dữ liệu mẫu,
...              và các locator dùng lại ở nhiều màn.
...
...              Mỗi test chạy trong một `New Context` riêng — context của Playwright là một hồ sơ
...              trình duyệt trắng, nên IndexedDB rỗng và không test nào ăn dữ liệu của test khác.
Library          Browser
Library          OperatingSystem
Library          Collections

*** Variables ***
${BASE_URL}         http://localhost:5175
${HEADLESS}         True
# Bề ngang máy Android phổ thông. Ca 320px đã có bộ Playwright lo, ở đây kiểm luồng nghiệp vụ.
&{VIEWPORT}         width=390    height=844
${DOWNLOAD_DIR}     ${CURDIR}/../downloads

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
    New Browser    chromium    headless=${HEADLESS}    channel=chrome
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

Đóng Phiên
    Close Context

Nạp Dữ Liệu Mẫu
    [Documentation]    Nút chỉ hiện ở bản dev — đó là lý do bộ test này chạy trên `vite`, không phải bản build.
    Go To    ${BASE_URL}/them
    ${nút}=    Set Variable    css=button:has-text("Nạp dữ liệu mẫu")
    Wait For Elements State    ${nút}    visible
    Click    ${nút}
    # "4 món" ở dòng Mặt hàng là dấu hiệu bộ mẫu đã nằm trong IndexedDB, không phải chỉ vừa bấm nút.
    Chờ Thấy Chữ    4 món

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
    [Arguments]    ${tên_bảng}
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
    ...        return rows
    ...    }
    ...    arg=${tên_bảng}
    RETURN    ${rows}

Đơn Mới Nhất
    [Documentation]    Đơn có `id` lớn nhất — đơn vừa lên trong test.
    ${orders}=    Đọc Bảng    orders
    Should Not Be Empty    ${orders}    Chưa có đơn nào trong IndexedDB.
    ${cuối}=    Evaluate    max($orders, key=lambda row: row['id'])
    RETURN    ${cuối}
