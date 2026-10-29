// Current checkouts select their repository metadata; retained repository
// observations without a checkout do not grow each liveness pass.
import { equal, ok, test } from '@yaks/testing'
import type { Graph } from '@yaks/graph'
import { localFilesystem, primary, repositoryEid } from './host.ts'
import { fixture } from './testing.ts'

let g = fixture().g
let filesystem = await localFilesystem(g)
await g.apply(Array.from({ length: 128 }, (_, i) => ({
  entity: {
    eid: repositoryEid(`/unreferenced/${i}/.git`, filesystem.entity.eid),
  },
  repository: {
    workspace: filesystem.entity.eid,
    common: `/unreferenced/${i}/.git`,
  },
})))

test('primary discovery does not materialize repositories without checkouts', async () => {
  let repositories = 0
  let reader: Graph = {
    ...g,
    read: async (...args) => {
      let rows = await g.read(...args)
      repositories += rows.filter((b) => b.repository).length
      return rows
    },
  }
  equal(await primary(reader), [])
  ok(repositories < 4, `${repositories} unrelated repository rows were read`)
})
