import * as fs from 'fs';
import * as path from 'path';

/**
 * Write a file via a temp sibling + rename so a crash mid-write can never
 * leave a truncated/corrupt file behind (rename is atomic on one filesystem).
 */
export function writeFileAtomic(filePath: string, data: string | Buffer): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}
