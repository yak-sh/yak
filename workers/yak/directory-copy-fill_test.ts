// The serving copy's door as every request opens it (`copyOf`): each line the
// directory answers is told to the copy once per revision, not once per
// request, and a stalled read is still answered only at a revision the copy
// holds current.
import { clock, equal, ok, test } from '@yaks/testing'
import {
  copyOf,
  type Filled,
  REFILL,
  type ServingCopyDoor,
} from './directory-copy.ts'
import { connector, fresh, owned, txt, vocabFile } from './probe.ts'
import { ServingCopy } from './serving-copy.ts'

// A copy behind an RPC-shaped door, saying what it was told.
let copied = () => {
  let core = new ServingCopy({
    persistence: { read: () => undefined, write: () => {} },
  })
  let told: Filled[] = []
  let rpc: ServingCopyDoor = {
    begin: (floor) => Promise.resolve(core.begin(floor)),
    finish: (revision) => Promise.resolve(core.finish(revision)),
    revision: () => Promise.resolve(core.revision),
    settle: (revision, committed) =>
      Promise.resolve(core.settle(revision, committed)),
    valid: (revision) => Promise.resolve(core.valid(revision)),
    read: (key) => Promise.resolve(core.read(key)),
    get: (key) => Promise.resolve(core.get(key)),
    put: (
      ...answer
    ) => (told.push(answer), Promise.resolve(core.put(...answer))),
    publish: (...answer) => (
      told.push(answer), Promise.resolve(core.publish(...answer))
    ),
    publishes: (answers) => (
      told.push(...answers), Promise.resolve(core.publishes(answers))
    ),
  }
  return {
    core,
    told,
    binding: { idFromName: (n: string) => n, get: () => rpc },
  }
}

let copy = copied()
let k = await fresh({ SERVING_COPY: copy.binding })
let agent = connector(k, k.owner.cookie)
await owned(k, k.owner.person, 'yourname', 'Demos')
await agent.tool('app_new', {
  space: 'yourname',
  slug: 'notes',
  title: 'Notes',
  access: 'private',
})
await agent.tool('app_files', {
  space: 'yourname',
  app: 'notes',
  files: [
    { path: 'index.html', content: '<script src="notes.js"></script>' },
    { path: 'notes.js', content: 'export {}' },
    { path: 'vocab.json', content: vocabFile({ note: { title: txt } }) },
  ],
})
await agent.tool('app_deploy', { space: 'yourname', app: 'notes' })
await agent.tool('app_publish', {
  space: 'yourname',
  app: 'notes',
  name: 'notes',
})

// A stranger opening the app: its page, a file and `me`. What the copy was
// told, and whether any of the requests waited on it.
let visit = async () => {
  let waited = false
  for (let path of ['/notes/', '/notes/notes.js', '/notes/api/me']) {
    let r = await k.at(`yourname.${k.host}`, path)
    equal(r.status, 200)
    waited ||= /copy_wait/.test(r.headers.get('server-timing') ?? '')
    await r.body?.cancel()
  }
  await k.settled()
  return { told: copy.told.splice(0), waited }
}

test('serving copy: a line is told once per revision, and again after a write', async () => {
  ok((await visit()).told.length)
  equal(await visit(), { told: [], waited: false })
  await owned(k, k.owner.person, 'other')
  // What it was told at the copy's revision, the copy holds for a stall.
  let held = (await visit()).told.filter(([revision]) =>
    copy.core.valid(revision)
  )
  ok(held.length)
  for (let [revision, key, body] of held) {
    equal(copy.core.read(key), { revision, body })
  }
})

// The door alone, at a clock of its own.
let door = () => {
  let c = copied(), time = clock()
  let at = copyOf({ SERVING_COPY: c.binding, CLOCK: time })!
  return { ...c, time, at }
}

test('serving copy: a line is told again after REFILL, or once a fence empties it', async () => {
  let { core, told, time, at } = door()
  let fill = () => at.publishes!([[0, 'q', 'body']])
  equal(await fill(), [true])
  equal(await fill(), [true])
  equal(told.length, 1)
  await time.advance(REFILL)
  await fill()
  equal(told.length, 2)
  let fence = await at.begin()
  equal(await at.finish(fence), true)
  equal(await at.publishes!([[fence, 'q', 'body']]), [true])
  equal(told.length, 3)
  equal(core.read('q'), { revision: fence, body: 'body' })
})

test('serving copy: an answer the copy refused is told again', async () => {
  let { told, at } = door()
  equal(await at.publishes!([[5, 'q', 'body'], [0, 'r', 'body']]), [
    false,
    true,
  ])
  equal(await at.publishes!([[5, 'q', 'body'], [0, 'r', 'body']]), [
    false,
    true,
  ])
  equal(told.map(([, key]) => key), ['q', 'r', 'q'])
  equal(await at.put(5, 'q', 'body'), false)
  equal(told.length, 4)
})
