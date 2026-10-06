// Rehearse the exact guarded clear/declaration/restore sequence on synthetic
// legacy rows in workerd. Nothing here addresses an account or deployed app.
import { type State, Store } from './graph.ts'
import { cleared, restored } from '../../apps/vale/fight-update.ts'
import type { Bundle } from '@yaks/graph'
import words from '../../apps/vale/vocab.json' with { type: 'json' }

export let fightUpdate = async (storage: State['storage']) => {
  let store = new Store({
    storage,
    getWebSockets: () => [],
    acceptWebSocket: () => {},
  })
  let person = crypto.randomUUID(),
    app = crypto.randomUUID(),
    hero = crypto.randomUUID()
  let headers = {
    'x-store': 'probe/fight-update',
    'x-yak-app': app,
    'x-yak-person': person,
    'x-yak-role': 'owner',
    'x-yak-access': 'private',
  }
  let call = (path: string, body?: unknown) =>
    store.fetch(
      new Request(`http://store${path}`, {
        headers,
        ...(body === undefined
          ? {}
          : { method: 'POST', body: JSON.stringify(body) }),
      }),
    )
  let post = async (path: string, body: unknown) => {
    let r = await call(path, body)
    if (!r.ok) throw new Error(`${path}: ${await r.text()}`)
    return r.json()
  }
  let read = async () =>
    (await (await call('/query?q=.fight&?doc&?person')).json()) as Bundle[]
  let legacy = {
    $defs: {
      fight: {
        ...words.$defs.fight,
        properties: {
          ...words.$defs.fight.properties,
          dealt: { type: 'string', format: 'json' },
        },
      },
    },
  }
  let next = { $defs: { fight: words.$defs.fight } }
  await post('/vocab', legacy)
  let text =
    '[ {"foe":"wolf", "life":1234567890123, "dmg":3.5,"held":0,"note":"keep me"} ]'
  await post('/apply', [
    {
      entity: { eid: hero },
      person: {},
      doc: { body: 'precious unsent person input' },
      fight: { foe: 'wolf', dealt: text, swing: 7 },
    },
    { entity: { eid: crypto.randomUUID() }, fight: { dealt: '[]' } },
  ])
  let original = await read()
  let refused = await call('/vocab', next)
  let refusal = await refused.json()
  let clear = cleared(original)
  await post('/apply?check=1', clear)
  let afterCheck = await read()
  await post('/apply', clear)
  let missing = await read()
  await post('/vocab', next)
  let restore = restored(original, missing)
  await post('/apply?check=1', restore)
  let afterRestoreCheck = await read()
  await post('/apply', restore)
  let after = await read()
  let again = restored(original, after)
  return {
    status: refused.status,
    refusal,
    original,
    afterCheck,
    missing,
    afterRestoreCheck,
    after,
    again,
    clear,
    restore,
  }
}
