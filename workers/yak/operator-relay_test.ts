// A person's own words to their Operator, sent on to their machine: both ends
// in one process. The Operator's roster is the platform's, the machine is a
// host composed from the box's own packages behind its tunnel's filter, and
// the gateway between them is the stub that marks each request.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp, mint } from '@yaks/graph'
import { compose, every } from '@yaks/cli/host'
import { toolEid } from '@yaks/tools'
import { HEADER } from '@yaks/tunnel'
import { mcpConnect } from './connected-mcp.ts'
import { platform } from './directory-probe.ts'
import { directoryOf, stamp } from './directory.ts'
import type { Env } from './env.ts'
import { operatorContext, operatorRoster } from './operator.ts'
import { sourceReference } from './operator-source.ts'
import { operatorMemory } from './operator-testing.ts'

let ada = mint(), bob = mint()
// The machine: its own person, the persona its Operator's calls write as, and
// the platform's id for the person whose own words it takes.
let person = mint(), persona = mint()
let config = {
  db: ':memory:',
  person,
  plugins: [
    '@yaks/kernel',
    '@yaks/provenance',
    '@yaks/doc',
    '@yaks/process',
    '@yaks/persona',
    '@yaks/task',
    '@yaks/session',
    '@yaks/api',
    '@yaks/mcp',
    {
      use: '@yaks/tunnel',
      with: {
        callers: {
          operator: {
            routes: ['/mcp'],
            tools: ['comment_new', 'decision_answer', 'graph_show'],
            persona,
            owner: ada,
          },
        },
      },
    },
  ],
}
let box = await compose(config, every(config))
let [task, decision, second] = [mint(), mint(), mint()]
await box.graph.apply([
  { entity: { eid: person }, person: {}, doc: { title: 'Ada, at her box' } },
  { entity: { eid: persona }, persona: {}, doc: { title: 'the Operator' } },
  { entity: { eid: task }, task: {}, doc: { title: 'Ship the page' } },
  ...[decision, second].map((eid) => ({
    entity: { eid },
    task: {},
    doc: { title: 'Which day?' },
    decision: {
      question: 'Which day does it ship?',
      choices: [
        { label: 'Friday', description: 'This week.' },
        { label: 'Monday', description: 'After the weekend.' },
      ],
      recommended: 'Friday',
    },
  })),
], { trusted: true })

// The tunnel's gateway, as @yaks/tunnel's own marks a request.
let DISPATCH = {
  get: () => ({
    fetch: (r: Request) => {
      let headers = new Headers(r.headers)
      headers.set(HEADER, '1')
      return box.handler!(new Request(r, { headers }))
    },
  }),
} as unknown as Env['DISPATCH']
let { env } = platform('operator-relay', { DISPATCH })
let dir = directoryOf(env.STORE)
let eid = await dir.mint(ada, 'adas', 'Ada', {
  'x-yak-person': ada,
  'x-yak-role': 'owner',
})
await stamp(env, {
  entities: [{
    entity: { eid },
    tunnel: { id: mint(), service: mint(), adopted: true },
  }, {
    entity: { eid: '$seat' },
    member: { space: eid, person: bob, role: 'editor' },
  }],
})
let space = (await dir.at(eid))!

// Ada's conversation with her Operator: what she wrote, what it answered,
// what the platform told it, and what she wrote next.
let talk = mint()
let store = operatorMemory()
let line = (
  seq: number,
  by: string,
  body: string,
  more: Bundle | object = {},
) => ({
  entity: { eid: mint() },
  entry: { session: talk, seq },
  content: { body },
  ...more,
  $actor: { by, via: talk },
})
let FIRST = 'Ship the page by Friday, and drop the banner.'
let lines = [
  line(1, ada, FIRST + sourceReference('a'.repeat(64))),
  line(2, eid, 'On it.', { output: { source: mint() } }),
  line(3, ada, 'An app of yours broke.', { system: {} }),
  line(4, ada, 'Ship it Friday.', {
    entry: { session: talk, seq: 4, from: 'an outside agent' },
  }),
  line(5, ada, 'By text: Friday is fine.', {
    operator_channel: { channel: 'text', framing: 'By text: ' },
  }),
]
await store.g.apply([{ entity: { eid: talk }, session: {} }, ...lines], {
  trusted: true,
})
let sent = async (seq: number) =>
  String(
    ((await store.g.get([lines[seq - 1].entity.eid]))[0].created as Comp).at,
  )

let turn = async (who: string) => {
  let ctx = await operatorContext(env, { person: who }, space, () => dir)
  let tools = await operatorRoster(ctx, store, { space: eid, session: talk })
  let run = async (name: string, args: Record<string, unknown>) =>
    await tools.find((t) => t.name == name)!.run(args, {
      session: talk,
      call: { entity: { eid: mint() }, call: { to: toolEid(name), args } },
      entries: [],
    })
  return { ctx, run, named: tools.map((t) => t.name) }
}
await mcpConnect.run((await turn(ada)).ctx, {
  name: 'box',
  url: '/mcp',
  machine: 'adas',
})
// One turn of Ada's, offered what her machine lists: every test's.
let { run, named } = await turn(ada)

// The comments on an entity of the machine, oldest first: their words, who
// they are by, and what they came through.
let comments = async (target: string) =>
  (await box.graph.read(`.comment.target=${target}&?doc&?created`))
    .toSorted((a, b) =>
      String((a.created as Comp).at).localeCompare(
        String((b.created as Comp).at),
      )
    )
    .map((b) => {
      let { by, via } = b.created as Comp
      return [(b.doc as Comp).body, by, via]
    })
// What the machine takes for a person's own comment: the stamp a start on
// their comment matches (@yaks/session `session_start`).
let theirs = async (target: string) =>
  (await box.graph.read(
    `.comment .created.by.person !created.via.session .comment.target=${target} ?doc`,
  )).map((b) => (b.doc as Comp).body)

test('the newest message a person wrote becomes their own comment on their machine, word for word, by them and through no session', async () => {
  assertEquals(named.includes('box__message_relay'), true)
  await run('box__message_relay', { entity: task })
  assertEquals(await comments(task), [['Friday is fine.', person, box.me]])
  assertEquals(await theirs(task), ['Friday is fine.'])
})

test('an earlier message is named by its id or by the time its header says it was sent, and comes without the note the platform put after it', async () => {
  await run('box__message_relay', {
    entity: task,
    entry: lines[0].entity.eid,
  })
  await run('box__message_relay', { entity: task, entry: await sent(1) })
  assertEquals((await comments(task)).slice(1), [
    [FIRST, person, box.me],
    [FIRST, person, box.me],
  ])
})

test('a line the person did not write is refused, and nothing is written', async () => {
  let before = await comments(task)
  for (let seq of [2, 3, 4]) {
    await assertRejects(
      () =>
        run('box__message_relay', {
          entity: task,
          entry: lines[seq - 1].entity.eid,
        }),
      Error,
      'not a message the person wrote',
    )
  }
  await assertRejects(
    () => run('box__message_relay', { entity: task, entry: mint() }),
    Error,
    'not a message the person wrote',
  )
  assertEquals(await comments(task), before)
})

test("the Operator's own comment on the machine is the persona's, through its conversation's session, and never taken for the person's", async () => {
  let before = await theirs(task)
  await run('box__comment_new', {
    target: task,
    body: 'I think she means Friday.',
  })
  let [body, by, via] = (await comments(task)).at(-1)!
  assertEquals([body, by], ['I think she means Friday.', persona])
  assertEquals(
    ((await box.graph.get([String(via)]))[0].session as Comp).source,
    talk,
  )
  assertEquals(await theirs(task), before)
})

test('a message that picks a listed choice answers the decision as the person, and a choice it does not list is refused', async () => {
  await assertRejects(
    () => run('box__message_relay', { entity: decision, choice: 'Tuesday' }),
    Error,
    'lists no choice "Tuesday"',
  )
  await assertRejects(
    () => run('box__message_relay', { entity: task, choice: 'Friday' }),
    Error,
    'is no decision',
  )
  assertEquals(await comments(decision), [])
  await run('box__message_relay', { entity: decision, choice: 'friday' })
  let [answered] = await box.graph.get([decision], ['decided'])
  let { choice, by, via } = answered.decided as Comp
  assertEquals([choice, by, via], ['Friday', person, box.me])
  assertEquals(await comments(decision), [['Friday is fine.', person, box.me]])
})

test("the Operator's own answer to a decision is the persona's, whoever it says the answer is by", async () => {
  await run('box__decision_answer', {
    decision: second,
    choice: 'She would want Monday.',
    by: person,
  })
  let [answered] = await box.graph.get([second], ['decided'])
  let { choice, by, via } = answered.decided as Comp
  assertEquals([choice, by], ['She would want Monday.', persona])
  assertEquals(
    ((await box.graph.get([String(via)]))[0].session as Comp).source,
    talk,
  )
})

test('a member who does not own the space is offered no way to their machine', async () => {
  assertEquals(
    (await turn(bob)).named.filter((n) => n.startsWith('box__')),
    [],
  )
})
