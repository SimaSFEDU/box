import { requireOptionalNativeModule } from 'expo';

interface SecureUiNative {
  setSecureWindow(enabled: boolean): Promise<boolean>;
}

const native = requireOptionalNativeModule<SecureUiNative>('ClipboxSecureUi');

/**
 * Enables/disables FLAG_SECURE for the current activity.
 * Returns false when the native module is unavailable (e.g. tests) — callers protecting
 * sensitive screens must treat `false` as "not protected" and refuse to render secrets.
 */
export async function setSecureWindow(enabled: boolean): Promise<boolean> {
  if (!native) return false;
  return native.setSecureWindow(enabled);
}

export const isNativeAvailable = native !== null;
