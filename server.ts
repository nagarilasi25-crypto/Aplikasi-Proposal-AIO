import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import {
  createInitialCategories,
  createInitialTemplates,
  DEFAULT_APP_SETTINGS,
} from './src/lib/defaultSeeds.ts';

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');
const STORE_FILE = path.join(DATA_DIR, 'arraudhah-store.json');
const SESSION_SECRET_FILE = path.join(DATA_DIR, '.session-secret');

function loadOrCreateSessionSecret(): string {
  const envSecret = (process.env.SESSION_SECRET || '').trim();
  if (envSecret.length >= 16) return envSecret;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(SESSION_SECRET_FILE)) {
      const saved = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
      if (saved.length >= 32) return saved;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SESSION_SECRET_FILE, generated, { encoding: 'utf8', mode: 0o600 });
    return generated;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
}

const SESSION_SECRET = loadOrCreateSessionSecret();
const ENV_ADMIN_PASSCODE = (process.env.ADMIN_PASSCODE || '').trim();
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

type UserRole = 'Administrator' | 'Pimpinan' | 'Operator';
type UserStatus = 'active' | 'pending' | 'inactive';

interface StoredUser {
  uid: string;
  username: string;
  displayName: string;
  email: string;
  phone: string;
  position: string;
  role: UserRole;
  status: UserStatus;
  passwordSalt: string;
  passwordHash: string;
  recoverySalt?: string;
  recoveryHash?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

interface StoredInstitution {
  name: string;
  logoUrl: string;
  photoUrl: string;
  address: string;
  kecamatan: string;
  kabupaten: string;
  provinsi: string;
  negara: string;
  phone: string;
  email: string;
  foundedYear: string;
  statisticNumber: string;
  legalityInfo: string;
  leaderName: string;
  history: string;
  vision: string;
  mission: string;
  organizationStructure: string;
  studentCount: number;
  teacherCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

interface StoreState {
  users: StoredUser[];
  institution: StoredInstitution;
  categoriesSeeded?: boolean;
  templatesSeeded?: boolean;
  proposalCategories: Array<Record<string, unknown>>;
  proposalTemplates: Array<Record<string, unknown>>;
  proposals: Array<Record<string, unknown>>;
  proposalBudgets: Array<Record<string, unknown>>;
  proposalAttachments: Array<Record<string, unknown>>;
  proposalStatusHistory: Array<Record<string, unknown>>;
  appSettings: {
    numberPrefix: string;
    defaultFiscalYear: number;
    letterCity: string;
    paperSize: 'A4';
    includeLogoInLetterhead: boolean;
    footerText: string;
  };
  auditLogs: Array<Record<string, unknown>>;
}

function emptyInstitution(actorUid = ''): StoredInstitution {
  const now = new Date().toISOString();
  return {
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
    createdAt: actorUid ? now : '',
    updatedAt: actorUid ? now : '',
    createdBy: actorUid,
    updatedBy: actorUid,
  };
}

function createEmptyStoreState(): StoreState {
  return {
    users: [],
    institution: emptyInstitution(),
    categoriesSeeded: true,
    templatesSeeded: true,
    proposalCategories: createInitialCategories() as unknown as Array<Record<string, unknown>>,
    proposalTemplates: createInitialTemplates('system') as unknown as Array<Record<string, unknown>>,
    proposals: [],
    proposalBudgets: [],
    proposalAttachments: [],
    proposalStatusHistory: [],
    appSettings: { ...DEFAULT_APP_SETTINGS },
    auditLogs: [],
  };
}

function readStore(): StoreState {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    const initial = createEmptyStoreState();
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreState>;

    const categoriesRaw = Array.isArray(parsed.proposalCategories) ? parsed.proposalCategories : [];
    const templatesRaw = Array.isArray(parsed.proposalTemplates) ? parsed.proposalTemplates : [];
    const shouldSeedCategories = !parsed.categoriesSeeded && categoriesRaw.length === 0;
    const shouldSeedTemplates = !parsed.templatesSeeded && templatesRaw.length === 0;

    const state: StoreState = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      institution: parsed.institution || emptyInstitution(),
      categoriesSeeded: true,
      templatesSeeded: true,
      proposalCategories: shouldSeedCategories
        ? (createInitialCategories() as unknown as Array<Record<string, unknown>>)
        : categoriesRaw,
      proposalTemplates: shouldSeedTemplates
        ? (createInitialTemplates('system') as unknown as Array<Record<string, unknown>>)
        : templatesRaw,
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      proposalBudgets: Array.isArray(parsed.proposalBudgets) ? parsed.proposalBudgets : [],
      proposalAttachments: Array.isArray(parsed.proposalAttachments)
        ? parsed.proposalAttachments
        : [],
      proposalStatusHistory: Array.isArray(parsed.proposalStatusHistory)
        ? parsed.proposalStatusHistory
        : [],
      appSettings: {
        ...DEFAULT_APP_SETTINGS,
        ...(parsed.appSettings || {}),
        paperSize: 'A4',
      },
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
    };

    if (shouldSeedCategories || shouldSeedTemplates) {
      writeStore(state);
    }
    return state;
  } catch {
    return createEmptyStoreState();
  }
}

function writeStore(state: StoreState): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempPath = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempPath, STORE_FILE);
}

function hashPassword(password: string, existingSalt?: string): { salt: string; hash: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: derived };
}

function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  if (!salt || !storedHash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

function verifyEnvPasscode(candidate: string): boolean {
  if (!ENV_ADMIN_PASSCODE) return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(ENV_ADMIN_PASSCODE).digest();
  return crypto.timingSafeEqual(a, b);
}

function signSessionToken(uid: string, role: UserRole): string {
  const payload = {
    uid,
    role,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token: string): { uid: string; role: UserRole } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      uid?: string;
      role?: UserRole;
      exp?: number;
    };
    if (!parsed.uid || !parsed.role || !parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    return { uid: parsed.uid, role: parsed.role };
  } catch {
    return null;
  }
}

function sanitizeStr(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function sanitizeNum(value: unknown, min = 0, max = 1000000): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function saveBase64AssetToUploads(
  dataUrl: string,
  prefix: string
): { url: string; mimeType: string; fileSize: number; isImage: boolean } {
  const match =
    /^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/i.exec(
      dataUrl.trim()
    );
  if (!match) {
    throw new Error('Format berkas tidak didukung. Gunakan PNG, JPG, WebP, atau PDF.');
  }

  const fullMime = match[1].toLowerCase();
  const imageSubtype = match[2]?.toLowerCase();
  const base64Body = match[3];
  const buffer = Buffer.from(base64Body, 'base64');

  const maxSize = fullMime === 'application/pdf' ? 4 * 1024 * 1024 : 2 * 1024 * 1024;
  if (buffer.length === 0 || buffer.length > maxSize) {
    throw new Error(
      fullMime === 'application/pdf'
        ? 'Ukuran berkas PDF melebihi batas maksimal 4 MB.'
        : 'Ukuran gambar melebihi batas maksimal 2 MB.'
    );
  }

  let ext = 'bin';
  let isImage = true;
  let canonicalMime = fullMime;

  if (fullMime === 'application/pdf') {
    const isPdf = buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    if (!isPdf) {
      throw new Error('Isi berkas bukan dokumen PDF yang valid.');
    }
    ext = 'pdf';
    isImage = false;
  } else {
    const isPng =
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
    const isJpeg =
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
    const isWebp =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';

    if (
      (imageSubtype === 'png' && !isPng) ||
      ((imageSubtype === 'jpeg' || imageSubtype === 'jpg') && !isJpeg) ||
      (imageSubtype === 'webp' && !isWebp)
    ) {
      throw new Error('Isi berkas gambar tidak sesuai dengan format gambar yang dipilih.');
    }
    ext = imageSubtype === 'jpeg' || imageSubtype === 'jpg' ? 'jpg' : imageSubtype || 'png';
    canonicalMime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  }

  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'lampiran';
  const filename = `${safePrefix}-${Date.now()}-${crypto.randomUUID()}.${ext}`;

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const targetPath = path.resolve(UPLOADS_DIR, filename);
  if (!targetPath.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error('Lokasi penyimpanan berkas tidak valid.');
  }
  fs.writeFileSync(targetPath, buffer);
  return {
    url: `/api/uploads/${filename}`,
    mimeType: canonicalMime,
    fileSize: buffer.length,
    isImage,
  };
}

function saveBase64ImageToUploads(
  dataUrl: string,
  field: 'logoUrl' | 'photoUrl'
): string {
  const saved = saveBase64AssetToUploads(dataUrl, field === 'logoUrl' ? 'logo' : 'foto');
  if (!saved.isImage) {
    throw new Error('Logo atau foto lembaga harus berupa gambar PNG, JPG, atau WebP.');
  }
  return saved.url;
}

function resolveInstitutionImageField(
  rawValue: unknown,
  field: 'logoUrl' | 'photoUrl'
): string {
  if (typeof rawValue !== 'string') return '';
  const trimmed = rawValue.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:image/')) {
    return saveBase64ImageToUploads(trimmed, field);
  }
  if (trimmed.startsWith('/api/uploads/')) {
    return trimmed.slice(0, 500);
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return trimmed.slice(0, 2000);
    }
  } catch {
    return '';
  }
  return '';
}

function toPublicUser(u: StoredUser) {
  return {
    uid: u.uid,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    phone: u.phone,
    position: u.position,
    role: u.role,
    status: u.status,
    hasRecoveryCode: Boolean(u.recoveryHash),
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    createdBy: u.createdBy,
    updatedBy: u.updatedBy,
  };
}

function appendAudit(
  store: StoreState,
  entry: {
    action: string;
    entityType: string;
    entityId: string;
    actorUid: string;
    actorName: string;
    details: string;
  }
) {
  store.auditLogs.push({
    id: `log_${crypto.randomUUID()}`,
    institutionId: 'ar-raudhah',
    action: sanitizeStr(entry.action, 100),
    entityType: sanitizeStr(entry.entityType, 80),
    entityId: sanitizeStr(entry.entityId, 128),
    actorUid: entry.actorUid,
    actorName: sanitizeStr(entry.actorName, 150),
    details: sanitizeStr(entry.details, 2000),
    createdAt: new Date().toISOString(),
  });
}

interface AuthedRequest extends Request {
  currentUser?: StoredUser;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sesi tidak valid. Silakan masuk kembali.' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const decoded = verifySessionToken(token);
  if (!decoded) {
    res.status(401).json({ error: 'Token sesi kedaluwarsa atau tidak sah.' });
    return;
  }

  const store = readStore();
  let user = store.users.find((u) => u.uid === decoded.uid);

  // Support virtual env admin if authenticated via ADMIN_PASSCODE
  if (!user && decoded.uid === 'env-admin' && ENV_ADMIN_PASSCODE) {
    user = {
      uid: 'env-admin',
      username: 'admin',
      displayName: 'Administrator',
      email: '',
      phone: '',
      position: 'Administrator Sistem',
      role: 'Administrator',
      status: 'active',
      passwordSalt: '',
      passwordHash: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'system',
      updatedBy: 'system',
    };
  }

  if (!user) {
    res.status(401).json({
      code: 'USER_NOT_FOUND',
      error: 'Akun tidak ditemukan pada sesi server. Silakan hubungkan kembali sesi Anda.',
    });
    return;
  }

  if (user.status !== 'active') {
    res.status(403).json({
      code: user.status === 'pending' ? 'ACCOUNT_PENDING' : 'ACCOUNT_INACTIVE',
      error: 'Akun Anda belum aktif atau telah dinonaktifkan.',
    });
    return;
  }

  req.currentUser = user;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.currentUser || req.currentUser.role !== 'Administrator') {
    res.status(403).json({ error: 'Akses ditolak. Hanya Administrator yang diizinkan.' });
    return;
  }
  next();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/uploads/:filename', (req, res) => {
    const filename = req.params.filename || '';
    if (!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|pdf)$/i.test(filename)) {
      res.status(400).json({ error: 'Nama berkas tidak valid.' });
      return;
    }
    const targetPath = path.resolve(UPLOADS_DIR, filename);
    if (!targetPath.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(targetPath)) {
      res.status(404).json({ error: 'Berkas tidak ditemukan.' });
      return;
    }
    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
        ? 'image/webp'
        : ext === '.pdf'
        ? 'application/pdf'
        : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.sendFile(targetPath);
  });

  // 1. Bootstrap status (first-run admin claim check)
  app.get('/api/auth/bootstrap-status', (_req, res) => {
    const store = readStore();
    const hasActiveAdmin = store.users.some(
      (u) => u.role === 'Administrator' && u.status === 'active'
    );
    const needsSetup = !hasActiveAdmin;
    res.json({
      needsSetup,
      hasEnvAdminPasscode: Boolean(ENV_ADMIN_PASSCODE),
    });
  });

  // 2. First-run admin claim (Nama + Sandi, no email required)
  app.post('/api/auth/setup', (req, res) => {
    const store = readStore();
    const hasActiveAdmin = store.users.some(
      (u) => u.role === 'Administrator' && u.status === 'active'
    );
    if (hasActiveAdmin) {
      res.status(409).json({
        error: 'Akun Administrator pertama sudah dibuat. Silakan masuk menggunakan Nama dan Sandi.',
      });
      return;
    }

    const username = sanitizeStr(req.body?.username, 80);
    const displayName = sanitizeStr(req.body?.displayName || username, 150);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const recoveryCode =
      typeof req.body?.recoveryCode === 'string' ? req.body.recoveryCode.trim() : '';

    if (username.length < 3 || !/^[a-zA-Z0-9_.\- ]+$/.test(username)) {
      res.status(400).json({
        error: 'Nama pengguna minimal 3 karakter (huruf, angka, spasi, titik, garis bawah, atau tanda hubung).',
      });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Kata sandi harus terdiri dari 6 hingga 128 karakter.' });
      return;
    }
    if (recoveryCode && (recoveryCode.length < 4 || recoveryCode.length > 64)) {
      res.status(400).json({ error: 'Kode pemulihan akun harus terdiri dari 4 hingga 64 karakter.' });
      return;
    }

    const now = new Date().toISOString();
    const uid = `usr_${crypto.randomUUID()}`;
    const { salt, hash } = hashPassword(password);
    const recovery = recoveryCode ? hashPassword(recoveryCode) : null;

    const adminUser: StoredUser = {
      uid,
      username,
      displayName: displayName || username,
      email: '',
      phone: '',
      position: 'Administrator Sistem',
      role: 'Administrator',
      status: 'active',
      passwordSalt: salt,
      passwordHash: hash,
      ...(recovery ? { recoverySalt: recovery.salt, recoveryHash: recovery.hash } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: uid,
      updatedBy: uid,
    };

    store.users.push(adminUser);
    appendAudit(store, {
      action: 'USER_BOOTSTRAP_ADMIN',
      entityType: 'users',
      entityId: uid,
      actorUid: uid,
      actorName: adminUser.displayName,
      details: `Membuat akun Administrator pertama (${username}) tanpa email.`,
    });
    writeStore(store);

    const token = signSessionToken(uid, 'Administrator');
    res.status(201).json({
      token,
      user: toPublicUser(adminUser),
      institution: store.institution,
    });
  });

  // 3. Login with Nama (username) & Sandi (password)
  app.post('/api/auth/login', (req, res) => {
    const username = sanitizeStr(req.body?.username, 80);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      res.status(400).json({ error: 'Nama dan kata sandi wajib diisi.' });
      return;
    }

    // Check env ADMIN_PASSCODE override first for "admin" / "administrator"
    if (
      ENV_ADMIN_PASSCODE &&
      (username.toLowerCase() === 'admin' || username.toLowerCase() === 'administrator') &&
      verifyEnvPasscode(password)
    ) {
      const store = readStore();
      const envAdminUser: StoredUser = {
        uid: 'env-admin',
        username: 'admin',
        displayName: 'Administrator',
        email: '',
        phone: '',
        position: 'Administrator Sistem',
        role: 'Administrator',
        status: 'active',
        passwordSalt: '',
        passwordHash: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'system',
        updatedBy: 'system',
      };
      const token = signSessionToken('env-admin', 'Administrator');
      res.json({
        token,
        user: toPublicUser(envAdminUser),
        institution: store.institution,
      });
      return;
    }

    const store = readStore();
    const user = store.users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );

    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      res.status(401).json({ error: 'Nama atau kata sandi tidak sesuai.' });
      return;
    }

    if (user.status === 'pending') {
      if (user.role === 'Administrator') {
        user.status = 'active';
        user.updatedAt = new Date().toISOString();
        user.updatedBy = user.uid;
        writeStore(store);
      } else {
        res.status(403).json({
          code: 'ACCOUNT_PENDING',
          error: 'Akun Anda berstatus Menunggu Aktivasi oleh Administrator.',
          user: toPublicUser(user),
        });
        return;
      }
    }

    if (user.status === 'inactive') {
      res.status(403).json({
        code: 'ACCOUNT_INACTIVE',
        error: 'Akun Anda telah dinonaktifkan oleh Administrator.',
        user: toPublicUser(user),
      });
      return;
    }

    const token = signSessionToken(user.uid, user.role);
    res.json({
      token,
      user: toPublicUser(user),
      institution: store.institution,
    });
  });

  // 4. Register new user with Nama + Sandi
  // - If no active Administrator exists yet, the registered account becomes active Administrator immediately.
  // - If requesting Administrator role when an Admin already exists, verify active Admin credentials or server passcode and activate immediately.
  // - Otherwise registers as Operator with status 'pending'.
  app.post('/api/auth/register', (req, res) => {
    const username = sanitizeStr(req.body?.username, 80);
    const displayName = sanitizeStr(req.body?.displayName || username, 150);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const recoveryCode =
      typeof req.body?.recoveryCode === 'string' ? req.body.recoveryCode.trim() : '';
    const requestedRole: UserRole =
      req.body?.role === 'Administrator' ? 'Administrator' : 'Operator';
    const approverUsername = sanitizeStr(req.body?.approverUsername, 80);
    const approverPassword =
      typeof req.body?.approverPassword === 'string' ? req.body.approverPassword : '';

    if (username.length < 3 || !/^[a-zA-Z0-9_.\- ]+$/.test(username)) {
      res.status(400).json({
        error: 'Nama pengguna minimal 3 karakter (huruf, angka, spasi, titik, garis bawah, atau tanda hubung).',
      });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
      return;
    }
    if (recoveryCode && (recoveryCode.length < 4 || recoveryCode.length > 64)) {
      res.status(400).json({ error: 'Kode pemulihan akun minimal 4 karakter.' });
      return;
    }

    const store = readStore();
    const duplicate = store.users.some(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );
    if (duplicate) {
      res.status(409).json({ error: 'Nama pengguna tersebut sudah terdaftar. Gunakan nama lain.' });
      return;
    }

    const hasActiveAdmin = store.users.some(
      (u) => u.role === 'Administrator' && u.status === 'active'
    );

    let assignedRole: UserRole = 'Operator';
    let assignedStatus: UserStatus = 'pending';
    let actorUidForAudit = '';

    if (!hasActiveAdmin) {
      assignedRole = 'Administrator';
      assignedStatus = 'active';
    } else if (requestedRole === 'Administrator') {
      const matchedApprover = approverUsername
        ? store.users.find(
            (u) =>
              u.username.toLowerCase() === approverUsername.toLowerCase() &&
              u.role === 'Administrator' &&
              u.status === 'active' &&
              verifyPassword(approverPassword, u.passwordSalt, u.passwordHash)
          )
        : undefined;
      const validPasscodeApprover =
        Boolean(approverPassword) && verifyEnvPasscode(approverPassword);

      if (!matchedApprover && !validPasscodeApprover) {
        res.status(403).json({
          error:
            'Untuk langsung mengaktifkan akun Administrator baru, masukkan nama pengguna dan kata sandi Administrator yang sudah aktif (atau Kode Akses Server).',
        });
        return;
      }
      assignedRole = 'Administrator';
      assignedStatus = 'active';
      actorUidForAudit = matchedApprover?.uid || 'env-admin';
    }

    const now = new Date().toISOString();
    const uid = `usr_${crypto.randomUUID()}`;
    const { salt, hash } = hashPassword(password);
    const recovery = recoveryCode ? hashPassword(recoveryCode) : null;

    const newUser: StoredUser = {
      uid,
      username,
      displayName: displayName || username,
      email: '',
      phone: '',
      position: assignedRole === 'Administrator' ? 'Administrator Sistem' : '',
      role: assignedRole,
      status: assignedStatus,
      passwordSalt: salt,
      passwordHash: hash,
      ...(recovery ? { recoverySalt: recovery.salt, recoveryHash: recovery.hash } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: actorUidForAudit || uid,
      updatedBy: actorUidForAudit || uid,
    };

    store.users.push(newUser);
    if (assignedRole === 'Administrator' && assignedStatus === 'active') {
      appendAudit(store, {
        action: 'USER_ADMIN_DIRECT_ACTIVE',
        entityType: 'users',
        entityId: uid,
        actorUid: actorUidForAudit || uid,
        actorName: newUser.displayName,
        details: `Akun Administrator ${username} dibuat dan langsung aktif tanpa persetujuan tertunda.`,
      });
    }
    writeStore(store);

    if (assignedStatus === 'active') {
      const token = signSessionToken(newUser.uid, newUser.role);
      res.status(201).json({
        autoActivated: true,
        message: 'Akun Administrator berhasil dibuat dan langsung aktif.',
        token,
        user: toPublicUser(newUser),
        institution: store.institution,
      });
      return;
    }

    res.status(201).json({
      autoActivated: false,
      message: 'Pendaftaran berhasil. Akun berstatus Menunggu Aktivasi dari Administrator.',
      user: toPublicUser(newUser),
    });
  });

  // 4a. Activate a pending account directly using active Administrator credentials or server passcode
  app.post('/api/auth/activate-pending', (req, res) => {
    const targetUsername = sanitizeStr(req.body?.username, 80);
    const approverUsername = sanitizeStr(req.body?.approverUsername, 80);
    const approverPassword =
      typeof req.body?.approverPassword === 'string' ? req.body.approverPassword : '';
    const promoteToAdmin = Boolean(req.body?.promoteToAdmin);

    if (!targetUsername || !approverPassword) {
      res.status(400).json({
        error: 'Nama akun dan kredensial Administrator aktif wajib diisi.',
      });
      return;
    }

    const store = readStore();
    const target = store.users.find(
      (u) => u.username.toLowerCase() === targetUsername.toLowerCase()
    );
    if (!target) {
      res.status(404).json({ error: 'Akun tidak ditemukan.' });
      return;
    }

    const matchedApprover = approverUsername
      ? store.users.find(
          (u) =>
            u.username.toLowerCase() === approverUsername.toLowerCase() &&
            u.role === 'Administrator' &&
            u.status === 'active' &&
            verifyPassword(approverPassword, u.passwordSalt, u.passwordHash)
        )
      : undefined;
    const validPasscode = verifyEnvPasscode(approverPassword);

    if (!matchedApprover && !validPasscode) {
      res.status(403).json({
        error: 'Nama pengguna atau kata sandi Administrator aktif tidak sesuai.',
      });
      return;
    }

    target.status = 'active';
    if (promoteToAdmin) {
      target.role = 'Administrator';
      target.position = target.position || 'Administrator Sistem';
    }
    target.updatedAt = new Date().toISOString();
    target.updatedBy = matchedApprover?.uid || 'env-admin';

    appendAudit(store, {
      action: 'USER_DIRECT_ACTIVATE',
      entityType: 'users',
      entityId: target.uid,
      actorUid: matchedApprover?.uid || 'env-admin',
      actorName: matchedApprover?.displayName || 'Administrator',
      details: `Mengaktifkan akun ${target.username} sebagai ${target.role}.`,
    });
    writeStore(store);

    res.json({
      ok: true,
      user: toPublicUser(target),
      message: `Akun ${target.username} telah diaktifkan sebagai ${target.role}.`,
    });
  });

  // 4b. Recover forgotten username by verifying displayName + password or recoveryCode
  app.post('/api/auth/recover-username', (req, res) => {
    const displayName = sanitizeStr(req.body?.displayName, 150);
    const secret = typeof req.body?.secret === 'string' ? req.body.secret : '';

    if (!displayName || !secret) {
      res.status(400).json({
        error: 'Nama lengkap dan kata sandi (atau kode pemulihan) wajib diisi.',
      });
      return;
    }

    const store = readStore();
    const candidates = store.users.filter(
      (u) => u.displayName.trim().toLowerCase() === displayName.toLowerCase()
    );

    const matched = candidates.find(
      (u) =>
        verifyPassword(secret, u.passwordSalt, u.passwordHash) ||
        (u.recoverySalt &&
          u.recoveryHash &&
          verifyPassword(secret.trim(), u.recoverySalt, u.recoveryHash))
    );

    if (!matched) {
      res.status(401).json({
        error: 'Data nama lengkap atau kata sandi/kode pemulihan tidak cocok.',
      });
      return;
    }

    res.json({
      username: matched.username,
      displayName: matched.displayName,
    });
  });

  // 4c. Reset forgotten password or username using account recovery code or server ADMIN_PASSCODE
  app.post('/api/auth/reset-account', (req, res) => {
    const identifier = sanitizeStr(req.body?.identifier, 150);
    const recoveryCode =
      typeof req.body?.recoveryCode === 'string' ? req.body.recoveryCode.trim() : '';
    const newUsername = sanitizeStr(req.body?.newUsername, 80);
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!identifier || !recoveryCode || !newPassword) {
      res.status(400).json({
        error: 'Nama pengguna/nama lengkap, kode pemulihan, dan kata sandi baru wajib diisi.',
      });
      return;
    }

    if (newPassword.length < 6 || newPassword.length > 128) {
      res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
      return;
    }

    if (newUsername && (newUsername.length < 3 || !/^[a-zA-Z0-9_.\- ]+$/.test(newUsername))) {
      res.status(400).json({
        error: 'Nama pengguna baru minimal 3 karakter (huruf, angka, spasi, titik, garis bawah, atau tanda hubung).',
      });
      return;
    }

    const store = readStore();
    const lowered = identifier.toLowerCase();
    const target =
      store.users.find((u) => u.username.toLowerCase() === lowered) ||
      (() => {
        const byDisplay = store.users.filter(
          (u) => u.displayName.trim().toLowerCase() === lowered
        );
        return byDisplay.length === 1 ? byDisplay[0] : undefined;
      })();

    if (!target) {
      res.status(404).json({
        error: 'Akun tidak ditemukan. Periksa kembali nama pengguna atau nama lengkap Anda.',
      });
      return;
    }

    const validUserRecovery =
      Boolean(target.recoverySalt && target.recoveryHash) &&
      verifyPassword(recoveryCode, target.recoverySalt!, target.recoveryHash!);
    const validServerOverride = verifyEnvPasscode(recoveryCode);

    if (!validUserRecovery && !validServerOverride) {
      res.status(403).json({
        error:
          'Kode pemulihan tidak sesuai atau belum diatur pada akun ini. Hubungi Administrator untuk reset manual melalui Manajemen Pengguna.',
      });
      return;
    }

    if (
      newUsername &&
      store.users.some(
        (u) => u.uid !== target.uid && u.username.toLowerCase() === newUsername.toLowerCase()
      )
    ) {
      res.status(409).json({
        error: 'Nama pengguna baru sudah digunakan akun lain. Pilih nama lain.',
      });
      return;
    }

    if (newUsername) {
      target.username = newUsername;
    }
    const { salt, hash } = hashPassword(newPassword);
    target.passwordSalt = salt;
    target.passwordHash = hash;
    target.updatedAt = new Date().toISOString();
    target.updatedBy = target.uid;

    appendAudit(store, {
      action: 'USER_ACCOUNT_RESET',
      entityType: 'users',
      entityId: target.uid,
      actorUid: target.uid,
      actorName: target.displayName,
      details: `Reset akun mandiri untuk ${target.username}.`,
    });
    writeStore(store);

    res.json({
      ok: true,
      username: target.username,
      message: `Akun ${target.username} berhasil direset. Silakan masuk dengan kredensial baru.`,
    });
  });

  // 5. Current authenticated profile
  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const store = readStore();
    res.json({
      user: toPublicUser(req.currentUser!),
      institution: store.institution,
    });
  });

  app.patch('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.uid === 'env-admin') {
      res.status(400).json({ error: 'Akun bawaan server tidak dapat diubah melalui menu ini.' });
      return;
    }

    const store = readStore();
    const target = store.users.find((u) => u.uid === actor.uid);
    if (!target) {
      res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      return;
    }

    const displayName = sanitizeStr(req.body?.displayName, 150);
    if (!displayName) {
      res.status(400).json({ error: 'Nama tampilan wajib diisi.' });
      return;
    }

    target.displayName = displayName;
    target.phone = sanitizeStr(req.body?.phone, 50);
    target.position = sanitizeStr(req.body?.position, 150);

    if (typeof req.body?.newPassword === 'string' && req.body.newPassword.length > 0) {
      const currentPassword =
        typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
      if (!verifyPassword(currentPassword, target.passwordSalt, target.passwordHash)) {
        res.status(400).json({ error: 'Kata sandi lama tidak sesuai.' });
        return;
      }
      if (req.body.newPassword.length < 6 || req.body.newPassword.length > 128) {
        res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
        return;
      }
      const { salt, hash } = hashPassword(req.body.newPassword);
      target.passwordSalt = salt;
      target.passwordHash = hash;
    }

    if (typeof req.body?.recoveryCode === 'string' && req.body.recoveryCode.trim().length > 0) {
      const code = req.body.recoveryCode.trim();
      if (code.length < 4 || code.length > 64) {
        res.status(400).json({ error: 'Kode pemulihan harus 4 hingga 64 karakter.' });
        return;
      }
      const recovery = hashPassword(code);
      target.recoverySalt = recovery.salt;
      target.recoveryHash = recovery.hash;
    }

    target.updatedAt = new Date().toISOString();
    target.updatedBy = actor.uid;
    writeStore(store);

    res.json({ user: toPublicUser(target) });
  });

  // 6. Institution Profile & Image Uploads
  app.get('/api/institution', requireAuth, (_req, res) => {
    const store = readStore();
    res.json({ institution: store.institution });
  });

  app.post('/api/institution/upload', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    const field = req.body?.field === 'logoUrl' ? 'logoUrl' : req.body?.field === 'photoUrl' ? 'photoUrl' : null;
    const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';

    if (!field || !dataUrl) {
      res.status(400).json({ error: 'Berkas gambar dan jenis target wajib diisi.' });
      return;
    }

    try {
      const uploadedUrl = saveBase64ImageToUploads(dataUrl, field);
      const store = readStore();
      const now = new Date().toISOString();
      store.institution[field] = uploadedUrl;
      store.institution.createdAt = store.institution.createdAt || now;
      store.institution.createdBy = store.institution.createdBy || actor.uid;
      store.institution.updatedAt = now;
      store.institution.updatedBy = actor.uid;

      appendAudit(store, {
        action: 'INSTITUTION_IMAGE_UPLOAD',
        entityType: 'institutions',
        entityId: 'ar-raudhah',
        actorUid: actor.uid,
        actorName: actor.displayName,
        details: `Mengunggah ${field === 'logoUrl' ? 'Logo Lembaga' : 'Foto Lembaga'}.`,
      });
      writeStore(store);

      res.json({ url: uploadedUrl, institution: store.institution });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal memproses berkas gambar.',
      });
    }
  });

  app.put('/api/institution', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    const store = readStore();
    const now = new Date().toISOString();
    const body = req.body || {};

    let resolvedLogoUrl = '';
    let resolvedPhotoUrl = '';
    try {
      resolvedLogoUrl = resolveInstitutionImageField(body.logoUrl, 'logoUrl');
      resolvedPhotoUrl = resolveInstitutionImageField(body.photoUrl, 'photoUrl');
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Format logo atau foto lembaga tidak valid.',
      });
      return;
    }

    const updated: StoredInstitution = {
      name: sanitizeStr(body.name, 200),
      logoUrl: resolvedLogoUrl,
      photoUrl: resolvedPhotoUrl,
      address: sanitizeStr(body.address, 500),
      kecamatan: sanitizeStr(body.kecamatan, 120),
      kabupaten: sanitizeStr(body.kabupaten, 120),
      provinsi: sanitizeStr(body.provinsi, 120),
      negara: sanitizeStr(body.negara, 120),
      phone: sanitizeStr(body.phone, 50),
      email: sanitizeStr(body.email, 150),
      foundedYear: sanitizeStr(body.foundedYear, 10),
      statisticNumber: sanitizeStr(body.statisticNumber, 100),
      legalityInfo: sanitizeStr(body.legalityInfo, 2000),
      leaderName: sanitizeStr(body.leaderName, 150),
      history: sanitizeStr(body.history, 10000),
      vision: sanitizeStr(body.vision, 3000),
      mission: sanitizeStr(body.mission, 5000),
      organizationStructure: sanitizeStr(body.organizationStructure, 5000),
      studentCount: sanitizeNum(body.studentCount, 0, 1000000),
      teacherCount: sanitizeNum(body.teacherCount, 0, 1000000),
      createdAt: store.institution.createdAt || now,
      updatedAt: now,
      createdBy: store.institution.createdBy || actor.uid,
      updatedBy: actor.uid,
    };

    store.institution = updated;
    appendAudit(store, {
      action: 'INSTITUTION_UPDATE',
      entityType: 'institutions',
      entityId: 'ar-raudhah',
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Memperbarui profil lembaga${updated.name ? `: ${updated.name}` : ' (dikosongkan)'}.`,
    });
    writeStore(store);

    res.json({ institution: updated });
  });

  // 7. Users Management (Admin Only)
  app.get('/api/users', requireAuth, requireAdmin, (_req, res) => {
    const store = readStore();
    res.json({ users: store.users.map(toPublicUser) });
  });

  app.post('/api/users', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    const username = sanitizeStr(req.body?.username, 80);
    const displayName = sanitizeStr(req.body?.displayName || username, 150);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role: UserRole = ['Administrator', 'Pimpinan', 'Operator'].includes(req.body?.role)
      ? req.body.role
      : 'Operator';
    let status: UserStatus = ['active', 'pending', 'inactive'].includes(req.body?.status)
      ? req.body.status
      : 'active';
    if (role === 'Administrator' && status === 'pending') {
      status = 'active';
    }

    if (username.length < 3 || !/^[a-zA-Z0-9_.\- ]+$/.test(username)) {
      res.status(400).json({ error: 'Nama pengguna minimal 3 karakter.' });
      return;
    }
    if (password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
      return;
    }

    const store = readStore();
    if (store.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      res.status(409).json({ error: 'Nama pengguna sudah digunakan.' });
      return;
    }

    const now = new Date().toISOString();
    const uid = `usr_${crypto.randomUUID()}`;
    const { salt, hash } = hashPassword(password);

    const newUser: StoredUser = {
      uid,
      username,
      displayName: displayName || username,
      email: '',
      phone: sanitizeStr(req.body?.phone, 50),
      position: sanitizeStr(req.body?.position, 150),
      role,
      status,
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.uid,
      updatedBy: actor.uid,
    };

    store.users.push(newUser);
    appendAudit(store, {
      action: 'USER_CREATE',
      entityType: 'users',
      entityId: uid,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menambahkan pengguna ${username} dengan peran ${role}.`,
    });
    writeStore(store);

    res.status(201).json({ user: toPublicUser(newUser) });
  });

  app.patch('/api/users/:uid', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    const targetUid = req.params.uid;
    const store = readStore();
    const target = store.users.find((u) => u.uid === targetUid);

    if (!target) {
      res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      return;
    }

    const displayName = sanitizeStr(req.body?.displayName, 150);
    if (!displayName) {
      res.status(400).json({ error: 'Nama tampilan wajib diisi.' });
      return;
    }

    const requestedUsername = sanitizeStr(req.body?.username, 80);
    if (requestedUsername) {
      if (requestedUsername.length < 3 || !/^[a-zA-Z0-9_.\- ]+$/.test(requestedUsername)) {
        res.status(400).json({
          error: 'Nama pengguna minimal 3 karakter (huruf, angka, spasi, titik, garis bawah, atau tanda hubung).',
        });
        return;
      }
      if (
        store.users.some(
          (u) => u.uid !== target.uid && u.username.toLowerCase() === requestedUsername.toLowerCase()
        )
      ) {
        res.status(409).json({ error: 'Nama pengguna tersebut sudah digunakan akun lain.' });
        return;
      }
      target.username = requestedUsername;
    }

    const nextRole: UserRole = ['Administrator', 'Pimpinan', 'Operator'].includes(req.body?.role)
      ? req.body.role
      : target.role;
    let nextStatus: UserStatus = ['active', 'pending', 'inactive'].includes(req.body?.status)
      ? req.body.status
      : target.status;
    if (nextRole === 'Administrator' && nextStatus === 'pending') {
      nextStatus = 'active';
    }

    if (target.uid === actor.uid && nextStatus !== 'active') {
      res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun Anda sendiri.' });
      return;
    }

    target.displayName = displayName;
    target.phone = sanitizeStr(req.body?.phone, 50);
    target.position = sanitizeStr(req.body?.position, 150);
    target.role = nextRole;
    target.status = nextStatus;

    if (typeof req.body?.newPassword === 'string' && req.body.newPassword.length > 0) {
      if (req.body.newPassword.length < 6 || req.body.newPassword.length > 128) {
        res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
        return;
      }
      const { salt, hash } = hashPassword(req.body.newPassword);
      target.passwordSalt = salt;
      target.passwordHash = hash;
    }

    if (typeof req.body?.recoveryCode === 'string' && req.body.recoveryCode.trim().length > 0) {
      const code = req.body.recoveryCode.trim();
      if (code.length < 4 || code.length > 64) {
        res.status(400).json({ error: 'Kode pemulihan minimal 4 karakter.' });
        return;
      }
      const recovery = hashPassword(code);
      target.recoverySalt = recovery.salt;
      target.recoveryHash = recovery.hash;
    }

    target.updatedAt = new Date().toISOString();
    target.updatedBy = actor.uid;

    appendAudit(store, {
      action: 'USER_ROLE_STATUS_UPDATE',
      entityType: 'users',
      entityId: target.uid,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Memperbarui pengguna ${target.username}: ${nextRole} (${nextStatus}).`,
    });
    writeStore(store);

    res.json({ user: toPublicUser(target) });
  });

  app.delete('/api/users/:uid', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    const targetUid = req.params.uid;
    if (targetUid === actor.uid) {
      res.status(400).json({ error: 'Anda tidak dapat menghapus akun Anda sendiri.' });
      return;
    }

    const store = readStore();
    const idx = store.users.findIndex((u) => u.uid === targetUid);
    if (idx === -1) {
      res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      return;
    }

    const [removed] = store.users.splice(idx, 1);
    appendAudit(store, {
      action: 'USER_DELETE',
      entityType: 'users',
      entityId: targetUid,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menghapus pengguna ${removed.username}.`,
    });
    writeStore(store);

    res.json({ ok: true });
  });

  // 8. Dashboard snapshot (full state for offline sync cache)
  app.get('/api/dashboard-data', requireAuth, (_req, res) => {
    const store = readStore();
    res.json({
      institution: store.institution,
      proposals: store.proposals,
      categories: store.proposalCategories,
      templates: store.proposalTemplates,
      budgets: store.proposalBudgets,
      attachments: store.proposalAttachments,
      statusHistory: store.proposalStatusHistory,
      appSettings: store.appSettings,
    });
  });

  // 8a. Server-Side Gemini AI Narrative Generation
  const parseModelJson = <T,>(rawText: string): T => {
    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(cleaned) as T;
  };

  app.get('/api/ai/status', requireAuth, (_req, res) => {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const configured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
    res.json({
      configured,
      model: 'gemini-4-hydrogen',
    });
  });

  app.post('/api/ai/generate-narrative', requireAuth, async (req: AuthedRequest, res) => {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      res.status(503).json({
        error:
          'Kunci API Gemini (GEMINI_API_KEY) belum dikonfigurasi pada server. Atur variabel GEMINI_API_KEY di panel Secrets / environment server lalu muat ulang server.',
      });
      return;
    }

    const actor = req.currentUser!;
    const store = readStore();
    const body = req.body || {};
    const target = body.target === 'proposal_section' ? 'proposal_section' : 'institution_section';
    const userNotes = sanitizeStr(body.userNotes, 1500);
    const instInput = (body.institution && typeof body.institution === 'object'
      ? body.institution
      : store.institution) as Partial<StoredInstitution>;

    const institutionContextText = [
      instInput.name ? `Nama Lembaga: ${sanitizeStr(instInput.name, 200)}` : '',
      instInput.address ? `Alamat: ${sanitizeStr(instInput.address, 500)}` : '',
      instInput.kecamatan ? `Kecamatan: ${sanitizeStr(instInput.kecamatan, 120)}` : '',
      instInput.kabupaten ? `Kabupaten/Kota: ${sanitizeStr(instInput.kabupaten, 120)}` : '',
      instInput.provinsi ? `Provinsi: ${sanitizeStr(instInput.provinsi, 120)}` : '',
      instInput.foundedYear ? `Tahun Berdiri: ${sanitizeStr(instInput.foundedYear, 10)}` : '',
      instInput.leaderName ? `Pimpinan Lembaga: ${sanitizeStr(instInput.leaderName, 150)}` : '',
      instInput.statisticNumber ? `Nomor Statistik: ${sanitizeStr(instInput.statisticNumber, 100)}` : '',
      instInput.legalityInfo ? `Legalitas: ${sanitizeStr(instInput.legalityInfo, 500)}` : '',
      typeof instInput.studentCount === 'number' ? `Jumlah Santri: ${instInput.studentCount}` : '',
      typeof instInput.teacherCount === 'number' ? `Jumlah Pengajar: ${instInput.teacherCount}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const generateWithResilientRetry = async (params: {
      contents: string;
      config: Record<string, unknown>;
    }) => {
      const attempts: Array<{ model: string; delayMs: number }> = [
        { model: 'gemini-4-hydrogen', delayMs: 0 },
        { model: 'gemini-4-hydrogen', delayMs: 800 },
        { model: 'gemini-3.1-flash-lite', delayMs: 1200 },
      ];
      let lastError: unknown;
      for (const attempt of attempts) {
        if (attempt.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, attempt.delayMs));
        }
        try {
          return await ai.models.generateContent({
            model: attempt.model,
            contents: params.contents,
            config: params.config as never,
          });
        } catch (err) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient =
            msg.includes('503') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('high demand') ||
            msg.includes('429');
          if (!isTransient) {
            throw err;
          }
        }
      }
      throw lastError;
    };

    try {
      if (target === 'institution_section') {
        const section = ['history', 'vision', 'mission', 'organizationStructure', 'all'].includes(
          body.section
        )
          ? (body.section as 'history' | 'vision' | 'mission' | 'organizationStructure' | 'all')
          : 'all';

        const prompt = `Tugas: Susun narasi profil resmi lembaga pendidikan Al-Quran / Rumah Quran dalam bahasa Indonesia baku, resmi, sopan, dan layak dicetak dalam dokumen proposal resmi.

Data Factual Lembaga yang Tersedia:
${institutionContextText || 'Belum ada rincian identitas yang diisi; gunakan redaksi umum lembaga Rumah Quran tanpa mengarang nama/nomor legalitas palsu.'}

Catatan / Arahan Tambahan Pengguna:
${userNotes || 'Tidak ada catatan khusus; susun narasi yang rapi, terpercaya, dan menyentuh nilai pendidikan Al-Quran.'}

${
  instInput.history && section !== 'history'
    ? `Konteks Sejarah Saat Ini: ${sanitizeStr(instInput.history, 1000)}`
    : ''
}

Bagian yang harus dibuat: ${
          section === 'all'
            ? 'Keempat bagian lengkap: Sejarah Lembaga (history), Visi Lembaga (vision), Misi Lembaga (mission - format poin bernomor 1, 2, 3...), dan Struktur Organisasi (organizationStructure - susunan jabatan yang jelas, gunakan nama pimpinan bila tersedia dan penanda [Isi Nama] jika nama pengurus lain belum disebutkan).'
            : section === 'history'
            ? 'Hanya bagian Sejarah Lembaga (history) sebanyak 2-3 paragraf formal.'
            : section === 'vision'
            ? 'Hanya bagian Visi Lembaga (vision) berupa pernyataan visi yang kuat dan ringkas (1-2 kalimat) beserta uraian singkat.'
            : section === 'mission'
            ? 'Hanya bagian Misi Lembaga (mission) berupa 4-6 poin bernomor yang konkret dan terukur.'
            : 'Hanya bagian Struktur Organisasi (organizationStructure) yang tersusun rapi per jabatan (Pelindung/Pembina, Pimpinan Lembaga, Sekretaris, Bendahara, Koordinator Pendidikan/Tahfidz, Bidang Sarana & Prasarana).'
        }

ATURAN KETAT:
1. Jangan pernah mengarang nomor akta notaris, SK Kemenkumham, nomor statistik, nominal donasi palsu, atau tahun berdiri jika tidak tercantum pada Data Factual.
2. Gunakan teks polos yang rapi tanpa tanda markdown bintang (** atau ##).`;

        const properties: Record<string, { type: Type; description: string }> = {};
        const required: string[] = [];
        if (section === 'all' || section === 'history') {
          properties.history = { type: Type.STRING, description: 'Narasi sejarah lembaga dalam bahasa Indonesia formal.' };
          required.push('history');
        }
        if (section === 'all' || section === 'vision') {
          properties.vision = { type: Type.STRING, description: 'Pernyataan visi lembaga dalam bahasa Indonesia formal.' };
          required.push('vision');
        }
        if (section === 'all' || section === 'mission') {
          properties.mission = { type: Type.STRING, description: 'Poin-poin misi lembaga bernomor 1, 2, 3 dst.' };
          required.push('mission');
        }
        if (section === 'all' || section === 'organizationStructure') {
          properties.organizationStructure = {
            type: Type.STRING,
            description: 'Susunan struktur organisasi lembaga yang rapi tanpa markdown.',
          };
          required.push('organizationStructure');
        }

        const response = await generateWithResilientRetry({
          contents: prompt,
          config: {
            systemInstruction:
              'Anda adalah sekretaris dan penyusun naskah proposal resmi lembaga pendidikan Islam di Indonesia. Selalu gunakan bahasa Indonesia formal EYD, jujur, tidak mengarang nomor legalitas palsu, dan tidak memakai simbol markdown.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties,
              required,
            },
          },
        });

        const rawText = (response.text || '').trim();
        if (!rawText) {
          res.status(502).json({ error: 'Model AI tidak mengembalikan teks narasi.' });
          return;
        }
        const parsedJson = parseModelJson<Record<string, string>>(rawText);

        appendAudit(store, {
          action: 'AI_NARRATIVE_INSTITUTION',
          entityType: 'institutions',
          entityId: 'ar-raudhah',
          actorUid: actor.uid,
          actorName: actor.displayName,
          details: `Membuat narasi Profil Lembaga (${section}) menggunakan Gemini AI.`,
        });
        writeStore(store);

        res.json(parsedJson);
        return;
      }

      // target === 'proposal_section'
      const pCtx = body.proposalContext || {};
      const generateAll = Boolean(body.generateAllSections);
      const existingSections: Array<{ key: string; title: string; content: string }> = Array.isArray(
        pCtx.existingSections
      )
        ? pCtx.existingSections
        : [];

      const proposalFacts = [
        pCtx.title ? `Judul Proposal: ${sanitizeStr(pCtx.title, 300)}` : '',
        pCtx.categoryName ? `Kategori: ${sanitizeStr(pCtx.categoryName, 120)}` : '',
        pCtx.proposalType ? `Jenis Template: ${sanitizeStr(pCtx.proposalType, 120)}` : '',
        pCtx.recipientInstitution ? `Instansi/Donatur Tujuan: ${sanitizeStr(pCtx.recipientInstitution, 200)}` : '',
        pCtx.recipientName ? `Penerima Surat: ${sanitizeStr(pCtx.recipientName, 150)}` : '',
        pCtx.location ? `Lokasi Kegiatan/Pembangunan: ${sanitizeStr(pCtx.location, 250)}` : '',
        pCtx.executionTime ? `Waktu Pelaksanaan: ${sanitizeStr(pCtx.executionTime, 150)}` : '',
        pCtx.fiscalYear ? `Tahun Anggaran: ${Number(pCtx.fiscalYear)}` : '',
        typeof pCtx.totalBudget === 'number' && pCtx.totalBudget > 0
          ? `Total Kebutuhan Anggaran (RAB): Rp ${Number(pCtx.totalBudget).toLocaleString('id-ID')}`
          : '',
        pCtx.summary ? `Ringkasan Proposal: ${sanitizeStr(pCtx.summary, 1000)}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      if (generateAll && existingSections.length > 0) {
        const listDesc = existingSections
          .map((s) => `- key="${sanitizeStr(s.key, 60)}" | Judul="${sanitizeStr(s.title, 150)}"`)
          .join('\n');

        const prompt = `Susun draf isi bab proposal resmi berbahasa Indonesia baku berdasarkan data lembaga dan detail proposal berikut.

Data Lembaga:
${institutionContextText || 'Data lembaga masih minimal; gunakan penyebutan umum lembaga tanpa mengarang legalitas palsu.'}

Detail Proposal:
${proposalFacts || 'Judul/detail proposal belum lengkap; buat draf terstruktur yang relevan.'}

Catatan Tambahan Pengguna:
${userNotes || 'Tidak ada catatan tambahan.'}

Daftar Bab yang Harus Disusun:
${listDesc}

ATURAN KETAT:
1. Untuk bab profil lembaga (bila ada), manfaatkan data faktual sejarah/visi/misi/jumlah santri yang tersedia.
2. Untuk bab anggaran (bila ada), sebutkan total anggaran hanya jika nilainya > 0; jika belum ada RAB, rujuk ke "lampiran Rencana Anggaran Biaya (RAB) terlampir".
3. Jangan mengarang nomor surat, nomor rekening, atau nomor SK legalitas yang tidak diberikan.
4. Gunakan teks paragraf/poin rapi tanpa markdown ** atau ##.`;

        const response = await generateWithResilientRetry({
          contents: prompt,
          config: {
            systemInstruction:
              'Anda adalah penulis proposal resmi berbahasa Indonesia EYD untuk lembaga pendidikan Al-Quran. Kembalikan JSON berisi array sections sesuai key yang diminta.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                sections: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      key: { type: Type.STRING },
                      content: { type: Type.STRING },
                    },
                    required: ['key', 'content'],
                  },
                },
              },
              required: ['sections'],
            },
          },
        });

        const rawText = (response.text || '').trim();
        if (!rawText) {
          res.status(502).json({ error: 'Model AI tidak mengembalikan draf bab proposal.' });
          return;
        }
        const parsed = parseModelJson<{
          sections?: Array<{ key: string; content: string }>;
        }>(rawText);
        const mapObj: Record<string, string> = {};
        for (const item of parsed.sections || []) {
          if (item.key && typeof item.content === 'string') {
            mapObj[item.key] = item.content.trim();
          }
        }

        appendAudit(store, {
          action: 'AI_NARRATIVE_PROPOSAL_ALL',
          entityType: 'proposals',
          entityId: sanitizeStr(pCtx.title || 'draft', 120),
          actorUid: actor.uid,
          actorName: actor.displayName,
          details: `Membuat narasi seluruh bab proposal (${Object.keys(mapObj).length} bab) menggunakan Gemini AI.`,
        });
        writeStore(store);

        res.json({ sections: mapObj });
        return;
      }

      const sectionTitle = sanitizeStr(body.sectionTitle || 'Bab Proposal', 180);
      const sectionKey = sanitizeStr(body.sectionKey || 'umum', 80);

      const prompt = `Susun narasi resmi berbahasa Indonesia EYD untuk bagian proposal berikut:
Bagian: ${sectionTitle} (kode: ${sectionKey})

Data Lembaga:
${institutionContextText || 'Data lembaga minimal; hindari mengarang identitas atau legalitas palsu.'}

Detail Proposal:
${proposalFacts || 'Belum ada detail khusus.'}

Catatan / Arahan Tambahan Pengguna:
${userNotes || 'Susun 2 hingga 4 paragraf yang meyakinkan, terstruktur, sopan, dan mudah dipahami donatur/instansi penerima.'}

ATURAN: Jangan memakai format markdown (** atau ##), dan jangan mengarang nomor akta/surat/rekening yang tidak diberikan.`;

      const response = await generateWithResilientRetry({
        contents: prompt,
        config: {
          systemInstruction:
            'Anda adalah penyusun naskah proposal resmi berbahasa Indonesia EYD untuk lembaga pendidikan Islam. Tulis langsung isi bab dalam bahasa Indonesia formal tanpa judul ulang dan tanpa simbol markdown.',
        },
      });

      const text = (response.text || '').trim();
      if (!text) {
        res.status(502).json({ error: 'Model AI tidak menghasilkan teks narasi.' });
        return;
      }

      appendAudit(store, {
        action: 'AI_NARRATIVE_PROPOSAL_SECTION',
        entityType: 'proposals',
        entityId: sectionKey,
        actorUid: actor.uid,
        actorName: actor.displayName,
        details: `Membuat narasi bab "${sectionTitle}" menggunakan Gemini AI.`,
      });
      writeStore(store);

      res.json({ text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi layanan Gemini AI.';
      res.status(502).json({ error: `Gagal membuat narasi AI: ${msg}` });
    }
  });

  // 8b. Proposal Categories CRUD
  app.get('/api/categories', requireAuth, (_req, res) => {
    const store = readStore();
    res.json({ categories: store.proposalCategories });
  });

  app.post('/api/categories', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan mengubah kategori proposal.' });
      return;
    }
    const name = sanitizeStr(req.body?.name, 120);
    if (!name) {
      res.status(400).json({ error: 'Nama kategori wajib diisi.' });
      return;
    }
    const code = sanitizeStr(req.body?.code, 12).toUpperCase();
    const description = sanitizeStr(req.body?.description, 500);
    const store = readStore();
    const reqId = sanitizeStr(req.body?.id, 80);
    if (reqId) {
      const existingById = store.proposalCategories.find((c) => c.id === reqId);
      if (existingById) {
        res.status(200).json({ category: existingById });
        return;
      }
    }
    const existingByName = store.proposalCategories.find(
      (c) => String(c.name || '').trim().toLowerCase() === name.toLowerCase()
    );
    if (existingByName) {
      if (reqId) {
        res.status(200).json({ category: existingByName });
        return;
      }
      res.status(409).json({ error: 'Nama kategori tersebut sudah ada.' });
      return;
    }

    const now = new Date().toISOString();
    const category = {
      id: reqId || `cat_${crypto.randomUUID()}`,
      institutionId: 'ar-raudhah',
      name,
      code: code || name.slice(0, 3).toUpperCase(),
      description,
      isActive: req.body?.isActive !== false,
      createdAt: now,
      updatedAt: now,
    };
    store.proposalCategories.push(category);
    appendAudit(store, {
      action: 'CATEGORY_CREATE',
      entityType: 'proposalCategories',
      entityId: category.id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menambahkan kategori proposal: ${name}.`,
    });
    writeStore(store);
    res.status(201).json({ category });
  });

  app.put('/api/categories/:id', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan mengubah kategori proposal.' });
      return;
    }
    const id = sanitizeStr(req.params.id, 80);
    const name = sanitizeStr(req.body?.name, 120);
    if (!name) {
      res.status(400).json({ error: 'Nama kategori wajib diisi.' });
      return;
    }
    const store = readStore();
    const idx = store.proposalCategories.findIndex((c) => c.id === id);
    const now = new Date().toISOString();

    if (idx === -1) {
      const created = {
        id: id || `cat_${crypto.randomUUID()}`,
        institutionId: 'ar-raudhah',
        name,
        code: sanitizeStr(req.body?.code, 12).toUpperCase() || name.slice(0, 3).toUpperCase(),
        description: sanitizeStr(req.body?.description, 500),
        isActive: req.body?.isActive !== false,
        createdAt: sanitizeStr(req.body?.createdAt, 40) || now,
        updatedAt: now,
      };
      store.proposalCategories.push(created);
      appendAudit(store, {
        action: 'CATEGORY_UPSERT',
        entityType: 'proposalCategories',
        entityId: created.id,
        actorUid: actor.uid,
        actorName: actor.displayName,
        details: `Menyinkronkan kategori proposal: ${name}.`,
      });
      writeStore(store);
      res.json({ category: created });
      return;
    }

    const updated = {
      ...store.proposalCategories[idx],
      name,
      code: sanitizeStr(req.body?.code, 12).toUpperCase() || String(store.proposalCategories[idx].code || ''),
      description: sanitizeStr(req.body?.description, 500),
      isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : Boolean(store.proposalCategories[idx].isActive),
      updatedAt: now,
    };
    store.proposalCategories[idx] = updated;
    appendAudit(store, {
      action: 'CATEGORY_UPDATE',
      entityType: 'proposalCategories',
      entityId: id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Memperbarui kategori proposal: ${name}.`,
    });
    writeStore(store);
    res.json({ category: updated });
  });

  app.delete('/api/categories/:id', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator') {
      res.status(403).json({ error: 'Hanya Administrator yang dapat menghapus kategori.' });
      return;
    }
    const id = req.params.id;
    const store = readStore();
    const idx = store.proposalCategories.findIndex((c) => c.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Kategori tidak ditemukan.' });
      return;
    }
    const [removed] = store.proposalCategories.splice(idx, 1);
    appendAudit(store, {
      action: 'CATEGORY_DELETE',
      entityType: 'proposalCategories',
      entityId: id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menghapus kategori proposal: ${String(removed.name || id)}.`,
    });
    writeStore(store);
    res.json({ ok: true });
  });

  // 8c. Master Proposal Templates CRUD
  app.get('/api/templates', requireAuth, (_req, res) => {
    const store = readStore();
    res.json({ templates: store.proposalTemplates });
  });

  app.post('/api/templates', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan membuat template.' });
      return;
    }
    const name = sanitizeStr(req.body?.name, 160);
    if (!name) {
      res.status(400).json({ error: 'Nama template wajib diisi.' });
      return;
    }
    const rawSections = Array.isArray(req.body?.sections) ? req.body.sections : [];
    const sections = rawSections.map((sec: Record<string, unknown>, i: number) => ({
      id: sanitizeStr(sec.id, 80) || `sec_${crypto.randomUUID()}`,
      key: sanitizeStr(sec.key, 60) || `bab_${i + 1}`,
      title: sanitizeStr(sec.title, 180) || `Bab ${i + 1}`,
      description: sanitizeStr(sec.description, 500),
      defaultContent: sanitizeStr(sec.defaultContent, 8000),
      order: i + 1,
      enabled: sec.enabled !== false,
      required: Boolean(sec.required),
    }));

    const now = new Date().toISOString();
    const template = {
      id: sanitizeStr(req.body?.id, 80) || `tpl_${crypto.randomUUID()}`,
      institutionId: 'ar-raudhah',
      name,
      proposalType: sanitizeStr(req.body?.proposalType, 100) || 'Umum',
      description: sanitizeStr(req.body?.description, 600),
      sections,
      isDefault: Boolean(req.body?.isDefault),
      isActive: req.body?.isActive !== false,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.uid,
      updatedBy: actor.uid,
    };

    const store = readStore();
    const reqTplId = sanitizeStr(req.body?.id, 80);
    if (reqTplId) {
      const existingTpl = store.proposalTemplates.find((t) => t.id === reqTplId);
      if (existingTpl) {
        res.status(200).json({ template: existingTpl });
        return;
      }
    }
    store.proposalTemplates.push(template);
    appendAudit(store, {
      action: 'TEMPLATE_CREATE',
      entityType: 'proposalTemplates',
      entityId: template.id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Membuat template proposal: ${name}.`,
    });
    writeStore(store);
    res.status(201).json({ template });
  });

  app.put('/api/templates/:id', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan mengubah template.' });
      return;
    }
    const id = sanitizeStr(req.params.id, 80);
    const name = sanitizeStr(req.body?.name, 160);
    if (!name) {
      res.status(400).json({ error: 'Nama template wajib diisi.' });
      return;
    }
    const store = readStore();
    const idx = store.proposalTemplates.findIndex((t) => t.id === id);
    const existingTpl = idx !== -1 ? store.proposalTemplates[idx] : null;
    const rawSections = Array.isArray(req.body?.sections)
      ? req.body.sections
      : existingTpl && Array.isArray(existingTpl.sections)
      ? (existingTpl.sections as Array<Record<string, unknown>>)
      : [];
    const sections = rawSections.map((sec: Record<string, unknown>, i: number) => ({
      id: sanitizeStr(sec.id, 80) || `sec_${crypto.randomUUID()}`,
      key: sanitizeStr(sec.key, 60) || `bab_${i + 1}`,
      title: sanitizeStr(sec.title, 180) || `Bab ${i + 1}`,
      description: sanitizeStr(sec.description, 500),
      defaultContent: sanitizeStr(sec.defaultContent, 8000),
      order: i + 1,
      enabled: sec.enabled !== false,
      required: Boolean(sec.required),
    }));

    const now = new Date().toISOString();
    if (!existingTpl) {
      const created = {
        id: id || `tpl_${crypto.randomUUID()}`,
        institutionId: 'ar-raudhah',
        name,
        proposalType: sanitizeStr(req.body?.proposalType, 100) || 'Umum',
        description: sanitizeStr(req.body?.description, 600),
        sections,
        isDefault: Boolean(req.body?.isDefault),
        isActive: req.body?.isActive !== false,
        createdAt: sanitizeStr(req.body?.createdAt, 40) || now,
        updatedAt: now,
        createdBy: actor.uid,
        updatedBy: actor.uid,
      };
      store.proposalTemplates.push(created);
      appendAudit(store, {
        action: 'TEMPLATE_UPSERT',
        entityType: 'proposalTemplates',
        entityId: created.id,
        actorUid: actor.uid,
        actorName: actor.displayName,
        details: `Menyinkronkan template proposal: ${name}.`,
      });
      writeStore(store);
      res.json({ template: created });
      return;
    }

    const updated = {
      ...existingTpl,
      name,
      proposalType: sanitizeStr(req.body?.proposalType, 100) || String(existingTpl.proposalType || 'Umum'),
      description: sanitizeStr(req.body?.description, 600),
      sections,
      isActive: typeof req.body?.isActive === 'boolean' ? req.body.isActive : Boolean(existingTpl.isActive),
      updatedAt: now,
      updatedBy: actor.uid,
    };
    store.proposalTemplates[idx] = updated;
    appendAudit(store, {
      action: 'TEMPLATE_UPDATE',
      entityType: 'proposalTemplates',
      entityId: id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Memperbarui template proposal: ${name}.`,
    });
    writeStore(store);
    res.json({ template: updated });
  });

  app.post('/api/templates/:id/duplicate', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan menduplikasi template.' });
      return;
    }
    const id = req.params.id;
    const store = readStore();
    const src = store.proposalTemplates.find((t) => t.id === id);
    if (!src) {
      res.status(404).json({ error: 'Template sumber tidak ditemukan.' });
      return;
    }
    const now = new Date().toISOString();
    const copy = {
      ...src,
      id: `tpl_${crypto.randomUUID()}`,
      name: `${String(src.name)} (Salinan)`,
      isDefault: false,
      sections: Array.isArray(src.sections)
        ? src.sections.map((s) => ({ ...(s as Record<string, unknown>) }))
        : [],
      createdAt: now,
      updatedAt: now,
      createdBy: actor.uid,
      updatedBy: actor.uid,
    };
    store.proposalTemplates.push(copy);
    appendAudit(store, {
      action: 'TEMPLATE_DUPLICATE',
      entityType: 'proposalTemplates',
      entityId: copy.id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menduplikasi template ${String(src.name)} menjadi ${copy.name}.`,
    });
    writeStore(store);
    res.status(201).json({ template: copy });
  });

  app.delete('/api/templates/:id', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator') {
      res.status(403).json({ error: 'Hanya Administrator yang dapat menghapus template.' });
      return;
    }
    const id = req.params.id;
    const store = readStore();
    const idx = store.proposalTemplates.findIndex((t) => t.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Template tidak ditemukan.' });
      return;
    }
    const [removed] = store.proposalTemplates.splice(idx, 1);
    appendAudit(store, {
      action: 'TEMPLATE_DELETE',
      entityType: 'proposalTemplates',
      entityId: id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menghapus template proposal: ${String(removed.name || id)}.`,
    });
    writeStore(store);
    res.json({ ok: true });
  });

  // 8d. Proposals CRUD & Workflow
  const VALID_PROPOSAL_STATUSES = [
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

  app.get('/api/proposals', requireAuth, (_req, res) => {
    const store = readStore();
    res.json({ proposals: store.proposals });
  });

  app.post('/api/proposals', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan membuat proposal baru.' });
      return;
    }
    const body = req.body || {};
    const title = sanitizeStr(body.title, 300);
    if (!title) {
      res.status(400).json({ error: 'Judul proposal wajib diisi.' });
      return;
    }

    const store = readStore();
    const now = new Date().toISOString();
    const proposalId = sanitizeStr(body.id, 80) || `prop_${crypto.randomUUID()}`;
    const existingProp = store.proposals.find((p) => p.id === proposalId);
    if (existingProp) {
      res.status(200).json({ proposal: existingProp });
      return;
    }
    const rawSections = Array.isArray(body.sections) ? body.sections : [];
    const sections = rawSections.map((sec: Record<string, unknown>, i: number) => ({
      id: sanitizeStr(sec.id, 80) || `sec_${i + 1}`,
      key: sanitizeStr(sec.key, 60) || `bab_${i + 1}`,
      title: sanitizeStr(sec.title, 180) || `Bab ${i + 1}`,
      description: sanitizeStr(sec.description, 500),
      content: typeof sec.content === 'string' ? sec.content.trim().slice(0, 20000) : '',
      enabled: sec.enabled !== false,
      order: i + 1,
    }));

    const status = VALID_PROPOSAL_STATUSES.includes(body.status) ? body.status : 'Draft';
    const linkedBudget = store.proposalBudgets.find((b) => b.proposalId === proposalId);
    const totalBudget = linkedBudget
      ? Number(linkedBudget.totalAmount) || 0
      : sanitizeNum(body.totalBudget, 0, 100_000_000_000);

    const proposal = {
      id: proposalId,
      institutionId: 'ar-raudhah',
      proposalNumber: sanitizeStr(body.proposalNumber, 120),
      proposalDate: sanitizeStr(body.proposalDate, 30) || now.slice(0, 10),
      fiscalYear: sanitizeNum(body.fiscalYear, 2000, 2100) || store.appSettings.defaultFiscalYear,
      title,
      categoryId: sanitizeStr(body.categoryId, 80),
      categoryName: sanitizeStr(body.categoryName, 120),
      templateId: sanitizeStr(body.templateId, 80),
      proposalType: sanitizeStr(body.proposalType, 120),
      recipientName: sanitizeStr(body.recipientName, 150),
      recipientInstitution: sanitizeStr(body.recipientInstitution, 200),
      recipientAddress: sanitizeStr(body.recipientAddress, 400),
      location: sanitizeStr(body.location, 250),
      executionTime: sanitizeStr(body.executionTime, 150),
      summary: sanitizeStr(body.summary, 2000),
      sections,
      attachmentIds: Array.isArray(body.attachmentIds)
        ? body.attachmentIds.map((v: unknown) => sanitizeStr(v, 80)).filter(Boolean)
        : [],
      isArchived: Boolean(body.isArchived),
      archivedAt: body.isArchived ? now : '',
      status,
      totalBudget,
      approvedAmount: sanitizeNum(body.approvedAmount, 0, 100_000_000_000),
      receivedAmount: sanitizeNum(body.receivedAmount, 0, 100_000_000_000),
      submittedAt: sanitizeStr(body.submittedAt, 40),
      approvedAt: sanitizeStr(body.approvedAt, 40),
      rejectedReason: sanitizeStr(body.rejectedReason, 1000),
      followUpNotes: sanitizeStr(body.followUpNotes, 2000),
      createdAt: now,
      updatedAt: now,
      createdBy: actor.uid,
      updatedBy: actor.uid,
    };

    store.proposals.unshift(proposal);
    store.proposalStatusHistory.unshift({
      id: `hist_${crypto.randomUUID()}`,
      institutionId: 'ar-raudhah',
      proposalId,
      proposalTitle: title,
      toStatus: status,
      notes: 'Proposal dibuat.',
      actorUid: actor.uid,
      actorName: actor.displayName,
      createdAt: now,
    });
    appendAudit(store, {
      action: 'PROPOSAL_CREATE',
      entityType: 'proposals',
      entityId: proposalId,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Membuat proposal "${title}" (${status}).`,
    });
    writeStore(store);
    res.status(201).json({ proposal });
  });

  app.put('/api/proposals/:id', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan menyunting proposal.' });
      return;
    }
    const id = sanitizeStr(req.params.id, 80);
    const store = readStore();
    const idx = store.proposals.findIndex((p) => p.id === id);
    const existing = idx !== -1 ? store.proposals[idx] : null;
    const body = req.body || {};
    const title = sanitizeStr(body.title, 300) || (existing ? String(existing.title || '') : '');
    if (!title) {
      res.status(400).json({ error: 'Judul proposal wajib diisi.' });
      return;
    }

    const now = new Date().toISOString();
    const rawSections = Array.isArray(body.sections)
      ? body.sections
      : existing && Array.isArray(existing.sections)
      ? existing.sections
      : [];
    const sections = rawSections.map((sec: Record<string, unknown>, i: number) => ({
      id: sanitizeStr(sec.id, 80) || `sec_${i + 1}`,
      key: sanitizeStr(sec.key, 60) || `bab_${i + 1}`,
      title: sanitizeStr(sec.title, 180) || `Bab ${i + 1}`,
      description: sanitizeStr(sec.description, 500),
      content: typeof sec.content === 'string' ? sec.content.trim().slice(0, 20000) : '',
      enabled: sec.enabled !== false,
      order: i + 1,
    }));

    const linkedBudget = store.proposalBudgets.find((b) => b.proposalId === id);
    const totalBudget = linkedBudget
      ? Number(linkedBudget.totalAmount) || 0
      : typeof body.totalBudget === 'number'
      ? sanitizeNum(body.totalBudget, 0, 100_000_000_000)
      : existing
      ? Number(existing.totalBudget) || 0
      : 0;

    if (!existing) {
      const status = VALID_PROPOSAL_STATUSES.includes(body.status) ? body.status : 'Draft';
      const created = {
        id: id || `prop_${crypto.randomUUID()}`,
        institutionId: 'ar-raudhah',
        proposalNumber: sanitizeStr(body.proposalNumber, 120),
        proposalDate: sanitizeStr(body.proposalDate, 30) || now.slice(0, 10),
        fiscalYear: sanitizeNum(body.fiscalYear, 2000, 2100) || store.appSettings.defaultFiscalYear,
        title,
        categoryId: sanitizeStr(body.categoryId, 80),
        categoryName: sanitizeStr(body.categoryName, 120),
        templateId: sanitizeStr(body.templateId, 80),
        proposalType: sanitizeStr(body.proposalType, 120),
        recipientName: sanitizeStr(body.recipientName, 150),
        recipientInstitution: sanitizeStr(body.recipientInstitution, 200),
        recipientAddress: sanitizeStr(body.recipientAddress, 400),
        location: sanitizeStr(body.location, 250),
        executionTime: sanitizeStr(body.executionTime, 150),
        summary: sanitizeStr(body.summary, 2000),
        sections,
        attachmentIds: Array.isArray(body.attachmentIds)
          ? body.attachmentIds.map((v: unknown) => sanitizeStr(v, 80)).filter(Boolean)
          : [],
        isArchived: Boolean(body.isArchived),
        archivedAt: body.isArchived ? sanitizeStr(body.archivedAt, 40) || now : '',
        status,
        totalBudget,
        approvedAmount: sanitizeNum(body.approvedAmount, 0, 100_000_000_000),
        receivedAmount: sanitizeNum(body.receivedAmount, 0, 100_000_000_000),
        submittedAt: sanitizeStr(body.submittedAt, 40),
        approvedAt: sanitizeStr(body.approvedAt, 40),
        rejectedReason: sanitizeStr(body.rejectedReason, 1000),
        followUpNotes: sanitizeStr(body.followUpNotes, 2000),
        createdAt: sanitizeStr(body.createdAt, 40) || now,
        updatedAt: now,
        createdBy: actor.uid,
        updatedBy: actor.uid,
      };
      store.proposals.unshift(created);
      store.proposalStatusHistory.unshift({
        id: `hist_${crypto.randomUUID()}`,
        institutionId: 'ar-raudhah',
        proposalId: created.id,
        proposalTitle: title,
        toStatus: status,
        notes: 'Proposal disinkronkan dari penyimpanan lokal.',
        actorUid: actor.uid,
        actorName: actor.displayName,
        createdAt: now,
      });
      appendAudit(store, {
        action: 'PROPOSAL_UPSERT',
        entityType: 'proposals',
        entityId: created.id,
        actorUid: actor.uid,
        actorName: actor.displayName,
        details: `Menyinkronkan proposal "${title}".`,
      });
      writeStore(store);
      res.json({ proposal: created });
      return;
    }

    const nextArchived =
      typeof body.isArchived === 'boolean' ? body.isArchived : Boolean(existing.isArchived);

    const updated = {
      ...existing,
      proposalNumber: body.proposalNumber !== undefined ? sanitizeStr(body.proposalNumber, 120) : existing.proposalNumber,
      proposalDate: body.proposalDate !== undefined ? sanitizeStr(body.proposalDate, 30) : existing.proposalDate,
      fiscalYear: body.fiscalYear !== undefined ? sanitizeNum(body.fiscalYear, 2000, 2100) : existing.fiscalYear,
      title,
      categoryId: body.categoryId !== undefined ? sanitizeStr(body.categoryId, 80) : existing.categoryId,
      categoryName: body.categoryName !== undefined ? sanitizeStr(body.categoryName, 120) : existing.categoryName,
      templateId: body.templateId !== undefined ? sanitizeStr(body.templateId, 80) : existing.templateId,
      proposalType: body.proposalType !== undefined ? sanitizeStr(body.proposalType, 120) : existing.proposalType,
      recipientName: body.recipientName !== undefined ? sanitizeStr(body.recipientName, 150) : existing.recipientName,
      recipientInstitution:
        body.recipientInstitution !== undefined
          ? sanitizeStr(body.recipientInstitution, 200)
          : existing.recipientInstitution,
      recipientAddress:
        body.recipientAddress !== undefined
          ? sanitizeStr(body.recipientAddress, 400)
          : existing.recipientAddress,
      location: body.location !== undefined ? sanitizeStr(body.location, 250) : existing.location,
      executionTime:
        body.executionTime !== undefined ? sanitizeStr(body.executionTime, 150) : existing.executionTime,
      summary: body.summary !== undefined ? sanitizeStr(body.summary, 2000) : existing.summary,
      sections,
      attachmentIds: Array.isArray(body.attachmentIds)
        ? body.attachmentIds.map((v: unknown) => sanitizeStr(v, 80)).filter(Boolean)
        : existing.attachmentIds || [],
      isArchived: nextArchived,
      archivedAt: nextArchived ? existing.archivedAt || now : '',
      totalBudget,
      followUpNotes:
        body.followUpNotes !== undefined ? sanitizeStr(body.followUpNotes, 2000) : existing.followUpNotes,
      updatedAt: now,
      updatedBy: actor.uid,
    };

    store.proposals[idx] = updated;
    appendAudit(store, {
      action: 'PROPOSAL_UPDATE',
      entityType: 'proposals',
      entityId: id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Memperbarui proposal "${title}".`,
    });
    writeStore(store);
    res.json({ proposal: updated });
  });

  app.post('/api/proposals/:id/duplicate', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan menduplikasi proposal.' });
      return;
    }
    const id = req.params.id;
    const store = readStore();
    const src = store.proposals.find((p) => p.id === id);
    if (!src) {
      res.status(404).json({ error: 'Proposal sumber tidak ditemukan.' });
      return;
    }
    const now = new Date().toISOString();
    const newId = `prop_${crypto.randomUUID()}`;
    const copy = {
      ...src,
      id: newId,
      proposalNumber: '',
      proposalDate: now.slice(0, 10),
      title: `${String(src.title)} (Salinan)`,
      status: 'Draft',
      approvedAmount: 0,
      receivedAmount: 0,
      submittedAt: '',
      approvedAt: '',
      rejectedReason: '',
      isArchived: false,
      archivedAt: '',
      sections: Array.isArray(src.sections)
        ? src.sections.map((s) => ({ ...(s as Record<string, unknown>) }))
        : [],
      createdAt: now,
      updatedAt: now,
      createdBy: actor.uid,
      updatedBy: actor.uid,
    };
    store.proposals.unshift(copy);

    // Also duplicate linked RAB budget if present
    const srcBudget = store.proposalBudgets.find((b) => b.proposalId === id);
    if (srcBudget) {
      const budgetCopy = {
        ...srcBudget,
        id: `rab_${crypto.randomUUID()}`,
        proposalId: newId,
        proposalTitle: copy.title,
        items: Array.isArray(srcBudget.items)
          ? srcBudget.items.map((it) => ({ ...(it as Record<string, unknown>), id: `item_${crypto.randomUUID()}` }))
          : [],
        createdAt: now,
        updatedAt: now,
        createdBy: actor.uid,
        updatedBy: actor.uid,
      };
      store.proposalBudgets.push(budgetCopy);
    }

    store.proposalStatusHistory.unshift({
      id: `hist_${crypto.randomUUID()}`,
      institutionId: 'ar-raudhah',
      proposalId: newId,
      proposalTitle: copy.title,
      toStatus: 'Draft',
      notes: `Diduplikasi dari proposal "${String(src.title)}".`,
      actorUid: actor.uid,
      actorName: actor.displayName,
      createdAt: now,
    });
    appendAudit(store, {
      action: 'PROPOSAL_DUPLICATE',
      entityType: 'proposals',
      entityId: newId,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menduplikasi proposal "${String(src.title)}".`,
    });
    writeStore(store);
    res.status(201).json({ proposal: copy });
  });

  app.patch('/api/proposals/:id/status', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    const id = req.params.id;
    const toStatus = req.body?.status;
    if (!VALID_PROPOSAL_STATUSES.includes(toStatus)) {
      res.status(400).json({ error: 'Status proposal tidak valid.' });
      return;
    }

    const leaderOnlyStatuses = ['Disetujui', 'Ditolak', 'Bantuan diterima', 'Selesai'];
    if (
      leaderOnlyStatuses.includes(toStatus) &&
      actor.role !== 'Administrator' &&
      actor.role !== 'Pimpinan'
    ) {
      res.status(403).json({
        error: `Status "${toStatus}" hanya dapat ditetapkan oleh Pimpinan atau Administrator.`,
      });
      return;
    }

    const store = readStore();
    const idx = store.proposals.findIndex((p) => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Proposal tidak ditemukan.' });
      return;
    }

    const existing = store.proposals[idx];
    const fromStatus = String(existing.status || 'Draft');
    const now = new Date().toISOString();

    const approvedAmount =
      req.body?.approvedAmount !== undefined
        ? sanitizeNum(req.body.approvedAmount, 0, 100_000_000_000)
        : Number(existing.approvedAmount) || 0;
    const receivedAmount =
      req.body?.receivedAmount !== undefined
        ? sanitizeNum(req.body.receivedAmount, 0, 100_000_000_000)
        : Number(existing.receivedAmount) || 0;
    const notes = sanitizeStr(req.body?.notes, 2000);

    const updated = {
      ...existing,
      status: toStatus,
      approvedAmount,
      receivedAmount,
      submittedAt:
        toStatus === 'Sudah diajukan' ? existing.submittedAt || now : existing.submittedAt,
      approvedAt: toStatus === 'Disetujui' ? now : existing.approvedAt,
      rejectedReason: toStatus === 'Ditolak' ? notes || existing.rejectedReason : existing.rejectedReason,
      followUpNotes: notes || existing.followUpNotes,
      updatedAt: now,
      updatedBy: actor.uid,
    };
    store.proposals[idx] = updated;

    const historyEntry = {
      id: `hist_${crypto.randomUUID()}`,
      institutionId: 'ar-raudhah',
      proposalId: id,
      proposalTitle: String(existing.title || ''),
      fromStatus,
      toStatus,
      approvedAmount,
      receivedAmount,
      notes,
      actorUid: actor.uid,
      actorName: actor.displayName,
      createdAt: now,
    };
    store.proposalStatusHistory.unshift(historyEntry);

    appendAudit(store, {
      action: 'PROPOSAL_STATUS_CHANGE',
      entityType: 'proposals',
      entityId: id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Mengubah status "${String(existing.title)}" dari ${fromStatus} menjadi ${toStatus}.`,
    });
    writeStore(store);
    res.json({ proposal: updated, historyEntry });
  });

  app.delete('/api/proposals/:id', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    const id = req.params.id;
    const store = readStore();
    const idx = store.proposals.findIndex((p) => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Proposal tidak ditemukan.' });
      return;
    }
    const target = store.proposals[idx];
    if (actor.role !== 'Administrator' && target.createdBy !== actor.uid) {
      res.status(403).json({
        error: 'Hanya Administrator atau pembuat proposal yang dapat menghapus proposal ini.',
      });
      return;
    }
    const [removed] = store.proposals.splice(idx, 1);
    store.proposalBudgets = store.proposalBudgets.filter((b) => b.proposalId !== id);
    store.proposalStatusHistory = store.proposalStatusHistory.filter((h) => h.proposalId !== id);

    appendAudit(store, {
      action: 'PROPOSAL_DELETE',
      entityType: 'proposals',
      entityId: id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menghapus proposal "${String(removed.title || id)}".`,
    });
    writeStore(store);
    res.json({ ok: true });
  });

  // 8e. RAB / Proposal Budgets CRUD (Server-authoritative math & proposal.totalBudget sync)
  app.get('/api/budgets', requireAuth, (_req, res) => {
    const store = readStore();
    res.json({ budgets: store.proposalBudgets });
  });

  function normalizeRabItems(rawItems: unknown): { items: Array<Record<string, unknown>>; totalAmount: number } {
    const arr = Array.isArray(rawItems) ? rawItems : [];
    let totalAmount = 0;
    const items = arr.map((item: Record<string, unknown>, idx: number) => {
      const volumeNum = Number(item.volume);
      const unitPriceNum = Number(item.unitPrice);
      const volume = Number.isFinite(volumeNum) && volumeNum >= 0 ? Math.min(1_000_000, volumeNum) : 0;
      const unitPrice =
        Number.isFinite(unitPriceNum) && unitPriceNum >= 0
          ? Math.min(100_000_000_000, unitPriceNum)
          : 0;
      const totalPrice = Math.round(volume * unitPrice);
      totalAmount += totalPrice;
      return {
        id: sanitizeStr(item.id, 80) || `item_${crypto.randomUUID()}`,
        groupName: sanitizeStr(item.groupName, 140) || 'Pekerjaan Umum',
        order: idx + 1,
        description: sanitizeStr(item.description, 300),
        volume,
        unit: sanitizeStr(item.unit, 40) || 'Unit',
        unitPrice,
        totalPrice,
      };
    });
    return { items, totalAmount };
  }

  app.post('/api/budgets', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan menyusun RAB.' });
      return;
    }
    const body = req.body || {};
    const proposalId = sanitizeStr(body.proposalId, 80);
    if (!proposalId) {
      res.status(400).json({ error: 'RAB harus dihubungkan ke salah satu proposal.' });
      return;
    }

    const store = readStore();
    const { items, totalAmount } = normalizeRabItems(body.items);
    const linkedProposalIdx = store.proposals.findIndex((p) => p.id === proposalId);
    const proposalTitle =
      linkedProposalIdx !== -1
        ? String(store.proposals[linkedProposalIdx].title || '')
        : sanitizeStr(body.proposalTitle, 300);

    const now = new Date().toISOString();
    const existingIdx = store.proposalBudgets.findIndex((b) => b.proposalId === proposalId);

    const budgetRecord = {
      id:
        existingIdx !== -1
          ? String(store.proposalBudgets[existingIdx].id)
          : sanitizeStr(body.id, 80) || `rab_${crypto.randomUUID()}`,
      institutionId: 'ar-raudhah',
      proposalId,
      proposalTitle,
      title: sanitizeStr(body.title, 200) || `RAB - ${proposalTitle || 'Proposal'}`,
      notes: sanitizeStr(body.notes, 1000),
      items,
      totalAmount,
      createdAt:
        existingIdx !== -1 ? String(store.proposalBudgets[existingIdx].createdAt || now) : now,
      updatedAt: now,
      createdBy:
        existingIdx !== -1
          ? String(store.proposalBudgets[existingIdx].createdBy || actor.uid)
          : actor.uid,
      updatedBy: actor.uid,
    };

    if (existingIdx !== -1) {
      store.proposalBudgets[existingIdx] = budgetRecord;
    } else {
      store.proposalBudgets.unshift(budgetRecord);
    }

    if (linkedProposalIdx !== -1) {
      store.proposals[linkedProposalIdx] = {
        ...store.proposals[linkedProposalIdx],
        totalBudget: totalAmount,
        updatedAt: now,
        updatedBy: actor.uid,
      };
    }

    appendAudit(store, {
      action: 'BUDGET_SAVE',
      entityType: 'proposalBudgets',
      entityId: budgetRecord.id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menyimpan RAB "${budgetRecord.title}" total Rp ${totalAmount.toLocaleString('id-ID')}.`,
    });
    writeStore(store);
    res.status(existingIdx !== -1 ? 200 : 201).json({ budget: budgetRecord });
  });

  app.put('/api/budgets/:id', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan mengubah RAB.' });
      return;
    }
    const id = sanitizeStr(req.params.id, 80);
    const store = readStore();
    const body = req.body || {};
    let idx = store.proposalBudgets.findIndex((b) => b.id === id);
    if (idx === -1 && typeof body.proposalId === 'string' && body.proposalId) {
      idx = store.proposalBudgets.findIndex((b) => b.proposalId === body.proposalId);
    }
    const existing = idx !== -1 ? store.proposalBudgets[idx] : null;
    const proposalId =
      sanitizeStr(body.proposalId, 80) || (existing ? String(existing.proposalId || '') : '');
    if (!proposalId) {
      res.status(400).json({ error: 'RAB harus dihubungkan ke salah satu proposal.' });
      return;
    }

    const { items, totalAmount } = normalizeRabItems(body.items);
    const linkedProposalIdx = store.proposals.findIndex((p) => p.id === proposalId);
    const now = new Date().toISOString();
    const proposalTitle =
      linkedProposalIdx !== -1
        ? String(store.proposals[linkedProposalIdx].title || '')
        : existing
        ? String(existing.proposalTitle || '')
        : sanitizeStr(body.proposalTitle, 300);

    const updated = {
      id: existing ? String(existing.id) : id || `rab_${crypto.randomUUID()}`,
      institutionId: 'ar-raudhah',
      proposalId,
      proposalTitle,
      title:
        sanitizeStr(body.title, 200) ||
        (existing ? String(existing.title || '') : `RAB - ${proposalTitle || 'Proposal'}`),
      notes: sanitizeStr(body.notes, 1000),
      items,
      totalAmount,
      createdAt: existing ? String(existing.createdAt || now) : sanitizeStr(body.createdAt, 40) || now,
      updatedAt: now,
      createdBy: existing ? String(existing.createdBy || actor.uid) : actor.uid,
      updatedBy: actor.uid,
    };

    if (idx !== -1) {
      store.proposalBudgets[idx] = updated;
    } else {
      store.proposalBudgets.unshift(updated);
    }

    if (linkedProposalIdx !== -1) {
      store.proposals[linkedProposalIdx] = {
        ...store.proposals[linkedProposalIdx],
        totalBudget: totalAmount,
        updatedAt: now,
        updatedBy: actor.uid,
      };
    }

    appendAudit(store, {
      action: existing ? 'BUDGET_UPDATE' : 'BUDGET_UPSERT',
      entityType: 'proposalBudgets',
      entityId: updated.id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menyimpan RAB "${updated.title}" total Rp ${totalAmount.toLocaleString('id-ID')}.`,
    });
    writeStore(store);
    res.json({ budget: updated });
  });

  app.delete('/api/budgets/:id', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan menghapus RAB.' });
      return;
    }
    const id = req.params.id;
    const store = readStore();
    const idx = store.proposalBudgets.findIndex((b) => b.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Data RAB tidak ditemukan.' });
      return;
    }
    const [removed] = store.proposalBudgets.splice(idx, 1);
    const linkedIdx = store.proposals.findIndex((p) => p.id === removed.proposalId);
    if (linkedIdx !== -1) {
      store.proposals[linkedIdx] = {
        ...store.proposals[linkedIdx],
        totalBudget: 0,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.uid,
      };
    }
    appendAudit(store, {
      action: 'BUDGET_DELETE',
      entityType: 'proposalBudgets',
      entityId: id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menghapus RAB "${String(removed.title || id)}".`,
    });
    writeStore(store);
    res.json({ ok: true });
  });

  // 8f. Attachments & Documentation Upload CRUD
  app.get('/api/attachments', requireAuth, (_req, res) => {
    const store = readStore();
    res.json({ attachments: store.proposalAttachments });
  });

  app.post('/api/attachments', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan mengunggah lampiran.' });
      return;
    }
    const body = req.body || {};
    const title = sanitizeStr(body.title, 200);
    if (!title) {
      res.status(400).json({ error: 'Judul lampiran wajib diisi.' });
      return;
    }
    const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
    const rawFileUrl = typeof body.fileUrl === 'string' ? body.fileUrl : '';
    let fileUrl = rawFileUrl;
    let mimeType = sanitizeStr(body.mimeType, 100) || 'image/jpeg';
    let fileSize = sanitizeNum(body.fileSize, 0, 20_000_000);
    let isImage = Boolean(body.isImage ?? true);

    try {
      const sourceData = dataUrl || (rawFileUrl.startsWith('data:') ? rawFileUrl : '');
      if (sourceData) {
        const saved = saveBase64AssetToUploads(sourceData, 'dok');
        fileUrl = saved.url;
        mimeType = saved.mimeType;
        fileSize = saved.fileSize;
        isImage = saved.isImage;
      } else if (!rawFileUrl.startsWith('/api/uploads/')) {
        res.status(400).json({ error: 'Berkas lampiran wajib diunggah.' });
        return;
      }
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal menyimpan berkas lampiran.',
      });
      return;
    }

    const store = readStore();
    const reqAttId = sanitizeStr(body.id, 80);
    if (reqAttId) {
      const existingAtt = store.proposalAttachments.find((a) => a.id === reqAttId);
      if (existingAtt) {
        res.status(200).json({ attachment: existingAtt });
        return;
      }
    }
    const proposalId = sanitizeStr(body.proposalId, 80);
    const linkedProp = proposalId ? store.proposals.find((p) => p.id === proposalId) : undefined;
    const now = new Date().toISOString();
    const attId = reqAttId || `att_${crypto.randomUUID()}`;

    const attachment = {
      id: attId,
      institutionId: 'ar-raudhah',
      proposalId,
      proposalTitle: linkedProp ? String(linkedProp.title || '') : sanitizeStr(body.proposalTitle, 300),
      category: sanitizeStr(body.category, 80) || 'Lainnya',
      title,
      description: sanitizeStr(body.description, 500),
      fileUrl,
      fileName: sanitizeStr(body.fileName, 200) || `${attId}.${isImage ? 'jpg' : 'pdf'}`,
      mimeType,
      fileSize,
      isImage,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.uid,
    };

    store.proposalAttachments.unshift(attachment);
    if (linkedProp) {
      const existingIds = Array.isArray(linkedProp.attachmentIds)
        ? (linkedProp.attachmentIds as string[])
        : [];
      if (!existingIds.includes(attId)) {
        linkedProp.attachmentIds = [...existingIds, attId];
      }
    }

    appendAudit(store, {
      action: 'ATTACHMENT_CREATE',
      entityType: 'proposalAttachments',
      entityId: attId,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Mengunggah lampiran "${title}" (${attachment.category}).`,
    });
    writeStore(store);
    res.status(201).json({ attachment });
  });

  app.delete('/api/attachments/:id', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan menghapus lampiran.' });
      return;
    }
    const id = req.params.id;
    const store = readStore();
    const idx = store.proposalAttachments.findIndex((a) => a.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Lampiran tidak ditemukan.' });
      return;
    }
    const [removed] = store.proposalAttachments.splice(idx, 1);

    // Clean up attachmentIds reference in proposals
    for (const p of store.proposals) {
      if (Array.isArray(p.attachmentIds)) {
        p.attachmentIds = (p.attachmentIds as string[]).filter((aid) => aid !== id);
      }
    }

    // Delete file on disk if local upload and unreferenced
    const fileUrl = String(removed.fileUrl || '');
    if (fileUrl.startsWith('/api/uploads/')) {
      const filename = path.basename(fileUrl);
      const stillReferenced = store.proposalAttachments.some((a) => a.fileUrl === fileUrl);
      if (!stillReferenced && /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|pdf)$/i.test(filename)) {
        const targetPath = path.resolve(UPLOADS_DIR, filename);
        if (targetPath.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
      }
    }

    appendAudit(store, {
      action: 'ATTACHMENT_DELETE',
      entityType: 'proposalAttachments',
      entityId: id,
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: `Menghapus lampiran "${String(removed.title || id)}".`,
    });
    writeStore(store);
    res.json({ ok: true });
  });

  // 8g. System App Settings, Audit Logs, & Admin Backup Export
  app.put('/api/settings/app', requireAuth, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    if (actor.role !== 'Administrator' && actor.role !== 'Operator') {
      res.status(403).json({ error: 'Peran Anda tidak diizinkan mengubah pengaturan dokumen.' });
      return;
    }
    const store = readStore();
    const body = req.body || {};
    store.appSettings = {
      numberPrefix: sanitizeStr(body.numberPrefix, 50) || DEFAULT_APP_SETTINGS.numberPrefix,
      defaultFiscalYear: sanitizeNum(body.defaultFiscalYear, 2000, 2100) || new Date().getFullYear(),
      letterCity: sanitizeStr(body.letterCity, 120),
      paperSize: 'A4',
      includeLogoInLetterhead: body.includeLogoInLetterhead !== false,
      footerText: sanitizeStr(body.footerText, 250) || DEFAULT_APP_SETTINGS.footerText,
    };
    appendAudit(store, {
      action: 'APP_SETTINGS_UPDATE',
      entityType: 'appSettings',
      entityId: 'ar-raudhah',
      actorUid: actor.uid,
      actorName: actor.displayName,
      details: 'Memperbarui pengaturan penomoran dan tata letak dokumen A4.',
    });
    writeStore(store);
    res.json({ appSettings: store.appSettings });
  });

  app.get('/api/audit-logs', requireAuth, (req: AuthedRequest, res) => {
    const store = readStore();
    const logs = [...store.auditLogs].reverse().slice(0, 200);
    res.json({ auditLogs: logs });
  });

  app.get('/api/backup/export', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const store = readStore();
    const safeSnapshot = {
      exportedAt: new Date().toISOString(),
      institution: store.institution,
      appSettings: store.appSettings,
      proposalCategories: store.proposalCategories,
      proposalTemplates: store.proposalTemplates,
      proposals: store.proposals,
      proposalBudgets: store.proposalBudgets,
      proposalAttachments: store.proposalAttachments,
      proposalStatusHistory: store.proposalStatusHistory,
      users: store.users.map(toPublicUser),
      auditLogs: store.auditLogs,
    };
    res.json(safeSnapshot);
  });

  // 9. Explicit JSON 404 & error handlers for /api/* so API calls never receive HTML/text 404s
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
  });

  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message =
      err instanceof Error ? err.message : 'Terjadi kesalahan internal pada server.';
    res.status(500).json({ error: message });
  });

  const httpServer = http.createServer(app);

  // Mount Vite middleware in dev, or serve static dist/ in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: httpServer,
        },
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
