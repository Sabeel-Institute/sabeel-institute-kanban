import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Firestore } from 'firebase/firestore';
import { z } from 'zod';
import { fromAgentMarkdown, type BoardDoc, type Role, type UserStatus } from '@sabeel/shared';

export type WriteBoard = Partial<Omit<BoardDoc, 'memberProfiles'>> & Pick<BoardDoc, 'name' | 'columns'> & {
  id: string;
  memberProfiles?: Record<string, { displayName?: string; email?: string }>;
};

export interface McpActor {
  uid: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
}

export interface WriteTools {
  server: McpServer;
  me: McpActor;
  board: (fs: Firestore, name: string) => Promise<WriteBoard>;
  run: (fn: (fs: Firestore) => Promise<ToolResult>) => Promise<ToolResult>;
}

export const appUrl = 'https://sabeel-institute-kanban.web.app';
export const boardLink = (id: string) => `${appUrl}/b/${id}`;
export const cardLink = (id: string) => `${appUrl}/c/${id}`;

export const writeResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  isError: false,
});
type WriteResult = ReturnType<typeof writeResult>;
export type ToolResult = Omit<WriteResult, 'isError'> & { isError: boolean };

export const word = z.string().trim().min(1);
export const docId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'Use the id returned by Kanban');
export function check(problem: string | null | undefined): void {
  if (problem) throw new Error(problem);
}

/** Prefer an exact id. A name never picks one of several matches. */
export function named<T>(items: readonly T[], input: string, kind: string, id: (item: T) => string, name: (item: T) => string, aliases: (item: T) => string[] = () => []): T {
  const exact = items.find((item) => id(item) === input);
  if (exact) return exact;
  const key = input.trim().toLowerCase();
  const matches = items.filter((item) => [name(item), ...aliases(item)].some((s) => s.toLowerCase() === key));
  if (matches.length === 1) return matches[0];
  const choices = (matches.length > 1 ? matches : items).slice(0, 15).map((item) => `${name(item)} (${id(item)})`);
  const reason = matches.length > 1 ? `Several ${kind}s match "${input}". Use an id.` : `No ${kind} called "${input}".`;
  throw new Error(`${reason}${choices.length ? ` Choices: ${choices.join(', ')}.` : ''}`);
}

export function itemNamed<T extends { id: string; name: string }>(items: readonly T[], key: string, kind: string): T {
  return named(items, key, kind, (item) => item.id, (item) => item.name);
}

export function ordered<T extends { id: string; name: string }>(items: T[], order: string[] | undefined, kind: string): T[] {
  if (!order) return items;
  const next = order.map((key) => itemNamed(items, key, kind));
  if (next.length !== items.length || new Set(next.map((item) => item.id)).size !== items.length) {
    throw new Error(`Give every ${kind} exactly once in the desired order: ${items.map((item) => item.name).join(', ')}.`);
  }
  return next;
}

/**
 * What a rich text field takes, said once for every tool that writes one: a
 * description, a comment, a board's notes. The app's editors write five
 * elements and nothing else (`richtext.ts`), so an agent is told exactly
 * those, and whatever else it sends goes through `fromAgentMarkdown`.
 */
export const RICH_TEXT_HELP = [
  "Rich text, in the app's markdown: **bold**, *italic*, [words](https://address) for a link,",
  'a line starting "- " for a bullet and "1. " for a numbered item, a blank line between paragraphs.',
  'Nothing else exists: no headings (a bold line serves), tables, code, quotes, images or nested lists.',
  'Headings, __bold__, _italic_ and checkboxes are converted; other markup is kept as plain words.',
  'A bare https:// address shows as a link. Write a literal * [ ] or \\ with a backslash before it.',
].join(' ');

/**
 * Rich text from an agent, as the app stores it, refused past `max` stored
 * characters. `before` is the text being edited, whose lines the agent hands
 * back untouched are kept as they are (`fromAgentMarkdown`).
 */
export function agentRichText(text: string, max: number, what: string, before = ''): string {
  const stored = fromAgentMarkdown(text, before);
  if (stored.length > max) throw new Error(`The ${what} is ${stored.length} characters as stored; the most is ${max}.`);
  return stored;
}
