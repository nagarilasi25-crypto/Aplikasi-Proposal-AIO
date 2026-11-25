import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');
const ENV_ADMIN_PASSCODE = (process.env.ADMIN_PASSCODE || '').trim();
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'arraudhah-store.json');

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
  proposalCategories: Array<Record<string, unknown>>;
  proposals: Array<Record<string, unknown>>;
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

function readStore(): StoreState {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    const initial: StoreState = {
      users: [],
      institution: emptyInstitution(),
      proposalCategories: [],
      proposals: [],
      auditLogs: [],
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreState>;
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      institution: parsed.institution || emptyInstitution(),
      proposalCategories: Array.isArray(parsed.proposalCategories)
        ? parsed.proposalCategories
        : [],
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
    };
  } catch {
    return {
      users: [],
      institution: emptyInstitution(),
      proposalCategories: [],
      proposals: [],
      auditLogs: [],
    };
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

  if (!user || user.status !== 'active') {
    res.status(403).json({ error: 'Akun Anda belum aktif atau telah dinonaktifkan.' });
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
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // 1. Bootstrap status (first-run admin claim check)
  app.get('/api/auth/bootstrap-status', (_req, res) => {
    const store = readStore();
    const hasActiveAdmin = store.users.some(
      (u) => u.role === 'Administrator' && u.status === 'active'
    );
    const needsSetup = !ENV_ADMIN_PASSCODE && !hasActiveAdmin;
    res.json({
      needsSetup,
      hasEnvAdminPasscode: Boolean(ENV_ADMIN_PASSCODE),
    });
  });

  // 2. First-run admin claim (Nama + Sandi, no email required)
  app.post('/api/auth/setup', (req, res) => {
    if (ENV_ADMIN_PASSCODE) {
      res.status(409).json({
        error: 'Sandi Administrator telah dikonfigurasi melalui variabel lingkungan server.',
      });
      return;
    }

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

    const now = new Date().toISOString();
    const uid = `usr_${crypto.randomUUID()}`;
    const { salt, hash } = hashPassword(password);

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
      res.status(403).json({
        code: 'ACCOUNT_PENDING',
        error: 'Akun Anda berstatus Menunggu Aktivasi oleh Administrator.',
        user: toPublicUser(user),
      });
      return;
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

  // 4. Register new user with Nama + Sandi (always Operator + pending, NEVER auto-admin)
  app.post('/api/auth/register', (req, res) => {
    const username = sanitizeStr(req.body?.username, 80);
    const displayName = sanitizeStr(req.body?.displayName || username, 150);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

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

    const store = readStore();
    const duplicate = store.users.some(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );
    if (duplicate) {
      res.status(409).json({ error: 'Nama pengguna tersebut sudah terdaftar. Gunakan nama lain.' });
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
      phone: '',
      position: '',
      role: 'Operator',
      status: 'pending',
      passwordSalt: salt,
      passwordHash: hash,
      createdAt: now,
      updatedAt: now,
      createdBy: uid,
      updatedBy: uid,
    };

    store.users.push(newUser);
    writeStore(store);

    res.status(201).json({
      message: 'Pendaftaran berhasil. Akun berstatus Menunggu Aktivasi dari Administrator.',
      user: toPublicUser(newUser),
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

    target.updatedAt = new Date().toISOString();
    target.updatedBy = actor.uid;
    writeStore(store);

    res.json({ user: toPublicUser(target) });
  });

  // 6. Institution Profile
  app.get('/api/institution', requireAuth, (_req, res) => {
    const store = readStore();
    res.json({ institution: store.institution });
  });

  app.put('/api/institution', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const actor = req.currentUser!;
    const store = readStore();
    const now = new Date().toISOString();
    const body = req.body || {};

    const updated: StoredInstitution = {
      name: sanitizeStr(body.name, 200),
      logoUrl: sanitizeStr(body.logoUrl, 2000),
      photoUrl: sanitizeStr(body.photoUrl, 2000),
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
    const status: UserStatus = ['active', 'pending', 'inactive'].includes(req.body?.status)
      ? req.body.status
      : 'active';

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

    const nextRole: UserRole = ['Administrator', 'Pimpinan', 'Operator'].includes(req.body?.role)
      ? req.body.role
      : target.role;
    const nextStatus: UserStatus = ['active', 'pending', 'inactive'].includes(req.body?.status)
      ? req.body.status
      : target.status;

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

  // 8. Dashboard snapshot
  app.get('/api/dashboard-data', requireAuth, (_req, res) => {
    const store = readStore();
    res.json({
      institution: store.institution,
      proposals: store.proposals,
      categories: store.proposalCategories,
    });
  });

  // Mount Vite middleware in dev, or serve static dist/ in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
