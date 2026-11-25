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
  proposalType?: string;
  recipientName?: string;
  recipientInstitution?: string;
  status: ProposalStatus;
  totalBudget: number;
  approvedAmount?: number;
  receivedAmount?: number;
  submittedAt?: string;
  followUpNotes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy: string;
  updatedBy: string;
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
