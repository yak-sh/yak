// Fleet parity for @yaks/wake (T-33513): the fleet's `wake` component, loaded
// through the PACKAGE's vocabulary document instead of the one derived from
// its manifests, gives the fleet the same table and the same query routing it
// has today.
//
// That is the whole promise, and it is what makes the package adoptable: the
// fleet's wake rows are already `wake{at, target, note}`, so a document that
// renamed a column or changed a death word would not be the fleet's wake
// domain — it would be a migration wearing its name.
//
// The package declares ONE column the fleet does not have, `every`, and
// declares it last, so its table is the fleet's table plus an appended column
// — exactly the shape of an additive `alter table`. The test states that
// difference rather than hiding it: everything else must be byte-identical.
//
// What the package deliberately leaves out of the fleet's roles.json is the
// fleet SPAWNER's, not a schedule: `role.wake_policy` (always/attention/
// scheduled/manual) says when the fleet's reconciler starts an agent,
// `retry_at`/`quiet`/`cooldown`/`cap` throttle those spawns, and the rest of
// `role` (state, surface, scope, checkout, applied_*, decision, observed) is
// the reconciler's state machine. The one schedule-shaped thing there is
// `role.schedule`, whose grammar — `every 15 minutes` and a five-field cron
// line (src/time.ts `next`) — the package's `wake.every` reads.

import { assert, assertEquals } from '@std/assert'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { schema } from '@yaks/sqlite'
import { after, span, wakeDoc } from '@yaks/wake'
import { fleetDocs, fleetKeywords, fleetVocab } from './vocab/fleet_vocab.ts'
import { next as fleetNext } from './time.ts'

// The fleet vocabulary with the package's `wake` swapped in for the
// manifest-derived one. Everything else — every other comp, every keyword —
// is the fleet's own, so any difference the assertions find is this document's.
let swapped = () => {
  let docs = fleetDocs().map((d): VocabDoc => {
    if (!d.$defs?.wake) return d
    let { wake: _fleets, ...rest } = d.$defs
    return { ...d, $defs: rest }
  })
  return loadVocab([...docs, wakeDoc], fleetKeywords)
}

let table = (v: ReturnType<typeof fleetVocab>, name: string) =>
  schema(v).find((s) => new RegExp(`create table[^(]*"${name}"`).test(s))!

Deno.test("parity: the wake table is the fleet's, plus the one new column", () => {
  let fleet = table(fleetVocab(), 'wake')
  let pkg = table(swapped(), 'wake')
  // the fleet's table, with `every` appended after the last fleet column
  assertEquals(
    pkg,
    fleet.replace(`"note" text\n`, `"note" text,\n    "every" text\n`),
  )
})

Deno.test('parity: every fleet wake column keeps its type and death word', () => {
  let fleet = fleetVocab(), pkg = swapped()
  for (let p of ['at', 'target', 'note']) {
    let f = fleet.column('wake', p)!, k = pkg.column('wake', p)!
    assertEquals(k.category, f.category, p)
    assertEquals(k.scalar, f.scalar, p)
    assertEquals(k.ref, f.ref, p)
    assertEquals(k.death, f.death, p)
    assertEquals(k.affinity, f.affinity, p)
    assertEquals(k.fk, f.fk, p)
  }
  // and the fleet's writable list, in order, with `every` appended
  assertEquals(pkg.comp('wake')!.writable, [
    ...fleet.comp('wake')!.writable,
    'every',
  ])
})

Deno.test('parity: wake is still a kind, still prefixed W', () => {
  let fleet = fleetVocab(), pkg = swapped()
  assertEquals(pkg.comp('wake')!.kind, fleet.comp('wake')!.kind)
  assertEquals(
    pkg.comp('wake')!.keywords.prefix,
    fleet.comp('wake')!.keywords.prefix,
  )
  assertEquals(pkg.kinds, fleet.kinds)
})

Deno.test('parity: routing is unchanged, and `every` collides with nothing', () => {
  let fleet = fleetVocab(), pkg = swapped()
  // every bare spelling the fleet routes today routes the same way
  for (let p of fleet.comps) {
    let f = (() => {
      try {
        return fleet.route(p)
      } catch {
        return 'ambiguous'
      }
    })()
    let k = (() => {
      try {
        return pkg.route(p)
      } catch {
        return 'ambiguous'
      }
    })()
    assertEquals(k, f, `.${p}`)
  }
  // the one new spelling lands in wake and nowhere else
  assertEquals(pkg.route('every'), { comp: 'wake', prop: 'every' })
})

Deno.test("parity: the death worklists are the fleet's", () => {
  let fleet = fleetVocab(), pkg = swapped()
  for (let word of ['cascade', 'detach', 'release', 'keep'] as const) {
    assertEquals(pkg.deaths(word).sort(), fleet.deaths(word).sort(), word)
  }
})

// The zone src/time.ts `cronNext` reads a cron line in — the host's, because
// it builds instants with the local Date constructor.
let HERE = Intl.DateTimeFormat().resolvedOptions().timeZone

Deno.test('the package reads every schedule grammar role.schedule is written in', () => {
  // src/time.ts `next` is what the fleet's scheduler calls on role.schedule.
  // Its two halves are the package's two halves: `every <n> <unit>` and a
  // five-field cron line.
  let now = Date.parse('2026-01-01T09:17:00Z')
  for (let every of ['every 15 minutes', 'every 2 hours', 'every 3 days']) {
    assert(span(every) != null, every)
    assert(fleetNext(every, now) != null, every)
  }
  // Told the fleet's zone, the package answers the fleet's instant.
  for (let every of ['0 9 * * 1-5', '*/5 * * * *', '0 0 1 * *', '30 3 * * 0']) {
    assertEquals(after(every, now, now, HERE), fleetNext(every, now), every)
  }
})

Deno.test('the two deliberate divergences from src/time.ts, stated', () => {
  let now = Date.parse('2026-01-01T09:17:00Z')
  // ONE: a cron line defaults to UTC here and is the host's zone in the fleet.
  // A schedule in a graph is read back by whoever is running — a server, a
  // Worker in another region, a browser tab — and one schedule has to mean one
  // instant. Naming the zone recovers the fleet's answer (above).
  assertEquals(after('0 9 * * *', now, now), Date.parse('2026-01-02T09:00:00Z'))
  // TWO: a duration keeps its phase here; the fleet aligns it to the epoch
  // grid. A wake set at 09:17 stays at :17 rather than jumping to :15, which
  // is what someone who says "every 15 minutes" about a reminder means. Both
  // land on the same cadence; they differ only in offset.
  assertEquals(after('every 15 minutes', now, now), now + 900_000)
  assertEquals(
    fleetNext('every 15 minutes', now),
    Date.parse('2026-01-01T09:30:00Z'),
  )
})
