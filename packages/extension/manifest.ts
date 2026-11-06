// The extension's Manifest V3 `manifest.json`, made from a configuration. It
// may reach its host and the host's spaces from the start; every other site is
// an optional permission, asked for one site at a time (./consent.ts).

import pkg from './package.json' with { type: 'json' }
import type { Config } from './connect.ts'

/** The sizes the icons are drawn at, as the browser asks for them. */
export let SIZES = [16, 32, 48, 128]

let icons = Object.fromEntries(SIZES.map((n) => [n, `icon${n}.png`]))

/** A Manifest V3 `manifest.json`, as far as this extension fills it in. */
export type Manifest = {
  manifest_version: 3
  name: string
  version: string
  description: string
  icons: Record<string, string>
  action: { default_popup: string; default_icon: Record<string, string> }
  background: { service_worker: string; type: 'module' }
  permissions: string[]
  host_permissions: string[]
  optional_host_permissions: string[]
}

/** The manifest for a configuration. */
export let manifest = (config: Config): Manifest => {
  let { protocol, hostname } = new URL(config.origin)
  return {
    manifest_version: 3,
    name: config.name,
    version: pkg.version,
    description: config.description ??
      `Lets your agent on ${config.name} see the page you're on.`,
    icons,
    action: { default_popup: 'popup.html', default_icon: icons },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: [
      'activeTab',
      'scripting',
      'storage',
      'identity',
      'tabs',
      'alarms',
    ],
    host_permissions: [
      `${config.origin}/*`,
      `${protocol}//*.${hostname}/*`,
    ],
    optional_host_permissions: ['*://*/*'],
  }
}
