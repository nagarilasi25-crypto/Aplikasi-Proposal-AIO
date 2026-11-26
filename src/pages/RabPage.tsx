import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  Eye,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { RabItem } from '../types/models';
import {
  formatAngka,
  formatRupiah,
  formatTanggalIndonesia,
  terbilangRupiah,
} from '../lib/formatters';
import { ProposalPreviewModal } from '../components/ProposalPreviewModal';

function createEmptyRabItem(groupName = 'Pekerjaan Utama', order = 1): RabItem {
  return {
    id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    groupName,
    order,
    description: '',
    volume: 1,
    unit: 'Unit',
    unitPrice: 0,
    totalPrice: 0,
  };
}

export function RabPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    appUser,
    institution,
    proposals,
    budgets,
    attachments,
    appSettings,
    saveBudget,
    deleteBudget,
  } = useAuth();
  const { showToast } = useToast();

  const canEdit = appUser?.role === 'Administrator' || appUser?.role === 'Operator';

  const [selectedProposalId, setSelectedProposalId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<RabItem[]>([createEmptyRabItem()]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Sync URL ?proposalId=... on initial load or param change
  useEffect(() => {
    const paramId = searchParams.get('proposalId') || '';
    if (paramId && proposals.some((p) => p.id === paramId)) {
      setSelectedProposalId(paramId);
    } else if (!selectedProposalId && proposals.length > 0) {
      setSelectedProposalId(proposals[0].id);
    }
  }, [searchParams, proposals, selectedProposalId]);

  const selectedProposal = useMemo(
    () => proposals.find((p) => p.id === selectedProposalId) || null,
    [proposals, selectedProposalId]
  );

  const existingBudget = useMemo(
    () => budgets.find((b) => b.proposalId === selectedProposalId) || null,
    [budgets, selectedProposalId]
  );

  useEffect(() => {
    if (!selectedProposal) {
      setTitle('');
      setNotes('');
      setItems([createEmptyRabItem()]);
      return;
    }
    if (existingBudget) {
      setTitle(existingBudget.title || `RAB - ${selectedProposal.title}`);
      setNotes(existingBudget.notes || '');
      setItems(
        existingBudget.items.length > 0
          ? existingBudget.items.map((it) => ({ ...it }))
          : [createEmptyRabItem()]
      );
    } else {
      setTitle(`RAB - ${selectedProposal.title}`);
      setNotes('');
      setItems([createEmptyRabItem()]);
    }
  }, [selectedProposal, existingBudget]);

  const handleSelectProposal = (proposalId: string) => {
    setSelectedProposalId(proposalId);
    if (proposalId) {
      setSearchParams({ proposalId });
    } else {
      setSearchParams({});
    }
  };

  const handleItemChange = (
    itemId: string,
    field: keyof RabItem,
    rawValue: string | number
  ) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const next: RabItem = { ...it, [field]: rawValue } as RabItem;
        if (field === 'volume' || field === 'unitPrice') {
          const vol = Math.max(0, Number(field === 'volume' ? rawValue : next.volume) || 0);
          const price = Math.max(0, Number(field === 'unitPrice' ? rawValue : next.unitPrice) || 0);
          next.volume = vol;
          next.unitPrice = price;
          next.totalPrice = Math.round(vol * price);
        }
        return next;
      })
    );
  };

  const handleAddRow = (groupName?: string) => {
    const fallbackGroup =
      groupName ||
      (items.length > 0 ? items[items.length - 1].groupName : 'Pekerjaan Utama');
    setItems((prev) => [...prev, createEmptyRabItem(fallbackGroup, prev.length + 1)]);
  };

  const handleRemoveRow = (itemId: string) => {
    setItems((prev) => {
      const filtered = prev.filter((it) => it.id !== itemId);
      return filtered.length > 0 ? filtered : [createEmptyRabItem()];
    });
  };

  const handleMoveRow = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next.map((it, idx) => ({ ...it, order: idx + 1 }));
    });
  };

  const groupedSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      const key = (it.groupName || 'Pekerjaan Umum').trim() || 'Pekerjaan Umum';
      map.set(key, (map.get(key) || 0) + (Number(it.totalPrice) || 0));
    }
    return Array.from(map.entries()).map(([groupName, subtotal]) => ({
      groupName,
      subtotal,
    }));
  }, [items]);

  const grandTotal = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.totalPrice) || 0), 0),
    [items]
  );

  const handleSave = async () => {
    if (!canEdit) return;
    if (!selectedProposalId) {
      showToast('Pilih proposal yang akan dihubungkan dengan RAB terlebih dahulu.', 'error');
      return;
    }

    const validItems = items
      .filter((it) => it.description.trim().length > 0)
      .map((it, idx) => {
        const vol = Math.max(0, Number(it.volume) || 0);
        const price = Math.max(0, Number(it.unitPrice) || 0);
        return {
          ...it,
          groupName: it.groupName.trim() || 'Pekerjaan Umum',
          description: it.description.trim(),
          unit: it.unit.trim() || 'Unit',
          volume: vol,
          unitPrice: price,
          totalPrice: Math.round(vol * price),
          order: idx + 1,
        };
      });

    if (validItems.length === 0) {
      showToast('Minimal isi 1 uraian pekerjaan/barang pada tabel RAB.', 'error');
      return;
    }

    setSaving(true);
    try {
      const { queuedOffline } = await saveBudget({
        id: existingBudget?.id,
        proposalId: selectedProposalId,
        proposalTitle: selectedProposal?.title,
        title: title.trim() || `RAB - ${selectedProposal?.title || 'Proposal'}`,
        notes: notes.trim(),
        items: validItems,
      });
      showToast(
        queuedOffline
          ? 'RAB disimpan lokal (offline) dan otomatis memperbarui total anggaran proposal.'
          : 'Rencana Anggaran Biaya (RAB) berhasil disimpan dan disinkronkan ke proposal.',
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan RAB.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!canEdit || !existingBudget) return;
    setDeleting(true);
    try {
      const { queuedOffline } = await deleteBudget(existingBudget.id);
      setItems([createEmptyRabItem()]);
      setNotes('');
      showToast(
        queuedOffline
          ? 'RAB dihapus secara lokal (offline) dan akan disinkronkan.'
          : 'Data RAB berhasil dihapus dari proposal.',
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus RAB.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const linkedAttachments = useMemo(() => {
    if (!selectedProposal) return [];
    const linkedIds = new Set(selectedProposal.attachmentIds || []);
    return attachments.filter(
      (a) => a.proposalId === selectedProposal.id || linkedIds.has(a.id)
    );
  }, [attachments, selectedProposal]);

  const previewBudget = useMemo(() => {
    if (!selectedProposal) return null;
    return {
      id: existingBudget?.id || 'preview_rab',
      institutionId: 'ar-raudhah',
      proposalId: selectedProposal.id,
      proposalTitle: selectedProposal.title,
      title: title || `RAB - ${selectedProposal.title}`,
      notes,
      items: items.filter((it) => it.description.trim().length > 0),
      totalAmount: grandTotal,
      createdAt: existingBudget?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: existingBudget?.createdBy || appUser?.uid || '',
      updatedBy: appUser?.uid || '',
    };
  }, [selectedProposal, existingBudget, title, notes, items, grandTotal, appUser]);

  return (
    <div className="space-y-6">
      {/* Header & Proposal Selector */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#111C18]">
              Rencana Anggaran Biaya (RAB)
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Susun rincian item anggaran dengan perhitungan otomatis volume × harga satuan serta pengelompokan pekerjaan.
            </p>
          </div>
          {selectedProposal && (
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-[#0F3D2E] hover:bg-slate-50 whitespace-nowrap"
            >
              <Eye className="h-4 w-4" />
              Pratinjau & Cetak A4
            </button>
          )}
        </div>

        {proposals.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
            <Calculator className="mx-auto h-9 w-9 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">
              Belum ada proposal tersimpan
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Buat proposal terlebih dahulu sebelum menyusun Rencana Anggaran Biaya (RAB).
            </p>
            <Link
              to="/buat-proposal"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#144D3A]"
            >
              <Plus className="h-4 w-4" />
              Buat Proposal Baru
            </Link>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <label className="block text-xs font-medium text-slate-700">
                Pilih Proposal Terkait
              </label>
              <select
                value={selectedProposalId}
                onChange={(e) => handleSelectProposal(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              >
                {proposals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.proposalNumber ? `[${p.proposalNumber}] ` : ''}
                    {p.title} ({p.fiscalYear})
                  </option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-6">
              <label className="block text-xs font-medium text-slate-700">Judul Dokumen RAB</label>
              <input
                type="text"
                disabled={!canEdit}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Contoh: RAB Pembangunan Ruang Kelas Baru"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
              />
            </div>
          </div>
        )}
      </section>

      {/* RAB Editor & Summary */}
      {selectedProposal && (
        <>
          {/* Grand Total Highlight Banner */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[#0F3D2E]/25 bg-[#0F3D2E] p-5 text-white sm:col-span-2">
              <p className="text-xs font-medium text-white/75">
                Total Anggaran RAB Saat Ini
              </p>
              <p className="mt-1.5 font-mono text-2xl font-bold tracking-tight tabular-nums">
                {formatRupiah(grandTotal)}
              </p>
              <p className="mt-1.5 text-xs italic text-[#F3DFB6]">
                Terbilang: {terbilangRupiah(grandTotal)}.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-medium text-slate-500">Status Proposal & Item</p>
              <p className="mt-1.5 text-sm font-semibold text-[#111C18]">
                {selectedProposal.status}
              </p>
              <p className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
                {items.filter((i) => i.description.trim()).length} item rincian · {groupedSummary.length} kelompok
              </p>
              {existingBudget?.updatedAt && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Terakhir diperbarui: {formatTanggalIndonesia(existingBudget.updatedAt)}
                </p>
              )}
            </div>
          </section>

          {/* RAB Items Table */}
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-[#111C18]">
                  Rincian Anggaran Biaya
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Kelompokkan item pekerjaan untuk menampilkan subtotal per kelompok pada dokumen Word dan PDF.
                </p>
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleAddRow('Pekerjaan Persiapan')}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    + Kelompok Baru
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddRow()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#144D3A]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah Baris Item
                  </button>
                </div>
              )}
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="px-2.5 py-2.5 font-semibold w-10">No</th>
                    <th className="px-2.5 py-2.5 font-semibold w-44">Kelompok Pekerjaan</th>
                    <th className="px-2.5 py-2.5 font-semibold">Uraian Pekerjaan / Barang</th>
                    <th className="px-2.5 py-2.5 font-semibold w-24 text-right">Volume</th>
                    <th className="px-2.5 py-2.5 font-semibold w-24">Satuan</th>
                    <th className="px-2.5 py-2.5 font-semibold w-36 text-right">Harga Satuan (Rp)</th>
                    <th className="px-2.5 py-2.5 font-semibold w-36 text-right">Jumlah (Rp)</th>
                    {canEdit && <th className="px-2.5 py-2.5 font-semibold w-24 text-center">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-50/50">
                      <td className="px-2.5 py-2 font-mono text-slate-500">{idx + 1}</td>
                      <td className="px-2.5 py-2">
                        <input
                          type="text"
                          disabled={!canEdit}
                          value={item.groupName}
                          onChange={(e) => handleItemChange(item.id, 'groupName', e.target.value)}
                          placeholder="Kelompok"
                          className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-2.5 py-2">
                        <input
                          type="text"
                          disabled={!canEdit}
                          value={item.description}
                          onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                          placeholder="Contoh: Semen Padang 50 kg / Meja Belajar"
                          className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-2.5 py-2">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          disabled={!canEdit}
                          value={item.volume}
                          onChange={(e) =>
                            handleItemChange(item.id, 'volume', Number(e.target.value))
                          }
                          className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-right font-mono text-xs text-[#111C18] tabular-nums focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-2.5 py-2">
                        <input
                          type="text"
                          disabled={!canEdit}
                          value={item.unit}
                          onChange={(e) => handleItemChange(item.id, 'unit', e.target.value)}
                          placeholder="Unit"
                          className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-2.5 py-2">
                        <input
                          type="number"
                          min={0}
                          disabled={!canEdit}
                          value={item.unitPrice}
                          onChange={(e) =>
                            handleItemChange(item.id, 'unitPrice', Number(e.target.value))
                          }
                          className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-right font-mono text-xs text-[#111C18] tabular-nums focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
                        />
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono font-semibold text-[#0F3D2E] tabular-nums whitespace-nowrap">
                        {formatRupiah(item.totalPrice)}
                      </td>
                      {canEdit && (
                        <td className="px-2.5 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleMoveRow(idx, -1)}
                              disabled={idx === 0}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                              title="Geser ke atas"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveRow(idx, 1)}
                              disabled={idx === items.length - 1}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                              title="Geser ke bawah"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(item.id)}
                              className="rounded p-1 text-red-500 hover:bg-red-50"
                              title="Hapus baris"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Group Subtotals Breakdown */}
            <div className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 lg:grid-cols-12">
              <div className="lg:col-span-6">
                <label className="block text-xs font-medium text-slate-700">
                  Catatan Tambahan RAB (Opsional)
                </label>
                <textarea
                  rows={3}
                  disabled={!canEdit}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: Harga satuan dapat menyesuaikan kondisi harga material saat pelaksanaan."
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
                />
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 lg:col-span-6">
                <p className="text-xs font-semibold text-[#111C18]">Ringkasan Per Kelompok</p>
                <div className="mt-2.5 space-y-1.5 text-xs">
                  {groupedSummary.map((grp) => (
                    <div key={grp.groupName} className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-600">{grp.groupName}</span>
                      <span className="font-mono font-medium text-[#111C18] tabular-nums">
                        {formatRupiah(grp.subtotal)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2 font-bold text-[#0F3D2E]">
                    <span>TOTAL KESELURUHAN</span>
                    <span className="font-mono tabular-nums">{formatRupiah(grandTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            {canEdit && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                {existingBudget ? (
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={handleDelete}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleting ? 'Menghapus...' : 'Hapus RAB'}
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">
                    Menyimpan RAB akan otomatis memperbarui Total Anggaran pada proposal terkait.
                  </span>
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Menyimpan...' : 'Simpan RAB & Sinkronkan Proposal'}
                </button>
              </div>
            )}
          </section>

          {/* Saved Budgets Overview */}
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-display text-base font-semibold text-[#111C18]">
              Daftar RAB Tersimpan ({budgets.length})
            </h3>
            {budgets.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                Belum ada RAB yang disimpan. Pilih proposal di atas lalu simpan rincian anggaran.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {budgets.map((b) => {
                  const active = b.proposalId === selectedProposalId;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => handleSelectProposal(b.proposalId)}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        active
                          ? 'border-[#0F3D2E] bg-emerald-50/40'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <p className="truncate text-xs font-semibold text-[#111C18]">
                        {b.title}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {b.proposalTitle || 'Proposal terkait'}
                      </p>
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-500">{formatAngka(b.items.length)} item</span>
                        <span className="font-mono font-bold text-[#0F3D2E] tabular-nums">
                          {formatRupiah(b.totalAmount)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {showPreview && selectedProposal && (
        <ProposalPreviewModal
          proposal={{ ...selectedProposal, totalBudget: grandTotal }}
          institution={institution}
          budget={previewBudget}
          attachments={linkedAttachments}
          appSettings={appSettings}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
