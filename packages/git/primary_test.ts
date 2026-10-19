// Current checkouts select their repository metadata; retained repository
// observations without a checkout do not grow each liveness pass.
import { equal, ok, test } from '@yaks/testing'
import { type Comp, derivedEid, type Graph, type Visibility } from '@yaks/graph'
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

let sampled = fixture().g
let place = await localFilesystem(placed)
await sampled.apply(
  await placed.get([
    place.entity.eid,
    String((place.workspace as Comp).machine),
    repository,
    tree.entity.eid,
  ]),
)
let crossed = repositoryEid(`${root}/wrong.git`, place.entity.eid)
await sampled.apply(Array.from({ length: 128 }, (_, i) => ({
  entity: { eid: derivedEid(`historical checkout ${i}`) },
  worktree: {
    repository,
    gitdir: `${root}/.git/worktrees/historical-${i}`,
  },
  workspace: { root: `/missing-checkout-${i}` },
})))
await sampled.apply([{
  entity: { eid: derivedEid('duplicate primary observation') },
  worktree: { repository, gitdir: `${root}/.git` },
  workspace: { root },
}, {
  entity: { eid: crossed },
  repository: {
    workspace: (await localFilesystem(sampled)).entity.eid,
    common: `${root}/wrong.git`,
  },
}, {
  entity: { eid: derivedEid('crossed primary observation') },
  worktree: {
    repository: crossed,
    gitdir: `${root}/.git`,
  },
  workspace: { root },
}])
let materialized = 0
let narrowed = await primary({
  ...sampled,
  read: async (...args) => {
    let rows = await sampled.read(...args)
    materialized += rows.length
    return rows
  },
})
test('primary discovery leaves historical checkout metadata in storage', () => {
  equal(narrowed, [root])
  ok(materialized < 8, `${materialized} checkout rows were materialized`)
})

let change = sampled.get
let moved = await primary({
  ...sampled,
  get: async (...args) => {
    let rows = await change(...args)
    if (args[0].includes(repository)) {
      await sampled.apply([
        tree.entity,
        { eid: derivedEid('duplicate primary observation') },
      ].map((entity) => ({ entity, workspace: { root: `${root}-missing` } })))
    }
    return rows
  },
})
await sampled.apply([
  tree.entity,
  { eid: derivedEid('duplicate primary observation') },
].map((entity) => ({ entity, workspace: { root } })))
test('primary discovery checks current checkout metadata after selecting candidates', () => {
  equal(moved, [])
})

let missing = `${root}-moved`
await Deno.rename(root, missing)
let removed = await primary(sampled)
await Deno.rename(missing, root)
test('primary discovery notices a checkout moved outside the graph', () => {
  equal(removed, [])
})

await git(root, 'checkout', '--detach')
let detached = await primary(sampled)
await git(root, 'symbolic-ref', 'HEAD', 'refs/heads/unborn')
let unborn = await primary(sampled)
await git(root, 'symbolic-ref', 'HEAD', 'refs/heads/main')
test('primary discovery keeps detached and unborn checkout liveness', () => {
  equal(detached, [root])
  equal(unborn, [root])
})
