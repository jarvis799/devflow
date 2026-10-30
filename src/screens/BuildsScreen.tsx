import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen, GlassCard, LimeButton, Badge, Field, SectionTitle, EmptyState, Row, Skeleton } from '../components/ui';
import { useAppState } from '../state/AppState';
import { useToast } from '../components/Toast';
import {
  listTree,
  listBranches,
  listRuns,
  dispatchWorkflow,
  pushFiles,
  getDefaultBranch,
  WorkflowRun,
} from '../lib/github';
import { detectProject, workflowFor, APK_WORKFLOW_PATH, Detection } from '../lib/detect';
import { sleep } from '../lib/api';
import { colors, spacing, typography } from '../theme';

export default function BuildsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { creds, history } = useAppState();
  const toast = useToast();

  const [repo, setRepo] = useState<string>(route.params?.repo || '');
  const [branch, setBranch] = useState('main');
  const [detection, setDetection] = useState<Detection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);

  const token = creds.githubToken;

  const loadRuns = useCallback(
    async (target = repo, ref = branch) => {
      if (!token || !target.includes('/')) return;
      setRunsLoading(true);
      try {
        setRuns(await listRuns(token, target, ref));
      } catch (e: any) {
        toast.show(e?.message || 'Could not load workflow runs.', 'error');
      } finally {
        setRunsLoading(false);
      }
    },
    [token, repo, branch, toast]
  );

  useEffect(() => {
    if (route.params?.repo) setRepo(route.params.repo);
  }, [route.params?.repo]);

  const inspect = async () => {
    if (!token) return toast.show('Connect GitHub first.', 'error');
    if (!repo.includes('/')) return toast.show('Use the owner/repo format.', 'error');
    setInspecting(true);
    setDetection(null);
    try {
      const defaultBranch = await getDefaultBranch(token, repo);
      setBranch(defaultBranch);
      const branches = await listBranches(token, repo);
      if (branches.length && !branches.includes(defaultBranch)) setBranch(branches[0]);
      const tree = await listTree(token, repo, defaultBranch);
      const pseudo = tree.map((entry) => ({ path: entry.path, content: '', encoding: 'utf-8' as const, size: 0 }));
      setDetection(detectProject(pseudo));
      await loadRuns(repo, defaultBranch);
    } catch (e: any) {
      toast.show(e?.status === 404 ? 'Repository not found or token lacks access.' : e?.message || 'Inspect failed.', 'error');
    } finally {
      setInspecting(false);
    }
  };

  const addWorkflow = async () => {
    if (!token || !detection) return;
    const workflow = workflowFor(detection.kind);
    if (!workflow) {
      toast.show('No APK workflow template for this project type.', 'error');
      return;
    }
    Alert.alert(
      'Commit workflow file?',
      `${workflow.path} will be added to ${repo} on ${branch}. This adds a new file only — existing files are untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Commit',
          onPress: async () => {
            setBusy(true);
            try {
              await pushFiles(token, repo, branch, [{ path: workflow.path, content: workflow.content }], 'ci: add Android APK workflow', undefined);
              toast.show('Workflow committed.', 'success');
              setDetection({ ...detection, workflow: true });
            } catch (e: any) {
              toast.show(e?.message || 'Commit failed.', 'error');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const triggerBuild = async () => {
    if (!token) return toast.show('Connect GitHub first.', 'error');
    if (!detection?.workflow) return toast.show('Add the APK workflow first.', 'error');
    setBusy(true);
    try {
      const before = new Set(runs.map((r) => r.id));
      await dispatchWorkflow(token, repo, APK_WORKFLOW_PATH.split('/').pop() as string, branch);
      toast.show('Workflow dispatched. Waiting for the runner…');
      let found: WorkflowRun | undefined;
      for (let i = 0; i < 8; i++) {
        await sleep(5000);
        const latest = await listRuns(token, repo, branch);
        found = latest.find((r) => !before.has(r.id));
        if (found) break;
      }
      if (!found) {
        toast.show('Dispatched, but no run appeared yet. Refresh in a moment.', 'error');
        await loadRuns();
        return;
      }
      setRuns((prev) => [found as WorkflowRun, ...prev]);
      navigation.navigate('BuildMonitor', { repo, branch, runId: found.id });
    } catch (e: any) {
      toast.show(e?.status === 403 ? 'Token needs the workflow scope to dispatch runs.' : e?.message || 'Dispatch failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Builds" subtitle="Android APKs built on GitHub Actions runners." onRefresh={() => loadRuns()}>
      <GlassCard>
        <Field label="Repository" value={repo} onChangeText={setRepo} placeholder="owner/repo" />
        <Field label="Branch" value={branch} onChangeText={setBranch} placeholder="main" />
        <LimeButton label="Inspect repository" onPress={inspect} loading={inspecting} />
      </GlassCard>

      {detection && (
        <GlassCard>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
            <Badge label={detection.label.toUpperCase()} tone="lime" />
            <Badge label={detection.gradle ? 'GRADLE' : 'NO GRADLE'} tone={detection.gradle ? 'success' : 'neutral'} />
            <Badge label={detection.workflow ? 'WORKFLOW FOUND' : 'NO WORKFLOW'} tone={detection.workflow ? 'success' : 'danger'} />
          </View>
          <Row label="Build system" value={detection.kind} mono />
          {!detection.workflow && (
            <View style={{ marginTop: spacing.md }}>
              <Text style={[typography.small, { marginBottom: 8 }]}>
                DevFlow can add a minimal APK workflow to this repository.
              </Text>
              <LimeButton label="Add APK workflow" onPress={addWorkflow} loading={busy} />
            </View>
          )}
          {detection.workflow && (
            <View style={{ marginTop: spacing.md }}>
              <LimeButton label="Trigger build" onPress={triggerBuild} loading={busy} />
            </View>
          )}
        </GlassCard>
      )}

      <SectionTitle action={<Text style={{ color: colors.limeDeep, fontWeight: '700', fontSize: 12 }} onPress={() => loadRuns()}>Refresh</Text>}>
        Workflow runs
      </SectionTitle>

      {runsLoading && !runs.length && <Skeleton height={72} />}
      {!runs.length && !runsLoading && (
        <EmptyState title="No runs" message="Inspect a repository with a workflow, then trigger a build." />
      )}

      {runs.map((run) => (
        <GlassCard
          key={run.id}
          onPress={() => navigation.navigate('BuildMonitor', { repo, branch: run.head_branch, runId: run.id })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={typography.subtitle} numberOfLines={1}>
                {run.name}
              </Text>
              <Text style={[typography.small, { marginTop: 2 }]}>
                #{run.id} · {run.head_branch} · {run.head_sha.slice(0, 7)}
              </Text>
            </View>
            <Badge
              label={(run.conclusion || run.status).replace(/_/g, ' ').toUpperCase()}
              tone={run.conclusion === 'success' ? 'success' : run.conclusion ? 'danger' : 'info'}
            />
          </View>
        </GlassCard>
      ))}

      {!!history.builds.length && (
        <>
          <SectionTitle>Saved build history</SectionTitle>
          {history.builds.slice(0, 5).map((build) => (
            <GlassCard
              key={`${build.repo}-${build.runId}`}
              onPress={() => navigation.navigate('BuildMonitor', { repo: build.repo, branch: build.branch, runId: build.runId })}
            >
              <Row label={build.repo} value={`#${build.runId} · ${build.conclusion || build.status}`} />
            </GlassCard>
          ))}
        </>
      )}
    </Screen>
  );
}