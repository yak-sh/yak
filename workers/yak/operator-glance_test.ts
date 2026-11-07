// What a call's voice knows of the Operator (operator-glance.ts), read from
// an Operator's store holding a conversation, its work and Updates.
import { equal, test } from '@yaks/testing'
import { toolEid } from '@yaks/tools/result'
import { operatorMemory } from './operator-testing.ts'
import { rootOf } from './operator-root.ts'
import { notification } from './operator-updates.ts'
import { type Glance, glanceOf, looks } from './operator-glance.ts'

let space = crypto.randomUUID(), person = crypto.randomUUID()
let root = rootOf(space, person)
let [building, built] = [crypto.randomUUID(), crypto.randomUUID()]
let writing = toolEid('app_write')
let store = operatorMemory()
// Each row a minute after the one before, from 20:00.
let minute = 0
let at = () => ({
  created: { at: new Date(Date.UTC(2026, 10, 6, 20, minute++)).toISOString() },
})
let line = (session: string, b: object) => ({
  entity: { eid: crypto.randomUUID() },
  entry: { session },
  ...at(),
  ...b,
})
await store.g.apply([
  {
    entity: { eid: root },
    session: { id: root },
    operator_session: { space, person },
  },
  line(root, {
    content: { body: 'Build me a recipe box' },
    operator_channel: { channel: 'text' },
  }),
  line(root, { output: {}, content: { body: 'Building it now.' } }),
  ...[built, building].map((eid) => ({
    entity: { eid },
    session: { id: eid },
    spawned: { parent: root },
    ...at(),
  })),
  line(built, { content: { body: 'Check the hall booking' } }),
  line(built, { output: {}, content: { body: 'Booked for Friday.' } }),
  line(building, { content: { body: 'Build a recipe box app' } }),
  line(building, { output: {}, content: { body: 'Writing its files.' } }),
  {
    entity: { eid: writing },
    tool: { name: 'app_write', title: 'Write files' },
  },
  line(building, { call: { to: writing, args: {} } }),
  {
    ...notification({
      to: person,
      words: 'Your recipe box has a new version.',
    }),
    ...at(),
  },
], { trusted: true })
let g: Glance = {
  store,
  space,
  person,
  dir: {
    reachable: () =>
      Promise.resolve([{
        space: { slug: 'home' },
        app: { slug: 'recipes', title: 'Recipe Box' },
        role: 'owner',
      }] as unknown as Awaited<ReturnType<Glance['dir']['reachable']>>),
  },
  now: () => Date.parse('2026-11-06T21:04:00Z'),
}

let WORK = [
  '- Build a recipe box app: Working on it, 6 Nov 2026, 20:08 UTC',
  '  doing now: Writing files…',
  '  latest it wrote: Writing its files.',
  '- Check the hall booking: Done, 6 Nov 2026, 20:05 UTC',
].join('\n')
let SAID = [
  '6 Nov 2026, 20:00 UTC, they, by text: Build me a recipe box',
  '6 Nov 2026, 20:01 UTC, you: Building it now.',
].join('\n')

test("a call's voice is told the time, the newest of the conversation, and the work under way with its step and how far it got", async () => {
  let glance = glanceOf(g)
  equal(
    await glance.recent(),
    'It is 6 Nov 2026, 21:04 UTC.\n' +
      `The newest of your conversation with them, oldest first:\n${SAID}`,
  )
  equal(
    await glance.work(),
    `The work you have going for them, newest first:\n${WORK}`,
  )
  let stranger = glanceOf({ ...g, person: crypto.randomUUID() })
  equal(
    [await stranger.recent(), await stranger.work()].map((t) =>
      t.split('\n').at(-1)
    ),
    [
      'They have not talked with you before.',
      'No work has been started for them.',
    ],
  )
})

test("a call's voice looks up its work, their Updates, their apps and more of the conversation", async () => {
  let read = Object.fromEntries(
    await Promise.all(looks(g).map(async (l) => [l.name, await l.read()])),
  )
  equal(read, {
    work: WORK,
    updates:
      '- Unread, 6 Nov 2026, 20:09 UTC: Your recipe box has a new version.',
    apps: '- home/recipes: Recipe Box',
    conversation: SAID,
  })
})
