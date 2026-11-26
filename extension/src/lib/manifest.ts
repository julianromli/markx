export type ExtensionBuildTarget = "dev" | "store"

export const EXTENSION_VERSION = "0.2.0"

export const EXTENSION_PERMISSIONS = [
  "storage",
  "scripting",
  "activeTab",
] as const

export const PROD_HOST_PERMISSIONS = ["https://markx.app/*"] as const

export const DEV_HOST_PERMISSIONS = [
  ...PROD_HOST_PERMISSIONS,
  "http://localhost/*",
  "http://127.0.0.1/*",
] as const

export type ExtensionManifest = {
  manifest_version: 3
  name: string
  version: string
  description: string
  action: {
    default_title: string
    default_popup: string
    default_icon: Record<string, string>
  }
  icons: Record<string, string>
  background: {
    service_worker: string
    type: "module"
  }
  options_ui?: {
    page: string
    open_in_tab: boolean
  }
  permissions: string[]
  host_permissions: string[]
  commands: {
    _execute_action: {
      suggested_key: {
        default: string
        mac: string
      }
      description: string
    }
  }
}

const ICONS: Record<string, string> = {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png",
}

export function resolveExtensionTarget(
  raw: string | undefined
): ExtensionBuildTarget {
  if (raw == null || raw === "" || raw === "dev") return "dev"
  if (raw === "store") return "store"
  throw new Error(
    `Invalid MARKX_EXTENSION_TARGET "${raw}". Expected "dev" or "store".`
  )
}

export function buildManifest(target: ExtensionBuildTarget): ExtensionManifest {
  const base: ExtensionManifest = {
    manifest_version: 3,
    name: "markx",
    version: EXTENSION_VERSION,
    description: "Save the current tab to a markx folder.",
    action: {
      default_title: "Save to markx",
      default_popup: "src/popup.html",
      default_icon: { ...ICONS },
    },
    icons: { ...ICONS },
    background: {
      service_worker: "background.js",
      type: "module",
    },
    ...(target === "dev"
      ? {
          options_ui: {
            page: "src/options.html",
            open_in_tab: false,
          },
        }
      : {}),
    permissions: [...EXTENSION_PERMISSIONS],
    host_permissions:
      target === "store"
        ? [...PROD_HOST_PERMISSIONS]
        : [...DEV_HOST_PERMISSIONS],
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Ctrl+Shift+S",
          mac: "Command+Shift+S",
        },
        description: "Save the current tab to markx",
      },
    },
  }

  return base
}

const FORBIDDEN_STORE_HOST_PATTERN =
  /(?:localhost|127\.0\.0\.1|\[::1\]|^http:\/\/)/i

export function assertStoreManifestValid(manifest: ExtensionManifest): void {
  if (manifest.manifest_version !== 3) {
    throw new Error("Store manifest must use manifest_version 3.")
  }

  if (manifest.options_ui != null) {
    throw new Error("Store manifest must not include dev-only options_ui.")
  }

  if (manifest.permissions.includes("tabs")) {
    throw new Error('Store manifest must not request the "tabs" permission.')
  }

  if (manifest.host_permissions.length === 0) {
    throw new Error("Store manifest must declare production host_permissions.")
  }

  for (const host of manifest.host_permissions) {
    if (FORBIDDEN_STORE_HOST_PATTERN.test(host)) {
      throw new Error(
        `Store manifest contains forbidden host permission: "${host}".`
      )
    }
  }

  const serialized = JSON.stringify(manifest)
  if (/(?:localhost|127\.0\.0\.1)/i.test(serialized)) {
    throw new Error("Store manifest must not reference localhost or 127.0.0.1.")
  }
}
