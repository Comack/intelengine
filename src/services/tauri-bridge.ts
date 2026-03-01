type TauriInvoke = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;

function resolveInvokeBridge(): TauriInvoke | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const tauriWindow = window as unknown as {
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };

  const invoke =
    tauriWindow.__TAURI__?.core?.invoke ??
    tauriWindow.__TAURI_INTERNALS__?.invoke;

  return typeof invoke === 'function' ? invoke : null;
}

export function hasTauriInvokeBridge(): boolean {
  return resolveInvokeBridge() !== null;
}

export async function invokeTauri<T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const invoke = resolveInvokeBridge();
  if (!invoke) {
    throw new Error('Tauri invoke bridge unavailable');
  }

  return invoke<T>(command, payload);
}

export async function tryInvokeTauri<T>(
  command: string,
  payload?: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<T | null> {
  try {
    return await Promise.race([
      invokeTauri<T>(command, payload),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`[tauri-bridge] timeout: ${command}`)), timeoutMs)
      ),
    ]);
  } catch (error) {
    console.warn(`[tauri-bridge] Command failed: ${command}`, error);
    return null;
  }
}
