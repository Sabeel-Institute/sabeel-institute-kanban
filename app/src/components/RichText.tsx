/**
 * Renders a stored description or comment, on every surface.
 *
 * All parsing lives in `@sabeel/shared`, tested there with a seeded round-trip
 * fuzz. This shell is what makes the surfaces agree: it parses once, here, and
 * both `RichDocView` leaves draw that same document, so a phone and a browser
 * cannot disagree about what a card says. They differ only in how the document
 * reaches the screen, and only because Android cannot select across text views.
 */
import { parseRichForDisplay } from '@sabeel/shared';
import { RichDocView } from './RichDocView';

export function RichText({ markdown }: { markdown: string }) {
  return <RichDocView doc={parseRichForDisplay(markdown)} />;
}
