import { EmptyState, Screen } from '../../ui/components';

export default function RemindersScreen() {
  return (
    <Screen title="Reminders">
      <EmptyState
        icon="bell"
        title="Напоминаний нет"
        message="Локальные напоминания с повторами появятся в одном из ближайших обновлений."
      />
    </Screen>
  );
}
