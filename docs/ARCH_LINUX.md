# Arch Linux Setup

Guide for building, packaging, and running World Monitor on Arch Linux.

## System Dependencies

### Runtime (required for running AppImage or native package)

```bash
sudo pacman -S webkit2gtk-4.1 gtk3 glib-networking gst-plugins-base gst-plugins-good gst-plugins-bad
```

### Build Dependencies (required for compiling from source)

```bash
sudo pacman -S base-devel rust nodejs npm webkit2gtk-4.1 gtk3 glib-networking \
  gst-plugins-base gst-plugins-good gst-plugins-bad gstreamer \
  libappindicator-gtk3 librsvg patchelf
```

### Optional

```bash
# Better fonts for the dashboard
sudo pacman -S ttf-jetbrains-mono noto-fonts-extra

# Keyring backends (at least one recommended for secret storage)
# GNOME Keyring (GNOME/Budgie/Cinnamon)
sudo pacman -S gnome-keyring libsecret
# KDE Wallet (KDE Plasma)
sudo pacman -S kwallet kwalletmanager
```

## Building from Source

```bash
# Clone and install JS dependencies
git clone https://github.com/Comack/intelengine.git
cd intelengine
npm install

# Install proto toolchain (requires Go)
make install
```

### Native Package Build (Recommended on Arch)

The native `.deb` → `.pkg.tar.zst` path requires no linuxdeploy and avoids all
AppImage-related compatibility issues on modern Arch/CachyOS:

```bash
# Build + package in one command (deb → Arch .pkg.tar.zst)
npm run desktop:package:linux:full

# Or other variants:
npm run desktop:package:linux:tech
npm run desktop:package:linux:finance
```

Output files:
- `.deb`: `src-tauri/target/release/bundle/deb/World Monitor_<ver>_amd64.deb`
- `.pkg.tar.zst`: `src-tauri/target/release/bundle/arch/world-monitor-<ver>-1-x86_64.pkg.tar.zst`

### AppImage Build

The AppImage build uses Tauri's linuxdeploy toolchain and requires a one-time
setup on Arch Linux (see below). Use this for AppImage distribution only:

```bash
# Build AppImage (requires linuxdeploy setup below)
npm run desktop:build:full

# Or explicitly request AppImage from the package script:
npm run desktop:package -- --os linux --variant full --bundle appimage
```

The output AppImage will be in `src-tauri/target/release/bundle/appimage/`.

### One-Time linuxdeploy Setup (Arch Linux only)

On Arch Linux, Tauri's bundled linuxdeploy AppImage needs a workaround due to two issues:
1. The bundled `strip` (GNU Binutils 2.35) can't handle modern ELF `.relr.dyn` sections from Arch's newer toolchain.
2. GTK plugin's library search finds VMware/flatpak copies of GTK libs that require EOL `libffi.so.7`.

**Step 1: Download and cache the real linuxdeploy AppImage**

```bash
mkdir -p ~/.cache/tauri
# Download Tauri's expected linuxdeploy version
wget -O ~/.cache/tauri/linuxdeploy-x86_64-real.AppImage \
  "https://github.com/tauri-apps/binary-releases/releases/download/linuxdeploy/linuxdeploy-x86_64.AppImage"
chmod +x ~/.cache/tauri/linuxdeploy-x86_64-real.AppImage
```

**Step 2: Pre-extract and patch the AppImage**

```bash
# Extract to persistent directory
~/.cache/tauri/linuxdeploy-x86_64-real.AppImage --appimage-extract-and-run --appimage-extract 2>/dev/null || true
mv squashfs-root ~/.cache/tauri/linuxdeploy-extracted

# Replace bundled strip with system strip (clears AppImage's LD_LIBRARY_PATH)
cat > ~/.cache/tauri/linuxdeploy-extracted/usr/bin/strip << 'EOF'
#!/bin/sh
exec env LD_LIBRARY_PATH="" /usr/bin/strip "$@"
EOF
chmod +x ~/.cache/tauri/linuxdeploy-extracted/usr/bin/strip

# Fix GTK plugin: add -maxdepth 1 to lib search (prevents VMware lib contamination)
sed -i 's|find /usr/lib -name "libgobject-|find /usr/lib -maxdepth 1 -name "libgobject-|' \
  ~/.cache/tauri/linuxdeploy-plugin-gtk.sh

# Fix GTK plugin: tolerate "File exists" on re-runs
sed -i 's|ln $verbose -s |ln $verbose -sf |g' ~/.cache/tauri/linuxdeploy-plugin-gtk.sh
```

**Step 3: Build the ELF stub wrapper**

Tauri writes null bytes at ELF offset 8 of the cached AppImage (to patch the arch field). A shell script shebang would be corrupted; a compiled ELF binary is not:

```bash
cat > /tmp/linuxdeploy-stub.c << 'CEOF'
#include <unistd.h>
#include <stdlib.h>
int main(int argc, char **argv) {
    const char *bash = "/bin/bash";
    const char *wrapper = "/home/YOUR_USER/.cache/tauri/linuxdeploy-real-wrapper.sh";
    char **newargv = (char **)malloc((argc + 3) * sizeof(char *));
    if (!newargv) return 1;
    newargv[0] = (char *)bash;
    newargv[1] = (char *)wrapper;
    for (int i = 1; i < argc; i++) newargv[i + 1] = argv[i];
    newargv[argc + 1] = NULL;
    execv(bash, newargv);
    return 1;
}
CEOF
# Replace YOUR_USER with your actual username
sed -i "s/YOUR_USER/$USER/" /tmp/linuxdeploy-stub.c
gcc -O2 -o ~/.cache/tauri/linuxdeploy-x86_64.AppImage /tmp/linuxdeploy-stub.c
chmod +x ~/.cache/tauri/linuxdeploy-x86_64.AppImage
```

**Step 4: Create the real wrapper script**

```bash
cat > ~/.cache/tauri/linuxdeploy-real-wrapper.sh << 'EOF'
#!/bin/bash
set -e
EXTRACT_DIR="$HOME/.cache/tauri/linuxdeploy-extracted"
REAL_APPIMAGE="$HOME/.cache/tauri/linuxdeploy-x86_64-real.AppImage"
# Filter --appimage-extract-and-run (not needed; already extracted)
ARGS=()
for arg in "$@"; do
    [[ "$arg" == "--appimage-extract-and-run" ]] && continue
    ARGS+=("$arg")
done
# Ensure plugins are findable
export PATH="$HOME/.cache/tauri:$PATH"
# Compute LDAI_OUTPUT if OUTPUT points to a directory
if [ -n "$OUTPUT" ] && [ -d "$OUTPUT" ]; then
    APPDIR=""
    for a in "${ARGS[@]}"; do
        if [[ "$a" == *.AppDir ]]; then APPDIR="$a"; fi
    done
    if [ -n "$APPDIR" ]; then
        APPNAME=$(basename "$APPDIR" .AppDir)
        export LDAI_OUTPUT="$OUTPUT/${APPNAME}-x86_64.AppImage"
    fi
fi
exec "$EXTRACT_DIR/AppRun" "${ARGS[@]}"
EOF
chmod +x ~/.cache/tauri/linuxdeploy-real-wrapper.sh
```

After this one-time setup, `npm run desktop:build:full` will work on Arch Linux.

## Packaging for Arch

### Via native deb (recommended)

`npm run desktop:package:linux:full` does everything in one command:
builds the `.deb` and automatically converts it to `.pkg.tar.zst`.

Install the resulting package:

```bash
sudo pacman -U src-tauri/target/release/bundle/arch/world-monitor-*.pkg.tar.zst
```

### Manual conversion of an existing deb

If you already have a `.deb` from a previous build:

```bash
node scripts/arch-package.mjs --variant full
```

### Via AppImage (legacy)

```bash
# Build AppImage first (requires linuxdeploy setup above)
npm run desktop:build:full
# Convert to Arch package
npm run desktop:package:arch
```

## Running the AppImage

```bash
chmod +x World-Monitor_*.AppImage
./World-Monitor_*.AppImage
```

### Troubleshooting AppImage

**Blank white screen**: Usually caused by WebKit sandbox conflicts. The app already disables the sandbox in AppImage mode. If issues persist:

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 ./World-Monitor_*.AppImage
```

**NVIDIA + Wayland**: The app auto-detects NVIDIA and forces X11 backend to avoid WebKit rendering issues. If you want to force Wayland:

```bash
GDK_BACKEND=wayland ./World-Monitor_*.AppImage
```

**Secret storage errors**: Ensure a D-Bus Secret Service provider is running:

```bash
# Check if secret service is available
secret-tool search --all dummy dummy 2>&1
# If errors, start GNOME Keyring:
gnome-keyring-daemon --start --components=secrets
```

**Missing GStreamer codecs**: If media playback fails:

```bash
sudo pacman -S gst-plugins-ugly gst-libav
```

## Development

```bash
# Run in development mode with devtools
npm run desktop:dev

# The sidecar Node.js server logs are at:
# ~/.local/share/app.worldmonitor.desktop/logs/local-api.log
```

## Wayland Compositors

World Monitor is tested on:
- **GNOME** (Mutter) — full support
- **KDE Plasma** (KWin) — full support
- **Sway** — works with XWayland fallback
- **Hyprland** — works with XWayland fallback
- **i3** (X11) — full support

For pure Wayland compositors without XWayland, WebKit2GTK must support Wayland natively. Recent versions (2.42+) have improved Wayland support.
