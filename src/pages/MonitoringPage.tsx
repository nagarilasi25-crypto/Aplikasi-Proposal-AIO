import React, { useMemo, useState } from 'react';
import { Activity, CheckCircle2, Clock, Search, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import {
  PROPOSAL_STATUS_ORDER,
  ProposalRecord,
  ProposalStatus,
} from '../types/models';
import { formatAngka, formatRupiah, formatTanggalIndonesia } from '../lib/formatters';

const LEADER_ONLY_STATUSES: ProposalStatus[] = [
  'Disetujui',
  'Ditolak',
  'Bantuan diterima',
  'Selesai',
];

function getStatusAccentClass(status: ProposalStatus): string {
  switch (status) {
    case 'Disetujui':
    case 'Bantuan diterima':
    case 'Selesai':
      return 'text-[#16A34A]';
    case 'Ditolak':
      return 'text-red-600';
    case 'Sudah diajukan':
    case 'Dalam proses':
      return 'text-amber-700';
    default:
      return 'text-slate-700';
  }
}

export function MonitoringPage() {
  const { appUser, proposals, statusHistory, updateProposalStatus } = useAuth();
  const { showToast } = useToast();

  const isLeaderOrAdmin =
    appUser?.role === 'Administrator' || appUser?.role === 'Pimpinan';

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [editingProposal, setEditingProposal] = useState<ProposalRecord | null>(null);
  const [nextStatus, setNextStatus] = useState<ProposalStatus>('Draft');
  const [approvedAmount, setApprovedAmount] = useState<number>(0);
  const [receivedAmount, setReceivedAmount] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [historyFilterProposalId, setHistoryFilterProposalId] = useState('ALL');

  const pipelineCounts = useMemo(() => {
    return PROPOSAL_STATUS_ORDER.map((status) => ({
      status,
      count: proposals.filter((p) => p.status === status).length,
    }));
  }, [proposals]);

  const filteredProposals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return proposals.filter((p) => {
      if (filterStatus !== 'ALL' && p.status !== filterStatus) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        (p.proposalNumber || '').toLowerCase().includes(q) ||
        (p.recipientInstitution || '').toLowerCase().includes(q)
      );
    });
  }, [proposals, filterStatus, searchQuery]);

  const filteredHistory = useMemo(() => {
    if (historyFilterProposalId === 'ALL') return statusHistory;
    return statusHistory.filter((h) => h.proposalId === historyFilterProposalId);
  }, [statusHistory, historyFilterProposalId]);

  const openStatusModal = (proposal: ProposalRecord) => {
    setEditingProposal(proposal);
    setNextStatus(proposal.status);
    setApprovedAmount(Number(proposal.approvedAmount) || 0);
    setReceivedAmount(Number(proposal.receivedAmount) || 0);
    setNotes(proposal.followUpNotes || '');
  };

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProposal) return;

    if (LEADER_ONLY_STATUSES.includes(nextStatus) && !isLeaderOrAdmin) {
      showToast(
        `Status "${nextStatus}" hanya dapat ditetapkan oleh Pimpinan atau Administrator.`,
        'error'
      );
      return;
    }

    setSubmitting(true);
    try {
      const { queuedOffline } = await updateProposalStatus(editingProposal.id, {
        status: nextStatus,
        approvedAmount: Number(approvedAmount) || 0,
        receivedAmount: Number(receivedAmount) || 0,
        notes: notes.trim(),
      });
      setEditingProposal(null);
      showToast(
        queuedOffline
          ? 'Perubahan status dicatat secara lokal (offline) dan akan disinkronkan otomatis.'
          : `Status proposal berhasil diperbarui menjadi "${nextStatus}".`,
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal memperbarui status.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 9-Stage Pipeline Summary */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div>
          <h2 className="font-display text-lg font-bold text-[#111C18]">
            Alur Siklus Pengajuan Proposal
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Pantau setiap tahapan pengajuan proposal dari Draft hingga Bantuan Diterima dan Selesai.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-9">
          {pipelineCounts.map((item) => {
            const active = filterStatus === item.status;
            return (
              <button
                key={item.status}
                type="button"
                onClick={() =>
                  setFilterStatus((prev) => (prev === item.status ? 'ALL' : item.status))
                }
                className={`rounded-xl border p-3 text-left transition-colors ${
                  active
                    ? 'border-[#0F3D2E] bg-[#0F3D2E] text-white'
                    : 'border-slate-200 bg-slate-50/50 text-[#111C18] hover:bg-slate-50'
                }`}
              >
                <p
                  className={`font-mono text-xl font-bold tabular-nums ${
                    active ? 'text-white' : 'text-[#0F3D2E]'
                  }`}
                >
                  {formatAngka(item.count)}
                </p>
                <p
                  className={`mt-1 text-[11px] font-medium leading-tight ${
                    active ? 'text-white/90' : 'text-slate-600'
                  }`}
                >
                  {item.status}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Proposals Monitoring Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-display text-base font-semibold text-[#111C18]">
              Daftar Monitoring Pengajuan ({filteredProposals.length})
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {isLeaderOrAdmin
                ? 'Anda memiliki kewenangan penuh termasuk persetujuan Pimpinan dan pencatatan realisasi bantuan.'
                : 'Operator dapat memperbarui status hingga tahap "Dalam proses". Persetujuan akhir dilakukan oleh Pimpinan atau Administrator.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari proposal..."
                className="w-52 rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            >
              <option value="ALL">Semua Status</option>
              {PROPOSAL_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredProposals.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center">
            <Activity className="mx-auto h-9 w-9 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              Belum ada proposal yang ditampilkan
            </p>
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-2.5 pr-4 font-semibold">Proposal & Tujuan</th>
                  <th className="pb-2.5 pr-4 font-semibold">Status Saat Ini</th>
                  <th className="pb-2.5 pr-4 font-semibold text-right">Pengajuan</th>
                  <th className="pb-2.5 pr-4 font-semibold text-right">Disetujui</th>
                  <th className="pb-2.5 pr-4 font-semibold text-right">Diterima</th>
                  <th className="pb-2.5 font-semibold text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProposals.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="py-3 pr-4">
                      <p className="font-semibold text-[#111C18]">{p.title}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {p.proposalNumber || 'Tanpa Nomor'} · {p.recipientInstitution || '-'}
                      </p>
                      {p.followUpNotes && (
                        <p className="mt-1 text-[11px] italic text-slate-500">
                          Catatan: {p.followUpNotes}
                        </p>
                      )}
                    </td>
                    <td className={`py-3 pr-4 font-semibold whitespace-nowrap ${getStatusAccentClass(p.status)}`}>
                      {p.status}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatRupiah(p.totalBudget)}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums whitespace-nowrap">
                      {formatRupiah(p.approvedAmount)}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono font-semibold text-[#0F3D2E] tabular-nums whitespace-nowrap">
                      {formatRupiah(p.receivedAmount)}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openStatusModal(p)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0F3D2E] hover:bg-slate-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Perbarui Status
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Chronological History Timeline */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-[#111C18]">
              Riwayat Perubahan Status ({filteredHistory.length})
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Catatan kronologis perubahan status beserta pelaku dan nilai realisasi bantuan.
            </p>
          </div>
          <select
            value={historyFilterProposalId}
            onChange={(e) => setHistoryFilterProposalId(e.target.value)}
            className="max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
          >
            <option value="ALL">Semua Proposal</option>
            {proposals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        {filteredHistory.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            Belum ada riwayat perubahan status tercatat.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100">
            {filteredHistory.slice(0, 50).map((h) => (
              <div key={h.id} className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#111C18]">
                    {h.proposalTitle || h.proposalId}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {h.fromStatus ? `${h.fromStatus} → ` : ''}
                    <span className="font-semibold text-[#0F3D2E]">{h.toStatus}</span>
                    {h.notes ? ` · ${h.notes}` : ''}
                  </p>
                  {(Number(h.approvedAmount) > 0 || Number(h.receivedAmount) > 0) && (
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                      Disetujui: {formatRupiah(h.approvedAmount)} · Diterima:{' '}
                      {formatRupiah(h.receivedAmount)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[11px] text-slate-500">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <span>{formatTanggalIndonesia(h.createdAt)}</span>
                  <span>·</span>
                  <span className="font-medium text-slate-700">{h.actorName}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Update Status Modal */}
      {editingProposal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-display text-base font-bold text-[#111C18]">
                  Perbarui Status Proposal
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">{editingProposal.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingProposal(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleStatusSubmit} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Status Baru</label>
                <select
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as ProposalStatus)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                >
                  {PROPOSAL_STATUS_ORDER.map((status) => {
                    const locked = LEADER_ONLY_STATUSES.includes(status) && !isLeaderOrAdmin;
                    return (
                      <option key={status} value={status} disabled={locked}>
                        {status}
                        {locked ? ' (Khusus Pimpinan / Admin)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              {isLeaderOrAdmin && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Nominal Disetujui (Rp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={approvedAmount}
                      onChange={(e) => setApprovedAmount(Number(e.target.value))}
                      className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-[#111C18] tabular-nums focus:border-[#0F3D2E] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Bantuan Diterima (Rp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={receivedAmount}
                      onChange={(e) => setReceivedAmount(Number(e.target.value))}
                      className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-[#111C18] tabular-nums focus:border-[#0F3D2E] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Catatan Tindak Lanjut / Keterangan
                </label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: Diserahkan ke Bagian Kesra atau disetujui tahap pertama."
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingProposal(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0F3D2E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Perubahan Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
