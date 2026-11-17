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
// signs in, stamped as signed in (signin.ts `stamped`), and the space they
// land on, said as it stands (`landing`).
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
import { line } from '@yaks/query'
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
  type Person,
  personLine,
  type Signin,
  signinLine,
  stamped,
  type Via,
} from '../signin.ts'
import { texts } from '../operator-texts.ts'
import { consentEid } from '@yaks/phone'
import { inside, newcomerIs, ownOf, type Row, seatsLine } from '../directory.ts'
import { sessionRow, type SessionSeed } from '../browser-sessions.ts'

type Guess = {
  session?: SessionSeed
  email?: string
  phone?: string
  code: string
  via?: Via
  newcomer?: string
  person?: string
  space?: string
  source?: string
}

// Every row an address's codes left.
let rows = (tx: Tx, address: string) =>
  after(
    tx.read(signinLine(address)),
    (found) => found.filter((r) => r.signin) as unknown as Signin[],
  )

let addressOf = (s: { email?: string; phone?: string }) =>
  s.email ?? s.phone ?? ''

// Who signs in at an address, as the write finds them: the person wearing
// it, else a person minted wearing it at `eid`. A newcomer never takes the
// address themselves (T-770): whoever started their build may still hold
// their browser's session, so the address is a new person's, and what the
// newcomer built is handed to them after this write (newcomer.ts `keep`),
// as it is to somebody who wore the address already. Nothing is minted them
// here. Nothing asks what to call them (T-34236), so the front of their
// address does (`called`), written, not merely derived, because a member row
// names a person by their title and a titleless one reads back as a bare eid
// (T-32733). It is theirs to change on their own space page. A number is no
// name, and a person found by one is the one wearing it. They are stamped as
// signed in at `at`, and the stamp says whether it is their first time, so
// the write that signs them in answers the funnel's question too (T-149011).
// The person comes first, under the request's `$alias`, then where they land.
let arrival = (
  tx: Tx,
  address: string,
  eid: string,
  at: string,
  { newcomer, via = 'code', session }: Guess,
): Bundle[] | Promise<Bundle[]> =>
  after(tx.read(personLine(address)), ([found]) =>
    after(
      newcomer ? tx.read(line`.entity.eid=${newcomer}`) : [],
      ([row]) => {
        let who = found as Person | undefined
        let person = {
          ...arriving(address, called(address), who, eid),
          signed_in: stamped(who?.signed_in, at, via),
        }
        let handed = newcomerIs(row as Row | undefined)
        return after(
          landing(
            tx,
            person.entity.eid,
            handed ? undefined : { ...who, ...person } as unknown as Row,
          ),
          (
            home,
          ) => [
            person,
            ...session ? [sessionRow(session, person.entity.eid)] : [],
            ...home,
          ],
        )
      },
    ))

// Where somebody signing in lands: the space marked their own, as the write
// finds it (directory.ts `own`), so the code and the place it sends them are
// one trip (T-150300). It is said back as it stands, its address and nothing
// else, which writes nothing: a bundle holding what is stored leaves the
// write and comes back in its answer (@yaks/graph unchanged.ts). Somebody
// with no space at all is minted theirs in this write (directory.ts
// `owning`), `as` the person it makes them, so a new person's code is one
// trip too (T-151251) and their space stands for the first page it sends
// them to. Somebody owning spaces none of which is marked theirs, or due a
// newcomer's handover (no `as`), lands nowhere yet, and directory.ts `own`
// finds, marks or mints theirs after it.
let landing = (
  tx: Tx,
  person: string,
  as?: Row,
): Bundle[] | Promise<Bundle[]> =>
  after(tx.read(seatsLine(person)), (rows) => {
    let own = ownOf(rows as Row[], person)
    if (own) return [{ entity: { eid: own.eid }, space: { slug: own.slug } }]
    return as ? inside(tx).owning(person, undefined, as) : []
  })

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
        let consent = () =>
          after(tx.read(personLine(address)), (holders) => {
            if (holders.some((r) => r.entity.eid != g.person)) {
              throw new Refused(
                'That contact belongs to another account. Sign in with it to use that account.',
              )
            }
            return after(
              tx.read(line`.entity.eid=${consentEid(g.person!)}`),
              ([before]) => {
                let welcome = !holders.length || !before?.sms_consent
                return texts(
                  g.person!,
                  address,
                  true,
                  new Date(now).toISOString(),
                  g.space,
                ).map((row) =>
                  row.phone ? { ...row, $alias: b.$alias } : {
                    ...row,
                    ...(welcome ? { $alias: '$welcome' } : {}),
                    sms_consent: {
                      ...row.sms_consent as object,
                      source: g.source ?? null,
                    },
                  }
                )
              },
            )
          })
        let decide = () =>
          after(rows(tx, address), (all) => {
            let scoped = all.filter((r) =>
              r.signin.person == g.person && r.signin.space == g.space
            )
            let wrote = guessed(scoped, g.code, now)
            if (!wrote.some((w) => w.tombstone)) return wrote
            if (g.person) {
              return after(consent(), (agreed) => [...wrote, ...agreed])
            }
            return after(
              arrival(
                tx,
                address,
                b.entity.eid,
                new Date(now).toISOString(),
                g,
              ),
              (
                [who, ...home],
              ) => [...wrote, { ...who, $alias: b.$alias }, ...home],
            )
          })
        return g.person
          ? after(
            tx.read(personLine(address)),
            (held) =>
              held.some((r) => r.entity.eid == g.person) ? consent() : decide(),
          )
          : decide()
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
