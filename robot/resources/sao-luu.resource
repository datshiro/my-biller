*** Settings ***
Documentation    Sao lưu ra file và ghi đè từ file, dùng chung cho suite Sao lưu và suite hai máy (máy vừa
...              huỷ ghép phải sao lưu, khôi phục như máy chưa ghép).
Resource         app.resource


*** Variables ***
${NÚT_SAO_LƯU}      css=button:has-text("SAO LƯU RA FILE")
${Ô_CHỌN_FILE}      css=input[aria-label="Chọn file sao lưu"]
${SHEET_CHẾ_ĐỘ}     css=[role=dialog][aria-label="Khôi phục từ file"]


*** Keywords ***
Sao Lưu Ra File
    [Documentation]    Trả về đường dẫn thật của file vừa rơi xuống máy. Không tự đặt tên file: mỗi
    ...    test có context riêng nên Playwright cất vào một chỗ riêng, khỏi lo hai test giẫm tên nhau.
    ${hứa}=    Promise To Wait For Download
    Click    ${NÚT_SAO_LƯU}
    ${tải}=    Wait For    ${hứa}
    RETURN    ${tải}[saveAs]

Chọn File Để Ghi Đè
    [Documentation]    Chọn file rồi chọn chế độ Ghi đè ở hộp "Khôi phục từ file".
    [Arguments]    ${đường_dẫn}
    Upload File By Selector    ${Ô_CHỌN_FILE}    ${đường_dẫn}
    Wait For Elements State    ${SHEET_CHẾ_ĐỘ}    visible
    Click    ${SHEET_CHẾ_ĐỘ} >> css=button:text-is("Ghi đè")

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
