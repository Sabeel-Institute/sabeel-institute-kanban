/**
 * A right-click as a control's long-press — WEB side of the seam (native
 * sibling: contextMenu.ts).
 *
 * A mouse can press and hold, and react-native-web turns that into
 * `onLongPress`, but nobody holds a mouse button on a computer: a right-click
 * is the computer's long-press. react-native-web's Pressable forwards
 * `onContextMenu` to the element, which React Native's types do not name, so
 * it is spread in from here. With no action the browser's own menu is left
 * alone, as everywhere else.
 */
export function contextMenuProps(action: (() => void) | undefined): object {
  if (!action) return {};
  return {
    onContextMenu: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      action();
    },
  };
}
