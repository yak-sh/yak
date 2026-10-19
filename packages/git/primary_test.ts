// Current checkouts select their repository metadata; retained repository
// observations without a checkout do not grow each liveness pass.
import { equal, ok, test } from '@yaks/testing'
import type { Comp, Graph, Visibility } from '@yaks/graph'
import { and, ne } from '@yaks/query'
import { discover, localFilesystem, primary, repositoryEid } from './host.ts'
import { fixture, git, template } from './testing.ts'

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

let seed = template(async (root) => {
  await git(root, 'init', '-q', '-b', 'main')
  await git(root, 'config', 'user.name', 'Test')
  await git(root, 'config', 'user.email', 'test@example.org')
  await git(root, 'commit', '-qm', 'Initial', '--allow-empty')
})
let root = await seed()
let placed = fixture().g
let tree = await discover(placed, root)
let repository = String((tree.worktree as Comp).repository)
equal(await primary(placed), [root])
let hide = (visibility: Visibility): Graph => ({
  ...placed,
  read: (q, opts) => placed.read(q, { ...opts, visibility }),
  get: (ids, names, opts) => placed.get(ids, names, { ...opts, visibility }),
})
let hidden = (eid: string) => and(ne('entity.eid', eid))
for (
  let [name, visibility] of [
    ['repository entity', { entity: hidden(repository) }],
    ['repository component', {
      components: { repository: hidden(repository) },
    }],
    ['worktree reference component', {
      components: { worktree: hidden(tree.entity.eid) },
    }],
    ['checkout workspace component', {
      components: { workspace: hidden(tree.entity.eid) },
    }],
  ] as [string, Visibility][]
) {
  test(`primary discovery excludes a hidden ${name}`, async () => {
    equal(await primary(hide(visibility)), [])
  })
}
