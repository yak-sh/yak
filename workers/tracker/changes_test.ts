import { equal, test, throws } from '@yaks/testing'
import { changes, directory, type Index, index, moved } from './changes.ts'
import { type State, Tracker } from './object.ts'
import { platform } from './core.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import { sign } from './auth.ts'

let secret = 'scratch', scope = '00000000-0000-4000-8000-000000000001'
let state = (name: string): State => {
  let kept = new Map<string, unknown>()
  return {
    id: { name },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
    storage: {
      ...durable(),
      get: <T>(key: string) => Promise.resolve(kept.get(key) as T),
      put: (key, value) =>
        Promise.resolve(void kept.set(key, structuredClone(value))),
    },
  }
}
let authority = new Tracker(state(platform), { TRACKER_SECRET: secret })
let changed: string[] = [], fail = false
let targetState = state(scope)
let env = {
  ERRORS: { send: () => Promise.resolve() },
  TRACKERS: {
    getByName: () => ({
      ingestTrace: () => Promise.resolve(false),
      settle: () => Promise.resolve(0),
      changed: (scope: string, tag: string) => {
        changed.push(tag)
        return fail
          ? Promise.reject(Error('publication unavailable'))
          : authority.changed(scope, tag)
      },
    }),
  },
}
let target = new Tracker(targetState, env)
let tracker = await target.boot(), bug = crypto.randomUUID()
await tracker.graph.apply([{
  entity: { eid: bug },
  bug: { fault: 'broken' },
  doc: { title: 'Broken' },
}], { trusted: true })
let ask = async (tag?: string, admin = true) =>
  authority.fetch(
    new Request('https://tracker/changes', {
      headers: {
        authorization: `Bearer ${await sign({
          scope: platform,
          person: 'test',
          admin,
          exp: Date.now() / 1000 + 60,
        }, secret)}`,
        ...tag ? { 'if-none-match': tag } : {},
      },
    }),
  )

test('the signed change feed hears alarm writes and retries unacknowledged publication after hibernation', async () => {
  let first = await ask(), tag = first.headers.get('etag')!
  equal((await ask(tag)).status, 304)
  equal((await ask(undefined, false)).status, 403)
  await target.alarm()
  let answer = await ask(tag)
  equal((await answer.json()).scopes.map((s: { scope: string }) => s.scope), [
    scope,
  ])
  equal(changed.length, 1)
  target = new Tracker(targetState, env)
  await target.alarm()
  equal(changed.length, 1)
  let held = answer.headers.get('etag')!
  equal((await ask(held)).status, 304)
  await (await target.boot()).graph.apply([{
    entity: { eid: bug },
    doc: { title: 'Changed' },
  }], { trusted: true })
  fail = true
  await target.alarm()
  equal((await ask(held)).status, 304)
  fail = false
  target = new Tracker(targetState, env)
  await target.alarm()
  equal((await ask(held)).status, 200)
  equal(changed.length, 3)
})

test('scope changes resume from old tags and survive duplicates and unknown eras', () => {
  let first = index(['platform', 'quiet'])
  let held = changes(first).tag
  let next = moved(first, 'busy', 'one')
  next = moved(next, 'other', 'one')
  next = moved(next, 'busy', 'two')
  equal(changes(next, held).scopes.map((s) => s.scope), ['busy', 'other'])
  equal(changes(next, `W/${changes(next).tag}`).scopes, [])
  equal(moved(next, 'busy', 'two'), next)
  equal(changes(next, '"unknown.3"').scopes.length, 4)
  equal(changes(next, `"${next.era}.9999"`).scopes.length, 4)
})

test('concurrent scope publications persist across restarts and failed writes retry', async () => {
  let saved: Index | undefined, fail = false
  let kept = {
    get: <T>(_key: string) => Promise.resolve(saved as T | undefined),
    put: (_key: string, value: unknown) => {
      if (fail) return Promise.reject(Error('storage unavailable'))
      saved = structuredClone(value) as Index
      return Promise.resolve()
    },
  }
  let one = directory(kept, () => Promise.resolve(['legacy']))
  let held = (await one.read()).tag
  await Promise.all(['a', 'b', 'c'].map((s) => one.move(s, 'one')))
  let two = directory(kept, () => Promise.resolve([]))
  equal((await two.read(held)).scopes.map((s) => s.scope), ['a', 'b', 'c'])
  fail = true
  await throws(() => two.move('d', 'one'))
  equal((await two.read(held)).scopes.length, 3)
  fail = false
  await two.move('d', 'one')
  equal((await two.read(held)).scopes.length, 4)
})
