import { zipSync } from 'fflate';
import * as Sharing from 'expo-sharing';
import { base64ToBytes, bytesToBase64, utf8Encode } from './base64';

let FS: any;
try {
  FS = require('expo-file-system/legacy');
} catch {
  FS = require('expo-file-system');
}

export async function shareProjectZip(
  name: string,
  files: { path: string; content: string; encoding: 'utf-8' | 'base64' }[]
): Promise<string> {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    if (file.encoding === 'base64') entries[file.path] = base64ToBytes(file.content);
    else entries[file.path] = utf8Encode(file.content);
  }
  const zipped = zipSync(entries, { level: 6 });
  const target = `${FS.cacheDirectory || FS.documentDirectory}${name.replace(/[^a-z0-9-_]/gi, '-')}.zip`;
  await FS.writeAsStringAsync(target, bytesToBase64(zipped), { encoding: 'base64' });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(target, { mimeType: 'application/zip', dialogTitle: 'Save project ZIP' });
  }
  return target;
}

/** Downloads an authenticated APK/artifact URL straight into app storage. */
export async function downloadAuthenticated(
  url: string,
  filename: string,
  token: string,
  onProgress?: (written: number, total: number) => void
): Promise<string> {
  const target = `${FS.cacheDirectory || FS.documentDirectory}${filename}`;
  const res = await FS.downloadAsync(url, target, {
    headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/vnd.github+json' },
  });
  if (res.status && res.status >= 400) throw new Error(`Download failed (${res.status}).`);
  onProgress?.(1, 1);
  return res.uri || target;
}