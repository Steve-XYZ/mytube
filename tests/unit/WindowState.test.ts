import { describe, it, expect } from 'vitest';
import { sanitizeWindowState, type DisplayArea } from '../../src/main/window/WindowState';

const MIN_W = 800;
const MIN_H = 600;
const DEFAULTS = { width: 1280, height: 800 };
const MAIN_DISPLAY: DisplayArea = { x: 0, y: 25, width: 1920, height: 1055 };

describe('sanitizeWindowState', () => {
  it('returns defaults for missing or malformed state', () => {
    for (const input of [null, undefined, 'garbage', 42, {}, { width: 'wide' }]) {
      const state = sanitizeWindowState(input, [MAIN_DISPLAY], MIN_W, MIN_H, DEFAULTS);
      expect(state).toEqual({ width: DEFAULTS.width, height: DEFAULTS.height, isMaximized: false });
    }
  });

  it('clamps sizes below the window minimum', () => {
    const state = sanitizeWindowState({ width: 200, height: 100 }, [MAIN_DISPLAY], MIN_W, MIN_H, DEFAULTS);
    expect(state.width).toBe(MIN_W);
    expect(state.height).toBe(MIN_H);
  });

  it('keeps a position that lands on a display', () => {
    const state = sanitizeWindowState(
      { x: 100, y: 100, width: 900, height: 700 },
      [MAIN_DISPLAY],
      MIN_W,
      MIN_H,
      DEFAULTS,
    );
    expect(state).toEqual({ x: 100, y: 100, width: 900, height: 700, isMaximized: false });
  });

  it('drops a position that is fully off-screen (e.g. unplugged monitor)', () => {
    const state = sanitizeWindowState(
      { x: -5000, y: -5000, width: 900, height: 700 },
      [MAIN_DISPLAY],
      MIN_W,
      MIN_H,
      DEFAULTS,
    );
    expect(state.x).toBeUndefined();
    expect(state.y).toBeUndefined();
    expect(state.width).toBe(900);
  });

  it('accepts a position on a secondary display', () => {
    const secondary: DisplayArea = { x: 1920, y: 0, width: 1920, height: 1080 };
    const state = sanitizeWindowState(
      { x: 2000, y: 50, width: 900, height: 700 },
      [MAIN_DISPLAY, secondary],
      MIN_W,
      MIN_H,
      DEFAULTS,
    );
    expect(state.x).toBe(2000);
    expect(state.y).toBe(50);
  });

  it('drops the position when only x or only y is present', () => {
    const state = sanitizeWindowState({ x: 100, width: 900, height: 700 }, [MAIN_DISPLAY], MIN_W, MIN_H, DEFAULTS);
    expect(state.x).toBeUndefined();
  });

  it('preserves the maximized flag', () => {
    const state = sanitizeWindowState(
      { width: 900, height: 700, isMaximized: true },
      [MAIN_DISPLAY],
      MIN_W,
      MIN_H,
      DEFAULTS,
    );
    expect(state.isMaximized).toBe(true);
  });
});
