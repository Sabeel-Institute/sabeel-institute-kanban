import { describe, expect, it } from 'vitest';
import { HELP_FILMS_ORIGIN, HELP_VARIANTS, HELP_VIDEOS, helpFilmFile, helpFilmUrl } from '../src';

describe('the help films', () => {
  it('are named once each', () => {
    const ids = HELP_VIDEOS.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The id is a file name on the films' site and in the recorder's folder: a
  // space or a slash would put the film somewhere the app never looks.
  it('have ids that are plain file names', () => {
    for (const v of HELP_VIDEOS) expect(v.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('cover everyone, board owners and admins', () => {
    expect(new Set(HELP_VIDEOS.map((v) => v.audience))).toEqual(new Set(['everyone', 'owner', 'admin']));
  });

  it('are played from the films’ own site, one file per cut and kind', () => {
    expect(helpFilmFile('board', 'phone', 'video')).toBe('board-phone.mp4');
    expect(helpFilmFile('board', 'computer', 'captions')).toBe('board-computer.vtt');
    expect(helpFilmUrl('board', 'phone', 'video')).toBe(`${HELP_FILMS_ORIGIN}/board-phone.mp4`);
    expect(HELP_FILMS_ORIGIN).toMatch(/^https:\/\/[^/]+$/);
    expect(HELP_VARIANTS).toEqual(['phone', 'computer']);
  });
});
