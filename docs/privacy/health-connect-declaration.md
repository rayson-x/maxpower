# MaxPower Health Connect declaration

This is the release checklist and in-product rationale source for the Android Health Connect integration. Keep it aligned with `app.json`, `modules/health-connect/android/src/main/java/expo/modules/maxpowerhealthconnect/MaxPowerHealthConnectModule.kt`, and the Play Console declaration before each release.

## Read-only data scope

| Health Connect permission | Product purpose | Local behavior |
| --- | --- | --- |
| `READ_SLEEP` | Show recorded sleep in Timeline and form a conservative recovery constraint. | Imports sleep sessions as provenance-bearing evidence; incomplete stages remain unknown. |
| `READ_HEART_RATE_VARIABILITY` | Read HRV **RMSSD** as one optional recovery input. | Never converts it to SDNN or a proprietary readiness score. |
| `READ_RESTING_HEART_RATE` | Show resting heart-rate observations with their source. | Does not average records from different sources. |
| `READ_EXERCISE` | Record completed external activity and workout duration. | Never imports planned workouts as completed sessions; never interprets calories as strength volume. |
| `READ_WEIGHT` | Display body-mass trend when the user chooses a comparable source. | Keeps source, time, unit and device provenance. |
| `READ_BODY_FAT` | Display body-fat trend only inside a compatible source/method series. | Does not merge cross-device measurements into one high-confidence trend. |

MaxPower does not request Health Connect write permissions, nutrition records, raw heart-rate samples, calories, strain/readiness scores, diagnostic records, or `READ_HEALTH_DATA_HISTORY` in this MVP. A request for history older than the platform default window needs a separate approved feature and an explicit user explanation.

## In-product rationale

The profile screen presents this disclosure immediately before the system request:

> You can choose sleep, RMSSD, resting heart rate, completed activity, weight, and body-fat records separately. MaxPower uses selected records only to show your Timeline and make conservative training/recovery suggestions. You can keep recording manually without connecting Health Connect.

The screen must continue to distinguish: unavailable device, Health Connect absent/update required, not requested, denied/revoked, partial grants, query failure, and stale existing evidence. None of these states means the user had no history or poor recovery.

## Storage and transfer

- The Android client maps platform records to local, provenance-bearing Timeline evidence through `CoachApplication`; the Android SDK never writes to the Ledger directly.
- Local records include Health Connect record ID, data-origin package, client ID/version when supplied, last-modified time, recording method, device metadata when supplied, and original timestamps/offsets.
- A deletion has only a record ID. MaxPower records the time its adapter observed that deletion; it never fabricates the original observation time.
- Health Connect data stays local unless the user separately enables the remote LLM provider or account synchronization. Those controls have their own disclosure and consent.
- The app neither sells health data nor uses it for advertising, eligibility, diagnosis, or medical decision-making.

## Release evidence required

Before submitting a release, record the device/OS/Health Connect version and verify each selected record type, partial grant, revoked permission, provider update flow, initial bounded import, token-expiry resync, upsert, deletion, process restart, offline read, and background/foreground catch-up. This document is not evidence that those checks have been run.
