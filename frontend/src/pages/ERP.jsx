import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Building2, Package, ShoppingCart, Truck, BarChart3,
  FileText, Users, Warehouse, Lock, ArrowRight,
  ClipboardList, TrendingUp, Calendar, DollarSign,
  Calculator
} from 'lucide-react'

const ERP_MODULES = [
  {
    key: 'sales',
    label: 'Bán hàng',
    icon: ShoppingCart,
    color: 'from-blue-500 to-blue-600',
    description: 'Quản lý đơn hàng, báo giá, khách hàng, doanh thu',
    features: ['Đơn hàng bán', 'Báo giá', 'Quản lý khách hàng', 'Hợp đồng'],
    status: 'coming',
  },
  {
    key: 'purchase',
    label: 'Mua hàng',
    icon: Truck,
    color: 'from-emerald-500 to-emerald-600',
    description: 'Quản lý nhà cung cấp, đơn mua, nhập kho',
    features: ['Đơn mua hàng', 'Nhà cung cấp', 'Yêu cầu mua', 'So sánh giá'],
    status: 'coming',
  },
  {
    key: 'inventory',
    label: 'Kho & Tồn kho',
    icon: Warehouse,
    color: 'from-amber-500 to-amber-600',
    description: 'Quản lý kho, xuất nhập, kiểm kê, tồn kho',
    features: ['Phiếu nhập kho', 'Phiếu xuất kho', 'Kiểm kê', 'Báo cáo tồn'],
    status: 'coming',
  },
  {
    key: 'production',
    label: 'Sản xuất',
    icon: Package,
    color: 'from-purple-500 to-purple-600',
    description: 'Kế hoạch sản xuất, BOM, lệnh sản xuất',
    features: ['BOM', 'Lệnh sản xuất', 'Kế hoạch SX', 'Theo dõi tiến độ'],
    status: 'coming',
  },
  {
    key: 'hr',
    label: 'Nhân sự',
    icon: Users,
    color: 'from-pink-500 to-pink-600',
    description: 'Quản lý nhân viên, chấm công, lương, phép',
    features: ['Hồ sơ nhân viên', 'Chấm công', 'Tính lương', 'Nghỉ phép'],
    status: 'coming',
  },
  {
    key: 'accounting',
    label: 'Kế toán & Tài chính',
    icon: Calculator,
    color: 'from-teal-500 to-teal-600',
    description: 'Báo cáo tài chính, công nợ, sổ cái, thu chi',
    features: ['Sổ cái', 'Công nợ', 'Dòng tiền', 'Báo cáo tài chính'],
    path: '/accounting',
  },
  {
    key: 'reports',
    label: 'Báo cáo',
    icon: BarChart3,
    color: 'from-cyan-500 to-cyan-600',
    description: 'Báo cáo tổng hợp, dashboard, phân tích',
    features: ['Dashboard tổng quan', 'Báo cáo doanh thu', 'Phân tích xu hướng', 'Xuất báo cáo'],
    status: 'coming',
  },
]

function ModuleCard({ module }) {
  const { icon: Icon, label, color, description, features, status } = module

  return (
    <div className="bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-700/50 rounded-2xl overflow-hidden hover:shadow-lg transition-all duration-200 group">
      {/* Header */}
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

      {/* Features */}
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

      {/* Footer */}
      <div className="px-5 py-3.5 border-t border-light-100 dark:border-slate-800/50">
        {status === 'coming' ? (
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-900/15 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800/30 uppercase tracking-wider">
              <Calendar size={10} /> Sắp ra mắt
            </span>
            <span className="text-[11px] text-light-400 dark:text-slate-500">Agent sẽ code module này</span>
          </div>
        ) : (
          <Link
            to={module.path || '#'}
            className="flex items-center gap-2 text-sm font-bold text-primary-600 dark:text-primary-400 hover:underline group-hover:gap-3 transition-all"
          >
            Truy cập <ArrowRight size={14} />
          </Link>
        )}
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

export default function ERP() {
  const { hasPermission } = useAuth()

  if (!hasPermission('erp', 'read')) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Lock size={48} className="mx-auto text-light-300 dark:text-slate-600 mb-4" />
          <p className="text-light-500 dark:text-slate-400 font-bold">Bạn không có quyền truy cập module ERP</p>
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
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Building2 size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-light-900 dark:text-white tracking-tight">
              ERP - Quản trị Doanh nghiệp
            </h1>
            <p className="text-xs text-light-400 dark:text-slate-500 mt-0.5">
              Hệ thống quản lý tổng thể doanh nghiệp tích hợp AI Agent
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatPlaceholder icon={ShoppingCart} label="Đơn hàng tháng" value="—" color="from-blue-500 to-blue-600" />
            <StatPlaceholder icon={DollarSign} label="Doanh thu" value="—" color="from-emerald-500 to-emerald-600" />
            <StatPlaceholder icon={Warehouse} label="Sản phẩm" value="—" color="from-amber-500 to-amber-600" />
            <StatPlaceholder icon={TrendingUp} label="Tăng trưởng" value="—" color="from-purple-500 to-purple-600" />
          </div>

          {/* Info Banner */}
          <div className="bg-gradient-to-r from-blue-500/10 to-indigo-500/10 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800/30 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Building2 size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-extrabold text-blue-900 dark:text-blue-300 text-sm">Module ERP đang được phát triển</h3>
                <p className="text-xs text-blue-700/70 dark:text-blue-400/70 mt-1 leading-relaxed">
                  Hệ thống ERP sẽ được AI Agent tự động code theo yêu cầu nghiệp vụ cụ thể của doanh nghiệp bạn.
                  Mỗi module bên dưới sẽ được triển khai dần theo nhu cầu sử dụng thực tế, phân quyền riêng biệt cho từng chức danh.
                </p>
              </div>
            </div>
          </div>

          {/* Module Grid */}
          <div>
            <h2 className="text-sm font-extrabold text-light-900 dark:text-white uppercase tracking-widest mb-4 flex items-center gap-2">
              <ClipboardList size={16} className="text-primary-500" />
              Các Module ERP
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {ERP_MODULES.map(m => (
                <ModuleCard key={m.key} module={m} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
