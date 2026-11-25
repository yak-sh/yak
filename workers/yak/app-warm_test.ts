import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { warmApp, warmApps } from './app-warm.ts'
import { WARMING } from './dispatch.ts'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'

// An environment whose dispatch namespace records each start it is sent.
let site = () => {
  let started: string[] = []
  let env = {
    APEX: 'yaks.app',
    DISPATCH: {
      get: (name: string) => ({
        fetch: (r: Request) => {
          if (r.headers.has(WARMING)) started.push(`${name} ${r.url}`)
          return Promise.resolve(new Response(null, { status: 204 }))
        },
      }),
    },
  } as unknown as Env
  return { env, started, settled: () => new Promise((r) => setTimeout(r, 0)) }
}
let space = { eid: crypto.randomUUID(), slug: 'jeff' } as Space
let app = (slug: string, worker?: string) =>
  ({ eid: crypto.randomUUID(), slug, worker, store: `jeff/${slug}` }) as App

test('an app drawn is started once a minute, through its wrapper, and an app with no worker never', async () => {
  let s = site()
  let mail = app('mail', 'worker.js')
  warmApp(s.env, space, mail, 0)
  warmApp(s.env, space, mail, 59_999)
  warmApp(s.env, space, app('notes', ''), 0)
  await s.settled()
  assertEquals(s.started, ['jeff_mail https://jeff.yaks.app/mail/'])
  warmApp(s.env, space, mail, 60_000)
  await s.settled()
  assertEquals(s.started.length, 2)
})

test('a new release starts even while the old worker is warm', async () => {
  let s = site()
  let notes = app('notes', 'worker.js')
  warmApp(s.env, space, { ...notes, script: 'notes-old' }, 0)
  warmApp(s.env, space, { ...notes, script: 'notes-new' }, 1)
  await s.settled()
  assertEquals(s.started, [
    'notes-old https://jeff.yaks.app/notes/',
    'notes-new https://jeff.yaks.app/notes/',
  ])
})

test('a page starts the first few of the apps it draws', async () => {
  let s = site()
  warmApps(
    s.env,
    space,
    [
      app('plain', ''),
      ...Array.from({ length: 12 }, (_, i) => app(`a${i}`, 'worker.js')),
    ],
  )
  await s.settled()
  assertEquals(s.started.length, 8)
})
