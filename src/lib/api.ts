export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, message: string, body?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type ReqOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  raw?: boolean;
  timeout?: number;
  retries?: number;
};

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFrom(body: any, status: number): string {
  if (typeof body === 'string' && body.trim()) return body.slice(0, 300);
  if (body && typeof body === 'object') {
    const m = body.message || body.error?.message || body.error || body.detail;
    if (typeof m === 'string' && m.trim()) return m;
    if (Array.isArray(body.errors) && body.errors[0]?.message) return body.errors[0].message;
  }
  if (status === 401) return 'Unauthorized — check your token.';
  if (status === 403) return 'Forbidden — the token lacks the required scope.';
  if (status === 404) return 'Not found.';
  if (status === 429) return 'Rate limited — try again shortly.';
  return `Request failed (${status}).`;
}

/**
 * Fetch wrapper used by every API module: timeout, JSON handling, bounded
 * retries with exponential backoff on network and 5xx failures only.
 */
export async function request<T = any>(url: string, options: ReqOptions = {}): Promise<T> {
  const { method = 'GET', headers = {}, body, raw = false, timeout = 30000, retries = 2 } = options;

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await res.text();
      const data = raw ? text : text ? parseJson(text) : null;

      if (res.ok) return data as T;

      const err = new ApiError(res.status, messageFrom(data, res.status), data);
      if (res.status >= 500 && attempt < retries) {
        await sleep(600 * Math.pow(2, attempt));
        continue;
      }
      throw err;
    } catch (e: any) {
      clearTimeout(timer);
      if (e instanceof ApiError) throw e;
      if (attempt < retries) {
        await sleep(700 * Math.pow(2, attempt));
        continue;
      }
      throw new ApiError(0, e?.message === 'Aborted' ? 'Request timed out.' : 'Network request failed.', null);
    }
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GitHub-specific request: bearer auth, pagination helper, rate-limit surface. */
export const GH_API = 'https://api.github.com';

export function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token.trim()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function gh<T = any>(path: string, token: string, options: ReqOptions = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${GH_API}${path}`;
  return request<T>(url, { ...options, headers: { ...ghHeaders(token), ...(options.headers || {}) } });
}