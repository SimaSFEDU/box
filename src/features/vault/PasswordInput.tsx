import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { Icon, PressableScale } from '../../ui/components';
import { useTheme } from '../../ui/theme/ThemeProvider';

/** Secret text input: hidden by default, no autocorrect/suggestions, excluded from autofill saving. */
export function PasswordInput(props: TextInputProps & { revealable?: boolean }) {
  const { colors, spacing, typography, radius } = useTheme();
  const [visible, setVisible] = useState(false);
  const { revealable = true, style, ...rest } = props;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }}>
      <TextInput
        {...rest}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
        spellCheck={false}
        placeholderTextColor={colors.secondary}
        style={[typography.body, { flex: 1, color: colors.text, padding: spacing.md, minHeight: 48 }, style]}
      />
      {revealable ? (
        <PressableScale accessibilityLabel={visible ? 'Скрыть' : 'Показать'} onPress={() => setVisible((v) => !v)} style={{ padding: spacing.md }}>
          <Icon name={visible ? 'eye-off' : 'eye'} size={18} color={colors.secondary} />
        </PressableScale>
      ) : null}
    </View>
  );
}
