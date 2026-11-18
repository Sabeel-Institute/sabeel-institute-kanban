import { useState } from 'react';
import { CARD_TITLE_MAX, type BoardLane } from '@sabeel/shared';
import { Select } from '../Select';
import { Button, Hint, Row, TextField } from '../ui';
import { NewCardBell } from './Bells';

/**
 * The "+ Add card" composer, shared by both native board layouts.
 *
 * THE DRAFT LIVES HERE, and that is the point of the component.
 *
 * Both boards used to hold `newTitle` in the board's own state. A board renders
 * every column and every card in it, so each keystroke re-rendered the whole
 * board — measured at 45ms/char on a busy card screen, the same shape of bug,
 * and worse here because the board is the screen people spend the day on. Typing
 * a card title now re-renders this form and nothing else.
 *
 * `adding` stays in each parent: the two boards disagree about what it means
 * (`boolean` for the narrow board, which shows one column at a time, and
 * `string | null` for the wide one, which needs to know WHICH column is
 * composing). Only the draft is common, so only the draft moved.
 *
 * UNMOUNT-SCOPED, like `BoardNameEditor` — no dirty flag and no reseeding
 * effect. This renders only while composing, and both parents close the
 * composer before the write starts, so the lifecycle IS the reset. Do not copy
 * `CardDescription`'s shape here; there is no server value to be clobbered by.
 *
 * Layout is deliberately NOT included. The narrow board wraps this in
 * `KeyboardSticky` + `Panel` because its composer is pinned to the bottom of a
 * non-scrolling screen; the wide board needs neither. That is each board's
 * layout, not the form's.
 */
/** What an add-card form held: given back to a form reopened after a refusal. */
export interface AddCardDraft {
  title: string;
  subscribe: boolean;
  laneId?: string;
}

export function AddCardForm({
  onAdd,
  onCancel,
  canSubscribe,
  lanes,
  initial,
}: {
  /** Called with a trimmed, non-empty title, whether to subscribe to it, and
   *  its lane on a board with lanes. */
  onAdd: (title: string, subscribe: boolean, laneId?: string) => void;
  onCancel: () => void;
  /** Whether the bell is offered: only a member of the board may subscribe. */
  canSubscribe: boolean;
  /** The board's lanes when they are live; absent on a board without them. */
  lanes?: readonly BoardLane[];
  /** What a refused add held, to start from instead of an empty form. */
  initial?: AddCardDraft;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  // Unmount-scoped like the draft, so every new composer starts subscribed.
  const [subscribe, setSubscribe] = useState(initial?.subscribe ?? true);
  // None chosen to start, and nothing remembered between cards (Faisal,
  // 2026-11-15): a lane picked for you is a card filed in the wrong place.
  // A lane given back is kept only while the board still has it.
  const [laneId, setLaneId] = useState(
    initial?.laneId && lanes?.some((l) => l.id === initial.laneId) ? initial.laneId : '',
  );
  const [needsLane, setNeedsLane] = useState(false);

  // One path for both the Add button and the keyboard's submit, so they cannot
  // drift. An empty title is a no-op rather than a disabled button, which is
  // what both boards did before this was extracted.
  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (lanes && !laneId) {
      setNeedsLane(true);
      return;
    }
    onAdd(trimmed, canSubscribe && subscribe, lanes ? laneId : undefined);
  }

  return (
    <>
      <TextField
        value={title}
        onChangeText={setTitle}
        placeholder="Card title"
        autoFocus
        maxLength={CARD_TITLE_MAX}
        onSubmit={submit}
      />
      {lanes ? (
        <>
          <Select
            label="Lane"
            value={laneId}
            options={[
              { value: '', label: 'Choose a lane' },
              ...lanes.map((l) => ({ value: l.id, label: l.name })),
            ]}
            onChange={(id) => {
              setLaneId(id);
              if (id) setNeedsLane(false);
            }}
          />
          {needsLane ? <Hint>Choose a lane for the card first.</Hint> : null}
        </>
      ) : null}
      <Row>
        <Button label="Add" onPress={submit} />
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
        {canSubscribe ? (
          <NewCardBell on={subscribe} onToggle={() => setSubscribe((on) => !on)} />
        ) : null}
      </Row>
    </>
  );
}
