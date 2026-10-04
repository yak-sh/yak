// Query ownership for a bug's page. The inspector host answers the domain's
// asks; errors are drawn through its registry, never a web-injected query view.
import { render } from '@yaks/preact'
import type { Props, View } from '@yaks/inspect'
import { parse } from '@yaks/query'
import { occurrences, views } from './views.ts'

let BugPage = ({ e, io, got }: Props) =>
  render(views, e, 'Full', io.vocab, {
    id: io.id,
    name: io.name,
    when: io.when,
    link: io.link,
    show: (b: Props['e'], view: string) => io.show(b, view),
    errors: got.errors?.rows ?? [],
  })
export let inspectViews: View[] = ['Full', 'Inspect.Page'].map((view) => ({
  view,
  match: parse('.bug'),
  asks: (e) => ({ errors: occurrences(e.entity.eid) }),
  Render: BugPage,
}))
inspectViews.push(...['Full', 'Inspect.Page'].map((view): View => ({
  view,
  match: parse('.error'),
  Render: ({ e, io }) =>
    render(views, e, 'Full', io.vocab, {
      id: io.id,
      name: io.name,
      when: io.when,
      link: io.link,
    }),
})))
