// A sign-in code asked for and guessed at in one trip to the directory
// (T-148704): the store reads the address's rows and decides in the write's
// own transaction, by signin.ts's rules (`asked`, `guessed`), where the
// gateway used to read them, decide, and write in a second trip.
//
// An ask is the new `signin` row itself: it is written, beside the burial of
// the rows fallen out of the hour, unless the address has had its letters,
// and the answer says which. A guess is the request `$guess{email | phone,
// code, via}`, which writes nothing of its own: it becomes a try off every
// open code, or the burial of every row when it opens one, beside whoever it
// signs in, stamped as signed in (signin.ts `stamped`).
//
// Both are the platform's alone. A `signin` is wholly server-stamped, so an
// ask from anywhere else is refused at admission before it gets here, and a
// guess is refused here unless the write is trusted.
//
// The work is the `authorize` hook's, which runs inside the transaction
// before every precondition: the rows it buries are then read while they
// stand by the hooks that ask what a delete takes (graph.ts's serving fence,
// pages-graph.ts `quietened`), and its counts are checked by the core's
// `$was` like any caller's.
import type { Bundle, Plugin, Tx } from '@yaks/graph'
import { hook } from '@yaks/graph/plugin'
import { Refused } from '@yaks/graph/errors'
import { after, each } from '@yaks/fp'
import type { Options } from './store.ts'
import {
  arriving,
  asked,
  called,
  guessed,
  line,
  type Person,
  personLine,
  type Signin,
  stamped,
  type Via,
} from '../signin.ts'
import { newcomerIs, type Row } from '../directory.ts'

type Guess = {
  email?: string
  phone?: string
  code: string
  via?: Via
  newcomer?: string
}

// Every row an address's codes left.
let rows = (tx: Tx, address: string) =>
  after(
    tx.read(line(address)),
    (found) => found.filter((r) => r.signin) as unknown as Signin[],
  )

let addressOf = (s: { email?: string; phone?: string }) =>
  s.email ?? s.phone ?? ''

// Who signs in at an address, as the write finds them: the newcomer is
// theirs only while nobody wears the address and they are still a newcomer.
// Nothing asks what to call them (T-34236), so the front of their address
// does (`called`), written, not merely derived, because a member row names a
// person by their title and a titleless one reads back as a bare eid
// (T-32733). It is theirs to change on their own space page. A number is no
// name, and a person found by one is the one wearing it. They are stamped as
// signed in at `at`, and the stamp says whether it is their first time, so
// the write that signs them in answers the funnel's question too (T-149011).
let arrival = (
  tx: Tx,
  address: string,
  eid: string,
  at: string,
  { newcomer, via = 'code' }: Guess,
) =>
  after(tx.read(personLine(address)), ([found]) =>
    after(
      found || !newcomer ? [] : tx.read(`.entity.eid=${newcomer}`),
      ([row]) => {
        let taken = newcomerIs(row as Row | undefined)
        let who = (found ?? (taken ? row : undefined)) as Person | undefined
        return {
          ...arriving(
            address,
            called(address),
            found as Person | undefined,
            taken ? newcomer : eid,
          ),
          signed_in: stamped(who?.signed_in, at, via),
        }
      },
    ))

// An ask is a new code: a `signin` carrying one.
let asking = (b: Bundle) => !!(b.signin as { code?: string } | undefined)?.code

export let plugins = (_host: unknown, options: Options): Plugin[] => [{
  name: 'yak/signin',
  requests: ['$guess'],
  authorize: hook(['signin', '$guess'], (bundles, tx, _err, context) => {
    if (!bundles.some((b) => b.$guess || asking(b))) return bundles
    if (bundles.some((b) => b.$guess) && !context?.trusted) {
      throw new Refused('only the platform guesses at a sign-in code')
    }
    let now = options.store.now()
    let decide = (b: Bundle): Bundle[] | Promise<Bundle[]> => {
      if (b.$guess) {
        let g = b.$guess as Guess
        let address = addressOf(g)
        return after(rows(tx, address), (all) => {
          let wrote = guessed(all, g.code, now)
          if (!wrote.some((w) => w.tombstone)) return wrote
          return after(
            arrival(tx, address, b.entity.eid, new Date(now).toISOString(), g),
            (who) => [...wrote, { ...who, $alias: b.$alias }],
          )
        })
      }
      if (asking(b)) {
        return after(
          rows(tx, addressOf(b.signin as Signin['signin'])),
          (all) => asked(b, all, now),
        )
      }
      return [b]
    }
    // One bundle at a time, so a synchronous store stays synchronous.
    return each(
      bundles,
      [] as Bundle[],
      (out, b) => after(decide(b), (wrote) => [...out, ...wrote]),
    )
  }),
}]
