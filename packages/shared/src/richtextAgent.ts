/**
 * Rich text an agent sends, made into what the app stores.
 *
 * The app's editors only ever write the five elements (`richtext.ts`), in one
 * canonical form. An agent writes markdown as it learned it: headings, `__`
 * bold, `_` italic, checkboxes, code, quotes. Stored as given, each of those
 * reads on a card as stray characters, and the next edit in the app's editor
 * keeps the characters and loses the intent. So everything an agent writes
 * into a description, a comment or a board's notes comes through here: what
 * the vocabulary has a near equivalent for is converted, the rest is kept as
 * its words, and the result is the canonical form the editors write.
 *
 * What it converts, and nothing else:
 *   `# Heading` (any level)  -> a bold line
 *   `__bold__`               -> bold
 *   `_italic_` between words -> italic (never inside a word: snake_case stays)
 *   `- [ ] task`, `- [x]`    -> a plain bullet
 *   `> quote`                -> the quoted line
 *   `---`, `***`, `___`      -> a paragraph break
 *   `~~struck~~`, `` `code` `` -> the words alone
 *   ```fences```             -> the lines inside, the fence lines dropped
 *   `![alt](url)`            -> a link with the alt text
 *   `<https://…>`            -> the bare address (shown as a link)
 *   `[words](url "title")`   -> the link without its title
 */
import { normalizeMarkdown } from './richtext';

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const CHECKBOX = /^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]\s+/;

/**
 * Web addresses, which the rules below must not reach into: `/_drafts_/` is a
 * path. Held out behind private-use characters, which no text an agent means
 * to store contains.
 */
const ADDRESS = /(?:https?|mailto):[^\s<>()]+/g;

function inline(line: string): string {
  const kept: string[] = [];
  const held = line.replace(ADDRESS, (url) => `\uE000${kept.push(url) - 1}\uE001`);
  return emphasis(held).replace(/\uE000(\d+)\uE001/g, (_m, i: string) => kept[Number(i)]);
}

function emphasis(line: string): string {
  return (
    line
      // Images first, so the link rule below does not see `[alt](url)` twice.
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string, url: string) =>
        alt.trim() ? `[${alt}](${url})` : url,
      )
      .replace(/\[([^\]]+)\]\(([^)\s]+)\s+"[^"]*"\)/g, '[$1]($2)')
      .replace(/<(\uE000\d+\uE001)>/g, '$1')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/__(?=\S)(.+?)(?<=\S)__/g, '**$1**')
      // Only between word boundaries, so `snake_case_name` and `_id` stay as
      // they are.
      .replace(/(^|[^\w*])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1*$2*')
  );
}

/**
 * An agent's markdown, as the app's editors would have stored it.
 *
 * `stored` is the text the agent is editing: the notes or the description as
 * read, or the comment being edited. A line the agent hands back exactly as it
 * stands there is a person's, already in the app's form, and passes through
 * untouched: the app does not escape `#`, `>`, backticks, `~~` or `_`, so a
 * colleague's "# of guests: 40" or "Door code `4471`" would otherwise be
 * rewritten the moment an agent saved the page around it. Only lines the
 * agent wrote are converted.
 */
export function fromAgentMarkdown(markdown: string, stored = ''): string {
  const kept = new Set(stored ? stored.split('\n') : []);
  const out: string[] = [];
  let fenced = false;
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (kept.has(raw)) {
      out.push(raw);
      continue;
    }
    if (FENCE.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      out.push(raw);
      continue;
    }
    let line = raw.replace(QUOTE, '');
    if (RULE.test(line)) {
      out.push('');
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      const words = inline(heading[1]).replace(/^\*\*(.*)\*\*$/, '$1').trim();
      // A heading is its own paragraph's first line, so what follows it
      // stays beside it, as under a heading.
      if (words) out.push(`**${words}**`);
      continue;
    }
    line = line.replace(CHECKBOX, '$1');
    out.push(inline(line));
  }
  return normalizeMarkdown(out.join('\n'));
}
