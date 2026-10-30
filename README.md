# DevFlow Native Android — v2.0.0

DevFlow has been ported from React Native/Expo to a native Kotlin + Jetpack Compose Android app. This removes the Expo prebuild and Metro runtime from DevFlow itself, which were the source of the setup path described in the previous version. APK compilation is handled by GitHub Actions.

## Included

- Native Android UI using the same white / glass-card / lime-green visual direction.
- Home, Projects, Builds, Deployments and Settings sections.
- ZIP selection through Android's system document picker.
- ZIP extraction with path traversal checks, `.git` / `__MACOSX` skipping, a 700-file cap and a 2 MB per-file cap.
- GitHub PAT validation, repository listing, repository creation and batched Git Data API file upload.
- Adds an Android APK workflow for recognized Gradle or Expo projects when the imported archive has no workflow.
- GitHub Actions workflow dispatch and workflow-run listing.
- Vercel token validation, project listing and a best-effort Git-source deployment request.
- Gemini API key validation.
- EncryptedSharedPreferences-backed token storage when AndroidX Security can initialize; falls back to app-private SharedPreferences if encryption initialization fails.
- GitHub Actions workflow to build and upload `app-debug.apk` as `devflow-apk`.

## Build APK

1. Upload this repository to GitHub (or replace the contents of your existing `jarvis799/devflow` repository after backing it up).
2. Open **Actions → Build DevFlow APK → Run workflow**.
3. Download the `devflow-apk` artifact from the successful run.

The workflow uses a GitHub-hosted Ubuntu runner, JDK 17, Gradle 8.9 and Android Gradle Plugin 8.7.3. No Android SDK installation is required on your phone.

## Permissions / APIs

The app requests only Internet permission. GitHub token needs repository access plus Actions workflow permission to dispatch builds. Vercel deployments require a configured GitHub integration and may need adjustments for team-scoped Vercel projects or repository linking. Gemini is currently validated and stored; AI-based build-log diagnosis and approved patch application are not included in this native port yet.

## Important scope notes

This is a native rewrite of the supplied project, not a byte-for-byte conversion. Core UI and service connection flows are implemented. Compared with the original Expo source, build-failure Gemini diagnosis, detailed job-step polling, artifact download/extraction, and website HTML customization are not yet implemented in this version. A GitHub workflow can only be dispatched if the target repository contains the expected workflow name and branch. Debug APK is not Play Store signed.

## Package

`com.devflow.app` — version `2.0.0`
