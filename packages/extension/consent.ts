// Per-site consent: which sites the person let their agent read, and the one
// it is asking about now. A **site** is a page's origin, `https://example.com`.
// Nothing is read from a site until the person allows it, and they can take it
// back. The value is plain JSON, which the browser glue keeps in
// `chrome.storage.local`; a site's permission itself is the browser's
// (`chrome.permissions`), asked for with `pattern`.

/** The sites allowed, and the site the agent is waiting on, if any. */
export type Consent = { sites: string[]; asking?: string }

/** Nothing allowed, nothing asked. */
export let NONE: Consent = { sites: [] }

/// site('https://example.com/a?b#c') -> 'https://example.com'
/// site('chrome://newtab/') -> null
/// site('not a url') -> null
/** The site a page's address is on, or null for a page that is not on the
 * web (the browser's own pages, files, extensions). */
export let site = (url: string): string | null => {
  try {
    let u = new URL(url)
    return u.protocol == 'https:' || u.protocol == 'http:' ? u.origin : null
  } catch {
    return null
  }
}

/// host('https://example.com') -> 'example.com'
/** A site as a person reads it. */
export let host = (site: string): string => new URL(site).host

/// pattern('https://example.com') -> 'https://example.com/*'
/** The match pattern the browser grants a site's permission under. */
export let pattern = (site: string): string => `${site}/*`

/// allowed('https://a.com')({ sites: ['https://a.com'] }) -> true
/// allowed('https://b.com')({ sites: ['https://a.com'] }) -> false
/** Whether the person allowed a site. */
export let allowed = (site: string) => (c: Consent): boolean =>
  c.sites.includes(site)

// Leaves `asking` out rather than undefined, so the value stays as stored.
let shaped = (sites: string[], asking?: string): Consent =>
  asking ? { sites, asking } : { sites }

/// ask('https://a.com')(NONE) -> { sites: [], asking: 'https://a.com' }
/** The agent asked about a site: it is the one the person is asked about,
 * unless they already allowed it. */
export let ask = (site: string) => (c: Consent): Consent =>
  allowed(site)(c) ? c : shaped(c.sites, site)

/// allow('https://a.com')({ sites: [], asking: 'https://a.com' }) -> { sites: ['https://a.com'] }
/** The person allowed a site; a question about it is answered. */
export let allow = (site: string) => (c: Consent): Consent =>
  shaped(
    [...new Set([...c.sites, site])].sort(),
    c.asking == site ? undefined : c.asking,
  )

/// revoke('https://a.com')({ sites: ['https://a.com', 'https://b.com'] }) -> { sites: ['https://b.com'] }
/** The person took a site back. */
export let revoke = (site: string) => (c: Consent): Consent =>
  shaped(c.sites.filter((s) => s != site), c.asking)

/// dismiss({ sites: [], asking: 'https://a.com' }) -> { sites: [] }
/** The person said not now: nothing is asked until the agent asks again. */
export let dismiss = (c: Consent): Consent => shaped(c.sites)
