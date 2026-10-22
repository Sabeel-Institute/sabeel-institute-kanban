import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Body, Button, Caption, Hint } from './ui';
import { radius, space, useTheme } from '../theme';

/**
 * A centred, size-bounded dialog.
 *
 * Replaces an absolutely-positioned panel pinned to the bottom of the screen,
 * which could not be fully seen on a short viewport: its content ran past the
 * bottom edge with no way to reach it, and enlarging the window did not reliably
 * help because the panel grew with its content.
 *
 * The rules that fixes are worth stating, because they apply to every overlay:
 *
 *  - Bound the height (a fraction of the viewport) and scroll INSIDE it, so the
 *    dialog can never be taller than the screen however many options it has.
 *  - Centre it rather than pinning to an edge, so a keyboard rising from the
 *    bottom cannot cover it.
 *  - Give it a dismissing backdrop, so it is never possible to get stuck behind.
 *
 * Uses RN's Modal, which renders in a top layer on both platforms. An
 * absolutely-positioned View is still subject to its parent's clipping and
 * stacking context, which was the other half of why the old panel misbehaved.
 */
export function Sheet({
  visible,
  title,
  onClose,
  closeLabel = 'Cancel',
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  /**
   * The footer button's word. `Cancel` is right for a sheet whose picks only
   * take effect when you confirm, and WRONG for one whose picks apply as you
   * make them — there it reads as "undo", which it is not.
   *
   * Defaulted rather than required because most sheets here are the first kind,
   * and because a dozen e2e steps across four scripts close a sheet by clicking
   * a button named exactly `Cancel`. Only the sheet that changed behaviour
   * should change its word.
   */
  closeLabel?: string;
  children: ReactNode;
}) {
  const t = useTheme();
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/*
        The backdrop is a POINTER affordance only — deliberately NOT a button.

        `accessibilityRole="button"` does not merely add an ARIA role on web:
        react-native-web maps it to a real <button> ELEMENT
        (AccessibilityUtil/propsToAccessibilityComponent). So this wrapper became
        a <button> containing the whole dialog — including its TextInput. Nesting
        interactive content inside a button is invalid HTML, and the browser
        resolved it by treating a space typed in the field as activating the
        button: the sheet dismissed mid-word. It cost a label called "waiting on"
        its space, and it applied to every sheet with a field in it — the link
        dialog too. Native RN renders no button element and has no key
        activation, which is why Android never showed it.

        Verified in both directions on the real app: with the role, typing a
        space closes the sheet; without it, the space lands in the field. Do not
        restore the role to make the backdrop "accessible" — it never was. The
        sheet has a real Cancel button, and `onRequestClose` handles Escape on
        web and Back on Android, which are the routes keyboards and assistive
        tech actually use.

        Nor is it, or the panel, an accessibility element (`accessible={false}`).
        A Pressable is one by default, and on iOS an accessibility element
        swallows everything under it: the iOS accessibility tree held the whole
        sheet as ONE element labelled with all its text, so VoiceOver had no
        control to move to and Maestro could not tap one. react-native-web does not forward the
        prop, so the web DOM is unchanged.
      */}
      <Pressable
        style={[styles.backdrop, { backgroundColor: t.effect.overlay }]}
        onPress={onClose}
        focusable={false}
        accessible={false}
      >
        {/* Absorbs taps so a press inside does not dismiss via the backdrop. */}
        <Pressable
          style={[
            styles.panel,
            { backgroundColor: t.bg.raised, borderColor: t.border.strong },
          ]}
          onPress={() => {}}
          accessible={false}
        >
          <Body>{title}</Body>
          {/*
            `keyboardShouldPersistTaps` IS WHAT MAKES THE BUTTONS IN HERE WORK.

            At its default — `'never'` — a ScrollView with a focused TextInput
            inside it takes the responder in the CAPTURE phase and eats the
            touch. React Native says so in its own source: "the first tap should
            be sent to the scroll view and dismiss the keyboard, then the second
            tap goes to the actual interior view". A `Pressable` under the
            finger therefore never becomes responder — it does not even show its
            pressed state — and `onPress` never runs.

            Every sheet in this app is a field followed by the button that acts
            on it, so that default eats the tap the user actually came to make.
            Filmed on a phone in the link dialog: three taps on Add link over
            3.5 seconds, the first two with the button at full opacity (no press
            state) and the third at 0.8 (pressed) — and only that one worked.

            Worse here than the RN comment implies, because it does not stop at
            one tap: the guard is `a TextInput is focused AND a keyboard may be
            open`, and the second half is `_keyboardMetrics != null`, cleared by
            `keyboardDidHide` — an event this app does not reliably get under
            edge-to-edge (see the `expo-firebase-stack` skill). The keyboard
            goes away, the field keeps focus, and the ScrollView goes on eating
            taps with nothing on screen to explain why.

            `'handled'` is the value that means what a dialog wants: a tap a
            child handles reaches it, and a tap nothing handles still dismisses
            the keyboard.
          */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          <Button label={closeLabel} variant="secondary" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** One choice inside a Sheet — together these give the compact "dropdown" shape. */
export function SheetOption({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={selected}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: selected
            ? t.bg.accentSoft
            : pressed
              ? t.bg.inset
              : t.bg.surface,
          borderColor: selected ? t.accent.base : t.border.subtle,
        },
      ]}
    >
      <View style={styles.optionText}>
        <Body>{label}</Body>
        {selected ? <Caption>current</Caption> : null}
        {detail ? <Hint>{detail}</Hint> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    // Never taller than the viewport, whatever the content.
    maxHeight: '80%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  body: { flexGrow: 0 },
  bodyContent: { gap: space.sm },
  option: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: space.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  optionText: { gap: 2 },
});
