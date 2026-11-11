import type { AppError } from '../../core/errors';
import { EmptyState } from './EmptyState';

export function ErrorView({ error, onRetry }: { error: AppError; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="alert-circle"
      title={error.userMessage}
      message={`Код: ${error.code}`}
      actionLabel={onRetry ? 'Повторить' : undefined}
      onAction={onRetry}
    />
  );
}
