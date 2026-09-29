// Reconcile builders after scheduled or selected changes, and turn every tool
// output value into stable built rows. The model adapter has the same output
// contract as a code tool; it only translates an ordinary session reply.

import { type Bundle, type Comp, Stale, token, type Tx } from '@yaks/graph'
import type { Handler, Handlers } from '@yaks/effects'
import type { Vocab } from '@yaks/vocab'
import { and, eq } from '@yaks/query'
import { next, WAKE } from '@yaks/wake'
import { BUILD, clock, type Options, reconcile } from './build.ts'
import { answer, spent } from './answer.ts'
import { adapted } from './model.ts'
import { candidates } from './deps.ts'

let str = (c: Comp | undefined, prop: string): string =>
  c?.[prop] == null ? '' : String(c[prop])
let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  b?.[name] as Comp | undefined

let settle = async (
  eid: string,
  tx: Tx,
  write: Parameters<Handler>[2],
  o: Options,
  scheduled: boolean,
  retry = false,
) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    let [builder] = await tx.get([eid])
    if (!builder?.builder) return
    let { writes } = await reconcile(
      tx,
      builder,
      o,
      (o.now ?? clock)(),
      scheduled,
      retry,
    )
    if (!writes.length) return
    try {
      await write(writes)
      return
    } catch (err) {
      if (!(err instanceof Stale) || attempt == 2) throw err
    }
  }
}

let stir =
  (o: Options, scheduled: boolean, retry = false): Handler =>
  (event, tx, write) => settle(event.entity.eid, tx, write, o, scheduled, retry)

export let opening = (o: Options): Handler => stir(o, true, true)
export let editing = (o: Options): Handler => stir(o, false)

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

export let changing = (o: Options): Handler => async (event, tx, write) => {
  let [changed] = await tx.get([event.entity.eid])
  if (
    changed?.build || changed?.call || changed?.result ||
    changed?.execution ||
    changed?.error ||
    comp(changed, 'output')?.value != null
  ) {
    return
  }
  // TODO: Drop the broad path after pending effects written before touched
  // was recorded have drained; those runs lost the changed component names.
  let builders = event.touched
    ? await candidates(tx, event.entity.eid, event.touched)
    : await tx.read(and(eq('builder.immediate', 'true')))
  if (changed?.tool || event.touched?.includes('tool')) {
    builders.push(
      ...await tx.read(and(
        eq('builder.immediate', 'true'),
        eq('builder.to', event.entity.eid),
      )),
    )
  }
  let seen = new Set<string>()
  for (let builder of builders) {
    if (
      builder.entity.eid == event.entity.eid ||
      !comp(builder, 'builder')?.immediate || seen.has(builder.entity.eid)
    ) {
      continue
    }
    seen.add(builder.entity.eid)
    await settle(builder.entity.eid, tx, write, o, false)
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
  let cost = spent(call, value)
  try {
    let writes = [...cost, ...await answer(tx, call, value, vocab)]
    if (writes.length) await write(writes)
  } catch (err) {
    // A build that moved on refuses the outputs, never what the call spent.
    if (err instanceof Stale) {
      if (cost.length) await write(cost)
      return
    }
    // A malformed output remains a recorded call result, but its key may be
    // tried again on the next explicit or scheduled reconciliation.
    await write([...cost, {
      entity: build.entity,
      [BUILD]: { key: null },
      $was: { [BUILD]: { call: token(call.entity.eid) } },
    }])
    throw err
  }
}

export let watches = (o: Options): Handlers => ({
  builder_open: opening(o),
  builder_edit: editing(o),
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
