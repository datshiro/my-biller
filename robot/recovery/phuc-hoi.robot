*** Settings ***
Documentation       Artifact recovery thật trên Chrome: mở schema v5, chỉ đọc và tải backup.
Resource            ../resources/app.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Sạch
Test Teardown       Đóng Phiên
Test Tags           recovery    regression


*** Test Cases ***
Recovery chỉ đọc sổ schema v5 và tải file không tạo outbox
    [Documentation]    Khóa đường cứu dữ liệu sau migration: artifact phải đọc đúng IndexedDB thật,
    ...    không lộ màn bán/sync và file tải không đóng dấu hay sinh event chờ đồng bộ.
    Chờ Thấy Chữ    Phục hồi dữ liệu — chỉ đọc
    ${title}=    Get Title
    Should Be Equal    ${title}    my-biller — Phục hồi chỉ đọc
    Chờ Thấy Chữ    0 đơn · 0 mặt hàng
    Không Được Thấy Chữ    THU TIỀN
    Không Được Thấy Chữ    Kéo lại từ đầu

    Ghi Mặt Hàng Thử Vào Schema V5
    Reload
    Chờ Thấy Chữ    0 đơn · 1 mặt hàng

    ${promise}=    Promise To Wait For Download
    Bấm Nút    TẢI FILE SAO LƯU
    ${download}=    Wait For    ${promise}
    File Should Exist    ${download}[saveAs]
    ${text}=    Get File    ${download}[saveAs]
    ${backup}=    Evaluate    __import__('json').loads($text)
    Should Be Equal    ${backup}[app]    my-biller
    Should Be Equal As Integers    ${backup}[version]    4
    Length Should Be    ${backup}[data][items]    1
    Should Be Equal    ${backup}[data][items][0][name]    Món cần cứu

    ${outbox}=    Đọc Bảng    outbox
    Should Be Empty    ${outbox}
    ${settings}=    Đọc Bảng    settings
    ${mốc}=    Evaluate    [row.get('value', {}).get('lastBackupAt') for row in $settings if row.get('key') == 'app']
    Should Be Empty    ${mốc}

    Mở Màn    /don
    Chờ Thấy Chữ    Phục hồi dữ liệu — chỉ đọc
    Không Được Thấy Chữ    Đơn hàng


*** Keywords ***
Ghi Mặt Hàng Thử Vào Schema V5
    Evaluate JavaScript    ${None}
    ...    async () => {
    ...        const database = await new Promise((resolve, reject) => {
    ...            const open = indexedDB.open('my-biller')
    ...            open.onsuccess = () => resolve(open.result)
    ...            open.onerror = () => reject(open.error)
    ...        })
    ...        if (!database.objectStoreNames.contains('outbox')) {
    ...            database.close()
    ...            throw new Error('Kho chưa ở schema v5: thiếu outbox')
    ...        }
    ...        await new Promise((resolve, reject) => {
    ...            const transaction = database.transaction('items', 'readwrite')
    ...            transaction.objectStore('items').add({
    ...                gid: crypto.randomUUID(),
    ...                name: 'Món cần cứu',
    ...                groupId: null,
    ...                unit: 'phần',
    ...                unitPrice: 45000,
    ...                costPrice: null,
    ...                isActive: 1,
    ...                note: '',
    ...                createdAt: Date.now(),
    ...                updatedAt: Date.now(),
    ...            })
    ...            transaction.oncomplete = () => resolve()
    ...            transaction.onerror = () => reject(transaction.error)
    ...            transaction.onabort = () => reject(transaction.error)
    ...        })
    ...        database.close()
    ...    }
