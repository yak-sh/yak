// Recording somebody's explicit decision attributes the mark to that person.
// The signed writer stays the caller for authorization and the journal.
import type { Bundle, Comp } from '@yaks/graph/bundle'

export let deciding = (bundles: Bundle[]): Bundle[] =>
  bundles.map((b) => {
    if (b.$decider == null) return b
    let out = { ...b }
    delete out.$decider
    if (out.decided) {
      out.decided = { ...out.decided as Comp, by: String(b.$decider) }
    }
    return out
  })
