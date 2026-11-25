import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  FileText,
  ArrowUpRight,
  FolderOpen,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  formatAngka,
  formatRupiah,
  formatTanggalIndonesia,
} from '../lib/formatters';

export function DashboardPage() {
  const { appUser, institution, proposals, categories, institutionLoading } = useAuth();
  const [selectedChartMode, setSelectedChartMode] = useState<'kategori' | 'tahun'>('kategori');

  const stats = useMemo(() => {
    const total = proposals.length;
    const draft = proposals.filter((p) => p.status === 'Draft').length;
    const siap = proposals.filter((p) => p.status === 'Siap diajukan').length;
    const diajukan = proposals.filter(
      (p) => p.status === 'Sudah diajukan' || p.status === 'Dalam proses'
    ).length;
    const disetujui = proposals.filter(
      (p) => p.status === 'Disetujui' || p.status === 'Bantuan diterima' || p.status === 'Selesai'
    ).length;
    const ditolak = proposals.filter((p) => p.status === 'Ditolak').length;
    const totalNilaiPengajuan = proposals.reduce(
      (sum, p) => sum + (Number(p.totalBudget) || 0),
      0
    );
    const totalBantuanDiterima = proposals.reduce(
      (sum, p) => sum + (Number(p.receivedAmount) || 0),
      0
    );

    return {
      total,
      draft,
      siap,
      diajukan,
      disetujui,
      ditolak,
      totalNilaiPengajuan,
      totalBantuanDiterima,
    };
  }, [proposals]);

  const categoryChartData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cat of categories) {
      counts.set(cat.name, 0);
    }
    for (const prop of proposals) {
      const key = prop.categoryName || 'Tanpa Kategori';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  }, [proposals, categories]);

  const yearChartData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const prop of proposals) {
      const yr = prop.fiscalYear ? String(prop.fiscalYear) : 'Tidak Diketahui';
      counts.set(yr, (counts.get(yr) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => ({ label, count }));
  }, [proposals]);

  const activeChartData =
    selectedChartMode === 'kategori' ? categoryChartData : yearChartData;
  const maxBarValue = Math.max(1, ...activeChartData.map((d) => d.count));

  const recentProposals = proposals.slice(0, 5);

  const statCards = [
    { label: 'Jumlah Seluruh Proposal', value: formatAngka(stats.total) },
    { label: 'Proposal Draft', value: formatAngka(stats.draft) },
    { label: 'Siap Diajukan', value: formatAngka(stats.siap) },
    { label: 'Sudah Diajukan', value: formatAngka(stats.diajukan) },
    { label: 'Proposal Disetujui', value: formatAngka(stats.disetujui) },
    { label: 'Proposal Ditolak', value: formatAngka(stats.ditolak) },
    { label: 'Total Nilai Pengajuan', value: formatRupiah(stats.totalNilaiPengajuan), highlight: true },
    { label: 'Total Bantuan Diterima', value: formatRupiah(stats.totalBantuanDiterima), accent: true },
  ];

  return (
    <div className="space-y-6">
      {/* Institution Context Strip */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#9A742B]">
              Identitas Lembaga Aktif
            </p>
            <h2 className="mt-1 truncate font-display text-xl font-bold text-[#111C18]">
              {institutionLoading
                ? 'Memuat profil lembaga...'
                : institution?.name?.trim() || 'Nama Lembaga Belum Diisi'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {institution?.address?.trim()
                ? [
                    institution.address,
                    institution.kecamatan ? `Kec. ${institution.kecamatan}` : '',
                    institution.kabupaten ? `Kab. ${institution.kabupaten}` : '',
                    institution.provinsi || '',
                  ]
                    .filter(Boolean)
                    .join(', ')
                : 'Alamat dan identitas lembaga belum dilengkapi. Silakan isi pada menu Profil Lembaga.'}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-6 border-t border-slate-100 pt-4 sm:border-t-0 sm:pt-0">
            <div>
              <p className="text-xs text-slate-500">Jumlah Santri</p>
              <p className="mt-0.5 font-mono text-lg font-semibold text-[#111C18] tabular-nums">
                {formatAngka(institution?.studentCount)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Tenaga Pengajar</p>
              <p className="mt-0.5 font-mono text-lg font-semibold text-[#111C18] tabular-nums">
                {formatAngka(institution?.teacherCount)}
              </p>
            </div>
            <Link
              to="/profil-lembaga"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-[#0F3D2E] transition-colors hover:bg-slate-50 whitespace-nowrap"
            >
              <Building2 className="h-3.5 w-3.5" />
              Kelola Profil
            </Link>
          </div>
        </div>
      </section>

      {/* 8 Stat Cards Grid */}
      <section aria-label="Ringkasan Statistik Proposal">
        {institutionLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div
                key={idx}
                className="h-[96px] animate-pulse rounded-xl border border-slate-200 bg-white p-5"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {statCards.map((card) => (
              <div
                key={card.label}
                className={`rounded-xl border p-5 ${
                  card.highlight
                    ? 'border-[#0F3D2E]/25 bg-[#0F3D2E] text-white'
                    : 'border-slate-200 bg-white text-[#111C18]'
                }`}
              >
                <p
                  className={`text-xs font-medium ${
                    card.highlight ? 'text-white/75' : 'text-slate-500'
                  }`}
                >
                  {card.label}
                </p>
                <p
                  className={`mt-2.5 font-mono text-2xl font-semibold tracking-tight tabular-nums ${
                    card.highlight
                      ? 'text-white'
                      : card.accent
                      ? 'text-[#0F3D2E]'
                      : 'text-[#111C18]'
                  }`}
                >
                  {card.value}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Charts & Recent Proposals */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Chart Card */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-[#111C18]">
                Distribusi Proposal
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Data tersimpan (online & cache offline)
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setSelectedChartMode('kategori')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  selectedChartMode === 'kategori'
                    ? 'bg-white text-[#0F3D2E] shadow-sm'
                    : 'text-slate-600 hover:text-[#111C18]'
                }`}
              >
                Kategori
              </button>
              <button
                type="button"
                onClick={() => setSelectedChartMode('tahun')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  selectedChartMode === 'tahun'
                    ? 'bg-white text-[#0F3D2E] shadow-sm'
                    : 'text-slate-600 hover:text-[#111C18]'
                }`}
              >
                Tahun
              </button>
            </div>
          </div>

          <div className="mt-6">
            {activeChartData.length === 0 || stats.total === 0 ? (
              <div className="flex h-56 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                <FolderOpen className="h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-700">
                  Belum ada data proposal
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Grafik berdasarkan {selectedChartMode} akan tampil otomatis setelah proposal dibuat pada Tahap 2.
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {activeChartData.map((item) => {
                  const pct = Math.round((item.count / maxBarValue) * 100);
                  return (
                    <div key={item.label} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate font-medium text-slate-700">
                          {item.label}
                        </span>
                        <span className="font-mono font-semibold text-[#111C18] tabular-nums">
                          {item.count}
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[#0F3D2E] transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Recent Proposals Table */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-base font-semibold text-[#111C18]">
                Daftar Proposal Terbaru
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                5 pengajuan terbaru yang tersimpan
              </p>
            </div>
            <Link
              to="/daftar-proposal"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#0F3D2E] hover:underline whitespace-nowrap shrink-0"
            >
              Lihat Semua
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-5">
            {institutionLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            ) : recentProposals.length === 0 ? (
              <div className="flex h-56 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                <FileText className="h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-700">
                  Belum ada proposal tercatat
                </p>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  Seluruh angka di dashboard bernilai nol karena data proposal masih kosong. Modul pembuatan proposal tersedia di Tahap 2.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                      <th className="pb-2.5 pr-4">Nomor & Judul</th>
                      <th className="pb-2.5 pr-4">Tanggal</th>
                      <th className="pb-2.5 pr-4">Status</th>
                      <th className="pb-2.5 text-right">Anggaran</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentProposals.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="py-3 pr-4">
                          <p className="font-medium text-[#111C18] line-clamp-1">
                            {item.title}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {item.proposalNumber || 'Tanpa Nomor'} · {item.categoryName || 'Umum'}
                          </p>
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {item.proposalDate || formatTanggalIndonesia(item.createdAt)}
                        </td>
                        <td className="py-3 pr-4 text-xs font-medium text-slate-700 whitespace-nowrap">
                          {item.status}
                        </td>
                        <td className="py-3 text-right font-mono text-xs font-semibold text-[#111C18] tabular-nums whitespace-nowrap">
                          {formatRupiah(item.totalBudget)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Quick Administrative Navigation */}
      {appUser?.role === 'Administrator' && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-display text-sm font-semibold text-[#111C18]">
                Aksi Cepat Administrator (Tahap 1)
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Lengkapi data profil lembaga dan kelola hak akses pengguna (nama & sandi).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/profil-lembaga"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Building2 className="h-4 w-4 text-[#0F3D2E]" />
                Lengkapi Profil Lembaga
              </Link>
              <Link
                to="/pengguna"
                className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2 text-xs font-medium text-white hover:bg-[#144D3A] whitespace-nowrap"
              >
                <Users className="h-4 w-4" />
                Kelola Pengguna
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
