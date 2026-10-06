// Query ownership for bugs and occurrences. The host answers domain asks;
// trace faces come through the registry, never through a timing import.
import { render } from '@yaks/preact'
import type { Asks, Props, View } from '@yaks/inspect'
import { parse } from '@yaks/query'
import { occurrences, relatedTraces, views } from './views.ts'
import { comp, str } from './model.ts'

let doors = (io: Props['io']) => ({
  id: io.id,
  name: io.name,
  when: io.when,
  link: io.link,
  find: io.find,
  get: io.get,
  show: (b: Props['e'], view: string) => io.show(b, view),
})
let referenceQuery = (rows: Props['e'][]): string | undefined => {
  let ids = [
    ...new Set(rows.flatMap((e) => {
      let during = comp(e, 'during')
      return ['entity', 'app', 'space', 'process', 'request']
        .map((k) => str(during[k])).filter(Boolean)
    })),
  ]
  return ids.length ? `.entity.eid=${ids.join(',')} *` : undefined
}
let BugPage = ({ e, io, got }: Props) => {
  let errors = got.errors?.rows ?? []
  let references = referenceQuery(errors)
  io.ask(references ? { references } : {})
  return render(views, e, 'Full', io.vocab, { ...doors(io), errors })
}
export let inspectViews: View[] = ['Full', 'Inspect.Page'].map((view) => ({
  view,
  match: parse('.bug'),
  asks: (e) => ({ errors: occurrences(e.entity.eid) }),
  Render: BugPage,
}))
inspectViews.push(...['Full', 'Inspect.Page'].map((view): View => ({
  view,
  match: parse('.error'),
  asks: (e, io): Asks => {
    let related = io.vocab.all.includes('trace') && relatedTraces(e)
    let references = referenceQuery([e])
    return {
      ...related ? { traces: related.query } : {},
      ...references ? { references } : {},
    }
  },
  Render: ({ e, io, got }) => {
    let related = io.vocab.all.includes('trace') && relatedTraces(e)
    return render(views, e, 'Full', io.vocab, {
      ...doors(io),
      traceLabel: related ? related.label : undefined,
      traces: got.traces?.rows ?? [],
      tracesReady: got.traces?.ready,
      tracesError: got.traces?.error,
    })
  },
})))
