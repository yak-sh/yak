// Joining an app whose own data lists you (T-135365). A church directory
// already holds every member's address and number, and keeping a second list
// of who may see it would be the owner's to keep in step forever. So the app
// says, in its vocab.json, which of its properties hold the addresses and
// numbers of people who belong, optionally which of its rows count (`where`,
// a query, such as current members only), and optionally an email domain:
//
//     "join": {
//       "emails": ["individual.email"],
//       "phones": ["phone.number"],
//       "where": ".individual.status=member,attender",
//       "domain": "example.org"
//     }
//
// Who may join is the space's say. The word in an app's own vocab.json is
// stored on its directory row at deploy. The space owner can set a policy
// through app_set. Installed copies use only the policy their owner set.
//
// Somebody signed in whose address or number is among those rows, or whose
// address is at that domain, is offered Join, and one press writes the grant
// on this app that member_add would have offered them, at the word's `role`
// (viewer unless it says editor). Nobody else is offered anything, and an
// address or number is only ever the one a person signed in with, which a
// code sent to it proved (T-153688). Taking a row away stops its person
// joining; a grant already written stays until member_remove takes it, as
// any grant does.
import { line, parse, stringify, sub } from '@yaks/query'
import type { Directory, Role, Space } from './directory.ts'
import { type App, appStore } from './directory.ts'
import { declarationOf } from './declaration.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { e164 } from '@yaks/phone/mobile'
import { addresses } from '@yaks/people'
import type { Join } from '@yaks/platform/manifest'

// Older original apps keep their existing policy until their next deploy.
// For older installed copies, the install pin already identifies which
// declaration cannot serve as policy, so there is no data write to wait for.
let joinOf = async (env: Env, space: Space, app: App): Promise<Join | null> =>
  app.join !== undefined || app.installed
    ? app.join ?? null
    : (await declarationOf(env, space, app)).vocab.join as Join | undefined ??
      null

// Who stands higher, so Join is offered only where it gives more.
let RANK: (Role | null)[] = [null, 'viewer', 'editor', 'owner']

// An address as it is compared: ' Ann@Example.org' is 'ann@example.org'.
let plain = (s: string) => s.trim().toLowerCase()

/** Whether `email` is at the word's domain, or among the values its rows
 * hold. */
/// listed({ domain: 'x.org' }, 'Ann@X.org', []) -> true
/// listed({ domain: 'x.org' }, 'ann@sub.x.org', []) -> false
/// listed({}, 'bo@y.org', ['ann@x.org; Bo@y.org']) -> true
export let listed = (join: Join, email: string, values: unknown[]) => {
  let at = plain(email)
  return (!!join.domain && at.endsWith('@' + plain(join.domain))) ||
    values.some((v) => addresses(v).includes(at))
}

// A property path the word names, `individual.email`: words joined by dots,
// and nothing a query would read as structure.
let PATH = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/i

// The values the word's properties hold in the app's store, among the rows
// `where` keeps, read by the kernel: one distinct read a property. `where` is
// the app's own query, so it is read whole: parsed and written back, it is
// one group whatever its author typed, and a path that is not one is asked of
// nobody.
let values = async (
  env: Env,
  space: Space,
  app: App,
  join: Join,
  paths: string[],
) => {
  let store = metaOf(appStore(env.STORE, space, app, env), KERNEL)
  let where = join.where
    ? line`&(${sub(stringify(parse(join.where)))})`
    : line``
  let said = await Promise.all(
    paths.filter((path) => PATH.test(path)).map((path) =>
      store.query(
        line`.${path.split('.')[0]}${sub(where)}&.distinct=${path}`,
        { trusted: true },
      )
    ),
  )
  return said.flatMap((s) => (s as unknown as { distinct: unknown[] }).distinct)
}

/** Whether `number` is among the numbers the values hold, however typed. */
/// dialed('+12695550142', ['(269) 555-0142']) -> true
/// dialed('+12695550142', ['269-555-0199', 3]) -> false
export let dialed = (number: string, values: unknown[]) =>
  values.some((v) => typeof v == 'string' && e164(v) == number)

/**
 * The role `who` may join `app` at, or null: signed in, not a member of the
 * space (whose role member_add changes, never a grant beside it), at less
 * than the word gives, and listed by the app's own data.
 */
export let joinable = async (
  env: Env,
  dir: Pick<Directory, 'emailAt' | 'phoneAt'>,
  space: Space,
  app: App,
  who: { person: string | null; role: Role | null; guest?: boolean },
): Promise<Role | null> => {
  if (!who.person || (who.role && !who.guest)) return null
  let join = await joinOf(env, space, app)
  if (!join?.domain && !join?.emails?.length && !join?.phones?.length) {
    return null
  }
  let role = join?.role ?? 'viewer'
  if (RANK.indexOf(who.role) >= RANK.indexOf(role)) return null
  let [email, phone] = await Promise.all([
    dir.emailAt(who.person),
    join.phones?.length ? dir.phoneAt(who.person) : null,
  ])
  let number = phone && e164(phone)
  if (email && listed(join, email, [])) return role
  let [emails, phones] = await Promise.all([
    email ? values(env, space, app, join, join.emails ?? []) : [],
    number ? values(env, space, app, join, join.phones ?? []) : [],
  ])
  return (email && listed(join, email, emails)) ||
      (number && dialed(number, phones))
    ? role
    : null
}

/** Pressing Join: the grant written, and the space's people told who joined,
 * in their Updates, as an accepted invitation tells them. */
export let join = async (
  env: Env,
  dir: Directory,
  space: Space,
  app: App,
  person: string,
  role: Role,
) => {
  let grant = await (await import('./invite.ts')).holding(
    dir,
    { space, app },
    person,
    role,
  )
  await dir.apply(
    { entities: [grant] },
    { 'x-yak-person': person, 'x-yak-role': 'owner' },
  )
  await (await import('./operator-updates.ts')).tell(env, space, {
    to: space.eid,
    words: `${await dir.nameAt(person) ?? 'Someone'} joined ${
      app.title || app.slug
    }.`,
    about: app.eid,
    by: person,
    id: grant.entity.eid,
  })
}
