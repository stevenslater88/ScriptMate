// ScriptM8 cinematic design tokens (purple-blue identity). Shared by redesigned screens.

export const C = {
  ink: '#0B0A1A',
  surface: '#14122A',
  surface2: '#1C1938',
  line: 'rgba(255,255,255,0.07)',
  text: '#F4F3FF',
  muted: '#A19DC6',
  dim: '#6E6A95',
  violet: '#7C5CFF',
  violetSoft: '#A993FF',
  blue: '#3E6BFF',
  blueSoft: '#8FAAFF',
  cyan: '#62E0FF',
  success: '#34D399',
  warning: '#FFC37A',
  danger: '#FF5C7A',
  ember: '#FFB18A',
} as const;

export const GRADIENT = {
  primary: ['#7C5CFF', '#3E6BFF'] as const,
  hero: ['#2A1F6B', '#1B2A7A', '#132055'] as const,
  proBanner: ['rgba(124,92,255,0.20)', 'rgba(62,107,255,0.08)'] as const,
};

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

// System font (Roboto on Android); hierarchy via weight, size and tracking.
export const TYPE = {
  display: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.5, color: C.text },
  title: { fontSize: 20, fontWeight: '800' as const, letterSpacing: -0.3, color: C.text },
  heading: { fontSize: 15, fontWeight: '700' as const, color: C.text },
  body: { fontSize: 14, fontWeight: '500' as const, color: C.text },
  caption: { fontSize: 12, fontWeight: '500' as const, color: C.muted },
  label: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 1.6, textTransform: 'uppercase' as const, color: C.dim },
};

// Translucent tint for icon wells / chips, e.g. tint(C.cyan, 0.14).
export const tint = (hex: string, alpha: number): string => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};
