import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing, typography } from '../theme';

export function Screen({
  title,
  subtitle,
  right,
  children,
  scroll = true,
  refreshing,
  onRefresh,
  footer,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: React.ReactNode;
}) {
  const safe = { flex: 1, backgroundColor: colors.bg } as const;
  const body = (
    <View style={{ paddingHorizontal: spacing.lg, paddingBottom: 28 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={typography.display}>{title}</Text>
          {!!subtitle && <Text style={[typography.small, { marginTop: 4 }]}>{subtitle}</Text>}
        </View>
        {right}
      </View>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={safe} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          refreshing={!!refreshing}
          onRefresh={onRefresh}
        >
          {body}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}

export function GlassCard({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  onPress?: () => void;
}) {
  const content = <View style={[styles.card, style]}>{children}</View>;
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} android_ripple={{ color: colors.limeSoft }} style={{ borderRadius: radius.lg }}>
      {content}
    </Pressable>
  );
}

export function LimeButton({
  label,
  onPress,
  disabled,
  loading,
  variant = 'solid',
  small,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'solid' | 'ghost' | 'danger';
  small?: boolean;
  style?: ViewStyle;
}) {
  const isSolid = variant === 'solid';
  const bg = isSolid ? colors.lime : variant === 'danger' ? colors.dangerSoft : 'transparent';
  const fg = isSolid ? colors.text : variant === 'danger' ? colors.danger : colors.textMuted;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.button,
        {
          backgroundColor: bg,
          borderColor: isSolid ? 'transparent' : colors.border,
          borderWidth: isSolid ? 0 : 1,
          opacity: disabled ? 0.45 : 1,
          paddingVertical: small ? 9 : 14,
          paddingHorizontal: small ? 12 : 18,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 12.5 : 14.5 }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  keyboardType,
  autoCapitalize,
  multiline,
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: 'default' | 'url' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
  multiline?: boolean;
  hint?: string;
}) {
  const [hidden, setHidden] = React.useState(!!secure);
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[typography.small, { marginBottom: 6, fontWeight: '600', color: colors.text }]}>{label}</Text>
      <View style={styles.inputShell}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          secureTextEntry={hidden}
          keyboardType={keyboardType || 'default'}
          autoCapitalize={autoCapitalize || 'none'}
          autoCorrect={false}
          multiline={multiline}
          style={[
            styles.input,
            multiline && { minHeight: 84, textAlignVertical: 'top', paddingTop: 12 },
          ]}
        />
        {secure && (
          <Pressable onPress={() => setHidden((v) => !v)} hitSlop={8} style={{ paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.limeDeep }}>
              {hidden ? 'SHOW' : 'HIDE'}
            </Text>
          </Pressable>
        )}
      </View>
      {!!hint && <Text style={[typography.small, { fontSize: 11.5, marginTop: 5 }]}>{hint}</Text>}
    </View>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'lime' | 'success' | 'danger' | 'info';
}) {
  const map: Record<string, { bg: string; fg: string }> = {
    neutral: { bg: colors.surface, fg: colors.textMuted },
    lime: { bg: colors.limeSoft, fg: colors.limeDeep },
    success: { bg: colors.successSoft, fg: colors.success },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    info: { bg: colors.infoSoft, fg: colors.info },
  };
  const palette = map[tone];
  return (
    <View style={{ backgroundColor: palette.bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 }}>
      <Text style={{ fontSize: 10.5, fontWeight: '700', color: palette.fg, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export function Progress({ value, tone = colors.lime }: { value: number; tone?: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View style={{ height: 7, borderRadius: radius.pill, backgroundColor: colors.surface, overflow: 'hidden' }}>
      <View style={{ width: `${clamped * 100}%`, height: '100%', backgroundColor: tone, borderRadius: radius.pill }} />
    </View>
  );
}

export function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.sm }}>
      <Text style={{ flex: 1, fontSize: 12, fontWeight: '800', letterSpacing: 0.9, color: colors.textMuted }}>
        {children.toUpperCase()}
      </Text>
      {action}
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <GlassCard style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
      <View style={styles.emptyDot} />
      <Text style={[typography.subtitle, { marginTop: 10 }]}>{title}</Text>
      <Text style={[typography.small, { textAlign: 'center', marginTop: 4, paddingHorizontal: 16 }]}>{message}</Text>
    </GlassCard>
  );
}

export function Skeleton({ height = 64 }: { height?: number }) {
  return <View style={{ height, borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: spacing.sm }} />;
}

export function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 5 }}>
      <Text style={[typography.small, { flex: 1 }]}>{label}</Text>
      <Text
        style={[mono ? typography.mono : typography.small, { color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' }]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: 12,
  },
  card: {
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  button: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text,
  },
  emptyDot: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.limeSoft,
    borderWidth: 1,
    borderColor: colors.lime,
  },
});