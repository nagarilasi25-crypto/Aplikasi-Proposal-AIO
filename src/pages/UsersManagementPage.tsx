import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserCog,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  AppUser,
  BLUEPRINT_LIMITS,
  UserRole,
  UserStatus,
} from '../types/models';
import { formatTanggalIndonesia, sanitizeString } from '../lib/formatters';
import {
  cacheOfflineAuthCredential,
  deleteOfflineAuthUser,
  getAllOfflineUsers,
  getOfflineKV,
  hasOfflineUsername,
  setOfflineKV,
  updateOfflineAuthUserMetadata,
} from '../lib/offlineDb';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  fetchAllFirestoreUsersForAdmin,
  updateFirestoreUserForAdmin,
} from '../lib/firestoreSync';

const STATUS_LABELS: Record<UserStatus, string> = {
  active: 'Aktif',
  pending: 'Menunggu Aktivasi',
  inactive: 'Nonaktif',
};

export function UsersManagementPage() {
  const { appUser, isOfflineSession, firestoreConnected, apiRequest } = useAuth();
  const { showToast } = useToast();
  const isOnline = useOnlineStatus();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'Semua' | UserRole>('Semua');
  const [statusFilter, setStatusFilter] = useState<'Semua' | UserStatus>('Semua');

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<{
    username: string;
    displayName: string;
    password: string;
    phone: string;
    position: string;
    role: UserRole;
    status: UserStatus;
  }>({
    username: '',
    displayName: '',
    password: '',
    phone: '',
    position: '',
    role: 'Operator',
    status: 'active',
  });
  const [savingAdd, setSavingAdd] = useState(false);

  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [editForm, setEditForm] = useState<{
    username: string;
    displayName: string;
    phone: string;
    position: string;
    role: UserRole;
    status: UserStatus;
    newPassword: string;
    recoveryCode: string;
  }>({
    username: '',
    displayName: '',
    phone: '',
    position: '',
    role: 'Operator',
    status: 'pending',
    newPassword: '',
    recoveryCode: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const [deletingUser, setDeletingUser] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = appUser?.role === 'Administrator';
  const useServerApi = isOnline && !isOfflineSession;
  const canMutate = isAdmin;

  const loadLocalMergedUsers = useCallback(async (): Promise<AppUser[]> => {
    const [cached, offlineAuthUsers] = await Promise.all([
      getOfflineKV<AppUser[]>('users'),
      getAllOfflineUsers(),
    ]);
    const byUid = new Map<string, AppUser>();
    for (const u of cached || []) {
      byUid.set(u.uid, u);
    }
    for (const u of offlineAuthUsers) {
      byUid.set(u.uid, u);
    }
    return Array.from(byUid.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }, []);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const byUid = new Map<string, AppUser>();
      const localMerged = await loadLocalMergedUsers();
      for (const u of localMerged) {
        byUid.set(u.uid, u);
      }

      if (useServerApi) {
        try {
          const res = await apiRequest<{ users: AppUser[] }>('/api/users');
          for (const u of res.users || []) {
            byUid.set(u.uid, u);
          }
        } catch {
          // Keep local/Firestore users if server /api/users fails
        }
      }

      if (isOnline && firestoreConnected) {
        try {
          const firestoreUsers = await fetchAllFirestoreUsersForAdmin();
          for (const fu of firestoreUsers) {
            const existing = byUid.get(fu.uid);
            byUid.set(fu.uid, {
              ...existing,
              ...fu,
              username: existing?.username || fu.username,
            });
          }
        } catch {
          // Non-fatal if Firestore list query is unavailable
        }
      }

      const list = Array.from(byUid.values()).sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
      );
      setUsers(list);
      await setOfflineKV('users', list);
    } catch {
      const merged = await loadLocalMergedUsers();
      setUsers(merged);
    } finally {
      setLoading(false);
    }
  }, [apiRequest, firestoreConnected, isAdmin, isOnline, loadLocalMergedUsers, useServerApi]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'Semua' && u.role !== roleFilter) return false;
      if (statusFilter !== 'Semua' && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.position || '').toLowerCase().includes(q)
      );
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-red-600" />
        <h2 className="mt-4 font-display text-lg font-bold text-[#111C18]">
          Akses Dibatasi
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Halaman Manajemen Pengguna hanya dapat diakses oleh pengguna dengan peran Administrator.
        </p>
      </div>
    );
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canMutate || !appUser) return;

    const cleanUsername = addForm.username.trim();
    const cleanDisplayName = sanitizeString(
      addForm.displayName || cleanUsername,
      BLUEPRINT_LIMITS.user.displayNameMax
    );
    const cleanPhone = sanitizeString(addForm.phone, BLUEPRINT_LIMITS.user.phoneMax);
    const cleanPosition = sanitizeString(addForm.position, BLUEPRINT_LIMITS.user.positionMax);

    setSavingAdd(true);
    try {
      if (useServerApi) {
        await apiRequest('/api/users', {
          method: 'POST',
          body: {
            username: cleanUsername,
            displayName: cleanDisplayName,
            password: addForm.password,
            phone: cleanPhone,
            position: cleanPosition,
            role: addForm.role,
            status: addForm.status,
          },
        });
      } else {
        if (cleanUsername.length < 3) {
          throw new Error('Nama pengguna minimal 3 karakter.');
        }
        if (addForm.password.length < 6) {
          throw new Error('Kata sandi minimal 6 karakter.');
        }
        if (await hasOfflineUsername(cleanUsername)) {
          throw new Error('Nama pengguna sudah digunakan.');
        }
        const now = new Date().toISOString();
        const localUser: AppUser = {
          uid: `local_usr_${Date.now()}`,
          username: cleanUsername,
          displayName: cleanDisplayName,
          email: '',
          phone: cleanPhone,
          position: cleanPosition,
          role: addForm.role,
          status: addForm.status,
          createdAt: now,
          updatedAt: now,
          createdBy: appUser.uid,
          updatedBy: appUser.uid,
        };
        await cacheOfflineAuthCredential(cleanUsername, addForm.password, localUser);
        const nextList = [...users, localUser];
        await setOfflineKV('users', nextList);
      }

      showToast(`Pengguna ${cleanUsername} berhasil ditambahkan.`, 'success');
      setShowAddModal(false);
      setAddForm({
        username: '',
        displayName: '',
        password: '',
        phone: '',
        position: '',
        role: 'Operator',
        status: 'active',
      });
      await loadUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menambah pengguna.', 'error');
    } finally {
      setSavingAdd(false);
    }
  };

  const openEditModal = (user: AppUser) => {
    setEditingUser(user);
    setEditForm({
      username: user.username || user.displayName,
      displayName: user.displayName,
      phone: user.phone || '',
      position: user.position || '',
      role: user.role,
      status: user.status,
      newPassword: '',
      recoveryCode: '',
    });
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || !appUser || !canMutate) return;

    const cleanUsername = editForm.username.trim();
    if (cleanUsername.length < 3) {
      showToast('Nama pengguna minimal 3 karakter.', 'error');
      return;
    }

    const cleanName = sanitizeString(
      editForm.displayName,
      BLUEPRINT_LIMITS.user.displayNameMax
    );
    if (!cleanName) {
      showToast('Nama tampilan wajib diisi.', 'error');
      return;
    }

    const cleanRecovery = editForm.recoveryCode.trim();
    if (cleanRecovery && cleanRecovery.length < 4) {
      showToast('Kode pemulihan minimal 4 karakter jika diisi.', 'error');
      return;
    }

    const cleanPhone = sanitizeString(editForm.phone, BLUEPRINT_LIMITS.user.phoneMax);
    const cleanPosition = sanitizeString(editForm.position, BLUEPRINT_LIMITS.user.positionMax);

    setSavingEdit(true);
    try {
      let updatedInFirestore = false;
      if (isOnline && firestoreConnected) {
        updatedInFirestore = await updateFirestoreUserForAdmin(editingUser.uid, {
          displayName: cleanName,
          phone: cleanPhone,
          position: cleanPosition,
          role: editForm.role,
          status: editForm.status,
        }).catch(() => false);
      }

      if (useServerApi) {
        try {
          await apiRequest(`/api/users/${editingUser.uid}`, {
            method: 'PATCH',
            body: {
              username: cleanUsername,
              displayName: cleanName,
              phone: cleanPhone,
              position: cleanPosition,
              role: editForm.role,
              status: editForm.status,
              newPassword: editForm.newPassword || undefined,
              recoveryCode: cleanRecovery || undefined,
            },
          });
        } catch (err) {
          if (!updatedInFirestore) {
            throw err;
          }
        }
      } else {
        await updateOfflineAuthUserMetadata(
          editingUser.uid,
          {
            username: cleanUsername,
            displayName: cleanName,
            phone: cleanPhone,
            position: cleanPosition,
            role: editForm.role,
            status: editForm.status,
            updatedBy: appUser.uid,
          },
          editForm.newPassword || undefined,
          cleanRecovery || undefined
        );
        const nextList = users.map((u) =>
          u.uid === editingUser.uid
            ? {
                ...u,
                username: cleanUsername,
                displayName: cleanName,
                phone: cleanPhone,
                position: cleanPosition,
                role: editForm.role,
                status: editForm.status,
                hasRecoveryCode: Boolean(u.hasRecoveryCode || cleanRecovery),
                updatedAt: new Date().toISOString(),
                updatedBy: appUser.uid,
              }
            : u
        );
        await setOfflineKV('users', nextList);
      }

      showToast(`Data pengguna ${cleanName} (@${cleanUsername}) berhasil diperbarui.`, 'success');
      setEditingUser(null);
      await loadUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal memperbarui pengguna.', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleQuickActivate = async (user: AppUser) => {
    if (!canMutate || !appUser) return;
    try {
      let updatedInFirestore = false;
      if (isOnline && firestoreConnected) {
        updatedInFirestore = await updateFirestoreUserForAdmin(user.uid, {
          displayName: user.displayName,
          phone: user.phone || '',
          position: user.position || '',
          role: user.role,
          status: 'active',
        }).catch(() => false);
      }

      if (useServerApi) {
        try {
          await apiRequest(`/api/users/${user.uid}`, {
            method: 'PATCH',
            body: {
              displayName: user.displayName,
              phone: user.phone || '',
              position: user.position || '',
              role: user.role,
              status: 'active',
            },
          });
        } catch (err) {
          if (!updatedInFirestore) {
            throw err;
          }
        }
      } else {
        await updateOfflineAuthUserMetadata(user.uid, {
          status: 'active',
          updatedBy: appUser.uid,
        });
        const nextList = users.map((u) =>
          u.uid === user.uid
            ? { ...u, status: 'active' as UserStatus, updatedAt: new Date().toISOString() }
            : u
        );
        await setOfflineKV('users', nextList);
      }
      showToast(`Akun ${user.displayName} telah diaktifkan.`, 'success');
      await loadUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal mengaktifkan pengguna.', 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingUser || !canMutate) return;
    setDeleting(true);
    try {
      if (useServerApi) {
        await apiRequest(`/api/users/${deletingUser.uid}`, {
          method: 'DELETE',
        });
      } else {
        await deleteOfflineAuthUser(deletingUser.uid);
        const nextList = users.filter((u) => u.uid !== deletingUser.uid);
        await setOfflineKV('users', nextList);
      }
      showToast(`Pengguna ${deletingUser.displayName} berhasil dihapus.`, 'success');
      setDeletingUser(null);
      await loadUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus pengguna.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold text-[#111C18]">
              Manajemen Pengguna & Hak Akses
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Kelola akun pengguna berbasis nama dan kata sandi (tanpa email). Pengguna baru yang mendaftar sendiri berstatus Menunggu Aktivasi.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <div className="flex items-center gap-5 border-r border-slate-200 pr-4">
              <div>
                <p className="text-xs text-slate-500">Total Akun</p>
                <p className="font-mono text-xl font-semibold text-[#111C18] tabular-nums">
                  {users.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Menunggu</p>
                <p className="font-mono text-xl font-semibold text-[#9A742B] tabular-nums">
                  {users.filter((u) => u.status === 'pending').length}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={!canMutate}
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F3D2E] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#144D3A] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              Tambah Pengguna
            </button>
          </div>
        </div>

        {!useServerApi && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
            <WifiOff className="h-4 w-4 shrink-0 text-[#D97706]" />
            <span>
              Mode penyimpanan lokal/offline aktif. Perubahan aktivasi, peran, dan akun pengguna disimpan pada perangkat ini.
            </span>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama pengguna, nama lengkap, atau jabatan..."
              className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(['Semua', 'Administrator', 'Pimpinan', 'Operator'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(r)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    roleFilter === r
                      ? 'bg-white text-[#0F3D2E] shadow-sm'
                      : 'text-slate-600 hover:text-[#111C18]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'Semua' | UserStatus)}
              aria-label="Filter status pengguna"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-[#0F3D2E] focus:outline-none"
            >
              <option value="Semua">Semua Status</option>
              <option value="active">Aktif</option>
              <option value="pending">Menunggu Aktivasi</option>
              <option value="inactive">Nonaktif</option>
            </select>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center">
              <p className="text-sm font-medium text-slate-700">
                Belum ada pengguna lain yang terdaftar atau sesuai dengan filter.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="pb-3 pr-4">Nama & Username</th>
                  <th className="pb-3 pr-4">Jabatan & Kontak</th>
                  <th className="pb-3 pr-4">Peran</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Terdaftar</th>
                  <th className="pb-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((u) => {
                  const isSelf = u.uid === appUser?.uid;
                  return (
                    <tr key={u.uid} className="hover:bg-slate-50/70">
                      <td className="py-3.5 pr-4">
                        <p className="font-medium text-[#111C18]">
                          {u.displayName}{' '}
                          {isSelf && <span className="text-xs text-slate-400">(Anda)</span>}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">
                          @{u.username || u.displayName}
                        </p>
                        {u.email && (
                          <p className="mt-0.5 text-[11px] text-emerald-700">{u.email}</p>
                        )}
                      </td>
                      <td className="py-3.5 pr-4 text-xs text-slate-600">
                        <p>{u.position || '-'}</p>
                        <p className="mt-0.5 font-mono text-slate-400">{u.phone || '-'}</p>
                      </td>
                      <td className="py-3.5 pr-4 text-xs font-semibold text-[#0F3D2E] whitespace-nowrap">
                        {u.role}
                      </td>
                      <td className="py-3.5 pr-4 text-xs whitespace-nowrap">
                        <span
                          className={
                            u.status === 'active'
                              ? 'font-medium text-[#16A34A]'
                              : u.status === 'pending'
                              ? 'font-medium text-[#D97706]'
                              : 'font-medium text-[#DC2626]'
                          }
                        >
                          {STATUS_LABELS[u.status]}
                        </span>
                      </td>
                      <td className="py-3.5 pr-4 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {formatTanggalIndonesia(u.createdAt)}
                      </td>
                      <td className="py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {u.status === 'pending' && canMutate && (
                            <button
                              type="button"
                              onClick={() => handleQuickActivate(u)}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#0F3D2E] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#144D3A]"
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                              Aktifkan
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={!canMutate}
                            onClick={() => openEditModal(u)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <UserCog className="h-3.5 w-3.5" />
                            Ubah
                          </button>
                          {!isSelf && (
                            <button
                              type="button"
                              disabled={!canMutate}
                              onClick={() => setDeletingUser(u)}
                              className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                              aria-label={`Hapus ${u.displayName}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Add User Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#111C18]">
                Tambah Pengguna Baru
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddUser} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Nama Pengguna (Username) <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={addForm.username}
                  onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                  placeholder="Contoh: operator1"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Nama Lengkap</label>
                <input
                  type="text"
                  maxLength={BLUEPRINT_LIMITS.user.displayNameMax}
                  value={addForm.displayName}
                  onChange={(e) => setAddForm({ ...addForm, displayName: e.target.value })}
                  placeholder="Nama tampilan pengguna"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Kata Sandi <span className="text-red-600">*</span>
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={addForm.password}
                  onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                  placeholder="Minimal 6 karakter"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Peran</label>
                  <select
                    value={addForm.role}
                    onChange={(e) => {
                      const nextRole = e.target.value as UserRole;
                      setAddForm({
                        ...addForm,
                        role: nextRole,
                        status:
                          nextRole === 'Administrator' && addForm.status === 'pending'
                            ? 'active'
                            : addForm.status,
                      });
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                  >
                    <option value="Operator">Operator</option>
                    <option value="Pimpinan">Pimpinan</option>
                    <option value="Administrator">Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Status</label>
                  <select
                    value={addForm.role === 'Administrator' && addForm.status === 'pending' ? 'active' : addForm.status}
                    onChange={(e) => setAddForm({ ...addForm, status: e.target.value as UserStatus })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                  >
                    <option value="active">Aktif</option>
                    {addForm.role !== 'Administrator' && (
                      <option value="pending">Menunggu Aktivasi</option>
                    )}
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Jabatan</label>
                  <input
                    type="text"
                    maxLength={BLUEPRINT_LIMITS.user.positionMax}
                    value={addForm.position}
                    onChange={(e) => setAddForm({ ...addForm, position: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">No. Telepon</label>
                  <input
                    type="text"
                    maxLength={BLUEPRINT_LIMITS.user.phoneMax}
                    value={addForm.phone}
                    onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingAdd}
                  className="rounded-lg bg-[#0F3D2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#144D3A] disabled:opacity-60"
                >
                  {savingAdd ? 'Menyimpan...' : 'Tambah Akun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#111C18]">
                Ubah & Reset Akun Pengguna
              </h3>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Nama Pengguna (Username untuk Masuk)
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={editForm.username}
                  onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  maxLength={BLUEPRINT_LIMITS.user.displayNameMax}
                  value={editForm.displayName}
                  onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Peran (Role)</label>
                  <select
                    value={editForm.role}
                    onChange={(e) => {
                      const nextRole = e.target.value as UserRole;
                      setEditForm({
                        ...editForm,
                        role: nextRole,
                        status:
                          nextRole === 'Administrator' && editForm.status === 'pending'
                            ? 'active'
                            : editForm.status,
                      });
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                  >
                    <option value="Operator">Operator</option>
                    <option value="Pimpinan">Pimpinan</option>
                    <option value="Administrator">Administrator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Status</label>
                  <select
                    value={
                      editForm.role === 'Administrator' && editForm.status === 'pending'
                        ? 'active'
                        : editForm.status
                    }
                    disabled={editingUser.uid === appUser.uid}
                    onChange={(e) =>
                      setEditForm({ ...editForm, status: e.target.value as UserStatus })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none disabled:bg-slate-50"
                  >
                    <option value="active">Aktif</option>
                    {editForm.role !== 'Administrator' && (
                      <option value="pending">Menunggu Aktivasi</option>
                    )}
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Jabatan</label>
                <input
                  type="text"
                  maxLength={BLUEPRINT_LIMITS.user.positionMax}
                  value={editForm.position}
                  onChange={(e) => setEditForm({ ...editForm, position: e.target.value })}
                  placeholder="Contoh: Sekretaris / Bendahara / Pimpinan"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Nomor Telepon</label>
                <input
                  type="text"
                  maxLength={BLUEPRINT_LIMITS.user.phoneMax}
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Reset Kata Sandi (Opsional)
                  </label>
                  <input
                    type="password"
                    minLength={6}
                    value={editForm.newPassword}
                    onChange={(e) => setEditForm({ ...editForm, newPassword: e.target.value })}
                    placeholder="Kosongkan jika tetap"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Kode Pemulihan Baru
                  </label>
                  <input
                    type="text"
                    minLength={4}
                    maxLength={64}
                    value={editForm.recoveryCode}
                    onChange={(e) => setEditForm({ ...editForm, recoveryCode: e.target.value })}
                    placeholder={
                      editingUser.hasRecoveryCode ? 'Sudah diatur (ganti?)' : 'Opsional · min 4 kar'
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-[#111C18] focus:border-[#0F3D2E] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded-lg bg-[#0F3D2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#144D3A] disabled:opacity-60"
                >
                  {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deletingUser)}
        title="Hapus Data Pengguna"
        description={`Apakah Anda yakin ingin menghapus akun ${deletingUser?.displayName} (@${deletingUser?.username || ''})? Pengguna tidak akan dapat mengakses sistem lagi.`}
        confirmLabel="Hapus Pengguna"
        danger
        loading={deleting}
        onCancel={() => setDeletingUser(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
