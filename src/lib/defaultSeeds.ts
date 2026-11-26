import {
  ProposalCategory,
  ProposalSectionContent,
  ProposalTemplate,
  SystemAppSettings,
  TemplateSection,
} from '../types/models';

export const DEFAULT_APP_SETTINGS: SystemAppSettings = {
  numberPrefix: 'PROP/RQ-AR',
  defaultFiscalYear: new Date().getFullYear(),
  letterCity: '',
  paperSize: 'A4',
  includeLogoInLetterhead: true,
  footerText: 'Dokumen Resmi Pengajuan Proposal Lembaga',
};

function makeStandardSections(customFocus: {
  latarHint: string;
  tujuanHint: string;
  uraianHint: string;
  kebutuhanHint: string;
  extra?: TemplateSection[];
}): TemplateSection[] {
  const base: TemplateSection[] = [
    {
      id: 'sec_pendahuluan',
      key: 'pendahuluan',
      title: 'I. Pendahuluan & Latar Belakang',
      description: customFocus.latarHint,
      defaultContent: '',
      order: 1,
      enabled: true,
      required: true,
    },
    {
      id: 'sec_profil',
      key: 'profil_lembaga',
      title: 'II. Profil Singkat Lembaga',
      description: 'Ringkasan identitas, sejarah, visi, misi, legalitas, dan jumlah santri/pengajar sesuai Profil Lembaga.',
      defaultContent: '',
      order: 2,
      enabled: true,
      required: false,
    },
    {
      id: 'sec_maksud_tujuan',
      key: 'maksud_tujuan',
      title: 'III. Maksud dan Tujuan',
      description: customFocus.tujuanHint,
      defaultContent: '',
      order: 3,
      enabled: true,
      required: true,
    },
    {
      id: 'sec_sasaran',
      key: 'sasaran_manfaat',
      title: 'IV. Sasaran & Penerima Manfaat',
      description: 'Pihak atau santri yang menerima manfaat langsung serta dampak program bagi masyarakat.',
      defaultContent: '',
      order: 4,
      enabled: true,
      required: false,
    },
    {
      id: 'sec_uraian',
      key: 'uraian_kegiatan',
      title: 'V. Uraian Kegiatan & Rencana Pelaksanaan',
      description: customFocus.uraianHint,
      defaultContent: '',
      order: 5,
      enabled: true,
      required: true,
    },
    ...(customFocus.extra || []),
    {
      id: 'sec_rab',
      key: 'rencana_kebutuhan',
      title: 'VI. Rencana Kebutuhan & Anggaran Biaya',
      description: customFocus.kebutuhanHint,
      defaultContent: '',
      order: 6 + (customFocus.extra?.length || 0),
      enabled: true,
      required: true,
    },
    {
      id: 'sec_penutup',
      key: 'penutup',
      title: 'VII. Penutup',
      description: 'Harapan, doa, serta pernyataan pertanggungjawaban lembaga atas amanah bantuan.',
      defaultContent: '',
      order: 7 + (customFocus.extra?.length || 0),
      enabled: true,
      required: true,
    },
  ];
  return base.map((sec, idx) => ({ ...sec, order: idx + 1 }));
}

export function createInitialCategories(): ProposalCategory[] {
  const now = new Date().toISOString();
  const defs = [
    { id: 'cat_pembangunan', code: 'PBG', name: 'Pembangunan', description: 'Pembangunan gedung baru, ruang kelas belajar Al-Quran, asrama, atau fasilitas ibadah.' },
    { id: 'cat_renovasi', code: 'RNV', name: 'Renovasi', description: 'Perbaikan, rehabilitasi, dan pemeliharaan gedung serta prasarana lembaga.' },
    { id: 'cat_sarana', code: 'SRN', name: 'Pengadaan Sarana', description: 'Pengadaan meubelair, mushaf, perangkat audio, komputer, dan perlengkapan belajar.' },
    { id: 'cat_pendidikan', code: 'PDD', name: 'Pendidikan', description: 'Program penguatan kurikulum, pembelajaran Al-Quran, dan peningkatan mutu pendidik.' },
    { id: 'cat_tahfidz', code: 'THF', name: 'Tahfidz', description: 'Program tahfidzul Quran, karantina hafalan, serta pembinaan santri penghafal Al-Quran.' },
    { id: 'cat_operasional', code: 'OPR', name: 'Operasional', description: 'Dukungan operasional harian lembaga, listrik, air, kafalah ustadz/ustadzah, dan administrasi.' },
    { id: 'cat_beasiswa', code: 'BSW', name: 'Beasiswa', description: 'Beasiswa pendidikan santri yatim, dhuafa, dan santri berprestasi.' },
    { id: 'cat_kegiatan', code: 'KGT', name: 'Kegiatan', description: 'Kegiatan keagamaan, wisuda tahfidz, Ramadhan, tabligh akbar, dan bakti sosial.' },
    { id: 'cat_pengembangan', code: 'PGL', name: 'Pengembangan Lembaga', description: 'Pengembangan unit usaha mandiri, digitalisasi administrasi, dan perluasan layanan dakwah.' },
    { id: 'cat_umum', code: 'UMM', name: 'Umum', description: 'Proposal umum atau pengajuan kerja sama lintas program lembaga.' },
  ];
  return defs.map((d) => ({
    ...d,
    institutionId: 'ar-raudhah',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
}

export function createInitialTemplates(actorUid = 'system'): ProposalTemplate[] {
  const now = new Date().toISOString();
  const defs: Array<{
    id: string;
    name: string;
    proposalType: string;
    description: string;
    focus: Parameters<typeof makeStandardSections>[0];
  }> = [
    {
      id: 'tpl_pembangunan',
      name: 'Template Proposal Pembangunan',
      proposalType: 'Pembangunan',
      description: 'Struktur lengkap untuk pengajuan pembangunan gedung baru, ruang kelas, asrama, atau sarana fisik utama.',
      focus: {
        latarHint: 'Jelaskan kondisi kapasitas ruang saat ini, pertumbuhan jumlah santri, dan urgensi pembangunan fisik.',
        tujuanHint: 'Rumuskan tujuan pembangunan ruang belajar/fasilitas baru yang layak dan aman.',
        uraianHint: 'Rincikan lokasi tanah, luas bangunan yang direncanakan, tahapan konstruksi, serta jadwal pelaksanaan.',
        kebutuhanHint: 'Ringkas kebutuhan material, upah tenaga kerja, dan total biaya yang terhubung dengan tabel RAB.',
      },
    },
    {
      id: 'tpl_renovasi',
      name: 'Template Proposal Renovasi',
      proposalType: 'Renovasi',
      description: 'Dirancang untuk pengajuan perbaikan atap, lantai, dinding, sanitasi, atau rehabilitasi ruang belajar.',
      focus: {
        latarHint: 'Uraikan tingkat kerusakan bangunan saat ini dan dampaknya terhadap kenyamanan serta keselamatan santri.',
        tujuanHint: 'Jelaskan target perbaikan struktur agar kegiatan belajar mengajar berjalan aman dan kondusif.',
        uraianHint: 'Jelaskan bagian bangunan yang direnovasi, metode pengerjaan, dan estimasi durasi renovasi.',
        kebutuhanHint: 'Jelaskan komponen biaya perbaikan per kelompok pekerjaan sesuai data RAB.',
      },
    },
    {
      id: 'tpl_sarana',
      name: 'Template Proposal Pengadaan Sarana',
      proposalType: 'Pengadaan Sarana',
      description: 'Khusus pengadaan meja belajar, rak mushaf, papan tulis, peralatan multimedia, atau perlengkapan pembelajaran.',
      focus: {
        latarHint: 'Jelaskan kesenjangan antara jumlah sarana tersedia dengan kebutuhan santri dan pengajar.',
        tujuanHint: 'Target peningkatan kualitas proses belajar dengan tersedianya sarana pendukung yang memadai.',
        uraianHint: 'Spesifikasi barang/sarana yang akan diadakan, penempatan, dan tata kelola inventarisasi.',
        kebutuhanHint: 'Rekapitulasi jumlah unit, harga satuan, dan total nilai pengadaan sesuai RAB.',
      },
    },
    {
      id: 'tpl_pendidikan',
      name: 'Template Proposal Pendidikan',
      proposalType: 'Pendidikan',
      description: 'Untuk pengajuan program pembelajaran Al-Quran, pelatihan metode ajar ustadz/ustadzah, dan penguatan kurikulum.',
      focus: {
        latarHint: 'Gambaran kondisi pembelajaran santri dan kebutuhan peningkatan mutu akademik maupun diniyah.',
        tujuanHint: 'Capaian pembelajaran, peningkatan kompetensi guru, dan standar kelulusan santri.',
        uraianHint: 'Rangkaian program pendidikan, jadwal kelas, silabus singkat, dan indikator evaluasi.',
        kebutuhanHint: 'Alokasi kebutuhan bahan ajar, honor narasumber/pelatihan, dan dukungan program.',
      },
    },
    {
      id: 'tpl_tahfidz',
      name: 'Template Proposal Tahfidz',
      proposalType: 'Tahfidz',
      description: 'Dikhususkan untuk program pembinaan hafalan Al-Quran, halaqah tahfidz, dauroh, atau mukim penghafal Quran.',
      focus: {
        latarHint: 'Uraikan minat santri menghafal Al-Quran dan kebutuhan pembinaan intensif yang terstruktur.',
        tujuanHint: 'Target capaian hafalan (juz), kualitas tajwid, serta pembinaan akhlak para penghafal Al-Quran.',
        uraianHint: 'Pola setoran, murajaah, halaqah bimbingan, serta jadwal pembinaan harian dan bulanan.',
        kebutuhanHint: 'Kebutuhan mushaf, mukafaah muhaffizh, konsumsi/akomodasi santri tahfidz, dan fasilitas pendukung.',
      },
    },
    {
      id: 'tpl_operasional',
      name: 'Template Proposal Operasional',
      proposalType: 'Operasional',
      description: 'Untuk dukungan biaya operasional rutin lembaga, kafalah pengajar, utilitas listrik/air, dan kebersihan.',
      focus: {
        latarHint: 'Jelaskan biaya operasional rutin lembaga yang berjalan serta keterbatasan sumber pendanaan bulanan.',
        tujuanHint: 'Menjaga keberlangsungan aktivitas pendidikan tanpa membebani santri kurang mampu.',
        uraianHint: 'Rincian pos operasional rutin bulanan dan periode penggunaan dana bantuan.',
        kebutuhanHint: 'Rekap kebutuhan operasional per bulan/tahun sesuai tabel RAB.',
      },
    },
    {
      id: 'tpl_beasiswa',
      name: 'Template Proposal Beasiswa',
      proposalType: 'Beasiswa',
      description: 'Untuk penyaluran beasiswa pendidikan santri yatim, dhuafa, dan penghargaan santri berprestasi.',
      focus: {
        latarHint: 'Data kondisi sosial ekonomi sebagian santri yang membutuhkan dukungan biaya pendidikan.',
        tujuanHint: 'Memastikan santri yatim/dhuafa tetap dapat menempuh pendidikan Al-Quran secara berkelanjutan.',
        uraianHint: 'Kriteria penerima beasiswa, mekanisme seleksi/penyaluran, dan pemantauan perkembangan santri.',
        kebutuhanHint: 'Nominal beasiswa per santri, jumlah penerima, dan periode penyaluran sesuai RAB.',
      },
    },
    {
      id: 'tpl_kegiatan',
      name: 'Template Proposal Kegiatan',
      proposalType: 'Kegiatan',
      description: 'Untuk proposal acara seperti Wisuda Tahfidz, Semarak Ramadhan, Pesantren Kilat, atau Peringatan Hari Besar Islam.',
      focus: {
        latarHint: 'Urgensi penyelenggaraan kegiatan keagamaan/edukatif bagi santri dan masyarakat sekitar.',
        tujuanHint: 'Target peserta, syiar Islam, serta dampak positif kegiatan bagi lingkungan.',
        uraianHint: 'Nama kegiatan, waktu dan tempat pelaksanaan, susunan panitia, dan rangkaian acara.',
        kebutuhanHint: 'Kebutuhan perlengkapan acara, konsumsi, publikasi, dan dokumentasi sesuai RAB.',
      },
    },
    {
      id: 'tpl_pengembangan',
      name: 'Template Proposal Pengembangan Lembaga',
      proposalType: 'Pengembangan Lembaga',
      description: 'Untuk inisiatif strategis pengembangan kapasitas kelembagaan, digitalisasi, atau perluasan unit layanan.',
      focus: {
        latarHint: 'Peluang pertumbuhan lembaga dan tantangan kapasitas manajemen yang perlu ditingkatkan.',
        tujuanHint: 'Mewujudkan lembaga pendidikan Al-Quran yang mandiri, profesional, dan berdaya guna luas.',
        uraianHint: 'Peta jalan pengembangan, tahapan implementasi, serta target jangka pendek dan menengah.',
        kebutuhanHint: 'Investasi sistem, pelatihan SDM, dan fasilitas pengembangan sesuai RAB.',
      },
    },
    {
      id: 'tpl_umum',
      name: 'Template Proposal Umum',
      proposalType: 'Umum',
      description: 'Format proposal fleksibel untuk berbagai kebutuhan pengajuan bantuan atau kemitraan lembaga.',
      focus: {
        latarHint: 'Jelaskan alasan pengajuan dan kondisi aktual yang mendasari kebutuhan program.',
        tujuanHint: 'Tuliskan maksud, target capaian, dan manfaat yang ingin diwujudkan.',
        uraianHint: 'Paparkan rencana pelaksanaan program, jadwal, dan penanggung jawab kegiatan.',
        kebutuhanHint: 'Ringkas rencana penggunaan dana yang terinci pada lampiran RAB.',
      },
    },
  ];

  return defs.map((item, index) => ({
    id: item.id,
    institutionId: 'ar-raudhah',
    name: item.name,
    proposalType: item.proposalType,
    description: item.description,
    sections: makeStandardSections(item.focus),
    isDefault: index === 0,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
  }));
}

export function buildProposalSectionsFromTemplate(
  template: ProposalTemplate | undefined
): ProposalSectionContent[] {
  if (!template) {
    return makeStandardSections({
      latarHint: 'Latar belakang pengajuan proposal.',
      tujuanHint: 'Maksud dan tujuan pelaksanaan program.',
      uraianHint: 'Uraian teknis pelaksanaan kegiatan.',
      kebutuhanHint: 'Ringkasan kebutuhan biaya sesuai RAB.',
    }).map((sec) => ({
      id: sec.id,
      key: sec.key,
      title: sec.title,
      description: sec.description,
      content: sec.defaultContent || '',
      enabled: sec.enabled,
      order: sec.order,
    }));
  }

  return [...template.sections]
    .sort((a, b) => a.order - b.order)
    .map((sec) => ({
      id: sec.id,
      key: sec.key,
      title: sec.title,
      description: sec.description,
      content: sec.defaultContent || '',
      enabled: sec.enabled,
      order: sec.order,
    }));
}
