import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Edit3,
  FileText,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { ProposalTemplate, TemplateSection } from '../types/models';

export function TemplatesPage() {
  const { appUser, templates, saveTemplate, duplicateTemplate, deleteTemplate } = useAuth();
  const { showToast } = useToast();

  const canEdit = appUser?.role === 'Administrator' || appUser?.role === 'Operator';
  const canDelete = appUser?.role === 'Administrator';

  const [selected, setSelected] = useState<ProposalTemplate | null>(null);
  const [name, setName] = useState('');
  const [proposalType, setProposalType] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [saving, setSaving] = useState(false);

  const openEditor = (tpl?: ProposalTemplate) => {
    if (tpl) {
      setSelected(tpl);
      setName(tpl.name);
      setProposalType(tpl.proposalType);
      setDescription(tpl.description);
      setIsActive(tpl.isActive);
      setSections(
        [...tpl.sections]
          .sort((a, b) => a.order - b.order)
          .map((s) => ({ ...s }))
      );
    } else {
      const blank: ProposalTemplate = {
        id: '',
        institutionId: 'ar-raudhah',
        name: '',
        proposalType: 'Umum',
        description: '',
        sections: [
          {
            id: `sec_${Date.now()}_1`,
            key: 'pendahuluan',
            title: 'I. Pendahuluan & Latar Belakang',
            description: 'Latar belakang urgensi pengajuan proposal.',
            defaultContent: '',
            order: 1,
            enabled: true,
            required: true,
          },
          {
            id: `sec_${Date.now()}_2`,
            key: 'maksud_tujuan',
            title: 'II. Maksud dan Tujuan',
            description: 'Tujuan utama pelaksanaan program atau bantuan.',
            defaultContent: '',
            order: 2,
            enabled: true,
            required: true,
          },
          {
            id: `sec_${Date.now()}_3`,
            key: 'penutup',
            title: 'III. Penutup',
            description: 'Harapan dan pertanggungjawaban lembaga.',
            defaultContent: '',
            order: 3,
            enabled: true,
            required: true,
          },
        ],
        isActive: true,
        createdAt: '',
        updatedAt: '',
        createdBy: '',
        updatedBy: '',
      };
      setSelected(blank);
      setName(blank.name);
      setProposalType(blank.proposalType);
      setDescription(blank.description);
      setIsActive(true);
      setSections(blank.sections);
    }
  };

  const closeEditor = () => {
    setSelected(null);
  };

  const addSection = () => {
    const nextOrder = sections.length + 1;
    setSections((prev) => [
      ...prev,
      {
        id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        key: `bab_${nextOrder}`,
        title: `Bab ${nextOrder}. Judul Bab Baru`,
        description: '',
        defaultContent: '',
        order: nextOrder,
        enabled: true,
      },
    ]);
  };

  const moveSection = (index: number, dir: -1 | 1) => {
    const targetIdx = index + dir;
    if (targetIdx < 0 || targetIdx >= sections.length) return;
    const next = [...sections];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);
    setSections(next.map((s, i) => ({ ...s, order: i + 1 })));
  };

  const removeSection = (index: number) => {
    if (sections.length <= 1) {
      showToast('Template harus memiliki minimal 1 bab dokumen.', 'error');
      return;
    }
    const next = sections.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 }));
    setSections(next);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || !selected) return;
    if (!name.trim()) {
      showToast('Nama template wajib diisi.', 'error');
      return;
    }

    setSaving(true);
    try {
      const { queuedOffline } = await saveTemplate({
        id: selected.id || undefined,
        name: name.trim(),
        proposalType: proposalType.trim() || 'Umum',
        description: description.trim(),
        isActive,
        sections: sections.map((s, i) => ({
          ...s,
          key: s.key.trim() || `bab_${i + 1}`,
          title: s.title.trim() || `Bab ${i + 1}`,
          order: i + 1,
        })),
      });
      showToast(
        queuedOffline
          ? 'Template disimpan lokal dan akan disinkronkan saat online.'
          : 'Master template proposal berhasil disimpan.',
        queuedOffline ? 'info' : 'success'
      );
      closeEditor();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan template.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (tpl: ProposalTemplate) => {
    try {
      const { queuedOffline } = await duplicateTemplate(tpl.id);
      showToast(
        queuedOffline
          ? `Salinan template "${tpl.name}" disimpan secara offline.`
          : `Template "${tpl.name}" berhasil diduplikasi.`,
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menduplikasi template.', 'error');
    }
  };

  const handleDelete = async (tpl: ProposalTemplate) => {
    if (!canDelete) return;
    try {
      const { queuedOffline } = await deleteTemplate(tpl.id);
      if (selected?.id === tpl.id) closeEditor();
      showToast(
        queuedOffline
          ? 'Penghapusan template masuk antrean sinkronisasi.'
          : `Template "${tpl.name}" berhasil dihapus.`,
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus template.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-lg font-bold text-[#111C18]">
            Master Template Proposal
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Kelola struktur bab proposal standar untuk berbagai kebutuhan pengajuan. Bab dapat ditambah, diurutkan, diaktifkan, atau diduplikasi.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => openEditor()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#144D3A] whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            Buat Template Baru
          </button>
        )}
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((tpl) => {
          const enabledCount = tpl.sections.filter((s) => s.enabled).length;
          return (
            <article
              key={tpl.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-[#0F3D2E]">
                      <FileText className="h-4 w-4" />
                    </div>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9A742B]">
                      {tpl.proposalType}
                    </span>
                  </div>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      tpl.isActive
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {tpl.isActive ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>

                <h3 className="mt-3 font-display text-sm font-bold text-[#111C18]">
                  {tpl.name}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                  {tpl.description || 'Struktur proposal standar lembaga.'}
                </p>

                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <span className="font-semibold text-[#0F3D2E]">{enabledCount}</span> bab aktif dari{' '}
                  {tpl.sections.length} total bab
                </div>
              </div>

              {canEdit && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => openEditor(tpl)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-[#111C18] hover:bg-slate-50"
                  >
                    <Edit3 className="h-3.5 w-3.5 text-[#0F3D2E]" />
                    Sunting Bab
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicate(tpl)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    title="Duplikasi template"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Duplikasi
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(tpl)}
                      className="rounded-lg border border-slate-200 p-1.5 text-red-600 hover:bg-red-50"
                      title="Hapus template"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Editor Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-bold text-[#111C18]">
                {selected.id ? 'Sunting Master Template' : 'Buat Master Template Baru'}
              </h3>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Nama Template</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Contoh: Template Proposal Pembangunan"
                    className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Jenis Proposal</label>
                  <input
                    type="text"
                    required
                    value={proposalType}
                    onChange={(e) => setProposalType(e.target.value)}
                    placeholder="Pembangunan / Tahfidz / Operasional"
                    className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Deskripsi Template</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0F3D2E]"
                />
                Template aktif dan dapat dipilih saat menyusun proposal
              </label>

              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-display text-sm font-semibold text-[#111C18]">
                    Daftar & Urutan Bab Proposal ({sections.length})
                  </h4>
                  <button
                    type="button"
                    onClick={addSection}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-[#0F3D2E] hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" /> Tambah Bab
                  </button>
                </div>

                <div className="mt-3 space-y-3">
                  {sections.map((sec, idx) => (
                    <div
                      key={sec.id}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-[#0F3D2E]">
                          Urutan #{idx + 1}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 mr-2">
                            <input
                              type="checkbox"
                              checked={sec.enabled}
                              onChange={(e) =>
                                setSections((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { ...item, enabled: e.target.checked } : item
                                  )
                                )
                              }
                            />
                            Aktif
                          </label>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveSection(idx, -1)}
                            className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                            title="Geser naik"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === sections.length - 1}
                            onClick={() => moveSection(idx, 1)}
                            className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                            title="Geser turun"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSection(idx)}
                            className="rounded border border-slate-200 bg-white p-1 text-red-600 hover:bg-red-50"
                            title="Hapus bab"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <input
                        type="text"
                        value={sec.title}
                        onChange={(e) =>
                          setSections((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, title: e.target.value } : item
                            )
                          )
                        }
                        placeholder="Judul bab"
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                      />
                      <input
                        type="text"
                        value={sec.description}
                        onChange={(e) =>
                          setSections((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, description: e.target.value } : item
                            )
                          )
                        }
                        placeholder="Panduan isi bab..."
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-[#0F3D2E] focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-5 py-2 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? 'Menyimpan...' : 'Simpan Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
