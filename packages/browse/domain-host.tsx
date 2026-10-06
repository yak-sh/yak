// Bind portable domain components to Browse's replica and page graph. Domain
// packages know these interfaces, never the app that supplies them.
import { computed, effect } from '@preact/signals'
import type { Bundle } from '@yaks/graph'
import { configureDrafts } from '@yaks/draft/ui'
import { configureComments } from '@yaks/kernel/comment-host'
import {
  apply,
  capable,
  config,
  ent,
  holdQuery,
  myActor,
  pending,
  row,
} from './live.ts'
import { scopedStorage } from './hosting.ts'
import { parseQuery } from './query.ts'
import { type Ent, idOf, nick, vocab } from './types.ts'
import { commands, orderIn, suggest } from './commands.ts'
import { slotsOf } from './verb.ts'
import { people } from './components/hits.ts'
import { usePage } from './components/page.ts'
import { useModel, useRepoUrl } from './components/subscriptions.ts'
import { useQuery } from './components/useQuery.ts'
import { linkProps } from './components/nav.tsx'
import { Markdown } from './components/Markdown.tsx'
import { ago } from './components/Stamp.tsx'
import { pretty } from './time.ts'
import { renderView } from './components/registry.ts'

export let domainBundle = (e: Ent): Bundle => {
  let {
    eid,
    num,
    entity: _entity,
    kind: _kind,
    refs: _refs,
    kids: _kids,
    ...comps
  } = e
  return { entity: { eid, num }, ...comps } as Bundle
}
let entity = (b: Bundle) => ent(b.entity.eid)
configureDrafts({
  by: () => capable('draft') ? myActor() : undefined,
  people: () => people(2),
  stash: () => {
    if (!config.host) return undefined
    try {
      return scopedStorage(globalThis.localStorage)
    } catch {
      return undefined
    }
  },
  client: {
    mutate: apply,
    watch: (query) => {
      let ids = holdQuery(parseQuery(query))
      let held = computed(() =>
        ids.value.flatMap((eid): Bundle[] => {
          let draft = row(eid).value?.draft
          return draft ? [{ entity: { eid }, draft }] : []
        })
      )
      return {
        get value() {
          return held.value
        },
        subscribe: (fn) => effect(() => fn(held.value)),
      }
    },
  },
})
configureComments({
  get: (eid) => domainBundle(ent(eid)),
  id: (b) => idOf(entity(b)),
  useRows: (query) => useQuery(query).map(domainBundle),
  useModel: (eid) => useModel(ent(eid)).name,
  useRepo: (b) => useRepoUrl(entity(b)),
  usePage: (name, place) => usePage(name, place),
  render: (b, view) => renderView(entity(b), view),
  link: (b) => linkProps(entity(b)),
  markdown: (text, repo) => <Markdown text={text} repo={repo} />,
  pending: (b) => pending(entity(b)),
  has: (comp) => !!vocab.comp(comp),
  modelName: (model) => nick(model) ?? undefined,
  when: ago,
  timestamp: pretty,
  command: (line) => !!orderIn(line),
  hints: (line) =>
    suggest(line, commands).map(([name, c]) => ({
      name,
      args: slotsOf(c.args),
      about: c.about,
    })),
})
