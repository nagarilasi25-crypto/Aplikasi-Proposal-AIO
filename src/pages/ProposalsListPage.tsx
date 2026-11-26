import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive,
  Calculator,
  Copy,
  Edit3,
  Eye,
  FilePlus2,
  Search,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { ProposalPreviewModal } from '../components/ProposalPreviewModal';
import { formatRupiah, formatTanggalIndonesia } from '../lib/formatters';
import { ProposalRecord, PROPOSAL_STATUS_ORDER } from '../types/models';

export function ProposalsListPage() {
  const {
    appUser,
    institution,
    proposals,
    categories,
    budgets,
    attachments,
    appSettings,
    saveProposal,
    duplicateProposal,
    deleteProposal,
  } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const canEdit = appUser?.role === 'Administrator' || appUser?.role === 'Operator';

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [previewProposal, setPreviewProposal] = useState<ProposalRecord | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return proposals.filter((p) => {
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (categoryFilter !== 'ALL' && p.categoryId !== categoryFilter) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        (p.proposalNumber || '').toLowerCase().includes(q) ||
        (p.recipientInstitution || '').toLowerCase().includes(q)
      );
    });
  }, [proposals, query, statusFilter, categoryFilter]);

  const handleDuplicate = async (prop: ProposalRecord) => {
    try {
      const { queuedOffline } = await duplicateProposal(prop.id);
      showToast(
        queuedOffline
          ? `Salinan "${prop.title}" disimpan secara offline.`
          : `Proposal "${prop.title}" berhasil diduplikasi.`,
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menduplikasi proposal.', 'error');
    }
  };

  const handleToggleArchive = async (prop: ProposalRecord) => {
    try {
      const { queuedOffline } = await saveProposal({
        ...prop,
        isArchived: !prop.isArchived,
      });
      showToast(
        queuedOffline
          ? 'Perubahan arsip masuk antrean sinkronisasi.'
          : prop.isArchived
          ? `Proposal "${prop.title}" dikeluarkan dari arsip.`
          : `Proposal "${prop.title}" dipindahkan ke Arsip Proposal.`,
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal memperbarui status arsip.', 'error');
    }
  };

  const handleDelete = async (prop: ProposalRecord) => {
    try {
      const { queuedOffline } = await deleteProposal(prop.id);
      showToast(
        queuedOffline
          ? 'Penghapusan proposal masuk antrean sinkronisasi.'
          : `Proposal "${prop.title}" berhasil dihapus.`,
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus proposal.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-lg font-bold text-[#111C18]">
            Daftar Seluruh Proposal
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Kelola seluruh draf dan proposal resmi lembaga, pratinjau A4, tautan RAB, duplikasi, dan arsip.
          </p>
        </div>
        {canEdit && (
          <Link
            to="/buat-proposal"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#144D3A] whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="h-4 w-4" />
            Buat Proposal Baru
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari judul, nomor, atau instansi tujuan..."
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
        >
          <option value="ALL">Semua Status</option>
          {PROPOSAL_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
        >
          <option value="ALL">Semua Kategori</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Proposals Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
            <p className="text-sm font-medium text-slate-700">
              {proposals.length === 0
                ? 'Belum ada proposal tersimpan.'
                : 'Tidak ada proposal yang cocok dengan pencarian Anda.'}
            </p>
            {canEdit && proposals.length === 0 && (
              <Link
                to="/buat-proposal"
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2 text-xs font-semibold text-white"
              >
                <FilePlus2 className="h-3.5 w-3.5" /> Buat Proposal Pertama
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="pb-3 pr-4">Nomor & Judul Proposal</th>
                  <th className="pb-3 pr-4">Kategori & Tujuan</th>
                  <th className="pb-3 pr-4">Tanggal</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4 text-right">Total RAB</th>
                  <th className="pb-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((prop) => {
                  const canDeleteThis =
                    appUser?.role === 'Administrator' || prop.createdBy === appUser?.uid;
                  return (
                    <tr key={prop.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 pr-4">
                        <p className="font-semibold text-[#111C18]">{prop.title}</p>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">
                          {prop.proposalNumber || 'Tanpa Nomor'} · Tahun {prop.fiscalYear}
                        </p>
                      </td>
                      <td className="py-3.5 pr-4 text-xs text-slate-700">
                        <p className="font-medium">{prop.categoryName || 'Umum'}</p>
                        <p className="text-slate-500">{prop.recipientInstitution || '-'}</p>
                      </td>
                      <td className="py-3.5 pr-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {prop.proposalDate || formatTanggalIndonesia(prop.createdAt)}
                      </td>
                      <td className="py-3.5 pr-4 whitespace-nowrap">
                        <span className="inline-block rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-[#0F3D2E]">
                          {prop.status}
                        </span>
                      </td>
                      <td className="py-3.5 pr-4 text-right font-mono text-xs font-semibold text-[#111C18] tabular-nums whitespace-nowrap">
                        {formatRupiah(prop.totalBudget)}
                      </td>
                      <td className="py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setPreviewProposal(prop)}
                            className="rounded-md border border-slate-200 p-1.5 text-[#0F3D2E] hover:bg-slate-100"
                            title="Pratinjau A4 & Ekspor Word/PDF"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {canEdit && (
                            <>
                              <button
                                type="button"
                                onClick={() => navigate(`/buat-proposal?edit=${prop.id}`)}
                                className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100"
                                title="Sunting proposal"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(`/rab?proposalId=${prop.id}`)}
                                className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100"
                                title="Kelola RAB"
                              >
                                <Calculator className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDuplicate(prop)}
                                className="rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100"
                                title="Duplikasi"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleArchive(prop)}
                                className={`rounded-md border border-slate-200 p-1.5 hover:bg-slate-100 ${
                                  prop.isArchived ? 'text-[#9A742B] bg-amber-50' : 'text-slate-600'
                                }`}
                                title={prop.isArchived ? 'Sudah diarsipkan' : 'Arsipkan proposal'}
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {canDeleteThis && (
                            <button
                              type="button"
                              onClick={() => handleDelete(prop)}
                              className="rounded-md border border-slate-200 p-1.5 text-red-600 hover:bg-red-50"
                              title="Hapus proposal"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {previewProposal && (
        <ProposalPreviewModal
          proposal={previewProposal}
          institution={institution}
          budget={budgets.find((b) => b.proposalId === previewProposal.id) || null}
          attachments={attachments.filter(
            (a) =>
              a.proposalId === previewProposal.id ||
              (previewProposal.attachmentIds || []).includes(a.id)
          )}
          appSettings={appSettings}
          onClose={() => setPreviewProposal(null)}
        />
      )}
    </div>
  );
}
