#!/usr/bin/env node
/**
 * scripts/arch-package.mjs
 *
 * Converts a Tauri-built .deb into an Arch Linux .pkg.tar.zst.
 * Called automatically by desktop-package.mjs after a successful deb build
 * when --linux-bundle arch is specified.
 *
 * Can also be run standalone if a deb already exists:
 *   node scripts/arch-package.mjs --variant <full|tech|finance>
 *
 * Requirements (all in base-devel on Arch/CachyOS):
 *   ar (binutils), tar, bsdtar (libarchive)
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const variant = getArg('variant') ?? 'full';

// ── Read Tauri config ──────────────────────────────────────────────────────
const baseConf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const version = baseConf.version;
let binaryName = baseConf.mainBinaryName;
let productName = baseConf.productName;
let shortDesc = baseConf.bundle?.shortDescription ?? `${baseConf.productName} desktop app`;

if (variant !== 'full') {
  const varConf = JSON.parse(readFileSync(`src-tauri/tauri.${variant}.conf.json`, 'utf8'));
  binaryName = varConf.mainBinaryName ?? binaryName;
  productName = varConf.productName ?? productName;
  shortDesc = varConf.bundle?.shortDescription ?? shortDesc;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const run = (cmd, cmdArgs, opts = {}) => {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
  if (r.error) {
    console.error(`[arch-package] Failed to spawn '${cmd}': ${r.error.message}`);
    process.exit(1);
  }
  if ((r.status ?? 1) !== 0) {
    console.error(`[arch-package] '${cmd}' exited with status ${r.status}`);
    process.exit(r.status ?? 1);
  }
  return r;
};

// ── Locate deb ────────────────────────────────────────────────────────────
const debDir = path.resolve('src-tauri', 'target', 'release', 'bundle', 'deb');
if (!existsSync(debDir)) {
  console.error(`[arch-package] deb bundle directory not found: ${debDir}`);
  console.error('[arch-package] Build the deb first or use --linux-bundle arch which does it automatically.');
  process.exit(1);
}
// Tauri names deb files deterministically as `{productName}_{version}_amd64.deb`.
// Derive the exact name from config to avoid picking a stale deb from a different
// variant build that happens to sort alphabetically first.
const expectedDebName = `${productName}_${version}_amd64.deb`;
const debPath = path.resolve(debDir, expectedDebName);
if (!existsSync(debPath)) {
  const available = readdirSync(debDir).filter(f => f.endsWith('.deb')).join(', ') || 'none';
  console.error(`[arch-package] Expected deb not found: ${expectedDebName}`);
  console.error(`[arch-package] Available in ${debDir}: ${available}`);
  process.exit(1);
}
console.log(`[arch-package] Source deb: ${debPath}`);

// ── Staging directory ─────────────────────────────────────────────────────
const archOutDir = path.resolve('src-tauri', 'target', 'release', 'bundle', 'arch');
const stagingDir = path.join(archOutDir, 'staging');
rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

// ── Extract deb → filesystem tree ─────────────────────────────────────────
// A .deb is an `ar` archive containing:
//   debian-binary   — format version marker
//   control.tar.*   — package metadata
//   data.tar.*      — the actual installed files (usr/, opt/, etc.)
run('ar', ['x', debPath], { cwd: stagingDir });

const dataArchive = readdirSync(stagingDir).find(f => f.startsWith('data.tar.'));
if (!dataArchive) {
  console.error('[arch-package] data.tar.* not found after deb extraction');
  process.exit(1);
}
run('tar', ['-xf', dataArchive], { cwd: stagingDir });

// Remove deb wrapper files — keep only real filesystem paths (usr/, share/, etc.)
for (const f of readdirSync(stagingDir)) {
  if (f === 'debian-binary' || f.startsWith('control.tar.') || f.startsWith('data.tar.')) {
    rmSync(path.join(stagingDir, f), { force: true });
  }
}

// ── Installed size (bytes) ────────────────────────────────────────────────
const duResult = spawnSync('du', ['-sb', stagingDir], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const installedSize = parseInt((duResult.stdout ?? '0').split('\t')[0], 10) || 0;

// ── .PKGINFO ──────────────────────────────────────────────────────────────
// Arch package metadata — the only mandatory file for `pacman -U`
const pkginfo = [
  `pkgname = ${binaryName}`,
  `pkgver = ${version}-1`,
  `pkgdesc = ${shortDesc}`,
  `url = https://worldmonitor.app`,
  `builddate = ${Math.floor(Date.now() / 1000)}`,
  `packager = World Monitor Build System`,
  `size = ${installedSize}`,
  `arch = x86_64`,
  `license = custom`,
  // GStreamer deps — this is the whole point of the native package format:
  // the system package manager guarantees these are present before install.
  `depend = webkit2gtk-4.1`,
  `depend = gstreamer`,
  `depend = gst-plugins-base`,
  `depend = gst-plugins-good`,
  `depend = gst-plugins-bad`,   // adaptivedemux2/DASH/HLS demuxers for YouTube adaptive streams
  `depend = gst-libav`,         // H.264/AAC decoder (FFmpeg-based) for WebKit MSE
  `depend = gtk3`,
].join('\n') + '\n';

writeFileSync(path.join(stagingDir, '.PKGINFO'), pkginfo);
console.log('[arch-package] .PKGINFO written');

// ── .MTREE (optional — enables `pacman -Qk` file integrity checks) ────────
const mtreeTmp = path.join(archOutDir, '.MTREE.tmp.gz');
rmSync(mtreeTmp, { force: true });
const mtreeResult = spawnSync(
  'bsdtar',
  [
    '-czf', mtreeTmp,
    '--format=mtree',
    '--options=!all,use-set,type,uid,gid,mode,time,size,md5,sha256,link',
    '.',
  ],
  { cwd: stagingDir, stdio: ['ignore', 'ignore', 'ignore'] }
);
if ((mtreeResult.status ?? 1) === 0 && existsSync(mtreeTmp)) {
  renameSync(mtreeTmp, path.join(stagingDir, '.MTREE'));
  console.log('[arch-package] .MTREE written');
} else {
  rmSync(mtreeTmp, { force: true });
  console.warn('[arch-package] .MTREE generation skipped (non-fatal — package still installs correctly)');
}

// ── Create .pkg.tar.zst ───────────────────────────────────────────────────
// pacman (libalpm) requires .PKGINFO to be the first entry in the archive —
// it reads sequentially and does not seek. Explicitly list metadata files
// first, then the remaining top-level entries, mirroring makepkg's behaviour.
const pkgFileName = `${binaryName}-${version}-1-x86_64.pkg.tar.zst`;
const pkgFilePath = path.join(archOutDir, pkgFileName);
rmSync(pkgFilePath, { force: true });

const otherEntries = readdirSync(stagingDir).filter(f => f !== '.PKGINFO' && f !== '.MTREE');
const archiveEntries = [
  '.PKGINFO',
  ...(existsSync(path.join(stagingDir, '.MTREE')) ? ['.MTREE'] : []),
  ...otherEntries,
];
run('bsdtar', ['-cf', pkgFilePath, '--zstd', '-C', stagingDir, ...archiveEntries]);

console.log(`\n[arch-package] Package ready: ${pkgFilePath}`);
console.log(`[arch-package] Install with:  sudo pacman -U ${pkgFilePath}`);
console.log(`[arch-package] Inspect deps:  bsdtar -xOf ${pkgFilePath} .PKGINFO`);
