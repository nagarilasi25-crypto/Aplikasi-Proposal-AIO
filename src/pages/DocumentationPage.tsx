import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Download,
  FileText,
  Image as ImageIcon,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { ATTACHMENT_CATEGORIES, AttachmentCategory, ProposalAttachment } from '../types/models';
import { isSafeImageUrl, processImageFileToDataUrl } from '../lib/imageUtils';
import { formatTanggalIndonesia } from '../lib/formatters';

function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DocumentationPage() {
  const [searchParams] = useSearchParams();
  const { appUser, proposals, attachments, createAttachment, deleteAttachment } = useAuth();
  const { showToast } = useToast();

  const canEdit = appUser?.role === 'Administrator' || appUser?.role === 'Operator';

  // Upload Form State
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<AttachmentCategory>('Foto Lokasi');
  const [proposalId, setProposalId] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<{
    dataUrl: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    isImage: boolean;
  } | null>(null);
  const [uploading, setUploading] = useState(false);

  // Filter & Preview State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterProposalId, setFilterProposalId] = useState<string>('ALL');
  const [lightboxItem, setLightboxItem] = useState<ProposalAttachment | null>(null);

  useEffect(() => {
    const paramId = searchParams.get('proposalId');
    if (paramId && proposals.some((p) => p.id === paramId)) {
      setProposalId(paramId);
      setFilterProposalId(paramId);
    }
  }, [searchParams, proposals]);

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImg = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type);

    if (!isPdf && !isImg) {
      showToast('Format berkas harus PNG, JPG, WebP, atau PDF.', 'error');
      return;
    }

    try {
      if (isImg) {
        const dataUrl = await processImageFileToDataUrl(file, {
          maxDimension: 1280,
          quality: 0.84,
        });
        if (!title.trim()) {
          setTitle(file.name.replace(/\.[^.]+$/, ''));
        }
        setSelectedFile({
          dataUrl,
          fileName: file.name,
          mimeType: dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
          fileSize: Math.round((dataUrl.length * 3) / 4),
          isImage: true,
        });
      } else {
        if (file.size > 4 * 1024 * 1024) {
          showToast('Ukuran berkas PDF maksimal 4 MB.', 'error');
          return;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Gagal membaca berkas PDF.'));
          reader.readAsDataURL(file);
        });
        if (!title.trim()) {
          setTitle(file.name.replace(/\.[^.]+$/, ''));
        }
        setSelectedFile({
          dataUrl,
          fileName: file.name,
          mimeType: 'application/pdf',
          fileSize: file.size,
          isImage: false,
        });
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal memproses berkas.', 'error');
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    if (!title.trim()) {
      showToast('Judul lampiran wajib diisi.', 'error');
      return;
    }
    if (!selectedFile) {
      showToast('Pilih foto atau dokumen PDF terlebih dahulu.', 'error');
      return;
    }

    const linkedProp = proposals.find((p) => p.id === proposalId);
    setUploading(true);
    try {
      const { queuedOffline } = await createAttachment({
        proposalId: linkedProp?.id || '',
        proposalTitle: linkedProp?.title || '',
        category,
        title: title.trim(),
        description: description.trim(),
        dataUrl: selectedFile.dataUrl,
        fileName: selectedFile.fileName,
        mimeType: selectedFile.mimeType,
        fileSize: selectedFile.fileSize,
        isImage: selectedFile.isImage,
      });
      setTitle('');
      setDescription('');
      setSelectedFile(null);
      showToast(
        queuedOffline
          ? 'Lampiran disimpan lokal (offline) dan akan tersinkron otomatis.'
          : 'Lampiran dokumentasi berhasil diunggah.',
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal mengunggah lampiran.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (att: ProposalAttachment) => {
    if (!canEdit) return;
    try {
      const { queuedOffline } = await deleteAttachment(att.id);
      showToast(
        queuedOffline
          ? `Lampiran "${att.title}" dihapus lokal (offline).`
          : `Lampiran "${att.title}" berhasil dihapus.`,
        queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus lampiran.', 'error');
    }
  };

  const filteredAttachments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return attachments.filter((att) => {
      if (filterCategory !== 'ALL' && att.category !== filterCategory) return false;
      if (filterProposalId !== 'ALL') {
        if (filterProposalId === 'UNLINKED') {
          if (att.proposalId) return false;
        } else if (att.proposalId !== filterProposalId) {
          return false;
        }
      }
      if (!q) return true;
      return (
        att.title.toLowerCase().includes(q) ||
        (att.description || '').toLowerCase().includes(q) ||
        (att.proposalTitle || '').toLowerCase().includes(q) ||
        att.fileName.toLowerCase().includes(q)
      );
    });
  }, [attachments, filterCategory, filterProposalId, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Upload Form */}
      {canEdit && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div>
            <h2 className="font-display text-lg font-bold text-[#111C18]">
              Unggah Dokumentasi & Lampiran
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Unggah foto lokasi, bangunan, kegiatan, surat pendukung, atau berkas PDF legalitas (otomatis tersedia untuk lampiran proposal).
            </p>
          </div>

          <form onSubmit={handleUploadSubmit} className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <label className="block text-xs font-medium text-slate-700">
                Judul Dokumentasi / Berkas <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Contoh: Foto Lokasi Pembangunan Lantai 2"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>

            <div className="lg:col-span-4">
              <label className="block text-xs font-medium text-slate-700">Kategori Lampiran</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as AttachmentCategory)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              >
                {ATTACHMENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-4">
              <label className="block text-xs font-medium text-slate-700">
                Hubungkan ke Proposal (Opsional)
              </label>
              <select
                value={proposalId}
                onChange={(e) => setProposalId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              >
                <option value="">-- Arsip Umum Lembaga --</option>
                {proposals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.proposalNumber ? `[${p.proposalNumber}] ` : ''}
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-6">
              <label className="block text-xs font-medium text-slate-700">Keterangan Singkat</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Catatan kondisi foto atau nomor dokumen"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>

            <div className="lg:col-span-6">
              <label className="block text-xs font-medium text-slate-700">
                Pilih Berkas (PNG / JPG / WebP / PDF maks. 4 MB)
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-semibold text-[#0F3D2E] hover:bg-slate-100">
                  <Upload className="h-4 w-4" />
                  <span>{selectedFile ? 'Ganti Berkas' : 'Pilih Berkas'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={handleFilePick}
                    className="hidden"
                  />
                </label>
                {selectedFile && (
                  <span className="truncate text-xs text-slate-600">
                    {selectedFile.fileName} ({formatFileSize(selectedFile.fileSize)})
                  </span>
                )}
              </div>
            </div>

            {selectedFile && selectedFile.isImage && (
              <div className="lg:col-span-12">
                <img
                  src={selectedFile.dataUrl}
                  alt="Pratinjau unggahan"
                  className="h-36 rounded-lg border border-slate-200 object-cover"
                />
              </div>
            )}

            <div className="flex justify-end lg:col-span-12">
              <button
                type="submit"
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
              >
                <Upload className="h-4 w-4" />
                {uploading ? 'Mengunggah...' : 'Simpan Dokumentasi'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Gallery & Filter */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-display text-base font-semibold text-[#111C18]">
              Galeri Dokumentasi & Berkas ({filteredAttachments.length})
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Seluruh foto dan dokumen tersimpan aman pada server serta cache offline peramban.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari lampiran..."
                className="w-48 rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            >
              <option value="ALL">Semua Kategori</option>
              {ATTACHMENT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <select
              value={filterProposalId}
              onChange={(e) => setFilterProposalId(e.target.value)}
              className="max-w-[200px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            >
              <option value="ALL">Semua Proposal</option>
              <option value="UNLINKED">Arsip Umum Lembaga</option>
              {proposals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredAttachments.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center">
            <ImageIcon className="h-9 w-9 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              Belum ada dokumentasi yang sesuai filter
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Unggah foto lokasi atau berkas pendukung baru menggunakan formulir di atas.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredAttachments.map((att) => (
              <article
                key={att.id}
                className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                {att.isImage && isSafeImageUrl(att.fileUrl) ? (
                  <button
                    type="button"
                    onClick={() => setLightboxItem(att)}
                    className="group relative h-44 w-full overflow-hidden bg-slate-100 text-left"
                  >
                    <img
                      src={att.fileUrl}
                      alt={att.title}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </button>
                ) : (
                  <div className="flex h-44 flex-col items-center justify-center bg-slate-50 px-4 text-center">
                    <FileText className="h-10 w-10 text-[#0F3D2E]" />
                    <p className="mt-2 truncate max-w-full text-xs font-medium text-slate-700">
                      {att.fileName}
                    </p>
                    <span className="mt-0.5 text-[11px] text-slate-400">
                      Dokumen PDF · {formatFileSize(att.fileSize)}
                    </span>
                  </div>
                )}

                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <p className="text-[11px] font-semibold text-[#9A742B]">{att.category}</p>
                    <h4 className="mt-1 font-display text-sm font-bold text-[#111C18] line-clamp-1">
                      {att.title}
                    </h4>
                    {att.description && (
                      <p className="mt-1 text-xs text-slate-600 line-clamp-2">{att.description}</p>
                    )}
                    {att.proposalTitle && (
                      <p className="mt-2 truncate text-[11px] text-slate-500">
                        Proposal: {att.proposalTitle}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="text-[11px] text-slate-400">
                      {formatTanggalIndonesia(att.createdAt)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <a
                        href={att.fileUrl}
                        download={att.fileName}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-[#0F3D2E] hover:bg-slate-50"
                      >
                        <Download className="h-3 w-3" />
                        Unduh
                      </a>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleDelete(att)}
                          className="rounded border border-red-200 p-1 text-red-600 hover:bg-red-50"
                          title="Hapus lampiran"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Lightbox Modal */}
      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={() => setLightboxItem(null)}
        >
          <div
            className="max-h-[90vh] max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-[#111C18]">{lightboxItem.title}</p>
                <p className="text-xs text-slate-500">{lightboxItem.category}</p>
              </div>
              <button
                type="button"
                onClick={() => setLightboxItem(null)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="bg-slate-900 p-3">
              <img
                src={lightboxItem.fileUrl}
                alt={lightboxItem.title}
                className="mx-auto max-h-[70vh] object-contain"
              />
            </div>
            {lightboxItem.description && (
              <p className="px-4 py-3 text-xs text-slate-600">{lightboxItem.description}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
