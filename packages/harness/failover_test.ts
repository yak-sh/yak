// A session carries its conversation through spent CLI plans and keeps
// running its own tools on the next routed provider.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import type { Bundle, Comp } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'
import { ModelError } from '@yaks/model'
import { cliModel } from '@yaks/model-cli'
import { line } from '@yaks/query'
import { textOf } from '@yaks/session'
import { seed } from './agent.ts'
import { HARNESS } from './default.ts'
import { harness } from './testing.ts'
import { local } from './local.ts'
import { runs } from './runs.ts'

let mint = () => crypto.randomUUID()
let asked: string[] = []
let env = () => undefined

let { reply, lines, using } = await (async () => {
  let h = await harness()
  let routes = [
    ['openai', 'gpt-6-astra'],
    ['grok', 'grok-4.6'],
    ['gemini', 'gemini-3.8-flash-medium'],
  ]
  await h.g.apply(
    routes.flatMap(([provider, model], ord) => {
      let rows = seed({ provider, model })
      return [...rows, {
        entity: { eid: mint() },
        edge: {
          from: HARNESS,
          to: rows.find((b) => b.serves)!.entity.eid,
          ord,
        },
        routes: {},
      }]
    }),
    { trusted: true },
  )
  let a = await local({
    h,
    providers: {
      openai: () => {
        asked.push('openai')
        return Promise.reject(
          new ModelError(
            'usage_limit_reached',
            'You have hit your usage limit.',
          ),
        )
      },
      grok: cliModel('grok', {}, env, () => {
        asked.push('grok')
        return Promise.resolve({
          code: 1,
          stdout: '',
          stderr: 'You’ve hit the rate limit for your plan.',
        })
      }),
      gemini: cliModel('gemini', {}, env, (job) => {
        asked.push('gemini')
        let { items } = JSON.parse(JSON.parse(job.stdin!).message.content)
        assertEquals(
          items.some((i: { text?: string }) =>
            i.text?.endsWith('Read the task.')
          ),
          true,
          JSON.stringify(items),
        )
        let result = items.find((i: { kind: string }) => i.kind == 'result')
        let turn = result
          ? { text: result.output, calls: [] }
          : { text: '', calls: [{ name: 'task_read', args: '{}' }] }
        return Promise.resolve({
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            event: 'result',
            result: {
              conversation_id: mint(),
              status: 'SUCCESS',
              structured_output: turn,
            },
          }),
        })
      }),
    },
    tools: [{
      name: 'task_read',
      description: 'Read the task.',
      parameters: { type: 'object' },
      run: () => 'Task found.',
    }],
  })
  try {
    let [session] = await runs().session_new!({
      entity: { eid: mint() },
      call: {
        args: {
          prompt: 'Read the task.',
          provider: 'openai',
          model: 'gpt-6-astra',
        },
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

test('spent plans move the conversation once through each routed provider', () => {
  assertEquals(
    asked,
    ['openai', 'grok', 'gemini', 'gemini'],
    JSON.stringify({ lines, reply }),
  )
  assertStringIncludes(reply, 'Task found.')
  assertEquals(using.provider, identityEid('provider', ['gemini']))
  assertEquals(using.model, identityEid('model', ['gemini-3.8-flash-medium']))
  assertEquals(lines.filter((l) => l.startsWith('Moved on')), [
    "Moved on: gpt-6-astra's plan is spent; grok-4.6 is next.",
    "Moved on: grok-4.6's plan is spent; gemini-3.8-flash-medium is next.",
  ])
})
