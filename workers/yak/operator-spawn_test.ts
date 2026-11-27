import { line } from '@yaks/query'
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { type Item, type Model, ModelError, type Request } from '@yaks/model'
import { parseHTML } from 'linkedom'
import { renderToStaticMarkup as renderToString } from 'react-dom/server'
import { platform } from './directory-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { conversationOf, frameOf } from './operator-host.ts'
import { reply } from '@yaks/session/conversation'
import { sentRows } from './operator-testing.ts'
import { transcript } from '@yaks/session'
import { PART } from '@yaks/persona'
import { agents } from './config.ts'

// The Operator runs on Sol and starts a helper in a child session, here on a
// model its spawn names: each ask is priced at its own model's price.
let SOL = agents.operator[0].model
let OTHER = 'other-model'
let price = (name: string) => ({ input: name == OTHER ? 4 : 2, output: 0 })
let asked: Request[] = []
// The child's answer comes back as words given to the session that asked.
let said = (r: Request) =>
  r.items.some((i) => i.kind == 'user' && i.text.endsWith('settled\nFixed.'))
let model: Model = Object.assign(
  (req: Request) => {
    asked.push(req)
    let items: Item[] = req.model == OTHER
      ? [{ kind: 'assistant', text: 'Fixed.' }]
      : said(req)
      ? [{ kind: 'assistant', text: 'The helper fixed the page.' }]
      : req.items.some((i) => i.kind == 'result')
      ? [{ kind: 'assistant', text: 'A helper is on it.' }]
      : [{
        kind: 'call',
        id: crypto.randomUUID(),
        name: 'spawn',
        args: JSON.stringify({ prompt: 'Fix the page', model: OTHER }),
      }]
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items,
      usage: { input_tokens: 1000, output_tokens: 0 },
    })
  },
  {
    info: (name: string) =>
      Promise.resolve({ name, price: price(name), context: 10_000 }),
  },
)

let owner = crypto.randomUUID()
// The platform holds the Operator's OpenAI key, so the Operator is on Sol.
let { env } = platform('operator-spawn', {
  OPENAI_OPERATOR_API_KEY: 'probe',
})
let dir = directoryOf(env.STORE)
let id = await dir.mint(owner, 'claude', 'Claude', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let space = (await dir.at(id))!
let store = operatorMemory()
let out = await operating(store, env, { model, name: SOL })
  .ask({ person: owner }, space, {
    say: 'The page is broken; fix it.',
  })
await drain(store)
let [child] = await store.g.read(line`.spawned.parent=${out.session}&*`)
let entries = async (session: string) =>
  (await transcript(store.g, session)).flatMap((b) =>
    b.cost ? [(b.cost as { dollars: number }).dollars] : []
  )

test("the Operator's helper works for its space at its own model's price", async () => {
  assertEquals(
    child.operator_session,
    (await store.g.get([out.session]))[0].operator_session,
  )
  let on = (name: string) => asked.filter((r) => r.model == name)
  let [other] = on(OTHER)
  assertEquals(on(OTHER).length, 1)
  // Given where spawn is given, which the helper is not.
  assert(on(SOL)[0].tools.some((t) => t.name == 'spawn'))
  assertEquals(other.tools.some((t) => t.name == 'spawn'), false)
  // The child's answer wakes the session that asked, once.
  assertEquals(on(SOL).filter(said).length, 1)
  assertEquals(said(on(SOL).at(-1)!), true)
  assertEquals(await entries(child.entity.eid), [0.004])
  assertEquals((await entries(out.session)).every((d) => d == 0.002), true)
})

// Everything the Operator and its helper were sent besides the conversation
// is one entry each, closed, opening on each layer of the system prompt and
// on the tools (each with its description and schema), the helper's inside
// the step that started it. What the page drew above is not drawn again.
test('the conversation shows the context the Operator and each helper were given, closed until opened', async () => {
  let page = async (everyone?: () => Promise<null>) =>
    parseHTML(
      `<main>${
        (await conversationOf(
          store,
          '/manage/claude/operator',
          out.session,
          undefined,
          everyone,
          space.operator,
        )).html
      }</main>`,
    ).document
  let named = (d: Element) => d.querySelector(':scope > summary')!.textContent
  // The person's page draws each closed, holding only Loading, for its
  // script to fetch as it opens (operator-talk-browser.ts); the admin's, with no script,
  // draws them whole.
  let contexts = (d: Document) =>
    [...d.querySelectorAll('.More')].filter((m) =>
      named(m)!.startsWith('The context')
    )
  let lazy = contexts(await page())
  assertEquals(lazy.length, 2)
  for (let d of lazy) {
    assertEquals(d.hasAttribute('data-lazy'), true)
    assertEquals(
      d.querySelector(':scope > .More_Body')!.textContent!.trim(),
      'Loading…',
    )
  }
  let document = await page(() => Promise.resolve(null))
  let layers = (d: Element) => [
    ...d.querySelectorAll(':scope > .More_Body > .More'),
  ]
  let [operator, helper, ...more] = [...document.querySelectorAll('.More')]
    .filter((d) => named(d)!.startsWith('The context'))
  assertEquals(more, [])
  assertEquals(named(operator), `The context ${space.operator} was given`)
  assertEquals(named(helper), 'The context the helper was given')
  let first = (m: string) => asked.find((r) => r.model == m)!
  let shown = (at: Element) =>
    at.querySelector(':scope > .More_Body > .Body')?.outerHTML ??
      at.querySelector(':scope > .More_Body > p')?.textContent
  let drawn = (md: string) =>
    parseHTML(renderToString(reply(md))).document.querySelector(
      '.Transcript_Reply',
    )!
      .innerHTML
  let whoOf = (m: string) =>
    first(m).instructions!.split(' Who you are\n')[1].split(PART)[0].trim()
  for (let [d, m] of [[operator, SOL], [helper, OTHER]] as const) {
    let all = layers(d)
    assertEquals(
      [all[0], ...all.slice(-2)].map(named),
      [
        'yaks.app Operator',
        'Reads',
        `${first(m).tools.length} tools`,
      ],
    )
    for (let l of [d, ...all]) assertEquals(l.hasAttribute('open'), false)
    // Every layer is its part of what the model received, in order: each
    // document under its heading, drawn as written unless drawn above.
    let said = first(m).instructions!
    let at = 0
    for (let l of all.slice(0, -1)) {
      let found = said.indexOf(` ${named(l)}\n`, at)
      assert(found >= at, named(l))
      at = found
    }
    let who = all.find((l) => named(l) == 'Who you are')!
    assertEquals(
      shown(who),
      d == helper && whoOf(m) == whoOf(SOL)
        ? 'The same as above.'
        : drawn(whoOf(m)),
    )
  }
  // Each tool is drawn once on the page, where it was first offered.
  let offers = [SOL, OTHER].flatMap((m) =>
    first(m).tools.map((t) => JSON.stringify(t))
  )
  assertEquals(
    [operator, helper].flatMap((d) => layers(layers(d).at(-1)!)).length,
    new Set(offers).size,
  )
  // Each tool by its name, opening on its description and its schema.
  let spawn = first(SOL).tools.find((t) => t.name == 'spawn')!
  let tool = layers(layers(operator).at(-1)!).find(
    (d) => named(d) == 'spawn',
  )!
  assertEquals(shown(tool), drawn(spawn.description))
  assertEquals(
    tool.querySelector('pre')!.textContent,
    JSON.stringify(spawn.parameters, null, 2),
  )
  // The helper's context sits inside the step that started it.
  let step = helper.parentElement!.closest('.More')!
  assertEquals(named(step), 'Started a helper')
  let words = document.querySelectorAll(
    '.Transcript_Bubble, .Transcript_Reply, .Transcript_Error',
  )
  for (let w of words) {
    assertEquals(w.textContent!.includes('The context'), false)
  }
  let live = await frameOf(store, child.entity.eid)
  assertEquals(live!.frame.operator.task, out.session)
  // A helper's step brings the page that step, live, its context inside.
  let rows = sentRows(live!.frame.operator.lines)
  let top = [...document.querySelectorAll('[id^="row-"]')].find((r) =>
    r.contains(step) && !r.parentElement!.closest('[id^="row-"]')
  )!
  assertEquals(rows[0].id, top.id.slice('row-'.length))
  assertStringIncludes(rows[0].html, 'The context the helper was given')
  // and its row under the turn, which the page drew there too.
  assertEquals(rows.length, 2)
  assert(document.getElementById(`row-${rows[1].id}`))
  assertStringIncludes(rows[1].html, `data-help="${child.entity.eid}"`)
})

// A helper's end reaches the conversation as one of the Operator's steps,
// never as words the person said: the one that settled and the one whose
// model was refused, as Opus was in Jeff's space for want of budget.
let REFUSED = 'What is left of claude’s model and voice budget is too little'
let talked = async (refused: boolean) => {
  let store = operatorMemory()
  let refusing: Model = Object.assign(
    (req: Request) =>
      refused && req.model == OTHER
        ? Promise.reject(new ModelError('limit', REFUSED))
        : model(req),
    { info: model.info },
  )
  let { session } = await operating(store, env, { model: refusing, name: SOL })
    .ask({ person: owner }, space, { say: 'The page is broken; fix it.' })
  await drain(store)
  let { html } = await conversationOf(
    store,
    '/manage/claude/operator',
    session,
  )
  let { document } = parseHTML(`<main>${html}</main>`)
  let all = (s: string) =>
    [...document.querySelectorAll(s)].map((e) => e.textContent?.trim())
  return { all, document }
}

test("a helper's end is the Operator's step in the conversation, never the person's words", async () => {
  for (let refused of [false, true]) {
    let { all } = await talked(refused)
    assertEquals(all('.Transcript_Bubble'), ['The page is broken; fix it.'])
    assertEquals(
      all('.More:not(.Transcript_Error > *) > summary').at(-1),
      refused ? 'A helper could not finish' : 'Heard back from a helper',
    )
    if (refused) {
      assertEquals(all('.More-no .Transcript_Error > p'), [
        'A helper the Operator started could not finish, so the Operator went on without it.',
      ])
      assertStringIncludes(all('.Transcript_Error pre').join(), REFUSED)
    }
  }
})

// Helpers refused while the Operator prepares its next request are heard in
// that request, as Jeff's three were not: it said it had started them after
// their refusals were in, then that none had run (T-137585).
test('the Operator hears helpers refused while it prepares, and answers once', async () => {
  let store = operatorMemory()
  let parent: string | undefined
  let delivered = new Set<string>()
  let ready = Promise.withResolvers<void>()
  let read = store.g.read
  let apply = store.g.apply
  // Hold the parent's tool preparation until every helper's refusal is in
  // its transcript. Their preparation speed must not determine this race.
  store.g.read = async (query, options) => {
    let rows = await read(query, options)
    if (
      parent && typeof query == 'string' &&
      query.startsWith(`.entity.eid=${parent}&.fields=spawned.parent`)
    ) await ready.promise
    return rows
  }
  store.g.apply = async (bundles, options) => {
    let rows = await apply(bundles, options)
    for (let row of rows) {
      if (
        (row.entry as { session?: string } | undefined)?.session == parent &&
        (row.content as { body?: string } | undefined)?.body?.endsWith(REFUSED)
      ) delivered.add(row.entity.eid)
    }
    if (delivered.size == 3) ready.resolve()
    return rows
  }
  let heard = (r: Request) =>
    r.items.filter((i) => i.kind == 'user' && i.text.endsWith(REFUSED)).length
  let three: Model = Object.assign(
    (req: Request) => {
      if (req.model == OTHER) {
        return Promise.reject(new ModelError('limit', REFUSED))
      }
      parent = req.conversation
      let items: Item[] = req.items.some((i) => i.kind == 'result')
        ? [{ kind: 'assistant', text: `${heard(req)} of 3 were refused.` }]
        : [1, 2, 3].map(() => ({
          kind: 'call',
          id: crypto.randomUUID(),
          name: 'spawn',
          args: JSON.stringify({ prompt: 'Fix an app', model: OTHER }),
        }))
      return Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items,
        usage: { input_tokens: 1000, output_tokens: 0 },
      })
    },
    { info: model.info },
  )
  let { session } = await operating(store, env, { model: three, name: SOL })
    .ask({ person: owner }, space, { say: 'Fix every app with errors.' })
  await drain(store)
  assertEquals(
    (await transcript(store.g, session)).flatMap((b) =>
      b.output ? [(b.content as { body: string }).body] : []
    ),
    ['3 of 3 were refused.'],
  )
})
