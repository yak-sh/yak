// A space's members tap between drafts of its apps: a round of matches in
// its Operator's store, a judge that reads the space's own drafts and no
// other space's, the page drawing the next pair, and where each side stands
// written into what a decision's choice can say.
import { equal, ok, test } from '@yaks/testing'
import { mint } from '@yaks/graph'
import { matched } from '@yaks/trial/match'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { ADA, SECRET, seeded } from './serving-data-probe.ts'
import { platform } from './directory-rows-probe.ts'
import { operators } from './operator-service-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { operatorMemory } from './operator-testing.ts'
import { matching, seeing, type Tapping } from './operator-trials.ts'
import { matches } from './matches.ts'

let runtime = platform(SECRET, { BUILDER: operators })
let { env } = { ...runtime, ...lifecycleStores(runtime.env) }
let { dir, space } = await seeded(env, 'public', runtime.dir)
let ctx: Ctx = { env, dir, person: ADA }
let run = (name: string, args: Record<string, unknown>) =>
  TOOLS.find((t) => t.name == name)!.run(ctx, args)
await run('app_new', { slug: 'covers', title: 'Covers', access: 'public' })
let drafted = async (body: string, draft?: string) =>
  String(
    (await run('app_files', {
      app: 'covers',
      ...draft ? { draft } : {},
      path: 'index.html',
      content: `<html><body>${body}</body></html>`,
    })).value!.draft,
  )
let warm = await drafted('Warm')
let plain = await drafted('Plain', 'new')

// The space's Operator store, which names its space by its sessions.
let store = operatorMemory()
await store.g.apply([{
  entity: { eid: mint() },
  session: {},
  operator_session: { space: space.eid, person: ADA },
}], { trusted: true })
await store.g.apply(
  matched({ key: 'c1', title: 'Covers', sides: [warm, plain] }),
  {
    trusted: true,
  },
)

test("a judge sees the space's own drafts as their files hold them, and nothing else", async () => {
  let elsewhere = mint()
  let seen = await seeing(env, store)([warm, plain, elsewhere])
  equal([...seen.keys()].sort(), [warm, plain].sort())
  ok(seen.get(warm)!.startsWith('index.html:\n<html><body>Warm'))
  let other = operatorMemory()
  await other.g.apply([{
    entity: { eid: mint() },
    session: {},
    operator_session: { space: mint(), person: ADA },
  }], { trusted: true })
  equal((await seeing(env, other)([warm])).size, 0)
})

test('a member picks between two drafts, and the page says where each stands', async () => {
  let open = await matching(store, ADA, {}) as { rounds: { left: number }[] }
  equal(open.rounds.map((r) => r.left), [1])
  let read = await matching(store, ADA, { round: 'c1' }) as Tapping
  equal(read.card!.n, 1)
  let page = parseHTML(renderToString(matches(space, read))).document
  let frames = [...page.querySelectorAll('.Update_Draft iframe')]
    .map((f) => f.getAttribute('src'))
  equal(frames.length, 2)
  ok(frames.every((f) => f!.includes('/updates?draft=')), String(frames))
  equal(
    [...page.querySelectorAll('button[name=chose]')].map((b) =>
      b.getAttribute('value')
    ),
    ['first', 'second', 'neither'],
  )
  let first = read.card!.first.entity.eid
  let after = await matching(store, ADA, {
    round: 'c1',
    pair: 1,
    chose: 'first',
    why: 'warmer',
  }) as Tapping
  equal([after.card, after.left, after.picked], [undefined, 0, 1])
  equal(after.places[0].eid, first)
  ok(
    after.places[0].measured.startsWith(
      'First of 2 by its rating, 131: chosen in 1 of 1 pick by 1 person',
    ),
    after.places[0].measured,
  )
  let [tap] = await store.g.read('.preference *')
  equal((tap.created as { by: string }).by, ADA)
  let done = renderToString(matches(space, after))
  ok(done.includes('Nothing left to pick here'), done)
  ok(done.includes('So far'), done)
})
