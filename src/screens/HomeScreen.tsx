import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Screen, GlassCard, LimeButton, Badge, SectionTitle, EmptyState, Row, Skeleton } from '../components/ui';
import { useAppState } from '../state/AppState';
import { useToast } from '../components/Toast';
import { pickZipArchive, formatBytes } from '../lib/zip';
import { colors, spacing, typography } from '../theme';

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const { ghStatus, ghUser, vercelStatus, geminiStatus, history, refreshHistory, creds } = useAppState();
  const toast = useToast();
  const [picking, setPicking] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshHistory();
    }, [refreshHistory])
  );

  const startUpload = async () => {
    if (!creds.githubToken) {
      toast.show('Connect GitHub first.', 'error');
      navigation.navigate('Settings');
      return;
    }
    setPicking(true);
    try {
      const picked = await pickZipArchive();
      if (!picked) return;
      navigation.navigate('ZipFlow', { uri: picked.uri, name: picked.name, size: picked.size });
    } catch (e: any) {
      toast.show(e?.message || 'Could not open that file.', 'error');
    } finally {
      setPicking(false);
    }
  };

  const activeBuilds = history.builds.filter((b) => b.status !== 'completed').slice(0, 3);
  const liveSites = history.deploys.filter((d) => d.state === 'READY').slice(0, 3);

  return (
    <Screen
      title="DevFlow"
      subtitle="Ship Android builds and websites without a server."
      onRefresh={refreshHistory}
    >
      <GlassCard>
        <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.9, color: colors.textMuted }}>
          CONNECTED ACCOUNTS
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Badge
            label={ghStatus === 'connected' ? `GitHub · ${ghUser?.login}` : 'GitHub'}
            tone={ghStatus === 'connected' ? 'success' : 'neutral'}
          />
          <Badge label="Vercel" tone={vercelStatus === 'connected' ? 'success' : 'neutral'} />
          <Badge label="Gemini" tone={geminiStatus === 'connected' ? 'success' : 'neutral'} />
        </View>
      </GlassCard>

      <GlassCard style={{ borderColor: colors.lime, borderWidth: 1.5 }}>
        <Text style={typography.title}>Upload a project</Text>
        <Text style={[typography.small, { marginTop: 4, marginBottom: spacing.md }]}>
          ZIP archive → inspect → push to GitHub → build an APK or deploy the site.
        </Text>
        <LimeButton label={picking ? 'Opening picker…' : 'Choose ZIP archive'} onPress={startUpload} loading={picking} />
      </GlassCard>

      <SectionTitle
        action={<Text style={{ fontSize: 12, color: colors.limeDeep, fontWeight: '700' }} onPress={() => navigation.navigate('Builds')}>Open</Text>}
      >
        Active builds
      </SectionTitle>
      {!history.builds.length ? (
        <EmptyState title="No builds yet" message="Push a project and start a build to see live progress here." />
      ) : activeBuilds.length ? (
        activeBuilds.map((build) => (
          <GlassCard key={`${build.repo}-${build.runId}`} onPress={() => navigation.navigate('BuildMonitor', { repo: build.repo, branch: build.branch, runId: build.runId })}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={typography.subtitle}>{build.repo}</Text>
                <Text style={[typography.small, { marginTop: 2 }]}>{build.branch} · run #{build.runId}</Text>
              </View>
              <Badge label={build.status.replace('_', ' ').toUpperCase()} tone="info" />
            </View>
          </GlassCard>
        ))
      ) : (
        <GlassCard>
          <Row label="Latest result" value={history.builds[0].conclusion ? history.builds[0].conclusion.toUpperCase() : history.builds[0].status} />
          <Row label="Repository" value={history.builds[0].repo} />
        </GlassCard>
      )}

      <SectionTitle>Recent projects</SectionTitle>
      {!history.recentRepos.length ? (
        <EmptyState title="Nothing pushed yet" message="Repositories you push to from DevFlow show up here." />
      ) : (
        history.recentRepos.slice(0, 4).map((repo) => (
          <GlassCard key={repo} onPress={() => navigation.navigate('Builds', { repo })}>
            <Text style={typography.subtitle}>{repo}</Text>
            <Text style={[typography.small, { marginTop: 2 }]}>Tap to build or deploy</Text>
          </GlassCard>
        ))
      )}

      <SectionTitle>Live websites</SectionTitle>
      {!liveSites.length ? (
        <EmptyState title="No deployments ready" message="Deploy a repository from the Deployments tab to get a live URL." />
      ) : (
        liveSites.map((site) => (
          <GlassCard key={site.id} onPress={() => navigation.navigate('Deployments')}>
            <Text style={typography.subtitle}>{site.project}</Text>
            <Text style={[typography.small, { marginTop: 2 }]} numberOfLines={1}>{site.url || 'ready'}</Text>
          </GlassCard>
        ))
      )}
    </Screen>
  );
}