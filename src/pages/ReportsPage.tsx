import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { AuditLogRecord } from '../types/models';
import {
  formatAngka,
  formatRupiah,
  formatTanggalIndonesia,
} from '../lib/formatters';
import { exportSummaryReportToPdf } from '../lib/documentExport';

function escapeCsvCell(value: string | number | undefined | null): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function ReportsPage() {
  const {
    appUser,
    institution,
    proposals,
    categories,
    fetchAuditLogs,
    exportBackupSnapshot,
  } = useAuth();
  const { showToast } = useToast();

  const isAdmin = appUser?.role === 'Administrator';

  const [filterYear, setFilterYear] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditQuery, setAuditQuery] = useState('');
  const [exportingBackup, setExportingBackup] = useState(false);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const logs = await fetchAuditLogs();
      setAuditLogs(logs);
    } catch {
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  }, [fetchAuditLogs]);

  useEffect(() => {
    loadAuditLogs();
  }, [loadAuditLogs]);

  const years = useMemo(() => {
    const set = new Set<number>();
    proposals.forEach((p) => {
      if (p.fiscalYear) set.add(p.fiscalYear);
    });
    return Array.from(set).sort((a, b) => b - a);
  }, [proposals]);

  const filteredProposals = useMemo(() => {
    return proposals.filter((p) => {
      if (filterYear !== 'ALL' && String(p.fiscalYear) !== filterYear) return false;
      if (filterCategory !== 'ALL' && p.categoryName !== filterCategory) return false;
      return true;
    });
  }, [proposals, filterYear, filterCategory]);

  const summary = useMemo(() => {
    const count = filteredProposals.length;
    const requested = filteredProposals.reduce((s, p) => s + (Number(p.totalBudget) || 0), 0);
    const approved = filteredProposals.reduce((s, p) => s + (Number(p.approvedAmount) || 0), 0);
    const received = filteredProposals.reduce((s, p) => s + (Number(p.receivedAmount) || 0), 0);
    const realizationPct = requested > 0 ? Math.round((received / requested) * 100) : 0;
    return { count, requested, approved, received, realizationPct };
  }, [filteredProposals]);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { name: string; count: number; requested: number; approved: number; received: number }
    >();
    for (const p of filteredProposals) {
      const key = p.categoryName || 'Umum';
      const entry = map.get(key) || {
        name: key,
        count: 0,
        requested: 0,
        approved: 0,
        received: 0,
      };
      entry.count += 1;
      entry.requested += Number(p.totalBudget) || 0;
      entry.approved += Number(p.approvedAmount) || 0;
      entry.received += Number(p.receivedAmount) || 0;
      map.set(key, entry);
    }
    return Array.from(map.values());
  }, [filteredProposals]);

  const yearBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { year: string; count: number; requested: number; approved: number; received: number }
    >();
    for (const p of filteredProposals) {
      const key = String(p.fiscalYear || '-');
      const entry = map.get(key) || {
        year: key,
        count: 0,
        requested: 0,
        approved: 0,
        received: 0,
      };
      entry.count += 1;
      entry.requested += Number(p.totalBudget) || 0;
      entry.approved += Number(p.approvedAmount) || 0;
      entry.received += Number(p.receivedAmount) || 0;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.year.localeCompare(a.year));
  }, [filteredProposals]);

  const handleExportPdf = () => {
    const filterLabel = `${filterYear === 'ALL' ? 'Semua Tahun' : `Tahun ${filterYear}`} · ${
      filterCategory === 'ALL' ? 'Semua Kategori' : filterCategory
    }`;
    exportSummaryReportToPdf({
      institutionName: institution?.name?.trim() || 'Lembaga',
      proposals: filteredProposals,
      filterLabel,
    });
    showToast('Laporan rekapitulasi PDF berhasil diunduh.', 'success');
  };

  const handleExportCsv = () => {
    const header = [
      'No',
      'Nomor Proposal',
      'Judul Proposal',
      'Kategori',
      'Tahun Anggaran',
      'Instansi Tujuan',
      'Status',
      'Nilai Pengajuan',
      'Nilai Disetujui',
      'Bantuan Diterima',
    ];
    const rows = filteredProposals.map((p, idx) => [
      idx + 1,
      p.proposalNumber || '-',
      p.title,
      p.categoryName || 'Umum',
      p.fiscalYear,
      p.recipientInstitution || '-',
      p.status,
      Number(p.totalBudget) || 0,
      Number(p.approvedAmount) || 0,
      Number(p.receivedAmount) || 0,
    ]);
    const csvContent =
      '\uFEFF' +
      [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rekap-proposal-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Laporan CSV berhasil diunduh.', 'success');
  };

  const handleExportBackup = async () => {
    if (!isAdmin) return;
    setExportingBackup(true);
    try {
      const snapshot = await exportBackupSnapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cadangan-data-proposal-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Berkas cadangan data JSON berhasil diunduh.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal mengekspor cadangan data.', 'error');
    } finally {
      setExportingBackup(false);
    }
  };

  const filteredLogs = useMemo(() => {
    const q = auditQuery.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        (l.actorName || '').toLowerCase().includes(q) ||
        (l.details || '').toLowerCase().includes(q)
    );
  }, [auditLogs, auditQuery]);

  return (
    <div className="space-y-6">
      {/* Filter & Export Toolbar */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#111C18]">
              Laporan Rekapitulasi & Audit Sistem
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Evaluasi nilai pengajuan, persetujuan, realisasi bantuan, pencadangan data, serta log aktivitas pengguna.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <FileSpreadsheet className="h-4 w-4 text-[#0F3D2E]" />
              Unduh CSV
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#144D3A]"
            >
              <FileText className="h-4 w-4" />
              Unduh Laporan PDF
            </button>
            {isAdmin && (
              <button
                type="button"
                disabled={exportingBackup}
                onClick={handleExportBackup}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#C5A059] bg-amber-50/40 px-3.5 py-2 text-xs font-semibold text-[#9A742B] hover:bg-amber-50 disabled:opacity-60"
              >
                <Database className="h-4 w-4" />
                {exportingBackup ? 'Menyiapkan...' : 'Cadangan Data (JSON)'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">Filter Tahun Anggaran</label>
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            >
              <option value="ALL">Semua Tahun</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  Tahun {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Filter Kategori</label>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            >
              <option value="ALL">Semua Kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Summary Metric Cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">Jumlah Proposal</p>
          <p className="mt-2 font-mono text-2xl font-bold text-[#111C18] tabular-nums">
            {formatAngka(summary.count)}
          </p>
        </div>
        <div className="rounded-xl border border-[#0F3D2E]/25 bg-[#0F3D2E] p-5 text-white">
          <p className="text-xs font-medium text-white/75">Total Nilai Pengajuan</p>
          <p className="mt-2 font-mono text-xl font-bold tabular-nums">
            {formatRupiah(summary.requested)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">Total Disetujui</p>
          <p className="mt-2 font-mono text-xl font-bold text-[#111C18] tabular-nums">
            {formatRupiah(summary.approved)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">Total Bantuan Diterima</p>
          <p className="mt-2 font-mono text-xl font-bold text-[#0F3D2E] tabular-nums">
            {formatRupiah(summary.received)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500">Persentase Realisasi</p>
          <p className="mt-2 font-mono text-2xl font-bold text-[#9A742B] tabular-nums">
            {summary.realizationPct}%
          </p>
        </div>
      </section>

      {/* Breakdown Tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="font-display text-base font-semibold text-[#111C18]">
            Rekapitulasi Per Kategori
          </h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2 pr-3 font-semibold">Kategori</th>
                  <th className="pb-2 pr-3 font-semibold text-right">Jml</th>
                  <th className="pb-2 pr-3 font-semibold text-right">Pengajuan</th>
                  <th className="pb-2 font-semibold text-right">Diterima</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categoryBreakdown.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400">
                      Belum ada data pada filter ini.
                    </td>
                  </tr>
                ) : (
                  categoryBreakdown.map((row) => (
                    <tr key={row.name}>
                      <td className="py-2.5 pr-3 font-medium text-[#111C18]">{row.name}</td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{row.count}</td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                        {formatRupiah(row.requested)}
                      </td>
                      <td className="py-2.5 text-right font-mono font-semibold text-[#0F3D2E] tabular-nums">
                        {formatRupiah(row.received)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="font-display text-base font-semibold text-[#111C18]">
            Rekapitulasi Per Tahun Anggaran
          </h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2 pr-3 font-semibold">Tahun</th>
                  <th className="pb-2 pr-3 font-semibold text-right">Jml</th>
                  <th className="pb-2 pr-3 font-semibold text-right">Pengajuan</th>
                  <th className="pb-2 pr-3 font-semibold text-right">Disetujui</th>
                  <th className="pb-2 font-semibold text-right">Diterima</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {yearBreakdown.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      Belum ada data pada filter ini.
                    </td>
                  </tr>
                ) : (
                  yearBreakdown.map((row) => (
                    <tr key={row.year}>
                      <td className="py-2.5 pr-3 font-mono font-semibold text-[#111C18]">
                        {row.year}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{row.count}</td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                        {formatRupiah(row.requested)}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                        {formatRupiah(row.approved)}
                      </td>
                      <td className="py-2.5 text-right font-mono font-semibold text-[#0F3D2E] tabular-nums">
                        {formatRupiah(row.received)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Audit Log Viewer */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#0F3D2E]" />
            <div>
              <h3 className="font-display text-base font-semibold text-[#111C18]">
                Log Audit Aktivitas Sistem
              </h3>
              <p className="text-xs text-slate-500">
                Catatan aktivitas pembuatan, penyuntingan, persetujuan, dan pengelolaan akun.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={auditQuery}
              onChange={(e) => setAuditQuery(e.target.value)}
              placeholder="Filter log aktivitas..."
              className="w-48 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            />
            <button
              type="button"
              onClick={loadAuditLogs}
              disabled={auditLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${auditLoading ? 'animate-spin' : ''}`} />
              Muat Ulang
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2 pr-4 font-semibold">Waktu</th>
                <th className="pb-2 pr-4 font-semibold">Pelaku</th>
                <th className="pb-2 pr-4 font-semibold">Aksi</th>
                <th className="pb-2 font-semibold">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-400">
                    {auditLoading
                      ? 'Memuat log audit...'
                      : 'Tidak ada catatan audit (log audit tersedia saat terhubung ke server).'}
                  </td>
                </tr>
              ) : (
                filteredLogs.slice(0, 60).map((log, idx) => (
                  <tr key={log.id || `${log.entityId}_${idx}`}>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {formatTanggalIndonesia(log.createdAt)}
                    </td>
                    <td className="py-2.5 pr-4 font-medium text-[#111C18] whitespace-nowrap">
                      {log.actorName || log.actorUid}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-[#0F3D2E] whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="py-2.5 text-slate-600">{log.details || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isAdmin && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-xs font-semibold text-[#111C18]">
                Pencadangan Berkala Database Lembaga
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Unduh seluruh profil, template, proposal, RAB, lampiran, dan riwayat dalam satu berkas JSON aman (tanpa hash kata sandi).
              </p>
            </div>
            <button
              type="button"
              disabled={exportingBackup}
              onClick={handleExportBackup}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#0F3D2E] hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Unduh Cadangan JSON
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
