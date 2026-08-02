# Account profile

An account profile is the user's approved persistent production configuration. It is not a login credential.

## Required decisions

- stable account ID and display name;
- platform and role (`main`, `experiment`, `vertical`, or `repost`);
- concrete audience description and content pillars;
- narrative tone, allowed hook types, and CTA style;
- duration target;
- intro, voice preset, BGM, visual profile, typography, and caption languages;
- publication mode and target cadence.

Use `assets/account-profile.template.yaml` as the onboarding template and validate it against `assets/account-profile.schema.json` before production.

## Inheritance

Reference existing global assets by path and expected preset ID. Do not duplicate large intro, voice, BGM, font, or style files into every account directory. Put only genuine account-specific overrides under the account's `shared/` directory.

An approved account profile may serve as the explicit task configuration for voice and visual choices. It does not authorize publication, cross-pair a voice with an incompatible intro, or override safety and evidence rules.

## Secrets

Allow `credential_alias`, which identifies an external secure login state. Reject keys or values that contain passwords, cookies, tokens, secrets, SMS codes, API keys, or raw authentication material.
