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

# Build desktop app (full variant)
npm run desktop:build:full

# Build tech variant
npm run desktop:build:tech
```

The output AppImage will be in `src-tauri/target/release/bundle/appimage/`.

## Packaging for Arch

Convert the built AppImage to a pacman package:

```bash
# After building, create .pkg.tar.zst
npm run desktop:package:arch
```

Install the resulting package:

```bash
sudo pacman -U world-monitor-*.pkg.tar.zst
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
