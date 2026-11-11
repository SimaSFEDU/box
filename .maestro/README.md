# E2E flows (Maestro)

Device-level checks that unit tests cannot cover (real Android, real Keystore, real notifications).

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash   # once
npx eas-cli@latest build --profile preview --platform android   # or a local dev build
maestro test .maestro                               # all non-manual flows
maestro test .maestro/05-vault-wrong-password.yaml  # manual/tagged flows explicitly
```

Biometric prompts, Share-sheet intake from other apps, Private Media import/share and the
backup round-trip are verified manually with the checklist in `docs/RELEASE.md`.
