"""Tính nợ thẳng từ hai bảng `orders` và `payments` đọc ở IndexedDB (`Đọc Bảng`).

Chép đúng luật `groupDebts` + `ledgerTotals` (src/domain/debt.ts, src/domain/doi-soat.ts): nợ mỗi đơn còn hiệu
lực của khách = max(0, total - paidAmount); khoản thu chưa trừ đơn nào còn `pending` của khách trừ vào nợ
nhóm của khách đó, kẹp về 0. Ca khôi phục dùng nó để đối chiếu con số trên màn với sổ thật — màn hiện đúng
mà sổ ghi sai là kiểu hỏng tệ nhất của app.
"""


def _nhom_no(orders, payments):
    no = {}
    for order in orders:
        if order["status"] == "void" or order.get("customerId") is None:
            continue
        con = max(0, order["total"] - order["paidAmount"])
        if con <= 0:
            continue
        no[order["customerId"]] = no.get(order["customerId"], 0) + con
    for payment in payments:
        if payment["allocatedOrderId"] != 0 or payment.get("customerId") is None:
            continue
        if payment.get("unallocatedStatus", "pending") != "pending":
            continue
        khach = payment["customerId"]
        if khach in no:
            no[khach] = max(0, no[khach] - payment["amount"])
    return no


def no_cua_khach(orders, payments, customer_id):
    """Nợ của một khách (id cục bộ); 0 khi khách không nợ."""
    return _nhom_no(orders, payments).get(int(customer_id), 0)


def tong_no(orders, payments):
    return sum(_nhom_no(orders, payments).values())


def dinh_dang_vnd(so_tien):
    """Cùng dạng `formatVnd`: 100.000 đ."""
    return f"{int(so_tien):,}".replace(",", ".") + " đ"
