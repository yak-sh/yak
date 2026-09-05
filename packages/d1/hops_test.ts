/// <reference lib="deno.ns" />
// The clamp. Over D1 the cost of a write is not how much SQL it is, it is how
// many times the Worker waits for the network — and nothing in the type system
// or the test suite notices when a hook, a phase or a plugin quietly adds
// another wait. So the shapes of batch the platform actually runs are counted
// here, against the counting stand-in (harness.ts `counting`), and held to a
// number.
//
// THE NUMBERS ONLY GO DOWN. This table works like bench/baseline.json: a case
// that comes in UNDER its pin is re-pinned in the same commit that earned it
// (the test says so on the console), and a case that comes in over its pin is a
// regression to fix, never a pin to raise. Raising one is a decision, with a
// reason, not a way to get a suite green.
//
// What one trip costs, in this adapter (store.ts):
//
//   tx.get    one `batch()` — the gather: a spine plus a statement per
//             component, for every eid at once. `learn` caches per
//             transaction, so an eid already asked about is free.
//   tx.read   ONE `all()` for the compiled query, plus one `batch()` for the
//             gather of what it hit — so two, or one when it hits nothing.
//   minting   nothing. A number is SQLite's to pick when the insert runs, and
//             that insert's own RETURNING hands it back with the batch.
//   flush     one `batch()`: every write of the whole batch, atomic.
//
// Measured 2026-09-05, with the gather in (T-34032) and the write path speaking
// RETURNING (T-34033) — in brackets, what the same case cost before the two:
//
//   case                     trips  batch  all  prepare
//   ──────────────────────────────────────────────────
//   a plain write              2 (3)   2     0     11
//   a write with $was          2 (2)   2     0     10
//   a $delete with a cascade   7 (12)  5     2     59
//   a member-guarded write     4 (9)   3     1     54
//   a batch of 50 bundles      2 (3)   2     0    550
//
// Where they come from, phase by phase:
//
//   a plain write             the gather (which `mutate` and the storage's own
//                             minting then read from), and the flush. Nothing
//                             asks what number the new entity will get.
//   a write with $was         the gather and the flush — the entity exists, so
//                             nothing is minted at all.
//   a $delete with a cascade  the gather, then the cascade phase, which has to
//                             read AFTER the patches and so takes a gather of
//                             its own: one backwards read for the batch's own
//                             casualties, one for the frontier that turned up,
//                             one `learn` for identities the batch never named,
//                             and the flush.
//   a member-guarded write    the gather — the entities the ladder names, and
//                             everything filed about the actor, which is the
//                             roster and the grants in one — then the flush.
//                             The four rungs cost nothing of their own.
//   a batch of 50 bundles     the same two as one write: the gather and the
//                             flush are one round trip however wide the batch
//                             is, which is what `prepare` at 550 says.

import { assert } from '@std/assert'
import { type Change, graph, token } from '@yaks/graph'
import { members } from '@yaks/member'
import { club, ids } from '../member/harness.ts'
import { counted, type Hops, shop } from './harness.ts'

/** The pinned round trips per apply. Only ever revised downward — see above. */
let PINS: Record<string, number> = {
  'a plain write': 2,
  'a write with $was': 2,
  'a $delete with a cascade': 7,
  'a member-guarded write': 4,
  'a batch of 50 bundles': 2,
}

// One case: the tally against its pin. Coming in under the pin is not a
// failure — it is the ratchet asking to be turned, said where a reader of the
// test output will see it.
let holds = (name: string, h: Hops) => {
  let pin = PINS[name]
  if (h.trips < pin) {
    console.log(
      `${name}: ${h.trips} round trips, pinned at ${pin} — re-pin it`,
    )
  }
  assert(
    h.trips <= pin,
    `${name}: ${h.trips} round trips, pinned at ${pin} — ${
      JSON.stringify(h)
    }. The pin only goes down; find the read that was added.`,
  )
}

// A shop graph over a counting store, with `arrange` applied before the tally
// is zeroed and `measured` applied after it.
let shopHops = async (
  arrange: Change,
  measured: Change,
): Promise<Hops> => {
  let { store, hops, reset } = await counted()
  let g = graph({ storage: store, vocab: shop })
  if (arrange.length) await g.apply(arrange)
  reset()
  await g.apply(measured)
  return hops()
}

Deno.test('a plain write', async () => {
  let name = 'a plain write'
  holds(
    name,
    await shopHops([], [{
      entity: { eid: 'b1' },
      doc: { title: 'Dune' },
    }]),
  )
})

Deno.test('a write with $was', async () => {
  let name = 'a write with $was'
  holds(
    name,
    await shopHops([{ entity: { eid: 'b1' }, doc: { title: 'Dune' } }], [{
      entity: { eid: 'b1' },
      doc: { title: 'Emma' },
      $was: { doc: { title: token('Dune') } },
    }]),
  )
})

Deno.test('a $delete with a cascade', async () => {
  let name = 'a $delete with a cascade'
  // A review cascades with its product, a bookmark of it is released, and a
  // maker would be detached. One backwards read per rung of the walk, and the
  // casualties the batch never named still have to be identified before they
  // can be removed — which is why a delete costs more than a write.
  holds(
    name,
    await shopHops([
      { entity: { eid: 'p1' }, product: { sku: 'MUG', price: 12 } },
      { entity: { eid: 'r1' }, review: { stars: 5, product: 'p1' } },
      { entity: { eid: 'k1' }, bookmark: { of: 'p1' } },
    ], [{ entity: { eid: 'p1' }, $delete: true }]),
  )
})

Deno.test('a member-guarded write', async () => {
  let name = 'a member-guarded write'
  let { store, hops, reset } = await counted(club)
  let { club: c, dana, raj, mo, list, notes } = ids
  // The club, seeded the way it is seeded everywhere else — before any guard
  // exists, which is what a bootstrap is.
  await graph({ storage: store, vocab: club }).apply([
    { entity: { eid: c }, space: { name: 'Tuesday Books' } },
    { entity: { eid: dana }, person: { name: 'Dana' } },
    { entity: { eid: raj }, person: { name: 'Raj' } },
    { entity: { eid: mo }, person: { name: 'Mo' } },
    { entity: { eid: list }, app: { name: 'Reading list', space: c } },
    { entity: { eid: notes }, app: { name: 'Notes', space: c } },
    {
      entity: { eid: 'seat1' },
      member: { space: c, person: dana, role: 'owner' },
    },
    { entity: { eid: 'seat2' }, member: { space: c, person: raj } },
    {
      entity: { eid: 'g1' },
      grant: { app: list, person: raj, access: 'editor' },
    },
  ])
  let g = graph({
    storage: store,
    vocab: club,
    plugins: [members({ app: list, space: c })],
  })
  reset()
  // Raj holds an editor grant, so the guard climbs the whole ladder — the
  // app's mode, then Raj himself, then the roster, then the grants — and every
  // rung is answered out of the one gather the plugin's `wants` declared.
  await g.apply([{
    entity: { eid: 'pick1' },
    pick: { title: 'Dune' },
    $actor: { by: raj },
  }])
  holds(name, hops())
})

Deno.test('a batch of 50 bundles', async () => {
  let name = 'a batch of 50 bundles'
  // The point of the row: the gather and the flush are each ONE round trip
  // however wide the batch is, so 50 bundles cost what one does.
  holds(
    name,
    await shopHops(
      [],
      Array.from({ length: 50 }, (_, i) => ({
        entity: { eid: `b${i}` },
        doc: { title: `book ${i}` },
      })),
    ),
  )
})
