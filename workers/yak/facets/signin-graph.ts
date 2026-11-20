// A sign-in code asked for and guessed at in one trip to the directory
// (T-148704): the store reads the address's rows and decides in the write's
// own transaction, by signin.ts's rules (`asked`, `guessed`), where the
// gateway used to read them, decide, and write in a second trip.
//
// An ask is the new `signin` row itself: it is written, beside the burial of
// the rows fallen out of the hour, unless the address has had its letters,
// and the answer says which. A guess is the request `$guess{email | phone,
// code, via, from}`: it becomes a try off every open code, and for a typed
// code a `signin_miss` counting it against the address and the network it
// came from (signin.ts `barred`), or the
// burial of every row when it opens one, beside whoever it signs in, stamped
// as signed in (signin.ts `stamped`), and the space they land on, said as it
// stands (`landing`). An arrival is the request
// `$arrive{email, via}`: an address another provider vouched for (oidc.ts),
// which signs in whoever wears it just as a guess that opened would.
//
// All three are the platform's alone. A `signin` is wholly server-stamped,
// so an ask from anywhere else is refused at admission before it gets here,
// and a guess or an arrival is refused here unless the write is trusted.
//
// The work is the `authorize` hook's, which runs inside the transaction
// before every precondition: the rows it buries are then read while they
// stand by the hooks that ask what a delete takes (graph.ts's serving fence,
// pages-graph.ts `quietened`), and its counts are checked by the core's
// `$was` like any caller's.
import { type Line, line } from '@yaks/query'
import { instrumentEid } from '@yaks/platform/instrument'
import type { Bundle, Plugin, Tx } from '@yaks/graph'
import { hook } from '@yaks/graph/plugin'
import { Refused } from '@yaks/graph/errors'
import { after, each } from '@yaks/fp'
import type { Options } from './store.ts'
import {
  arriving,
  asked,
  barred,
  called,
  guessed,
  type Miss,
  missed,
  missesFrom,
  missLine,
  type Person,
  personLine,
  sentFrom,
  type Signin,
  signinLine,
  stamped,
  type Via,
} from '../signin.ts'
import { texts } from '../operator-texts.ts'
import { consentEid } from '@yaks/phone'
import {
  idOf,
  inside,
  newcomerIs,
  ownOf,
  type Row,
  seatsLine,
} from '../directory.ts'
import { ended, sessionRow, type SessionSeed } from '../browser-sessions.ts'

type Guess = {
  browser?: string
  session?: SessionSeed
  email?: string
  phone?: string
  code: string
  via?: Via
  newcomer?: string
  person?: string
  space?: string
  source?: string
  from?: string
}

// How somebody arrives, by a guess that opened or by an `$arrive`.
type Arriving = Pick<Guess, 'newcomer' | 'via' | 'session'>

// Every wrong guess a line reads: an address's, or a network's (signin.ts
// `barred`).
let misses = (tx: Tx, filter: Line) =>
  after(
    tx.read(filter),
    (found) => found.filter((r) => r.signin_miss) as unknown as Miss[],
  )

// The wrong guesses a typed code is held to: its address's, and those typed
// from its network (`here`), which a request from inside has none of.
let seen = (tx: Tx, address: string, from?: string) =>
  after(
    misses(tx, missLine(address)),
    (ms) =>
      after(from ? misses(tx, missesFrom(from)) : [], (here) => ({
        misses: ms,
        here,
      })),
  )

// Every row a line reads: an address's codes', or a visitor's asks'.
let rows = (tx: Tx, filter: Line) =>
  after(
    tx.read(filter),
    (found) => found.filter((r) => r.signin) as unknown as Signin[],
  )

let addressOf = (s: { email?: string; phone?: string }) =>
  s.email ?? s.phone ?? ''

// Who signs in at an address: its person, else this browser's newcomer,
// else somebody new. Reusing a newcomer cancels every browser credential in
// the same transaction that attaches the verified address (T-839); whoever
// held a copy must not inherit the account (T-770). The proof boundary first
// revokes credentials held outside the directory (identity.ts `arrivingOn`).
// Their sign-in stamp and own space are answered beside them in this trip.
let arrival = (
  tx: Tx,
  address: string,
  eid: string,
  at: string,
  { newcomer, via = 'code', session }: Arriving,
): Bundle[] | Promise<Bundle[]> =>
  after(tx.read(personLine(address)), ([found]) =>
    after(
      newcomer ? tx.read(line`.entity.eid=${newcomer}`) : [],
      ([row]) => {
        let who = found as Person | undefined
        let handed = newcomerIs(row as Row | undefined)
        let taken = !who && handed
        let person = {
          ...arriving(
            address,
            called(address),
            who,
            taken ? row.entity.eid : eid,
          ),
          signed_in: stamped(who?.signed_in, at, via),
        }
        return after(
          taken ? ending(tx, person.entity.eid) : [],
          (cancelled) =>
            after(
              landing(
                tx,
                person.entity.eid,
                handed ? undefined : { ...who, ...person } as unknown as Row,
              ),
              (home) =>
                after(
                  session
                    ? tx.read(
                      line`.entity.eid=${instrumentEid(session.via)}&.browser`,
                    )
                    : [],
                  (browser) => [
                    person,
                    ...session ? [sessionRow(session, person.entity.eid)] : [],
                    ...home,
                    ...cancelled,
                    ...browser,
                  ],
                ),
            ),
        )
      },
    ))

let ending = (tx: Tx, person: string) =>
  after(
    tx.read(line`.browser_session.person=${person}&!cancelled`),
    (rows) =>
      ended(
        person,
        (rows as Row[]).map((row) => ({
          ...row.browser_session!,
          eid: row.entity.eid,
          person,
          via: idOf(row.browser_session!.via),
        })),
      ),
  )

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
  requests: ['$guess', '$arrive'],
  authorize: hook(
    ['signin', '$guess', '$arrive'],
    (bundles, tx, _err, context) => {
      if (!bundles.some((b) => b.$guess || b.$arrive || asking(b))) {
        return bundles
      }
      if (bundles.some((b) => b.$guess || b.$arrive) && !context?.trusted) {
        throw new Refused('only the platform signs anybody in')
      }
      let now = options.store.now()
      let decide = (b: Bundle): Bundle[] | Promise<Bundle[]> => {
        // An address another provider vouched for (oidc.ts): whoever wears it
        // arrives as a code that opened would have them, with no code spent.
        if (b.$arrive) {
          let a = b.$arrive as Arriving & { email: string }
          return after(
            arrival(tx, a.email, b.entity.eid, new Date(now).toISOString(), a),
            ([who, ...home]) => [{ ...who, $alias: b.$alias }, ...home],
          )
        }
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
              if (g.email) {
                return [{
                  entity: { eid: g.person! },
                  email: { address },
                  $alias: b.$alias,
                }]
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
          // A typed code is also held to the wrong guesses of its address and
          // of its network (`barred`); a letter's link opens its own code
          // from anywhere.
          let typed = g.via != 'link'
          let decide = () =>
            after(
              rows(tx, signinLine(address)),
              (all) =>
                after(typed ? seen(tx, address, g.from) : null, (held) => {
                  if (
                    held && barred(held.misses, held.here, g.browser, now)
                  ) return []
                  let scoped = all.filter((r) =>
                    r.signin.person == g.person && r.signin.space == g.space &&
                    (typed
                      ? !r.signin.browser || r.signin.browser == g.browser
                      : r.signin.code == g.code)
                  )
                  let tried = guessed(scoped, g.code, now)
                  let opened = tried.some((w) => w.tombstone)
                  let wrote = held && tried.length
                    ? [
                      ...tried,
                      ...missed(held, address, g, now, opened),
                    ]
                    : tried
                  if (!opened) return wrote
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
                }),
            )
          return g.person && g.phone
            ? after(
              tx.read(personLine(address)),
              (held) =>
                held.some((r) => r.entity.eid == g.person)
                  ? consent()
                  : decide(),
            )
            : decide()
        }

        if (asking(b)) {
          let s = b.signin as Signin['signin']
          return after(
            rows(tx, signinLine(addressOf(s))),
            (all) =>
              after(
                s.from ? rows(tx, sentFrom(s.from)) : [],
                (sent) => asked(b, all, now, sent),
              ),
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
    },
  ),
}]
