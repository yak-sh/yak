// The names a platform and its clients both speak: its own host, the shape of
// a space's or an app's slug, the store its directory lives in, and the paths
// a client posts to that are not an app's.

/** The platform's own host. A deployment may stand at another (workers/yak
 * host.ts `apex`); the product is always called this. */
export let PLATFORM = 'yaks.app'

/** What the platform is, in its own one line (M-37845): the home page's
 * title, the share card's, the connector's. */
export let PITCH = 'Build, host and share web apps.'

/** The public repository the platform is built from (M-37867), whose web
 * pages a commit links into as `${REPO}/commit/<sha>`. */
export let REPO = 'https://github.com/yak-sh/yak'

/** A space's or an app's slug. */
export let SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

/** The store the directory lives in, named the way every app's store is. Its
 * slugs are the platform's own and never move, so the name is a constant.
 *
 * A store's name is addressing rather than vocabulary: consumers can name
 * the directory without importing its words or its store composition. */
export let PLATFORM_STORE = 'yak/platform'

/** Where a sign-in link is spent. Under `/login/`, so the platform routes it
 * with the rest of the sign-in surface. */
export let LINK = '/login/link'

/** Where an invitation is accepted, on the platform's own host. */
export let INVITE = '/invite'

/** Where a person's own invite link opens, before its code: short, so the
 * link can be said aloud (`yaks.app/i/k7q2m`). */
export let INVITED = '/i/'

// The slugs no space or app may take, because at `<slug>.yaks.app` and at
// `<slug>@yaks.app` they would read as the platform speaking (T-37886): a
// sign-in page at `login.yaks.app`, a letter from `security@yaks.app`. The
// doors that mint an address check it (workers/yak directory.ts `RESERVED`,
// which adds the payment provider's name); an address already held keeps
// working. `yak` is the platform's own space, and `origin` and `saas` its
// custom-hostname origin. `sha` and `git` are the platform's own key prefixes
// in the files bucket: a space's files are kept under its slug, so a space by
// either name would share storage with the platform's.
export let RESERVED: Set<string> = new Set([
  'abuse',
  'account',
  'accounts',
  'admin',
  'administrator',
  'api',
  'app',
  'apps',
  'auth',
  'billing',
  'cf-bounce',
  'checkout',
  'connect',
  'dashboard',
  'docs',
  'email',
  'git',
  'hello',
  'help',
  'hostmaster',
  'login',
  'logout',
  'mail',
  'manage',
  'mcp',
  'mx',
  'no-reply',
  'noreply',
  'oauth',
  'official',
  'origin',
  'password',
  'pay',
  'payment',
  'payments',
  'postmaster',
  'pricing',
  'privacy',
  'root',
  'saas',
  'secure',
  'security',
  'settings',
  'sha',
  'sign-in',
  'sign-up',
  'signin',
  'signup',
  'staff',
  'status',
  'support',
  'system',
  'terms',
  'verify',
  'webmaster',
  'www',
  'yak',
  'yaks',
])

// The names no space may take beyond those (D-473): a space's own address is
// `yaks.app/<space>`, so every first path segment the apex serves a page or a
// door at is kept from spaces, with the words that read as a platform's page
// and the HTTP statuses. An app may take one, since it is addressed under its
// space. The apex routes a name here, or in `RESERVED`, as its own and never
// as a space (./routes.ts `rooted`).
export let ROOT: Set<string> = new Set([
  // The apex's own pages and doors (workers/yak apex.ts).
  'acceptable-use',
  'approve',
  'build',
  'churches',
  'connections',
  'cookies',
  'gallery',
  'guide',
  'install',
  'integrations',
  'invite',
  'operator',
  'organizations',
  'skills',
  'space',
  'spaces',
  'start',
  'style-guide',
  'technical',
  'townships',
  'tv',
  'updates',
  // Words a platform's own page would be at.
  'about',
  'assets',
  'blog',
  'careers',
  'contact',
  'download',
  'downloads',
  'faq',
  'features',
  'home',
  'images',
  'jobs',
  'legal',
  'news',
  'press',
  'public',
  'robots',
  'search',
  'sitemap',
  'static',
  // HTTP statuses a page could be named for.
  '400',
  '401',
  '403',
  '404',
  '410',
  '429',
  '500',
  '502',
  '503',
  '504',
])
