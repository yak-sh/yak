import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import type { Bundle, Comp } from '@yaks/graph'
import { operatorStore } from './operator-store.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import {
  conversationOf,
  operatorFrames,
  operatorRequest,
  standingAt,
} from './operator-host.ts'
import { rows } from './operator-view.ts'
import { namer } from './operator-draw.ts'
import { recentOf } from './operator-glance.ts'
import { rootOf } from './operator-root.ts'

let space = crypto.randomUUID(), person = crypto.randomUUID()
let store = operatorStore(durable())
let root = rootOf(space, person), other = crypto.randomUUID()
let ids: string[] = [crypto.randomUUID(), crypto.randomUUID()]
let foreign = crypto.randomUUID()
let held = { space, person, role: 'owner' as const }
let entry = (eid: string, session: string, body: string): Bundle => ({
  entity: { eid },
  entry: { session },
  content: { body },
})
await store.g.apply([
  { entity: { eid: root }, session: {}, operator_session: { space, person } },
  {
    entity: { eid: other },
    session: {},
    operator_session: { space, person: other },
  },
  entry(ids[0], root, 'Pruning canary one'),
  entry(ids[1], root, 'Pruning canary two'),
  entry(foreign, other, 'Other person'),
], { trusted: true })
let heard: string[] = []
operatorFrames(store, () => [{
  deserializeAttachment: () => ({ ...held, operator: true }),
  send: (frame) => void heard.push(frame),
}])
let operator = {
  store,
  named: () => Promise.resolve('Person'),
  stop: () => Promise.resolve({ stopped: true }),
} as never
let edit = (ids: string[], restore = false) =>
  operatorRequest(
    operator,
    held,
    '/operator/archive',
    { ids, restore },
    () => undefined,
  )
let before = await standingAt(store, root, held)
let response = await edit(ids)
let after = await standingAt(store, root, held)
let shown = await conversationOf(store, '/operator', root)
let archived = await store.g.get(ids)
let doc =
  parseHTML(rows(archived, namer({})).map((r) => r.html).join('')).document
// The SQLite store's full-text search indexes archived entries too.
let found = await store.g.read('Pruning .entry *')
let glance = await recentOf({ store, space, person } as never)
let refused = await edit([ids[0], foreign], true)
let unchanged = await store.g.get(ids)
await edit(ids, true)
let restored = await store.g.get(ids)
let restoredAt = await standingAt(store, root, held)
let restoredDoc =
  parseHTML(rows(restored, namer({})).map((r) => r.html).join('')).document

test('a person archives a span in one write without losing its words or search hits', () => {
  equal(response!.status, 200)
  equal(archived.map((b) => (b.content as Comp).body), [
    'Pruning canary one',
    'Pruning canary two',
  ])
  equal(archived.every((b) => (b.archived as Comp).by == person), true)
  equal(found.filter((b) => ids.includes(b.entity.eid)).length, 2)
  equal(glance.includes('Pruning canary'), false)
})

test('timestamps offer entry actions, and hiding preserves readable words and restoration', () => {
  equal(doc.querySelectorAll('.Talk_Entry-hidden').length, 2)
  equal(restored.every((b) => !b.archived && !!b.content), true)
  equal(restoredDoc.querySelectorAll('.Talk_Entry-hidden').length, 0)
  for (
    let [page, label, restore] of [[doc, 'Restore', 'true'], [
      restoredDoc,
      'Hide',
      'false',
    ]] as const
  ) {
    let actions = [...page.querySelectorAll('[data-archive-entries]')]
    equal(actions.length, 2)
    for (let button of actions) {
      equal(button.textContent, label)
      equal(button.getAttribute('data-restore'), restore)
      let menu = button.closest('[role=menu]')!
      equal(menu.hasAttribute('hidden'), true)
      equal(
        [...menu.querySelectorAll('[role=menuitem]')].map((b) => b.textContent),
        ['Copy', 'Quote', 'Copy link', label],
      )
      let trigger = page.querySelector('[aria-controls="' + menu.id + '"]')!
      equal(!!trigger.querySelector('time[data-tip][data-relative]'), true)
    }
  }
})

test('an archive span cannot include another person’s entry, and old-row edits refresh watching pages', () => {
  equal(refused!.status, 404)
  equal(unchanged.every((b) => !!b.archived), true)
  equal(heard.filter((s) => JSON.parse(s).operator?.refresh).length, 2)
})

test('archive and restore change the reconnect cursor without adding a transcript line', () => {
  equal(after == before, false)
  equal(shown.standing, after)
  equal(restoredAt, before)
})
