import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Upload,
  ClipboardCheck,
  ScrollText,
  LogOut,
  Leaf,
} from "lucide-react";
import { logout, fetchStats, fetchMe } from "../api";
import clsx from "clsx";

export default function Layout() {
  const navigate = useNavigate();

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    refetchInterval: 20_000,
  });

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: Infinity,
  });

  const needsAttention = (stats?.pending ?? 0) + (stats?.flagged ?? 0);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const initials = me?.username
    ? me.username.slice(0, 2).toUpperCase()
    : "??";

  const NAV = [
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/ingest", icon: Upload, label: "Ingest Data" },
    {
      to: "/review",
      icon: ClipboardCheck,
      label: "Review",
      badge: needsAttention > 0 ? needsAttention : null,
    },
    { to: "/audit-log", icon: ScrollText, label: "Audit Log" },
  ];

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="flex flex-col w-60 bg-gray-900 text-white shrink-0">
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-500 shadow-sm">
            <Leaf className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Breathe ESG</p>
            <p className="text-xs text-gray-400 mt-0.5">Data Ingestion</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ to, icon: Icon, label, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-600 text-white"
                    : "text-gray-300 hover:bg-gray-800 hover:text-white"
                )
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {badge != null && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-xs font-bold leading-none">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-3 py-4 border-t border-gray-800 space-y-1">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
            <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{me?.username ?? "—"}</p>
              {me?.tenant_name && (
                <p className="text-xs text-gray-400 truncate">{me.tenant_name}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
