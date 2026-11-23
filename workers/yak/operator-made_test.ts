// A newcomer watching their Operator build their app (D-146737): the app
// their address names opens beside the conversation, with what it keeps,
// what it can do and its screens, each a tab, the newest stage open; its
// screens are the draft until it is released, then the app itself. An
// address naming no app opens none, whatever the chat has made.

import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import type { Item } from '@yaks/model'
import { appStore, directoryOf } from './directory.ts'
import { toolEid } from '@yaks/tools'
import { platform } from './testing.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { chatPage } from './operator-page.ts'

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

// The newcomer's chat, at an address naming `chosen`, once the Operator has
// taken `steps`.
let at = (chosen: string | null) => async (...steps: Item[]) => {
  turns.push(...steps.map((s) => [s]))
  await receive(service.store, { space: eid, person, channel: 'chat' }, 'Go on')
  await service.drain()
  let apps = (await dir.apps(space)).map((a) => ({
    eid: a.eid,
    slug: a.slug,
    title: a.title,
  }))
  let { document } = parseHTML(
    await (await chatPage(p.env, space, who, 'new', { apps }, chosen))
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
    // The steps of how it runs, each with what it waits for, stage by stage.
    runs: [...part('runs')?.querySelectorAll('.Notice, .Rows_Item') ?? []]
      .map((e) => e.textContent),
    screens: part('screens')?.querySelector('iframe')?.getAttribute('src') ??
      part('screens')?.textContent,
    // Its frames by which they are, the radios that switch them and which
    // is on, and what each says it is.
    frames: Object.fromEntries(
      [...part('screens')?.querySelectorAll('iframe') ?? []].map((f) => [
        f.getAttribute('data-screen'),
        f.getAttribute('src'),
      ]),
    ),
    switch: [...part('screens')?.querySelectorAll('.Check') ?? []].map((
      c,
    ) => [c.textContent, c.querySelector('input')?.hasAttribute('checked')]),
    notes: [...part('screens')?.querySelectorAll('p[data-screen]') ?? []]
      .map((p) => p.getAttribute('data-screen')),
    // Where each page What it can do lists is shown.
    pages: [...part('does')?.querySelectorAll('[data-shows]') ?? []].map((
      a,
    ) => [a.getAttribute('target'), a.getAttribute('href')]),
    asks: document.querySelector('#ask [name=app]')?.getAttribute('value'),
  }
}

let after = at('recipes')

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
let changing = await after(
  call('app_files', {
    app: 'recipes',
    files: [file('index.html', '<h1>Every recipe</h1>')],
  }),
)
let again = await after(call('app_deploy', { app: 'recipes' }))

test('beside a newcomer’s chat, what their app keeps and can do as their Operator decides them, before any screen', () => {
  equal(started, {
    app: 'recipes',
    open: 'keeps',
    keeps: ['Recipe'],
    does: ['Plan week', 'Add and find what it keeps'],
    runs: [],
    screens: `Recipe box’s screens show here as ${space.operator} draws them.`,
    frames: {},
    switch: [],
    notes: [],
    pages: [],
    asks: 'recipes',
  })
})

test('its screens open once the first is drawn: the draft, following each write', () => {
  equal(drawn.open, 'screens')
  ok(
    /^https:\/\/plum\.yaks\.app\/recipes\/~[a-z0-9]{12}\/$/.test(
      String(drawn.screens),
    ),
    String(drawn.screens),
  )
  // What it can do names the page, which its draft shows.
  equal(drawn.does.at(-1), 'Recipes')
  equal(drawn.pages, [['screen-draft', drawn.screens ?? null]])
})

test('once released, its screens are the app itself, live', () => {
  equal(live.open, 'screens')
  equal(live.screens, 'https://plum.yaks.app/recipes/')
  equal([live.switch, live.notes], [[], []])
  equal(live.pages, [['screen-live', 'https://plum.yaks.app/recipes/']])
})

test('while a live app has changes not yet released, its screens show the draft, with a switch to live and a line saying each', () => {
  equal(changing.open, 'screens')
  equal(changing.switch, [['Draft', true], ['Live', false]])
  equal(changing.notes, ['draft', 'live'])
  equal(Object.keys(changing.frames), ['draft', 'live'])
  ok(
    /^https:\/\/plum\.yaks\.app\/recipes\/~[a-z0-9]{12}\/$/.test(
      String(changing.frames.draft),
    ),
    String(changing.frames.draft),
  )
  equal(changing.frames.live, 'https://plum.yaks.app/recipes/')
  // Released, they are the app itself again.
  equal(again.frames, { live: 'https://plum.yaks.app/recipes/' })
})

// They keep it: with an address, they are signed in like anyone.
await dir.apply({
  entities: [{
    entity: { eid: person },
    email: { address: 'kept@example.com' },
  }],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
test('an address naming no app opens none beside the chat, whatever its Operator made there', async () => {
  equal(
    (await at(null)(call('app_files', { app: 'recipes', op: 'list' }))).app,
    undefined,
  )
  equal((await at(null)(call('app_new', { slug: 'shelf' }))).app, undefined)
})

// A workflow in its store: two steps reading a text that arrived, and a third
// reading both, each saying what it reads with a `requires` edge.
let recipes = (await dir.apps(space)).find((a) => a.slug == 'recipes')!
let [heard, priced, answered] = ['Heard', 'Priced', 'Answered'].map((
  title,
) => ({
  entity: { eid: crypto.randomUUID() },
  doc: { title },
  builder: { query: '$t .text', to: toolEid('plan_week'), immediate: true },
}))
let needs = (from: { entity: { eid: string } }, to: typeof from) => ({
  entity: { eid: crypto.randomUUID() },
  edge: { from: from.entity.eid, to: to.entity.eid },
  requires: {},
})
let wrote = await appStore(p.env.STORE, space, recipes)('/apply', {
  method: 'POST',
  body: JSON.stringify([
    heard,
    priced,
    answered,
    needs(answered, heard),
    needs(answered, priced),
  ]),
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
equal(wrote.status, 200, await wrote.text())
let running = await after()

test('how an app runs: its builders stage by stage, side by side where none requires another', () => {
  equal(running.runs, [
    'First, side by side',
    'HeardFor each new row it watches for',
    'PricedFor each new row it watches for',
    'Then',
    'AnsweredAfter Heard and Priced',
  ])
})
