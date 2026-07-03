import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeFileAtomic } from '../../src/main/utils/fsAtomic';

describe('writeFileAtomic', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-atomic-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes new files and creates missing parent directories', () => {
    const target = path.join(dir, 'nested', 'state.json');
    writeFileAtomic(target, '{"a":1}');
    expect(fs.readFileSync(target, 'utf-8')).toBe('{"a":1}');
  });

  it('replaces existing content completely', () => {
    const target = path.join(dir, 'state.json');
    writeFileAtomic(target, 'first version with a longer body');
    writeFileAtomic(target, 'second');
    expect(fs.readFileSync(target, 'utf-8')).toBe('second');
  });

  it('leaves no temp files behind', () => {
    const target = path.join(dir, 'state.json');
    writeFileAtomic(target, 'content');
    expect(fs.readdirSync(dir)).toEqual(['state.json']);
  });

  it('cleans up the temp file when the write fails', () => {
    const target = path.join(dir, 'blocked', 'state.json');
    // Make the rename fail: the destination "directory" is a plain file.
    fs.writeFileSync(path.join(dir, 'blocked'), 'not a directory');
    expect(() => writeFileAtomic(target, 'content')).toThrow();
    expect(fs.readdirSync(dir)).toEqual(['blocked']);
  });
});
