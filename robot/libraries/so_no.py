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


def thanh_v4_co_menu_cu(van_ban, ten_nhom):
    """File sao lưu như bản 2.19.0 xuất: `version` 4, chưa có bảng nhóm lựa chọn, nhóm món `ten_nhom` giữ thực đơn
    tuỳ chọn và topping kiểu cũ ngay trong nó, không có `optionGroupGids`."""
    import json

    ban = json.loads(van_ban)
    data = ban["data"]
    data.pop("optionGroups", None)
    for group in data["itemGroups"]:
        group.pop("optionGroupGids", None)
        if group["name"] == ten_nhom:
            group["optionGroups"] = [{"name": "Đường", "choices": ["Ít đường", "Không đường"]}]
            group["toppingMenu"] = [{"name": "Trân châu", "price": 5000}, {"name": "Thạch", "price": 4000}]
    for item in data["items"]:
        item.pop("kind", None)
        item.pop("optionGroupGids", None)
    ban["version"] = 4
    return json.dumps(ban, ensure_ascii=False, indent=2)


def thanh_v1(van_ban):
    """Biến một file sao lưu v4 thành đúng hình dạng file v1 của bản cũ: không gid, không bảng giá riêng,
    khoản thu chưa có allocatedOrderId, mã đơn chưa có chữ máy (PBH-YYMMDD-NNN)."""
    import json
    import re

    ban = json.loads(van_ban)
    data = ban["data"]
    data.pop("customerPrices", None)
    for rows in data.values():
        for row in rows:
            if isinstance(row, dict):
                row.pop("gid", None)
    for payment in data["payments"]:
        payment.pop("allocatedOrderId", None)
        payment.pop("unallocatedStatus", None)
        payment.pop("resolutionNote", None)
    for order in data["orders"]:
        order["code"] = re.sub(r"-[A-Z](\d{3,})$", r"-\1", order["code"])
        order["originalCode"] = ""
    ban["version"] = 1
    return json.dumps(ban, ensure_ascii=False, indent=2)


def them_nhom_lua_chon(van_ban, ten_mon):
    """File sao lưu v5 kèm danh mục kiểu mới gắn thẳng vào món `ten_mon` — màn cài nhóm lựa chọn chưa có nên ca bán
    hàng dựng nhóm qua đường Ghi đè thật. Hai món topping: "Trân châu" 5.000 bán riêng được, "Pudding" 7.000 chỉ bán
    kèm. Bốn nhóm: Size (bắt buộc, M/L), Đường (mặc định 100%), Topping (Trân châu, Pudding), Ghi chú nhanh (tối đa 2)."""
    import json
    import uuid

    ban = json.loads(van_ban)
    data = ban["data"]
    luc = max(row["createdAt"] for row in data["items"])
    next_id = max(row["id"] for row in data["items"]) + 1

    def mon_topping(ten, gia, ban_rieng):
        nonlocal next_id
        row = {
            "id": next_id,
            "gid": str(uuid.uuid4()),
            "name": ten,
            "groupId": None,
            "unit": "phần",
            "unitPrice": gia,
            "costPrice": None,
            "isActive": 1 if ban_rieng else 0,
            "note": "",
            "kind": "topping",
            "createdAt": luc,
            "updatedAt": luc,
        }
        next_id += 1
        data["items"].append(row)
        return row["gid"]

    tran_chau = mon_topping("Trân châu", 5000, True)
    pudding = mon_topping("Pudding", 7000, False)

    def nhom(id_, ten, thu_tu, **rieng):
        return {
            "id": id_,
            "gid": str(uuid.uuid4()),
            "name": ten,
            "required": 0,
            "maxSelect": 1,
            "defaultChoice": None,
            "sortOrder": thu_tu,
            "isActive": 1,
            "createdAt": luc,
            "updatedAt": luc,
            **rieng,
        }

    nhom_moi = [
        nhom(1, "Size", 0, kind="choice", choices=["M", "L"], required=1),
        nhom(2, "Đường", 1, kind="choice", choices=["50%", "100%"], defaultChoice="100%"),
        nhom(3, "Topping", 2, kind="topping", maxSelect=None, toppings=[
            {"itemGid": tran_chau, "price": None},
            {"itemGid": pudding, "price": None},
        ]),
        nhom(4, "Ghi chú nhanh", 3, kind="choice", choices=["Ít ngọt", "Mang ống hút", "Không nắp"], maxSelect=2),
    ]
    data["optionGroups"] = nhom_moi
    for item in data["items"]:
        if item["name"] == ten_mon:
            item["optionGroupGids"] = [g["gid"] for g in nhom_moi]
    return json.dumps(ban, ensure_ascii=False, indent=2)
