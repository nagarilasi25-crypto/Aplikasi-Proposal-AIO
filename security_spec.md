# Security Specification — AR-RAUDHAH PROPOSAL MANAGEMENT SYSTEM

## 1. Data Invariants
1. **No Auto-Admin Escalation**: A newly registered user (`users/{uid}`) MUST NOT be able to assign themselves `role: "Administrator"` or `status: "active"` unless they are the verified bootstrapped administrator (`nagarilasi25@gmail.com` with `email_verified == true`). All other newly registered users are strictly constrained to `role == "Operator"` and `status == "pending"`.
2. **PII Isolation**: User documents (`users/{uid}`) contain PII (`email`, `phone`) and may ONLY be read (`get`) by the document owner (`request.auth.uid == userId`) or an active `Administrator`. Listing `users` is strictly restricted to `Administrator`.
3. **Immutable Ownership & Timestamps**: `createdAt` and `createdBy` are immutable on update and strictly validated against `request.time` and `request.auth.uid` on creation. `updatedAt` MUST equal `request.time` on both creation and update.
4. **Institution Binding**: All operational records (`proposalCategories`, `proposalTemplates`, `proposals`, `proposalBudgets`, `proposalAttachments`, `proposalArchives`, `proposalStatusHistory`, `auditLogs`) MUST bind to an existing institution (`exists(/databases/$(database)/documents/institutions/$(incoming().institutionId))`) and enforce strict string size limits.
5. **Role-Based Workflow Boundaries**:
   - `Administrator`: Full system management, user role/status management, institution profile updates, audit log visibility.
   - `Pimpinan`: Can inspect proposals, archives, budgets, attachments, and approve/reject proposals (`status` transitions + approval notes).
   - `Operator`: Can create/edit proposals (when not in terminal state `'Selesai'`), budgets, attachments, and archives.
   - Pending or inactive users have zero read/write access to institutional collections.
6. **Terminal State Locking**: Once a proposal reaches `status == 'Selesai'`, non-admin users cannot modify it.
7. **Immutable Audit Trail**: `auditLogs` and `proposalStatusHistory` are append-only (`update` and `delete` are forbidden).

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Self-Admin Registration**: Unprivileged user creates `/users/{uid}` with `{ role: "Administrator", status: "active" }`.
2. **Role Self-Promotion Update**: Active `Operator` updates their own `/users/{uid}` to `{ role: "Administrator" }`.
3. **Status Self-Activation Update**: Pending user updates their own `/users/{uid}` to `{ status: "active" }`.
4. **PII Cross-User Read**: Active `Operator` attempts `get` on another user's `/users/{otherUid}` document.
5. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to create a proposal or update institution profile.
6. **Shadow Ghost Field Injection**: Active user updates `institutions/ar-raudhah` with an unlisted field `{ hackedFlag: true }`.
7. **Client Timestamp Forgery**: Active user creates a proposal with `createdAt` set to a past timestamp instead of `request.time`.
8. **Author Spoofing**: Active user creates a proposal with `createdBy` set to another user's UID.
9. **ID Poisoning**: User attempts to write to `/proposals/{200-char-invalid-id!@#}` violating `isValidId()`.
10. **Orphaned Proposal Write**: User creates a proposal with `institutionId: "non-existent-inst"`.
11. **Terminal State Tampering**: Non-admin `Operator` attempts to modify a proposal whose existing `status` is `"Selesai"`.
12. **Audit Log Tampering**: Even an `Administrator` attempts to `update` or `delete` an existing `/auditLogs/{logId}` entry.
