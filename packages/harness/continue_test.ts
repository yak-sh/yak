// A conversation another harness ran, taken over here by another provider:
// its transcript is imported as Claude Code's, Codex's, Grok's and
// Antigravity's are, and a message naming a model asks that model with the
// whole conversation, its calls and results in order, after a note saying
// where it ran until now.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import type { Item, Request } from '@yaks/model'
import { line } from '@yaks/query'
import { look } from '@yaks/session/service'
import { textOf } from '@yaks/session'
import { harness } from './testing.ts'
import { local } from './local.ts'
import { runs } from './runs.ts'

let mint = () => crypto.randomUUID()
let dir = Deno.makeTempDirSync()
let id = '0f4a52e1-6c1e-4c55-9a1b-1e7f3c0f5b10'
let path = `${dir}/sessions/%2FUsers%2Ferik%2Fapp/${id}/chat_history.jsonl`
Deno.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true })
Deno.writeTextFileSync(
  path,
  [
    { type: 'system', content: 'You are Grok.' },
    { type: 'user', content: 'Why does the build fail?' },
    {
      type: 'assistant',
      content: 'Reading the config.',
      model_id: 'grok-4.6-build',
      tool_calls: [{
        id: 'call_7',
        name: 'edit_file',
        arguments: '{"path":"deno.json","text":"{}"}',
      }],
    },
    { type: 'tool_result', tool_call_id: 'call_7', content: 'written' },
    { type: 'assistant', content: 'I added a build task.' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n',
)

type Agent = Awaited<ReturnType<typeof local>>

// A harness that has read the Grok session, answered by a fake model.
let taken = async (go: (a: Agent, grok: string) => Promise<string>) => {
  let h = await harness()
  await look(h.g, [{ runner: 'grok', dir }], {
    tails: new Map(),
    done: new Set(),
  }, { slice: Infinity, budget: Infinity })
  let [grok] = await h.g.read(line`.session.id=${id} ?session`)
  let asked: Request[] = []
  let a = await local({
    h,
    providers: {
      openai: (req) => {
        asked.push(req)
        return Promise.resolve({
          id: mint(),
          model: req.model,
          items: [{ kind: 'assistant', text: 'Carrying on.' }],
        })
      },
    },
  })
  try {
    return { reply: await go(a, grok.entity.eid), asked }
  } finally {
    await a.close()
    await h.close()
  }
}

let said = (i: Item) =>
  i.kind == 'call'
    ? `call ${i.name} ${i.id}`
    : i.kind == 'result'
    ? `result ${i.id} ${i.output}`
    : `${i.kind} ${'text' in i ? i.text : ''}`

let sent = await taken(async (a, grok) => {
  let [reply] = await runs().session_send!({
    entity: { eid: mint() },
    call: {
      args: {
        session: grok,
        text: 'Now run it',
        provider: 'openai',
        model: 'gpt-6-astra',
      },
    },
  }, a.h.g)
  return textOf(reply)
})

test('a message naming a model takes over an imported conversation in place', () => {
  assertEquals(sent.reply, 'Carrying on.')
  assertEquals(sent.asked.length, 1)
  let items = sent.asked[0].items.map(said)
  assertStringIncludes(items[0], 'Why does the build fail?')
  assertEquals(items.slice(1, 5), [
    'assistant Reading the config.',
    'call edit_file call_7',
    'result call_7 From the edit_file tool:\nwritten',
    'assistant I added a build task.',
  ])
  assertStringIncludes(items[5], 'Until here this conversation ran on grok')
  assertStringIncludes(items[5], '- deno.json')
  assertStringIncludes(items[6], 'Now run it')
})

let chosen = await taken(async (a, grok) => {
  let [offer] = await a.h.g.read('.serves *')
  await a.selectModel(grok, offer.entity.eid)
  await a.send(grok, 'Go on')
  await a.idle(grok)
  return ''
})

test("choosing a model in the TUI for another harness's session takes it over", () => {
  assertEquals(chosen.asked.map((r) => r.model), ['gpt-6-astra'])
  assertStringIncludes(
    chosen.asked[0].items.map(said).join('\n'),
    'Until here this conversation ran on grok',
  )
})
