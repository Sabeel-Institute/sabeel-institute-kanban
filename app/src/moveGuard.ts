import { moveRefusal } from './cards';
import { noticeAction } from './confirm';

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
): Promise<boolean> {
  const refused = await moveRefusal(params);
  if (!refused) return true;
  await noticeAction(title, refused);
  return false;
}
