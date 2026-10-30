import * as DocumentPicker from 'expo-document-picker';
import { unzipSync } from 'fflate';
import { base64ToBytes, bytesToBase64, utf8Decode } from './base64';

/**
 * expo-file-system moved its API in SDK 54; the legacy module still exposes the
 * readAsStringAsync/downloadAsync helpers this app needs, so prefer it when present.
 */
let FS: any;
try {
  FS = require('expo-file-system/legacy');
} catch {
  FS = require('expo-file-system');
}

export type ZipFile = { path: string; content: string; encoding: 'utf-8' | 'base64'; size: number };

export type ExtractResult = {
  files: ZipFile[];
  skipped: { path: string; reason: string }[];
  totalBytes: number;
};

const MAX_FILES = 700;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'ttf', 'otf', 'woff', 'woff2',
  'mp3', 'mp4', 'wav', 'zip', 'jar', 'aar', 'so', 'keystore', 'jks', 'pdf', 'apk',
]);

const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\.git\/)/i;

export async function pickZipArchive(): Promise<{ name: string; uri: string; size: number } | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/zip', 'application/x-zip-compressed', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const name = asset.name || 'archive.zip';
  if (!/\.zip$/i.test(name)) throw new Error('That file is not a ZIP archive.');
  return { name, uri: asset.uri, size: asset.size || 0 };
}

/** Rejects absolute paths and traversal segments so extraction cannot escape the workspace. */
function safePath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = normalized.split('/').filter((p) => p && p !== '.');
  if (!parts.length) return null;
  if (parts.some((p) => p === '..' || p === '')) return null;
  if (normalized.startsWith('/')) return null;
  return parts.join('/');
}

/** Strips a single shared top-level folder, e.g. `my-app/` from an exported project ZIP. */
function stripWrapper(files: { path: string; bytes: Uint8Array }[]) {
  const tops = new Set(files.map((f) => f.path.split('/')[0]));
  if (tops.size !== 1) return files;
  const only = [...tops][0];
  const nested = files.filter((f) => f.path.includes('/'));
  if (nested.length !== files.length) return files;
  return nested.map((f) => ({ path: f.path.slice(only.length + 1), bytes: f.bytes }));
}

export async function extractZip(uri: string): Promise<ExtractResult> {
  const base64 = await FS.readAsStringAsync(uri, { encoding: 'base64' });
  const bytes = base64ToBytes(base64);

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('The archive is damaged or not a valid ZIP file.');
  }

  const skipped: { path: string; reason: string }[] = [];
  const collected: { path: string; bytes: Uint8Array }[] = [];

  for (const [rawPath, data] of Object.entries(entries)) {
    if (rawPath.endsWith('/')) continue;
    if (IGNORED.test(rawPath)) continue;
    const path = safePath(rawPath);
    if (!path) {
      skipped.push({ path: rawPath, reason: 'Unsafe path' });
      continue;
    }
    if (data.length > MAX_FILE_BYTES) {
      skipped.push({ path, reason: 'Larger than 2 MB' });
      continue;
    }
    collected.push({ path, bytes: data });
  }

  const normalized = stripWrapper(collected);
  if (normalized.length > MAX_FILES) {
    throw new Error(`Archive has ${normalized.length} files; the limit is ${MAX_FILES}.`);
  }
  if (!normalized.length) throw new Error('The archive contains no usable files.');

  const files: ZipFile[] = normalized.map(({ path, bytes: data }) => {
    const ext = (path.split('.').pop() || '').toLowerCase();
    if (BINARY_EXT.has(ext)) {
      return { path, content: bytesToBase64(data), encoding: 'base64' as const, size: data.length };
    }
    return { path, content: utf8Decode(data), encoding: 'utf-8' as const, size: data.length };
  });

  return {
    files,
    skipped,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}