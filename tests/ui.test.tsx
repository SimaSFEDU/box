import { fireEvent, render, screen } from '@testing-library/react-native';

import { useSettingsStore } from '../src/stores/settingsStore';
import { Button, EmptyState, SegmentedControl } from '../src/ui/components';
import { ThemeProvider } from '../src/ui/theme/ThemeProvider';
import { palette } from '../src/ui/theme/tokens';

jest.mock('../src/data/db/database', () => ({ getDb: jest.fn() }));

const wrap = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('design system', () => {
  it.each(['light', 'dark'] as const)('applies the %s palette', async (mode) => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, themeMode: mode } });
    await wrap(<EmptyState icon="inbox" title="Пусто" />);
    expect(screen.getByText('Пусто')).toHaveStyle({ color: palette[mode].text });
  });

  it('button fires', async () => {
    const onPress = jest.fn();
    await wrap(<Button label="Сохранить" onPress={onPress} />);
    await fireEvent.press(screen.getByLabelText('Сохранить'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled button does not fire', async () => {
    const off = jest.fn();
    await wrap(<Button label="Нельзя" onPress={off} disabled />);
    await fireEvent.press(screen.getByLabelText('Нельзя'));
    expect(off).not.toHaveBeenCalled();
  });

  it('segmented control reports selection', async () => {
    const onChange = jest.fn();
    await wrap(
      <SegmentedControl
        segments={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        value="a"
        onChange={onChange}
      />,
    );
    await fireEvent.press(screen.getByText('B'));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
