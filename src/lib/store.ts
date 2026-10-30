import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GITHUB_KEY = 'devflow.github.token';
const VERCEL_KEY = 'devflow.vercel.token';
const GEMINI_KEY = 'devflow.gemini.key';
const HISTORY_KEY = 'devflow.history.v1';

export type Credentials = {
  githubToken: string | null;
  vercelToken: string | null;
  geminiKey: string | null;
};

export async function loadCredentials(): Promise<Credentials> {
  const [githubToken, vercelToken, geminiKey] = await Promise.all([
    SecureStore.getItemAsync(GITHUB_KEY),
    SecureStore.getItemAsync(VERCEL_KEY),
    SecureStore.getItemAsync(GEMINI_KEY),
  ]);
  return { githubToken, vercelToken, geminiKey };
}

export async function saveToken(kind: 'github' | 'vercel' | 'gemini', value: string | null) {
  const key = kind === 'github' ? GITHUB_KEY : kind === 'vercel' ? VERCEL_KEY : GEMINI_KEY;
  if (value) await SecureStore.setItemAsync(key, value.trim());
  else await SecureStore.deleteItemAsync(key);
}

export type BuildRecord = {
  id: string;
  repo: string;
  branch: string;
  runId: number;
  status: string;
  conclusion: string | null;
  startedAt: string;
  url: string;
};

export type DeployRecord = {
  id: string;
  repo: string;
  project: string;
  state: string;
  url: string | null;
  createdAt: number;
};

export type History = { builds: BuildRecord[]; deploys: DeployRecord[]; recentRepos: string[] };

const EMPTY: History = { builds: [], deploys: [], recentRepos: [] };

export async function loadHistory(): Promise<History> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw);
    return {
      builds: Array.isArray(parsed.builds) ? parsed.builds.slice(0, 40) : [],
      deploys: Array.isArray(parsed.deploys) ? parsed.deploys.slice(0, 40) : [],
      recentRepos: Array.isArray(parsed.recentRepos) ? parsed.recentRepos.slice(0, 10) : [],
    };
  } catch {
    return EMPTY;
  }
}

async function writeHistory(history: History) {
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export async function recordBuild(record: BuildRecord) {
  const history = await loadHistory();
  const builds = [record, ...history.builds.filter((b) => b.runId !== record.runId)].slice(0, 40);
  await writeHistory({ ...history, builds });
}

export async function updateBuild(runId: number, patch: Partial<BuildRecord>) {
  const history = await loadHistory();
  await writeHistory({
    ...history,
    builds: history.builds.map((b) => (b.runId === runId ? { ...b, ...patch } : b)),
  });
}

export async function recordDeploy(record: DeployRecord) {
  const history = await loadHistory();
  const deploys = [record, ...history.deploys.filter((d) => d.id !== record.id)].slice(0, 40);
  await writeHistory({ ...history, deploys });
}

export async function rememberRepo(fullName: string) {
  const history = await loadHistory();
  const recentRepos = [fullName, ...history.recentRepos.filter((r) => r !== fullName)].slice(0, 10);
  await writeHistory({ ...history, recentRepos });
}