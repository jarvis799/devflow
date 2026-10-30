import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getUser, GhUser } from '../lib/github';
import { validateToken as validateVercel } from '../lib/vercel';
import { validateKey as validateGemini } from '../lib/gemini';
import { Credentials, History, loadCredentials, loadHistory, saveToken } from '../lib/store';

type Status = 'unknown' | 'checking' | 'connected' | 'error';

type AppState = {
  ready: boolean;
  creds: Credentials;
  ghUser: GhUser | null;
  ghStatus: Status;
  ghError: string | null;
  vercelUser: string | null;
  vercelStatus: Status;
  vercelError: string | null;
  geminiStatus: Status;
  geminiError: string | null;
  history: History;
  connect: (kind: 'github' | 'vercel' | 'gemini', token: string) => Promise<boolean>;
  disconnect: (kind: 'github' | 'vercel' | 'gemini') => Promise<void>;
  refresh: () => Promise<void>;
  refreshHistory: () => Promise<void>;
};

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [creds, setCreds] = useState<Credentials>({ githubToken: null, vercelToken: null, geminiKey: null });
  const [ghUser, setGhUser] = useState<GhUser | null>(null);
  const [ghStatus, setGhStatus] = useState<Status>('unknown');
  const [ghError, setGhError] = useState<string | null>(null);
  const [vercelUser, setVercelUser] = useState<string | null>(null);
  const [vercelStatus, setVercelStatus] = useState<Status>('unknown');
  const [vercelError, setVercelError] = useState<string | null>(null);
  const [geminiStatus, setGeminiStatus] = useState<Status>('unknown');
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [history, setHistory] = useState<History>({ builds: [], deploys: [], recentRepos: [] });

  const verifyGithub = useCallback(async (token: string | null) => {
    if (!token) {
      setGhStatus('unknown');
      setGhUser(null);
      setGhError(null);
      return;
    }
    setGhStatus('checking');
    try {
      const user = await getUser(token);
      setGhUser(user);
      setGhStatus('connected');
      setGhError(null);
    } catch (e: any) {
      setGhStatus('error');
      setGhUser(null);
      setGhError(e?.status === 401 ? 'Token rejected by GitHub.' : e?.message || 'GitHub connection failed.');
    }
  }, []);

  const verifyVercel = useCallback(async (token: string | null) => {
    if (!token) {
      setVercelStatus('unknown');
      setVercelUser(null);
      setVercelError(null);
      return;
    }
    setVercelStatus('checking');
    const res = await validateVercel(token);
    setVercelStatus(res.ok ? 'connected' : 'error');
    setVercelUser(res.ok ? res.user || 'connected' : null);
    setVercelError(res.ok ? null : res.message);
  }, []);

  const verifyGemini = useCallback(async (key: string | null) => {
    if (!key) {
      setGeminiStatus('unknown');
      setGeminiError(null);
      return;
    }
    setGeminiStatus('checking');
    const res = await validateGemini(key);
    setGeminiStatus(res.ok ? 'connected' : 'error');
    setGeminiError(res.ok ? null : res.message);
  }, []);

  const refresh = useCallback(async () => {
    const loaded = await loadCredentials();
    setCreds(loaded);
    await Promise.all([
      verifyGithub(loaded.githubToken),
      verifyVercel(loaded.vercelToken),
      verifyGemini(loaded.geminiKey),
    ]);
  }, [verifyGithub, verifyVercel, verifyGemini]);

  const refreshHistory = useCallback(async () => {
    setHistory(await loadHistory());
  }, []);

  useEffect(() => {
    (async () => {
      const [loaded, hist] = await Promise.all([loadCredentials(), loadHistory()]);
      setCreds(loaded);
      setHistory(hist);
      setReady(true);
      await Promise.all([
        verifyGithub(loaded.githubToken),
        verifyVercel(loaded.vercelToken),
        verifyGemini(loaded.geminiKey),
      ]);
    })();
  }, [verifyGithub, verifyVercel, verifyGemini]);

  const connect = useCallback(
    async (kind: 'github' | 'vercel' | 'gemini', token: string) => {
      const trimmed = token.trim();
      if (!trimmed) return false;
      await saveToken(kind, trimmed);
      setCreds((prev) => ({
        ...prev,
        githubToken: kind === 'github' ? trimmed : prev.githubToken,
        vercelToken: kind === 'vercel' ? trimmed : prev.vercelToken,
        geminiKey: kind === 'gemini' ? trimmed : prev.geminiKey,
      }));
      if (kind === 'github') {
        setGhStatus('checking');
        try {
          const user = await getUser(trimmed);
          setGhUser(user);
          setGhStatus('connected');
          setGhError(null);
          await saveToken('github', trimmed);
          return true;
        } catch (e: any) {
          setGhStatus('error');
          setGhError(e?.status === 401 ? 'Token rejected by GitHub.' : e?.message || 'GitHub connection failed.');
          await saveToken('github', null);
          return false;
        }
      }
      if (kind === 'vercel') {
        setVercelStatus('checking');
        const res = await validateVercel(trimmed);
        setVercelStatus(res.ok ? 'connected' : 'error');
        setVercelUser(res.ok ? res.user || 'connected' : null);
        setVercelError(res.ok ? null : res.message);
        if (!res.ok) await saveToken('vercel', null);
        return res.ok;
      }
      setGeminiStatus('checking');
      const res = await validateGemini(trimmed);
      setGeminiStatus(res.ok ? 'connected' : 'error');
      setGeminiError(res.ok ? null : res.message);
      if (!res.ok) await saveToken('gemini', null);
      return res.ok;
    },
    []
  );

  const disconnect = useCallback(async (kind: 'github' | 'vercel' | 'gemini') => {
    await saveToken(kind, null);
    setCreds((prev) => ({
      ...prev,
      githubToken: kind === 'github' ? null : prev.githubToken,
      vercelToken: kind === 'vercel' ? null : prev.vercelToken,
      geminiKey: kind === 'gemini' ? null : prev.geminiKey,
    }));
    if (kind === 'github') {
      setGhUser(null);
      setGhStatus('unknown');
      setGhError(null);
    } else if (kind === 'vercel') {
      setVercelUser(null);
      setVercelStatus('unknown');
      setVercelError(null);
    } else {
      setGeminiStatus('unknown');
      setGeminiError(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      ready,
      creds,
      ghUser,
      ghStatus,
      ghError,
      vercelUser,
      vercelStatus,
      vercelError,
      geminiStatus,
      geminiError,
      history,
      connect,
      disconnect,
      refresh,
      refreshHistory,
    }),
    [
      ready,
      creds,
      ghUser,
      ghStatus,
      ghError,
      vercelUser,
      vercelStatus,
      vercelError,
      geminiStatus,
      geminiError,
      history,
      connect,
      disconnect,
      refresh,
      refreshHistory,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}