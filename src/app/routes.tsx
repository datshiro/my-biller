import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AppLayout } from './app-layout'
import { CustomerDetailPage } from '@/features/customers/customer-detail-page'
import { CustomerFormPage } from '@/features/customers/customer-form-page'
import { CustomerListPage } from '@/features/customers/customer-list-page'
import { CustomerPricePage } from '@/features/customers/customer-price-page'
import { DebtListPage } from '@/features/debts/debt-list-page'
import { ExpenseListPage } from '@/features/expenses/expense-list-page'
import { ItemFormPage } from '@/features/items/item-form-page'
import { ItemListPage } from '@/features/items/item-list-page'
import { MorePage } from '@/features/more/more-page'
import { OrderDetailPage } from '@/features/orders/order-detail-page'
import { OrderListPage } from '@/features/orders/order-list-page'
import { ReceiptPage } from '@/features/receipt/receipt-page'
import { ReportPage } from '@/features/reports/report-page'
import { SalesPage } from '@/features/sales/sales-page'
import { ExpenseCategoryPage } from '@/features/settings/expense-category-page'
import { ItemGroupPage } from '@/features/settings/item-group-page'
import { SettingsPage } from '@/features/settings/settings-page'
import { ShopInfoPage } from '@/features/settings/shop-info-page'
import { DeviceSetupPage } from '@/features/settings/device-setup-page'
import { GhepMayPage } from '@/features/settings/ghep-may-page'

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<SalesPage />} />
          <Route path="/don" element={<OrderListPage />} />
          <Route path="/don/:id" element={<OrderDetailPage />} />
          <Route path="/chi-phi" element={<ExpenseListPage />} />
          <Route path="/bao-cao" element={<ReportPage />} />
          <Route path="/cong-no" element={<DebtListPage />} />
          <Route path="/them" element={<MorePage />} />
          <Route path="/them/mat-hang" element={<ItemListPage />} />
          <Route path="/them/khach-hang" element={<CustomerListPage />} />
          <Route path="/them/khach-hang/:id" element={<CustomerDetailPage />} />
          <Route path="/them/cai-dat" element={<SettingsPage />} />
          <Route path="/them/nhom-mat-hang" element={<ItemGroupPage />} />
          <Route path="/them/loai-chi-phi" element={<ExpenseCategoryPage />} />
        </Route>

        {/* Phiếu nằm ngoài AppLayout: bản in không được dính bottom nav, và chính DOM này bị chụp thành ảnh. */}
        <Route path="/don/:id/phieu" element={<ReceiptPage />} />

        {/* Màn form chiếm trọn màn hình, không có bottom nav — đang nhập dở thì không nên nhảy tab. */}
        <Route path="/them/mat-hang/moi" element={<ItemFormPage />} />
        <Route path="/them/mat-hang/:id" element={<ItemFormPage />} />
        <Route path="/them/khach-hang/moi" element={<CustomerFormPage />} />
        <Route path="/them/khach-hang/:id/sua" element={<CustomerFormPage />} />
        <Route path="/them/khach-hang/:id/bang-gia" element={<CustomerPricePage />} />
        <Route path="/them/cua-hang" element={<ShopInfoPage />} />
        <Route path="/cai-dat-may" element={<DeviceSetupPage />} />
        <Route path="/ghep-may" element={<GhepMayPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
