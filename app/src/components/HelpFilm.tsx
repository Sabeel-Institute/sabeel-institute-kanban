import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useEvent } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { radius, useTheme } from '../theme';

/**
 * A help film on a phone (web sibling: HelpFilm.web.tsx): the platform's own
 * player and controls, full screen a tap away. The captions are the
 * website's; on a phone the narration is the film's words.
 */
export function HelpFilm({
  video,
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
  const player = useVideoPlayer(video);
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    if (status === 'error') onError();
  }, [status, onError]);
  return (
    <View testID="help-film" style={[styles.frame, { backgroundColor: t.bg.inset }, size]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls
        fullscreenOptions={{ enable: true }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.md, overflow: 'hidden' },
});
