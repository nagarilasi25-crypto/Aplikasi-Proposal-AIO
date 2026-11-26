import React, { useEffect, useState } from 'react';
import { Building2, Save, Upload, ImageIcon, RotateCcw, Trash2, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import {
  BLUEPRINT_LIMITS,
  InstitutionProfile,
} from '../types/models';
import { sanitizeNumber, sanitizeString } from '../lib/formatters';
import { isSafeImageUrl, processImageFileToDataUrl } from '../lib/imageUtils';

export function InstitutionProfilePage() {
  const {
    appUser,
    institution,
    institutionLoading,
    saveInstitution,
    uploadInstitutionImage,
    generateAiNarrative,
  } = useAuth();
  const { showToast } = useToast();

  const canEdit = appUser?.role === 'Administrator';

  const [form, setForm] = useState({
    name: '',
    logoUrl: '',
    photoUrl: '',
    address: '',
    kecamatan: '',
    kabupaten: '',
    provinsi: '',
    negara: '',
    phone: '',
    email: '',
    foundedYear: '',
    statisticNumber: '',
    legalityInfo: '',
    leaderName: '',
    history: '',
    vision: '',
    mission: '',
    organizationStructure: '',
    studentCount: 0,
    teacherCount: 0,
  });

  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState<'logoUrl' | 'photoUrl' | null>(null);
  const [logoImgError, setLogoImgError] = useState(false);
  const [photoImgError, setPhotoImgError] = useState(false);
  const [aiNotes, setAiNotes] = useState('');
  const [aiGenerating, setAiGenerating] = useState<
    'history' | 'vision' | 'mission' | 'organizationStructure' | 'all' | null
  >(null);

  useEffect(() => {
    if (institution) {
      setForm({
        name: institution.name || '',
        logoUrl: institution.logoUrl || '',
        photoUrl: institution.photoUrl || '',
        address: institution.address || '',
        kecamatan: institution.kecamatan || '',
        kabupaten: institution.kabupaten || '',
        provinsi: institution.provinsi || '',
        negara: institution.negara || '',
        phone: institution.phone || '',
        email: institution.email || '',
        foundedYear: institution.foundedYear || '',
        statisticNumber: institution.statisticNumber || '',
        legalityInfo: institution.legalityInfo || '',
        leaderName: institution.leaderName || '',
        history: institution.history || '',
        vision: institution.vision || '',
        mission: institution.mission || '',
        organizationStructure: institution.organizationStructure || '',
        studentCount: institution.studentCount ?? 0,
        teacherCount: institution.teacherCount ?? 0,
      });
      setLogoImgError(false);
      setPhotoImgError(false);
    }
  }, [institution]);

  const buildSanitizedPayload = (overrides?: Partial<typeof form>): InstitutionProfile => {
    const merged = { ...form, ...(overrides || {}) };
    const cleanImageValue = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return '';
      if (!isSafeImageUrl(trimmed)) return '';
      if (trimmed.startsWith('data:image/')) return trimmed;
      return sanitizeString(trimmed, BLUEPRINT_LIMITS.institution.logoUrlMax);
    };

    return {
      name: sanitizeString(merged.name, BLUEPRINT_LIMITS.institution.nameMax),
      logoUrl: cleanImageValue(merged.logoUrl),
      photoUrl: cleanImageValue(merged.photoUrl),
      address: sanitizeString(merged.address, BLUEPRINT_LIMITS.institution.addressMax),
      kecamatan: sanitizeString(merged.kecamatan, BLUEPRINT_LIMITS.institution.kecamatanMax),
      kabupaten: sanitizeString(merged.kabupaten, BLUEPRINT_LIMITS.institution.kabupatenMax),
      provinsi: sanitizeString(merged.provinsi, BLUEPRINT_LIMITS.institution.provinsiMax),
      negara: sanitizeString(merged.negara, BLUEPRINT_LIMITS.institution.negaraMax),
      phone: sanitizeString(merged.phone, BLUEPRINT_LIMITS.institution.phoneMax),
      email: sanitizeString(merged.email, BLUEPRINT_LIMITS.institution.emailMax),
      foundedYear: sanitizeString(merged.foundedYear, BLUEPRINT_LIMITS.institution.foundedYearMax),
      statisticNumber: sanitizeString(
        merged.statisticNumber,
        BLUEPRINT_LIMITS.institution.statisticNumberMax
      ),
      legalityInfo: sanitizeString(merged.legalityInfo, BLUEPRINT_LIMITS.institution.legalityInfoMax),
      leaderName: sanitizeString(merged.leaderName, BLUEPRINT_LIMITS.institution.leaderNameMax),
      history: sanitizeString(merged.history, BLUEPRINT_LIMITS.institution.historyMax),
      vision: sanitizeString(merged.vision, BLUEPRINT_LIMITS.institution.visionMax),
      mission: sanitizeString(merged.mission, BLUEPRINT_LIMITS.institution.missionMax),
      organizationStructure: sanitizeString(
        merged.organizationStructure,
        BLUEPRINT_LIMITS.institution.organizationStructureMax
      ),
      studentCount: sanitizeNumber(merged.studentCount, 0, 1000000),
      teacherCount: sanitizeNumber(merged.teacherCount, 0, 1000000),
      createdBy: institution?.createdBy || appUser?.uid || '',
      updatedBy: appUser?.uid || '',
    };
  };

  const handleImageUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    field: 'logoUrl' | 'photoUrl'
  ) => {
    const file = event.target.files?.[0];
    if (!file || !canEdit) return;

    const allowedMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedMime.includes(file.type.toLowerCase())) {
      showToast('Hanya berkas gambar PNG, JPG, atau WebP yang diperbolehkan.', 'error');
      event.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Ukuran berkas sumber maksimal 5 MB.', 'error');
      event.target.value = '';
      return;
    }

    setUploadingField(field);
    try {
      const processedDataUrl = await processImageFileToDataUrl(
        file,
        field === 'logoUrl'
          ? { maxDimension: 512, quality: 0.9, preserveAlpha: true }
          : { maxDimension: 1280, quality: 0.84, preserveAlpha: false }
      );

      const basePayload = buildSanitizedPayload({ [field]: processedDataUrl });
      const result = await uploadInstitutionImage(field, processedDataUrl, basePayload);

      setForm((prev) => ({ ...prev, [field]: result.url }));
      if (field === 'logoUrl') setLogoImgError(false);
      else setPhotoImgError(false);

      showToast(
        result.queuedOffline
          ? `${field === 'logoUrl' ? 'Logo' : 'Foto'} lembaga disimpan secara lokal dan akan otomatis tersinkron saat internet terhubung.`
          : `${field === 'logoUrl' ? 'Logo' : 'Foto'} lembaga berhasil diunggah dan tersimpan.`,
        result.queuedOffline ? 'info' : 'success'
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Gagal memproses atau mengunggah berkas gambar.',
        'error'
      );
    } finally {
      setUploadingField(null);
      event.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser || !canEdit) return;

    if (form.logoUrl.trim() && !isSafeImageUrl(form.logoUrl)) {
      showToast('URL Logo Lembaga harus diawali http://, https://, atau berupa gambar unggahan.', 'error');
      return;
    }
    if (form.photoUrl.trim() && !isSafeImageUrl(form.photoUrl)) {
      showToast('URL Foto Lembaga harus diawali http://, https://, atau berupa gambar unggahan.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = buildSanitizedPayload();
      const { queuedOffline } = await saveInstitution(payload);
      if (queuedOffline) {
        showToast(
          'Profil disimpan secara lokal (offline) dan akan otomatis tersinkron saat internet terhubung.',
          'info'
        );
      } else {
        showToast('Profil lembaga berhasil disimpan.', 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan profil lembaga.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateAi = async (
    section: 'history' | 'vision' | 'mission' | 'organizationStructure' | 'all'
  ) => {
    if (!canEdit) return;
    setAiGenerating(section);
    try {
      const result = await generateAiNarrative({
        target: 'institution_section',
        section,
        institution: buildSanitizedPayload(),
        userNotes: aiNotes.trim() || undefined,
      });

      setForm((prev) => ({
        ...prev,
        ...(typeof result.history === 'string' && result.history ? { history: result.history } : {}),
        ...(typeof result.vision === 'string' && result.vision ? { vision: result.vision } : {}),
        ...(typeof result.mission === 'string' && result.mission ? { mission: result.mission } : {}),
        ...(typeof result.organizationStructure === 'string' && result.organizationStructure
          ? { organizationStructure: result.organizationStructure }
          : {}),
      }));

      showToast(
        section === 'all'
          ? 'Keempat narasi profil berhasil disusun AI. Silakan tinjau lalu klik Simpan Profil Lembaga.'
          : 'Narasi bagian terpilih berhasil disusun AI. Silakan tinjau lalu klik Simpan Profil Lembaga.',
        'success'
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Gagal membuat narasi menggunakan AI.',
        'error'
      );
    } finally {
      setAiGenerating(null);
    }
  };

  if (institutionLoading) {
    return (
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    );
  }

  const safeLogoPreview = isSafeImageUrl(form.logoUrl) ? form.logoUrl : '';
  const safePhotoPreview = isSafeImageUrl(form.photoUrl) ? form.photoUrl : '';
  const isLocalLogoData = form.logoUrl.startsWith('data:image/');
  const isLocalPhotoData = form.photoUrl.startsWith('data:image/');

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-lg font-bold text-[#111C18]">
            Profil Resmi Lembaga
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Data ini menjadi sumber otomatis untuk kop surat, tanda tangan pimpinan, dan identitas pada seluruh proposal.
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                setForm({
                  name: '',
                  logoUrl: '',
                  photoUrl: '',
                  address: '',
                  kecamatan: '',
                  kabupaten: '',
                  provinsi: '',
                  negara: '',
                  phone: '',
                  email: '',
                  foundedYear: '',
                  statisticNumber: '',
                  legalityInfo: '',
                  leaderName: '',
                  history: '',
                  vision: '',
                  mission: '',
                  organizationStructure: '',
                  studentCount: 0,
                  teacherCount: 0,
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
            >
              <RotateCcw className="h-4 w-4" />
              Kosongkan
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F3D2E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#144D3A] disabled:opacity-60 whitespace-nowrap"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Menyimpan...' : 'Simpan Profil Lembaga'}
            </button>
          </div>
        ) : (
          <p className="text-xs font-medium text-slate-500">
            Mode Lihat Saja · Perubahan hanya dapat dilakukan oleh Administrator
          </p>
        )}
      </div>

      {/* Visual Assets: Logo & Foto Lembaga */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="font-display text-sm font-semibold text-[#111C18]">Logo Lembaga</h3>
          <p className="mt-1 text-xs text-slate-500">
            Dapat diunggah kapan saja (online maupun offline) dan otomatis disinkronkan saat terhubung ke internet.
          </p>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2">
              {safeLogoPreview && !logoImgError ? (
                <img
                  src={safeLogoPreview}
                  alt="Logo Lembaga"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoImgError(true)}
                  className="h-full w-full object-contain"
                />
              ) : (
                <Building2 className="h-8 w-8 text-slate-400" />
              )}
            </div>
            <div className="flex-1 space-y-2.5">
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <Upload className="h-3.5 w-3.5 text-[#0F3D2E]" />
                    <span>{uploadingField === 'logoUrl' ? 'Memproses...' : 'Unggah File Logo'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={uploadingField !== null}
                      onChange={(e) => handleImageUpload(e, 'logoUrl')}
                      className="hidden"
                    />
                  </label>
                  {form.logoUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setLogoImgError(false);
                        setForm({ ...form, logoUrl: '' });
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Hapus
                    </button>
                  )}
                </div>
              )}
              {isLocalLogoData ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  Logo tersimpan lokal pada perangkat ini (siap disinkronkan otomatis saat online).
                </p>
              ) : (
                <input
                  type="text"
                  value={form.logoUrl}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setLogoImgError(false);
                    setForm({ ...form, logoUrl: e.target.value });
                  }}
                  placeholder="Atau tempel URL gambar logo (opsional)"
                  maxLength={BLUEPRINT_LIMITS.institution.logoUrlMax}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
                />
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="font-display text-sm font-semibold text-[#111C18]">Foto Lembaga</h3>
          <p className="mt-1 text-xs text-slate-500">
            Foto gedung atau aktivitas utama lembaga (PNG, JPG, WebP · otomatis dioptimalkan).
          </p>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {safePhotoPreview && !photoImgError ? (
                <img
                  src={safePhotoPreview}
                  alt="Foto Lembaga"
                  referrerPolicy="no-referrer"
                  onError={() => setPhotoImgError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-slate-400">
                  <ImageIcon className="h-6 w-6" />
                  <span className="text-[11px]">Belum ada foto</span>
                </div>
              )}
            </div>
            <div className="flex-1 space-y-2.5">
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <Upload className="h-3.5 w-3.5 text-[#0F3D2E]" />
                    <span>{uploadingField === 'photoUrl' ? 'Memproses...' : 'Unggah Foto Lembaga'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={uploadingField !== null}
                      onChange={(e) => handleImageUpload(e, 'photoUrl')}
                      className="hidden"
                    />
                  </label>
                  {form.photoUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setPhotoImgError(false);
                        setForm({ ...form, photoUrl: '' });
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Hapus
                    </button>
                  )}
                </div>
              )}
              {isLocalPhotoData ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  Foto lembaga tersimpan lokal pada perangkat ini (siap disinkronkan otomatis saat online).
                </p>
              ) : (
                <input
                  type="text"
                  value={form.photoUrl}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setPhotoImgError(false);
                    setForm({ ...form, photoUrl: e.target.value });
                  }}
                  placeholder="Atau tempel URL foto lembaga (opsional)"
                  maxLength={BLUEPRINT_LIMITS.institution.photoUrlMax}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
                />
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Identitas Utama & Alamat */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="font-display text-base font-semibold text-[#111C18]">
          Identitas dan Alamat Resmi
        </h3>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700">Nama Lembaga</label>
            <input
              type="text"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.nameMax}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Masukkan nama lembaga"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Tahun Berdiri</label>
            <input
              type="text"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.foundedYearMax}
              value={form.foundedYear}
              onChange={(e) => setForm({ ...form, foundedYear: e.target.value })}
              placeholder="Contoh: 2018"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label className="block text-xs font-medium text-slate-700">Alamat Lengkap</label>
            <input
              type="text"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.addressMax}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Masukkan alamat lengkap lembaga"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Kecamatan</label>
            <input
              type="text"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.kecamatanMax}
              value={form.kecamatan}
              onChange={(e) => setForm({ ...form, kecamatan: e.target.value })}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Kabupaten / Kota</label>
            <input
              type="text"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.kabupatenMax}
              value={form.kabupaten}
              onChange={(e) => setForm({ ...form, kabupaten: e.target.value })}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Provinsi</label>
            <input
              type="text"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.provinsiMax}
              value={form.provinsi}
              onChange={(e) => setForm({ ...form, provinsi: e.target.value })}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Negara</label>
            <input
              type="text"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.negaraMax}
              value={form.negara}
              onChange={(e) => setForm({ ...form, negara: e.target.value })}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Nomor Kontak / Telepon</label>
            <input
              type="text"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.phoneMax}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Contoh: 0812..."
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Email Lembaga (Opsional)</label>
            <input
              type="email"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.emailMax}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="email@lembaga.org"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>
        </div>
      </section>

      {/* Legalitas, Pimpinan, dan Statistik Sumber Daya */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h3 className="font-display text-base font-semibold text-[#111C18]">
          Legalitas, Pimpinan, dan Data Santri
        </h3>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700">Nama Pimpinan Lembaga</label>
            <input
              type="text"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.leaderNameMax}
              value={form.leaderName}
              onChange={(e) => setForm({ ...form, leaderName: e.target.value })}
              placeholder="Nama lengkap pimpinan untuk tanda tangan proposal"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Jumlah Santri</label>
            <input
              type="number"
              min={0}
              max={1000000}
              disabled={!canEdit}
              value={form.studentCount}
              onChange={(e) => setForm({ ...form, studentCount: Number(e.target.value) || 0 })}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-[#111C18] tabular-nums focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Jumlah Tenaga Pengajar</label>
            <input
              type="number"
              min={0}
              max={1000000}
              disabled={!canEdit}
              value={form.teacherCount}
              onChange={(e) => setForm({ ...form, teacherCount: Number(e.target.value) || 0 })}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-[#111C18] tabular-nums focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700">
              Nomor Statistik (jika tersedia)
            </label>
            <input
              type="text"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.statisticNumberMax}
              value={form.statisticNumber}
              onChange={(e) => setForm({ ...form, statisticNumber: e.target.value })}
              placeholder="Kosongkan jika belum tersedia"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700">
              Legalitas Lembaga (Akta / SK Kemenkumham / Izin Operasional)
            </label>
            <input
              type="text"
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.legalityInfoMax}
              value={form.legalityInfo}
              onChange={(e) => setForm({ ...form, legalityInfo: e.target.value })}
              placeholder="Isi hanya nomor legalitas resmi yang sebenarnya"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>
        </div>
      </section>

      {/* Narasi Profil Lembaga */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-display text-base font-semibold text-[#111C18]">
              Sejarah, Visi, Misi, dan Struktur Organisasi
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Gunakan asisten AI untuk menyusun narasi resmi berdasarkan data lembaga yang sudah Anda isi di atas.
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              disabled={aiGenerating !== null}
              onClick={() => handleGenerateAi('all')}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#C5A059]/60 bg-[#0F3D2E] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#144D3A] disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#F3DFB6]" />
              {aiGenerating === 'all' ? 'Menyusun Semua Narasi...' : 'Buat Semua Narasi dengan AI'}
            </button>
          )}
        </div>

        {canEdit && (
          <div className="rounded-lg border border-emerald-900/15 bg-[#F8FAF9] p-4">
            <label className="block text-xs font-medium text-[#0F3D2E]">
              Arahan / Konteks Khusus untuk AI (Opsional)
            </label>
            <input
              type="text"
              value={aiNotes}
              onChange={(e) => setAiNotes(e.target.value)}
              maxLength={600}
              placeholder="Contoh: Fokus pada pembinaan tahfidz Al-Quran anak-anak & remaja, kegiatan sore dan malam, bebas biaya untuk yatim/dhuafa."
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            />
          </div>
        )}

        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="block text-xs font-medium text-slate-700">Sejarah Lembaga</label>
            {canEdit && (
              <button
                type="button"
                disabled={aiGenerating !== null}
                onClick={() => handleGenerateAi('history')}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-[#0F3D2E] hover:bg-slate-50 disabled:opacity-60"
              >
                <Sparkles className="h-3 w-3 text-[#C5A059]" />
                {aiGenerating === 'history' ? 'Menyusun...' : 'Buat dengan AI'}
              </button>
            )}
          </div>
          <textarea
            rows={5}
            disabled={!canEdit}
            maxLength={BLUEPRINT_LIMITS.institution.historyMax}
            value={form.history}
            onChange={(e) => setForm({ ...form, history: e.target.value })}
            placeholder="Tuliskan sejarah singkat berdirinya lembaga..."
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm leading-relaxed text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
          />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-slate-700">Visi Lembaga</label>
              {canEdit && (
                <button
                  type="button"
                  disabled={aiGenerating !== null}
                  onClick={() => handleGenerateAi('vision')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-[#0F3D2E] hover:bg-slate-50 disabled:opacity-60"
                >
                  <Sparkles className="h-3 w-3 text-[#C5A059]" />
                  {aiGenerating === 'vision' ? 'Menyusun...' : 'Buat dengan AI'}
                </button>
              )}
            </div>
            <textarea
              rows={5}
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.visionMax}
              value={form.vision}
              onChange={(e) => setForm({ ...form, vision: e.target.value })}
              placeholder="Tuliskan visi lembaga..."
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm leading-relaxed text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-slate-700">Misi Lembaga</label>
              {canEdit && (
                <button
                  type="button"
                  disabled={aiGenerating !== null}
                  onClick={() => handleGenerateAi('mission')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-[#0F3D2E] hover:bg-slate-50 disabled:opacity-60"
                >
                  <Sparkles className="h-3 w-3 text-[#C5A059]" />
                  {aiGenerating === 'mission' ? 'Menyusun...' : 'Buat dengan AI'}
                </button>
              )}
            </div>
            <textarea
              rows={5}
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.missionMax}
              value={form.mission}
              onChange={(e) => setForm({ ...form, mission: e.target.value })}
              placeholder="Tuliskan poin-poin misi lembaga..."
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm leading-relaxed text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="block text-xs font-medium text-slate-700">Struktur Organisasi</label>
            {canEdit && (
              <button
                type="button"
                disabled={aiGenerating !== null}
                onClick={() => handleGenerateAi('organizationStructure')}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-[#0F3D2E] hover:bg-slate-50 disabled:opacity-60"
              >
                <Sparkles className="h-3 w-3 text-[#C5A059]" />
                {aiGenerating === 'organizationStructure' ? 'Menyusun...' : 'Buat dengan AI'}
              </button>
            )}
          </div>
          <textarea
            rows={5}
            disabled={!canEdit}
            maxLength={BLUEPRINT_LIMITS.institution.organizationStructureMax}
            value={form.organizationStructure}
            onChange={(e) => setForm({ ...form, organizationStructure: e.target.value })}
            placeholder="Tuliskan susunan pengurus lembaga..."
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm leading-relaxed text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
          />
        </div>
      </section>
    </form>
  );
}
