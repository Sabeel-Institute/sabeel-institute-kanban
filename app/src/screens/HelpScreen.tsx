import { Fragment, useState } from 'react';
import { StyleSheet, View, type LayoutRectangle } from 'react-native';
import {
  HELP_VIDEOS,
  helpFilmUrl,
  type HelpAudience,
  type HelpVariant,
} from '@sabeel/shared';
import { useNav } from '../nav';
import { useLayout } from '../theme/layout';
import { space } from '../theme';
import { SheetOption } from '../components/Sheet';
import { HelpFilm } from '../components/HelpFilm';
import {
  Body,
  Card,
  Heading,
  Hint,
  IconAction,
  Row,
  Screen,
  SegmentedIcons,
  Title,
} from '../components/ui';

/** Everyone sees every film, in this order: everyday work, running a board, administration. */
const SECTIONS: { audience: HelpAudience; title: string }[] = [
  { audience: 'everyone', title: 'Using Kanban' },
  { audience: 'owner', title: 'Running a board' },
  { audience: 'admin', title: 'For admins' },
];

/**
 * Help (More → Help): short narrated films of the app at work, each made on a
 * phone and on a computer. Every film is listed for everyone — a member who
 * has seen what an owner can do knows whom to ask.
 */
export function HelpScreen() {
  const nav = useNav();
  return (
    <Screen width="read">
      <Row style={styles.between}>
        <Title>Help</Title>
        <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
      </Row>
      <Body>
        Short films of the app at work. Each one comes in two versions, on a phone and
        on a computer, with captions.
      </Body>
      {SECTIONS.map(({ audience, title }) => (
        <Fragment key={audience}>
          <Heading>{title}</Heading>
          {HELP_VIDEOS.filter((v) => v.audience === audience).map((v) => (
            <SheetOption
              key={v.id}
              testID={`help-film-${v.id}`}
              label={v.title}
              detail={v.summary}
              onPress={() => nav.push({ name: 'helpFilm', id: v.id })}
            />
          ))}
        </Fragment>
      ))}
    </Screen>
  );
}

/** Each cut's shape: the phone films stand, the computer films lie down. */
const ASPECT: Record<HelpVariant, number> = { phone: 390 / 844, computer: 1440 / 900 };

/**
 * The film as large as the room under the heading holds it, WHOLE: a standing
 * film drawn at the column's width is taller than a phone's screen, and its
 * controls and the bottom of the app it shows would sit below the fold.
 */
function fit(room: LayoutRectangle, aspect: number): { width: number; height: number } {
  const width = Math.min(room.width, room.height * aspect);
  return { width, height: width / aspect };
}

const CUTS = [
  { key: 'phone', icon: 'smartphone', label: 'On a phone' },
  { key: 'computer', icon: 'computer', label: 'On a computer' },
] as const;

/**
 * One help film. It opens on the cut for the screen it is watched on, and the
 * other is a tap away: someone at a computer may want to see the phone.
 */
export function HelpFilmScreen({ id }: { id: string }) {
  const nav = useNav();
  const { isWide } = useLayout();
  const film = HELP_VIDEOS.find((v) => v.id === id);
  const [variant, setVariant] = useState<HelpVariant>(isWide ? 'computer' : 'phone');
  const [unplayable, setUnplayable] = useState<HelpVariant | null>(null);
  const [room, setRoom] = useState<LayoutRectangle | null>(null);
  const header = (
    <Row style={styles.between}>
      <Title>{film?.title ?? 'Help'}</Title>
      <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
    </Row>
  );
  if (!film) {
    return (
      <Screen width="read">
        {header}
        <Card>
          <Body>There is no such help film.</Body>
        </Card>
      </Screen>
    );
  }
  return (
    // Not scrolled: the film is fitted to the room the screen has left.
    <Screen width="list" scroll={false}>
      {header}
      <Hint>{film.summary}</Hint>
      <View style={styles.cuts}>
        <SegmentedIcons options={CUTS} value={variant} onChange={setVariant} />
      </View>
      <View style={styles.room} onLayout={(e) => setRoom(e.nativeEvent.layout)}>
        {unplayable === variant ? (
          <Card>
            <Body>This film could not be played. Check your connection and try again.</Body>
          </Card>
        ) : room ? (
          <HelpFilm
            key={`${id}-${variant}`}
            video={helpFilmUrl(id, variant, 'video')}
            captions={helpFilmUrl(id, variant, 'captions')}
            size={fit(room, ASPECT[variant])}
            onError={() => setUnplayable(variant)}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  cuts: { alignItems: 'flex-start', marginTop: space.sm },
  room: { flex: 1, alignItems: 'center', marginTop: space.md, minHeight: 200 },
});
