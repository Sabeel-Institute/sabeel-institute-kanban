/**
 * Cloud Functions entry point.
 *
 * Phase 1: account provisioning + domain enforcement + admin access control.
 * Later phases append triggers here — see docs/PHASE_STATUS.md.
 */
export { onUserCreate } from './auth';
export { beforeSignIn, beforeSignUp } from './signUpGate';
export { accountExists } from './accountExists';
export { acceptRules } from './acceptRules';
export { reportProblem } from './reports';
export { setUserAccess } from './users';
export {
  removeBoardMember,
  addBoardMember,
  listAddableUsers,
  countMemberAssignments,
  boardsSolelyOwnedBy,
} from './boards';
export { countLabelUsage, deleteLabel } from './labels';
export { onCommentWritten } from './comments';
export { onCardWritten } from './activity';
export { onCardBoardCount } from './boardCardCount';
export { onCardDeleted } from './cleanup';
export {
  finalizeAttachment,
  deleteAttachment,
  getAttachmentUrl,
  pruneAttachments,
} from './attachments';
export {
  onCommentNotify,
  onCardNotify,
  onUserPending,
  dueSoonReminders,
  pruneNotifications,
} from './notifications';
export { healthCheck } from './health';
