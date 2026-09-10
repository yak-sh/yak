import type { Env } from './env.ts'

export type Host = Pick<Env, 'APEX'>

// Addresses belong to the deployment; the product is always called yaks.app.
export let apex = (env: Host = {}) => env.APEX || 'yaks.app'
export let spaceHost = (env: Host, space: string) => `${space}.${apex(env)}`
export let url = (env: Host, path = '') => `https://${apex(env)}${path}`
// The address a reader answers. It lives here, with the deployment's other
// addresses, and not in post.ts: mail-config.ts is read by yak-tail, whose
// bundle has no npm or @yaks/* resolution, so it must not reach a module that
// imports @yaks/mail.
export let replyTo = (env: Host = {}) => `hello@${apex(env)}`

let addresses = new RegExp(
  `\\bhttps?:\\/\\/[^\\s<>"'\`]+|(?:@|\\.)${
    apex().replaceAll('.', '\\.')
  }\\b(?![\\p{L}\\p{N}_@-]|\\.[\\p{L}\\p{N}_-])`,
  'giu',
)

// Platform content keeps its product name. Only addresses change when those
// same source files are served by another deployment; user app content never
// passes through here. A suffix on somebody else's domain is not our address.
export let hosted = (text: string, env: Host) =>
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
