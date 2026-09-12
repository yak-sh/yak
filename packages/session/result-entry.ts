/** Session association is a rule, not a responsibility of the tool executor. */
import { type Bundle, type Comp, type Hook, then } from '@yaks/graph'

/** Add transcript membership only when absent. Sequencing is a separate rule.
 * Execution diagnostics use content.source to identify the same call.
 */
export const resultEntries: Hook = (bundles, tx) => {
  const source = (b: Bundle) => {
    if (b.result) return (b.result as Comp).call
    if (b.error || b.exception) return (b.content as Comp | undefined)?.source
  }
  const candidates = bundles.filter((b) => !('entry' in b) && source(b) != null)
  if (!candidates.length) return bundles
  return then(tx.get(candidates.map((b) => b.entity.eid)), (existing) => {
    const lacking = candidates.filter((b) =>
      !existing.some((v) => v.entity.eid == b.entity.eid && v.entry)
    )
    return then(tx.get(lacking.map((b) => String(source(b)))), (sources) => {
      return bundles.map((b) => {
        if (!lacking.includes(b)) return b
        const id = String(source(b))
        const call = bundles.find((v) => v.entity.eid == id && v.entry) ??
          sources.find((v) => v.entity.eid == id)
        const entry = call?.entry as Comp | undefined
        if (!call?.call || entry?.session == null) return b
        return { ...b, entry: { session: entry.session } }
      })
    })
  })
}
