import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Calculator,
  Check,
  Eye,
  FileCheck2,
  Image as ImageIcon,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { ProposalPreviewModal } from '../components/ProposalPreviewModal';
import { buildProposalSectionsFromTemplate } from '../lib/defaultSeeds';
import {
  formatAngka,
  formatRupiah,
  generateProposalNumber,
} from '../lib/formatters';
import {
  ProposalRecord,
  ProposalSectionContent,
  ProposalStatus,
  RabItem,
} from '../types/models';

const STEPS = [
  { id: 1, label: '1. Identitas & Template' },
  { id: 2, label: '2. Narasi Bab & AI' },
  { id: 3, label: '3. Anggaran (RAB)' },
  { id: 4, label: '4. Lampiran' },
  { id: 5, label: '5. Simpan & Cetak' },
];

export function CreateProposalPage() {
  const {
    appUser,
    institution,
    categories,
    templates,
    proposals,
    budgets,
    attachments,
    appSettings,
    saveProposal,
    saveBudget,
    generateAiNarrative,
  } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit') || '';

  const canEdit = appUser?.role === 'Administrator' || appUser?.role === 'Operator';

  const existingProposal = useMemo(
    () => (editId ? proposals.find((p) => p.id === editId) : undefined),
    [editId, proposals]
  );

  const activeCategories = useMemo(
    () => categories.filter((c) => c.isActive),
    [categories]
  );
  const activeTemplates = useMemo(
    () => templates.filter((t) => t.isActive),
    [templates]
  );

  const [step, setStep] = useState(1);
  const [proposalId, setProposalId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [proposalNumber, setProposalNumber] = useState('');
  const [proposalDate, setProposalDate] = useState(new Date().toISOString().slice(0, 10));
  const [fiscalYear, setFiscalYear] = useState(appSettings.defaultFiscalYear);
  const [categoryId, setCategoryId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientInstitution, setRecipientInstitution] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [location, setLocation] = useState('');
  const [executionTime, setExecutionTime] = useState('');
  const [summary, setSummary] = useState('');
  const [sections, setSections] = useState<ProposalSectionContent[]>([]);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [rabItems, setRabItems] = useState<RabItem[]>([]);
  const [status, setStatus] = useState<ProposalStatus>('Draft');

  const [aiNotes, setAiNotes] = useState('');
  const [aiBusyKey, setAiBusyKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [initializedEditId, setInitializedEditId] = useState<string | null>(null);

  useEffect(() => {
    if (editId && existingProposal && initializedEditId !== editId) {
      setProposalId(existingProposal.id);
      setTitle(existingProposal.title || '');
      setProposalNumber(existingProposal.proposalNumber || '');
      setProposalDate(existingProposal.proposalDate || new Date().toISOString().slice(0, 10));
      setFiscalYear(existingProposal.fiscalYear || appSettings.defaultFiscalYear);
      setCategoryId(existingProposal.categoryId || '');
      setTemplateId(existingProposal.templateId || '');
      setRecipientName(existingProposal.recipientName || '');
      setRecipientInstitution(existingProposal.recipientInstitution || '');
      setRecipientAddress(existingProposal.recipientAddress || '');
      setLocation(existingProposal.location || '');
      setExecutionTime(existingProposal.executionTime || '');
      setSummary(existingProposal.summary || '');
      setSections(
        existingProposal.sections && existingProposal.sections.length > 0
          ? existingProposal.sections
          : buildProposalSectionsFromTemplate(
              templates.find((t) => t.id === existingProposal.templateId) || templates[0]
            )
      );
      setSelectedAttachmentIds(existingProposal.attachmentIds || []);
      setStatus(existingProposal.status || 'Draft');

      const linkedBudget = budgets.find((b) => b.proposalId === existingProposal.id);
      setRabItems(linkedBudget?.items || []);
      setInitializedEditId(editId);
      return;
    }

    if (!editId && initializedEditId !== '__new__') {
      const defaultTpl = activeTemplates.find((t) => t.isDefault) || activeTemplates[0];
      const defaultCat = activeCategories[0];
      setProposalId(`prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      setCategoryId(defaultCat?.id || '');
      setTemplateId(defaultTpl?.id || '');
      setSections(buildProposalSectionsFromTemplate(defaultTpl));
      setFiscalYear(appSettings.defaultFiscalYear);
      setInitializedEditId('__new__');
    }
  }, [
    activeCategories,
    activeTemplates,
    appSettings.defaultFiscalYear,
    budgets,
    editId,
    existingProposal,
    initializedEditId,
    templates,
  ]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const selectedTemplate = templates.find((t) => t.id === templateId);

  const rabTotal = useMemo(
    () =>
      rabItems.reduce(
        (sum, it) => sum + Math.round((Number(it.volume) || 0) * (Number(it.unitPrice) || 0)),
        0
      ),
    [rabItems]
  );

  const handleTemplateChange = (nextTplId: string) => {
    setTemplateId(nextTplId);
    const tpl = templates.find((t) => t.id === nextTplId);
    if (!tpl) return;
    setSections((prev) => {
      const prevByKey = new Map<string, string>(prev.map((s) => [s.key, s.content]));
      return buildProposalSectionsFromTemplate(tpl).map((sec) => ({
        ...sec,
        content: prevByKey.get(sec.key) || sec.content,
      }));
    });
  };

  const handleAutoNumber = () => {
    const code = selectedCategory?.code || 'UMM';
    const nextSeq = proposals.length + 1;
    setProposalNumber(
      generateProposalNumber(appSettings.numberPrefix, nextSeq, code, fiscalYear)
    );
  };

  const handleFillInstitutionProfileSection = (secKey: string) => {
    if (!institution) return;
    const parts: string[] = [];
    if (institution.name) parts.push(`Nama Lembaga: ${institution.name}`);
    const addr = [
      institution.address,
      institution.kecamatan ? `Kec. ${institution.kecamatan}` : '',
      institution.kabupaten ? `Kab. ${institution.kabupaten}` : '',
      institution.provinsi || '',
    ]
      .filter(Boolean)
      .join(', ');
    if (addr) parts.push(`Alamat: ${addr}`);
    if (institution.foundedYear) parts.push(`Tahun Berdiri: ${institution.foundedYear}`);
    if (institution.leaderName) parts.push(`Pimpinan Lembaga: ${institution.leaderName}`);
    if (institution.statisticNumber) parts.push(`Nomor Statistik: ${institution.statisticNumber}`);
    if (institution.legalityInfo) parts.push(`Legalitas: ${institution.legalityInfo}`);
    if (institution.studentCount || institution.teacherCount) {
      parts.push(
        `Jumlah Santri: ${formatAngka(institution.studentCount)} orang | Tenaga Pengajar: ${formatAngka(
          institution.teacherCount
        )} orang`
      );
    }
    if (institution.history) parts.push(`\nSejarah Singkat:\n${institution.history}`);
    if (institution.vision) parts.push(`\nVisi:\n${institution.vision}`);
    if (institution.mission) parts.push(`\nMisi:\n${institution.mission}`);
    if (institution.organizationStructure) {
      parts.push(`\nStruktur Organisasi:\n${institution.organizationStructure}`);
    }

    const compiled = parts.join('\n').trim();
    if (!compiled) {
      showToast('Data Profil Lembaga masih kosong. Lengkapi dahulu pada menu Profil Lembaga.', 'info');
      return;
    }
    setSections((prev) =>
      prev.map((s) => (s.key === secKey ? { ...s, content: compiled } : s))
    );
    showToast('Data Profil Lembaga dimasukkan ke bab ini.', 'success');
  };

  const handleAiSection = async (sec: ProposalSectionContent) => {
    setAiBusyKey(sec.key);
    try {
      const res = await generateAiNarrative({
        target: 'proposal_section',
        sectionKey: sec.key,
        sectionTitle: sec.title,
        institution: institution || undefined,
        proposalContext: {
          title: title.trim() || 'Proposal Pengajuan Bantuan Lembaga',
          categoryName: selectedCategory?.name || 'Umum',
          proposalType: selectedTemplate?.proposalType || 'Umum',
          recipientName,
          recipientInstitution,
          location,
          executionTime,
          fiscalYear,
          totalBudget: rabTotal,
          summary,
        },
        userNotes: aiNotes.trim() || sec.description || undefined,
      });

      if (res.text) {
        setSections((prev) =>
          prev.map((s) => (s.key === sec.key ? { ...s, content: res.text! } : s))
        );
        showToast(`Narasi "${sec.title}" berhasil dibuat AI.`, 'success');
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Gagal membuat narasi AI.',
        'error'
      );
    } finally {
      setAiBusyKey(null);
    }
  };

  const handleAiAllSections = async () => {
    const enabledSecs = sections.filter((s) => s.enabled);
    if (enabledSecs.length === 0) {
      showToast('Aktifkan minimal satu bab proposal terlebih dahulu.', 'error');
      return;
    }
    setAiBusyKey('__all__');
    try {
      const res = await generateAiNarrative({
        target: 'proposal_section',
        generateAllSections: true,
        institution: institution || undefined,
        proposalContext: {
          title: title.trim() || 'Proposal Pengajuan Bantuan Lembaga',
          categoryName: selectedCategory?.name || 'Umum',
          proposalType: selectedTemplate?.proposalType || 'Umum',
          recipientName,
          recipientInstitution,
          location,
          executionTime,
          fiscalYear,
          totalBudget: rabTotal,
          summary,
          existingSections: enabledSecs.map((s) => ({
            key: s.key,
            title: s.title,
            content: s.content,
          })),
        },
        userNotes: aiNotes.trim() || undefined,
      });

      if (res.sections) {
        setSections((prev) =>
          prev.map((s) =>
            res.sections && typeof res.sections[s.key] === 'string' && res.sections[s.key]
              ? { ...s, content: res.sections[s.key] }
              : s
          )
        );
        showToast('Seluruh bab aktif berhasil disusun AI. Silakan tinjau dan sesuaikan.', 'success');
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Gagal menyusun bab proposal dengan AI.',
        'error'
      );
    } finally {
      setAiBusyKey(null);
    }
  };

  const addQuickRabItem = () => {
    setRabItems((prev) => [
      ...prev,
      {
        id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        groupName: 'Kebutuhan Utama',
        order: prev.length + 1,
        description: '',
        volume: 1,
        unit: 'Unit',
        unitPrice: 0,
        totalPrice: 0,
      },
    ]);
  };

  const buildDraftRecord = (targetStatus?: ProposalStatus): ProposalRecord => ({
    id: proposalId || `prop_${Date.now()}`,
    institutionId: 'ar-raudhah',
    proposalNumber: proposalNumber.trim(),
    proposalDate,
    fiscalYear: Number(fiscalYear) || appSettings.defaultFiscalYear,
    title: title.trim() || 'Draf Proposal Baru',
    categoryId,
    categoryName: selectedCategory?.name || 'Umum',
    templateId,
    proposalType: selectedTemplate?.proposalType || 'Umum',
    recipientName: recipientName.trim(),
    recipientInstitution: recipientInstitution.trim(),
    recipientAddress: recipientAddress.trim(),
    location: location.trim(),
    executionTime: executionTime.trim(),
    summary: summary.trim(),
    sections,
    attachmentIds: selectedAttachmentIds,
    status: targetStatus || status,
    totalBudget: rabTotal,
    createdBy: existingProposal?.createdBy || appUser?.uid || '',
    updatedBy: appUser?.uid || '',
  });

  const handleSaveAll = async (targetStatus?: ProposalStatus, redirectTo?: string) => {
    if (!canEdit) return;
    if (!title.trim()) {
      showToast('Judul proposal wajib diisi pada Langkah 1.', 'error');
      setStep(1);
      return;
    }

    setSaving(true);
    try {
      const payload = buildDraftRecord(targetStatus);
      const { proposal: savedProp, queuedOffline } = await saveProposal(payload);
      setProposalId(savedProp.id);

      const cleanRab = rabItems
        .filter((it) => it.description.trim())
        .map((it, i) => ({
          ...it,
          order: i + 1,
          volume: Number(it.volume) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          totalPrice: Math.round((Number(it.volume) || 0) * (Number(it.unitPrice) || 0)),
        }));

      if (cleanRab.length > 0) {
        await saveBudget({
          proposalId: savedProp.id,
          proposalTitle: savedProp.title,
          title: `RAB - ${savedProp.title}`,
          items: cleanRab,
        });
      }

      showToast(
        queuedOffline
          ? 'Proposal disimpan secara lokal (offline) dan akan disinkronkan saat internet terhubung.'
          : 'Proposal dan data terkait berhasil disimpan.',
        queuedOffline ? 'info' : 'success'
      );

      if (redirectTo) {
        navigate(redirectTo);
      } else if (!editId) {
        navigate(`/buat-proposal?edit=${savedProp.id}`, { replace: true });
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan proposal.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <h2 className="font-display text-lg font-bold text-[#111C18]">
          Akses Terbatas
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Pembuatan atau penyuntingan proposal hanya dapat dilakukan oleh Administrator atau Operator.
        </p>
        <Link
          to="/daftar-proposal"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2 text-xs font-semibold text-white"
        >
          Lihat Daftar Proposal
        </Link>
      </div>
    );
  }

  const linkedAttachments = attachments.filter(
    (a) => selectedAttachmentIds.includes(a.id) || (proposalId && a.proposalId === proposalId)
  );
  const draftRecord = buildDraftRecord();
  const draftBudgetObj =
    rabItems.filter((it) => it.description.trim()).length > 0
      ? {
          id: 'preview_rab',
          institutionId: 'ar-raudhah',
          proposalId: draftRecord.id,
          title: `RAB - ${draftRecord.title}`,
          items: rabItems
            .filter((it) => it.description.trim())
            .map((it, i) => ({
              ...it,
              order: i + 1,
              totalPrice: Math.round((Number(it.volume) || 0) * (Number(it.unitPrice) || 0)),
            })),
          totalAmount: rabTotal,
          createdAt: '',
          updatedAt: '',
          createdBy: '',
          updatedBy: '',
        }
      : null;

  return (
    <div className="space-y-6">
      {/* Header & Stepper */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#111C18]">
              {editId ? 'Sunting Proposal' : 'Buat Proposal Baru'}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Susun proposal resmi secara bertahap dengan bantuan AI, RAB otomatis, dan lampiran dokumentasi.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-[#0F3D2E] hover:bg-slate-50"
            >
              <Eye className="h-3.5 w-3.5" /> Pratinjau A4
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSaveAll()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Menyimpan...' : 'Simpan Draft'}
            </button>
          </div>
        </div>

        {/* Steps Navigation */}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStep(s.id)}
              className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                step === s.id
                  ? 'border-[#0F3D2E] bg-[#0F3D2E] text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Step 1: Identitas & Template */}
      {step === 1 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <h3 className="font-display text-base font-semibold text-[#111C18]">
            Identitas Utama & Pemilihan Template
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-slate-700">
                Judul Proposal <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Contoh: Proposal Permohonan Bantuan Pembangunan Ruang Belajar Tahfidz"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-700">Nomor Proposal</label>
                <button
                  type="button"
                  onClick={handleAutoNumber}
                  className="text-[11px] font-medium text-[#0F3D2E] hover:underline"
                >
                  Buat Otomatis
                </button>
              </div>
              <input
                type="text"
                value={proposalNumber}
                onChange={(e) => setProposalNumber(e.target.value)}
                placeholder="Klik Buat Otomatis atau isi manual"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Tanggal Pengajuan</label>
              <input
                type="date"
                value={proposalDate}
                onChange={(e) => setProposalDate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Tahun Anggaran</label>
              <input
                type="number"
                min={2000}
                max={2100}
                value={fiscalYear}
                onChange={(e) => setFiscalYear(Number(e.target.value) || new Date().getFullYear())}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Kategori Proposal</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              >
                <option value="">-- Pilih Kategori --</option>
                {activeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code ? `[${c.code}] ` : ''}
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700">
                Master Template Struktur Bab
              </label>
              <select
                value={templateId}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              >
                {activeTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.sections.filter((s) => s.enabled).length} Bab Aktif)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Instansi / Donatur Tujuan
              </label>
              <input
                type="text"
                value={recipientInstitution}
                onChange={(e) => setRecipientInstitution(e.target.value)}
                placeholder="Contoh: Pemerintah Daerah / Laznas / Donatur"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Nama Penerima Surat</label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Contoh: Kepala Bagian Kesra / Pimpinan"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Waktu Pelaksanaan</label>
              <input
                type="text"
                value={executionTime}
                onChange={(e) => setExecutionTime(e.target.value)}
                placeholder="Contoh: Maret - Mei 2026"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-slate-700">
                Lokasi Pelaksanaan / Pembangunan
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={institution?.address || 'Lokasi kegiatan dilaksanakan...'}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-slate-700">
                Ringkasan Singkat Tujuan Proposal (untuk konteks AI & arsip)
              </label>
              <textarea
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Tuliskan ringkasan kebutuhan utama yang diajukan..."
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>
          </div>
        </section>
      )}

      {/* Step 2: Konten Bab & AI */}
      {step === 2 && (
        <section className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h3 className="font-display text-base font-semibold text-[#111C18]">
                  Penyusunan Narasi Bab Proposal dengan AI
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Isi bab dapat disusun otomatis menggunakan Gemini AI berdasarkan identitas proposal & Profil Lembaga.
                </p>
              </div>
              <button
                type="button"
                disabled={aiBusyKey !== null}
                onClick={handleAiAllSections}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Sparkles className="h-4 w-4 text-[#F3DFB6]" />
                {aiBusyKey === '__all__' ? 'Menyusun Seluruh Bab...' : 'Buat Semua Bab dengan AI'}
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#0F3D2E]">
                Arahan / Konteks Khusus untuk AI (Opsional)
              </label>
              <input
                type="text"
                value={aiNotes}
                onChange={(e) => setAiNotes(e.target.value)}
                placeholder="Contoh: Tekankan bahwa jumlah santri meningkat sehingga ruang kelas saat ini sudah penuh..."
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-[#F8FAF9] px-3.5 py-2 text-xs text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
              />
            </div>
          </div>

          {sections.map((sec, idx) => (
            <div key={sec.id} className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2.5">
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
                    className="h-4 w-4 rounded border-slate-300 text-[#0F3D2E]"
                  />
                  <span className="font-display text-sm font-bold text-[#111C18]">
                    {sec.title}
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  {sec.key === 'profil_lembaga' && (
                    <button
                      type="button"
                      onClick={() => handleFillInstitutionProfileSection(sec.key)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Building2 className="h-3.5 w-3.5 text-[#0F3D2E]" />
                      Muat dari Profil Lembaga
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={aiBusyKey !== null || !sec.enabled}
                    onClick={() => handleAiSection(sec)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#0F3D2E] hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[#C5A059]" />
                    {aiBusyKey === sec.key ? 'Menyusun...' : 'Buat Bab Ini dengan AI'}
                  </button>
                </div>
              </div>

              {sec.description && <p className="text-xs text-slate-500">{sec.description}</p>}

              <textarea
                rows={6}
                disabled={!sec.enabled}
                value={sec.content}
                onChange={(e) =>
                  setSections((prev) =>
                    prev.map((item, i) =>
                      i === idx ? { ...item, content: e.target.value } : item
                    )
                  )
                }
                placeholder={`Tuliskan isi ${sec.title} di sini atau gunakan tombol AI di atas...`}
                className="w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm leading-relaxed text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
              />
            </div>
          ))}
        </section>
      )}

      {/* Step 3: Anggaran RAB */}
      {step === 3 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-display text-base font-semibold text-[#111C18]">
                Rencana Anggaran Biaya (RAB) Proposal
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Tambahkan item anggaran langsung di bawah ini atau kelola lebih rinci pada halaman RAB setelah disimpan.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addQuickRabItem}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-[#0F3D2E] hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" /> Tambah Item RAB
              </button>
              <button
                type="button"
                onClick={() => handleSaveAll(undefined, `/rab?proposalId=${proposalId}`)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#144D3A]"
              >
                <Calculator className="h-3.5 w-3.5" /> Buka Editor RAB Lengkap
              </button>
            </div>
          </div>

          {rabItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-700">Belum ada item anggaran.</p>
              <p className="mt-1 text-xs text-slate-500">
                Klik "Tambah Item RAB" untuk mulai menghitung volume × harga satuan.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="pb-2 pr-2">Kelompok</th>
                    <th className="pb-2 pr-2">Uraian Kebutuhan</th>
                    <th className="pb-2 pr-2 w-20">Vol</th>
                    <th className="pb-2 pr-2 w-24">Satuan</th>
                    <th className="pb-2 pr-2 w-36">Harga Satuan (Rp)</th>
                    <th className="pb-2 pr-2 text-right">Jumlah</th>
                    <th className="pb-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rabItems.map((it, idx) => {
                    const rowTotal = Math.round((Number(it.volume) || 0) * (Number(it.unitPrice) || 0));
                    return (
                      <tr key={it.id}>
                        <td className="py-2 pr-2">
                          <input
                            type="text"
                            value={it.groupName}
                            onChange={(e) =>
                              setRabItems((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, groupName: e.target.value } : r
                                )
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1.5"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            type="text"
                            value={it.description}
                            onChange={(e) =>
                              setRabItems((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, description: e.target.value } : r
                                )
                              )
                            }
                            placeholder="Nama barang/pekerjaan"
                            className="w-full rounded border border-slate-200 px-2 py-1.5"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={it.volume}
                            onChange={(e) =>
                              setRabItems((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, volume: Number(e.target.value) || 0 } : r
                                )
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            type="text"
                            value={it.unit}
                            onChange={(e) =>
                              setRabItems((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, unit: e.target.value } : r))
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1.5"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            type="number"
                            min={0}
                            value={it.unitPrice}
                            onChange={(e) =>
                              setRabItems((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, unitPrice: Number(e.target.value) || 0 } : r
                                )
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono"
                          />
                        </td>
                        <td className="py-2 pr-2 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                          {formatRupiah(rowTotal)}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setRabItems((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="rounded p-1 text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3 text-sm font-bold text-[#0F3D2E]">
            <span>Total Anggaran Proposal</span>
            <span className="font-mono tabular-nums">{formatRupiah(rabTotal)}</span>
          </div>
        </section>
      )}

      {/* Step 4: Lampiran */}
      {step === 4 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-display text-base font-semibold text-[#111C18]">
                Pilih Dokumentasi & Lampiran Pendukung
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Lampiran terpilih akan disertakan pada Lampiran II saat dicetak ke Word (.docx) atau PDF (.pdf).
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleSaveAll(undefined, `/dokumentasi?proposalId=${proposalId}`)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#144D3A]"
            >
              <ImageIcon className="h-3.5 w-3.5" /> Unggah Dokumentasi Baru
            </button>
          </div>

          {attachments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
              <p className="text-sm font-medium text-slate-700">
                Belum ada dokumentasi atau berkas pendukung yang diunggah.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Klik tombol di atas untuk mengunggah foto lokasi, bangunan, atau legalitas lembaga.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {attachments.map((att) => {
                const checked =
                  selectedAttachmentIds.includes(att.id) || att.proposalId === proposalId;
                return (
                  <label
                    key={att.id}
                    className={`flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition-colors ${
                      checked
                        ? 'border-[#0F3D2E] bg-emerald-50/40'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {att.category}
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAttachmentIds((prev) =>
                                prev.includes(att.id) ? prev : [...prev, att.id]
                              );
                            } else {
                              setSelectedAttachmentIds((prev) => prev.filter((id) => id !== att.id));
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-[#0F3D2E]"
                        />
                      </div>
                      <p className="mt-2 text-xs font-semibold text-[#111C18]">{att.title}</p>
                      {att.isImage && (
                        <img
                          src={att.fileUrl}
                          alt={att.title}
                          className="mt-2.5 h-32 w-full rounded-lg object-cover"
                        />
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Step 5: Simpan & Finalisasi */}
      {step === 5 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          <div>
            <h3 className="font-display text-base font-semibold text-[#111C18]">
              Finalisasi, Pratinjau & Penyimpanan Proposal
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Tinjau ringkasan proposal sebelum disimpan ke daftar proposal atau diajukan ke Pimpinan.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-[#F8FAF9] p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[11px] text-slate-500">Judul Proposal</p>
              <p className="mt-1 text-xs font-bold text-[#111C18]">{title || '-'}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Nomor & Kategori</p>
              <p className="mt-1 text-xs font-semibold text-[#0F3D2E]">
                {proposalNumber || 'Tanpa Nomor'} · {selectedCategory?.name || 'Umum'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Bab Aktif & Terisi</p>
              <p className="mt-1 font-mono text-xs font-semibold text-[#111C18]">
                {sections.filter((s) => s.enabled && s.content.trim()).length} /{' '}
                {sections.filter((s) => s.enabled).length} Bab
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Total RAB</p>
              <p className="mt-1 font-mono text-sm font-bold text-[#0F3D2E] tabular-nums">
                {formatRupiah(rabTotal)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-[#0F3D2E] hover:bg-slate-50"
            >
              <Eye className="h-4 w-4" />
              Buka Pratinjau & Ekspor Word / PDF
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => handleSaveAll('Draft', '/daftar-proposal')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-[#111C18] hover:bg-slate-50 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              Simpan sebagai Draft
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => handleSaveAll('Menunggu persetujuan', '/monitoring')}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0F3D2E] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:opacity-60"
            >
              <FileCheck2 className="h-4 w-4" />
              Simpan & Ajukan Persetujuan Pimpinan
            </button>
          </div>
        </section>
      )}

      {/* Bottom Step Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={step === 1}
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Langkah Sebelumnya
        </button>
        {step < 5 ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(5, s + 1))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#144D3A]"
          >
            Langkah Berikutnya <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
            <Check className="h-4 w-4" /> Siap Disimpan & Dicetak
          </span>
        )}
      </div>

      {showPreview && (
        <ProposalPreviewModal
          proposal={draftRecord}
          institution={institution}
          budget={draftBudgetObj}
          attachments={linkedAttachments}
          appSettings={appSettings}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
