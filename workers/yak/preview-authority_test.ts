// The production store requires the directory revision on every app request.
import { equal, test } from '@yaks/testing'
import { directory, fetch as directoryFetch } from './directory.ts'
import {
  copyOf,
  type ServingCopyDoor,
  signedDirectory,
} from './directory-copy.ts'
import { handler } from './kernel.ts'
import { ServingCopy, type ServingCopyState } from './serving-copy.ts'
import { ADA, platform, seeded } from './serving-probe.ts'
import { type Ctx, TOOLS } from './tools.ts'

let saved: ServingCopyState | undefined
let copy = new ServingCopy({
  persistence: {
    read: () => saved,
    write: (next) => void (saved = next),
  },
})
let rpc: ServingCopyDoor = {
  begin: (floor) => Promise.resolve(copy.begin(floor)),
  finish: (revision) => Promise.resolve(copy.finish(revision)),
  revision: () => Promise.resolve(copy.revision),
  settle: (revision, committed) =>
    Promise.resolve(copy.settle(revision, committed)),
  put: (...args) => Promise.resolve(copy.put(...args)),
  get: (key) => Promise.resolve().then(() => copy.get(key)),
  valid: (revision) => Promise.resolve(copy.valid(revision)),
  publish: (...args) => Promise.resolve(copy.publish(...args)),
}
let p = platform({
  SERVING_COPY: { idFromName: (name) => name, get: () => rpc },
})
await seeded(p.env)
let ctx: Ctx = {
  env: p.env,
  dir: directory(signedDirectory(
    { fetch: (req) => directoryFetch(req, p.env) },
    copyOf(p.env),
  )),
  person: ADA,
}
let tool = (name: string, args: Record<string, unknown>) =>
  TOOLS.find((t) => t.name == name)!.run(ctx, args)
await tool('app_new', { slug: 'authority', title: 'Authority' })
await tool('app_files', {
  app: 'authority',
  path: 'index.html',
  content: '<html><body>A private draft</body></html>',
})
let preview = await tool('app_preview', { app: 'authority', screenshot: false })
let url = String(preview.value!.url)
let request = (path: string, init?: RequestInit) =>
  handler.fetch(new Request(new URL(path, url), init), p.env)
let read = await request('api/query?q=.doc')
let written = await request('api/apply', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify([{
    entity: { eid: '$note' },
    doc: { title: 'Private' },
  }]),
})
let result = await request('api/query?q=.doc.title=Private')
let rows = await result.json()

test('a draft preview carries serving authority to its store reads and writes', () => {
  equal(read.status, 200)
  equal(written.status, 200)
  equal(result.status, 200)
  equal(rows.length, 1)
  equal(rows[0].doc.title, 'Private')
})
