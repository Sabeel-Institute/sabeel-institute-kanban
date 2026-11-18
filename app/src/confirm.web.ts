/**
 * OK/Cancel confirmation — WEB side of the seam (native sibling: confirm.ts).
 *
 * `window.confirm` rather than a custom modal: it is synchronous, unmissable,
 * keyboard-accessible for free, and cannot be rendered off-screen — which
 * matters for a dialog whose entire job is to stop someone granting admin by
 * accident.
 */
export function confirmAction(title: string, message: string): Promise<boolean> {
  return Promise.resolve(window.confirm(`${title}\n\n${message}`));
}

/** A notice with one button — WEB side (native sibling: confirm.ts). */
export function noticeAction(title: string, message: string): Promise<void> {
  window.alert(`${title}\n\n${message}`);
  return Promise.resolve();
}
