// The platform draft desk keeps every keystroke before a paced source save.
// The worker vouches identity and exposes only that caller's draft receipts.
import { browserDrafts } from './api/_draft.js'

export let recovery = async (request, report) => {
  let initial = await request('drafts')
  let rows = initial.drafts ?? [], listeners = new Set(), bound = []
  let known = new Set(rows.map((row) => row.draft.place)), baseline = new Map()
  let client = {
    me: () => Promise.resolve({ person: initial.principal }),
    subscribe: (_query, hear) => {
      listeners.add(hear)
      hear(rows)
      return () => listeners.delete(hear)
    },
    apply: async (bundles) => {
      let applied = []
      for (let row of bundles) {
        let answer = await request('drafts', {
          principal: initial.principal,
          place: row.draft.place,
          text: row.draft.text,
          over: row.typed?.over ?? '',
        })
        applied.push(...answer.bundles)
      }
      let next = new Map(rows.map((row) => [row.entity.eid, row]))
      for (let row of applied) next.set(row.entity.eid, row)
      rows = [...next.values()]
      for (let hear of listeners) hear(rows)
      return { bundles: applied }
    },
  }
  let desk = browserDrafts(client, new URL('./api/', document.baseURI).href, {
    by: initial.principal,
    recover: initial.recover ?? [],
    report,
  })
  let field = (input, place) => {
    let previous = baseline.get(place)
    if (previous !== undefined && previous !== input.value) {
      desk.restore(place, input.value, previous)
    } else if (!known.has(place) && !desk.has(place)) {
      desk.restore(place, input.value)
    }
    baseline.set(place, input.value)
    known.add(place)
    bound.push(desk.bind(input, place))
  }
  return {
    field,
    bind: (form, place) => {
      for (
        let input of form.querySelectorAll(
          'input[name]:not([type=hidden]),textarea[name],select[name]',
        )
      ) field(input, place + ':' + input.name)
    },
    unbind: () => {
      for (let stop of bound.splice(0)) stop()
    },
    close: () => desk.close(),
  }
}
