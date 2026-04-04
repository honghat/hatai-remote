import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  Calculator, Lock, FileText, DollarSign, CreditCard,
  PiggyBank, Receipt, BarChart3, ArrowRight, Calendar,
  BookOpen, ClipboardCheck, TrendingUp, Landmark, Wallet
} from 'lucide-react'

const ACCOUNTING_MODULES = [
  {
    key: 'general_ledger',
    label: 'Sổ cái',
    icon: BookOpen,
    color: 'from-emerald-500 to-emerald-600',
    description: 'Hệ thống tài khoản, bút toán, sổ cái tổng hợp',
    features: ['Hệ thống tài khoản', 'Bút toán kép', 'Sổ cái tổng hợp', 'Sổ chi tiết'],
    status: 'coming',
  },
  {
    key: 'receivable',
    label: 'Công nợ Phải thu',
    icon: DollarSign,
    color: 'from-blue-500 to-blue-600',
    description: 'Theo dõi công nợ khách hàng, hóa đơn bán, thu tiền',
    features: ['Hóa đơn bán', 'Phiếu thu', 'Đối chiếu công nợ', 'Nhắc nhở thanh toán'],
    status: 'coming',
  },
  {
    key: 'payable',
    label: 'Công nợ Phải trả',
    icon: CreditCard,
    color: 'from-red-500 to-red-600',
    description: 'Quản lý công nợ nhà cung cấp, thanh toán',
    features: ['Hóa đơn mua', 'Phiếu chi', 'Lịch thanh toán', 'Đối chiếu NCC'],
    status: 'coming',
  },
  {
    key: 'cash_bank',
    label: 'Tiền mặt & Ngân hàng',
    icon: Landmark,
    color: 'from-amber-500 to-amber-600',
    description: 'Quản lý quỹ tiền mặt, tài khoản ngân hàng',
    features: ['Sổ quỹ tiền mặt', 'Sổ tiền gửi NH', 'Đối chiếu bank', 'Chuyển khoản nội bộ'],
    status: 'coming',
  },
  {
    key: 'tax',
    label: 'Thuế & Kê khai',
    icon: Receipt,
    color: 'from-purple-500 to-purple-600',
    description: 'Kê khai thuế GTGT, TNCN, TNDN',
    features: ['Kê khai thuế GTGT', 'Thuế TNDN', 'Thuế TNCN', 'Hóa đơn điện tử'],
    status: 'coming',
  },
  {
    key: 'financial_reports',
    label: 'Báo cáo Tài chính',
    icon: BarChart3,
    color: 'from-cyan-500 to-cyan-600',
    description: 'Bảng cân đối, kết quả kinh doanh, lưu chuyển tiền tệ',
    features: ['Bảng cân đối KT', 'BCKQKD', 'BCLCTT', 'Thuyết minh BCTC'],
    status: 'coming',
  },
]

function ModuleCard({ module }) {
  const { icon: Icon, label, color, description, features, status } = module

  return (
    <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-700/50 rounded-2xl overflow-hidden hover:shadow-lg transition-all duration-200 group">
      <div className={`px-5 py-4 bg-gradient-to-r ${color} relative`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Icon size={20} className="text-white" />
          </div>
          <div>
            <h3 className="font-extrabold text-white text-base">{label}</h3>
            <p className="text-white/70 text-xs mt-0.5">{description}</p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-3">
        <p className="text-[10px] font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest">Chức năng chính</p>
        <div className="space-y-2">
          {features.map(f => (
            <div key={f} className="flex items-center gap-2.5 text-sm">
              <span className={`w-1.5 h-1.5 rounded-full bg-gradient-to-br ${color} flex-shrink-0`} />
              <span className="text-light-600 dark:text-slate-400">{f}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 py-3.5 border-t border-light-100 dark:border-slate-800/50">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-900/15 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800/30 uppercase tracking-wider">
            <Calendar size={10} /> Sắp ra mắt
          </span>
          <span className="text-[11px] text-light-400 dark:text-slate-500">Agent sẽ code module này</span>
        </div>
      </div>
    </div>
  )
}

function StatPlaceholder({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-700/50 rounded-2xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold text-light-400 dark:text-slate-500 uppercase tracking-widest">{label}</p>
          <p className="text-2xl font-black text-light-900 dark:text-white mt-1.5 tracking-tight">{value}</p>
        </div>
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-lg`}>
          <Icon size={18} className="text-white" />
        </div>
      </div>
    </div>
  )
}

export default function Accounting() {
  const { hasPermission } = useAuth()

  if (!hasPermission('accounting', 'read')) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Lock size={48} className="mx-auto text-light-300 dark:text-slate-600 mb-4" />
          <p className="text-light-500 dark:text-slate-400 font-bold">Bạn không có quyền truy cập module Kế toán</p>
          <p className="text-xs text-light-400 dark:text-slate-500 mt-1">Liên hệ quản trị viên để được cấp quyền</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-light-200 dark:border-slate-800/60 bg-white/50 dark:bg-transparent">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
            <Calculator size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-light-900 dark:text-white tracking-tight">
              Kế toán & Tài chính
            </h1>
            <p className="text-xs text-light-400 dark:text-slate-500 mt-0.5">
              Hệ thống kế toán tích hợp theo chuẩn VAS & IFRS, phân quyền phê duyệt
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatPlaceholder icon={DollarSign} label="Tổng doanh thu" value="—" color="from-emerald-500 to-emerald-600" />
            <StatPlaceholder icon={Wallet} label="Chi phí tháng" value="—" color="from-red-500 to-red-600" />
            <StatPlaceholder icon={PiggyBank} label="Lợi nhuận" value="—" color="from-blue-500 to-blue-600" />
            <StatPlaceholder icon={Receipt} label="Hóa đơn chờ" value="—" color="from-amber-500 to-amber-600" />
          </div>

          {/* Info Banner */}
          <div className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 dark:from-emerald-900/20 dark:to-teal-900/20 border border-emerald-200 dark:border-emerald-800/30 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Calculator size={20} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="font-extrabold text-emerald-900 dark:text-emerald-300 text-sm">Module Kế toán đang được phát triển</h3>
                <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70 mt-1 leading-relaxed">
                  Hệ thống kế toán sẽ tuân thủ chuẩn mực kế toán Việt Nam (VAS) và quốc tế (IFRS).
                  Hỗ trợ phân quyền phê duyệt theo cấp: Kế toán viên {'->'} Kế toán trưởng {'->'} Giám đốc tài chính.
                  AI Agent sẽ hỗ trợ tự động hạch toán, đối chiếu và lập báo cáo.
                </p>
              </div>
            </div>
          </div>

          {/* Module Grid */}
          <div>
            <h2 className="text-sm font-extrabold text-light-900 dark:text-white uppercase tracking-widest mb-4 flex items-center gap-2">
              <ClipboardCheck size={16} className="text-primary-500" />
              Các Module Kế toán
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {ACCOUNTING_MODULES.map(m => (
                <ModuleCard key={m.key} module={m} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
