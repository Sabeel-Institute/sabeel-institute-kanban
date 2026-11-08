/**
 * More → Labels: the institute labels, which every board shows.
 *
 * ADMIN-only, and the only place these change: on a board they are listed and
 * locked, admins included, because a rename or delete here reaches cards on
 * boards the person making it may not be on. The route is gated in `App.tsx`
 * as well as hidden from the menu, for an admin demoted while it is open.
 */
import { StyleSheet } from 'react-native';
import { LabelManager } from '../components/LabelManager';
import { Card, Hint, IconAction, Row, Screen, Spinner, Title } from '../components/ui';
import { useLabels } from '../labels';
import { useNav } from '../nav';
import type { SessionUser } from '../session';

export function LabelsScreen({ user }: { user: SessionUser }) {
  const nav = useNav();
  const labels = useLabels();
  const institute = (labels.data ?? []).filter((l) => !l.boardId);
  return (
    <Screen width="read">
      <Row style={styles.between}>
        <Title>Labels</Title>
        <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
      </Row>
      <Card>
        <Hint>These appear on every board. Only admins can change them, and only here.</Hint>
        {labels.status === 'loading' ? <Spinner label="Loading labels…" /> : null}
        <LabelManager
          boardId={null}
          user={user}
          labels={institute}
          known={labels.status === 'ready' ? institute : null}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ between: { justifyContent: 'space-between' } });
