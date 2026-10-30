import { request } from './api';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';

export type FileFix = { path: string; explanation: string; replacement: string };

export type Diagnosis = {
  rootCause: string;
  category: 'dependency' | 'sdk' | 'gradle' | 'compile' | 'config' | 'unknown';
  affectedFiles: string[];
  explanation: string;
  fixes: FileFix[];
  rebuildRecommended: boolean;
};

export async function validateKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    await request(`${BASE}/models?key=${encodeURIComponent(apiKey)}`, { timeout: 15000, retries: 0 });
    return { ok: true, message: 'Gemini key validated.' };
  } catch (e: any) {
    return { ok: false, message: e?.status === 400 ? 'Invalid API key.' : e?.message || 'Validation failed.' };
  }
}

function extractText(payload: any): string {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p: any) => (typeof p.text === 'string' ? p.text : '')).join('').trim();
}

function parseDiagnosis(text: string): Diagnosis {
  const cleaned = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Gemini did not return structured output.');
  const raw = JSON.parse(cleaned.slice(start, end + 1));
  const fixes: FileFix[] = Array.isArray(raw.fixes)
    ? raw.fixes
        .filter((f: any) => f && typeof f.path === 'string' && typeof f.replacement === 'string')
        .map((f: any) => ({
          path: f.path,
          explanation: String(f.explanation || ''),
          replacement: f.replacement,
        }))
    : [];
  return {
    rootCause: String(raw.rootCause || 'No root cause reported.'),
    category: raw.category || 'unknown',
    affectedFiles: Array.isArray(raw.affectedFiles) ? raw.affectedFiles.map(String) : fixes.map((f) => f.path),
    explanation: String(raw.explanation || ''),
    fixes,
    rebuildRecommended: raw.rebuildRecommended !== false,
  };
}

/**
 * Sends the failing job log plus the current content of the files it mentions to
 * Gemini and asks for a bounded, structured patch proposal. Nothing is applied here.
 */
export async function analyzeBuildFailure(input: {
  apiKey: string;
  repo: string;
  branch: string;
  runUrl: string;
  log: string;
  files: { path: string; content: string }[];
}): Promise<Diagnosis> {
  const fileBlock = input.files
    .map((f) => `--- FILE: ${f.path} ---\n${f.content.slice(0, 12000)}`)
    .join('\n\n');

  const prompt = `You are a senior Android/React Native build engineer.
A GitHub Actions build failed. Analyse the log, find the root cause, and propose the smallest fix.

Repository: ${input.repo}
Branch: ${input.branch}
Run: ${input.runUrl}

Rules:
- Return only files listed under FILES. Never invent file paths.
- A fix must contain the COMPLETE replacement file content, not a diff.
- Do not propose build.gradle changes that expose secrets or disable signing.
- If the log is inconclusive, set rebuildRecommended to false and explain what is missing.

Answer with JSON only:
{
  "rootCause": "one sentence",
  "category": "dependency|sdk|gradle|compile|config|unknown",
  "affectedFiles": ["path"],
  "explanation": "2-4 sentences a developer can act on",
  "fixes": [{ "path": "path", "explanation": "why", "replacement": "full file content" }],
  "rebuildRecommended": true
}

=== FILES ===
${fileBlock || '(no files supplied)'}

=== BUILD LOG (tail) ===
${input.log.slice(-24000)}`;

  const payload = await request<any>(`${BASE}/models/${MODEL}:generateContent?key=${encodeURIComponent(input.apiKey)}`, {
    method: 'POST',
    timeout: 60000,
    retries: 1,
    body: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    },
  });

  const text = extractText(payload);
  if (!text) throw new Error('Gemini returned an empty response.');
  return parseDiagnosis(text);
}

/** Suggests package versions to add to package.json when a dependency is missing. */
export async function suggestDependencies(apiKey: string, log: string): Promise<string[]> {
  const payload = await request<any>(`${BASE}/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    timeout: 45000,
    retries: 1,
    body: {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `From this build log, list the missing npm packages that should be installed. JSON only: {"packages":["name@version"]}. Empty array if none.\n\n${log.slice(-12000)}`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    },
  });
  const text = extractText(payload);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.packages) ? parsed.packages.map(String) : [];
  } catch {
    return [];
  }
}