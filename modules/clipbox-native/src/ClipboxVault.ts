import { requireOptionalNativeModule } from 'expo';

export type ProtectedModule = 'vault' | 'media';
export type BiometricStatus = 'available' | 'none_enrolled' | 'unavailable';

export interface UnlockMeta {
  kdfParams: string;
  wrappedPw: string;
  wrappedRecovery?: string | null;
  wrappedBio?: string | null;
  dekCheck: string;
}

export interface SetupResult {
  kdfParams: string;
  wrappedPw: string;
  dekCheck: string;
  wrappedRecovery?: string;
  recoveryKey?: string;
}

export interface PromptText {
  title: string;
  subtitle?: string | null;
  negative: string;
}

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
}

/** Native API (Kotlin: ClipboxVaultModule). All keys stay native; strings are base64 ciphertext. */
export interface ClipboxVaultNative {
  isUnlocked(m: ProtectedModule): boolean;
  setLockPolicy(m: ProtectedModule, idleMs: number, backgroundMs: number): void;
  touch(m: ProtectedModule): void;
  lock(m: ProtectedModule): void;
  lockAll(): void;
  biometricStatus(): BiometricStatus;
  hasBiometricKey(m: ProtectedModule): boolean;
  setup(m: ProtectedModule, password: string, withRecovery: boolean): Promise<SetupResult>;
  unlockWithPassword(m: ProtectedModule, password: string, meta: UnlockMeta): Promise<boolean>;
  unlockWithRecovery(m: ProtectedModule, recoveryKey: string, meta: UnlockMeta): Promise<boolean>;
  changePassword(m: ProtectedModule, newPassword: string): Promise<{ kdfParams: string; wrappedPw: string }>;
  newRecoveryKey(m: ProtectedModule): Promise<{ recoveryKey: string; wrappedRecovery: string }>;
  enableBiometric(m: ProtectedModule, text: PromptText): Promise<string>;
  unlockWithBiometric(m: ProtectedModule, meta: UnlockMeta, text: PromptText): Promise<boolean>;
  disableBiometric(m: ProtectedModule): void;
  destroyModuleKeys(m: ProtectedModule): void;
  seal(m: ProtectedModule, plaintext: string, ad: string): Promise<string>;
  open(m: ProtectedModule, ciphertext: string, ad: string): Promise<string>;
  openMany(m: ProtectedModule, items: [string, string][]): Promise<(string | null)[]>;
  generatePassword(o: PasswordOptions): string;
  copySensitive(text: string, clearAfterMs: number): Promise<void>;
  clearClipboardIfOurs(): Promise<boolean>;
}

/** Null when the native module is not linked (unit tests, Expo Go). Protected features must refuse to run then. */
export const ClipboxVault = requireOptionalNativeModule<ClipboxVaultNative>('ClipboxVault');
