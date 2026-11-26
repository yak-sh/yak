import type { App, Directory, Role, Space } from './directory.ts'
import type { Env } from './env.ts'

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
