/** Design tokens. Colors follow the product palette; module accents stay subtle. */
export const palette = {
  dark: {
    background: '#15181E',
    surface: '#1E232B',
    elevated: '#272E38',
    primary: '#8EA8FF',
    onPrimary: '#0F1424',
    text: '#F2F4F8',
    secondary: '#929BAA',
    border: '#343B46',
    danger: '#FF8A8A',
    success: '#7ED6A7',
    vault: '#C7A6FF',
    media: '#7FD3D8',
    overlay: 'rgba(0,0,0,0.55)',
  },
  light: {
    background: '#F5F6F9',
    surface: '#FFFFFF',
    elevated: '#ECEFF4',
    primary: '#526FE0',
    onPrimary: '#FFFFFF',
    text: '#202531',
    secondary: '#737D8D',
    border: '#E2E6ED',
    danger: '#D6455D',
    success: '#2E9E6A',
    vault: '#7C5CD6',
    media: '#2B9AA3',
    overlay: 'rgba(16,20,30,0.35)',
  },
} as const;

export type ColorScheme = keyof typeof palette;
export type Colors = { [K in keyof (typeof palette)['dark']]: string };

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600', letterSpacing: 0.2 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  mono: { fontSize: 14, lineHeight: 20, fontFamily: 'monospace' },
} as const;

export type TypographyVariant = keyof typeof typography;

export const motion = { fast: 150, normal: 220, slow: 320 } as const;
