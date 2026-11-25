import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { BLUEPRINT_LIMITS, INSTITUTION_DOC_ID } from '../types/models';
import { sanitizeString } from './formatters';

interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  actorUid: string;
  actorName?: string;
  details?: string;
}

export async function recordAuditLog(input: AuditInput): Promise<void> {
  const path = 'auditLogs';
  try {
    await addDoc(collection(db, path), {
      institutionId: INSTITUTION_DOC_ID,
      action: sanitizeString(input.action, BLUEPRINT_LIMITS.auditLog.actionMax) || 'UPDATE',
      entityType: sanitizeString(input.entityType, BLUEPRINT_LIMITS.auditLog.entityTypeMax) || 'SYSTEM',
      entityId: sanitizeString(input.entityId, BLUEPRINT_LIMITS.auditLog.entityIdMax) || 'unknown',
      actorUid: input.actorUid,
      actorName: sanitizeString(input.actorName, BLUEPRINT_LIMITS.auditLog.actorNameMax),
      details: sanitizeString(input.details, BLUEPRINT_LIMITS.auditLog.detailsMax),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}
