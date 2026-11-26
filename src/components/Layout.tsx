import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  FileText,
  Tags,
  FilePlus2,
  Files,
  Calculator,
  Image as ImageIcon,
  Archive,
  Activity,
  BarChart3,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { PWAInstallButton } from './PWAInstallButton';
import { OfflineIndicator } from './OfflineIndicator';
import { isSafeImageUrl } from '../lib/imageUtils';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  stage?: string;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'Utama',
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard },
      { label: 'Profil Lembaga', to: '/profil-lembaga', icon: Building2 },
    ],
  },
  {
    heading: 'Master & Penyusunan',
    items: [
      { label: 'Master Template Proposal', to: '/template-proposal', icon: FileText, stage: 'Tahap 2' },
      { label: 'Kategori Proposal', to: '/kategori-proposal', icon: Tags, stage: 'Tahap 2' },
      { label: 'Buat Proposal', to: '/buat-proposal', icon: FilePlus2, stage: 'Tahap 2' },
      { label: 'Daftar Proposal', to: '/daftar-proposal', icon: Files, stage: 'Tahap 2' },
    ],
  },
  {
    heading: 'Anggaran & Dokumen',
    items: [
      { label: 'Rencana Anggaran Biaya', to: '/rab', icon: Calculator, stage: 'Tahap 3' },
      { label: 'Dokumentasi dan Lampiran', to: '/dokumentasi', icon: ImageIcon, stage: 'Tahap 3' },
    ],
  },
  {
    heading: 'Arsip & Monitoring',
    items: [
      { label: 'Arsip Proposal', to: '/arsip', icon: Archive, stage: 'Tahap 4' },
      { label: 'Monitoring Pengajuan', to: '/monitoring', icon: Activity, stage: 'Tahap 5' },
      { label: 'Laporan', to: '/laporan', icon: BarChart3, stage: 'Tahap 5' },
    ],
  },
  {
    heading: 'Administrasi Sistem',
    items: [
      { label: 'Manajemen Pengguna', to: '/pengguna', icon: Users, adminOnly: true },
      { label: 'Pengaturan', to: '/pengaturan', icon: Settings },
    ],
  },
];

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/profil-lembaga': 'Profil Lembaga',
  '/template-proposal': 'Master Template Proposal',
  '/kategori-proposal': 'Kategori Proposal',
  '/buat-proposal': 'Buat Proposal',
  '/daftar-proposal': 'Daftar Proposal',
  '/rab': 'Rencana Anggaran Biaya',
  '/dokumentasi': 'Dokumentasi dan Lampiran',
  '/arsip': 'Arsip Proposal',
  '/monitoring': 'Monitoring Pengajuan',
  '/laporan': 'Laporan',
  '/pengguna': 'Manajemen Pengguna',
  '/pengaturan': 'Pengaturan',
};

export function Layout({ children }: { children: React.ReactNode }) {
  const { appUser, institution, pendingSyncCount, signOutUser } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setLogoFailed(false);
  }, [institution?.logoUrl]);

  const currentTitle = ROUTE_TITLES[location.pathname] || 'Sistem Manajemen Proposal';
  const institutionName = institution?.name?.trim() || 'Profil Lembaga Belum Diisi';
  const logoSrc =
    !logoFailed && isSafeImageUrl(institution?.logoUrl) ? institution!.logoUrl! : '';

  const renderNavContent = () => (
    <div className="flex h-full flex-col bg-[#0F3D2E] text-white">
      {/* Brand Block */}
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1">
          {logoSrc ? (
            <img
              src={logoSrc}
              alt="Logo Lembaga"
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
              className="h-full w-full object-contain"
            />
          ) : (
            <Building2 className="h-5 w-5 text-[#0F3D2E]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-bold tracking-tight text-white">
            {institution?.name?.trim() || 'Sistem Proposal'}
          </p>
          <p className="truncate text-[11px] text-[#C5A059]">
            Manajemen Proposal
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Tutup menu navigasi"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Menu Utama">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(
            (item) => !item.adminOnly || appUser?.role === 'Administrator'
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.heading}>
              <p className="px-3 pb-1.5 text-[11px] font-medium tracking-wide text-white/50">
                {group.heading}
              </p>
              <ul className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) =>
                          `group flex items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                            isActive
                              ? 'bg-[#C5A059]/18 text-[#F3DFB6]'
                              : 'text-white/80 hover:bg-white/8 hover:text-white'
                          }`
                        }
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Icon className="h-4 w-4 shrink-0 opacity-85" />
                          <span className="truncate">{item.label}</span>
                        </span>
                        {item.stage && (
                          <span className="shrink-0 text-[10px] text-white/40">
                            {item.stage}
                          </span>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Bottom User & Sign-Out */}
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 px-2 py-1.5">
          <p className="truncate text-xs font-semibold text-white">
            {appUser?.displayName || appUser?.username || 'Pengguna'}
          </p>
          <p className="truncate text-[11px] text-white/65">
            {appUser?.role || 'Operator'} · {appUser?.position || 'Staf Lembaga'}
          </p>
        </div>
        <button
          type="button"
          onClick={signOutUser}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>Keluar</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#F8FAF9] text-[#111C18]">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden w-[264px] shrink-0 border-r border-slate-200 lg:block">
        <div className="sticky top-0 h-screen">{renderNavContent()}</div>
      </aside>

      {/* Mobile Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative z-50 w-[264px] max-w-[85vw] shadow-xl">
            {renderNavContent()}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
              aria-label="Buka menu navigasi"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <Link
                to="/"
                className="hidden truncate font-medium text-slate-500 hover:text-[#0F3D2E] sm:inline whitespace-nowrap"
              >
                {institutionName}
              </Link>
              <ChevronRight className="hidden h-4 w-4 shrink-0 text-slate-300 sm:inline" />
              <h1 className="truncate font-display text-base font-semibold text-[#111C18]">
                {currentTitle}
              </h1>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {pendingSyncCount > 0 && (
              <span className="hidden text-xs font-medium text-[#D97706] sm:inline whitespace-nowrap">
                {pendingSyncCount} perubahan menunggu sinkronisasi
              </span>
            )}
            <PWAInstallButton compact />
            <div className="hidden items-center gap-2 text-xs text-slate-500 md:flex">
              <span className="font-medium text-slate-700">{appUser?.displayName}</span>
              <span aria-hidden="true">·</span>
              <span>{appUser?.role}</span>
            </div>
            <Link
              to="/profil-lembaga"
              className="rounded-lg border border-[#0F3D2E]/20 bg-[#0F3D2E] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#144D3A] whitespace-nowrap shrink-0"
            >
              Profil Lembaga
            </Link>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-[1280px] flex-1 p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>

      <OfflineIndicator />
    </div>
  );
}
