// Joining an app whose own data lists you (T-135365). A church directory
// already holds every member's address, and keeping a second list of who may
// see it would be the owner's to keep in step forever. So the app says, in
// its vocab.json, which of its properties hold the addresses of people who
// belong, and optionally an email domain:
//
//     "join": { "emails": ["individual.email"], "domain": "example.org" }
//
// Somebody signed in whose address is among those rows, or at that domain,
// is offered Join, and one press writes the grant on this app that
// member_add would have offered them, at the word's `role` (viewer unless it
// says editor). Nobody else is offered anything, and an address is only
// ever the one a person signed in with, which a code mailed to it proved.
// Taking a row away stops its person joining; a grant already written stays
// until member_remove takes it, as any grant does.
import type { Directory, Role, Space } from './directory.ts'
import { type App, appStore } from './directory.ts'
import { declarationOf } from './declaration.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'

/** The `join` word of an app's vocab.json, as vocab.ts `appDoc` admits it. */
export type Join = {
  emails?: string[]
  domain?: string
  role?: 'viewer' | 'editor'
}

// Who stands higher, so Join is offered only where it gives more.
let RANK: (Role | null)[] = [null, 'viewer', 'editor', 'owner']

// An address as it is compared: ' Ann@Example.org' is 'ann@example.org'.
let plain = (s: string) => s.trim().toLowerCase()

/** The addresses one value holds: a household's row may list two. */
/// addresses('Ann@x.org, bo@x.org') -> ['ann@x.org', 'bo@x.org']
/// addresses(3) -> []
export let addresses = (value: unknown): string[] =>
  typeof value == 'string'
    ? value.split(/[\s,;]+/).map(plain).filter((a) => a.includes('@'))
    : []

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

// The values the word's properties hold in the app's store, read by the
// kernel: one distinct read a property, and none when the domain says yes.
let values = async (env: Env, space: Space, app: App, join: Join) => {
  let store = metaOf(appStore(env.STORE, space, app, env), KERNEL)
  let said = await Promise.all(
    (join.emails ?? []).map((path) =>
      store.query(`.${path.split('.')[0]}&.distinct=${path}`, { trusted: true })
    ),
  )
  return said.flatMap((s) => (s as unknown as { distinct: unknown[] }).distinct)
}

/**
 * The role `who` may join `app` at, or null: signed in, not a member of the
 * space (whose role member_add changes, never a grant beside it), at less
 * than the word gives, and listed by the app's own data.
 */
export let joinable = async (
  env: Env,
  dir: Pick<Directory, 'emailAt'>,
  space: Space,
  app: App,
  who: { person: string | null; role: Role | null; guest?: boolean },
): Promise<Role | null> => {
  if (!who.person || (who.role && !who.guest)) return null
  let join = (await declarationOf(env, space, app)).vocab.join as
    | Join
    | undefined
  let role = join?.role ?? 'viewer'
  if (!join || RANK.indexOf(who.role) >= RANK.indexOf(role)) return null
  let email = await dir.emailAt(who.person)
  if (!email) return null
  if (listed(join, email, [])) return role
  return listed(join, email, await values(env, space, app, join)) ? role : null
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
