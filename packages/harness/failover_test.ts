// A session whose provider's plan runs out goes on, with its conversation, on
// the next provider the default routes, and says so in its transcript.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { ModelError, type Request } from '@yaks/model'
import { line } from '@yaks/query'
import { textOf } from '@yaks/session'
import { HARNESS } from './default.ts'
import { harness } from './testing.ts'
import { local } from './local.ts'
import { runs } from './runs.ts'

let mint = () => crypto.randomUUID()
let asked: string[] = []
let answer = (who: string) => (req: Request) => {
  asked.push(`${who} ${req.items.length}`)
  return who == 'openai'
    ? Promise.reject(
      new ModelError('usage_limit_reached', 'You have hit your usage limit.'),
    )
    : Promise.resolve({
      id: mint(),
      model: req.model,
      items: [{ kind: 'assistant' as const, text: 'Done on grok.' }],
    })
}

let { reply, lines, using } = await (async () => {
  let h = await harness()
  let grok = identityEid('provider', ['grok'])
  let model = identityEid('model', ['grok-5'])
  await h.g.apply([
    { entity: { eid: grok }, provider: { name: 'grok' } },
    { entity: { eid: model }, model: { name: 'grok-5' } },
    {
      entity: { eid: '$serves' },
      edge: { from: grok, to: model },
      serves: { name: 'grok-5' },
    },
  ], { trusted: true })
  let offers = await h.g.read('.serves *')
  let first = (name: string) =>
    offers.find((b) => (b.serves as Comp).name == name)!.entity.eid
  await h.g.apply(
    ['gpt-6-astra', 'grok-5'].map((name, ord) => ({
      entity: { eid: mint() },
      edge: { from: HARNESS, to: first(name), ord },
      routes: {},
    })),
    { trusted: true },
  )
  let a = await local({
    h,
    providers: { openai: answer('openai'), grok: answer('grok') },
  })
  try {
    let [session] = await runs().session_new!({
      entity: { eid: mint() },
      call: {
        args: { prompt: 'Fix it', provider: 'openai', model: 'gpt-6-astra' },
      },
    }, h.g)
    let s = String((session.entry as Comp).session)
    await a.idle(s)
    let rows = await h.g.read(line`.entry.session=${s} .order=entry.seq *`)
    return {
      reply: textOf(session),
      lines: rows.filter((b) => b.content).map(textOf),
      using: rows.findLast((b: Bundle) => b.using)?.using as Comp,
    }
  } finally {
    await a.close()
    await h.close()
  }
})()

test('a session whose plan is spent goes on with the next provider routed', () => {
  // Grok is asked with the conversation and the line saying it moved.
  assertEquals(asked, ['openai 1', 'grok 2'])
  assertEquals(reply, 'Done on grok.')
  assertEquals(using.provider, identityEid('provider', ['grok']))
  assertEquals(using.model, identityEid('model', ['grok-5']))
  let moved = lines.find((l) => l.startsWith('Moved on'))!
  assertStringIncludes(moved, "gpt-6-astra's plan is spent; grok-5 is next")
})
