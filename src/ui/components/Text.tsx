import { Text as RNText, type TextProps } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import type { TypographyVariant } from '../theme/tokens';

type Tone = 'default' | 'secondary' | 'primary' | 'danger' | 'onPrimary';

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  tone?: Tone;
}

export function Text({ variant = 'body', tone = 'default', style, ...rest }: AppTextProps) {
  const { colors, typography } = useTheme();
  const color =
    tone === 'secondary'
      ? colors.secondary
      : tone === 'primary'
        ? colors.primary
        : tone === 'danger'
          ? colors.danger
          : tone === 'onPrimary'
            ? colors.onPrimary
            : colors.text;
  return <RNText maxFontSizeMultiplier={2} {...rest} style={[typography[variant], { color }, style]} />;
}
