// Reopening the same catalogue preserves discovered metadata and does no writes.
import { equal, test } from '@yaks/testing'
import { type Comp, identityEid } from '@yaks/graph'
import { agent } from './agent.ts'
import { harness } from './testing.ts'

let outcome = await (async () => {
  let h = await harness()
  let tools = [{
    name: 'startup_probe',
    description: 'first',
    parameters: {},
    run: () => '',
  }]
  let opts = {
    h,
    name: 'startup/model',
    tools,
    model: () => Promise.resolve({ id: 'fake', model: 'fake', items: [] }),
  }
  // Keep the same graph open while each agent drains its own pool.
  let first = agent(opts)
  await first.close()
  let id = identityEid('model', ['startup/model'])
  await h.g.apply([{ entity: { eid: id }, model: { context: 12345 } }], {
    trusted: true,
  })
  let apply = h.g.apply.bind(h.g)
  let catalogues = 0
  h.g.apply = (rows, options) => {
    if (rows.some((b) => b.provider || b.model || b.tool || b.serves)) {
      catalogues++
    }
    return apply(rows, options)
  }
  let reopened = agent(opts)
  await reopened.close()
  let unchanged = catalogues
  tools[0].description = 'updated'
  let refreshed = agent(opts)
  await refreshed.close()
  let [model] = await h.g.get([id], ['model'])
  let [tool] = await h.g.get([identityEid('tool', ['startup_probe'])], ['tool'])
  h.close()
  return {
    unchanged,
    updated: catalogues > unchanged,
    context: (model.model as Comp)?.context,
    description: (tool.tool as Comp)?.description,
  }
})()

test('reopening an unchanged catalogue performs no catalogue writes', () =>
  equal(outcome.unchanged, 0))
test('catalogue refresh preserves discovered model metadata', () =>
  equal(outcome.context, 12345))
test('catalogue refresh writes changed tool descriptions', () => {
  equal(outcome.updated, true)
  equal(outcome.description, 'updated')
})
