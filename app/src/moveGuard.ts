import { moveRefusal } from './cards';
import { noticeAction } from './confirm';
import { captureError } from './sentry';
import type { Untimed } from './slowWrites';

/**
 * Ask before a move or a restore on a board with lanes (`moveRefusal`), and
 * when it is refused, say why in a notice that cannot be missed wherever the
 * person is on a long screen (Faisal, 2026-11-18: "it should pop up"). True
 * when the move may go ahead. Every move and restore path calls this, so all
 * refuse alike.
 */
export async function allowMove(
  params: Parameters<typeof moveRefusal>[0],
  title = 'Not moved',
  /**
   * From `run`, when called inside it: the notice waits on a person reading
   * it, which is not a slow write, so it is left out of the timing. The
   * parent's read stays timed.
   */
  untimed?: Untimed,
): Promise<boolean> {
  let refused: string | null;
  try {
    refused = await moveRefusal(params);
  } catch (e) {
    // The check must never strand a move: a failure is reported and the
    // move goes ahead, as it did before the rule (Rules cannot see subtasks
    // either way).
    captureError(e, { source: 'moveRefusal' });
    return true;
  }
  if (!refused) return true;
  await (untimed ? untimed(() => noticeAction(title, refused)) : noticeAction(title, refused));
  return false;
}
