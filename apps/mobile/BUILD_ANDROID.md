# Building the DATUM Android APK (EAS)

This produces an installable test APK for Wilson's phone — no Play Store, no
Apple/Google review, just a direct install link/QR from Expo.

## One-time setup (do these in order, once)

```bash
# 1. Install the EAS CLI and log in (free expo.dev account is enough for internal builds)
npm i -g eas-cli
eas login

# 2. Link this project to an EAS project (writes extra.eas.projectId into app.json — commit it)
cd apps/mobile
eas init

# 3. Kick off the Android build (preview profile = internal-distribution APK)
eas build -p android --profile preview
```

Step 3 takes roughly 15 minutes. When it finishes, EAS emails an install
link/QR code — open it on the Android phone (or scan the QR) to download and
install the APK directly (allow "install from unknown sources" if prompted;
this is a direct sideload, not a Play Store install).

## Build profiles (`eas.json`)

- **development** — dev-client APK, for use with `expo start` during active development.
- **preview** — internal-distribution APK. This is the one Wilson installs to test.
- **production** — has no `distribution`/`buildType` override yet, so it currently defaults to a store-format app bundle (.aab), **not** an installable APK — treat it as a placeholder until Play Store submission is wired up; `autoIncrement: true` bumps the Android `versionCode` automatically on each build.

## Environment values baked into the build

`preview` and `production` set `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` directly in `eas.json`. These are the same
publishable Supabase URL/anon key that already ship inside the web app's
JS bundle today (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
in `apps/web/.env.local`) — safe to commit, they carry no privileged access.

`EXPO_PUBLIC_WEB_BASE_URL` is **not** set. That variable points the mobile
app at the DATUM web app's server routes for Claude/Anthropic-powered
features (e.g. `/api/areas/suggest`). No production web URL was obvious from
the current env/config, so it's left unset. Per `lib/env.ts`, AI-powered
features are designed to hide gracefully when this is unset — the rest of
the app works normally. Once the web app has a stable prod URL, add
`EXPO_PUBLIC_WEB_BASE_URL` to the `preview`/`production` env blocks in
`eas.json` to light those features up.

## App icon caveat

`app.json` now points `icon` / `android.adaptiveIcon` at the asset files in
`assets/images/` (`icon.png`, `android-icon-foreground.png`,
`android-icon-background.png`, `android-icon-monochrome.png`). These are
still the **default Expo template assets** (the Expo "wordmark" logo) from
the original app scaffold — not DATUM branding. The build will produce a
real, working icon (not the bare Expo-default fallback), but it will look
like stock Expo artwork until someone drops in real DATUM icon files at
those same paths and rebuilds.

## On-device smoke test

After installing the APK:

1. Open DATUM, log in.
2. In WhatsApp (or any gallery/photo app), select 2 photos → Share → **DATUM**.
3. In the share sheet that opens inside DATUM, pick a project/topic, then
   pick an **existing card**.
4. Confirm: both photos land as attachments on that card, and the caption
   you typed (if any) is saved.
5. Wait for the next attachment-captioning cron run, then reopen the card
   and confirm an AI-generated caption appears on the photos.
6. Repeat the whole flow, but this time choose **"Kartu baru"** (new card)
   instead of an existing card — confirm a new card is created with the
   photos + caption, and it likewise picks up an AI caption after the cron.

If any step fails, capture a screenshot + the Android logcat around the
share action (`adb logcat` while reproducing) before filing a bug.

## Follow-up: push notifications (not in this build)

This build does **not** wire up push notifications (FCM). That's separate,
later work:

1. Create a Firebase project, add the Android app (`studio.wha.datum`),
   download `google-services.json`.
2. Add `google-services.json` to `apps/mobile/` (gitignored — do not commit
   it) and reference it from `app.json` (`android.googleServicesFile`).
3. Run `eas credentials` to upload the FCM server key / service account to
   EAS so push notifications work in production builds.

Until that's done, in-app notifications work but OS-level push
notifications will not be delivered to a backgrounded/closed app.
