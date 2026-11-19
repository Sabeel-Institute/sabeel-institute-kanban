import { IconAction } from '../ui';

/**
 * The bell beside a new card's title: subscribe its creator, on until they turn
 * it off. A TOGGLE rather than an action, so its label stays put and
 * `selected` carries the state, the way the editor's Bold does.
 *
 * Shown only to a member of the board. Rules hold every subscriber to the
 * board's members, and an admin may add a card to a board they are not on.
 *
 * The Clone sheet uses it too, labelled for every card, and starts it off.
 */
export function NewCardBell({
  on,
  onToggle,
  label = 'Subscribe to this card',
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <IconAction
      icon={on ? 'notifications-active' : 'notifications-none'}
      label={label}
      disabled={disabled}
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

/**
 * Watch a lane: told when a card arrives in it (lane watching, Faisal
 * 2026-11-18). Beside the lane's count on its heading, never inside the
 * heading's fold button: two controls, one for each job.
 */
export function WatchLaneBell({
  laneName,
  watching,
  busy,
  onPress,
}: {
  laneName: string;
  watching: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <IconAction
      icon={watching ? 'notifications-active' : 'notifications-none'}
      label={watching ? `Stop watching the ${laneName} lane` : `Watch the ${laneName} lane`}
      accent={watching}
      disabled={busy}
      onPress={onPress}
    />
  );
}
