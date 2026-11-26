export const INSTITUTION_DOC_ID = 'ar-raudhah';
export const BOOTSTRAPPED_ADMIN_EMAIL = 'nagarilasi25@gmail.com';

export type UserRole = 'Administrator' | 'Pimpinan' | 'Operator';
export type UserStatus = 'active' | 'pending' | 'inactive';

export type ProposalStatus =
  | 'Draft'
  | 'Menunggu persetujuan'
  | 'Siap diajukan'
  | 'Sudah diajukan'
  | 'Dalam proses'
  | 'Disetujui'
  | 'Ditolak'
  | 'Bantuan diterima'
  | 'Selesai';

export const PROPOSAL_STATUS_ORDER: ProposalStatus[] = [
  'Draft',
  'Menunggu persetujuan',
  'Siap diajukan',
  'Sudah diajukan',
  'Dalam proses',
  'Disetujui',
  'Ditolak',
  'Bantuan diterima',
  'Selesai',
];

export interface InstitutionProfile {
  name: string;
  logoUrl?: string;
  photoUrl?: string;
  address: string;
  kecamatan?: string;
  kabupaten?: string;
  provinsi?: string;
  negara?: string;
  phone?: string;
  email?: string;
  foundedYear?: string;
  statisticNumber?: string;
  legalityInfo?: string;
  leaderName?: string;
  history?: string;
  vision?: string;
  mission?: string;
  organizationStructure?: string;
  studentCount?: number;
  teacherCount?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy: string;
  updatedBy: string;
}

export interface AppUser {
  uid: string;
  username?: string;
  displayName: string;
  email: string;
  photoURL?: string;
  phone?: string;
  position?: string;
  role: UserRole;
  status: UserStatus;
  hasRecoveryCode?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy: string;
  updatedBy: string;
}

export interface ProposalCategory {
  id: string;
  institutionId: string;
  name: string;
  code?: string;
  description?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TemplateSection {
  id: string;
  key: string;
  title: string;
  description: string;
  defaultContent?: string;
  order: number;
  enabled: boolean;
  required?: boolean;
}

export interface ProposalTemplate {
  id: string;
  institutionId: string;
  name: string;
  proposalType: string;
  description: string;
  sections: TemplateSection[];
  isDefault?: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface ProposalSectionContent {
  id: string;
  key: string;
  title: string;
  description?: string;
  content: string;
  enabled: boolean;
  order: number;
}

export interface ProposalRecord {
  id: string;
  institutionId: string;
  proposalNumber?: string;
  proposalDate?: string;
  fiscalYear: number;
  title: string;
  categoryId?: string;
  categoryName?: string;
  templateId?: string;
  proposalType?: string;
  recipientName?: string;
  recipientInstitution?: string;
  recipientAddress?: string;
  location?: string;
  executionTime?: string;
  summary?: string;
  sections?: ProposalSectionContent[];
  attachmentIds?: string[];
  isArchived?: boolean;
  archivedAt?: string;
  status: ProposalStatus;
  totalBudget: number;
  approvedAmount?: number;
  receivedAmount?: number;
  submittedAt?: string;
  approvedAt?: string;
  rejectedReason?: string;
  followUpNotes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy: string;
  updatedBy: string;
}

export interface RabItem {
  id: string;
  groupName: string;
  order: number;
  description: string;
  volume: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

export interface ProposalBudget {
  id: string;
  institutionId: string;
  proposalId: string;
  proposalTitle?: string;
  title: string;
  notes?: string;
  items: RabItem[];
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export type AttachmentCategory =
  | 'Foto Lokasi'
  | 'Foto Bangunan'
  | 'Foto Kegiatan'
  | 'Foto Kondisi Sarana'
  | 'Dokumen Legalitas'
  | 'Surat Pendukung'
  | 'Gambar Desain'
  | 'Lainnya';

export const ATTACHMENT_CATEGORIES: AttachmentCategory[] = [
  'Foto Lokasi',
  'Foto Bangunan',
  'Foto Kegiatan',
  'Foto Kondisi Sarana',
  'Dokumen Legalitas',
  'Surat Pendukung',
  'Gambar Desain',
  'Lainnya',
];

export interface ProposalAttachment {
  id: string;
  institutionId: string;
  proposalId?: string;
  proposalTitle?: string;
  category: AttachmentCategory;
  title: string;
  description?: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  isImage: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface ProposalStatusHistory {
  id: string;
  institutionId: string;
  proposalId: string;
  proposalTitle?: string;
  fromStatus?: ProposalStatus;
  toStatus: ProposalStatus;
  approvedAmount?: number;
  receivedAmount?: number;
  notes?: string;
  actorUid: string;
  actorName: string;
  createdAt: string;
}

export interface SystemAppSettings {
  numberPrefix: string;
  defaultFiscalYear: number;
  letterCity: string;
  paperSize: 'A4';
  includeLogoInLetterhead: boolean;
  footerText: string;
}

export interface AuditLogRecord {
  id?: string;
  institutionId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorUid: string;
  actorName?: string;
  details?: string;
  createdAt?: unknown;
}

export interface AiNarrativeRequest {
  target: 'institution_section' | 'proposal_section';
  section?: 'history' | 'vision' | 'mission' | 'organizationStructure' | 'all';
  sectionKey?: string;
  sectionTitle?: string;
  generateAllSections?: boolean;
  institution?: Partial<InstitutionProfile>;
  proposalContext?: {
    title?: string;
    categoryName?: string;
    proposalType?: string;
    recipientName?: string;
    recipientInstitution?: string;
    location?: string;
    executionTime?: string;
    fiscalYear?: number;
    totalBudget?: number;
    summary?: string;
    existingSections?: Array<{ key: string; title: string; content: string }>;
  };
  userNotes?: string;
}

export interface AiNarrativeResponse {
  history?: string;
  vision?: string;
  mission?: string;
  organizationStructure?: string;
  text?: string;
  sections?: Record<string, string>;
}

export const BLUEPRINT_LIMITS = {
  institution: {
    nameMax: 200,
    logoUrlMax: 2000,
    photoUrlMax: 2000,
    addressMax: 500,
    kecamatanMax: 120,
    kabupatenMax: 120,
    provinsiMax: 120,
    negaraMax: 120,
    phoneMax: 50,
    emailMax: 150,
    foundedYearMax: 10,
    statisticNumberMax: 100,
    legalityInfoMax: 2000,
    leaderNameMax: 150,
    historyMax: 10000,
    visionMax: 3000,
    missionMax: 5000,
    organizationStructureMax: 5000,
  },
  user: {
    displayNameMax: 150,
    emailMax: 200,
    photoURLMax: 2000,
    phoneMax: 50,
    positionMax: 150,
  },
  auditLog: {
    actionMax: 100,
    entityTypeMax: 80,
    entityIdMax: 128,
    actorNameMax: 150,
    detailsMax: 2000,
  },
} as const;

export const DEFAULT_INSTITUTION_SEED: Omit<
  InstitutionProfile,
  'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'
> = {
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
};
