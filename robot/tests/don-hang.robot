*** Settings ***
Documentation       Màn Đơn hàng và chi tiết đơn — xem lại, sửa ghi chú, huỷ đơn.
Resource            ../resources/app.resource
Resource            ../resources/sales.resource
Suite Setup         Mở Trình Duyệt Cho Suite
Suite Teardown      Đóng Trình Duyệt Cuối Suite
Test Setup          Mở Phiên Có Dữ Liệu Mẫu
Test Teardown       Đóng Phiên
Test Tags           don-hang


*** Test Cases ***
Đơn vừa bán hiện ngay trên danh sách đơn
    Bán Nhanh    Cơm tấm
    # Bán xong là đứng ở phiếu, mà phiếu nằm ngoài AppLayout nên không có bottom nav.
    # Về màn Bán hàng trước rồi mới bấm tab Đơn — đúng đường người bán đi.
    Mở Màn    /
    Click    ${NAV_DON}
    Chờ Thấy Chữ    Đơn hàng
    Chờ Thấy Chữ    Khách lẻ
    Chờ Thấy Chữ    45.000

Danh sách đơn hiện đúng số đơn của hôm nay
    ${trước}=    Đọc Số Đơn Hôm Nay
    Bán Nhanh    Trà đá
    ${sau}=    Đọc Số Đơn Hôm Nay
    ${mong_đợi}=    Evaluate    int($trước) + 1
    Should Be Equal As Integers    ${sau}    ${mong_đợi}

Mở chi tiết đơn thấy đủ mặt hàng và tổng cộng
    Bán Nhanh    Phở bò    2
    Mở Chi Tiết Đơn Mới Nhất
    Chờ Thấy Chữ    MẶT HÀNG
    Chờ Thấy Chữ    Phở bò đặc biệt
    Chờ Thấy Chữ    110.000 đ
    Chờ Thấy Chữ    Đã trả

Đơn bán nợ hiện rõ phần còn nợ ở chi tiết
    Bán Nợ Cho Khách    Phở bò    Anh Hùng
    Mở Chi Tiết Đơn Mới Nhất
    Chờ Thấy Chữ    CÒN NỢ
    Chờ Thấy Chữ    55.000 đ
    Chờ Thấy Chữ    Anh Hùng

Sửa ghi chú của đơn rồi lưu thì ghi vào sổ
    Bán Nhanh    Trà đá
    Mở Chi Tiết Đơn Mới Nhất
    Điền Ô    Ghi chú    Giao chiều mai
    Bấm Nút    Lưu ghi chú

    Wait Until Keyword Succeeds    5x    500ms    Ghi Chú Đơn Mới Nhất Phải Là    Giao chiều mai

Bỏ sửa ghi chú thì chữ vừa gõ không được ghi
    Bán Nhanh    Trà đá
    Mở Chi Tiết Đơn Mới Nhất
    Điền Ô    Ghi chú    Gõ nhầm
    Bấm Nút    Bỏ sửa
    Ghi Chú Đơn Mới Nhất Phải Là    ${EMPTY}

Huỷ đơn chưa thu tiền chỉ báo thôi tính doanh thu
    Bán Nợ Cho Khách    Phở bò    Anh Hùng
    Mở Chi Tiết Đơn Mới Nhất
    Bấm Nút    Huỷ đơn
    Chờ Hộp Xác Nhận    Huỷ đơn này?
    Không Được Thấy Chữ    hãy trả lại tiền cho khách trước
    Xác Nhận Trong Hộp    Huỷ đơn

    Chờ Thấy Chữ    Đơn này đã huỷ
    ${đơn}=    Đơn Mới Nhất
    Should Be Equal    ${đơn}[status]    void

Huỷ đơn đã thu tiền thì hộp xác nhận nói rõ tiền vẫn ở trong sổ
    [Documentation]    Lỗi cũ xoá mất phiếu thu thật. Câu xác nhận mới phải nói rõ khoản thu được
    ...    giữ lại nhưng bỏ khỏi đơn, để người bán xử lý tiếp mà không đòi lại lần nữa.
    [Tags]    regression
    Bán Nhanh    Phở bò
    Mở Chi Tiết Đơn Mới Nhất
    Bấm Nút    Huỷ đơn
    Chờ Hộp Xác Nhận    Huỷ đơn này?
    Chờ Thấy Chữ    đã thu 55.000 đ
    Chờ Thấy Chữ    không xoá lần thu này

Huỷ đơn đã thu tiền thì phiếu thu vẫn còn và chưa gắn đơn
    [Documentation]    Chốt lỗi mất tiền thật: huỷ đơn chỉ bỏ phân bổ, không xoá sự kiện đã thu.
    [Tags]    regression
    Bán Nhanh    Phở bò
    ${đơn}=    Đơn Mới Nhất
    Mở Chi Tiết Đơn Mới Nhất
    Bấm Nút    Huỷ đơn
    Xác Nhận Trong Hộp    Huỷ đơn
    Chờ Thấy Chữ    Đơn này đã huỷ

    ${sau}=    Đơn Mới Nhất
    Should Be Equal    ${sau}[status]    void
    Should Be Equal As Integers    ${sau}[paidAmount]    0

    ${phiếu_thu}=    Đọc Bảng    payments
    ${của_đơn}=    Evaluate    [p for p in $phiếu_thu if p['orderId'] == $đơn['id']]
    Length Should Be    ${của_đơn}    1    Huỷ đơn đã làm mất phiếu thu khỏi sổ.
    Should Be Equal As Integers    ${của_đơn}[0][allocatedOrderId]    0

Khách lẻ xử lý khoản thu sau huỷ ngay tại chi tiết đơn
    [Documentation]    Lỗi cũ để khoản thu khách lẻ chờ vô hạn vì chỉ lịch sử khách mới có nút xử lý;
    ...    ca này xác nhận UI và đọc thẳng payment để khoá trạng thái hoàn tiền có ghi vết.
    [Tags]    regression
    Bán Nhanh    Phở bò
    ${đơn}=    Đơn Mới Nhất
    Mở Chi Tiết Đơn Mới Nhất
    Bấm Nút    Huỷ đơn
    Chờ Hộp Xác Nhận    Huỷ đơn này?
    Chờ Thấy Chữ    xử lý ngay tại chi tiết đơn
    Xác Nhận Trong Hộp    Huỷ đơn

    Chờ Thấy Chữ    Khoản thu chờ xử lý
    Bấm Nút    Đã trả lại khách
    Chờ Hộp Xác Nhận    Đã trả lại tiền cho khách?
    Xác Nhận Trong Hộp    Xác nhận
    Chờ Thấy Chữ    Đã trả lại khách
    Không Được Thấy Chữ    Bỏ có ghi vết

    ${phiếu_thu}=    Đọc Bảng    payments
    ${của_đơn}=    Evaluate    [p for p in $phiếu_thu if p['orderId'] == $đơn['id']]
    Length Should Be    ${của_đơn}    1
    Should Be Equal As Integers    ${của_đơn}[0][allocatedOrderId]    0
    Should Be Equal    ${của_đơn}[0][unallocatedStatus]    refunded
    Should Contain    ${của_đơn}[0][resolutionNote]    Đã trả lại tiền khách lẻ

Bấm Huỷ trong hộp xác nhận thì đơn còn nguyên
    Bán Nhanh    Trà đá
    Mở Chi Tiết Đơn Mới Nhất
    Bấm Nút    Huỷ đơn
    Chờ Hộp Xác Nhận    Huỷ đơn này?
    Bỏ Qua Hộp Xác Nhận

    Không Được Thấy Chữ    Đơn này đã huỷ
    ${đơn}=    Đơn Mới Nhất
    Should Be Equal    ${đơn}[status]    paid

Đơn đã huỷ không còn nút huỷ và vẫn xem lại được phiếu
    Bán Nhanh    Trà đá
    Mở Chi Tiết Đơn Mới Nhất
    Bấm Nút    Huỷ đơn
    Xác Nhận Trong Hộp    Huỷ đơn
    Chờ Thấy Chữ    Đơn này đã huỷ
    Wait For Elements State    css=button:has-text("Huỷ đơn")    detached

    Bấm Nút    XEM PHIẾU
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG

Từ chi tiết đơn mở thẳng được phiếu
    Bán Nhanh    Phở bò
    Mở Chi Tiết Đơn Mới Nhất
    Bấm Nút    XEM PHIẾU
    Wait For Condition    Url    contains    /phieu
    Chờ Thấy Chữ    PHIẾU BÁN HÀNG


*** Keywords ***
Mở Chi Tiết Đơn Mới Nhất
    ${đơn}=    Đơn Mới Nhất
    Mở Màn    /don/${đơn}[id]
    Chờ Thấy Chữ    MẶT HÀNG

Đọc Số Đơn Hôm Nay
    [Documentation]    Đi thẳng bằng URL: đây là phép đọc số, không phải ca kiểm thanh nav — và chỗ
    ...    gọi nó có khi đang đứng ở phiếu, nơi không có bottom nav.
    Mở Màn    /don
    Chờ Thấy Chữ    SỐ ĐƠN
    ${số}=    Get Text    xpath=//span[normalize-space()="SỐ ĐƠN"]/following-sibling::span[1]
    RETURN    ${số}

Ghi Chú Đơn Mới Nhất Phải Là
    [Arguments]    ${mong_đợi}
    ${đơn}=    Đơn Mới Nhất
    Should Be Equal    ${đơn}[note]    ${mong_đợi}
