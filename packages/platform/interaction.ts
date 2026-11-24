// Only these code coordinates cross the wire. Never read labels, typed text,
// ids, space names, app names, search terms or an arbitrary element selector.
import { managed, spaced } from './routes.ts'

let MARKETING = [
  'home',
  'build',
  'organizations',
  'townships',
  'style-guide',
  'pricing',
  'gallery',
  'docs',
  'help',
  'operator-tour',
  'login',
  'terms',
  'privacy',
  'acceptable-use',
  'cookies',
  'churches',
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
let TARGETS = new Set([...Object.values(ACTIONS), ...NATIVE])
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

/** Identify a control by its code or native role. Link destinations collapse
 * to the same view name as the page itself. */
export let targetKind = (
  at: Element,
  here: URL,
  event: string,
): string => {
  let control = at.closest(CONTROL) ?? at
  let named = control.closest(CONTROLS)
  let kind = named && actions.find(([selector]) => named.matches(selector))?.[1]
  if (kind && (event != 'submit' || kind != 'disclosure')) return kind
  let href = control.getAttribute('href')
  if (href) {
    let to: URL
    try {
      to = new URL(href, here)
    } catch {
      return 'anchor'
    }
    if (to.origin != here.origin) return 'external'
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
    : 'page'
}
