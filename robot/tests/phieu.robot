*** Settings ***
Documentation       Màn Phiếu bán hàng — tờ giấy duy nhất khách nhìn thấy. Sai ở đây là sai trước
...                 mặt khách, nên kiểm cả nội dung lẫn việc ảnh PNG có dựng nổi trên trình duyệt thật.
Resource            ../resources/app.resource
Resource            ../resources/sales.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           phieu


*** Variables ***
${LINES_PER_PAGE}    10


*** Test Cases ***
Phiếu hiện đủ đầu phiếu: tên quán, số phiếu, khách và giờ bán
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    QUÁN CƠM BÀ TƯ
    Chờ Thấy Chữ    12 Lê Lợi, Q1
    Chờ Thấy Chữ    0909 123 456
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    Chờ Thấy Chữ    Khách lẻ

    ${đơn}=    Đơn Mới Nhất
    Chờ Thấy Chữ    Số: ${đơn}[code]

Phiếu liệt kê từng dòng hàng kèm số lượng, đơn giá và thành tiền
    Mở Màn    /
    Chọn Món    Phở bò    2
    Chọn Món    Trà đá
    Mở Sheet Thu Tiền
    Chốt Đơn

    Chờ Thấy Chữ    MẶT HÀNG
    Chờ Thấy Chữ    Phở bò đặc biệt
    Chờ Thấy Chữ    (tô)
    Chờ Thấy Chữ    Trà đá
    Chờ Thấy Chữ    110.000
    Chờ Thấy Chữ    113.000 đ

Đơn có giảm giá thì phiếu tách rõ tiền hàng và phần giảm
    [Documentation]    Chỉ in mỗi số cuối thì khách không biết đã được bớt — tách dòng ra mới thuyết phục.
    Mở Màn    /
    Chọn Món    Phở bò
    Bấm Nút    Giảm giá / phụ thu
    Điền Ô    Giảm giá    5000
    Bấm Nút    ÁP DỤNG
    Mở Sheet Thu Tiền
    Chốt Đơn

    Chờ Thấy Chữ    Hàng
    Chờ Thấy Chữ    55.000 đ
    Chờ Thấy Chữ    Giảm giá
    Chờ Thấy Chữ    Tổng cộng
    Chờ Thấy Chữ    50.000 đ

Đơn trả đủ thì phiếu ghi đã trả và không có dòng còn nợ
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    Đã trả (tiền mặt)
    Không Được Thấy Chữ    Còn nợ

Đơn bán nợ thì phiếu ghi rõ còn nợ bao nhiêu
    Bán Nợ Cho Khách    Phở bò    Anh Hùng
    Chờ Thấy Chữ    Anh Hùng
    Chờ Thấy Chữ    Còn nợ
    Chờ Thấy Chữ    55.000 đ

Ghi chú của đơn lên phiếu cho khách đọc được
    Bán Nhanh    Trà đá
    ${đơn}=    Đơn Mới Nhất
    Mở Màn    /don/${đơn}[id]
    Điền Ô    Ghi chú    Giao trước 5 giờ
    Bấm Nút    Lưu ghi chú
    Bấm Nút    XEM PHIẾU

    Chờ Thấy Chữ    Ghi chú: Giao trước 5 giờ

Chưa đặt tên quán thì phiếu mời thêm tên chứ không in dòng trống
    Xoá Thông Tin Quán
    Bán Nhanh    Trà đá
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG
    Không Được Thấy Chữ    QUÁN CƠM BÀ TƯ
    Chờ Thấy Chữ    Thêm tên quán vào phiếu

Đơn nhiều món thì phiếu tự chia trang và nút nói trước là mấy tấm
    [Documentation]    Quá ${LINES_PER_PAGE} dòng là phiếu tách tấm. Người bán phải biết mình sắp gửi
    ...    mấy tấm ảnh **trước** khi Zalo mở ra, nên số tấm nằm ngay trên nút.
    FOR    ${i}    IN RANGE    1    8
        Thêm Nhanh Mặt Hàng    Món số ${i}    ${i}000
    END

    Mở Màn    /
    Chọn Món    Phở bò
    Chọn Món    Cơm tấm
    Chọn Món    Trà đá
    Chọn Món    Cà phê
    FOR    ${i}    IN RANGE    1    8
        Chọn Món    Món số ${i}
    END
    Mở Sheet Thu Tiền
    Chốt Đơn

    Chờ Thấy Chữ    Trang 1/2
    Chờ Thấy Chữ    còn tiếp
    Chờ Thấy Chữ    Trang 2/2
    # Số tấm chỉ lên nhãn khi ảnh đã dựng xong — hai lần chụp canvas nên chờ rộng tay hơn.
    Wait For Elements State    css=button:has-text("(2 tấm)")    visible    timeout=45s

Trình duyệt thật dựng được ảnh phiếu để gửi đi
    [Documentation]    Nút đứng mãi ở "Đang chuẩn bị ảnh…" nghĩa là `renderReceiptPng` chết trên máy
    ...    thật — bộ test jsdom không bao giờ thấy được ca này.
    Bán Nhanh    Phở bò
    Chờ Thấy Chữ    Đang chuẩn bị ảnh
    Wait For Elements State    css=button:has-text("CHIA SẺ QUA ZALO")    visible    timeout=30s
    Nút Không Được Khoá    CHIA SẺ QUA ZALO
    Không Được Thấy Chữ    Không tạo được ảnh phiếu trên máy này

Từ phiếu bấm Chi tiết là sang trang chi tiết đơn
    Bán Nhanh    Phở bò
    Click    css=a:has-text("Chi tiết")
    Wait For Condition    Url    contains    /don/
    Chờ Thấy Chữ    MẶT HÀNG

Bấm quay lại từ phiếu thì không rơi ngược vào giỏ vừa bán
    [Documentation]    Phiếu thay chỗ màn Bán hàng trong lịch sử (`replace`), nên quay lại là về màn
    ...    đứng trước lúc bán. Rơi đúng vào giỏ vừa chốt mới là nguy: rất dễ bấm bán thêm lần nữa.
    Mở Màn    /don
    Click    ${NAV_BAN}
    Chọn Món    Phở bò
    Mở Sheet Thu Tiền
    Chốt Đơn

    Click    css=button[aria-label="Quay lại"]
    Chờ Thấy Chữ    Đơn hàng
    Wait For Elements State    ${NÚT_THU_TIỀN}    detached

Mở phiếu của đơn không tồn tại thì báo rõ và có lối về
    Mở Màn    /don/999999/phieu
    Chờ Thấy Chữ    Không tìm thấy đơn này
    Bấm Nút    Về danh sách đơn
    Chờ Thấy Chữ    Đơn hàng


*** Keywords ***
Thêm Nhanh Mặt Hàng
    [Arguments]    ${tên}    ${giá}
    Mở Màn    /them/mat-hang/moi
    Điền Ô    Tên mặt hàng *    ${tên}
    Điền Ô    Giá bán *    ${giá}
    Bấm Nút    LƯU MẶT HÀNG
    Chờ Thấy Chữ    ${tên}

Xoá Thông Tin Quán
    [Documentation]    Lưu xong màn tự `navigate(-1)`. React tháo form ngay khi router đổi state,
    ...    nhưng trình duyệt commit cú lùi đó chậm hơn — chờ theo DOM là chờ hụt, đi tiếp lúc đó sẽ
    ...    cắt ngang chuyến lùi và lệnh điều hướng kế tiếp chết với ERR_ABORTED. Phải chờ theo URL.
    Mở Màn    /them/cai-dat
    Click    css=button:has-text("Thông tin cửa hàng")
    Điền Ô    Tên cửa hàng    ${EMPTY}
    Điền Ô    Địa chỉ    ${EMPTY}
    Điền Ô    Số điện thoại    ${EMPTY}
    Bấm Nút    LƯU THÔNG TIN
    Wait For Condition    Url    ==    ${BASE_URL}/them/cai-dat

Nút Không Được Khoá
    [Arguments]    ${nhãn}
    Wait For Elements State    css=button:has-text("${nhãn}")    enabled
