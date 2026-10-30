import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Screen, GlassCard, LimeButton, Field, SectionTitle, Row, Badge } from '../components/ui';
import { useAppState } from '../state/AppState';
import { useToast } from '../components/Toast';
import { listTree, readTextFile, pushFiles } from '../lib/github';
import { colors, spacing, typography } from '../theme';

type FieldKey = 'title' | 'description' | 'email' | 'github' | 'instagram' | 'telegram' | 'youtube' | 'portfolio';

const LABELS: Record<FieldKey, string> = {
  title: 'Site / name title',
  description: 'Profile description',
  email: 'Email',
  github: 'GitHub profile',
  instagram: 'Instagram profile',
  telegram: 'Telegram profile',
  youtube: 'YouTube channel',
  portfolio: 'Portfolio URL',
};

const PATTERNS: Record<FieldKey, RegExp> = {
  title: /<title>([^<]*)<\/title>/i,
  description: /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  email: /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/,
  github: /(https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9._-]+)/i,
  instagram: /(https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+)/i,
  telegram: /(https?:\/\/(?:t\.me|telegram\.me)\/[A-Za-z0-9._-]+)/i,
  youtube: /(https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/)[A-Za-z0-9._-]+)/i,
  portfolio: /(https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?=["'<\s])/i,
};

function extract(text: string, key: FieldKey): string {
  const match = text.match(PATTERNS[key]);
  return match ? match[1] : '';
}

export default function CustomizeScreen() {
  const { creds } = useAppState();
  const toast = useToast();
  const token = creds.githubToken;

  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<{ path: string; content: string }[]>([]);
  const [original, setOriginal] = useState<Record<FieldKey, string>>({
    title: '', description: '', email: '', github: '', instagram: '', telegram: '', youtube: '', portfolio: '',
  });
  const [values, setValues] = useState<Record<FieldKey, string>>({ ...original });
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [backup, setBackup] = useState<{ path: string; content: string }[] | null>(null);

  const loadSite = async () => {
    if (!token) return toast.show('Connect GitHub first.', 'error');
    if (!repo.includes('/')) return toast.show('Enter owner/repo.', 'error');
    setLoading(true);
    setDocuments([]);
    setSummary(null);
    try {
      const tree = await listTree(token, repo, branch);
      const htmlPaths = tree.filter((f) => /\.html?$/i.test(f.path)).slice(0, 4).map((f) => f.path);
      if (!htmlPaths.length) {
        toast.show('No HTML files at the repository root — nothing to customize.', 'error');
        return;
      }
      const docs: { path: string; content: string }[] = [];
      for (const path of htmlPaths) {
        const content = await readTextFile(token, repo, path, branch);
        if (content) docs.push({ path, content });
      }
      setDocuments(docs);
      const primary = docs[0]?.content || '';
      const found = Object.fromEntries(
        (Object.keys(LABELS) as FieldKey[]).map((key) => [key, extract(primary, key)])
      ) as Record<FieldKey, string>;
      setOriginal(found);
      setValues(found);
      setBackup(docs);
    } catch (e: any) {
      toast.show(e?.status === 404 ? 'Repository not found.' : e?.message || 'Could not read the repository.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const buildPatches = () => {
    const changed: { path: string; content: string }[] = [];
    let replacements = 0;
    for (const doc of documents) {
      let next = doc.content;
      (Object.keys(LABELS) as FieldKey[]).forEach((key) => {
        const before = original[key];
        const after = values[key];
        if (!before || !after || before === after) return;
        const escaped = before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'g');
        const hits = next.match(re);
        if (hits) {
          next = next.replace(re, after);
          replacements += hits.length;
        }
      });
      if (next !== doc.content) changed.push({ path: doc.path, content: next });
    }
    return { changed, replacements };
  };

  const push = async () => {
    if (!token) return;
    const { changed, replacements } = buildPatches();
    if (!changed.length) {
      toast.show('No changes to commit.', 'error');
      return;
    }
    setSaving(true);
    try {
      await pushFiles(
        token,
        repo,
        branch,
        changed.map((c) => ({ path: c.path, content: c.content })),
        'content: update personal details'
      );
      setBackup(documents);
      setDocuments(changed.map((c) => ({ ...c })));
      setSummary(`${replacements} replacement(s) across ${changed.length} file(s).`);
      toast.show('Changes committed.', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Commit failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const rollback = async () => {
    if (!token || !backup) return;
    setSaving(true);
    try {
      await pushFiles(
        token,
        repo,
        branch,
        backup.map((doc) => ({ path: doc.path, content: doc.content })),
        'revert: undo customization'
      );
      setDocuments(backup);
      setValues(original);
      setSummary('Rolled back to the content that was in the repository before editing.');
      toast.show('Rolled back.', 'success');
    } catch (e: any) {
      toast.show(e?.message || 'Rollback failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const changedCount = documents.length ? buildPatches().changed.length : 0;

  return (
    <Screen title="Customize website" subtitle="Edit personal details without touching layout or styles.">
      <GlassCard>
        <Field label="Repository" value={repo} onChangeText={setRepo} placeholder="owner/repo" />
        <Field label="Branch" value={branch} onChangeText={setBranch} placeholder="main" />
        <LimeButton label={documents.length ? 'Reload files' : 'Read website files'} onPress={loadSite} loading={loading} />
      </GlassCard>

      {!!documents.length && (
        <>
          <SectionTitle>Personal information</SectionTitle>
          <GlassCard>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.md, flexWrap: 'wrap' }}>
              <Badge label={`${documents.length} HTML FILE(S)`} tone="neutral" />
              {!!changedCount && <Badge label={`${changedCount} PENDING`} tone="lime" />}
            </View>
            {(Object.keys(LABELS) as FieldKey[]).map((key) => (
              <Field
                key={key}
                label={LABELS[key]}
                value={values[key]}
                onChangeText={(next) => setValues((prev) => ({ ...prev, [key]: next }))}
                hint={original[key] ? `Repository value: ${original[key]}` : 'Not found in the HTML — left unchanged.'}
              />
            ))}
            <LimeButton label="Commit changes" onPress={push} loading={saving} disabled={!changedCount} />
            <View style={{ height: 8 }} />
            <LimeButton label="Rollback" variant="ghost" onPress={rollback} disabled={!backup} />
          </GlassCard>

          {!!summary && (
            <GlassCard style={{ borderColor: colors.lime }}>
              <Text style={typography.subtitle}>Change summary</Text>
              <Text style={[typography.small, { marginTop: 4 }]}>{summary}</Text>
            </GlassCard>
          )}

          <SectionTitle>Files</SectionTitle>
          {documents.map((doc) => (
            <GlassCard key={doc.path}>
              <Row label={doc.path} value={`${doc.content.length.toLocaleString()} chars`} mono />
            </GlassCard>
          ))}
        </>
      )}
    </Screen>
  );
}