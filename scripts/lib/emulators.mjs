/**
 * This checkout's emulator project and ports, for `scripts/*.mjs`: read from
 * `ci-tools.json` through ci-tools, which is the one place they are stated.
 *
 * Each Sabeel app owns a block of 100 ports (`emulators.base`), every service
 * at the same offset in every block, so a port in a `ss` or `ps` line names
 * its app and its service at a glance. Scripts state none of them:
 * `npx sabeel-ci check-app` fails one that does. In shell,
 * `npx --no sabeel-ci ports <name>`.
 *
 *   PORTS.firestore, PORTS.auth, PORTS.functions, PORTS.storage   the emulators
 *   PORTS.web                                                     the Expo web dev server
 */
import { config } from '@sabeel-institute/ci-tools/lib/config.mjs';
import { ports } from '@sabeel-institute/ci-tools/lib/ports.mjs';

const SETTINGS = config(new URL('../..', import.meta.url).pathname);

export const PORTS = ports(SETTINGS);

/** The emulators' demo project: a `demo-` id, so nothing can reach a real one. */
export const PROJECT = SETTINGS.emulators.project;
