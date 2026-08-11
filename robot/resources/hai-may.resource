*** Settings ***
Documentation    Hạ tầng hai máy thật: hai Browser Context có IndexedDB tách biệt, cùng ghép vào
...              một Durable Object cục bộ. Mã ghép và token không bao giờ được trả ra log.
Resource         app.resource
Resource         sales.resource
Library          Collections

*** Variables ***
${WORKER_URL}       http://127.0.0.1:8787
${MÃ_GHÉP_INPUT}    xpath=//label[normalize-space()="Mã ghép máy"]/following::input[1]

*** Keywords ***
Mở Hai Máy Đã Ghép
    [Documentation]    Dựng quán thật qua Worker, ghép A bằng bootstrap rồi ghép B bằng mã do A tạo.
    ${context_a}=    New Context    viewport=${VIEWPORT}    acceptDownloads=${True}
    ${page_a}=    New Page    ${BASE_URL}/ghep-may
    Set Test Variable    ${MÁY_A_CONTEXT}    ${context_a}
    Set Test Variable    ${MÁY_A_PAGE}    ${page_a}
    Đặt Tên Máy Hiện Tại    Quầy A    A

    ${mức_log}=    Set Log Level    NONE
    TRY
        Environment Variable Should Be Set    ROBOT_WORKER_ADMIN_SECRET
        ${bootstrap_code}=    Evaluate JavaScript    ${None}
        ...    async (adminSecret) => {
        ...        const response = await fetch('${WORKER_URL}/shop', {
        ...            method: 'POST',
        ...            headers: {
        ...                authorization: ['Bearer', adminSecret].join(' '),
        ...            },
        ...        })
        ...        if (!response.ok) throw new Error('Không tạo được quán thử: ' + response.status)
        ...        return (await response.json()).code
        ...    }
        ...    arg=%{ROBOT_WORKER_ADMIN_SECRET}
        Set Test Variable    ${BOOTSTRAP_CODE}    ${bootstrap_code}
    FINALLY
        Set Log Level    ${mức_log}
    END
    ${failure_keyword}=    Register Keyword To Run On Failure    NONE
    TRY
        Fill Secret    ${MÃ_GHÉP_INPUT}    $BOOTSTRAP_CODE
        Bấm Nút    GHÉP MÁY NÀY
        Wait For Elements State    css=button:has-text("TẠO MÃ GHÉP")    visible    timeout=30s
    FINALLY
        Register Keyword To Run On Failure    ${failure_keyword}
    END

    ${failure_keyword}=    Register Keyword To Run On Failure    NONE
    TRY
        Bấm Nút    TẠO MÃ GHÉP
        Wait For Elements State    css=p.font-mono    visible
        ${mức_log}=    Set Log Level    NONE
        ${pair_code}=    Get Text    css=p.font-mono
        Set Test Variable    ${PAIR_CODE}    ${pair_code}
        Set Log Level    ${mức_log}

        ${context_b}=    New Context    viewport=${VIEWPORT}    acceptDownloads=${True}
        ${page_b}=    New Page    ${BASE_URL}/ghep-may
        Set Test Variable    ${MÁY_B_CONTEXT}    ${context_b}
        Set Test Variable    ${MÁY_B_PAGE}    ${page_b}
        Đặt Tên Máy Hiện Tại    Quầy B    B
        Fill Secret    ${MÃ_GHÉP_INPUT}    $PAIR_CODE
        Bấm Nút    GHÉP MÁY NÀY
        Wait For Elements State    css=button:has-text("TẠO MÃ GHÉP")    visible    timeout=30s
    FINALLY
        Set Log Level    ${mức_log}
        Register Keyword To Run On Failure    ${failure_keyword}
    END

    Chọn Máy A
    Nạp Dữ Liệu Mẫu
    Wait Until Keyword Succeeds    80x    500ms    Hàng Đợi Máy Phải Rỗng    ${MÁY_A_PAGE}
    Wait Until Keyword Succeeds    80x    500ms    Bảng Máy Phải Có Số Dòng
    ...    items    4    ${MÁY_B_PAGE}

Đặt Tên Máy Hiện Tại
    [Arguments]    ${tên}    ${chữ}
    Chờ Thấy Chữ    Chưa đặt tên máy
    Bấm Nút    ĐẶT TÊN MÁY
    Điền Ô    Tên dễ nhận ra    ${tên}
    Điền Ô    Chữ cái của máy    ${chữ}
    Bấm Nút    LƯU TÊN MÁY
    Chờ Thấy Chữ    ${tên} · chữ ${chữ}

Đóng Hai Máy
    Close Context    ALL    ALL

Chọn Máy A
    Switch Page    ${MÁY_A_PAGE}    context=ALL    browser=ALL

Chọn Máy B
    Switch Page    ${MÁY_B_PAGE}    context=ALL    browser=ALL

Mở Màn Trên Máy
    [Arguments]    ${page}    ${đường_dẫn}
    Switch Page    ${page}    context=ALL    browser=ALL
    Go To    ${BASE_URL}${đường_dẫn}

Bảng Máy Phải Có Số Dòng
    [Arguments]    ${bảng}    ${số_dòng}    ${page}
    ${rows}=    Đọc Bảng    ${bảng}    ${page}
    Length Should Be    ${rows}    ${số_dòng}    Bảng ${bảng} trên máy chưa hội tụ đúng số dòng.

Hàng Đợi Máy Phải Rỗng
    [Arguments]    ${page}
    ${rows}=    Đọc Bảng    outbox    ${page}
    Should Be Empty    ${rows}    Máy vẫn còn thao tác chưa lên sổ chung.

Hai Bảng Phải Cùng Gid Và Nội Dung
    [Arguments]    ${bảng}
    ${a}=    Đọc Bảng    ${bảng}    ${MÁY_A_PAGE}
    ${b}=    Đọc Bảng    ${bảng}    ${MÁY_B_PAGE}
    # `createdAt`/`updatedAt` là metadata hook của bản sao Dexie và có thể lệch vài mili giây giữa
    # máy tạo với máy apply. `soldAt`/`paidAt`/`spentAt` vẫn được so vì đó là thời gian nghiệp vụ do
    # Worker đóng dấu.
    ${a_sạch}=    Evaluate    sorted([{k: v for k, v in row.items() if k not in ('id', 'createdAt', 'updatedAt')} for row in $a], key=lambda row: str(row.get('gid', row.get('key'))))
    ${b_sạch}=    Evaluate    sorted([{k: v for k, v in row.items() if k not in ('id', 'createdAt', 'updatedAt')} for row in $b], key=lambda row: str(row.get('gid', row.get('key'))))
    Should Be Equal    ${a_sạch}    ${b_sạch}    Bảng ${bảng} của hai máy chưa giống nhau.

Làm Hỏng Quan Hệ Của Event Mặt Hàng
    [Documentation]    Chỉ dùng trong ca từ chối: sửa event pending, không sửa dòng nghiệp vụ.
    [Arguments]    ${tên_món}
    Evaluate JavaScript    ${None}
    ...    async (name) => {
    ...        const db = await new Promise((resolve, reject) => {
    ...            const request = indexedDB.open('my-biller')
    ...            request.onsuccess = () => resolve(request.result)
    ...            request.onerror = () => reject(request.error)
    ...        })
    ...        await new Promise((resolve, reject) => {
    ...            const tx = db.transaction('outbox', 'readwrite')
    ...            const store = tx.objectStore('outbox')
    ...            const all = store.getAll()
    ...            all.onsuccess = () => {
    ...                const row = [...all.result].reverse().find(
    ...                    (candidate) => candidate.table === 'items' && candidate.after?.name === name,
    ...                )
    ...                if (!row) return reject(new Error('Không thấy event pending cho ' + name))
    ...                row.refs = { ...row.refs, groupId: '00000000-0000-4000-8000-000000000099' }
    ...                store.put(row)
    ...            }
    ...            tx.oncomplete = () => resolve()
    ...            tx.onerror = () => reject(tx.error)
    ...            tx.onabort = () => reject(tx.error)
    ...        })
    ...        db.close()
    ...    }
    ...    arg=${tên_món}

Mặt Hàng Không Được Tồn Tại
    [Arguments]    ${tên_món}    ${page}
    ${items}=    Đọc Bảng    items    ${page}
    ${found}=    Evaluate    [row for row in $items if row['name'] == $tên_món]
    Should Be Empty    ${found}    Mặt hàng bị từ chối vẫn còn trong bản sao đọc.

Giá Mặt Hàng Phải Là
    [Arguments]    ${tên_món}    ${giá}    ${page}
    ${items}=    Đọc Bảng    items    ${page}
    ${found}=    Evaluate    [row for row in $items if row['name'] == $tên_món]
    Length Should Be    ${found}    1
    Should Be Equal As Integers    ${found}[0][unitPrice]    ${giá}

Epoch Máy Phải Từ
    [Arguments]    ${page}    ${epoch_tối_thiểu}
    ${state}=    Đọc Bảng    deviceState    ${page}
    ${lease}=    Evaluate    [row for row in $state if row['key'] == 'lease']
    Length Should Be    ${lease}    1    Chưa có tab nào giữ lease đồng bộ.
    Should Be True    ${lease}[0][epoch] >= ${epoch_tối_thiểu}

Cho Lease Hiện Tại Hết Hạn
    [Documentation]    Giả lập đúng trạng thái bền vững mà một tab treo để lại: owner cũ vẫn còn,
    ...    nhưng lease đã quá hạn. Tab cũ vẫn mở để kiểm nó không giành lại epoch sau đó.
    Evaluate JavaScript    ${None}
    ...    async () => {
    ...        const db = await new Promise((resolve, reject) => {
    ...            const request = indexedDB.open('my-biller')
    ...            request.onsuccess = () => resolve(request.result)
    ...            request.onerror = () => reject(request.error)
    ...        })
    ...        await new Promise((resolve, reject) => {
    ...            const tx = db.transaction('deviceState', 'readwrite')
    ...            const store = tx.objectStore('deviceState')
    ...            const get = store.get('lease')
    ...            get.onsuccess = () => store.put({ ...get.result, expiresAt: 0 })
    ...            tx.oncomplete = () => resolve()
    ...            tx.onerror = () => reject(tx.error)
    ...        })
    ...        db.close()
    ...    }

Đánh Thức Runner Hiện Tại
    Evaluate JavaScript    ${None}    () => window.dispatchEvent(new Event('online'))
