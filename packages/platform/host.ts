/**
 * `@yaks/platform/host` — a deployment's own addresses: the apex it answers
 * at, a space's hostname under it, and the platform's text said with them.
 *
 * ```ts
 * import { spaceHost, url } from '@yaks/platform/host'
 * import { assertEquals } from '@std/assert'
 * assertEquals(spaceHost({ APEX: 'yaks.fyi' }, 'ada'), 'ada.yaks.fyi')
 * assertEquals(url({}, '/login'), 'https://yaks.app/login')
 * ```
 *
 * @module
 */
import { PLATFORM } from './names.ts'

/** A deployment: its addresses, and which deploy of it is running, read
 * from its bindings, so a Worker's env is one. */
export type Host = {
  /** the hostname it answers at; `yaks.app` when unset */
  APEX?: string
  /** `1` on a local run, where `x-yak-host` may name the hostname */
  LOCAL_DEV?: string
  /** which deploy is running */
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string }
}

// Addresses belong to the deployment; the product is always called yaks.app.
export let apex = (env: Host = {}) => env.APEX || PLATFORM
export let spaceHost = (env: Host, space: string) => `${space}.${apex(env)}`
export let url = (env: Host, path = '') => `https://${apex(env)}${path}`
// The address a reader answers. It lives here, with the deployment's other
// addresses.
export let replyTo = (env: Host = {}) => `hello@${apex(env)}`
// The address a stranger writes to sign up (D-136811, inbox.ts `signingUp`). Its
// local part is RESERVED (directory.ts), so no space answers to it.
export let signupAddress = (env: Host = {}) => `signup@${apex(env)}`

let addresses: RegExp = new RegExp(
  `\\bhttps?:\\/\\/[^\\s<>"'\`]+|(?:@|\\.)${
    apex().replaceAll('.', '\\.')
  }\\b(?![\\p{L}\\p{N}_@-]|\\.[\\p{L}\\p{N}_-])`,
  'giu',
)

// Platform content keeps its product name. Only addresses change when those
// same source files are served by another deployment; user app content never
// passes through here. A suffix on somebody else's domain is not our address.
export let hosted = (text: string, env: Host): string =>
  apex(env) == apex() ? text : text.replace(addresses, (address) => {
    if (address[0] == '@' || address[0] == '.') return address[0] + apex(env)
    let host
    try {
      // Prose and Markdown can put punctuation just after an address.
      host = new URL(address.replace(/[.,;!?)]+$/, '')).hostname
    } catch {
      return address
    }
    if (host != apex() && !host.endsWith(`.${apex()}`)) return address
    return address.replace(
      /^(https?:\/\/(?:[^/?#]*@)?)([^/?#:]+)/i,
      (_all, prefix: string, name: string) =>
        prefix + host.slice(0, -apex().length) + apex(env) +
        name.slice(host.length),
    )
  })
