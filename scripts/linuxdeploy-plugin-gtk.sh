#! /usr/bin/env bash

# GTK3 environment variables: https://developer.gnome.org/gtk3/stable/gtk-running.html
# GTK4 environment variables: https://developer.gnome.org/gtk4/stable/gtk-running.html

# abort on all errors
set -e

# Local patch for AppImage reproducibility:
# 1) avoid vmware overlay libs under /usr/lib/vmware that can pull incompatible libffi.
# 2) make symlink creation idempotent to tolerate stale AppDir artifacts.

if [ "$DEBUG" != "" ]; then
    set -x
    verbose="--verbose"
fi

script=$(readlink -f "$0")

show_usage() {
    echo "Usage: $script --appdir <path to AppDir>"
    echo
    echo "Bundles resources for applications that use GTK into an AppDir"
    echo
    echo "Required variables:"
    echo "  LINUXDEPLOY=\".../linuxdeploy\" path to linuxdeploy (e.g., AppImage); set automatically when plugin is run directly by linuxdeploy"
    #echo
    #echo "Optional variables:"
    #echo "  DEPLOY_GTK_VERSION (major version of GTK to deploy, e.g. '2', '3' or '4'; auto-detect by default)"
}

variable_is_true() {
    local var="$1"

    if [ -n "$var" ] && { [ "$var" == "true" ] || [ "$var" -gt 0 ]; } 2> /dev/null; then
        return 0 # true
    else
        return 1 # false
    fi
}

get_pkgconf_variable() {
    local variable="$1"
    local library="$2"
    local default_path="$3"

    path="$("$PKG_CONFIG" --variable="$variable" "$library")"
    if [ -n "$path" ]; then
        echo "$path"
    elif [ -n "$default_path" ]; then
        echo "$default_path"
    else
        echo "$0: there is no '$variable' variable for '$library' library." > /dev/stderr
        echo "Please check the '$library.pc' file is present in \$PKG_CONFIG_PATH (you may need to install the appropriate -dev/-devel package)." > /dev/stderr
        exit 1
    fi
}

copy_tree() {
    local src=("${@:1:$#-1}")
    local dst="${*:$#}"

    for elem in "${src[@]}"; do
        mkdir -p "${dst::-1}$elem"
        cp "$elem" --archive --parents --target-directory="$dst" $verbose
    done
}

search_tool() {
    local tool="$1"
    local directory="$2"

    if command -v "$tool"; then
        return 0
    fi

    PATH_ARRAY=(
        "/usr/lib/$(uname -m)-linux-gnu/$directory/$tool"
        "/usr/lib/$directory/$tool"
        "/usr/bin/$tool"
        "/usr/bin/$tool-64"
        "/usr/bin/$tool-32"
    )

    for path in "${PATH_ARRAY[@]}"; do
        if [ -x "$path" ]; then
            echo "$path"
            return 0
        fi
    done
}

#DEPLOY_GTK_VERSION="${DEPLOY_GTK_VERSION:-0}" # When not set by user, this variable use the integer '0' as a sentinel value
DEPLOY_GTK_VERSION=3 # Force GTK3 for tauri apps
APPDIR=

while [ "$1" != "" ]; do
    case "$1" in
        --plugin-api-version)
            echo "0"
            exit 0
            ;;
        --appdir)
            APPDIR="$2"
            shift
            shift
            ;;
        --help)
            show_usage
            exit 0
            ;;
        *)
            echo "Invalid argument: $1"
            echo
            show_usage
            exit 1
            ;;
    esac
done

if [ "$APPDIR" == "" ]; then
    show_usage
    exit 1
fi

mkdir -p "$APPDIR"
# make lib64 writable again.
chmod +w "$APPDIR"/usr/lib64 || true

if command -v pkgconf > /dev/null; then
    PKG_CONFIG="pkgconf"
elif command -v pkg-config > /dev/null; then
    PKG_CONFIG="pkg-config"
else
    echo "$0: pkg-config/pkgconf not found in PATH, aborting"
    exit 1
fi

if ! command -v find &>/dev/null && ! type find &>/dev/null; then
    echo -e "$0: find not found.\nInstall findutils then re-run the plugin."
    exit 1
fi

if [ -z "$LINUXDEPLOY" ]; then
    echo -e "$0: LINUXDEPLOY environment variable is not set.\nDownload a suitable linuxdeploy AppImage, set the environment variable and re-run the plugin."
    exit 1
fi

gtk_versions=0 # Count major versions of GTK when auto-detect GTK version
if [ "$DEPLOY_GTK_VERSION" -eq 0 ]; then
    echo "Determining which GTK version to deploy"
    while IFS= read -r -d '' file; do
        if [ "$DEPLOY_GTK_VERSION" -ne 2 ] && ldd "$file" | grep -q "libgtk-x11-2.0.so"; then
            DEPLOY_GTK_VERSION=2
            gtk_versions="$((gtk_versions+1))"
        fi
        if [ "$DEPLOY_GTK_VERSION" -ne 3 ] && ldd "$file" | grep -q "libgtk-3.so"; then
            DEPLOY_GTK_VERSION=3
            gtk_versions="$((gtk_versions+1))"
        fi
        if [ "$DEPLOY_GTK_VERSION" -ne 4 ] && ldd "$file" | grep -q "libgtk-4.so"; then
            DEPLOY_GTK_VERSION=4
            gtk_versions="$((gtk_versions+1))"
        fi
    done < <(find "$APPDIR/usr/bin" -executable -type f -print0)
fi

if [ "$gtk_versions" -gt 1 ]; then
    echo "$0: can not deploy multiple GTK versions at the same time."
    echo "Please set DEPLOY_GTK_VERSION to {2, 3, 4}."
    exit 1
elif [ "$DEPLOY_GTK_VERSION" -eq 0 ]; then
    echo "$0: failed to auto-detect GTK version."
    echo "Please set DEPLOY_GTK_VERSION to {2, 3, 4}."
    exit 1
fi

echo "Installing AppRun hook"
HOOKSDIR="$APPDIR/apprun-hooks"
HOOKFILE="$HOOKSDIR/linuxdeploy-plugin-gtk.sh"
mkdir -p "$HOOKSDIR"
cat > "$HOOKFILE" <<\EOF
#! /usr/bin/env bash

gsettings get org.gnome.desktop.interface gtk-theme 2> /dev/null | grep -qi "dark" && GTK_THEME_VARIANT="dark" || GTK_THEME_VARIANT="light"
APPIMAGE_GTK_THEME="${APPIMAGE_GTK_THEME:-"Adwaita:$GTK_THEME_VARIANT"}" # Allow user to override theme (discouraged)

export APPDIR="${APPDIR:-"$(dirname "$(realpath "$0")")"}" # Workaround to run extracted AppImage
export GTK_DATA_PREFIX="$APPDIR"
export GTK_THEME="$APPIMAGE_GTK_THEME" # Custom themes are broken

# Allow users to override GDK_BACKEND, but default to x11 to avoid #8541 if not set
export GDK_BACKEND="${GDK_BACKEND:-x11}" 

# WebKitGTK safeguards for AppImages, Wayland, and NVIDIA
# 1. Disable sandbox because bwrap often fails inside AppImage mounts, causing WebProcess crashes (black screen + gtk_widget_hide errors)
# Note: WEBKIT_FORCE_SANDBOX is deprecated in WebKit2GTK 6.0+ and generates a warning; omitted here.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS="${WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS:-1}"
# 2. Disable DMABUF renderer which crashes on NVIDIA Wayland
export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"

export XDG_DATA_DIRS="$APPDIR/usr/share:/usr/share:$XDG_DATA_DIRS" # g_get_system_data_dirs() from GLib
EOF

echo "Installing GLib schemas"
# Note: schemasdir is undefined on Ubuntu 16.04
glib_schemasdir="$(get_pkgconf_variable "schemasdir" "gio-2.0" "/usr/share/glib-2.0/schemas")"
copy_tree "$glib_schemasdir" "$APPDIR/"
glib-compile-schemas "$APPDIR/$glib_schemasdir"
cat >> "$HOOKFILE" <<EOF
export GSETTINGS_SCHEMA_DIR="\$APPDIR/$glib_schemasdir"
EOF

case "$DEPLOY_GTK_VERSION" in
    2)
        # https://github.com/linuxdeploy/linuxdeploy-plugin-gtk/pull/20#issuecomment-826354261
        echo "WARNING: Gtk+2 applications are not fully supported by this plugin"
        ;;
    3)
        echo "Installing GTK 3.0 modules"
        gtk3_exec_prefix="$(get_pkgconf_variable "exec_prefix" "gtk+-3.0")"
        gtk3_libdir="$(get_pkgconf_variable "libdir" "gtk+-3.0")/gtk-3.0"
        #gtk3_path="$gtk3_libdir/modules" export GTK_PATH="\$APPDIR/$gtk3_path"
        gtk3_immodulesdir="$gtk3_libdir/$(get_pkgconf_variable "gtk_binary_version" "gtk+-3.0")/immodules"
        gtk3_printbackendsdir="$gtk3_libdir/$(get_pkgconf_variable "gtk_binary_version" "gtk+-3.0")/printbackends"
        gtk3_immodules_cache_file="$(dirname "$gtk3_immodulesdir")/immodules.cache"
        gtk3_immodules_query="$(search_tool "gtk-query-immodules-3.0" "libgtk-3-0")"
        copy_tree "$gtk3_libdir" "$APPDIR/"
        cat >> "$HOOKFILE" <<EOF
export GTK_EXE_PREFIX="\$APPDIR/$gtk3_exec_prefix"
export GTK_PATH="\$APPDIR/$gtk3_libdir:/usr/lib64/gtk-3.0:/usr/lib/x86_64-linux-gnu/gtk-3.0"
export GTK_IM_MODULE_FILE="\$APPDIR/$gtk3_immodules_cache_file"

EOF
        if [ -x "$gtk3_immodules_query" ]; then
            echo "Updating immodules cache in $APPDIR/$gtk3_immodules_cache_file"
            "$gtk3_immodules_query" > "$APPDIR/$gtk3_immodules_cache_file"
        else
            echo "WARNING: gtk-query-immodules-3.0 not found"
        fi
        if [ ! -f "$APPDIR/$gtk3_immodules_cache_file" ]; then
            echo "WARNING: immodules.cache file is missing"
        fi
        sed -i "s|$gtk3_libdir/3.0.0/immodules/||g" "$APPDIR/$gtk3_immodules_cache_file"
        ;;
    4)
        echo "Installing GTK 4.0 modules"
        gtk4_exec_prefix="$(get_pkgconf_variable "exec_prefix" "gtk4" "/usr")"
        gtk4_libdir="$(get_pkgconf_variable "libdir" "gtk4")/gtk-4.0"
        gtk4_path="$gtk4_libdir/modules"
        copy_tree "$gtk4_libdir" "$APPDIR/"
        cat >> "$HOOKFILE" <<EOF
export GTK_EXE_PREFIX="\$APPDIR/$gtk4_exec_prefix"
export GTK_PATH="\$APPDIR/$gtk4_path"
EOF
        ;;
    *)
        echo "$0: '$DEPLOY_GTK_VERSION' is not a valid GTK major version."
        echo "Please set DEPLOY_GTK_VERSION to {2, 3, 4}."
        exit 1
esac

echo "Installing GDK PixBufs"
gdk_libdir="$(get_pkgconf_variable "libdir" "gdk-pixbuf-2.0")"
gdk_pixbuf_binarydir="$(get_pkgconf_variable "gdk_pixbuf_binarydir" "gdk-pixbuf-2.0")"
gdk_pixbuf_cache_file="$(get_pkgconf_variable "gdk_pixbuf_cache_file" "gdk-pixbuf-2.0")"
gdk_pixbuf_moduledir="$(get_pkgconf_variable "gdk_pixbuf_moduledir" "gdk-pixbuf-2.0")"
# Note: gdk_pixbuf_query_loaders variable is not defined on some systems
gdk_pixbuf_query="$(search_tool "gdk-pixbuf-query-loaders" "gdk-pixbuf-2.0")"
copy_tree "$gdk_pixbuf_binarydir" "$APPDIR/"
cat >> "$HOOKFILE" <<EOF
export GDK_PIXBUF_MODULE_FILE="\$APPDIR/$gdk_pixbuf_cache_file"
EOF
if [ -x "$gdk_pixbuf_query" ]; then
    echo "Updating pixbuf cache in $APPDIR/$gdk_pixbuf_cache_file"
    "$gdk_pixbuf_query" > "$APPDIR/$gdk_pixbuf_cache_file"
else
    echo "WARNING: gdk-pixbuf-query-loaders not found"
fi
if [ ! -f "$APPDIR/$gdk_pixbuf_cache_file" ]; then
    echo "WARNING: loaders.cache file is missing"
fi
sed -i "s|$gdk_pixbuf_moduledir/||g" "$APPDIR/$gdk_pixbuf_cache_file"

echo "Copying more libraries"
gobject_libdir="$(get_pkgconf_variable "libdir" "gobject-2.0")"
gio_libdir="$(get_pkgconf_variable "libdir" "gio-2.0")"
librsvg_libdir="$(get_pkgconf_variable "libdir" "librsvg-2.0")"
pango_libdir="$(get_pkgconf_variable "libdir" "pango")"
pangocairo_libdir="$(get_pkgconf_variable "libdir" "pangocairo")"
pangoft2_libdir="$(get_pkgconf_variable "libdir" "pangoft2")"
FIND_ARRAY=(
    "$gdk_libdir"     "libgdk_pixbuf-*.so*"
    "$gobject_libdir" "libgobject-*.so*"
    "$gio_libdir"     "libgio-*.so*"
    "$librsvg_libdir" "librsvg-*.so*"
    "$pango_libdir"      "libpango-*.so*"
    "$pangocairo_libdir" "libpangocairo-*.so*"
    "$pangoft2_libdir"   "libpangoft2-*.so*"
)
LIBRARIES=()
for (( i=0; i<${#FIND_ARRAY[@]}; i+=2 )); do
    directory=${FIND_ARRAY[i]}
    library=${FIND_ARRAY[i+1]}
    while IFS= read -r -d '' file; do
        LIBRARIES+=( "--library=$file" )
    done < <(
        find "$directory" \( -path "$directory/vmware" -o -path "$directory/vmware/*" \) -prune -o \
            \( -type l -o -type f \) -name "$library" -print0
    )
done

env LINUXDEPLOY_PLUGIN_MODE=1 "$LINUXDEPLOY" --appdir="$APPDIR" "${LIBRARIES[@]}"

# Create symbolic links as a workaround
# Details: https://github.com/linuxdeploy/linuxdeploy-plugin-gtk/issues/24#issuecomment-1030026529
echo "Manually setting rpath for GTK modules"
PATCH_ARRAY=(
    "$gtk3_immodulesdir"
    "$gtk3_printbackendsdir"
    "$gdk_pixbuf_moduledir"
)
for directory in "${PATCH_ARRAY[@]}"; do
    while IFS= read -r -d '' file; do
        ln $verbose -s "${file/\/usr\/lib\//}" "$APPDIR/usr/lib" 2>/dev/null || true
    done < <(find "$directory" -name '*.so' -print0)
done

# set write permission on lib64 again to make it deletable.
chmod +w "$APPDIR"/usr/lib64 || true

# We have to copy the files first to not get permission errors when we assign gio_extras_dir
find /usr/lib* -name libgiognutls.so -exec mkdir -p "$APPDIR"/"$(dirname '{}')" \; -exec cp --parents '{}' "$APPDIR/" \; || true
# related files that we seemingly don't need:
# libgiolibproxy.so - libgiognomeproxy.so - glib-pacrunner

gio_extras_dir=$(find "$APPDIR"/usr/lib* -name libgiognutls.so -exec dirname '{}' \; 2>/dev/null)
cat >> "$HOOKFILE" <<EOF
export GIO_EXTRA_MODULES="\$APPDIR/${gio_extras_dir#"$APPDIR"/}"
EOF

# Prevent bundling of WebKitGTK. linuxdeploy sometimes accidentally bundles it (especially 4.1),
# but WebKit relies on separate subprocesses (WebKitWebProcess) and host-specific GPU/sandbox
# configurations that break when isolated in an AppImage. We delete them to force fallback to host.
find "$APPDIR"/usr/lib* -name 'libwebkit*' -delete 2>/dev/null || true
find "$APPDIR"/usr/lib* -name 'libjavascriptcoregtk*' -delete 2>/dev/null || true

# CRITICAL FIX for "gtk_widget_hide: assertion 'GTK_IS_WIDGET (widget)' failed" on Wayland/NVIDIA:
# If we fall back to the host's WebKitGTK (because of sandbox/subprocess issues), we MUST ALSO
# fall back to the host's core GTK3 and GLib libraries. Mixing a bundled libgtk-3.so with a 
# host's WebKitWebProcess leads to severe memory corruption and widget assertion failures.
find "$APPDIR"/usr/lib* -name 'libgtk-3*' -delete 2>/dev/null || true
find "$APPDIR"/usr/lib* -name 'libgdk-3*' -delete 2>/dev/null || true
find "$APPDIR"/usr/lib* -name 'libglib-2*' -delete 2>/dev/null || true
find "$APPDIR"/usr/lib* -name 'libgobject-2*' -delete 2>/dev/null || true
find "$APPDIR"/usr/lib* -name 'libgio-2*' -delete 2>/dev/null || true
find "$APPDIR"/usr/lib* -name 'libgmodule-2*' -delete 2>/dev/null || true

# Remove bundled GStreamer core libs. linuxdeploy pulls these in as transitive
# deps of WebKit2GTK, but they are compiled for the build machine's distro
# (Ubuntu/Debian) with a baked-in plugin scanner path of
# /usr/lib/x86_64-linux-gnu/gstreamer-1.0/ — a path that does not exist on
# Arch, Fedora, or other distros. Even after unsetting GST_PLUGIN_PATH at
# runtime, GStreamer falls back to this compiled-in path and still cannot find
# appsink/autoaudiosink. WebKit then crashes with GLib-GObject-CRITICAL NULL
# pointer errors, killing the webview.
# Removing these forces the host's own GStreamer to be used, which knows the
# correct platform-specific plugin paths.
find "$APPDIR"/usr/lib* -name 'libgst*-1.0.so*' -delete 2>/dev/null || true

# Also delete GStreamer plugin subdirectories. linuxdeploy-plugin-gstreamer (if
# invoked during the build) copies plugin .so files to $APPDIR/usr/lib/gstreamer-1.0/
# and helper binaries to $APPDIR/usr/lib/gstreamer1.0/gstreamer-1.0/. These are
# NOT matched by the libgst*-1.0.so* pattern (plugin files lack the -1.0 suffix).
# Removing the directories ensures GStreamer only looks at host plugins.
find "$APPDIR"/usr/lib* -type d -name 'gstreamer-1.0' -exec rm -rf {} + 2>/dev/null || true
find "$APPDIR"/usr/lib* -type d -name 'gstreamer1.0' -exec rm -rf {} + 2>/dev/null || true

# GStreamer: clear AppImage-overridden plugin paths so WebKitWebProcess discovers
# system plugins. AppImage runtime sets GST_PLUGIN_PATH/GST_PLUGIN_SCANNER to the
# bundled (incomplete) GStreamer directory, which lacks appsink and autoaudiosink.
# Without these elements WebKit's media backend crashes with GLib-GObject-CRITICAL
# NULL pointer errors, resulting in a black webview.
cat >> "$HOOKFILE" <<'GSTEOF'

# Nuclear GStreamer cleanup: unset ALL GStreamer env var names used by
# linuxdeploy-plugin-gstreamer's hook — both the unprefixed names AND the
# GStreamer 1.0-specific _1_0-suffixed names that GStreamer reads preferentially.
# If any _1_0-suffixed var remains set pointing to AppDir paths (even absent ones),
# GStreamer 1.0 follows it, finds no plugins, and WebKit crashes with NULL pointer.
unset GST_PLUGIN_PATH GST_PLUGIN_PATH_1_0
unset GST_PLUGIN_SCANNER GST_PLUGIN_SCANNER_1_0
unset GST_REGISTRY_1_0
unset GST_PLUGIN_SYSTEM_PATH_1_0
unset GST_PTP_HELPER_1_0
unset GST_REGISTRY_REUSE_PLUGIN_SCANNER

# Positive host detection: find and SET GST_PLUGIN_PATH to the host's actual
# GStreamer plugin directory. This is more reliable than relying on GStreamer's
# compiled-in fallback path, which may not be reached correctly when gst-plugin-
# scanner runs inside the AppImage's LD_LIBRARY_PATH environment.
# Covers Arch (/usr/lib/gstreamer-1.0), Fedora (/usr/lib64/gstreamer-1.0),
# Debian/Ubuntu (/usr/lib/x86_64-linux-gnu/gstreamer-1.0), etc.
for _gst_dir in \
    /usr/lib/gstreamer-1.0 \
    /usr/lib64/gstreamer-1.0 \
    /usr/lib/x86_64-linux-gnu/gstreamer-1.0 \
    /usr/lib/aarch64-linux-gnu/gstreamer-1.0 \
    /usr/lib/arm-linux-gnueabihf/gstreamer-1.0; do
    if [ -f "${_gst_dir}/libgstcoreelements.so" ]; then
        export GST_PLUGIN_PATH="${_gst_dir}"
        break
    fi
done
unset _gst_dir

# Also point the scanner at the host's binary so it is not looked up via the
# (potentially AppImage-modified) PATH or a stale compiled-in path.
for _gst_scanner in \
    /usr/lib/gstreamer-1.0/gst-plugin-scanner \
    /usr/lib64/gstreamer-1.0/gst-plugin-scanner \
    /usr/lib/x86_64-linux-gnu/gstreamer-1.0/gst-plugin-scanner \
    /usr/lib/aarch64-linux-gnu/gstreamer-1.0/gst-plugin-scanner; do
    if [ -x "$_gst_scanner" ]; then
        export GST_PLUGIN_SCANNER="$_gst_scanner"
        break
    fi
done
unset _gst_scanner
GSTEOF
