import { IconAction } from '../ui';

/**
 * The bell beside a new card's title: subscribe its creator, on until they turn
 * it off. A TOGGLE rather than an action, so its label stays put and
 * `selected` carries the state, the way the editor's Bold does.
 *
 * Shown only to a member of the board. Rules hold every subscriber to the
 * board's members, and an admin may add a card to a board they are not on.
 */
export function NewCardBell({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <IconAction
      icon={on ? 'notifications-active' : 'notifications-none'}
      label="Subscribe to this card"
      selected={on}
      accent={on}
      onPress={onToggle}
    />
  );
}

/**
 * A column's bell: hear when a card arrives in it. An ACTION whose label says
 * what a tap does, like the card's own bell, and named for its column, since
 * a board shows several at once.
 */
export function WatchColumnBell({
  columnName,
  watching,
  busy,
  onPress,
}: {
  columnName: string;
  watching: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <IconAction
      icon={watching ? 'notifications-active' : 'notifications-none'}
      label={watching ? `Stop watching ${columnName}` : `Watch ${columnName}`}
      accent={watching}
      disabled={busy}
      onPress={onPress}
    />
  );
}
