// Reconcile builders after scheduled or selected changes, and turn every tool
// output value into stable built rows. The model adapter has the same output
// contract as a code tool; it only translates an ordinary session reply.

import { type Bundle, type Comp, Stale, token } from '@yaks/graph'
import type { Handler, Handlers } from '@yaks/effects'
import type { Vocab } from '@yaks/vocab'
import { and, eq } from '@yaks/query'
import { next, WAKE } from '@yaks/wake'
import { BUILD, clock, type Options, reconcile } from './build.ts'
import { answer } from './answer.ts'
import { adapted } from './model.ts'

let str = (c: Comp | undefined, prop: string): string =>
  c?.[prop] == null ? '' : String(c[prop])
let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

let stir =
  (o: Options, scheduled: boolean, retry = false): Handler =>
  async (event, tx, write) => {
    let [builder] = await tx.get([event.entity.eid])
    if (!builder?.builder) return
    let { writes } = await reconcile(
      tx,
      builder,
      o,
      (o.now ?? clock)(),
      scheduled,
      retry,
    )
    if (writes.length) await write(writes)
  }

export let opening = (o: Options): Handler => stir(o, true, true)

export let ringing = (o: Options): Handler => async (event, tx, write) => {
  let [fired] = await tx.get([event.entity.eid])
  await stir(o, true, true)(
    {
      ...event,
      entity: { eid: str(comp(fired, WAKE), 'target') || event.entity.eid },
    },
    tx,
    write,
  )
}

/** T-44668 will narrow candidate builders; reconciliation already does so. */
export let changing = (o: Options): Handler => async (event, tx, write) => {
  let [changed] = await tx.get([event.entity.eid])
  if (
    changed?.build || changed?.call || changed?.result || changed?.execution ||
    changed?.error ||
    comp(changed, 'output')?.value != null
  ) {
    return
  }
  let builders = await tx.read(and(eq('builder.immediate', 'true')))
  for (let builder of builders) {
    if (event.kind == 'created' && builder.entity.eid == event.entity.eid) {
      continue
    }
    let { writes } = await reconcile(tx, builder, o, (o.now ?? clock)(), false)
    if (!writes.length) continue
    try {
      await write(writes)
    } catch (err) {
      if (!(err instanceof Stale)) throw err
    }
  }
}

/** A model entry becomes the same output.value a code tool would answer. */
export let modeling = (): Handler => async (event, tx, write) => {
  let [said] = await tx.get([event.entity.eid])
  if (!said) return
  if (said.error && said.entry) {
    let [session] = await tx.get([str(comp(said, 'entry'), 'session')])
    let call = str(comp(session, 'session'), 'source')
    if (!call) return
    let [asked] = await tx.get([call])
    let [build] = await tx.get([str(comp(asked, 'call'), 'source')])
    if (str(comp(build, BUILD), 'call') != call) return
    await write([{
      entity: build.entity,
      [BUILD]: { key: null },
      $was: { [BUILD]: { call: token(call) } },
    }])
    return
  }
  let result = await adapted(tx, said)
  if (result) await write([result])
}

/** The output source is a call; that call's source is its stable build. */
export let answering = (vocab: Vocab): Handler => async (event, tx, write) => {
  let [said] = await tx.get([event.entity.eid])
  let source = str(comp(said, 'output'), 'source')
  let value = comp(said, 'output')?.value
  if (!source || value == null) return
  let [call] = await tx.get([source])
  if (!call?.call) return
  let [build] = await tx.get([str(comp(call, 'call'), 'source')])
  if (!build?.[BUILD]) return
  try {
    let writes = await answer(tx, call, value, vocab)
    if (writes.length) await write(writes)
  } catch (err) {
    if (err instanceof Stale) return
    // A malformed output remains a recorded call result, but its key may be
    // tried again on the next explicit or scheduled reconciliation.
    await write([{
      entity: build.entity,
      [BUILD]: { key: null },
      $was: { [BUILD]: { call: token(call.entity.eid) } },
    }])
    throw err
  }
}

export let watches = (o: Options): Handlers => ({
  builder_open: opening(o),
  builder_ring: ringing(o),
  builder_model_answer: modeling(),
  builder_answer: answering(o.vocab),
  builder_change: changing(o),
})

export let effects = (
  host: { vocab: Vocab },
  options: Omit<Options, 'vocab'> = {},
): Handlers => {
  if (options.rest && next(options.rest, Date.now()) == null) {
    console.warn(`@yaks/builders: invalid rest ${JSON.stringify(options.rest)}`)
    return {}
  }
  return watches({ ...options, vocab: host.vocab })
}
