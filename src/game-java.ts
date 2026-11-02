import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export async function gameJavaExecutable(java: string, platform = process.platform) {
  if (
    platform !== 'win32' ||
    !path.isAbsolute(java) ||
    path.basename(java).toLowerCase() !== 'java.exe'
  )
    return java;
  const javaw = path.join(path.dirname(java), 'javaw.exe');
  return await fs.stat(javaw).then(
    (stat) => (stat.isFile() ? javaw : java),
    () => java,
  );
}
