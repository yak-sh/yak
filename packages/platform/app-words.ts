// What an app store says when a query names a word its app does not declare:
// the refusal in the app's own words, pointing at the app's components and at
// where the platform keeps what a caller guessed.
import { unknownName, unqualified } from '@yaks/vocab'

// Words callers guess for something the platform keeps elsewhere, and where
// it is read instead.
export let ELSEWHERE: Record<string, string> = {
  _tx:
    "an app's store keeps no journal component: a row's history is read as " +
    '.created.at, .created.by, .updated.at and .updated.by on the row itself',
  draft_conflict:
    "a draft's conflicts are no component: app_deploy's answer says how " +
    'many properties wait for a pick, and each is a decision in the ' +
    "person's Updates, read with conversation_inbox",
  timing:
    "an app's store keeps no timings: graph_query's timing: true answers " +
    "with where the call's time went, and a slow page is timed in the " +
    'browser, with its resource timings and the Server-Timing header every ' +
    'response carries: call guide with page speed',
}

/** An app store's refusal of a word, said in the words the app speaks: a
 * property named alone is pointed at the app's own components that declare
 * it, never at the platform's machinery (`.provisional.note`, `.wake.note`),
 * and a word the platform keeps elsewhere says where. `own` is the app's
 * components and `props` their properties. Any other message is unchanged.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { inAppWords } from '@yaks/platform/app-words'
 * let props = (c: string) => c == 'check' ? ['note', 'done'] : []
 * assertEquals(
 *   inAppWords('.note is a property, not a component — name it .provisional.note or .wake.note', ['check'], props),
 *   '.note is a property, not a component — name it .check.note',
 * )
 * assertEquals(
 *   inAppWords('.note is a property, not a component — name it .wake.note', ['item'], props),
 *   'unknown prop: .note — no component is named note, and none has a property of that name',
 * )
 * assertEquals(
 *   inAppWords('unknown prop: ._tx', ['recipe'], props).startsWith('unknown prop: ._tx — an app'),
 *   true,
 * )
 * assertEquals(
 *   inAppWords('unknown prop: .timing', ['page'], props).endsWith('call guide with page speed'),
 *   true,
 * )
 * assertEquals(
 *   inAppWords('unknown prop: .entity', ['recipe'], props),
 *   'unknown prop: .entity — every row is an entity, so none is named by it: name the components its rows carry (.recipe), or read one by id with graph_show',
 * )
 * ```
 */
export let inAppWords = (
  message: string,
  own: string[],
  props: (comp: string) => string[],
): string => {
  let word = /^unknown prop: \.(\w+)/.exec(message)?.[1]
  if (word && ELSEWHERE[word]) {
    return `unknown prop: .${word} — ${ELSEWHERE[word]}`
  }
  if (word == 'entity') {
    return 'unknown prop: .entity — every row is an entity, so none is ' +
      `named by it: name the components its rows carry (${
        own.map((c) => `.${c}`).join(', ') || 'none declared yet'
      }), or read one by id with graph_show`
  }
  let alone = /^\.(\w+) is a property, not a component/.exec(message)?.[1]
  if (!alone) return message
  let at = own.filter((c) => props(c).includes(alone))
  return at.length ? unqualified(alone, at) : unknownName(alone, own, props)
}
