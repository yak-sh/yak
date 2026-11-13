// A space keeps skills in its Operator's store: its Operator is offered them
// by title and loads one with skill_read, and a person's connected Claude is
// offered those of each space they write in.
import { equal, test } from '@yaks/testing'
import { assert } from '@std/assert'
import type { Item, Request as Ask } from '@yaks/model'
import { attachSkills } from '@yaks/mcp/skills'
import { platform } from './directory-rows-probe.ts'
import { owned } from './directory-fixture.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { kept, SKILLS, spaceSkills } from './operator-skills.ts'
import { handleChannels, receive } from './operator-channels.ts'
import type { Ctx } from './tools.ts'

let store = operatorMemory()
await store.g.apply([{
  entity: { eid: crypto.randomUUID() },
  skill: {},
  doc: { title: 'pitch-copy', body: 'Write a pitch for a product page' },
  content: { body: 'Lead with what the reader gets.\n' },
}, {
  // Not an Agent Skills name: kept, offered here, and left out of the
  // connector's listing rather than refusing the rest.
  entity: { eid: crypto.randomUUID() },
  skill: {},
  doc: { title: 'Pitch_Copy', body: 'The same, misnamed' },
  content: { body: 'Misnamed.\n' },
}])

let requests: Request[] = []
let { env } = platform('operator-skills', {
  BUILDER: {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (request: Request) => {
        requests.push(request)
        return Response.json({ files: await kept(store.g) })
      },
    }),
  },
})
let person = crypto.randomUUID()
let ctx: Ctx = { env, dir: directoryOf(env.STORE), person }
let space = await owned(ctx, 'skills-home')

let asked: Ask[] = []
let call = (name: string, args: object): Item[] => [
  { kind: 'call', id: crypto.randomUUID(), name, args: JSON.stringify(args) },
]
let operator = operating(
  store,
  env,
  operatorModel((req) => {
    asked.push(req)
    let last = req.items.at(-1)!
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: last.kind == 'result'
        ? [{ kind: 'assistant', text: 'Loaded it.' }]
        : call('skill_read', { skill: 'pitch-copy' }),
      cost: 0.001,
    })
  }),
)
handleChannels(operator, env, { text: () => Promise.resolve({}) })
await receive(store, {
  space,
  person,
  channel: 'text',
  address: '+12695550143',
}, 'Write the pitch.')
await drain(store)
let said = (req: Ask) => JSON.stringify(req.items)

test('the Operator is offered the skills its space keeps, by description', () => {
  let [first] = asked
  assert(first.tools.some((t) => t.name == 'skill_read'))
  assert(said(first).includes('Write a pitch for a product page'))
  assert(!said(first).includes('Lead with what the reader gets'))
})

test("the Operator's skill_read loads a skill's instructions", () => {
  assert(said(asked.at(-1)!).includes('Lead with what the reader gets'))
})

// What @yaks/mcp registers for a snapshot, kept to be asked.
let served = async () => {
  let handlers = new Map<string, (params: object) => unknown>()
  let prompts: string[] = []
  let server = {
    capable: () => {},
    handle: (method: string, h: (params: object) => unknown) =>
      handlers.set(method, h),
    resource: () => {},
    template: () => {},
    prompt: (name: string) => prompts.push(name),
  } as unknown as Parameters<typeof attachSkills>[0]
  await attachSkills(server, () => spaceSkills(ctx), { method: 'skills/list' })
  let { skills } = await handlers.get('skills/list')!({}) as {
    skills: { uri: string }[]
  }
  return { uris: skills.map((s) => s.uri), prompts }
}

test("a writer's connected Claude is offered each space's skills, by space", async () => {
  let { uris, prompts } = await served()
  equal(uris, ['skill://skills/spaces/skills-home/pitch-copy/SKILL.md'])
  equal(prompts, ['skill:skills-home/pitch-copy'])
  let request = requests.at(-1)!
  equal(new URL(request.url).pathname, SKILLS)
  equal(request.headers.get('x-yak-person'), person)
})

test('someone who writes in no space is asked of no Operator', async () => {
  let before = requests.length
  let none = await spaceSkills({ ...ctx, person: crypto.randomUUID() })
  equal(none.files.size, 0)
  equal(requests.length, before)
})
