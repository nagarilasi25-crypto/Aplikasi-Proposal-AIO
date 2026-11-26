import React, { useState } from 'react';
import { Edit3, Plus, Save, Tags, Trash2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { ProposalCategory } from '../types/models';

export function CategoriesPage() {
  const { appUser, categories, saveCategory, deleteCategory } = useAuth();
  const { showToast } = useToast();

  const canEdit = appUser?.role === 'Administrator' || appUser?.role === 'Operator';
  const canDelete = appUser?.role === 'Administrator';

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setCode('');
    setDescription('');
    setIsActive(true);
  };

  const handleEdit = (cat: ProposalCategory) => {
    setEditingId(cat.id);
    setName(cat.name);
    setCode(cat.code || '');
    setDescription(cat.description || '');
    setIsActive(cat.isActive);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    if (!name.trim()) {
      showToast('Nama kategori proposal wajib diisi.', 'error');
      return;
    }

    setSaving(true);
    try {
      const { queuedOffline } = await saveCategory({
        id: editingId || undefined,
        name: name.trim(),
        code: code.trim().toUpperCase() || name.trim().slice(0, 3).toUpperCase(),
        description: description.trim(),
        isActive,
      });
      showToast(
        queuedOffline
          ? 'Kategori disimpan secara lokal dan akan disinkronkan otomatis saat online.'
          : editingId
          ? 'Kategori proposal berhasil diperbarui.'
          : 'Kategori proposal berhasil ditambahkan.',
        queuedOffline ? 'info' : 'success'
      );
      resetForm();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan kategori.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cat: ProposalCategory) => {
    if (!canDelete) return;
    try {
      const { queuedOffline } = await deleteCategory(cat.id);
      if (editingId === cat.id) resetForm();
      showToast(
        queuedOffline
          ? 'Penghapusan kategori masuk antrean sinkronisasi.'
          : `Kategori "${cat.name}" berhasil dihapus.`,
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus kategori.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#111C18]">
              Kategori Proposal Resmi
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Kelompokkan jenis proposal untuk penomoran surat otomatis, pengarsipan, serta grafik rekapitulasi.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Tags className="h-4 w-4 text-[#0F3D2E]" />
            <span>{categories.length} Kategori Terdaftar</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {canEdit && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-4 h-fit">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-[#111C18]">
                {editingId ? 'Ubah Kategori' : 'Tambah Kategori Baru'}
              </h3>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" /> Batal
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Nama Kategori</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Pembangunan Asrama"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Kode Klasifikasi (Maks. 6 huruf)
                </label>
                <input
                  type="text"
                  maxLength={12}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="Contoh: PBG"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm uppercase text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Keterangan</label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Deskripsi singkat ruang lingkup kategori..."
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0F3D2E] focus:ring-[#0F3D2E]"
                />
                Kategori Aktif (tampil pada pilihan buat proposal)
              </label>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
              >
                {editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {saving ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Tambahkan Kategori'}
              </button>
            </form>
          </section>
        )}

        <section
          className={`rounded-xl border border-slate-200 bg-white p-6 ${
            canEdit ? 'lg:col-span-8' : 'lg:col-span-12'
          }`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="pb-3 pr-4">Kode</th>
                  <th className="pb-3 pr-4">Nama Kategori</th>
                  <th className="pb-3 pr-4">Keterangan</th>
                  <th className="pb-3 pr-4">Status</th>
                  {canEdit && <th className="pb-3 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-slate-50/70">
                    <td className="py-3 pr-4 font-mono text-xs font-semibold text-[#0F3D2E] whitespace-nowrap">
                      {cat.code || '-'}
                    </td>
                    <td className="py-3 pr-4 font-medium text-[#111C18]">{cat.name}</td>
                    <td className="py-3 pr-4 text-xs text-slate-600">
                      {cat.description || '-'}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${
                          cat.isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {cat.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEdit(cat)}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                            title="Ubah kategori"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => handleDelete(cat)}
                              className="rounded-md border border-slate-200 p-1.5 text-red-600 hover:bg-red-50"
                              title="Hapus kategori"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
