// Run: deno run -A bin/scratch.ts deno run -A workers/yak/package-vocab-probe.ts
// Internal, manual-only evidence probe; never imported by production or the test suite.
// Optional package words through the Store's real deploy, wake and rollback
// doors, without importing a lender's facet in this probe.
import { equal, ok } from '@yaks/testing'
import { Store } from './graph.ts'
import { keep, slot, state } from './testing.ts'

let pkg = { packages: ['@yaks/tmux'] }
let remembered = { packages: ['@yaks/process'] }
let retained = { packages: ['@yaks/heal'] }
let headers = {
  'x-store': 'lazy/packages',
  'x-yak-person': 'a0000000-0000-4000-8000-000000000001',
  'x-yak-role': 'owner',
  'x-yak-kernel': '1',
}
let send = (store: Store, path: string, value?: unknown, release?: string) =>
  store.fetch(
    new Request(`https://store${path}`, {
      method: value === undefined ? 'GET' : 'POST',
      headers: { ...headers, ...(release ? { 'x-yak-release': release } : {}) },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    }),
  )

let deploying = state(),
  waking = state(),
  rollback = state(),
  clashing = state()
let deployStore = new Store(deploying), clashStore = new Store(clashing)
// Warm the base stores only. The first /vocab POST must load the optional facet.
await send(deployStore, '/vocab')
await send(clashStore, '/vocab')
// A persisted declaration, never composed in this process by the fixture.
keep(waking, 'name', 'lazy/packages')
keep(waking, 'vocab', JSON.stringify(remembered))
keep(rollback, 'name', 'lazy/packages')
keep(rollback, 'vocab', JSON.stringify(retained))
keep(rollback, 'release', 'new')
keep(rollback, 'vocab:old', '{}')
let wakeStore = new Store(waking), rollbackStore = new Store(rollback)

// Drive the expensive Store fixtures while the file loads, then assert each
// answer separately. Each boundary uses a different optional facet so an earlier
// case cannot prepare it accidentally.
let deployed = await send(deployStore, '/vocab', pkg)
let planted = await send(deployStore, '/apply', [{
  entity: { eid: 'pane' },
  tmux: { pane: '%42' },
}])
let plantedBody = await planted.json()
let clash = await send(clashStore, '/vocab', {
  packages: ['@yaks/machine'],
  $defs: {
    machine: { component: true, properties: { label: { type: 'string' } } },
  },
})
let clashText = await clash.text()
let woken = await send(wakeStore, '/apply', [{
  entity: { eid: 'remembered' },
  process: { pid: 43 },
}])
let awakeAgain = await send(new Store(waking), '/query?q=.process')
let plantedRetained = await send(rollbackStore, '/apply', [{
  entity: { eid: 'retained' },
  nofix: {},
}])
let rolled = await send(rollbackStore, '/vocab', undefined, 'old')
let rolledBody = await rolled.json()
let rows = await send(new Store(rollback), '/query?q=.nofix')
let rowsText = await rows.text()

console.log('a package deployment loads optional words before admitting rows')
{
  equal(deployed.status, 200)
  equal(planted.status, 200)
  ok(JSON.stringify(plantedBody).includes('%42'))
}

console.log('a dependency clash refuses with both declarations named')
{
  equal(clash.status, 400)
  ok(clashText.includes('@yaks/machine') && clashText.includes('vocab.json'))
  equal(slot(clashing, 'vocab'), null)
}

console.log(
  'a fresh incarnation loads its remembered package before fitting tables',
)
{
  equal(woken.status, 200)
  equal(awakeAgain.status, 200)
}

console.log('a rollback after wake keeps dependency words that hold rows')
{
  equal(plantedRetained.status, 200)
  equal(rolled.status, 200)
  equal(rolledBody.packages, retained.packages)
  equal(rows.status, 200)
  ok(rowsText.includes('retained'))
}

for (let ctx of [deploying, waking, rollback, clashing]) {
  ctx.storage[Symbol.dispose]()
}
console.log('package vocabulary Store probe: passed')
