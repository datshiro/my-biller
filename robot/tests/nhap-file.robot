*** Settings ***
Documentation       Màn Nhập từ file — món, nhóm và khách từ CSV (Excel, Google Sheets). Nhập là
...                 thêm/cập nhật, không bao giờ xoá dữ liệu cũ.
Resource            ../resources/app.resource
Library             OperatingSystem
Library             String
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           nhap-file


*** Variables ***
${Ô_CHỌN_FILE}      css=input[aria-label="Chọn file CSV"]


*** Test Cases ***
Tải được hai file mẫu, có BOM và đúng tiêu đề
    Mở Màn    /them/nhap-file
    ${mon}=    Tải File Bằng Nút    Tải file mẫu
    Chờ Thấy Chữ    Đã yêu cầu tải file mẫu
    ${bytes}=    Get Binary File    ${mon}
    ${đầu}=    Evaluate    list($bytes[:3])
    Should Be Equal    ${đầu}    ${{ [239, 187, 191] }}    File mẫu thiếu BOM (EF BB BF) ở đầu.
    ${văn_bản}=    Get File    ${mon}    encoding=UTF-8-sig
    @{dòng}=    Split To Lines    ${văn_bản}
    Should Be Equal    ${dòng}[0]    Nhóm,Tên món,Đơn vị,Giá bán,Giá vốn,Ghi chú

    Click    css=button:text-is("Khách")
    ${khach}=    Tải File Bằng Nút    Tải file mẫu
    ${văn_bản_khach}=    Get File    ${khach}    encoding=UTF-8-sig
    @{dòng_khach}=    Split To Lines    ${văn_bản_khach}
    Should Be Equal    ${dòng_khach}[0]    Tên,Số điện thoại,Địa chỉ,Ghi chú

Nhập file món lưu từ Excel (BOM, dấu chấm phẩy) ra đúng món, nhóm và giá có dấu
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-excel.csv
    ${nội_dung}=    Catenate    SEPARATOR=\r\n
    ...    Nhóm;Tên món;Đơn vị;Giá bán;Giá vốn;Ghi chú
    ...    Bánh;Bánh mì thịt;Ổ;25.000;;
    ...    Đồ uống;Sinh tố bơ;Ly;35,000;;
    ...    ;Nước suối;Chai;10k;5000;
    Create File    ${f}    ${nội_dung}    encoding=UTF-8-sig
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    3 món mới
    Chờ Thấy Chữ    0 món trùng
    Chờ Thấy Chữ    0 dòng lỗi
    Chờ Thấy Chữ    1 nhóm mới: Bánh
    Bấm Nút    NHẬP 3 MÓN

    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    7
    ${groups}=    Đọc Bảng    itemGroups
    Length Should Be    ${groups}    3
    ${bánh_mì}=    Evaluate    next(i for i in $items if i['name'] == 'Bánh mì thịt')
    Should Be Equal As Numbers    ${bánh_mì}[unitPrice]    25000
    ${nhóm_bánh}=    Evaluate    next(g for g in $groups if g['name'] == 'Bánh')
    Should Be Equal As Numbers    ${bánh_mì}[groupId]    ${nhóm_bánh}[id]
    ${sinh_tố}=    Evaluate    next(i for i in $items if i['name'] == 'Sinh tố bơ')
    Should Be Equal As Numbers    ${sinh_tố}[unitPrice]    35000
    ${nước_suối}=    Evaluate    next(i for i in $items if i['name'] == 'Nước suối')
    Should Be Equal As Numbers    ${nước_suối}[unitPrice]    10000
    Should Be Equal As Numbers    ${nước_suối}[costPrice]    5000
    Should Be Equal    ${nước_suối}[groupId]    ${None}
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

Món trùng tên chọn bỏ qua thì không đổi gì, kể cả nhóm
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-trung-bo-qua.csv
    Create File    ${f}    Nhóm,Tên món,Giá bán\nNước,trà đá,4000
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    0 món mới
    Chờ Thấy Chữ    1 món trùng
    Không Được Thấy Chữ    nhóm mới
    Nút Phải Bị Khoá    NHẬP 0 MÓN
    Click    css=button:text-is("Bỏ qua tất cả món trùng")
    Bấm Nút    NHẬP 0 MÓN

    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    4
    ${trà_đá}=    Evaluate    next(i for i in $items if i['name'] == 'Trà đá')
    Should Be Equal As Numbers    ${trà_đá}[unitPrice]    3000
    ${groups}=    Đọc Bảng    itemGroups
    Length Should Be    ${groups}    2
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

Món trùng tên chọn cập nhật thì đổi giá, không sinh bản ghi mới
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-trung-cap-nhat.csv
    Create File    ${f}    Nhóm,Tên món,Giá bán\nNước,trà đá,4000
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}
    Click    css=button:text-is("Cập nhật tất cả món trùng")
    Chờ Thấy Chữ    1 nhóm mới: Nước
    Bấm Nút    NHẬP 1 MÓN

    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    4
    ${trà_đá}=    Evaluate    next(i for i in $items if i['name'] == 'Trà đá')
    Should Be Equal As Numbers    ${trà_đá}[unitPrice]    4000
    ${groups}=    Đọc Bảng    itemGroups
    ${nhóm_nước}=    Evaluate    next(g for g in $groups if g['name'] == 'Nước')
    Should Be Equal As Numbers    ${trà_đá}[groupId]    ${nhóm_nước}[id]
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

File có dòng lỗi thì xem trước chỉ đúng dòng và không ghi gì
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-loi.csv
    ${nội_dung}=    Catenate    SEPARATOR=\n
    ...    Tên món,Giá bán
    ...    Bánh ít,12000
    ...    ,15000
    ...    Bánh tét,25.5
    ...    Bánh chưng,30000
    Create File    ${f}    ${nội_dung}
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    Dòng 3: thiếu tên món
    Chờ Thấy Chữ    Dòng 4:
    Nút Phải Bị Khoá    NHẬP 2 MÓN
    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    4
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

File lưu kiểu ANSI thì bị từ chối kèm cách lưu lại
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-ansi.csv
    Create File    ${f}    Tên món,Giá bán\nCa phe da,12000    encoding=cp1258
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    CSV UTF-8
    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    4
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

Khách trùng số điện thoại được nhận dù viết khác
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-khach-trung-sdt.csv
    Create File    ${f}    Tên,Số điện thoại,Địa chỉ\nAnh Hùng Mới,0912345678,5 Hai Bà Trưng
    Mở Màn    /them/nhap-file
    Click    css=button:text-is("Khách")
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    1 khách trùng
    Click    css=button:text-is("Cập nhật tất cả khách trùng")
    Bấm Nút    NHẬP 1 KHÁCH

    ${customers}=    Đọc Bảng    customers
    Length Should Be    ${customers}    1
    Should Be Equal    ${customers}[0][name]    Anh Hùng Mới
    Should Be Equal    ${customers}[0][address]    5 Hai Bà Trưng
    Should Be Equal    ${customers}[0][note]    Khách quen, hay ghi sổ
    Should Be Equal    ${customers}[0][phone]    0912 345 678
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

Khách không có số điện thoại được nhận theo tên
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-khach-theo-ten.csv
    Create File    ${f}    Tên,Ghi chú\nANH HÙNG,Mua sỉ
    Mở Màn    /them/nhap-file
    Click    css=button:text-is("Khách")
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}
    Click    css=button:text-is("Cập nhật tất cả khách trùng")
    Bấm Nút    NHẬP 1 KHÁCH

    ${customers}=    Đọc Bảng    customers
    Length Should Be    ${customers}    1
    Should Be Equal    ${customers}[0][note]    Mua sỉ
    Should Be Equal    ${customers}[0][phone]    0912 345 678
    Should Be Equal    ${customers}[0][name]    Anh Hùng
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

Hai dòng cùng trúng một khách thì báo lỗi, không ghi gì
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-khach-xung-dot.csv
    Create File    ${f}    Tên,Số điện thoại,Ghi chú\nAnh Hùng,0912345678,A\nanh hùng,,B
    Mở Màn    /them/nhap-file
    Click    css=button:text-is("Khách")
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    Dòng 3: cùng một khách với dòng 2
    Nút Phải Bị Khoá    NHẬP 0 KHÁCH
    ${customers}=    Đọc Bảng    customers
    Length Should Be    ${customers}    1
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

Nhập một trăm món một lần ra đủ một trăm bản ghi
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-100.csv
    ${dòng}=    Set Variable    Tên món,Giá bán
    FOR    ${i}    IN RANGE    100
        ${dòng}=    Catenate    SEPARATOR=\n    ${dòng}    Món thử ${i},${i}000
    END
    Create File    ${f}    ${dòng}
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}
    Chờ Thấy Chữ    100 món mới
    Bấm Nút    NHẬP 100 MÓN

    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    104
    ${món_57}=    Evaluate    next(i for i in $items if i['name'] == 'Món thử 57')
    Should Be Equal As Numbers    ${món_57}[unitPrice]    57000
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

APK giả: tải file mẫu ghi đúng mimeType CSV kèm charset, nội dung có BOM
    [Documentation]    Khoá hợp đồng của saveToDownloads cho file mẫu: #48 đã xác nhận MediaStore cắt bỏ
    ...    tham số ;charset=utf-8 trước khi gọi hệ thống, nhưng `text` đưa vào vẫn phải có BOM để Excel mở
    ...    đúng tiếng Việt có dấu.
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Mở Màn    /them/nhap-file
    Bấm Nút    Tải file mẫu
    Chờ Thấy Chữ    Đã lưu
    ${đã_lưu}=    Evaluate JavaScript    ${None}    () => window.__savedFiles
    Length Should Be    ${đã_lưu}    1
    Should Be Equal    ${đã_lưu}[0][mimeType]    text/csv;charset=utf-8
    Should Be Equal    ${đã_lưu}[0][filename]    mau-mon.csv
    ${có_bom}=    Evaluate    $đã_lưu[0]['text'].startswith(chr(0xFEFF))
    Should Be True    ${có_bom}    Nội dung mẫu thiếu BOM ở đầu.

APK giả: tải file mẫu khách ghi đúng tên mau-khach.csv kèm charset, nội dung có BOM
    [Setup]    Mở Phiên APK Giả Có Dữ Liệu Mẫu
    Mở Màn    /them/nhap-file
    Click    css=button:text-is("Khách")
    Bấm Nút    Tải file mẫu
    Chờ Thấy Chữ    Đã lưu
    ${đã_lưu}=    Evaluate JavaScript    ${None}    () => window.__savedFiles
    Length Should Be    ${đã_lưu}    1
    Should Be Equal    ${đã_lưu}[0][mimeType]    text/csv;charset=utf-8
    Should Be Equal    ${đã_lưu}[0][filename]    mau-khach.csv
    ${có_bom}=    Evaluate    $đã_lưu[0]['text'].startswith(chr(0xFEFF))
    Should Be True    ${có_bom}    Nội dung mẫu khách thiếu BOM ở đầu.

Bỏ qua tất cả khách trùng thì khách cũ giữ nguyên tên, địa chỉ và ghi chú
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-khach-bo-qua.csv
    Create File    ${f}    Tên,Số điện thoại,Địa chỉ,Ghi chú\nAnh Hùng Mới,0912345678,5 Hai Bà Trưng,Ghi chú mới
    Mở Màn    /them/nhap-file
    Click    css=button:text-is("Khách")
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    1 khách trùng
    Click    css=button:text-is("Bỏ qua tất cả khách trùng")
    Bấm Nút    NHẬP 0 KHÁCH
    Chờ Thấy Chữ    bỏ qua 1

    ${customers}=    Đọc Bảng    customers
    Length Should Be    ${customers}    1
    Should Be Equal    ${customers}[0][name]    Anh Hùng    Bỏ qua mà tên khách cũ vẫn bị ghi đè.
    Should Be Equal    ${customers}[0][address]    ${EMPTY}
    Should Be Equal    ${customers}[0][note]    Khách quen, hay ghi sổ
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

SĐT 9 số do Excel đổi thành số bị báo lỗi, nút NHẬP bị khoá và không ghi khách nào
    [Documentation]    Excel đổi "0912345678" thành số làm mất số 0 đầu. Dòng như vậy không được khớp
    ...    hay ghi thành khách với số sai; chỉ báo để người bán định dạng lại cột SĐT.
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-khach-mat-so-0.csv
    Create File    ${f}    Tên,Số điện thoại\nAnh Hùng,912345678
    Mở Màn    /them/nhap-file
    Click    css=button:text-is("Khách")
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    Dòng 2: SĐT bị Excel đổi thành số
    Nút Phải Bị Khoá    NHẬP 0 KHÁCH
    ${customers}=    Đọc Bảng    customers
    Length Should Be    ${customers}    1
    Should Be Equal    ${customers}[0][phone]    0912 345 678
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

Cập nhật món ô Giá vốn và Nhóm để trống thì giữ giá vốn và nhóm cũ
    [Documentation]    Ô trống không xoá dữ liệu cũ. Phở bò đặc biệt có giá vốn 30.000 và nhóm Đồ ăn trong bộ mẫu;
    ...    cập nhật chỉ đổi giá bán.
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-o-trong.csv
    Create File    ${f}    Nhóm,Tên món,Giá bán,Giá vốn\n,Phở bò đặc biệt,60000,
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    1 món trùng
    Click    css=button:text-is("Cập nhật tất cả món trùng")
    Bấm Nút    NHẬP 1 MÓN

    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    4
    ${phở}=    Evaluate    next(i for i in $items if i['name'] == 'Phở bò đặc biệt')
    Should Be Equal As Integers    ${phở}[unitPrice]    60000
    Should Be Equal As Integers    ${phở}[costPrice]    30000    Ô Giá vốn trống không được xoá giá vốn cũ.
    ${groups}=    Đọc Bảng    itemGroups
    ${nhóm_ăn}=    Evaluate    next(g for g in $groups if g['name'] == 'Đồ ăn')
    Should Be Equal As Numbers    ${phở}[groupId]    ${nhóm_ăn}[id]    Ô Nhóm trống không được xoá nhóm cũ.
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

Cập nhật món đang ngừng bán trùng tên thì đổi giá nhưng vẫn ngừng bán và báo cách bán lại
    [Documentation]    Nhập file không tự bật lại món đang ngừng bán. Câu báo chỉ người bán vào Mặt hàng
    ...    bấm "Bán lại mặt hàng này".
    Mở Màn    /them/mat-hang
    Click    css=button:has-text("Cà phê sữa")
    Bấm Nút    Ngừng bán mặt hàng này
    Chờ Thấy Chữ    Ngừng bán
    Wait Until Keyword Succeeds    40x    250ms    Món Trong Sổ Phải Ngừng Bán    Cà phê sữa

    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-ngung-ban.csv
    Create File    ${f}    Nhóm,Tên món,Giá bán\nĐồ uống,cà phê SỮA,22000
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}
    Chờ Thấy Chữ    1 món trùng
    Chờ Thấy Chữ    đang ngừng bán
    Click    css=button:text-is("Cập nhật tất cả món trùng")
    Bấm Nút    NHẬP 1 MÓN
    Chờ Thấy Chữ    1 món trùng đang ngừng bán

    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    4
    ${cà_phê}=    Evaluate    next(i for i in $items if i['name'] == 'Cà phê sữa')
    Should Be Equal As Integers    ${cà_phê}[unitPrice]    22000
    Should Be Equal As Integers    ${cà_phê}[isActive]    0    Nhập file không được tự bán lại món đang ngừng bán.
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

File vượt 2000 dòng bị từ chối trước khi xem trước và không món nào được ghi
    [Documentation]    Trần 2000 dòng kể cả tiêu đề giữ một lần nhập khỏi làm treo IndexedDB. Ca này
    ...    cố ý vượt đúng một dòng để đo sát ngưỡng.
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-qua-2000-dong.csv
    ${nội_dung}=    Evaluate    chr(10).join(['Tên món,Giá bán'] + [f'Món dài {i},1000' for i in range(2000)])
    Create File    ${f}    ${nội_dung}
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    File có hơn 2000 dòng
    Không Được Thấy Chữ    món mới
    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    4
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

File thiếu cột Giá bán bị từ chối và nói đúng tên cột còn thiếu
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-thieu-cot.csv
    Create File    ${f}    Tên món,Đơn vị\nBánh ít,Cái
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    không có cột "Giá bán"
    Không Được Thấy Chữ    món mới
    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    4
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

File chỉ có dòng tiêu đề thì nút NHẬP 0 MÓN bị khoá
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-chi-tieu-de.csv
    Create File    ${f}    Tên món,Giá bán\n
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    0 món mới
    Nút Phải Bị Khoá    NHẬP 0 MÓN
    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    4
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}

Giá bán vượt mức tối đa bị báo lỗi đúng dòng và không ghi món nào
    ${f}=    Set Variable    ${DOWNLOAD_DIR}/nhap-mon-gia-tran.csv
    Create File    ${f}    Tên món,Giá bán\nBánh lớn,1000000000
    Mở Màn    /them/nhap-file
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${f}

    Chờ Thấy Chữ    Dòng 2: Giá bán vượt mức tối đa
    Nút Phải Bị Khoá    NHẬP 0 MÓN
    ${items}=    Đọc Bảng    items
    Length Should Be    ${items}    4
    [Teardown]    Run Keywords    Đóng Phiên    AND    Remove File    ${f}


*** Keywords ***
Món Trong Sổ Phải Ngừng Bán
    [Arguments]    ${tên}
    ${mặt_hàng}=    Đọc Bảng    items
    ${món}=    Evaluate    next(row for row in $mặt_hàng if row['name'] == '${tên}')
    Should Be Equal As Integers    ${món}[isActive]    0    ${tên} chưa được ghi ngừng bán vào sổ.
