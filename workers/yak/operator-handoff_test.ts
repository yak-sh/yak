import { assertEquals, assertMatch } from '@std/assert'
import { test } from '@yaks/testing'
import type { Item, Request } from '@yaks/model'
import {
  HANDOFF,
  type Handoff,
  handoffTask,
} from '@yaks/platform/operator-handoff'
import { line } from '@yaks/query'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { handleChannels } from './operator-channels.ts'
import { acceptHandoff, acceptHandoffReport } from './operator-handoff.ts'
import { rootAt } from './operator-root.ts'
import { drain } from './operator-store.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { operating } from './operator.ts'

let { env } = platform('operator-handoff')
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID()
let mint = (owner: string, slug: string) =>
  dir.mint(owner, slug, slug, {
    'x-yak-person': owner,
    'x-yak-role': 'owner',
  })
let [home, away, other] = await Promise.all([
  mint(person, 'handoff-home'),
  mint(person, 'handoff-away'),
  mint(crypto.randomUUID(), 'handoff-other'),
])
let source = operatorMemory()
let target = operatorMemory()
let sent: Handoff[] = []
env.BUILDER = {
  idFromName: (name) => name,
  get: (space) => ({
    fetch: async (request) => {
      assertEquals(new URL(request.url).pathname, '/operator/handoff')
      assertEquals(request.headers.get('x-yak-kernel'), '1')
      let { kind, ...message } = await request.json() as Handoff & {
        kind: string
      }
      if (kind == 'request') {
        sent.push(message)
        assertEquals(space, away)
        await acceptHandoff(env, target, away, message)
      } else {
        assertEquals(space, home)
        await acceptHandoffReport(env, source, home, message)
      }
      return Response.json({ ok: true })
    },
  }),
}
let call = (name: string, args: object): Item[] => [
  { kind: 'call', id: crypto.randomUUID(), name, args: JSON.stringify(args) },
]
let say = (text: string): Item[] => [{ kind: 'assistant', text }]
let model = (script: (r: Request) => Item[]) =>
  operatorModel((req) =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: script(req),
      cost: 0.001,
    })
  )
let work = 'Rename this space to Handoff result.'
let report = 'The space is now Handoff result.'
let followup = 'Please confirm the new title.'
let confirmed = 'Confirmed: Handoff result.'
let sourceCalls: Request[] = []
let operator = operating(
  source,
  env,
  model((ask) => {
    sourceCalls.push(ask)
    switch (sourceCalls.length) {
      case 1:
        return call('session_send', { space: other, say: work })
      case 3:
        return call('session_send', { space: away, say: work })
      case 5:
        return call('operator_handoffs', {})
      case 7:
        return call('session_send', {
          session: handoffTask(sent[0].id),
          say: followup,
        })
      default:
        return say('Got it.')
    }
  }),
)
let targetCalls = 0
let receiver = operating(
  target,
  env,
  model(() => {
    if (targetCalls++ == 0) {
      return call('space_set', { title: 'Handoff result' })
    }
    return say(targetCalls == 2 ? report : confirmed)
  }),
)
handleChannels(operator, env)
handleChannels(receiver, env)
let from = (await dir.at(home))!
let ask = (say: string) => operator.ask({ person }, from, { say })

await ask('Hand off to another person.')
await drain(source)
let callsBefore = sent.length
await ask('Hand off to my other space.')
await drain(source)
let titleBefore = (await dir.at(away))!.title
let [waiting] = await source.g.get([sent[0].id])
await drain(target)
await drain(source)
let listed = sourceCalls.at(-1)!
await ask('Follow up on the handoff.')
await drain(source)
await drain(target)
await drain(source)
let requests = await target.g.read(line`.operator_request.channel=${HANDOFF}`)
let sourceRoot = await rootAt(source, home, person)
let targetRoot = await rootAt(target, away, person)
let messages = async (store: typeof source, session: string) =>
  JSON.stringify(
    await store.g.read(
      line`.entry.session=${session}&.channel.name=${HANDOFF}&.content`,
    ),
  )
let [outgoing, incoming] = await Promise.all([
  messages(source, sourceRoot),
  messages(target, targetRoot),
])
let told = JSON.stringify(
  await source.g.read(line`.notification.to=${person}&.doc`),
)

test('a handoff uses the person’s own seat and reports back after the receiving Operator works', async () => {
  assertEquals(callsBefore, 0)
  assertEquals(sent.length, 2)
  assertEquals(sent[0].person, person)
  assertEquals(waiting.completed, undefined)
  assertMatch(JSON.stringify(listed.items), /replied/)
  assertEquals(
    new Set(
      requests.map((row) =>
        (row.operator_request as { session: string }).session
      ),
    ).size,
    1,
  )
  assertMatch(
    JSON.stringify(sourceCalls.at(-1)?.items),
    /Confirmed: Handoff result/,
  )
  assertEquals(titleBefore, 'handoff-away')
  assertEquals((await dir.at(away))!.title, 'Handoff result')
  for (let transcript of [outgoing, incoming]) {
    assertMatch(transcript, /Rename this space to Handoff result/)
    assertMatch(transcript, /The space is now Handoff result/)
    assertMatch(transcript, /Confirmed: Handoff result/)
  }
})

test('a reply between Operators is the asking Operator’s, never a notice in its person’s Updates', () => {
  assertMatch(outgoing, /The space is now Handoff result/)
  assertEquals(told.includes('The space is now Handoff result'), false)
})
