import { AppError } from '../core/errors';

const MESSAGES: Record<string, [AppError['code'], string]> = {
  CRYPTO_AUTH_FAILED: ['CRYPTO_AUTH_FAILED', 'Неверный пароль или ключ'],
  CRYPTO_CORRUPTED: ['CRYPTO_CORRUPTED', 'Запись повреждена и не может быть расшифрована'],
  AUTH_REQUIRED: ['AUTH_REQUIRED', 'Хранилище заблокировано'],
  INVALID_RECOVERY_KEY: ['VALIDATION', 'Ключ восстановления введён неверно'],
  BIO_CANCELED: ['AUTH_REQUIRED', 'Отменено'],
  BIO_LOCKOUT: ['AUTH_REQUIRED', 'Слишком много попыток. Используйте мастер-пароль'],
  BIO_INVALIDATED: ['AUTH_REQUIRED', 'Биометрия на устройстве изменилась. Войдите по мастер-паролю и включите её снова'],
  BIO_NOT_ENROLLED: ['AUTH_REQUIRED', 'Вход по биометрии не настроен'],
  BIO_UNAVAILABLE: ['AUTH_REQUIRED', 'Биометрия недоступна на этом устройстве'],
  BIO_FAILED: ['AUTH_REQUIRED', 'Не удалось подтвердить биометрию'],
  NO_ACTIVITY: ['UNKNOWN', 'Приложение не на экране'],
  VALIDATION: ['VALIDATION', 'Некорректные параметры'],
};

/** Maps native CodedException codes to AppError. Never includes native messages (could hint at internals). */
export function secureError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const code = (e as { code?: unknown })?.code;
  const hit = typeof code === 'string' ? MESSAGES[code] : undefined;
  const err = new AppError(hit?.[0] ?? 'UNKNOWN', hit?.[1] ?? 'Операция с защищённым хранилищем не выполнена');
  (err as { nativeCode?: string }).nativeCode = typeof code === 'string' ? code : undefined;
  return err;
}

export const nativeCode = (e: unknown): string | undefined => (e as { nativeCode?: string })?.nativeCode;
