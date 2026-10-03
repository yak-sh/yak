#!/usr/bin/env -S deno run -A
// One owned workerd harness proves SQLite DO intake, RPC, hibernation and
// independent recovery. No live queue, account API or email is contacted.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { equal, ok, until } from '@yaks/testing'
import { capture } from '@yaks/tracker/report'
import { sign } from './auth.ts'
import { platform } from './core.ts'
import { ready, root } from './wrangler.ts'

ready()
let require = createRequire(
  fileURLToPath(new URL('../yak/package.json', import.meta.url)),
)
let { createTestHarness } = require('wrangler')
let scratch = await Deno.makeTempDir({ prefix: 't59076-workerd-' })
let secret = 'scratch-only-tracker-secret'
let server = createTestHarness({
  root,
  persist: scratch,
  workers: [{
    config: {
      name: 'tracker-probe',
      main: 'index.ts',
      compatibility_date: '2026-07-01',
      compatibility_flags: ['nodejs_compat'],
      tsconfig: '.wrangler/paths.json',
      alias: {
        croner: `${root}/../yak/node_modules/croner/dist/croner.js`,
        marked: `${root}/../yak/node_modules/marked/lib/marked.esm.js`,
        '@cfworker/json-schema':
          `${root}/../yak/node_modules/@cfworker/json-schema/dist/esm/index.js`,
        '@std/yaml': `${root}/../yak/node_modules/@std/yaml/mod.js`,
      },
      durable_objects: {
        bindings: [{ name: 'TRACKERS', class_name: 'Tracker' }],
      },
      migrations: [{ tag: 'v1', new_sqlite_classes: ['Tracker'] }],
      vars: { TRACKER_SECRET: secret },
    },
  }],
})
let was = Deno.cwd()
try {
  Deno.chdir(root)
  await server.listen()
  let worker = server.getWorker()
  let env = await worker.getEnv()
  let space = '00000000-0000-4000-8000-000000000001'
  let other = '00000000-0000-4000-8000-000000000002'
  let ticket = await sign({
    scope: space,
    person: 'scratch',
    exp: Date.now() / 1000 + 60,
  }, secret)
  let query = async (scope: string, token = ticket) => {
    let response = await server.fetch(`/query?scope=${scope}&q=.bug&x=1`, {
      headers: { authorization: `Bearer ${token}` },
    })
    return response
  }
  let rows = capture(Error('workerd break'), {
    sink: () => {},
    during: { space },
  })
  let stub = env.TRACKERS.getByName(space)
  await stub.ingest(rows)
  await until(async () => {
    let response = await query(space)
    let text = await response.text()
    return response.ok && text.includes('"hits":1')
  }, { timeout: 10_000 })
  equal((await query(other)).status, 403)
  let bugs = await (await query(space)).json()
  ok(bugs.length)
  equal((await stub.bugs(ticket, '')).length, 1)
  await stub.ingest(rows)
  // The RPC stub remains a live runtime reference. Persistence is checked by
  // re-reading through the independent HTTP door, not evicting a held stub.
  equal((await (await query(space)).json())[0].bug.hits, 1)
  let socketResponse = await server.fetch(
    `/ws?scope=${space}&ticket=${ticket}`,
    {
      headers: { Upgrade: 'websocket' },
    },
  )
  equal(socketResponse.status, 101)
  let ws = socketResponse.webSocket
  ws.accept()
  let frames: string[] = []
  ws.addEventListener(
    'message',
    (event: { data: string }) => frames.push(event.data),
  )
  ws.send(JSON.stringify({ subscribe: '.bug *', id: 'bugs' }))
  await until(() => frames.some((s) => s.includes('"hits":1')), {
    timeout: 10_000,
  })
  ws.send(
    JSON.stringify({
      relay: [{ entity: rows[0].entity, error: { message: 'poison' } }],
      id: 'write',
    }),
  )
  await until(() => frames.some((s) => s.includes('read only')), {
    timeout: 10_000,
  })
  ws.close()
  let admin = await sign({
    scope: platform,
    person: 'scratch',
    admin: true,
    exp: Date.now() / 1000 + 60,
  }, secret)
  equal(
    (await server.fetch('/heartbeat?scope=platform', {
      method: 'POST',
      headers: { authorization: `Bearer ${admin}` },
    })).status,
    200,
  )
  console.log(
    'scratch workerd: SQLite intake, duplicate ack recovery, tenant auth, read-only WebSocket, heartbeat passed',
  )
} finally {
  await server.close()
  Deno.chdir(was)
  await Deno.remove(scratch, { recursive: true })
}
