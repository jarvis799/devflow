import { gh, GH_API, request } from './api';
import { base64ToBytes, utf8Decode } from './base64';

export type GhUser = { login: string; name: string | null; avatar_url: string };

export type Repo = {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  description: string | null;
  html_url: string;
};

export type RepoFile = { path: string; content: string; encoding?: 'utf-8' | 'base64' };

export type WorkflowRun = {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | null;
  head_branch: string;
  head_sha: string;
  created_at: string;
  updated_at: string;
  event: string;
  html_url: string;
  run_started_at?: string;
};

export type Job = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps: { name: string; status: string; conclusion: string | null; number: number }[];
};

export type Artifact = { id: number; name: string; size_in_bytes: number; expired: boolean; created_at: string };

export async function getUser(token: string): Promise<GhUser> {
  return gh<GhUser>('/user', token);
}

export async function listRepos(token: string, page = 1, perPage = 30): Promise<Repo[]> {
  const me = await getUser(token);
  const params = `?per_page=${perPage}&page=${page}&sort=updated`;
  const repos = await gh<Repo[]>(`/user/repos${params}`, token);
  // /user/repos includes org repos the token can see; keep them, they are writable
  // only if the token allows it, which the create/push calls surface as 403.
  return repos.sort((a, b) => a.full_name.localeCompare(b.full_name) && Number(a.owner.login !== me.login) - Number(b.owner.login !== me.login));
}

export async function createRepo(
  token: string,
  input: { name: string; description?: string; private?: boolean }
): Promise<Repo> {
  return gh<Repo>('/user/repos', token, {
    method: 'POST',
    body: {
      name: input.name,
      description: input.description || 'DevFlow project',
      private: !!input.private,
      auto_init: false,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    },
  });
}

export async function repoExists(token: string, fullName: string): Promise<boolean> {
  const me = await getUser(token);
  try {
    await gh(`/repos/${fullName}`, token);
    return true;
  } catch {
    return false;
  }
}

export async function getDefaultBranch(token: string, fullName: string): Promise<string> {
  const repo = await gh<Repo>(`/repos/${fullName}`, token);
  return repo.default_branch || 'main';
}

async function branchSha(token: string, fullName: string, branch: string): Promise<string | null> {
  try {
    const ref = await gh<{ object: { sha: string } }>(
      `/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`,
      token
    );
    return ref.object.sha;
  } catch (e: any) {
    if (e?.status === 404 || e?.status === 409) return null;
    throw e;
  }
}

/**
 * Pushes text files as one commit using the Git Trees API, preserving the
 * directory structure. Existing repository content is kept: the new tree is
 * built on top of `base_tree`, so nothing else is deleted.
 */
export async function pushFiles(
  token: string,
  fullName: string,
  branch: string,
  files: RepoFile[],
  message: string,
  onProgress?: (done: number, total: number, path: string) => void
): Promise<{ sha: string; url: string; files: number }> {
  const base = await branchSha(token, fullName, branch);
  const tree: any[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i, files.length, file.path);
    const blob = await gh<{ sha: string }>(`/repos/${fullName}/git/blobs`, token, {
      method: 'POST',
      body: { content: file.content, encoding: file.encoding || 'utf-8' },
    });
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  onProgress?.(files.length, files.length, 'done');

  const newTree = await gh<{ sha: string }>(`/repos/${fullName}/git/trees`, token, {
    method: 'POST',
    body: base ? { tree, base_tree: base } : { tree },
  });

  const commit = await gh<{ sha: string; html_url: string }>(`/repos/${fullName}/git/commits`, token, {
    method: 'POST',
    body: { message, tree: newTree.sha, parents: base ? [base] : [] },
  });

  if (base) {
    await gh(`/repos/${fullName}/git/refs/heads/${encodeURIComponent(branch)}`, token, {
      method: 'PATCH',
      body: { sha: commit.sha, force: false },
    });
  } else {
    await gh(`/repos/${fullName}/git/refs`, token, {
      method: 'POST',
      body: { ref: `refs/heads/${branch}`, sha: commit.sha },
    });
  }

  return { sha: commit.sha, url: commit.html_url, files: files.length };
}

export async function getFileContent(token: string, fullName: string, path: string, ref?: string) {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const data = await gh<{ content: string; encoding: string; sha: string }>(
    `/repos/${fullName}/contents/${path.split('/').map(encodeURIComponent).join('/')}${q}`,
    token
  );
  return { content: data.content.replace(/\n/g, ''), sha: data.sha };
}

export async function listRootFiles(token: string, fullName: string, branch?: string): Promise<string[]> {
  const q = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const items = await gh<{ path: string; type: string }[]>(`/repos/${fullName}/contents/${q}`, token);
  return items.map((i) => i.path);
}

export async function listWorkflows(token: string, fullName: string) {
  const data = await gh<{ workflows: { id: number; name: string; path: string; state: string }[] }>(
    `/repos/${fullName}/actions/workflows`,
    token
  );
  return data.workflows || [];
}

export async function listRuns(token: string, fullName: string, branch?: string): Promise<WorkflowRun[]> {
  const q = branch ? `?branch=${encodeURIComponent(branch)}&per_page=20` : '?per_page=20';
  const data = await gh<{ workflow_runs: WorkflowRun[] }>(`/repos/${fullName}/actions/runs${q}`, token);
  return data.workflow_runs || [];
}

export async function getRun(token: string, fullName: string, runId: number): Promise<WorkflowRun> {
  return gh<WorkflowRun>(`/repos/${fullName}/actions/runs/${runId}`, token);
}

export async function listJobs(token: string, fullName: string, runId: number): Promise<Job[]> {
  const data = await gh<{ jobs: Job[] }>(`/repos/${fullName}/actions/runs/${runId}/jobs`, token);
  return data.jobs || [];
}

export async function getJobLogs(token: string, fullName: string, jobId: number): Promise<string> {
  return request<string>(`${GH_API}/repos/${fullName}/actions/jobs/${jobId}/logs`, {
    raw: true,
    headers: { Authorization: `Bearer ${token.trim()}`, Accept: 'application/vnd.github+json' },
    timeout: 45000,
  });
}

export async function listArtifacts(token: string, fullName: string, runId?: number): Promise<Artifact[]> {
  const path = runId
    ? `/repos/${fullName}/actions/runs/${runId}/artifacts`
    : `/repos/${fullName}/actions/artifacts?per_page=20`;
  const data = await gh<{ artifacts: Artifact[] }>(path, token);
  return data.artifacts || [];
}

export function artifactDownloadUrl(fullName: string, artifactId: number) {
  return `${GH_API}/repos/${fullName}/actions/artifacts/${artifactId}/zip`;
}

export async function createRelease(
  token: string,
  fullName: string,
  input: { tag_name: string; name?: string; body?: string }
) {
  return gh(`/repos/${fullName}/releases`, token, {
    method: 'POST',
    body: { tag_name: input.tag_name, name: input.name || input.tag_name, body: input.body || '' },
  });
}

export async function dispatchWorkflow(token: string, fullName: string, workflowId: string, ref: string) {
  return gh(`/repos/${fullName}/actions/workflows/${workflowId}/dispatches`, token, {
    method: 'POST',
    body: { ref },
  });
}

export async function listBranches(token: string, fullName: string): Promise<string[]> {
  const branches = await gh<{ name: string }[]>(`/repos/${fullName}/branches?per_page=50`, token);
  return branches.map((b) => b.name);
}

export async function listTree(
  token: string,
  fullName: string,
  branch: string
): Promise<{ path: string; type: string }[]> {
  const data = await gh<{ tree: { path: string; type: string }[]; truncated: boolean }>(
    `/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token
  );
  return (data.tree || []).filter((entry) => entry.type === 'blob');
}

/** Raw text of a repository file, used to feed build context to Gemini. */
export async function readTextFile(
  token: string,
  fullName: string,
  path: string,
  branch: string
): Promise<string | null> {
  try {
    const file = await getFileContent(token, fullName, path, branch);
    const decoded = utf8Decode(base64ToBytes(file.content));
    if (decoded.includes('\u0000')) return null;
    return decoded;
  } catch {
    return null;
  }
}