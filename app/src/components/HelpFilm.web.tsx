import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, useTheme } from '../theme';

/**
 * A help film on the website (native sibling: HelpFilm.tsx): the browser's
 * own `<video>`, with its own controls and the captions as a track.
 *
 * `crossOrigin`, because the films are on a site of their own, and a caption
 * track from another origin loads only under CORS — which that site grants
 * everyone (`scripts/tutorials/publish.mjs`).
 */
export function HelpFilm({
  video,
  captions,
  size,
  onError,
}: {
  video: string;
  captions: string;
  /** Drawn at this size, which keeps the film's own shape — see `fit` in HelpScreen. */
  size: { width: number; height: number };
  onError: () => void;
}) {
  const t = useTheme();
  const host = useRef<View>(null);
  const failed = useRef(onError);
  failed.current = onError;
  useEffect(() => {
    const box = host.current as unknown as HTMLElement | null;
    if (!box) return;
    const el = document.createElement('video');
    el.controls = true;
    el.playsInline = true;
    el.preload = 'metadata';
    el.crossOrigin = 'anonymous';
    el.src = video;
    Object.assign(el.style, { width: '100%', height: '100%', display: 'block' });
    el.setAttribute('data-testid', 'help-video');
    const track = document.createElement('track');
    track.kind = 'captions';
    track.label = 'English';
    track.srclang = 'en';
    track.src = captions;
    track.default = true;
    el.appendChild(track);
    const fail = () => failed.current();
    el.addEventListener('error', fail);
    box.appendChild(el);
    return () => {
      el.removeEventListener('error', fail);
      el.pause();
      el.remove();
    };
  }, [video, captions]);
  return (
    <View
      ref={host}
      testID="help-film"
      style={[styles.frame, { backgroundColor: t.bg.inset, borderColor: t.border.strong }, size]}
    />
  );
}

const styles = StyleSheet.create({
  // A border, because a film of the app sits inside the app: without one, the
  // phone cut on a computer reads as part of the screen around it.
  frame: { borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
});
