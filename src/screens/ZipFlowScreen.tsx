import React, { useEffect, useState } from 'react';
import { Text, View, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen, GlassCard, LimeButton, Badge, Field, SectionTitle, Row, Progress } from '../components/ui';
import { useAppState } from '../state/AppState';
import { useToast } from '../components/Toast';
import { extractZip, formatBytes, ZipFile } from '../lib/zip';
import { detectProject, Detection, workflowFor } from '../lib/detect';
import { pushFiles, createRepo, getDefaultBranch, getUser } from '../lib/github';
import { rememberRepo } from '../lib/store';
import { colors, spacing, typography } from '../theme';

export default function ZipFlowScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { uri, name, size } = route.params as { uri: string; name: string; size: number };
  const { creds, history } = useAppState();
  const toast = useToast();

  const [files, setFiles] = useState<ZipFile[]>([]);
  const [skipped, setSkipped] = useState<{ path: string; reason: string }[]>([]);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [extracting, setExtracting] = useState(true);
  const [extractError, setExtractError] = useState<string | null>(null);

  const [mode, setMode] = useState<'existing' | 'new'>(history.recentRepos.length ? 'existing' : 'new');
  const [repo, setRepo] = useState(history.recentRepos[0] || '');
  const [newName, setNewName] = useState(name.replace(/\.zip$/i, '').toLowerCase().replace(/[^a-z0-9-_]/g, '-').slice(0, 60));
  const [isPrivate, setIsPrivate] = useState(true);
  const [branch, setBranch] = useState('main');
  const [message, setMessage] = useState('feat: initial project import');
  const [pushing, setPushing] = useState(false);
  const [pushState, setPushState] = useState<{ done: number; total: number; path: string } | null>(null);
  const [result, setResult] = useState<{ url: string; sha: string; files: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const extracted = await extractZip(uri);
        setFiles(extracted.files);
        setSkipped(extracted.skipped);
        setDetection(detectProject(extracted.files));
      } catch (e: any) {
        setExtractError(e?.message || 'Extraction failed.');
      } finally {
        setExtracting(false);
      }
    })();
  }, [uri]);

  const topLevel = Array.from(new Set(files.map((f) => f.path.split('/')[0]))).slice(0, 8);
  const detectedWorkflow = detection ? workflowFor(detection.kind) : null;

  const push = async () => {
    const token = creds.githubToken;
    if (!token) return toast.show('Connect GitHub first.', 'error');

    let targetRepo = repo;
    let targetBranch = branch;
    if (mode === 'new') {
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(newName)) {
        toast.show('Invalid repository name.', 'error');
        return;
      }
      targetRepo = '';
    } else if (!repo.includes('/')) {
      toast.show('Select a repository first.', 'error');
      return;
    }

    setPushing(true);
    setPushState(null);
    try {
      if (mode === 'new') {
        const me = await getUser(token);
        const created = await createRepo(token, { name: newName, private: isPrivate, description: 'Created with DevFlow' });
        targetRepo = created.full_name || `${me.login}/${newName}`;
        targetBranch = 'main';
      } else {
        targetBranch = await getDefaultBranch(token, targetRepo).catch(() => branch);
      }

      const payload = [...files];
      if (detectedWorkflow && (detection?.kind === 'expo' || detection?.kind === 'react-native' || detection?.kind === 'android')) {
        if (!payload.some((f) => f.path === detectedWorkflow.path)) {
          payload.push({ path: detectedWorkflow.path, content: detectedWorkflow.content, encoding: 'utf-8', size: detectedWorkflow.content.length });
        }
      }

      const commit = await pushFiles(token, targetRepo, targetBranch, payload, message.trim() || 'chore: import project', (done, total, path) =>
        setPushState({ done, total, path })
      );
      await rememberRepo(targetRepo);
      setResult({ url: `https://github.com/${targetRepo}/commit/${commit.sha}`, sha: commit.sha, files: commit.files });
      setRepo(targetRepo);
      setBranch(targetBranch);
      toast.show('Pushed to GitHub.', 'success');
    } catch (e: any) {
      if (e?.status === 422) toast.show('That repository name already exists.', 'error');
      else toast.show(e?.message || 'Push failed.', 'error');
    } finally {
      setPushing(false);
    }
  };

  return (
    <Screen title="Push project" subtitle={`${name} · ${formatBytes(size)}`}>
      {extracting && (
        <GlassCard>
          <Text style={typography.subtitle}>Extracting archive…</Text>
          <View style={{ height: 10 }} />
          <Progress value={0.4} />
        </GlassCard>
      )}

      {!!extractError && (
        <GlassCard style={{ borderColor: colors.danger }}>
          <Text style={[typography.subtitle, { color: colors.danger }]}>Cannot read this archive</Text>
          <Text style={[typography.small, { marginTop: 4 }]}>{extractError}</Text>
        </GlassCard>
      )}

      {!!detection && (
        <GlassCard>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Badge label={detection.label.toUpperCase()} tone="lime" />
            <Badge label={`${files.length} FILES`} tone="neutral" />
            <Badge label={formatBytes(files.reduce((s, f) => s + f.size, 0))} tone="neutral" />
          </View>
          <View style={{ marginTop: spacing.md }}>
            <Row label="Top level" value={topLevel.join(' · ') || '—'} mono />
            {!!skipped.length && <Row label="Skipped" value={`${skipped.length} file(s)`} />}
            <Row label="APK workflow" value={detectedWorkflow ? 'will be added' : 'not applicable'} />
          </View>
        </GlassCard>
      )}

      {!result && !!files.length && (
        <>
          <SectionTitle>Destination</SectionTitle>
          <GlassCard>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
              <LimeButton
                label="Existing repo"
                small
                variant={mode === 'existing' ? 'solid' : 'ghost'}
                onPress={() => setMode('existing')}
                style={{ flex: 1 }}
              />
              <LimeButton
                label="New repo"
                small
                variant={mode === 'new' ? 'solid' : 'ghost'}
                onPress={() => setMode('new')}
                style={{ flex: 1 }}
              />
            </View>

            {mode === 'existing' ? (
              <>
                <Field label="Repository" value={repo} onChangeText={setRepo} placeholder="owner/repo" />
                {!!history.recentRepos.length && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
                    {history.recentRepos.slice(0, 4).map((item) => (
                      <Text
                        key={item}
                        onPress={() => setRepo(item)}
                        style={{
                          fontSize: 11.5,
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 999,
                          backgroundColor: colors.limeSoft,
                          color: colors.limeDeep,
                          fontWeight: '700',
                          overflow: 'hidden',
                        }}
                      >
                        {item}
                      </Text>
                    ))}
                  </View>
                )}
                <Field label="Branch" value={branch} onChangeText={setBranch} placeholder="main" />
              </>
            ) : (
              <>
                <Field label="New repository name" value={newName} onChangeText={setNewName} placeholder="my-app" />
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
                  <LimeButton label="Private" small variant={isPrivate ? 'solid' : 'ghost'} onPress={() => setIsPrivate(true)} style={{ flex: 1 }} />
                  <LimeButton label="Public" small variant={!isPrivate ? 'solid' : 'ghost'} onPress={() => setIsPrivate(false)} style={{ flex: 1 }} />
                </View>
              </>
            )}

            <Field label="Commit message" value={message} onChangeText={setMessage} />

            {!!pushState && (
              <View style={{ marginBottom: spacing.md }}>
                <Progress value={pushState.total ? pushState.done / pushState.total : 0} />
                <Text style={[typography.small, { marginTop: 6 }]}>
                  {pushState.done}/{pushState.total} files · {pushState.path}
                </Text>
              </View>
            )}

            <LimeButton
              label={mode === 'new' ? 'Create repository & push' : 'Push to GitHub'}
              onPress={push}
              loading={pushing}
            />
            <Text style={[typography.small, { marginTop: 8 }]}>
              Existing files in the repository are preserved — this adds and overwrites only the paths from the archive.
            </Text>
          </GlassCard>
        </>
      )}

      {!!result && (
        <GlassCard style={{ borderColor: colors.lime }}>
          <Text style={typography.title}>Pushed successfully</Text>
          <View style={{ height: spacing.sm }} />
          <Row label="Files" value={String(result.files)} />
          <Row label="Commit" value={result.sha.slice(0, 7)} mono />
          <View style={{ height: spacing.md }} />
          <LimeButton label="View commit" variant="ghost" small onPress={() => navigation.navigate('Projects')} />
          <View style={{ height: 8 }} />
          <LimeButton label="Build APK" onPress={() => navigation.navigate('Builds', { repo })} />
          <View style={{ height: 8 }} />
          <LimeButton label="Deploy website" variant="ghost" onPress={() => navigation.navigate('Deployments', { repo })} />
        </GlassCard>
      )}
    </Screen>
  );
}