#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeSync,
} from 'node:fs';
import nodeOs from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);

const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return args[index + 1];
};

const hasFlag = (name) => args.includes(`--${name}`);

const os = getArg('os');
const variant = getArg('variant') ?? 'full';
const appImageRuntimeFileArg = getArg('appimage-runtime-file');
const sign = hasFlag('sign');
const skipNodeRuntime = hasFlag('skip-node-runtime');
const showHelp = hasFlag('help') || hasFlag('h');

const validOs = new Set(['macos', 'windows', 'linux']);
const validVariants = new Set(['full', 'tech', 'finance']);
const usage =
  'Usage: npm run desktop:package -- --os <macos|windows|linux> --variant <full|tech|finance> [--sign] [--skip-node-runtime] [--appimage-runtime-file <path>]';

if (showHelp) {
  console.log(usage);
  process.exit(0);
}

if (!validOs.has(os)) {
  console.error(usage);
  process.exit(1);
}

if (!validVariants.has(variant)) {
  console.error('Invalid variant. Use --variant full, --variant tech, or --variant finance.');
  process.exit(1);
}

const syncVersionsResult = spawnSync(process.execPath, ['scripts/sync-desktop-version.mjs'], {
  stdio: 'inherit'
});
if (syncVersionsResult.error) {
  console.error(syncVersionsResult.error.message);
  process.exit(1);
}
if ((syncVersionsResult.status ?? 1) !== 0) {
  process.exit(syncVersionsResult.status ?? 1);
}

const bundles = os === 'macos' ? 'app,dmg' : os === 'linux' ? 'appimage' : 'nsis,msi';
const env = {
  ...process.env,
  VITE_VARIANT: variant,
  VITE_DESKTOP_RUNTIME: '1',
};
const cliArgs = ['build', '--bundles', bundles];
const tauriBin = path.join('node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');

const fileFromPath = (name) => {
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // noop
    }
  }
  return undefined;
};

const extractAppImageRuntime = (appImagePath, runtimePath) => {
  const offsetResult = spawnSync(appImagePath, ['--appimage-offset'], {
    env: {
      ...env,
      APPIMAGE_EXTRACT_AND_RUN: '1',
    },
    encoding: 'utf8',
  });
  if ((offsetResult.status ?? 1) !== 0) {
    return false;
  }

  const offset = Number.parseInt((offsetResult.stdout ?? '').trim(), 10);
  if (!Number.isInteger(offset) || offset <= 0) {
    return false;
  }

  const tempRuntimePath = `${runtimePath}.tmp`;
  rmSync(tempRuntimePath, { force: true });

  const inFd = openSync(appImagePath, 'r');
  const outFd = openSync(tempRuntimePath, 'w', 0o755);
  let wroteAllBytes = false;
  try {
    const chunkSize = 64 * 1024;
    const buffer = Buffer.allocUnsafe(chunkSize);
    let remaining = offset;
    let position = 0;
    while (remaining > 0) {
      const length = Math.min(chunkSize, remaining);
      const bytesRead = readSync(inFd, buffer, 0, length, position);
      if (bytesRead <= 0) break;
      writeSync(outFd, buffer, 0, bytesRead);
      remaining -= bytesRead;
      position += bytesRead;
    }
    wroteAllBytes = remaining === 0;
  } finally {
    closeSync(inFd);
    closeSync(outFd);
  }

  if (!wroteAllBytes) {
    rmSync(tempRuntimePath, { force: true });
    return false;
  }

  chmodSync(tempRuntimePath, 0o755);
  rmSync(runtimePath, { force: true });
  renameSync(tempRuntimePath, runtimePath);
  return true;
};

const ensureLinuxAppImageEnv = () => {
  if (os !== 'linux') return;

  env.XDG_CACHE_HOME ||= path.resolve('src-tauri', 'target', '.cache');
  const tauriToolsDir = path.join(env.XDG_CACHE_HOME, 'tauri');
  mkdirSync(tauriToolsDir, { recursive: true });

  const patchedGtkPlugin = path.resolve('scripts', 'linuxdeploy-plugin-gtk.sh');
  const gtkPluginTarget = path.join(tauriToolsDir, 'linuxdeploy-plugin-gtk.sh');
  if (existsSync(patchedGtkPlugin)) {
    copyFileSync(patchedGtkPlugin, gtkPluginTarget);
    chmodSync(gtkPluginTarget, 0o755);
  } else {
    console.warn(
      `[desktop-package] WARNING: missing patched gtk plugin at ${patchedGtkPlugin}. linuxdeploy may fail on systems with vmware overlay libraries.`
    );
  }

  const globalToolsDir = path.join(nodeOs.homedir(), '.cache', 'tauri');
  const runtimeCandidateFiles = ['runtime-x86_64', 'appimage-runtime-x86_64', 'type2-runtime-x86_64'];
  const seedFiles = [
    'linuxdeploy-x86_64.AppImage',
    'linuxdeploy',
    'linuxdeploy-plugin-appimage.AppImage',
    'linuxdeploy-plugin-gstreamer.sh',
    'AppRun-x86_64',
    ...runtimeCandidateFiles
  ];
  for (const file of seedFiles) {
    const source = path.join(globalToolsDir, file);
    const target = path.join(tauriToolsDir, file);
    if (!existsSync(target) && existsSync(source)) {
      copyFileSync(source, target);
      chmodSync(target, 0o755);
    }
  }

  const linuxdeployAppImage = path.join(tauriToolsDir, 'linuxdeploy-x86_64.AppImage');
  if (!existsSync(linuxdeployAppImage)) {
    const systemLinuxdeploy = fileFromPath('linuxdeploy');
    if (systemLinuxdeploy && existsSync(systemLinuxdeploy)) {
      copyFileSync(systemLinuxdeploy, linuxdeployAppImage);
      chmodSync(linuxdeployAppImage, 0o755);
    }
  }

  const linuxdeployShim = path.join(tauriToolsDir, 'linuxdeploy');
  if (existsSync(linuxdeployAppImage)) {
    try {
      rmSync(linuxdeployShim, { force: true });
      symlinkSync(path.basename(linuxdeployAppImage), linuxdeployShim);
    } catch {
      copyFileSync(linuxdeployAppImage, linuxdeployShim);
    }
    chmodSync(linuxdeployShim, 0o755);
  }

  env.PATH = `${tauriToolsDir}${path.delimiter}${env.PATH ?? ''}`;
  env.NO_STRIP ||= '1';
  env.APPIMAGE_EXTRACT_AND_RUN ||= '1';

  let runtimeFile = appImageRuntimeFileArg || env.LDAI_RUNTIME_FILE;
  if (!runtimeFile) {
    for (const candidate of runtimeCandidateFiles) {
      const candidatePath = path.join(tauriToolsDir, candidate);
      if (existsSync(candidatePath)) {
        runtimeFile = candidatePath;
        break;
      }
    }
  }
  if (!runtimeFile) {
    const extractedRuntime = path.join(tauriToolsDir, 'runtime-x86_64');
    if (existsSync(linuxdeployAppImage) && extractAppImageRuntime(linuxdeployAppImage, extractedRuntime)) {
      runtimeFile = extractedRuntime;
    }
  }
  if (runtimeFile) {
    const resolvedRuntimeFile = path.resolve(runtimeFile);
    if (!existsSync(resolvedRuntimeFile)) {
      console.error(
        `[desktop-package] AppImage runtime file not found: ${resolvedRuntimeFile}. Provide a valid --appimage-runtime-file path or unset LDAI_RUNTIME_FILE.`
      );
      process.exit(1);
    }
    env.LDAI_RUNTIME_FILE = resolvedRuntimeFile;
    console.log(`[desktop-package] Using AppImage runtime file: ${resolvedRuntimeFile}`);
  } else {
    console.log(
      '[desktop-package] No local AppImage runtime file found. appimagetool will attempt a runtime download unless LDAI_RUNTIME_FILE is provided.'
    );
  }

  const appImageDirName =
    variant === 'tech'
      ? 'Tech Monitor.AppDir'
      : variant === 'finance'
        ? 'Finance Monitor.AppDir'
        : 'World Monitor.AppDir';
  const staleAppDir = path.resolve('src-tauri', 'target', 'release', 'bundle', 'appimage', appImageDirName);
  rmSync(staleAppDir, { recursive: true, force: true });

  console.log(`[desktop-package] Linux AppImage cache: ${tauriToolsDir}`);
};

ensureLinuxAppImageEnv();

if (!existsSync(tauriBin)) {
  console.error(
    `Local Tauri CLI not found at ${tauriBin}. Run \"npm ci\" to install dependencies before desktop packaging.`
  );
  process.exit(1);
}

if (variant === 'tech') {
  cliArgs.push('--config', 'src-tauri/tauri.tech.conf.json');
}
if (variant === 'finance') {
  cliArgs.push('--config', 'src-tauri/tauri.finance.conf.json');
}

const resolveNodeTarget = () => {
  if (env.NODE_TARGET) return env.NODE_TARGET;
  if (os === 'windows') return 'x86_64-pc-windows-msvc';
  if (os === 'linux') return 'x86_64-unknown-linux-gnu';
  if (os === 'macos') {
    if (process.arch === 'arm64') return 'aarch64-apple-darwin';
    if (process.arch === 'x64') return 'x86_64-apple-darwin';
  }
  return '';
};

if (sign) {
  if (os === 'macos') {
    const hasIdentity = Boolean(env.TAURI_BUNDLE_MACOS_SIGNING_IDENTITY || env.APPLE_SIGNING_IDENTITY);
    const hasProvider = Boolean(env.TAURI_BUNDLE_MACOS_PROVIDER_SHORT_NAME);
    if (!hasIdentity || !hasProvider) {
      console.error(
        'Signing requested (--sign) but missing macOS signing env vars. Set TAURI_BUNDLE_MACOS_SIGNING_IDENTITY (or APPLE_SIGNING_IDENTITY) and TAURI_BUNDLE_MACOS_PROVIDER_SHORT_NAME.'
      );
      process.exit(1);
    }
  }

  if (os === 'windows') {
    const hasThumbprint = Boolean(env.TAURI_BUNDLE_WINDOWS_CERTIFICATE_THUMBPRINT);
    const hasPfx = Boolean(env.TAURI_BUNDLE_WINDOWS_CERTIFICATE && env.TAURI_BUNDLE_WINDOWS_CERTIFICATE_PASSWORD);
    if (!hasThumbprint && !hasPfx) {
      console.error(
        'Signing requested (--sign) but missing Windows signing env vars. Set TAURI_BUNDLE_WINDOWS_CERTIFICATE_THUMBPRINT or TAURI_BUNDLE_WINDOWS_CERTIFICATE + TAURI_BUNDLE_WINDOWS_CERTIFICATE_PASSWORD.'
      );
      process.exit(1);
    }
  }
}

if (!skipNodeRuntime) {
  const nodeTarget = resolveNodeTarget();
  if (!nodeTarget) {
    console.error(
      `Unable to infer Node runtime target for OS=${os} ARCH=${process.arch}. Set NODE_TARGET explicitly or pass --skip-node-runtime.`
    );
    process.exit(1);
  }
  console.log(
    `[desktop-package] Bundling Node runtime TARGET=${nodeTarget} VERSION=${env.NODE_VERSION ?? '22.14.0'}`
  );
  const downloadResult = spawnSync('bash', ['scripts/download-node.sh', '--target', nodeTarget], {
    env: {
      ...env,
      NODE_TARGET: nodeTarget
    },
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (downloadResult.error) {
    console.error(downloadResult.error.message);
    process.exit(1);
  }
  if ((downloadResult.status ?? 1) !== 0) {
    process.exit(downloadResult.status ?? 1);
  }
}

console.log(`[desktop-package] OS=${os} VARIANT=${variant} BUNDLES=${bundles} SIGN=${sign ? 'on' : 'off'}`);

const result = spawnSync(tauriBin, cliArgs, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
