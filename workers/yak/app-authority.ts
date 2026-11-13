// App authority is the kernel's vouch and the graph's membership policy.
// The Store and other app graph hosts compose these same functions.
import { type Authenticate, Unauthorized } from '@yaks/api'
import type { Actor, Plugin } from '@yaks/graph'
import { DELIVER } from '@yaks/mail'
import {
  Denied,
  edits,
  type Floor,
  type Floors,
  isFloor,
  type Level,
  level,
  members,
  type Policy,
  reads,
} from '@yaks/member'
import type { Vocab, VocabDoc } from '@yaks/vocab'
import { instrumentEid } from './instrument.ts'
import { noticeComponents } from './notices-vocab.ts'

/** What the kernel vouched for one request: who is asking, the level the
 * platform says they hold on this app, what to call them, and whether they
 * stand in the app as a visitor (visit.ts). */
export type Vouch = {
  person: string | null
  browsers?: string[]
  actor?: string
  via: string | null
  level: Level | null
  title: string | null
  visit?: boolean
}

/** The header the kernel marks a visitor's request with: a stranger reading
 * the sample or standing in a store of their own (visit.ts, session.ts
 * `vouched`). */
export let VISIT = 'x-yak-visit'

/** The kernel's authenticated person and verified instrument are separate:
 * a browser's via never supplies a person. The principal is `person ?? via`,
 * and it holds the level the kernel vouched, so a signed-out visitor is the
 * editor of a store of their own and the viewer of the sample (D-134327).
 *
 * ```ts
 * import { vouchOf } from './app-authority.ts'
 * import { assertEquals } from '@std/assert'
 * let v = vouchOf(new Request('http://store', {
 *   headers: {
 *     'x-yak-via': '0190e0c4-4a52-7b0e-9a3c-1f2d3e4f5a6b',
 *     'x-yak-role': 'editor',
 *     'x-yak-visit': '1',
 *   },
 * }))
 * assertEquals([v.person, v.level, v.visit], [null, 'editor', true])
 * ```
 */
export let vouchOf = (req: Request): Vouch => {
  let said = req.headers.get('x-yak-role')
  let person = req.headers.get('x-yak-person')
  let via = req.headers.get('x-yak-via')
  return {
    person,
    ...(person
      ? {
        browsers: (req.headers.get('x-yak-browsers') ?? '').split(',').filter(
          Boolean,
        ),
      }
      : {}),
    ...(person && req.headers.get('x-yak-actor')
      ? { actor: req.headers.get('x-yak-actor')! }
      : {}),
    via: via ? instrumentEid(via) : null,
    level: (person || via) && said ? level(said) : null,
    title: person ? req.headers.get('x-yak-title') : null,
    ...(req.headers.has(VISIT) ? { visit: true } : {}),
  }
}

/**
 * The seam: the vouch as @yaks/api's `Authenticate`, which @yaks/mcp's mount
 * takes too. Nobody at all is `null` — an anonymous visitor, which an `open`
 * or `public` app admits and a `private` one refuses.
 *
 * A read never reaches `apply()`, so it is refused here, in @yaks/member's own
 * words: the app's mode against the level this caller holds. The level is the
 * kernel's when it vouched one — the platform's roster lives in the directory,
 * not in an app's store — and this store's own grants otherwise, which is what
 * a share link and an app's own `grant` rows are. A write passes here and is
 * refused again inside the transaction by @yaks/member's precondition guard,
 * which is the only check that can read the batch.
 */
export let authenticating = (
  may: Policy,
  app: () => string | null,
  heard: (v: Vouch) => void = () => {},
): Authenticate =>
async (req) => {
  let v = vouchOf(req)
  heard(v)
  let who = signer(v)
  let held = app()
  if (!held) return who
  let m = await may.modeOf(held)
  let has = v.level ?? await may.levelOf(v.person, held)
  if (reads(m, has)) return who
  // Signed out, the way in is to sign in; signed in and holding nothing, it
  // is the app owner's to grant. Neither answer says more about the app than
  // the address already did.
  if (!v.person) throw new Unauthorized('sign in to read this app')
  throw new Denied(v.person, held, 'viewer', 'read')
}

/** Who a vouch's write is signed as: the actor for its person, and the
 * instrument it came through. Nobody at all is `null`.
 *
 * ```ts
 * import { signer, vouchOf } from './app-authority.ts'
 * import { assertEquals } from '@std/assert'
 * let said = (headers: Record<string, string>) =>
 *   signer(vouchOf(new Request('http://store', { headers })))
 * assertEquals(said({ 'x-yak-person': 'p', 'x-yak-actor': 'a' }), { by: 'a' })
 * assertEquals(said({}), null)
 * ```
 */
export let signer = (v: Vouch): Actor | null =>
  v.person || v.via
    ? {
      ...(v.person ? { by: v.actor ?? v.person } : {}),
      ...(v.via ? { via: v.via } : {}),
    }
    : null

/**
 * Today's authority to write the app: the caller {@link authenticating}
 * admits, who also holds the level the app's mode asks of an editor. Asked of
 * a durable outbox write before its kept answer is told (@yaks/api
 * `authorize`), since a cached acceptance is still a write answer: today's
 * authority, not the one held when the receipt was committed, controls its
 * disclosure. Every other write is refused, if it is, inside the transaction
 * by @yaks/member's guard.
 */
export let editing = (
  may: Policy,
  app: () => string | null,
  read: Authenticate,
): (req: Request) => Promise<void> =>
async (req) => {
  await read(req)
  let held = app()
  if (!held) return
  let v = vouchOf(req)
  let m = await may.modeOf(held)
  let has = v.level ?? await may.levelOf(v.person, held)
  if (edits(m, has)) return
  if (!v.person) throw new Unauthorized('sign in to write this app')
  throw new Denied(v.person, held, 'editor')
}

/**
 * The platform's words that ask a level of their own in an app's store,
 * whatever the app's `access` (@yaks/member `floors`, T-37881). An `open` app
 * takes a visitor's rows on purpose, and these are the rows that are not a
 * visitor's to write:
 *
 *   product  what the checkout charges (sell.ts `priced`): the seller's
 *   order    what was sold: its properties are the webhook's alone (vocab.ts),
 *            and an owner may clear one
 *   deliver  the ask to send a letter, which leaves under the platform's
 *            name — an open app with no floor here is an open relay, and the
 *            first spam run would take the zone's reputation with it. Writing
 *            the letter is not held to anything; a draft is ordinary data.
 *   using    the ask for a model's turn, which the space pays for (D-40545):
 *            its members' to make, unless the app's manifest says
 *            `"models": "open"` ({@link floorsOf}), and then anyone's who may
 *            write it.
 *   builder  an instruction that starts model turns at the account's expense.
 *            Only an editor may write its settings, even in an open app.
 */
export let FLOORS: Floors = {
  product: 'editor',
  order: 'owner',
  [DELIVER]: 'editor',
  using: 'editor',
  builder: 'editor',
}

/**
 * The floors a visitor stands below in a store of their own (visit.ts), where
 * the door makes them its editor: the letter that would leave under the app's
 * address, and the model turns and builders the owner's space pays for. Only
 * the owner reaches these, and nobody is the owner of a visitor's store until
 * it is installed.
 */
let VISITING: Floors = { [DELIVER]: 'owner', using: 'owner', builder: 'owner' }

/** Who may upload into the app, as its manifest's `"blob": {"floor": …}` says:
 * an `open` library takes its visitors' questions and keeps its shelves to its
 * editors. Unsaid, anyone who may write the app may.
 *
 * ```ts
 * import { uploadFloor } from './app-authority.ts'
 * import { assertEquals } from '@std/assert'
 * assertEquals(uploadFloor({ blob: { floor: 'editor' } }), 'editor')
 * assertEquals(uploadFloor({ blob: { maxLength: 1024 } }), undefined)
 * ```
 */
export let uploadFloor = (manifest: VocabDoc): Floor | undefined => {
  let said = (manifest.blob as { floor?: unknown } | undefined)?.floor
  return isFloor(said) ? said : undefined
}

/** The floors an app's own manifest leaves standing: every one, less the
 * floor on asking its models where it opens them to anyone who may write;
 * with its {@link uploadFloor} on an upload's `attachment`, the row naming
 * the bytes; for a visitor, raised to {@link VISITING}.
 *
 * ```ts
 * import { floorsOf } from './app-authority.ts'
 * import { assertEquals } from '@std/assert'
 * assertEquals(floorsOf({}).deliver, 'editor')
 * assertEquals(floorsOf({}, true).deliver, 'owner')
 * assertEquals(floorsOf({ models: 'open' }, true).using, undefined)
 * assertEquals(floorsOf({ blob: { floor: 'editor' } }).attachment, 'editor')
 * ```
 */
export let floorsOf = (manifest: VocabDoc, visit = false): Floors =>
  Object.fromEntries(
    Object.entries({
      ...FLOORS,
      ...(uploadFloor(manifest) ? { attachment: uploadFloor(manifest) } : {}),
      ...(visit ? VISITING : {}),
      ...Object.fromEntries(
        noticeComponents(manifest).map((name) => [name, 'editor']),
      ),
    }).filter(([k]) => !(manifest.models == 'open' && k == 'using')),
  ) as Floors

/** The rows an open app's visitor writes only inside a row of their own: a
 * line of a transcript, since after an entry with `using` every line asks for
 * a model's turn the space pays for. A visitor's lines, and so the turns they
 * ask for, stay in transcripts they started. */
let WITHIN = { entry: 'session' }

/** The write guard an app's store holds every writer to: @yaks/member's rule,
 * over this platform's floors as the app's manifest leaves them
 * ({@link floorsOf}) and its {@link WITHIN}. `level` is the standing the door
 * vouched for a writer, and `ignore` the grant rows that standing has outlived.
 * So an open app's visitor adds rows and changes or deletes only their own (an
 * upload's content row, and so its bytes, included), and its owner any.
 * `visit` holds the writer below the floors a visitor never reaches. */
export let appGuard = (
  app: string,
  vocab: Vocab,
  manifest: VocabDoc,
  standing: Pick<Parameters<typeof members>[0], 'level' | 'ignore'>,
  visit = false,
): Plugin => {
  let guard = members({
    app,
    vocab,
    instrument: instrumentEid,
    floors: floorsOf(manifest, visit),
    within: WITHIN,
    ...standing,
  })
  return {
    ...guard,
    hooks: {
      ...guard.hooks,
      // Trusted delivery is the host's internal capability (#asIs in Store).
      // Its ordinary door already checked the writer before staging the work.
      precondition: (rows, tx, error, context) =>
        context?.trusted
          ? rows
          : guard.hooks!.precondition!(rows, tx, error, context),
    },
  }
}
