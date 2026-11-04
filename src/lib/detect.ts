import { ZipFile } from './zip';

export type ProjectKind = 'android' | 'react-native' | 'expo' | 'vite' | 'next' | 'react' | 'static';

export const kindLabel: Record<ProjectKind, string> = {
  android: 'Native Android',
  'react-native': 'React Native',
  expo: 'Expo',
  vite: 'Vite web app',
  next: 'Next.js',
  react: 'React web app',
  static: 'Static website',
};

export type Detection = {
  kind: ProjectKind;
  label: string;
  gradle: boolean;
  workflow: boolean;
  framework?: string;
  buildCommand?: string;
  outputDirectory?: string;
};

function has(files: ZipFile[], name: string) {
  return files.some((f) => f.path === name || f.path.endsWith('/' + name));
}

function readJson(files: ZipFile[], name: string) {
  const file = files.find((f) => f.path === name || f.path.endsWith('/' + name));
  if (!file || file.encoding !== 'utf-8') return null;
  try {
    return JSON.parse(file.content);
  } catch {
    return null;
  }
}

export function detectProject(files: ZipFile[]): Detection {
  const pkg = readJson(files, 'package.json');
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };

  const gradle =
    has(files, 'settings.gradle') ||
    has(files, 'settings.gradle.kts') ||
    has(files, 'build.gradle') ||
    has(files, 'build.gradle.kts');
  const appModule = files.some((f) => /(^|\/)app\/build\.gradle(\.kts)?$/.test(f.path));
  const workflow = files.some((f) => f.path.startsWith('.github/workflows/') && /\.ya?ml$/.test(f.path));

  const base = { gradle, workflow } as Detection;

  // A JSON app.json is not proof of Expo: bare React Native projects ship the same
  // file ({"name","displayName"}). Only an Expo config carries an `expo` key, so
  // keying the check on that stops bare RN projects being routed to the Expo
  // build workflow (which runs `expo prebuild` and fails without Expo installed).
  const expoConfig = readJson(files, 'app.json');
  if (deps.expo || Boolean(expoConfig && expoConfig.expo)) {
    return { ...base, kind: 'expo', label: kindLabel.expo, framework: 'expo' };
  }
  if (deps['react-native']) {
    return { ...base, kind: 'react-native', label: kindLabel['react-native'], framework: 'react-native' };
  }
  if (gradle && appModule) {
    return { ...base, kind: 'android', label: kindLabel.android };
  }
  if (deps.next || has(files, 'next.config.js') || has(files, 'next.config.mjs')) {
    return {
      ...base,
      kind: 'next',
      label: kindLabel.next,
      framework: 'nextjs',
      buildCommand: 'next build',
      outputDirectory: '.next',
    };
  }
  if (deps.vite || has(files, 'vite.config.js') || has(files, 'vite.config.ts')) {
    return {
      ...base,
      kind: 'vite',
      label: kindLabel.vite,
      framework: 'vite',
      buildCommand: pkg?.scripts?.build || 'vite build',
      outputDirectory: 'dist',
    };
  }
  if (deps.react) {
    return {
      ...base,
      kind: 'react',
      label: kindLabel.react,
      framework: 'create-react-app',
      buildCommand: pkg?.scripts?.build || 'react-scripts build',
      outputDirectory: 'build',
    };
  }
  if (has(files, 'index.html')) {
    return { ...base, kind: 'static', label: kindLabel.static, framework: 'static', outputDirectory: '.' };
  }
  return { ...base, kind: 'static', label: 'Unknown project', outputDirectory: '.' };
}

export const APK_WORKFLOW_PATH = '.github/workflows/android-apk.yml';

export function apkWorkflowYaml(): string {
  return `name: Build Android APK

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - name: Install dependencies
        run: |
          if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi
      - name: Align Expo packages
        run: npx expo install --fix
      - name: Prebuild Android project
        run: npx expo prebuild --platform android --no-install
      - name: Build debug APK
        run: |
          cd android
          chmod +x gradlew
          ./gradlew assembleDebug --no-daemon
      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: devflow-apk
          path: android/app/build/outputs/apk/debug/*.apk
          if-no-files-found: error
`;
}

export function androidWorkflowYaml(): string {
  return `name: Build Android APK

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - name: Build debug APK
        run: |
          chmod +x gradlew || true
          ./gradlew assembleDebug --no-daemon
      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: app-debug
          path: '**/build/outputs/apk/debug/*.apk'
          if-no-files-found: error
`;
}

export function workflowFor(kind: ProjectKind): { path: string; content: string } | null {
  if (kind === 'expo' || kind === 'react-native') return { path: APK_WORKFLOW_PATH, content: apkWorkflowYaml() };
  if (kind === 'android') return { path: APK_WORKFLOW_PATH, content: androidWorkflowYaml() };
  return null;
}