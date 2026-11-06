// The popup, drawn from what the extension knows: whether the person signed
// in, the space they chose, how the socket is, and their consent. It is HTML
// text, so a test reads it on a parsed document. Each button names what it
// does in `data-do` (and a site in `data-site`); the popup's glue runs that.

import type { Config } from './connect.ts'
import { spaceHost } from './connect.ts'
import { type Consent, host } from './consent.ts'

/** How the socket to the space is. */
export type Link = 'connecting' | 'connected' | 'offline'

/** A step the agent asks the person to let it do. */
export type Asked = { site: string; doing: string }

/** What the popup shows. */
export type State = {
  signed: boolean
  space?: string
  link?: Link
  consent: Consent
  /** The site of a tab the agent wants a screenshot of, waiting on the
   * person's click on the extension's button there. */
  lend?: string
  /** A step waiting on the person's Do it: the site it is on, and what it
   * does, in words that may be the page's. */
  confirm?: Asked
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
  `<p>Your agent asked to use this site. It reads or does something on a page only when it asks.</p>` +
  `${button('allow', 'Allow', site)}${button('dismiss', 'Not now')}</section>`

let lending = (site: string) =>
  `<section class="ask"><strong>Your agent wants a screenshot of ${
    esc(host(site))
  }</strong>` +
  `<p>Chrome lets it take one only after you click this extension's button on that tab. Go to the tab and click the button there.</p></section>`

let confirming = (c: Asked) =>
  `<section class="ask"><strong>Do this on ${esc(host(c.site))}?</strong>` +
  `<p class="doing">${esc(c.doing)}</p>` +
  `<p>Your agent waits for you, and does nothing unless you press Do it.</p>` +
  `${button('yes', 'Do it')}${button('no', "Don't")}</section>`

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
      (s.confirm ? confirming(s.confirm) : '') +
      (s.consent.asking ? asking(s.consent.asking) : '') +
      (s.lend ? lending(s.lend) : '') + sites(s.consent) +
      `<footer>${button('change', 'Change space')}${
        button('signout', 'Sign out')
      }</footer>`)

/// asked({ consent: { sites: [], asking: 'https://a.com' } }) -> true
/// asked({ consent: { sites: [] } }) -> false
/** Whether anything waits on the person, which the badge shows. */
export let asked = (
  s: Pick<State, 'consent' | 'lend' | 'confirm'>,
): boolean => !!(s.consent.asking || s.lend || s.confirm)
