export const colors = {
  bg: '#FFFFFF',
  surface: '#FAFAF9',
  glass: 'rgba(255,255,255,0.72)',
  glassStrong: 'rgba(255,255,255,0.92)',
  lime: '#A3E635',
  limeDeep: '#65A30D',
  limeSoft: '#F3FCE0',
  text: '#18181B',
  textMuted: '#71717A',
  textFaint: '#A1A1AA',
  border: 'rgba(24,24,27,0.08)',
  borderStrong: 'rgba(24,24,27,0.14)',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  success: '#16A34A',
  successSoft: '#F0FDF4',
  info: '#2563EB',
  infoSoft: '#EFF6FF',
};

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 };

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 32,
};

export const shadow = {
  card: {
    shadowColor: '#3F6212',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
};

export const typography = {
  display: { fontSize: 27, fontWeight: '700' as const, letterSpacing: -0.6, color: colors.text },
  title: { fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.3, color: colors.text },
  subtitle: { fontSize: 14, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 14, lineHeight: 20, color: colors.text },
  small: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted },
  mono: { fontFamily: 'monospace', fontSize: 11.5, lineHeight: 17, color: colors.text },
};