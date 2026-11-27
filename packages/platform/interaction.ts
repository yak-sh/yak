// Only these code coordinates cross the wire. Never read labels, typed text,
// ids, space names, app names, search terms or an arbitrary element selector.
import { managed, spaced } from './routes.ts'
import { SECTIONS } from './home/parts.ts'
import { SLOW } from '@yaks/timing/interaction'

let MARKETING = [
  'home',
  'build',
  'organizations',
  'townships',
  'style-guide',
  'pricing',
  'gallery',
  'docs',
  'agent',
  'integrations',
  'help',
  'operator-tour',
  'login',
  'terms',
  'privacy',
  'acceptable-use',
  'cookies',
  'churches',
  'games',
  'start',
  'published-app',
  'publisher',
  'install',
  'admin',
  'support',
  'approve',
]
let SPACE = [
  'apps',
  'new',
  'operator',
  'updates',
  'matches',
  'people',
  'connections',
  'visits',
  'selling',
  'billing',
  'domains',
  'settings',
  'trash',
]
let ACCOUNT = ['profile', 'friends', 'invite', 'agents', 'shared', 'space']
let APP = ['app', 'app-data', 'app-inspect']

let PAGES = new Set([
  ...MARKETING,
  ...SPACE,
  ...ACCOUNT.map((p) => `account-${p}`),
  ...APP,
  'manage',
  'other',
])
export let interactionPage = (page: string): boolean => PAGES.has(page)

/** The platform view named by an address, independent of who is viewing it. */
export let pageKind = (path: string, app = false): string => {
  if (path.endsWith('/_web/data')) return 'app-data'
  if (path.endsWith('/_web')) return 'app-inspect'
  if (path == '/') return 'home'
  if (path == '/operator') return 'operator-tour'
  let [root] = path.split('/').filter(Boolean)
  if (root == 'apps') return 'published-app'
  if (root == 'spaces') return 'publisher'
  if (MARKETING.includes(root)) return root
  let there = managed(path) ?? spaced(path)
  if (there) {
    if ('account' in there) return `account-${there.account}`
    if ('view' in there) {
      return app && there.view == 'operator' ? 'app' : there.view
    }
    if ('updates' in there) return 'updates'
    if ('legacy' in there) return there.legacy
    if ('moved' in there) return pageKind(there.moved, app)
    return 'manage'
  }
  return 'other'
}

let ACTIONS: Record<string, string> = {
  '[data-cta="start"]': 'start',
  '[data-cta="examples"]': 'examples',
  '[data-cta="join"]': 'join',
  '[data-cta="walk"]': 'walk',
  '[data-cta="walk-ask"]': 'walk-ask',
  '[data-cta="plus"]': 'plus',
  '[data-cta="pro"]': 'pro',
  '[data-step="-1"]': 'previous-example',
  '[data-step="1"]': 'next-example',
  '[data-walk-name], [data-walk-next]': 'walkthrough',
  '[data-domain-search]': 'domain-search',
  '[data-domain-buy]': 'domain-buy',
  '[data-domain-transfer]': 'domain-transfer',
  '[data-domain-target]': 'domain-save',
  '[data-side]': 'sidebar',
  '[data-sift]': 'filter',
  '[data-inbox-action="choose"]': 'updates-choose',
  '[data-inbox-action="dismiss"]': 'updates-dismiss',
  '[data-inbox-action="friend"]': 'updates-friend',
  '[data-inbox-action="transfer"]': 'updates-transfer',
  '.Composer button[type="submit"]': 'send-message',
  '.Save button[type="button"]': 'save',
  '[data-save]': 'save',
  '[data-sort]': 'sort',
  '[aria-haspopup="dialog"]': 'dialog',
  '[aria-expanded]': 'disclosure',
}
let actions = Object.entries(ACTIONS)
let CONTROLS = actions.map(([selector]) => selector).join(',')
let NATIVE = [
  'button',
  'submit',
  'input',
  'select',
  'checkbox',
  'radio',
  'textarea',
  'summary',
  'label',
  'page',
  'external',
  'anchor',
  'menu',
  'close-menu',
  'features',
  'integrations',
  'plans',
  'skip',
]
let HOME_SECTIONS = new Set([
  ...SECTIONS,
  'examples',
  'cost',
  'say',
  'example-say',
])
let HOME_TARGETS = [
  ...[...HOME_SECTIONS].flatMap((id) => [`section-${id}`, `in-${id}`]),
  ...SECTIONS.map((id) => `example-${id}`),
  'home-background',
  'home-mascot',
  'home-sky',
]
/** Why a page reloaded itself, as the script that reloaded it stamps it in
 * `sessionStorage` under `yak-reload` (workers/yak/public, pages.ts): following
 * a preview's draft, the person pressing a release notice's Reload, coming
 * back from signing in elsewhere, or a TV moving to what it shows. Each is a
 * reload someone chose. */
export let RELOAD_CAUSES = ['draft', 'release', 'away', 'tv']
/** The reloads nobody chose: the page before it never left (`discarded`: the
 * browser or the phone let go of it, or it crashed, and brought it back), or a
 * script stamped a cause not in {@link RELOAD_CAUSES} (`unknown`). Each is
 * sent to the tracker as well as counted. */
export let UNEXPECTED_RELOADS = ['discarded', 'unknown']
/** The target a reloaded page is counted under: `reload` where nothing
 * stamped a cause (the person reloading it), else `reload-<cause>`, any cause
 * not known being `reload-unknown`. */
export let reloadTarget = (cause: string | null): string =>
  cause == null
    ? 'reload'
    : `reload-${
      [...RELOAD_CAUSES, ...UNEXPECTED_RELOADS].includes(cause)
        ? cause
        : 'unknown'
    }`
/** Whether a point is a page reloading rather than something pressed. */
export let reloading = (target: string): boolean =>
  target == 'reload' || target.startsWith('reload-')
/** The cause of a reload nobody chose, or null for any other point. */
export let unexpected = (target: string): string | null => {
  let cause = target.slice('reload-'.length)
  return reloading(target) && UNEXPECTED_RELOADS.includes(cause) ? cause : null
}
/** The points that are an answer behind what the page already shows, not a
 * press's frame, each with how long it may take before it is slow: an
 * on-page save shows at once and is confirmed behind (edit-mode.ts
 * `savePoint`). */
export let ANSWERS: Record<string, number> = { saved: 3000 }
/** How long a point may take before it is a slow interaction. */
export let budgetOf = (target: string): number =>
  Object.hasOwn(ANSWERS, target) ? ANSWERS[target] : SLOW
let TARGETS = new Set([
  ...Object.values(ACTIONS),
  ...Object.keys(ANSWERS),
  ...NATIVE,
  ...HOME_TARGETS,
  reloadTarget(null),
  ...[...RELOAD_CAUSES, ...UNEXPECTED_RELOADS].map(reloadTarget),
])
export let interactionTarget = (target: string): boolean =>
  TARGETS.has(target) ||
  target.startsWith('open-') && PAGES.has(target.slice(5))

let HASH: Record<string, string> = {
  '#menu': 'menu',
  '#': 'close-menu',
  '#how': 'features',
  '#integrations': 'integrations',
  '#cost': 'plans',
  '#say': 'start',
  '#main': 'skip',
  '#content': 'skip',
}
let CONTROL =
  'a[href], button, input, select, textarea, summary, label, [role=button], [role=tab]'

// The selectors used by this classifier are also implemented by painted trees.
type Control = {
  closest: (selector: string) => Control | null
  querySelector: (selector: string) => Control | null
  matches: (selector: string) => boolean
  getAttribute: (name: string) => string | null
  id: string
  localName: string
}

let messageSection = (at: Control) => {
  let turn = at.closest('[data-line][data-turn]')?.getAttribute('data-turn')
  return SECTIONS[Number(turn ?? NaN)]
}

let homeBackground = (at: Control): string => {
  let example = messageSection(at)
  if (example) return `example-${example}`
  if (at.closest('[data-wander], .Wander')) return 'home-mascot'
  if (at.closest('.Home_SkySpace')) return 'home-sky'
  let step = at.closest('[data-story-step]')
  let id = step?.id || step?.querySelector('#cost, #hello')?.id
  return id && HOME_SECTIONS.has(id) ? `in-${id}` : 'home-background'
}

/** Identify a control by its code or native role. Link destinations collapse
 * to the same view name as the page itself. */
export let targetKind = (
  at: Control,
  here: URL,
  event: string,
): string => {
  let control = at.closest(CONTROL) ?? at
  let named = control.closest(CONTROLS)
  let kind = named && actions.find(([selector]) => named.matches(selector))?.[1]
  if (kind && (event != 'submit' || kind != 'disclosure')) return kind
  let href = control.getAttribute('href')
  let home = here.pathname == '/'
  if (href) {
    let to: URL
    try {
      to = new URL(href, here)
    } catch {
      return 'anchor'
    }
    if (to.origin != here.origin) return 'external'
    if (home && to.pathname == '/') {
      let id = to.hash.slice(1)
      if (HOME_SECTIONS.has(id)) {
        let example = control.matches('.Home_MessageLink') &&
          messageSection(control)
        return example ? `example-${example}` : `section-${id}`
      }
      if (!to.hash && to.search == here.search) return 'open-home'
    }
    if (to.pathname == here.pathname && to.search == here.search) {
      return (Object.hasOwn(HASH, href) ? HASH[href] : HASH[to.hash]) ??
        'anchor'
    }
    return `open-${pageKind(to.pathname, to.searchParams.has('app'))}`
  }
  if (event == 'submit') return 'submit'
  let tag = control.localName
  let type = control.getAttribute('type')
  if (tag == 'input' && (type == 'checkbox' || type == 'radio')) return type
  return NATIVE.includes(tag)
    ? tag
    : control.getAttribute('role') == 'button'
    ? 'button'
    : home
    ? homeBackground(at)
    : 'page'
}
