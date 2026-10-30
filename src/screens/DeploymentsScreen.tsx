import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Screen, GlassCard, LimeButton, Badge, Field, SectionTitle, EmptyState, Row, Skeleton } from '../components/ui';
import { useAppState } from '../state/AppState';
import { useToast } from '../components/Toast';
import {
  listProjects,
  createProject,
  createGitDeployment,
  getDeployment,
  redeploy,
  liveUrl,
  VercelProject,
  VercelDeployment,
} from '../lib/vercel';
import { getDefaultBranch } from '../lib/github';
import { recordDeploy } from '../lib/store';
import { sleep } from '../lib/api';
import { colors, spacing, typography } from '../theme';

export default function DeploymentsScreen() {
  const route = useRoute<any>();
  const { creds, vercelStatus, history, refreshHistory } = useAppState();
  const toast = useToast();

  const [repo, setRepo] = useState<string>(route.params?.repo || history.recentRepos[0] || '');
  const [branch, setBranch] = useState('main');
  const [projectName, setProjectName] = useState<string>('');
  const [projects, setProjects] = useState<VercelProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [current, setCurrent] = useState<VercelDeployment | null>(null);
  const [statusLine, setStatusLine] = useState<string>('');

  const token = creds.vercelToken;

  useEffect(() => {
    if (route.params?.repo) setRepo(route.params.repo);
  }, [route.params?.repo]);

  useEffect(() => {
    if (!projectName && repo.includes('/')) {
      setProjectName(repo.split('/')[1]);
    }
  }, [repo, projectName]);

  useFocusEffect(
    useCallback(() => {
      refreshHistory();
      if (!token) return;
      setLoading(true);
      listProjects(token)
        .then(setProjects)
        .catch((e: any) => toast.show(e?.message || 'Could not load Vercel projects.', 'error'))
        .finally(() => setLoading(false));
    }, [token, refreshHistory, toast])
  );

  const pollDeployment = async (id: string) => {
    if (!token) return null;
    for (let i = 0; i < 14; i++) {
      const latest = await getDeployment(token, id);
      setCurrent(latest);
      setStatusLine(`Vercel reports: ${latest.readyState}`);
      if (latest.readyState === 'READY' || latest.readyState === 'ERROR' || latest.readyState === 'CANCELED') return latest;
      await sleep(6000);
    }
    return null;
  };

  const deploy = async () => {
    if (!token) return toast.show('Connect Vercel first.', 'error');
    if (!creds.githubToken) return toast.show('Connect GitHub first — Vercel deploys from the repository.', 'error');
    if (!repo.includes('/')) return toast.show('Enter owner/repo.', 'error');

    setDeploying(true);
    setCurrent(null);
    setStatusLine('Linking project…');
    try {
      const targetBranch = await getDefaultBranch(creds.githubToken, repo).catch(() => branch);
      setBranch(targetBranch);

      const name = (projectName || repo.split('/')[1]).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60);
      const existing = projects.find((p) => p.name === name);
      if (!existing) {
        try {
          await createProject(token, { name, repo });
        } catch (e: any) {
          if (e?.status !== 409) throw e;
        }
      }

      setStatusLine('Creating deployment…');
      const created = await createGitDeployment(token, { name, repo, ref: targetBranch, projectName: name });
      setCurrent(created);
      await recordDeploy({
        id: created.uid,
        repo,
        project: name,
        state: created.readyState,
        url: liveUrl(created),
        createdAt: Date.now(),
      });

      const final = await pollDeployment(created.uid);
      if (final) {
        await recordDeploy({
          id: final.uid,
          repo,
          project: name,
          state: final.readyState,
          url: liveUrl(final),
          createdAt: Date.now(),
        });
        await refreshHistory();
        if (final.readyState === 'READY') toast.show('Deployment is live.', 'success');
        else toast.show(final.errorMessage || 'Deployment failed — check the logs.', 'error');
      }
    } catch (e: any) {
      toast.show(
        e?.status === 400 || e?.status === 403
          ? 'Vercel rejected it. Install the Vercel GitHub integration for this repository and retry.'
          : e?.message || 'Deployment failed.',
        'error'
      );
    } finally {
      setDeploying(false);
      setStatusLine('');
    }
  };

  const handleRedeploy = async (id: string) => {
    if (!token) return;
    try {
      const created = await redeploy(token, id);
      setCurrent(created);
      toast.show('Redeploy started.');
      await pollDeployment(created.uid);
    } catch (e: any) {
      toast.show(e?.message || 'Redeploy failed.', 'error');
    }
  };

  const url = current ? liveUrl(current) : null;

  return (
    <Screen
      title="Deployments"
      subtitle="Vercel builds your repository — no server of ours involved."
      onRefresh={() => {
        refreshHistory();
        if (token) listProjects(token).then(setProjects).catch(() => undefined);
      }}
    >
      {vercelStatus !== 'connected' && (
        <GlassCard style={{ borderColor: colors.danger }}>
          <Text style={[typography.subtitle, { color: colors.danger }]}>Vercel not connected</Text>
          <Text style={[typography.small, { marginTop: 4 }]}>Add an access token in Settings to deploy.</Text>
        </GlassCard>
      )}

      <GlassCard>
        <Field label="Repository" value={repo} onChangeText={setRepo} placeholder="owner/repo" />
        <Field label="Vercel project name" value={projectName} onChangeText={setProjectName} placeholder="my-site" />
        <LimeButton label="Deploy to Vercel" onPress={deploy} loading={deploying} />
        {!!statusLine && <Text style={[typography.small, { marginTop: 8 }]}>{statusLine}</Text>}
      </GlassCard>

      {!!current && (
        <GlassCard style={{ borderColor: current.readyState === 'READY' ? colors.lime : colors.borderStrong }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[typography.subtitle, { flex: 1 }]}>{current.name}</Text>
            <Badge
              label={current.readyState}
              tone={current.readyState === 'READY' ? 'success' : current.readyState === 'ERROR' ? 'danger' : 'info'}
            />
          </View>
          {!!url && <Text style={[typography.small, { marginTop: 6 }]}>{url}</Text>}
          {!url && current.readyState !== 'READY' && (
            <Text style={[typography.small, { marginTop: 6 }]}>
              No live URL yet — Vercel has not confirmed the deployment as ready.
            </Text>
          )}
          {!!current.errorMessage && (
            <Text style={[typography.small, { color: colors.danger, marginTop: 6 }]}>{current.errorMessage}</Text>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.md }}>
            <LimeButton
              label="Open"
              small
              disabled={!url}
              onPress={() => url && Linking.openURL(url)}
              style={{ flex: 1 }}
            />
            <LimeButton
              label="Copy"
              small
              variant="ghost"
              disabled={!url}
              onPress={() => {
                if (!url) return;
                Clipboard.setStringAsync(url);
                toast.show('URL copied.');
              }}
              style={{ flex: 1 }}
            />
            <LimeButton
              label="Logs"
              small
              variant="ghost"
              onPress={() => current.inspectorUrl && Linking.openURL(current.inspectorUrl)}
              style={{ flex: 1 }}
            />
          </View>
          <View style={{ height: 8 }} />
          <LimeButton label="Redeploy" variant="ghost" small onPress={() => handleRedeploy(current.uid)} />
        </GlassCard>
      )}

      <SectionTitle>Vercel projects</SectionTitle>
      {loading && !projects.length && <Skeleton height={60} />}
      {!loading && !projects.length && (
        <EmptyState title="No Vercel projects" message="Deploying creates a project on your Vercel account." />
      )}
      {projects.map((project) => (
        <GlassCard key={project.id}>
          <Row label={project.name} value={project.framework || 'unknown framework'} />
        </GlassCard>
      ))}

      <SectionTitle>Deployment history</SectionTitle>
      {!history.deploys.length ? (
        <EmptyState title="Nothing deployed yet" message="Your deployment records are stored on this device." />
      ) : (
        history.deploys.slice(0, 8).map((deploy) => (
          <GlassCard key={`${deploy.id}-${deploy.createdAt}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={typography.subtitle}>{deploy.project}</Text>
                <Text style={[typography.small, { marginTop: 2 }]} numberOfLines={1}>
                  {deploy.url || deploy.repo}
                </Text>
              </View>
              <Badge label={deploy.state} tone={deploy.state === 'READY' ? 'success' : 'danger'} />
            </View>
          </GlassCard>
        ))
      )}
    </Screen>
  );
}