import React, { useState } from 'react';
import { Alert, Linking, View, Text } from 'react-native';
import { Screen, GlassCard, Field, LimeButton, Badge, SectionTitle, Row } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAppState } from '../state/AppState';
import { colors, spacing, typography } from '../theme';

type Kind = 'github' | 'vercel' | 'gemini';

function statusTone(status: string) {
  if (status === 'connected') return 'success' as const;
  if (status === 'error') return 'danger' as const;
  if (status === 'checking') return 'info' as const;
  return 'neutral' as const;
}

export default function SettingsScreen() {
  const { creds, ghUser, ghStatus, ghError, vercelStatus, vercelUser, vercelError, geminiStatus, geminiError, connect, disconnect, refresh } =
    useAppState();
  const toast = useToast();
  const [githubInput, setGithubInput] = useState('');
  const [vercelInput, setVercelInput] = useState('');
  const [geminiInput, setGeminiInput] = useState('');
  const [busy, setBusy] = useState<Kind | null>(null);

  const handleConnect = async (kind: Kind) => {
    const value = kind === 'github' ? githubInput : kind === 'vercel' ? vercelInput : geminiInput;
    if (!value.trim()) {
      toast.show('Paste a token first.', 'error');
      return;
    }
    setBusy(kind);
    const ok = await connect(kind, value);
    setBusy(null);
    if (ok) {
      toast.show('Connected.', 'success');
      if (kind === 'github') setGithubInput('');
      if (kind === 'vercel') setVercelInput('');
      if (kind === 'gemini') setGeminiInput('');
    } else {
      toast.show('Connection failed — check the token.', 'error');
    }
  };

  const handleDisconnect = (kind: Kind) => {
    Alert.alert('Disconnect', 'The token is deleted from secure storage on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await disconnect(kind);
          toast.show('Disconnected.');
        },
      },
    ]);
  };

  return (
    <Screen
      title="Settings"
      subtitle="Credentials are stored in Android secure storage and never leave the device."
      onRefresh={refresh}
    >
      <SectionTitle>GitHub</SectionTitle>
      <GlassCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
          <Text style={[typography.subtitle, { flex: 1 }]}>Personal Access Token</Text>
          <Badge label={ghStatus === 'connected' ? `@${ghUser?.login}` : ghStatus.toUpperCase()} tone={statusTone(ghStatus)} />
        </View>
        {ghStatus !== 'connected' ? (
          <>
            <Field
              label="Token (classic or fine-grained)"
              value={githubInput}
              onChangeText={setGithubInput}
              placeholder="ghp_… or github_pat_…"
              secure
              hint="Scopes: repo, workflow. Add read access to Actions artifacts and Releases."
            />
            <LimeButton label="Connect GitHub" onPress={() => handleConnect('github')} loading={busy === 'github'} />
          </>
        ) : (
          <>
            <Row label="Account" value={ghUser?.login || '—'} />
            <Row label="Name" value={ghUser?.name || '—'} />
            <View style={{ height: spacing.sm }} />
            <LimeButton label="Disconnect GitHub" variant="danger" onPress={() => handleDisconnect('github')} />
          </>
        )}
        {!!ghError && <Text style={[typography.small, { color: colors.danger, marginTop: 8 }]}>{ghError}</Text>}
      </GlassCard>

      <SectionTitle>Vercel</SectionTitle>
      <GlassCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
          <Text style={[typography.subtitle, { flex: 1 }]}>Access Token</Text>
          <Badge label={vercelStatus === 'connected' ? 'CONNECTED' : vercelStatus.toUpperCase()} tone={statusTone(vercelStatus)} />
        </View>
        {vercelStatus !== 'connected' ? (
          <>
            <Field
              label="Vercel token"
              value={vercelInput}
              onChangeText={setVercelInput}
              placeholder="vercel_…"
              secure
              hint="Create one at vercel.com/account/tokens. The GitHub integration must be installed on Vercel for Git deployments."
            />
            <LimeButton label="Connect Vercel" onPress={() => handleConnect('vercel')} loading={busy === 'vercel'} />
          </>
        ) : (
          <>
            <Row label="Account" value={vercelUser || 'connected'} />
            <View style={{ height: spacing.sm }} />
            <LimeButton label="Disconnect Vercel" variant="danger" onPress={() => handleDisconnect('vercel')} />
          </>
        )}
        {!!vercelError && <Text style={[typography.small, { color: colors.danger, marginTop: 8 }]}>{vercelError}</Text>}
      </GlassCard>

      <SectionTitle>Google Gemini</SectionTitle>
      <GlassCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
          <Text style={[typography.subtitle, { flex: 1 }]}>API key</Text>
          <Badge label={geminiStatus === 'connected' ? 'CONNECTED' : geminiStatus.toUpperCase()} tone={statusTone(geminiStatus)} />
        </View>
        {geminiStatus !== 'connected' ? (
          <>
            <Field
              label="Gemini API key"
              value={geminiInput}
              onChangeText={setGeminiInput}
              placeholder="AIza…"
              secure
              hint="Used only for build-log analysis and patch proposals. Get one at aistudio.google.com/apikey."
            />
            <LimeButton label="Connect Gemini" onPress={() => handleConnect('gemini')} loading={busy === 'gemini'} />
          </>
        ) : (
          <>
            <Row label="Model" value="gemini-2.5-flash" mono />
            <View style={{ height: spacing.sm }} />
            <LimeButton label="Disconnect Gemini" variant="danger" onPress={() => handleDisconnect('gemini')} />
          </>
        )}
        {!!geminiError && <Text style={[typography.small, { color: colors.danger, marginTop: 8 }]}>{geminiError}</Text>}
      </GlassCard>

      <SectionTitle>How it works</SectionTitle>
      <GlassCard>
        <Text style={[typography.small, { marginBottom: 8 }]}>
          DevFlow has no backend server. Builds run on GitHub Actions runners, websites deploy on Vercel, and AI
          analysis goes straight from this device to the Gemini API with your own key.
        </Text>
        <LimeButton
          label="GitHub token permissions"
          variant="ghost"
          small
          onPress={() => Linking.openURL('https://docs.github.com/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys')}
        />
      </GlassCard>
    </Screen>
  );
}