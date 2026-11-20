// A text's sender number is all that says who sent it, and anyone can show a
// member's number, but only the member's phone reads what is texted back
// (T-1864). So a member's SMS turn holds their tools, and a privileged act
// it asks for waits for a tap on a link texted to that number. RCS stays as
// it was: reads and their own alerts.
import { equal, test } from '@yaks/testing'
import type { Request as Ask } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { owned } from './directory-fixture.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { handleChannels, receive } from './operator-channels.ts'
import { endpoints } from './endpoints.ts'
import { opened } from './lib/token.ts'
import type { Ctx } from './tools.ts'

let store = operatorMemory()
let { env } = platform('operator-texted', { SESSION_SECRET: 'secret' })
let person = crypto.randomUUID()
let ctx: Ctx = { env, dir: directoryOf(env.STORE), person }
let space = await owned(ctx, 'texted-home')
let NUMBER = '+12695550143'
// Telnyx at its HTTP boundary, every text posted to it kept.
let texted: { to: string; text: string }[] = []
let telnyx = endpoints(globalThis).open(async (req) => {
  let path = new URL(req.url).pathname
  if (path == '/messaging_profiles') {
    return Response.json({ data: [{ id: 'profile-1' }] })
  }
  if (path.endsWith('/phone_numbers')) {
    return Response.json({ data: [{ phone_number: '+18885550100' }] })
  }
  let { to, text } = await req.json()
  texted.push({ to, text })
  return Response.json({ data: { id: `msg-${texted.length}` } })
})
Object.assign(env, {
  PHONE_SENDER: { via: 'telnyx' },
  TELNYX_API: telnyx.url,
  TELNYX_API_KEY: 'a-key',
  MAIL: { send: () => Promise.resolve({ messageId: 'sent' }) },
})

// The tools each turn held, deferred ones by their line in tool_load's list,
// and what the call it made answered, by the turn's channel. Words naming a
// tool call it with the arguments after its name; the rest load mail_send.
let held = new Map<string, string[]>()
let answered = new Map<string, string>()
let operator = operating(
  store,
  env,
  operatorModel((req: Ask) => {
    let said = req.items.findLast((i) => i.kind == 'user')
    let words = said?.kind == 'user' ? said.text : ''
    let channel = words.match(/by (\w+)$/m)?.[1] ?? ''
    let [, name, args] = words.match(/Call (\w+) (\{.*\})/) ??
      [, 'tool_load', '{"names":["mail_send"]}']
    let last = req.items.at(-1)
    if (last?.kind == 'result') answered.set(channel, last.output)
    else {
      held.set(
        channel,
        req.tools.flatMap((t) => [
          t.name,
          ...[...t.description.matchAll(/^- (\w+):/gm)].map((m) => m[1]),
        ]),
      )
    }
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: last?.kind == 'result'
        ? [{ kind: 'assistant', text: 'Done.' }]
        : [{ kind: 'call', id: crypto.randomUUID(), name, args }],
      cost: 0.001,
    })
  }),
)
let quiet = () => Promise.resolve({})
handleChannels(operator, env, {
  chat: quiet,
  text: quiet,
  rcs: quiet,
  texted: quiet,
  voice: quiet,
})
let asked = async (channel: string, words: string, attested?: boolean) => {
  await receive(store, {
    space,
    person,
    channel,
    address: NUMBER,
    reply_to: '+18445550100',
    ...attested ? { attested } : {},
  }, words)
  await drain(store)
}
for (let channel of ['chat', 'text', 'rcs', 'texted', 'voice']) {
  await asked(channel, `Mail the directory to someone, by ${channel}`)
}
await asked('voice', 'Mail the directory to someone, by vouched', true)

let DOORS = ['mail_send', 'phone_send', 'graph_apply', 'code_mode', 'fork']

for (let channel of ['chat', 'text', 'texted']) {
  test(`a member asking by ${channel} holds every tool`, () => {
    for (let door of DOORS) equal(held.get(channel)!.includes(door), true, door)
    equal(answered.get(channel)!.includes('can be faked'), false)
  })
}

test('an SMS turn, or a call the carriers did not vouch for, asks for a tap by approval_request', () => {
  let asks = ['chat', 'text', 'texted', 'rcs', 'voice', 'vouched'].map((c) =>
    held.get(c)!.includes('approval_request')
  )
  equal(asks, [false, true, true, false, true, false])
})

test("a member's rcs holds reads and their own alerts, never a door that sends or writes", () => {
  let tools = held.get('rcs')!
  for (let door of DOORS) equal(tools.includes(door), false, door)
  for (let kept of ['graph_query', 'notification_send', 'text_send']) {
    equal(tools.includes(kept), true, kept)
  }
  equal(answered.get('rcs')!.includes('sender number can be faked'), true)
})

test('a member added by text waits for the tap on the link texted to that number, which adds them once', async () => {
  let invited = async () => (await ctx.dir.read('.invite.role=owner')).length
  await asked(
    'text',
    'Call member_add {"email":"eve@bot.yak.sh","role":"owner"}\nby text',
  )
  equal(answered.get('text')!.includes('Nothing has happened yet'), true)
  equal(await invited(), 0)
  let link = texted.at(-1)!
  equal(link.to, NUMBER)
  let t = link.text.match(/approve\?t=(\S+)/)![1]
  let [, approval, digest] = (await opened<[string, string, string]>(
    'approval',
    t,
    'secret',
  ))!
  let tap = (press: boolean) => operator.approve(approval, digest, press)
  equal((await tap(false)).state, 'waiting')
  equal(await invited(), 0)
  equal((await tap(true)).state, 'done')
  equal(await invited(), 1)
  equal((await tap(true)).state, 'used')
  equal(await invited(), 1)
})
