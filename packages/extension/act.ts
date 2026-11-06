// What acting on a page needs before the browser does it: the element the
// agent named, still the one it listed, and for a step that sends, buys,
// posts or deletes, the person's **Do it**. The rule is the extension's own,
// read from the element and the action. The agent's word (`confirm: true`)
// can only add a question, never take one away, and nothing a page says
// reaches the rule except the element's own name, so a page can't talk its
// way past it.

import type { Control } from './touch.ts'
import type { Call } from './wire.ts'

// Words that mark a step whose effect leaves the page: something sent,
// bought, posted or deleted. Each matches as a word, with its usual endings.
let WEIGHTY =
  /\b(send|buy|pay|order|post|publish|delete|confirm|purchase|checkout|check out|remove|transfer|submit|reply|donate|subscribe|book|reserve)(s|es|ed|ing|ment|ments)?\b/i

/// weighty('Place order') -> true
/// weighty('Payment') -> true
/// weighty('Postcode') -> false
/// weighty('Next') -> false
/** Whether words name a step that sends, buys, posts or deletes. */
export let weighty = (words: string): boolean => WEIGHTY.test(words)

/// aims({ id: 'c', tool: 'browser_navigate', args: { url: 'https://b.com/' } }, 'https://a.com/') -> 'https://b.com/'
/// aims({ id: 'c', tool: 'browser_click', args: {} }, 'https://a.com/') -> 'https://a.com/'
/** The address a call acts on, whose site needs the person's consent: where
 * a navigation goes, and the tab's own address for everything else. */
export let aims = (call: Call['call'], url: string): string =>
  call.tool == 'browser_navigate' ? String(call.args.url ?? '') : url

let plain = (s: string) =>
  s.replace(/\s+/g, ' ').trim().replace(/…$/, '').toLowerCase()

/// named('place  Order', { ref: 'e1', role: 'button', name: 'Place order' }) -> true
/// named('Cancel', { ref: 'e1', role: 'button', name: 'Place order' }) -> false
/** Whether the name an agent gave is the element's, as it was listed: a ref
 * from an older listing, or a page that changed, names something else. */
export let named = (given: unknown, c: Control): boolean =>
  typeof given == 'string' && plain(given) == plain(c.name)

/** Whether a step waits for the person's Do it: a click that submits a form
 * or whose words are weighty, Enter in a field that is not a search, or a
 * search whose words are, and anything the agent asked to confirm. */
export let confirms = (call: Call['call'], c?: Control): boolean => {
  if (call.args.confirm === true) return true
  if (!c) return false
  if (call.tool == 'browser_click') return !!c.submits || weighty(c.name)
  if (call.tool == 'browser_type' && call.args.enter === true) {
    return !c.search || weighty(c.name)
  }
  return false
}

let quote = (s: string, n = 80) => `“${s.length > n ? s.slice(0, n) + '…' : s}”`

/** What a step does, as the person is asked about it. */
export let doing = (call: Call['call'], c?: Control): string => {
  let on = c ? `the ${c.role} ${quote(c.name)}` : 'the page'
  return call.tool == 'browser_click'
    ? `Click ${on}`
    : call.tool == 'browser_type'
    ? `Type ${quote(String(call.args.text ?? ''))} into ${on}` +
      (call.args.enter === true ? ' and press Enter' : '')
    : call.tool == 'browser_navigate'
    ? `Go to ${String(call.args.url ?? '')}`
    : call.tool
}
