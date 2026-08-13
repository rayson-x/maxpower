# MaxPower nutrition-photo processing boundary

Status: implementation contract. Provider selection, privacy-policy text and
store declarations must be reviewed again for every model/provider change.

## What can leave the device

Only after an explicit `provider_authorized` confirmation, the nutrition photo
adapter may send the user-selected meal text and a transient sanitized image
payload to the configured provider. It sends no local path, filename, EXIF,
GPS, XMP, arbitrary URL, training video, Timeline history or hidden gallery
media. The provider credential is read from the platform secure credential
port; it is not included in the ledger, Action Log, exported data or Coach
messages.

Before upload, the adapter verifies magic bytes and declared MIME, bounds file
size and pixels, and removes JPEG APP1–APP15, PNG EXIF/text and WebP EXIF/XMP
metadata from the transient bytes. It does not overwrite the original local
media. The implementation cannot reliably discover or erase all visual PII
(such as a face, address or receipt text); the UI must say so before upload.

## Product semantics

Remote output is a `NutritionObservationDraft`, not an intake fact. It must
contain ranges and assumptions, and must be confirmed or edited through a
deterministic local action before a `user_confirmed_estimate` Timeline entry
exists. Rejection, cancellation, offline mode, schema failure and Provider
failure leave Timeline, NutritionStrategy and Plan unchanged. Local precise,
label and simplified meal records remain usable with no provider.

Photos are local-only by default and excluded from replica sync. Users can
delete an unconfirmed draft or its local photo; confirmed nutrition facts are
corrected/tombstoned through the Timeline rather than destructive rewrite.
