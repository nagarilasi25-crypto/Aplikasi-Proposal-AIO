import { useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Copy,
  Download,
  Eye,
  FileText,
  Search,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { ProposalRecord } from '../types/models';
import { formatRupiah, formatTanggalIndonesia } from '../lib/formatters';
import { exportProposalToDocx, exportProposalToPdf } from '../lib/documentExport';
import { ProposalPreviewModal } from '../components/ProposalPreviewModal';

export function ArchivePage() {
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
  } = useAuth();
  const { showToast } = useToast();

  const canEdit = appUser?.role === 'Administrator' || appUser?.role === 'Operator';

  const [viewMode, setViewMode] = useState<'all' | 'archived'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterYear, setFilterYear] = useState('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ProposalRecord | null>(null);

  const years = useMemo(() => {
    const set = new Set<number>();
    proposals.forEach((p) => {
      if (p.fiscalYear) set.add(p.fiscalYear);
    });
    return Array.from(set).sort((a, b) => b - a);
  }, [proposals]);

  const archivedCount = useMemo(
    () => proposals.filter((p) => Boolean(p.isArchived)).length,
    [proposals]
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return proposals.filter((p) => {
      if (viewMode === 'archived' && !p.isArchived) return false;
      if (filterCategory !== 'ALL' && p.categoryName !== filterCategory) return false;
      if (filterYear !== 'ALL' && String(p.fiscalYear) !== filterYear) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        (p.proposalNumber || '').toLowerCase().includes(q) ||
        (p.recipientInstitution || '').toLowerCase().includes(q) ||
        (p.recipientName || '').toLowerCase().includes(q)
      );
    });
  }, [proposals, viewMode, filterCategory, filterYear, searchQuery]);

  const resolveProposalAssets = (proposal: ProposalRecord) => {
    const budget = budgets.find((b) => b.proposalId === proposal.id) || null;
    const linkedIds = new Set(proposal.attachmentIds || []);
    const propAttachments = attachments.filter(
      (a) => a.proposalId === proposal.id || linkedIds.has(a.id)
    );
    return { budget, propAttachments };
  };

  const handleExport = async (proposal: ProposalRecord, kind: 'docx' | 'pdf') => {
    setBusyId(`${proposal.id}_${kind}`);
    try {
      const { budget, propAttachments } = resolveProposalAssets(proposal);
      if (kind === 'docx') {
        await exportProposalToDocx({
          proposal,
          institution,
          budget,
          attachments: propAttachments,
          appSettings,
        });
        showToast(`Dokumen Word "${proposal.title}" berhasil diunduh.`, 'success');
      } else {
        await exportProposalToPdf({
          proposal,
          institution,
          budget,
          attachments: propAttachments,
          appSettings,
        });
        showToast(`Dokumen PDF "${proposal.title}" berhasil diunduh.`, 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal mengekspor dokumen.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDuplicate = async (proposal: ProposalRecord) => {
    if (!canEdit) return;
    setBusyId(`${proposal.id}_dup`);
    try {
      const { proposal: copy, queuedOffline } = await duplicateProposal(proposal.id);
      showToast(
        queuedOffline
          ? `Salinan "${copy.title}" dibuat secara lokal (offline).`
          : `Proposal berhasil diduplikasi menjadi "${copy.title}".`,
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menduplikasi proposal.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleArchive = async (proposal: ProposalRecord) => {
    if (!canEdit) return;
    setBusyId(`${proposal.id}_arc`);
    try {
      const nextArchived = !proposal.isArchived;
      const { queuedOffline } = await saveProposal({
        ...proposal,
        isArchived: nextArchived,
        archivedAt: nextArchived ? new Date().toISOString() : '',
      });
      showToast(
        queuedOffline
          ? `Status arsip diperbarui secara lokal (offline).`
          : nextArchived
          ? `Proposal "${proposal.title}" masuk ke Arsip Permanen.`
          : `Proposal "${proposal.title}" dikeluarkan dari Arsip.`,
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal memperbarui status arsip.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const previewAssets = previewTarget ? resolveProposalAssets(previewTarget) : null;

  return (
    <div className="space-y-6">
      {/* Header & Filter */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#111C18]">
              Arsip Proposal & Pusat Ekspor Dokumen
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Cetak atau unduh dokumen proposal lengkap (Kop Surat, Bab Narasi, RAB, Lampiran Foto, dan Tanda Tangan) dalam format Word (.docx) atau PDF A4.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setViewMode('all')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                viewMode === 'all'
                  ? 'bg-white text-[#0F3D2E] shadow-sm'
                  : 'text-slate-600 hover:text-[#111C18]'
              }`}
            >
              Semua Proposal ({proposals.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('archived')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                viewMode === 'archived'
                  ? 'bg-white text-[#0F3D2E] shadow-sm'
                  : 'text-slate-600 hover:text-[#111C18]'
              }`}
            >
              Arsip Ditandai ({archivedCount})
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div className="relative sm:col-span-6">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari judul, nomor proposal, atau instansi tujuan..."
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            />
          </div>
          <div className="sm:col-span-3">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            >
              <option value="ALL">Semua Kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <select
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            >
              <option value="ALL">Semua Tahun</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  Tahun {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Archive List */}
      <section className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center">
            <Archive className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">
              Tidak ada dokumen pada daftar arsip ini
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Ubah kata kunci pencarian atau tandai proposal sebagai arsip permanen.
            </p>
          </div>
        ) : (
          filtered.map((p) => {
            const { budget, propAttachments } = resolveProposalAssets(p);
            const effectiveBudget = budget ? budget.totalAmount : p.totalBudget;

            return (
              <article
                key={p.id}
                className="rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300"
              >
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-[#0F3D2E]">
                        {p.proposalNumber || 'Tanpa Nomor'}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-600">{p.categoryName || 'Umum'}</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono text-slate-600">{p.fiscalYear}</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-medium text-slate-700">{p.status}</span>
                      {p.isArchived && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="font-semibold text-[#9A742B]">Arsip Permanen</span>
                        </>
                      )}
                    </div>
                    <h3 className="mt-1.5 font-display text-base font-bold text-[#111C18]">
                      {p.title}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Tujuan: {[p.recipientName, p.recipientInstitution].filter(Boolean).join(' — ') || '-'} · Tanggal:{' '}
                      {formatTanggalIndonesia(p.proposalDate || p.createdAt)} · Lampiran:{' '}
                      {propAttachments.length} berkas
                    </p>
                  </div>

                  <div className="flex flex-col items-start gap-3 border-t border-slate-100 pt-3 lg:items-end lg:border-t-0 lg:pt-0">
                    <p className="font-mono text-sm font-bold text-[#0F3D2E] tabular-nums">
                      {formatRupiah(effectiveBudget)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewTarget(p)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Eye className="h-3.5 w-3.5 text-[#0F3D2E]" />
                        Pratinjau A4
                      </button>
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => handleExport(p, 'docx')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0F3D2E] hover:bg-slate-50 disabled:opacity-60"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {busyId === `${p.id}_docx` ? 'Menyiapkan...' : 'Word (.docx)'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => handleExport(p, 'pdf')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {busyId === `${p.id}_pdf` ? 'Menyiapkan...' : 'PDF (A4)'}
                      </button>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            disabled={busyId !== null}
                            onClick={() => handleDuplicate(p)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            title="Duplikasi proposal menjadi pengajuan baru"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Duplikasi
                          </button>
                          <button
                            type="button"
                            disabled={busyId !== null}
                            onClick={() => handleToggleArchive(p)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            title={p.isArchived ? 'Keluarkan dari Arsip' : 'Tandai Arsip Permanen'}
                          >
                            {p.isArchived ? (
                              <>
                                <ArchiveRestore className="h-3.5 w-3.5 text-amber-600" />
                                Keluarkan
                              </>
                            ) : (
                              <>
                                <Archive className="h-3.5 w-3.5 text-[#9A742B]" />
                                Arsipkan
                              </>
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>

      {previewTarget && previewAssets && (
        <ProposalPreviewModal
          proposal={previewTarget}
          institution={institution}
          budget={previewAssets.budget}
          attachments={previewAssets.propAttachments}
          appSettings={appSettings}
          onClose={() => setPreviewTarget(null)}
        />
      )}
    </div>
  );
}
