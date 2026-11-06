// The popup, drawn from what the extension knows: whether the person signed
// in, the space they chose, how the socket is, and their consent. It is HTML
// text, so a test reads it on a parsed document. Each button names what it
// does in `data-do` (and a site in `data-site`); the popup's glue runs that.

import type { Config } from './connect.ts'
import { spaceHost } from './connect.ts'
import { type Consent, host } from './consent.ts'

/** How the socket to the space is. */
export type Link = 'connecting' | 'connected' | 'offline'

/** What the popup shows. */
export type State = {
  signed: boolean
  space?: string
  link?: Link
  consent: Consent
  /** The last thing that went wrong, said to the person. */
  error?: string
}

let ENTITY: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/// esc('<a href="x">') -> '&lt;a href=&quot;x&quot;&gt;'
/** Text as HTML. */
export let esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ENTITY[c])

let button = (does: string, label: string, site?: string) =>
  `<button data-do="${does}"${site ? ` data-site="${esc(site)}"` : ''}>${
    esc(label)
  }</button>`

let LINKS: Record<Link, (at: string) => string> = {
  connecting: (at) => `Connecting to ${at}…`,
  connected: (at) =>
    `Connected to ${at}. Your agent there can ask about the page you're on.`,
  offline: (at) => `Can't reach ${at}. Trying again.`,
}

let signin = (config: Config) =>
  `<p>${
    esc(config.description ?? `Lets ${config.name} see the page you're on.`)
  }</p>${button('signin', `Sign in to ${config.name}`)}`

let choose = (config: Config) =>
  `<form data-do="space"><label>Your space<span class="space">` +
  `<input name="space" placeholder="name" autocomplete="off" required>` +
  `<span>.${esc(new URL(config.origin).host)}</span></span></label>` +
  `<button>Connect</button></form>`

let linked = (config: Config, space: string, link: Link) =>
  `<p class="link ${link}">${esc(LINKS[link](spaceHost(config, space)))}</p>`

let asking = (site: string) =>
  `<section class="ask"><strong>Allow on ${esc(host(site))}?</strong>` +
  `<p>Your agent asked to see this site. It reads a page only when it asks.</p>` +
  `${button('allow', 'Allow', site)}${button('dismiss', 'Not now')}</section>`

let sites = (c: Consent) =>
  c.sites.length
    ? `<section><h2>Sites it can read</h2><ul>${
      c.sites.map((s) =>
        `<li>${esc(host(s))}${button('revoke', 'Remove', s)}</li>`
      ).join('')
    }</ul></section>`
    : ''

/** The popup's HTML for a state. */
export let screen = (config: Config, s: State): string =>
  `<h1>${esc(config.name)}</h1>` +
  (s.error ? `<p class="error">${esc(s.error)}</p>` : '') +
  (!s.signed
    ? signin(config)
    : !s.space
    ? choose(config)
    : linked(config, s.space, s.link ?? 'connecting') +
      (s.consent.asking ? asking(s.consent.asking) : '') + sites(s.consent) +
      `<footer>${button('change', 'Change space')}${
        button('signout', 'Sign out')
      }</footer>`)
