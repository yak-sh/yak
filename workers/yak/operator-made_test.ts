// A newcomer watching their Operator build their app (D-146737): the chat
// opens the app it is making beside the conversation, with what it keeps,
// what it can do and its screens, each a tab, the newest stage open; its
// screens are the draft until it is released, then the app itself. Once
// they give their address, an app opens by itself only when their Operator
// starts it in that chat.

import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import type { Item } from '@yaks/model'
import { directoryOf } from './directory.ts'
import { platform } from './testing.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive, rootOf } from './operator-channels.ts'
import { chatPage } from './operator-page.ts'
import { TOOLS } from './tools.ts'

let p = platform('operator-made')
let person = crypto.randomUUID(), eid = crypto.randomUUID()
let dir = directoryOf(p.env.STORE)
await dir.apply({
  entities: [
    {
      entity: { eid: person },
      person: {},
      newcomer: { at: new Date().toISOString() },
    },
    { entity: { eid }, space: { slug: 'plum', store: 'plum' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
let space = (await dir.at(eid))!
let who = { person, role: 'owner' as const, space: eid }

let call = (name: string, args: object): Item => ({
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
})
let file = (path: string, content: unknown) => ({
  path,
  content: typeof content == 'string' ? content : JSON.stringify(content),
})
// What the Operator does for each message: a step a turn, then its reply.
let turns: Item[][] = []
let service = operatorService(
  p.env,
  who,
  operatorModel((req) =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: turns.shift() ?? [{ kind: 'assistant', text: 'Done.' }],
      cost: 0.001,
    })
  ),
)
p.env.BUILDER = service.binding

// The newcomer's chat once the Operator has taken `steps`.
let after = async (...steps: Item[]) => {
  turns.push(...steps.map((s) => [s]))
  await receive(service.store, { space: eid, person, channel: 'chat' }, 'Go on')
  await service.drain()
  let apps = (await dir.apps(space)).map((a) => ({
    eid: a.eid,
    slug: a.slug,
    title: a.title,
  }))
  let { document } = parseHTML(
    await (await chatPage(p.env, space, who, rootOf(eid, person), { apps }))
      .text(),
  )
  let part = (id: string) => document.querySelector(`[data-part=${id}]`)
  let names = (id: string) =>
    [...part(id)?.querySelectorAll('.Rows_Name') ?? []].map((e) =>
      e.textContent
    )
  return {
    app: document.querySelector('.Talk_App')?.getAttribute('data-app'),
    open: document.querySelector('[name=made][checked]')?.getAttribute(
      'value',
    ),
    keeps: names('keeps'),
    does: names('does'),
    screens: part('screens')?.querySelector('iframe')?.getAttribute('src') ??
      part('screens')?.textContent,
    asks: document.querySelector('#ask [name=app]')?.getAttribute('value'),
  }
}

let words = {
  $defs: {
    recipe: { properties: { serves: { type: 'number' } } },
    plan_week: {
      tool: true,
      description: 'Picks seven dinners.',
      query: '.recipe',
    },
  },
}
let started = await after(
  call('app_new', { slug: 'recipes', title: 'Recipe box' }),
  call('app_files', { app: 'recipes', files: [file('vocab.json', words)] }),
)
let drawn = await after(
  call('app_files', {
    app: 'recipes',
    files: [file('index.html', '<h1>Recipes</h1>')],
  }),
)
let live = await after(call('app_deploy', { app: 'recipes' }))

test('beside a newcomer’s chat, what their app keeps and can do as their Operator decides them, before any screen', () => {
  equal(started, {
    app: 'recipes',
    open: 'keeps',
    keeps: ['Recipe'],
    does: ['Plan week', 'Add and find what it keeps'],
    screens: `Recipe box’s screens show here as ${space.operator} draws them.`,
    asks: 'recipes',
  })
})

test('its screens open once the first is drawn: the draft, following each write', () => {
  equal(drawn.open, 'screens')
  equal(
    String(drawn.screens).startsWith('https://plum.yaks.app/recipes/_preview/'),
    true,
  )
})

test('once released, its screens are the app itself, live', () => {
  equal(live.open, 'screens')
  equal(live.screens, 'https://plum.yaks.app/recipes/')
})

// They keep it: with an address, they are signed in like anyone.
await dir.apply({
  entities: [{
    entity: { eid: person },
    email: { address: 'kept@example.com' },
  }],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
// An app this chat did not start.
await TOOLS.find((t) => t.name == 'app_new')!.run(
  { env: p.env, dir, person },
  { slug: 'chores', title: 'Chores' },
)

test('a signed-in person’s chat opens beside it an app their Operator started there, and never one that was there before', async () => {
  equal(
    (await after(call('app_files', { app: 'recipes', op: 'list' }))).app,
    'recipes',
  )
  equal(
    (await after(call('app_files', { app: 'chores', op: 'list' }))).app,
    undefined,
  )
  let begun = await after(call('app_new', { slug: 'shelf', title: 'Shelf' }))
  equal([begun.app, begun.open, begun.keeps], ['shelf', 'keeps', []])
})
