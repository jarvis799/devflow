import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Screen, GlassCard, LimeButton, Badge, SectionTitle, Row, Progress, Skeleton } from '../components/ui';
import { useAppState } from '../state/AppState';
import { useToast } from '../components/Toast';
import {
  getRun,
  listJobs,
  getJobLogs,
  listArtifacts,
  pushFiles,
  readTextFile,
  artifactDownloadUrl,
  WorkflowRun,
  Job,
  Artifact,
} from '../lib/github';
import { analyzeBuildFailure, Diagnosis } from '../lib/gemini';
import { downloadAuthenticated } from '../lib/export';
import { recordBuild, updateBuild } from '../lib/store';
import { sleep } from '../lib/api';
import { colors, spacing, typography } from '../theme';

const STEP_ORDER = [
  'Set up job',
  'Run actions/checkout',
  'Install dependencies',
  'Align Expo packages',
  'Prebuild Android project',
  'Build debug APK',
  'Build APK',
  'Upload APK',
];

const MAX_RETRIES = 2;

export default function BuildMonitorScreen() {
  const route = useRoute<any>();
  const { repo, branch, runId } = route.params as { repo: string; branch: string; runId: number };
  const { creds } = useAppState();
  const toast = useToast();
  const token = creds.githubToken;

  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [logs, setLogs] = useState<string>('');
  const [logsOpen, setLogsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const retries = useRef(0);

  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const [latest, jobList] = await Promise.all([getRun(token, repo, runId), listJobs(token, repo, runId)]);
      setRun(latest);
      setJobs(jobList);
      await updateBuild(runId, {
        status: latest.status,
        conclusion: latest.conclusion,
        url: latest.html_url,
      });
      if (latest.status === 'completed') {
        const found = await listArtifacts(token, repo, runId);
        setArtifacts(found);
      }
    } catch (e: any) {
      if (e?.status !== 404) toast.show(e?.message || 'Status refresh failed.', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, repo, runId, toast]);

  useEffect(() => {
    if (!token) return;
    recordBuild({
      id: `${repo}-${runId}`,
      repo,
      branch,
      runId,
      status: 'in_progress',
      conclusion: null,
      startedAt: new Date().toISOString(),
      url: `https://github.com/${repo}/actions/runs/${runId}`,
    });
    poll();
    const timer = setInterval(() => {
      poll();
    }, 10000);
    return () => clearInterval(timer);
  }, [poll, token, repo, branch, runId]);

  const elapsed = useMemo(() => {
    if (!run) return '—';
    const start = new Date(run.run_started_at || run.created_at).getTime();
    const end = run.status === 'completed' ? new Date(run.updated_at).getTime() : Date.now();
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }, [run]);

  const steps = useMemo(() => {
    const flat: { name: string; status: string; conclusion: string | null }[] = [];
    jobs.forEach((job) => job.steps.forEach((step) => flat.push(step)));
    return flat;
  }, [jobs]);

  const completedSteps = steps.filter((s) => s.status === 'completed').length;
  const progress = steps.length ? completedSteps / steps.length : 0;

  const loadLogs = async () => {
    if (!token || !jobs.length) return;
    setLogsOpen(true);
    if (logs) return;
    try {
      const text = await getJobLogs(token, repo, jobs[0].id);
      setLogs(String(text).slice(-20000));
    } catch (e: any) {
      toast.show(e?.message || 'Logs are not available yet.', 'error');
    }
  };

  const analyze = async () => {
    if (!token || !creds.geminiKey) {
      toast.show('Connect Gemini in Settings first.', 'error');
      return;
    }
    setAnalyzing(true);
    try {
      const logText = String(await getJobLogs(token, repo, jobs[0].id));
      setLogs(logText.slice(-20000));
      setLogsOpen(true);
      const candidates = ['package.json', 'app.json', 'babel.config.js', '.github/workflows/android-apk.yml', 'eas.json'];
      const files: { path: string; content: string }[] = [];
      for (const path of candidates) {
        const content = await readTextFile(token, repo, path, branch);
        if (content) files.push({ path, content });
      }
      const result = await analyzeBuildFailure({
        apiKey: creds.geminiKey,
        repo,
        branch,
        runUrl: run?.html_url || `https://github.com/${repo}/actions/runs/${runId}`,
        log: logText,
        files,
      });
      setDiagnosis(result);
      toast.show('Diagnosis ready for review.', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Gemini analysis failed.', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const applyAndRebuild = () => {
    if (!diagnosis || !token) return;
    if (!diagnosis.fixes.length) {
      toast.show('No file patch was proposed.', 'error');
      return;
    }
    if (retries.current >= MAX_RETRIES) {
      toast.show(`Retry limit reached (${MAX_RETRIES}).`, 'error');
      return;
    }
    Alert.alert(
      'Apply AI patch?',
      `${diagnosis.fixes.length} file(s) will be committed to ${repo} on ${branch}. Review the proposed content below before continuing.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Commit & rebuild',
          onPress: async () => {
            setApplying(true);
            try {
              await pushFiles(
                token,
                repo,
                branch,
                diagnosis.fixes.map((fix) => ({ path: fix.path, content: fix.replacement })),
                `fix: ${diagnosis.rootCause.slice(0, 60)}`,
                undefined
              );
              retries.current += 1;
              toast.show('Patch committed. A new build will start.', 'success');
              setDiagnosis(null);
            } catch (e: any) {
              toast.show(e?.message || 'Patch commit failed.', 'error');
            } finally {
              setApplying(false);
            }
          },
        },
      ]
    );
  };

  const downloadApk = async (artifact: Artifact) => {
    if (!token) return;
    if (artifact.expired) {
      toast.show('This artifact has expired on GitHub.', 'error');
      return;
    }
    setDownloading(artifact.id);
    try {
      const path = await downloadAuthenticated(
        artifactDownloadUrl(repo, artifact.id),
        `${artifact.name.replace(/[^a-z0-9-_]/gi, '-')}.zip`,
        token
      );
      toast.show('Artifact saved to app storage.', 'success');
      setLogs((prev) => prev);
      Linking.openURL(`file://${path}`).catch(() => undefined);
    } catch (e: any) {
      toast.show(e?.message || 'Download failed.', 'error');
    } finally {
      setDownloading(null);
    }
  };

  const failed = run?.conclusion === 'failure';

  return (
    <Screen
      title={`Run #${runId}`}
      subtitle={`${repo} · ${branch}`}
      onRefresh={poll}
      right={<Badge label={(run?.conclusion || run?.status || 'loading').replace(/_/g, ' ').toUpperCase()} tone={run?.conclusion === 'success' ? 'success' : failed ? 'danger' : 'info'} />}
    >
      {loading && <Skeleton height={90} />}

      {run && (
        <GlassCard>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={typography.subtitle}>{run.name}</Text>
            <Text style={typography.small}>{elapsed}</Text>
          </View>
          <Progress value={progress} tone={failed ? colors.danger : run.conclusion === 'success' ? colors.success : colors.lime} />
          <Text style={[typography.small, { marginTop: 8 }]}>
            {completedSteps} of {steps.length} steps completed · {run.event} · {run.head_sha.slice(0, 7)}
          </Text>
          <View style={{ height: spacing.sm }} />
          <Row label="Workflow status" value={run.status} mono />
          <Row label="Conclusion" value={run.conclusion || 'pending'} mono />
          <View style={{ height: spacing.sm }} />
          <LimeButton label="Open on GitHub" variant="ghost" small onPress={() => Linking.openURL(run.html_url)} />
        </GlassCard>
      )}

      <SectionTitle>Steps</SectionTitle>
      <GlassCard>
        {!steps.length && <Text style={typography.small}>Waiting for the runner to report steps…</Text>}
        {steps.map((step, index) => (
          <View
            key={`${step.name}-${index}`}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
          >
            <View
              style={{
                width: 9,
                height: 9,
                borderRadius: 5,
                marginRight: 10,
                backgroundColor:
                  step.conclusion === 'success'
                    ? colors.success
                    : step.conclusion
                    ? colors.danger
                    : step.status === 'in_progress'
                    ? colors.lime
                    : colors.borderStrong,
              }}
            />
            <Text style={[typography.small, { flex: 1, color: step.status === 'pending' ? colors.textFaint : colors.text }]}>
              {step.name}
            </Text>
            <Text style={[typography.small, { fontSize: 11 }]}>{(step.conclusion || step.status).replace(/_/g, ' ')}</Text>
          </View>
        ))}
      </GlassCard>

      {failed && (
        <>
          <SectionTitle>AI repair</SectionTitle>
          <GlassCard>
            {!creds.geminiKey && (
              <Text style={[typography.small, { color: colors.danger, marginBottom: 8 }]}>
                Connect a Gemini API key in Settings to analyse this failure.
              </Text>
            )}
            {!diagnosis && (
              <LimeButton label="Analyse failure with Gemini" onPress={analyze} loading={analyzing} />
            )}
            {diagnosis && (
              <>
                <Badge label={diagnosis.category.toUpperCase()} tone="danger" />
                <Text style={[typography.subtitle, { marginTop: 10 }]}>{diagnosis.rootCause}</Text>
                <Text style={[typography.small, { marginTop: 6 }]}>{diagnosis.explanation}</Text>
                {!!diagnosis.affectedFiles.length && (
                  <View style={{ marginTop: 8 }}>
                    <Row label="Affected files" value={diagnosis.affectedFiles.join(', ')} mono />
                  </View>
                )}
                {diagnosis.fixes.map((fix) => (
                  <View key={fix.path} style={{ marginTop: spacing.md }}>
                    <Text style={[typography.small, { fontWeight: '700', color: colors.text }]}>{fix.path}</Text>
                    <Text style={[typography.small, { marginTop: 2 }]}>{fix.explanation}</Text>
                    <ScrollView style={{ maxHeight: 180, marginTop: 6, backgroundColor: colors.surface, borderRadius: 10 }}>
                      <Text style={[typography.mono, { padding: 10 }]}>{fix.replacement.slice(0, 4000)}</Text>
                    </ScrollView>
                  </View>
                ))}
                <View style={{ height: spacing.md }} />
                <LimeButton
                  label={diagnosis.rebuildRecommended ? 'Approve patch & rebuild' : 'Approve patch'}
                  onPress={applyAndRebuild}
                  loading={applying}
                  disabled={!diagnosis.fixes.length}
                />
              </>
            )}
          </GlassCard>
        </>
      )}

      <SectionTitle
        action={
          <Text style={{ color: colors.limeDeep, fontWeight: '700', fontSize: 12 }} onPress={loadLogs}>
            {logsOpen ? 'Loaded' : 'Load logs'}
          </Text>
        }
      >
        Build logs
      </SectionTitle>
      {logsOpen && (
        <GlassCard style={{ padding: 0 }}>
          <ScrollView style={{ maxHeight: 320 }}>
            <Text style={[typography.mono, { padding: spacing.md }]}>{logs || 'Fetching logs…'}</Text>
          </ScrollView>
        </GlassCard>
      )}

      {run?.status === 'completed' && (
        <>
          <SectionTitle>Artifacts</SectionTitle>
          {!artifacts.length ? (
            <GlassCard>
              <Text style={typography.small}>
                No artifacts were uploaded by this run. Artifacts expire on GitHub after the retention period.
              </Text>
            </GlassCard>
          ) : (
            artifacts.map((artifact) => (
              <GlassCard key={artifact.id}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={typography.subtitle}>{artifact.name}</Text>
                    <Text style={[typography.small, { marginTop: 2 }]}>
                      {(artifact.size_in_bytes / 1024 / 1024).toFixed(2)} MB · {artifact.expired ? 'expired' : 'available'}
                    </Text>
                  </View>
                  <LimeButton
                    label="Download"
                    small
                    disabled={artifact.expired}
                    loading={downloading === artifact.id}
                    onPress={() => downloadApk(artifact)}
                  />
                </View>
              </GlassCard>
            ))
          )}
        </>
      )}
    </Screen>
  );
}