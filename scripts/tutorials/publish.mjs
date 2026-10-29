/**
 * PUBLISH THE HELP FILMS to their own Hosting site (`HELP_FILMS_ORIGIN`):
 * every film's MP4 and captions, both cuts, in one deploy.
 *
 *   node scripts/tutorials/publish.mjs --from <dir of films>
 *
 * Through the Firebase CLI, signed in with deploy rights on the project. A
 * Hosting deploy replaces the whole site, so it takes the WHOLE set or
 * nothing: it checks every film `HELP_VIDEOS` names is there, both cuts and
 * their captions, before it sends any of it. The site is a separate one from
 * the app's, so Deploy Web, which rebuilds the app's site from git, never
 * touches the films; and the films, which are not in git, never ride along
 * with the app.
 *
 * The site answers every origin (`Access-Control-Allow-Origin: *`): the
 * website's `<video>` loads its caption track under CORS. After the deploy it
 * fetches each file back and compares its size, so a film that did not land
 * fails here rather than on someone's phone.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HELP_FILMS_ORIGIN, HELP_VARIANTS, HELP_VIDEOS, helpFilmFile } from '@sabeel/shared';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.from) {
  console.error('usage: publish.mjs --from <dir of films>');
  process.exit(2);
}
const FROM = resolve(args.from);
const PROJECT = JSON.parse(readFileSync(new URL('../../.firebaserc', import.meta.url), 'utf8')).projects?.default;
const SITE = new URL(HELP_FILMS_ORIGIN).hostname.replace(/\.web\.app$/, '');
if (!PROJECT || !SITE) {
  console.error('no default project in .firebaserc, or HELP_FILMS_ORIGIN is not a web.app site');
  process.exit(1);
}

const files = HELP_VIDEOS.flatMap((v) =>
  HELP_VARIANTS.flatMap((variant) => (['video', 'captions']).map((kind) => helpFilmFile(v.id, variant, kind))),
);
const absent = files.filter((f) => !existsSync(join(FROM, f)));
if (absent.length) {
  console.error(`not there, so nothing sent:\n  ${absent.join('\n  ')}`);
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), 'help-films-'));
try {
  mkdirSync(join(stage, 'public'));
  for (const f of files) cpSync(join(FROM, f), join(stage, 'public', f));
  writeFileSync(
    join(stage, 'firebase.json'),
    JSON.stringify(
      {
        hosting: {
          site: SITE,
          public: 'public',
          headers: [
            {
              source: '**/*.@(mp4|vtt)',
              headers: [
                { key: 'Access-Control-Allow-Origin', value: '*' },
                { key: 'Cache-Control', value: 'public, max-age=3600' },
              ],
            },
            { source: '**/*.vtt', headers: [{ key: 'Content-Type', value: 'text/vtt; charset=utf-8' }] },
          ],
        },
      },
      null,
      2,
    ),
  );
  execFileSync('firebase', ['deploy', '--only', 'hosting', '--project', PROJECT, '--config', 'firebase.json', '--non-interactive'], {
    cwd: stage,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
} finally {
  rmSync(stage, { recursive: true, force: true });
}

let wrong = 0;
for (const f of files) {
  // Uncompressed, or a caption file's length is its gzipped one.
  const r = await fetch(`${HELP_FILMS_ORIGIN}/${f}`, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
  const size = Number(r.headers.get('content-length'));
  if (!r.ok || size !== statSync(join(FROM, f)).size) {
    wrong += 1;
    console.error(`  ${f}: ${r.status}, ${size} bytes served, ${statSync(join(FROM, f)).size} sent`);
  }
}
if (wrong) {
  console.error(`${wrong} of ${files.length} file(s) are not what was sent`);
  process.exit(1);
}
console.log(`${files.length} file(s) live on ${HELP_FILMS_ORIGIN}`);
