*** Settings ***
Documentation       Màn Chi phí — ghi, sửa, xoá khoản chi và hai ô tổng. Tiền ra khỏi túi mà không
...                 vào sổ thì lợi nhuận ở màn Báo cáo là số ảo, nên các ca ở đây đều soi tổng.
Resource            ../resources/app.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           chi-phi


*** Variables ***
${SHEET_CHI}    css=[role=dialog][aria-label="Ghi chi phí"]
${SHEET_SỬA}    css=[role=dialog][aria-label="Sửa khoản chi"]


*** Test Cases ***
Danh sách hiện khoản chi của bộ mẫu
    Mở Chi Phí Ở Tháng Của Khoản Mẫu
    Chờ Thấy Chữ    Chợ đầu mối
    Chờ Thấy Chữ    1.200.000

Ghi khoản chi mới thì cả sổ lẫn ô tổng hôm nay đi theo
    [Documentation]    Bộ mẫu chi 1.200.000 vào hôm qua, nên "CHI HÔM NAY" đang là 0 — khoản vừa
    ...    ghi phải hiện nguyên vẹn ở đó chứ không lẫn vào tổng tháng.
    Mở Màn    /chi-phi
    ${trước}=    Đọc Ô Tổng    CHI HÔM NAY
    Should Be Equal    ${trước}    0    Bộ mẫu chi vào hôm qua, "CHI HÔM NAY" phải đang là 0.

    Ghi Khoản Chi    50000    Nguyên liệu    Mua rau
    Chờ Thấy Chữ    Mua rau
    ${sau}=    Đọc Ô Tổng    CHI HÔM NAY
    Should Be Equal    ${sau}    −50.000    Ô "CHI HÔM NAY" không cộng đúng khoản vừa ghi.

Chưa nhập số tiền thì nút lưu còn khoá
    Mở Màn    /chi-phi
    Bấm Nút    Ghi chi phí
    Wait For Elements State    ${SHEET_CHI}    visible
    Nút Phải Bị Khoá    LƯU

Sửa khoản chi thì số tiền trong sổ đổi theo
    Mở Chi Phí Ở Tháng Của Khoản Mẫu
    Click    css=button:has-text("Chợ đầu mối")
    Wait For Elements State    ${SHEET_SỬA}    visible
    Điền Ô    Số tiền    900000
    Bấm Nút    LƯU

    Chờ Thấy Chữ    900.000
    ${khoản}=    Khoản Chi Theo Ghi Chú    Chợ đầu mối
    Should Be Equal As Integers    ${khoản}[amount]    900000

Xoá khoản chi phải qua hộp xác nhận
    Mở Chi Phí Ở Tháng Của Khoản Mẫu
    Click    css=button:has-text("Chợ đầu mối")
    Bấm Nút    Xoá khoản chi
    Chờ Hộp Xác Nhận    Xoá khoản chi?
    Bỏ Qua Hộp Xác Nhận

    ${chi}=    Đọc Bảng    expenses
    Length Should Be    ${chi}    1    Bấm Huỷ trong hộp xác nhận mà khoản chi vẫn bị xoá.

Xoá khoản chi xong thì nó biến khỏi tổng tháng
    Mở Chi Phí Ở Tháng Của Khoản Mẫu
    Click    css=button:has-text("Chợ đầu mối")
    Bấm Nút    Xoá khoản chi
    Xác Nhận Trong Hộp    Xoá

    Chờ Thấy Chữ    Chưa ghi khoản chi nào tháng này
    ${chi}=    Đọc Bảng    expenses
    Should Be Empty    ${chi}

Ghi chú trống thì tên loại lên làm tiêu đề khoản chi
    Mở Màn    /chi-phi
    Ghi Khoản Chi    30000    Nguyên liệu    ${EMPTY}
    Chờ Thấy Chữ    Nguyên liệu

Không ghi trước được khoản chi cho ngày mai
    [Documentation]    Ngày chi nằm ở tương lai thì tổng tháng sau sẽ đội lên vì tiền chưa hề ra khỏi túi.
    Mở Màn    /chi-phi
    Bấm Nút    Ghi chi phí
    Điền Ô    Số tiền    20000
    ${ngày_mai}=    Evaluate    (datetime.date.today() + datetime.timedelta(days=1)).isoformat()    datetime
    Điền Ô    Ngày chi    ${ngày_mai}

    Chờ Thấy Chữ    Chưa tới ngày đó, không ghi trước được
    Nút Phải Bị Khoá    LƯU

Lọc theo loại chi thì chỉ còn khoản của loại đó
    Mở Màn    /chi-phi
    Ghi Khoản Chi    30000    Nguyên liệu    Mua thịt

    Chọn Chip    Nguyên liệu
    Chờ Thấy Chữ    Hai ô trên chỉ tính loại
    Chờ Thấy Chữ    Mua thịt

Lùi về tháng trước thì không thấy khoản chi của tháng này
    Mở Chi Phí Ở Tháng Của Khoản Mẫu
    Chờ Thấy Chữ    Chợ đầu mối
    Click    css=button[aria-label="Tháng trước"]

    Chờ Thấy Chữ    Chưa ghi khoản chi nào tháng này
    Không Được Thấy Chữ    Chợ đầu mối

Không xem trước được tháng chưa tới
    Mở Màn    /chi-phi
    Chờ Thấy Chữ    CHI HÔM NAY
    Wait For Elements State    css=button[aria-label="Tháng sau"]    disabled


*** Keywords ***
Mở Chi Phí Ở Tháng Của Khoản Mẫu
    [Documentation]    Bộ mẫu đặt khoản chi vào HÔM QUA (`src/db/seed.ts`), còn màn Chi phí mở ở tháng
    ...    hiện tại. Đúng ngày mùng 1 thì "hôm qua" rơi sang tháng trước và khoản mẫu biến mất khỏi
    ...    màn — cả suite đỏ mỗi đầu tháng dù không ai sửa gì. Lùi một tháng đúng hôm đó.
    Mở Màn    /chi-phi
    Chờ Thấy Chữ    Chi phí
    ${ngày}=    Evaluate    datetime.date.today().day    datetime
    IF    ${ngày} == 1    Click    css=button[aria-label="Tháng trước"]

Đọc Ô Tổng
    [Documentation]    Số nằm ở <span> ngay sau nhãn của ô. Dấu trừ là U+2212 chứ không phải gạch nối.
    [Arguments]    ${nhãn}
    ${số}=    Get Text    ${{ 'xpath=//span[normalize-space()="%s"]/following-sibling::span[1]' % $nhãn }}
    RETURN    ${số}

Ghi Khoản Chi
    [Arguments]    ${số_tiền}    ${loại}    ${ghi_chú}
    Bấm Nút    Ghi chi phí
    Wait For Elements State    ${SHEET_CHI}    visible
    Điền Ô    Số tiền    ${số_tiền}
    # Hàng chip lọc của màn nền vẫn nằm trong DOM sau lớp sheet, cùng tên loại — phải thu vào sheet.
    Click    ${SHEET_CHI} >> css=button[aria-pressed]:text-is("${loại}")
    IF    $ghi_chú != ''
        Điền Ô    Ghi chú    ${ghi_chú}
    END
    Bấm Nút    LƯU
    Wait For Elements State    ${SHEET_CHI}    detached

Khoản Chi Theo Ghi Chú
    [Arguments]    ${ghi_chú}
    ${chi}=    Đọc Bảng    expenses
    ${khớp}=    Evaluate    [e for e in $chi if e['note'] == $ghi_chú]
    Should Not Be Empty    ${khớp}    Không tìm thấy khoản chi có ghi chú "${ghi_chú}".
    RETURN    ${khớp}[0]
