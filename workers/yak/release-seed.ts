// A seed follows the same component homes as an ordinary write. Each part
// waits with its candidate declaration until the directory records the release.
import { type App, draftStore } from './directory.ts'
import type { Door } from './door.ts'
import type { Env } from './env.ts'
import { type Reach, routed } from './reach.ts'
import type { Applying } from './seed.ts'
import { Pending, said } from './writes.ts'

export let applying =
  (store: Door, head: Record<string, string>, path = '/apply'): Applying =>
  (batch, check) =>
    store.consume(
      `${path}${check ? (path.includes('?') ? '&check=1' : '?check=1') : ''}`,
      async (r) => {
        let no = await said(r)
        if (r.status == 202) throw new Pending(no)
        return r.ok ? null : no
      },
      { method: 'POST', body: JSON.stringify(batch) },
      head,
    )

export let seeding = (
  env: Env,
  named: Reach,
  draft: Door,
  homes: { app: App; release: string }[],
  head: Record<string, string>,
): Applying => {
  let doors = new Map(homes.map(({ app, release }) => [
    app.eid,
    draftStore(env.STORE, named.space, app, release, env),
  ]))
  doors.set(named.app.eid, draft)
  let reach = [
    ...homes.map(({ app, release }) => ({
      ...named,
      app: { ...app, declaration: release },
    })),
    named,
  ]
  return async (bundles, check) => {
    let { parts } = await routed(env, reach, named, bundles)
    let answers = await Promise.all(parts.map(({ r, entities }) =>
      applying(
        doors.get(r.app.eid)!,
        head,
        `/seed?from=${named.app.eid}`,
      )(entities, check)
    ))
    return answers.find((no) => no != null) ?? null
  }
}
