import { request } from './api';

const API = 'https://api.vercel.com';

function headers(token: string) {
  return { Authorization: `Bearer ${token.trim()}` };
}

export type VercelProject = {
  id: string;
  name: string;
  framework: string | null;
  createdAt: number;
  link?: { type: string; repo: string; org?: string };
};

export type VercelDeployment = {
  id?: string;
  uid: string;
  name: string;
  url: string | null;
  readyState: 'QUEUED' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | 'INITIALIZING';
  target?: string | null;
  createdAt: number;
  errorMessage?: string | null;
  inspectorUrl?: string | null;
};

export async function validateToken(token: string): Promise<{ ok: boolean; message: string; user?: string }> {
  try {
    const me = await request<any>(`${API}/v2/user`, { headers: headers(token), timeout: 15000, retries: 0 });
    return { ok: true, message: 'Vercel token validated.', user: me?.user?.username || me?.user?.email };
  } catch (e: any) {
    return { ok: false, message: e?.status === 403 ? 'Token rejected by Vercel.' : e?.message || 'Validation failed.' };
  }
}

export async function listProjects(token: string): Promise<VercelProject[]> {
  const data = await request<{ projects: VercelProject[] }>(`${API}/v9/projects?limit=50`, {
    headers: headers(token),
  });
  return data.projects || [];
}

export async function createProject(
  token: string,
  input: {
    name: string;
    framework?: string;
    buildCommand?: string;
    outputDirectory?: string;
    repo?: string;
    branch?: string;
  }
): Promise<VercelProject> {
  const body: any = {
    name: input.name,
    framework: input.framework || null,
    buildCommand: input.buildCommand || null,
    outputDirectory: input.outputDirectory || null,
  };
  if (input.repo) {
    body.gitRepository = { type: 'github', repo: input.repo };
  }
  return request<VercelProject>(`${API}/v11/projects`, { method: 'POST', headers: headers(token), body });
}

/**
 * Creates a deployment from the linked GitHub repository. Vercel builds it on
 * their infrastructure — no server of ours is involved.
 */
export async function createGitDeployment(
  token: string,
  input: { name: string; repo: string; ref: string; projectName?: string }
): Promise<VercelDeployment> {
  return request<VercelDeployment>(`${API}/v13/deployments`, {
    method: 'POST',
    headers: headers(token),
    body: {
      name: input.projectName || input.name,
      project: input.projectName || input.name,
      target: 'production',
      gitSource: { type: 'github', repo: input.repo, ref: input.ref },
    },
  });
}

export async function getDeployment(token: string, id: string): Promise<VercelDeployment> {
  const data = await request<any>(`${API}/v13/deployments/${id}`, { headers: headers(token) });
  return {
    uid: data.uid || data.id,
    id: data.id,
    name: data.name,
    url: data.url || null,
    readyState: data.readyState || data.ready,
    target: data.target,
    createdAt: data.createdAt,
    errorMessage: data.errorMessage || null,
    inspectorUrl: data.inspectorUrl || null,
  };
}

export async function listDeployments(token: string, projectId?: string): Promise<VercelDeployment[]> {
  const q = projectId ? `?projectId=${projectId}&limit=20` : '?limit=20';
  const data = await request<{ deployments: VercelDeployment[] }>(`${API}/v6/deployments${q}`, {
    headers: headers(token),
  });
  return (data.deployments || []).map((d: any) => ({
    uid: d.uid,
    id: d.uid,
    name: d.name,
    url: d.url || null,
    readyState: d.state || d.readyState,
    target: d.target,
    createdAt: d.createdAt,
    errorMessage: d.errorMessage || null,
    inspectorUrl: d.inspectorUrl || null,
  }));
}

export async function redeploy(token: string, deploymentId: string): Promise<VercelDeployment> {
  return request<VercelDeployment>(`${API}/v13/deployments/${deploymentId}/redeploy`, {
    method: 'POST',
    headers: headers(token),
    body: {},
  });
}

export function liveUrl(deployment: VercelDeployment): string | null {
  if (deployment.readyState !== 'READY' || !deployment.url) return null;
  return `https://${deployment.url}`;
}