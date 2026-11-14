// Releasing a draft merges what its preview wrote on its branch into the
// app's live rows (draft-merge.ts): at once where nothing conflicts, and
// where the preview and the live app changed one property, once the person
// picks a side, never over a live write they did not see.
import { equal, ok, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { appStore } from './directory.ts'
import type { Env } from './env.ts'
import { tools } from './preview-tools.ts'
import { ownedBy } from './directory-fixture.ts'
import { directory, fetch as directoryFetch } from './directory.ts'
import { platform } from './testing.ts'
import { operatorMemory } from './operator-testing.ts'
import { handler } from './kernel.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { KERNEL } from './meta.ts'
import { asked, type Asking, DRAFT, settled } from './draft-merge.ts'

// What the space's Operator was asked (build.ts `/operator/ask`); the rest
// of the builder is the platform's own.
let asks: Asking[] = []
let p = platform('draft merge')
let builder = p.env.BUILDER
p.env.BUILDER = {
  ...builder,
  idFromName: (name: string) => builder.idFromName(name),
  get: (id: never) => ({
    fetch: async (req: Request) => {
      if (new URL(req.url).pathname != '/operator/ask') {
        return builder.get(id).fetch(req)
      }
      asks.push(await req.json())
      return Response.json({ ok: true })
    },
  }),
} as Env['BUILDER']
let env = p.env
let dir = directory({ fetch: (r) => directoryFetch(r, env) })
let ADA = crypto.randomUUID()
let space = await ownedBy(dir, ADA, 'merging')
let ADA_OWNS = { 'x-yak-person': ADA, 'x-yak-role': 'owner' }
let ctx: Ctx = { env, dir, person: ADA }
let run = (name: string, args: Record<string, unknown>) =>
  TOOLS.find((t) => t.name == name)!.run(ctx, args)

await run('app_new', { slug: 'notes', title: 'Notes', access: 'public' })
await run('app_files', {
  app: 'notes',
  files: [
    { path: 'index.html', content: '<html><body>Notes</body></html>' },
    {
      path: 'vocab.json',
      content: JSON.stringify({
        $defs: { note: { properties: { text: { type: 'string' } } } },
      }),
    },
  ],
})
await run('app_deploy', { app: 'notes', message: 'Notes' })
let app = (await dir.app(space, 'notes'))!
let live = () => appStore(env.STORE, space, app, env)
let liveWrite = (bundles: Bundle[]) =>
  live().consume('/apply', (r) => r.json(), {
    method: 'POST',
    body: JSON.stringify(bundles),
  }, ADA_OWNS)
let texts = async () =>
  Object.fromEntries(
    (await live().consume('/query?q=.note', (r) => r.json(), {}, ADA_OWNS))
      .map((r: { entity: { eid: string }; note: { text: string } }) => [
        r.entity.eid,
        r.note.text,
      ]),
  )
let branches = async () =>
  (await live().consume('/branches', (r) => r.json(), {}, KERNEL)).branches
    .map((b: { id: number }) => b.id)
let note = (eid: string, text: string) => ({ entity: { eid }, note: { text } })
// A new draft, previewed, whose pages write `bundles` on its branch.
let drafted = async (word: string, bundles: Bundle[]) => {
  await run('app_files', {
    app: 'notes',
    path: 'index.html',
    content: `<html><body>${word}</body></html>`,
  })
  let out = await tools[0].run(ctx, { app: 'notes', screenshot: false })
  let res = await handler.fetch(
    new Request(new URL('api/apply', String(out.value!.url)), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entities: bundles }),
    }),
    env,
  )
  equal(res.status, 200, await res.clone().text())
  await res.body?.cancel()
  let d = (await dir.drafts(app)).find((d) => d.eid == out.value!.draft)!
  return d.branch!
}
let release = async () => {
  let out = await run('app_deploy', { app: 'notes', message: 'Next' })
  app = (await dir.app(space, 'notes'))!
  return String(out.text ?? JSON.stringify(out))
}

let [a, b, c] = [0, 1, 2].map(() => crypto.randomUUID())
await liveWrite([note(a, 'live'), note(b, 'live')])

test('a release whose preview conflicts with nothing merges it at once and drops its branch', async () => {
  let branch = await drafted('One', [note(b, 'drafted'), note(c, 'new')])
  // The person goes on writing the live app meanwhile.
  await liveWrite([note(a, 'the person’s')])
  let said = await release()
  ok(said.includes('merged what the draft'), said)
  equal(await texts(), { [a]: 'the person’s', [b]: 'drafted', [c]: 'new' })
  ok(!(await branches()).includes(branch))
  equal(asks, [])
})

test('a property both changed waits for the person, and their pick merges the rest', async () => {
  let branch = await drafted('Two', [note(a, 'mine'), note(c, 'newer')])
  await liveWrite([note(a, 'theirs')])
  let said = await release()
  ok(said.includes('wait for the person to pick'), said)
  equal(await texts(), { [a]: 'theirs', [b]: 'drafted', [c]: 'new' })
  ok((await branches()).includes(branch))
  equal(asks.length, 1)
  equal(asks[0].to, ADA)
  equal(
    asks[0].conflicts.map((x) => [x.eid, x.fork, x.branch, x.main]),
    [[a, 'the person’s', 'mine', 'theirs']],
  )
  let store = operatorMemory()
  store.fx.handle({
    draft_merge: (event) => settled(env, store.g, event.entity.eid),
  })
  let [question] = await store.g.apply(asked(asks[0]), { trusted: true })
  let answer = async (q: Bundle) => {
    await store.g.apply([{
      entity: q.entity,
      decided: { choice: DRAFT },
      $actor: { by: ADA },
    }], { trusted: true })
    // The answer owes the Operator store's draft_merge run on it, which
    // its pool works (operator-channels.ts `handleChannels`).
    await store.fx.work(store.g, undefined, { passes: 1 })
  }
  // Before the answer reaches the merge, the person writes the live value
  // again: the pick they made saw the one before, so they are asked again.
  await liveWrite([note(a, 'theirs again')])
  await answer(question)
  equal(await texts(), { [a]: 'theirs again', [b]: 'drafted', [c]: 'new' })
  let again = await store.g.read('.draft_conflict !decided')
  equal(again.length, 1)
  await answer(again[0])
  equal(await texts(), { [a]: 'mine', [b]: 'drafted', [c]: 'newer' })
  ok(!(await branches()).includes(branch))
})
