/**
 * A right-click as a control's long-press — NATIVE side of the seam (web
 * sibling: contextMenu.web.ts). A phone has no right-click; its long-press is
 * the Pressable's own `onLongPress`, so there is nothing to add here.
 */
export function contextMenuProps(_action: (() => void) | undefined): object {
  return {};
}
