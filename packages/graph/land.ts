// What a tool ASKED FOR, done. A tool never writes — it answers an
// {@link Intent} saying what it wants written — so every host that runs tools
// ends up doing the same three things: apply the change as the actor, keep the
// tool's own result where it named one, and answer the batch as applied where
// it did not. That is this file, so the three of them cannot drift.
//
// The signing is the load-bearing half. `$actor` is stamped HERE, over
// whatever the batch said about itself, so a tool cannot write in somebody
// else's name by accident and a host that forgot to sign is not a thing a
// caller can arrange.

import type { Bundle, Change, Entity } from './bundle.ts'
import type { Intent, ToolCtx } from './plugin.ts'

/**
 * A batch as one actor's. Whatever `$actor` the batch carried is dropped: who
 * is writing is the host's word, never the client's.
 *
 * ```ts
 * signed([{ entity: { eid: 'b1' } }], { eid: 'm1' })
 * // [{ entity: { eid: 'b1' }, $actor: { by: 'm1' } }]
 * ```
 */
export let signed = (change: Change, who: Entity | null): Change =>
  change.map((b) => {
    let out: Bundle = { ...b }
    delete out.$actor
    if (who) out.$actor = { by: who.eid }
    return out
  })

/**
 * Land an intent: apply its change signed as the actor, and answer what the
 * tool said — its own `result` where it named one, the batch as applied
 * otherwise.
 */
export let land = async (
  intent: Intent,
  ctx: ToolCtx,
): Promise<unknown> => {
  if (!intent.change) return intent.result
  let applied = await ctx.graph.apply(signed(intent.change, ctx.actor))
  return 'result' in intent ? intent.result : applied
}
