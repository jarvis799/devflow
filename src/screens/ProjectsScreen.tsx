import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Screen, GlassCard, LimeButton, Badge, Field, SectionTitle, EmptyState, Skeleton } from '../components/ui';
import { useAppState } from '../state/AppState';
import { useToast } from '../components/Toast';
import { listRepos, createRepo, Repo } from '../lib/github';
import { colors, spacing, typography } from '../theme';

export default function ProjectsScreen() {
  const navigation = useNavigation<any>();
  const { creds } = useAppState();
  const toast = useToast();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!creds.githubToken) {
      setRepos([]);
      setError('Connect GitHub to list repositories.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRepos(await listRepos(creds.githubToken));
    } catch (e: any) {
      setError(e?.message || 'Could not load repositories.');
    } finally {
      setLoading(false);
    }
  }, [creds.githubToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleCreate = async () => {
    if (!creds.githubToken) return;
    const trimmed = name.trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(trimmed)) {
      toast.show('Repository names allow letters, numbers, dot, dash and underscore.', 'error');
      return;
    }
    setBusy(true);
    try {
      const repo = await createRepo(creds.githubToken, {
        name: trimmed,
        description: description.trim(),
        private: isPrivate,
      });
      toast.show('Repository created.', 'success');
      setCreating(false);
      setName('');
      setDescription('');
      setRepos((prev) => [repo, ...prev]);
    } catch (e: any) {
      toast.show(e?.status === 422 ? 'A repository with that name already exists.' : e?.message || 'Create failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Projects"
      subtitle="Repositories the connected GitHub account can push to."
      onRefresh={load}
      refreshing={loading}
      right={<LimeButton label={creating ? 'Cancel' : 'New'} small onPress={() => setCreating((v) => !v)} />}
    >
      {creating && (
        <GlassCard>
          <Text style={[typography.subtitle, { marginBottom: spacing.md }]}>Create repository</Text>
          <Field label="Name" value={name} onChangeText={setName} placeholder="my-app" />
          <Field label="Description" value={description} onChangeText={setDescription} placeholder="Optional" />
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md }}>
            <LimeButton
              label="Private"
              small
              variant={isPrivate ? 'solid' : 'ghost'}
              onPress={() => setIsPrivate(true)}
              style={{ flex: 1 }}
            />
            <LimeButton
              label="Public"
              small
              variant={!isPrivate ? 'solid' : 'ghost'}
              onPress={() => setIsPrivate(false)}
              style={{ flex: 1 }}
            />
          </View>
          <LimeButton label="Create on GitHub" onPress={handleCreate} loading={busy} />
        </GlassCard>
      )}

      {!!error && <Text style={[typography.small, { color: colors.danger, marginBottom: spacing.sm }]}>{error}</Text>}

      <SectionTitle>Repositories</SectionTitle>
      {loading && !repos.length && <Skeleton height={70} />}
      {!loading && !repos.length && !error && (
        <EmptyState title="No repositories" message="Create one above, then push a ZIP project into it." />
      )}

      {repos.map((repo) => (
        <GlassCard key={repo.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={typography.subtitle}>{repo.full_name}</Text>
              <Text style={[typography.small, { marginTop: 2 }]} numberOfLines={1}>
                {repo.description || repo.default_branch}
              </Text>
            </View>
            <Badge label={repo.private ? 'PRIVATE' : 'PUBLIC'} tone={repo.private ? 'neutral' : 'info'} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.md }}>
            <LimeButton
              label="Build APK"
              small
              onPress={() => navigation.navigate('Builds', { repo: repo.full_name })}
              style={{ flex: 1 }}
            />
            <LimeButton
              label="Deploy"
              small
              variant="ghost"
              onPress={() => navigation.navigate('Deployments', { repo: repo.full_name })}
              style={{ flex: 1 }}
            />
            <LimeButton label="Open" small variant="ghost" onPress={() => Linking.openURL(repo.html_url)} style={{ flex: 0.7 }} />
          </View>
        </GlassCard>
      ))}
    </Screen>
  );
}