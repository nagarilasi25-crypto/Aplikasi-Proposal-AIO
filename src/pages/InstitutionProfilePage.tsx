import React, { useEffect, useState } from 'react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { Building2, Save, Upload, ImageIcon, RotateCcw } from 'lucide-react';
import { storage } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import {
  BLUEPRINT_LIMITS,
  INSTITUTION_DOC_ID,
  InstitutionProfile,
} from '../types/models';
import { sanitizeNumber, sanitizeString } from '../lib/formatters';

export function InstitutionProfilePage() {
  const { appUser, institution, institutionLoading, saveInstitution } = useAuth();
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

  const handleImageUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    field: 'logoUrl' | 'photoUrl'
  ) => {
    const file = event.target.files?.[0];
    if (!file || !canEdit) return;

    if (!file.type.startsWith('image/')) {
      showToast('Hanya berkas gambar (PNG, JPG, WebP) yang diperbolehkan.', 'error');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      showToast('Ukuran gambar maksimal 3 MB.', 'error');
      return;
    }

    if (!navigator.onLine) {
      showToast('Unggah berkas ke server membutuhkan koneksi internet, atau gunakan URL gambar.', 'error');
      return;
    }

    setUploadingField(field);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const storagePath = `institutions/${INSTITUTION_DOC_ID}/${field}-${Date.now()}.${ext}`;
      const fileRef = ref(storage, storagePath);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      setForm((prev) => ({ ...prev, [field]: url }));
      if (field === 'logoUrl') setLogoImgError(false);
      else setPhotoImgError(false);
      showToast('Gambar berhasil diunggah. Klik Simpan Profil Lembaga untuk menyimpan.', 'info');
    } catch {
      showToast(
        'Unggah ke Firebase Storage gagal. Anda tetap dapat memasukkan tautan URL gambar secara manual.',
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

    setSaving(true);
    try {
      const payload: InstitutionProfile = {
        name: sanitizeString(form.name, BLUEPRINT_LIMITS.institution.nameMax),
        logoUrl: sanitizeString(form.logoUrl, BLUEPRINT_LIMITS.institution.logoUrlMax),
        photoUrl: sanitizeString(form.photoUrl, BLUEPRINT_LIMITS.institution.photoUrlMax),
        address: sanitizeString(form.address, BLUEPRINT_LIMITS.institution.addressMax),
        kecamatan: sanitizeString(form.kecamatan, BLUEPRINT_LIMITS.institution.kecamatanMax),
        kabupaten: sanitizeString(form.kabupaten, BLUEPRINT_LIMITS.institution.kabupatenMax),
        provinsi: sanitizeString(form.provinsi, BLUEPRINT_LIMITS.institution.provinsiMax),
        negara: sanitizeString(form.negara, BLUEPRINT_LIMITS.institution.negaraMax),
        phone: sanitizeString(form.phone, BLUEPRINT_LIMITS.institution.phoneMax),
        email: sanitizeString(form.email, BLUEPRINT_LIMITS.institution.emailMax),
        foundedYear: sanitizeString(form.foundedYear, BLUEPRINT_LIMITS.institution.foundedYearMax),
        statisticNumber: sanitizeString(form.statisticNumber, BLUEPRINT_LIMITS.institution.statisticNumberMax),
        legalityInfo: sanitizeString(form.legalityInfo, BLUEPRINT_LIMITS.institution.legalityInfoMax),
        leaderName: sanitizeString(form.leaderName, BLUEPRINT_LIMITS.institution.leaderNameMax),
        history: sanitizeString(form.history, BLUEPRINT_LIMITS.institution.historyMax),
        vision: sanitizeString(form.vision, BLUEPRINT_LIMITS.institution.visionMax),
        mission: sanitizeString(form.mission, BLUEPRINT_LIMITS.institution.missionMax),
        organizationStructure: sanitizeString(
          form.organizationStructure,
          BLUEPRINT_LIMITS.institution.organizationStructureMax
        ),
        studentCount: sanitizeNumber(form.studentCount, 0, 1000000),
        teacherCount: sanitizeNumber(form.teacherCount, 0, 1000000),
        createdBy: institution?.createdBy || appUser.uid,
        updatedBy: appUser.uid,
      };

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

  if (institutionLoading) {
    return (
      <div className="space-y-4">
        <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white" />
        <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-white" />
      </div>
    );
  }

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
            Ditampilkan pada halaman muka, kop surat proposal, dan hasil ekspor dokumen.
          </p>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2">
              {form.logoUrl && !logoImgError ? (
                <img
                  src={form.logoUrl}
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
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Upload className="h-3.5 w-3.5 text-[#0F3D2E]" />
                  <span>{uploadingField === 'logoUrl' ? 'Mengunggah...' : 'Unggah File Logo'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingField !== null}
                    onChange={(e) => handleImageUpload(e, 'logoUrl')}
                    className="hidden"
                  />
                </label>
              )}
              <input
                type="url"
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
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="font-display text-sm font-semibold text-[#111C18]">Foto Lembaga</h3>
          <p className="mt-1 text-xs text-slate-500">Foto gedung atau aktivitas utama lembaga.</p>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {form.photoUrl && !photoImgError ? (
                <img
                  src={form.photoUrl}
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
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Upload className="h-3.5 w-3.5 text-[#0F3D2E]" />
                  <span>{uploadingField === 'photoUrl' ? 'Mengunggah...' : 'Unggah Foto Lembaga'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingField !== null}
                    onChange={(e) => handleImageUpload(e, 'photoUrl')}
                    className="hidden"
                  />
                </label>
              )}
              <input
                type="url"
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
        <h3 className="font-display text-base font-semibold text-[#111C18]">
          Sejarah, Visi, Misi, dan Struktur Organisasi
        </h3>

        <div>
          <label className="block text-xs font-medium text-slate-700">Sejarah Lembaga</label>
          <textarea
            rows={4}
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
            <label className="block text-xs font-medium text-slate-700">Visi Lembaga</label>
            <textarea
              rows={4}
              disabled={!canEdit}
              maxLength={BLUEPRINT_LIMITS.institution.visionMax}
              value={form.vision}
              onChange={(e) => setForm({ ...form, vision: e.target.value })}
              placeholder="Tuliskan visi lembaga..."
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm leading-relaxed text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Misi Lembaga</label>
            <textarea
              rows={4}
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
          <label className="block text-xs font-medium text-slate-700">Struktur Organisasi</label>
          <textarea
            rows={4}
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
