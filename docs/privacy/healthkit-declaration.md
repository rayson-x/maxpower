# MaxPower HealthKit read declaration

Status: implementation-aligned declaration; App Store Connect submission and
device verification remain release-gate evidence, not completed by this file.

## Data requested

MaxPower requests read access only after a feature-specific user action, and
only for the selected record types:

- sleep analysis;
- heart-rate variability SDNN;
- resting heart rate;
- completed workouts/activity;
- body mass; and
- body-fat percentage.

The app does not request write access, health records, clinical records,
location routes, calories for TDEE claims, diagnoses, recovery scores or plans.

## Purpose and handling

The native HealthKit module emits a bounded page of primitive observations and
an opaque per-type anchor. The local Product Kernel commits the normalized evidence,
its source/device provenance and the anchor together to the local SQLite
ledger. A failed commit leaves the anchor unadvanced. Deleted sample UUIDs
become Timeline tombstones; imported facts preserve their original source and
time metadata.

HealthKit does not expose a reliable per-type read-grant state. The product
therefore labels a completed request as **requested / read status unknown**;
an empty query is never displayed as proof that the person has no historical
data, denied access, normal recovery or a completed workout.

The health adapter never sends HealthKit data to an LLM, sync service or
analytics service by itself. If the user separately enables remote LLM or
replica sync, their existing consent and privacy policy controls determine
what task-relevant, de-identified context may leave the device. Raw media is
not a HealthKit payload.

## Configuration consistency checklist

- `modules/health-connect/ios/MaxPowerHealthKitModule.swift` is the sole
  importer of HealthKit framework types.
- `plugins/withMaxPowerHealthKit.js` adds the HealthKit entitlement and the
  read-purpose string during prebuild.
- `app.json` includes that plugin.
- The privacy nutrition/fitness declaration in App Store Connect must list
  exactly the six types above and the same on-device coaching purpose before
  release.
- Real iPhone and Apple Watch source/anchor/delete/background verification is
  required by ticket 19 before claiming production acceptance.
