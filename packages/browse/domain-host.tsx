// Bind portable domain components to Browse's replica and page graph. Domain
// packages know these interfaces, never the app that supplies them.
import { computed, effect } from '@preact/signals'
import type { Bundle } from '@yaks/graph'
import { configureDrafts } from '@yaks/draft/input'
import { configureComments } from '@yaks/kernel/comment-host'
import {
  apply,
  capable,
  config,
  ent,
  findEid,
  myActor,
  pending,
  queryEids,
  row,
} from './live.ts'
import { scopedStorage } from './hosting.ts'
import { parseQuery, resolveRefs } from './query.ts'
import { type Ent, idOf, nick, vocab } from './types.ts'
import { commands, orderIn, suggest } from './commands.ts'
import { slotsOf } from './verb.ts'
import { people } from './components/hits.ts'
import { usePage } from './components/page.ts'
import { useModel, useRepoUrl } from './components/subscriptions.ts'
import { useQuery, useQueryResult } from './components/useQuery.ts'
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
    // What the mounted app holds (useDrafts), read: a watch opens nothing.
    watch: (query) => {
      let preds = resolveRefs(parseQuery(query), findEid)
      let held = computed(() =>
        queryEids(preds).value.flatMap((eid): Bundle[] => {
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
// The person's drafts, held by the app while it is mounted: every box that
// types one and every view that reads one (a board's open quick-create, a
// comment's composer) is inside it, and the desk's watch reads this hold.
export let useDrafts = () => {
  let by = capable('draft') ? myActor() : undefined
  useQueryResult(by ? `.draft.by=${by}` : '', !!by)
}

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
