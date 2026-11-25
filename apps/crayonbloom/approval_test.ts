// The print approval step on the platform in memory, from the app's own
// vocab.json and seed.json: a prepared document is asked of the book's owner
// as a decision, the answer is what lets it be quoted, and a new document is
// asked anew.
import { equal, test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseTools } from '@yaks/tools/declared'
import type { Bundle, Comp } from '@yaks/graph'
import type { Dispatch } from '../../workers/yak/door.ts'
import { appStore, storeName } from '../../workers/yak/directory.ts'
import { hosting } from '../../workers/yak/directory-rows-probe.ts'
import {
  ADA,
  ADA_OWNS,
  platform,
  seeded,
} from '../../workers/yak/serving-probe.ts'
import { answer, approval, approved, ask } from './approval.ts'
import { APPROVE, CHANGE } from './approve.ts'
import { store as storeOf } from './db.ts'
import type { Book } from './model.ts'

let read = (path: string) =>
  JSON.parse(Deno.readTextFileSync(new URL(`./${path}`, import.meta.url)))
let { $defs } = read('vocab.json') as { $defs: Record<string, Comp> }
let components = Object.fromEntries(
  Object.entries($defs).filter(([, d]) => !d.tool)
    .map(([name, d]) => [name, { ...d, component: true }]),
)
let tools = { ask_print_approval: $defs.ask_print_approval }

test('a prepared document is approved by its owner before it is quoted, and a new one is asked again', async () => {
  await using p = hosting(platform())
  let { env } = p
  let { space, app } = await seeded(env, 'private', p.dir)
  let asked: string[] = []
  env.DISPATCH = {
    get: () => ({
      fetch: async (req: Request) => {
        assertEquals(new URL(req.url).pathname.endsWith('/approval'), true)
        let { binding } = await req.json()
        asked.push(binding.vars.revision)
        return Response.json(ask(binding))
      },
    }),
  } as Dispatch
  let at = appStore(env.STORE, space, app)
  let send = async (path: string, body: unknown) => {
    let res = await at(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      ADA_OWNS,
    )
    assertEquals(res.status, 200, await res.text())
  }
  // The worker's env.APP, which takes a write as {entities}.
  let db = storeOf({
    fetch: async (path, init) => {
      await p.object(storeName(space, app)).alarm()
      await p.settled()
      if (path != '/apply') return at(path, init ?? {}, ADA_OWNS)
      let { entities } = JSON.parse(String(init!.body))
      return at(
        path,
        { method: 'POST', body: JSON.stringify(entities) },
        ADA_OWNS,
      )
    },
  })
  await send('/vocab', { $defs: components })
  await send('/tools', parseTools({ $defs: tools }, ['doc']))
  await send(
    '/apply',
    (read('seed.json') as Bundle[]).filter((b) => b.builder),
  )
  let book = crypto.randomUUID()
  let review = (revision: string) =>
    send('/apply', [{
      entity: { eid: book },
      doc: { title: 'The bridge' },
      coloring_book: { owner: ADA, prompt: 'Crossing the bridge' },
      print_review: { document: { id: revision }, revision },
    }])
  let current = async () =>
    (await db.query(`.entity.eid=${book}&?doc&?coloring_book&?print_review`))[
      0
    ] as Book
  let question = (revision: string) =>
    until(async () => {
      let b = await current()
      let a = await approval(db, b)
      return a && b.print_review?.revision == revision ? { b, a } : null
    }, { label: `approval of ${revision}` })

  let first = crypto.randomUUID()
  await review(first)
  let { b, a } = await question(first)
  let [decision] = await db.query(`.entity.eid=${a.decision}&?decision&?filed`)
  equal((decision.filed as Comp).assignee, ADA)
  equal(
    ((decision.decision as Comp).choices as Comp[]).map((c) => c.label),
    [APPROVE, CHANGE],
  )
  assertEquals(await approved(db, b), false)

  await answer(db, b, CHANGE)
  assertEquals(await approved(db, await current()), false)

  // Prepared again: the new document is asked of its owner anew, and only
  // approving it lets it be quoted.
  let second = crypto.randomUUID()
  await review(second)
  let again = await question(second)
  assertEquals(again.a.choice, undefined)
  await answer(db, again.b, APPROVE)
  assertEquals(await approved(db, await current()), true)
  equal(asked, [first, second])
})
