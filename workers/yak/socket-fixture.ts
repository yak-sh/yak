// Directory responses for a Store fixture whose sockets refresh standing.
import type { Namespace } from '@yaks/durable-object/door'
import type { Level } from '@yaks/member'
import { EPOCH } from './directory-copy.ts'
import { useUntil } from './used.ts'

let SPACE = 'e0000000-0000-4000-8000-000000000005'

export let socketDirectory = (
  app: string,
  members: Record<string, Level>,
  { access = 'private', revision = 1 } = {},
): Namespace => ({
  idFromName: (name) => name,
  get: () => ({
    fetch: (req) => {
      let url = new URL(req.url)
      if (url.pathname == '/used') {
        return Promise.resolve(Response.json({ at: useUntil() }))
      }
      let q = url.searchParams.get('q') ?? ''
      let seats = Object.entries(members).filter(([person]) =>
        q.includes(`.member.person=${person}`)
      ).map(([person, role]) => ({
        entity: { eid: person },
        member: { space: SPACE, person, role },
      }))
      return Promise.resolve(Response.json([
        ...q.includes(`.entity.eid=${app}`)
          ? [{ entity: { eid: app }, app: { space: SPACE, access } }]
          : [],
        ...seats,
      ], { headers: { [EPOCH]: String(revision) } }))
    },
  }),
})
