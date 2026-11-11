import { useState } from 'react';
import { View } from 'react-native';

import { toAppError } from '../../core/errors';
import { generatePassword } from '../../secure/vaultService';
import { Button, Chip, Icon, PressableScale, Text } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { StrengthMeter } from './StrengthMeter';

type Options = { length: number; lower: boolean; upper: boolean; digits: boolean; symbols: boolean; avoidAmbiguous: boolean };
const DEFAULTS: Options = { length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: true };

function make(o: Options): { o: Options; pw: string; error: string | null } {
  try {
    return { o, pw: generatePassword(o), error: null };
  } catch (e) {
    return { o, pw: '', error: toAppError(e).userMessage };
  }
}

export function GeneratorPanel({ onUse }: { onUse?: (pw: string) => void }) {
  const { colors, spacing, radius, typography } = useTheme();
  const [state, setState] = useState(() => make(DEFAULTS));
  const { o, pw, error } = state;
  const update = (next: Options) => setState(make(next));
  const regen = () => update(o);
  const toggle = (k: 'lower' | 'upper' | 'digits' | 'symbols' | 'avoidAmbiguous') => update({ ...o, [k]: !o[k] });
  const step = (d: number) => update({ ...o, length: Math.min(128, Math.max(8, o.length + d)) });

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ backgroundColor: colors.elevated, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text selectable style={[typography.mono, { flex: 1, color: colors.text }]}>
          {pw}
        </Text>
        <PressableScale accessibilityLabel="Сгенерировать заново" onPress={regen} style={{ padding: spacing.xs }}>
          <Icon name="refresh-cw" size={18} color={colors.primary} />
        </PressableScale>
      </View>
      <StrengthMeter password={pw} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ flex: 1 }}>Длина: {o.length}</Text>
        <Button label="−4" variant="secondary" onPress={() => step(-4)} />
        <Button label="−1" variant="secondary" onPress={() => step(-1)} />
        <Button label="+1" variant="secondary" onPress={() => step(1)} />
        <Button label="+4" variant="secondary" onPress={() => step(4)} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Chip label="a-z" selected={o.lower} onPress={() => toggle('lower')} />
        <Chip label="A-Z" selected={o.upper} onPress={() => toggle('upper')} />
        <Chip label="0-9" selected={o.digits} onPress={() => toggle('digits')} />
        <Chip label="!@#" selected={o.symbols} onPress={() => toggle('symbols')} />
        <Chip label="Без похожих (l1O0)" selected={o.avoidAmbiguous} onPress={() => toggle('avoidAmbiguous')} />
      </View>
      {error ? <Text tone="danger">{error}</Text> : null}
      {onUse ? <Button label="Использовать" icon="check" onPress={() => onUse(pw)} disabled={!pw} /> : null}
    </View>
  );
}
