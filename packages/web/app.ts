// The browser app: a bar to go anywhere from, a home page of what is open and
// what was written lately, and a page per entity at its own address — `/T-9`,
// or `/T#8d83e663ef` for one the store has not numbered. Read-only.
//
// Everything on screen is a watch on the client (@yaks/client): a query the
// server answers once and then keeps current over its socket, so a page
// changes when the graph does and never polls. What each entity looks like is
// the registry's business — this file decides which entities a page gathers
// and hands them to the views (./views.ts and every package's `./views`).

import type { Client, ClientWatchOpts } from '@yaks/client'
import { relations } from '@yaks/edge'
import type { Bundle } from '@yaks/graph'
import { human, parse as numbered, SHORT, short } from '@yaks/id'
import { render } from '@yaks/preact'
import type { Registry } from '@yaks/render'
import type { Vocab } from '@yaks/vocab'
import { h, type VNode } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Related, Shown } from './views.ts'

/** What the app is handed: the client it reads through, the vocabulary both
 * ends loaded, and the registry of every view. */
export type App = {
  box: Client
  vocab: Vocab
  registry: Registry
  name: string
}

/** Where the browser is: the home page (with an optional search), or one
 * entity by the id in its address. */
export type Place = { home: string } | { id: string }

let EID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The place an address names. A lone letter keeps its fragment, because a
 * short handle (`T#8d83e663ef`) is written with the `#` the browser keeps to
 * itself. */
export let place = (
  loc: { pathname: string; search: string; hash: string },
): Place => {
  let path = decodeURIComponent(loc.pathname.slice(1))
  if (!path) return { home: new URLSearchParams(loc.search).get('q') ?? '' }
  return { id: /^[A-Za-z]$/.test(path) ? path + loc.hash : path }
}

// A short handle's hex, dashed back into the shape an eid is stored in, so it
// can be looked for as the start of one.
let dashed = (hex: string) =>
  [8, 4, 4, 4, 12].reduce(
    (out, n, i, all) => {
      let at = all.slice(0, i).reduce((a, b) => a + b, 0)
      let part = hex.slice(at, at + n)
      return part ? out + (i ? '-' : '') + part : out
    },
    '',
  )

/** The query that finds the entity an id names: its number, the start of its
 * eid, or the eid itself. Anything else is not an id. */
export let lookup = (id: string): string | undefined => {
  let n = numbered(id)
  if (n) return `.num=${n.num}&*`
  if (SHORT.test(id)) return `.eid~=${dashed(id.split('#')[1].toLowerCase())}&*`
  if (EID.test(id)) return `.eid=${id.toLowerCase()}&*`
}

// A watch held for as long as the component that asked for it, and a render
// each time its answer or its readiness moves. No query, no watch. The effect
// that subscribes runs after the first paint, and an answer can land before
// it, so it renders once more on subscribing to catch up.
let useWatch = (box: Client, q: string | undefined, o?: ClientWatchOpts) => {
  let [, tick] = useState(0)
  let w = useMemo(() => (q ? box.watch(q, o) : undefined), [box, q])
  useEffect(() => {
    if (!w) return
    let stop = w.subscribe(() => tick((n) => n + 1))
    tick((n) => n + 1)
    return () => {
      stop()
      w.close()
    }
  }, [w])
  return { value: w?.value ?? [], ready: w ? w.ready : true }
}

// What a person calls an entity, from the components that name one.
let label = (b: Bundle, id: string): string => {
  let said = (comp: string, col: string) => {
    let v = (b[comp] as Record<string, unknown> | undefined)?.[col]
    return typeof v == 'string' && v ? v : undefined
  }
  return said('doc', 'title') ?? said('person', 'name') ??
    said('alias', 'name') ?? said('email', 'address') ?? id
}

let clock = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
let day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
let UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

/** A moment as it reads on a page: how long ago, within the week; the date
 * after that. */
export let when = (at: string, now = Date.now()): string => {
  let ms = Date.parse(at)
  if (Number.isNaN(ms)) return at
  let ago = now - ms
  if (ago > 7 * 86_400_000 || ago < 0) return day.format(ms)
  let [unit, size] = UNITS.find(([, s]) => ago >= s) ?? ['minute', 60_000]
  return clock.format(-Math.round(ago / size), unit)
}

// The context every view on a page is drawn with (./views.ts `Shown`).
let context = (app: App, extra: Partial<Shown<VNode>> = {}) => {
  let id = human(app.vocab)
  let ctx: Shown<VNode> = {
    id,
    kind: (b) => app.vocab.kindOf(b) || 'entity',
    name: (eid) => {
      let b = app.box.ent(eid)
      return b ? label(b, id(b)) : short(eid)
    },
    link: (eid) => {
      let b = app.box.ent(eid)
      return b ? `/${id(b)}` : undefined
    },
    when: (at) => when(at),
    show: (b, view) => render(app.registry, b, view, app.vocab, ctx),
    ...extra,
  }
  return ctx
}

let view = (app: App, b: Bundle, name: string, extra?: Partial<Shown<VNode>>) =>
  render(app.registry, b, name, app.vocab, context(app, extra))

let list = (app: App, items: Bundle[]) =>
  h(
    'ul',
    { class: 'Section_List' },
    items.map((b) => h('li', { key: b.entity.eid }, view(app, b, 'Tile'))),
  )

let waiting = (ready: boolean, empty: string) =>
  h('p', { class: 'Quiet' }, ready ? empty : 'Loading…')

let Section = (
  { app, title, q, empty, o }: {
    app: App
    title: string
    q: string
    empty: string
    o?: ClientWatchOpts
  },
) => {
  let w = useWatch(app.box, q, o)
  return h(
    'section',
    { class: 'Section' },
    h('h2', { class: 'Section_Title' }, title),
    w.value.length ? list(app, w.value) : waiting(w.ready, empty),
  )
}

let Home = ({ app, q }: { app: App; q: string }) => {
  useEffect(() => {
    document.title = q ? `${q} · ${app.name}` : app.name
  }, [q])
  if (q) {
    let limited = /(^|&)\.limit=/.test(q) ? q : `${q}&.limit=100`
    return h(Section, {
      app,
      title: `Results for “${q}”`,
      q: `${limited}&*`,
      empty: 'Nothing matches.',
    })
  }
  return h(
    'div',
    null,
    h(Section, {
      app,
      title: 'Open tasks',
      q: '.task.status=open&.order=-entity.num&.limit=60&*',
      empty: 'No open tasks.',
      // A status is computed, and only the server's store computes it.
      o: { evaluate: 'server' },
    }),
    h(Section, {
      app,
      title: 'Recently written',
      q: '.doc&!comment&.order=-entity.num&.limit=30&*',
      empty: 'Nothing written yet.',
    }),
  )
}

// Every entity a page names but does not hold: the far end of each edge, the
// entities its columns reference, and whoever wrote its comments.
let named = (vocab: Vocab, bundles: Bundle[]): string[] =>
  bundles.flatMap((b) =>
    vocab.refCols().flatMap(([comp, prop]) => {
      let v = (b[comp] as Record<string, unknown> | undefined)?.[prop]
      return typeof v == 'string' && EID.test(v) ? [v] : []
    })
  )

let Entity = ({ app, id }: { app: App; id: string }) => {
  let found = useWatch(app.box, lookup(id))
  let e = found.value[0]
  let eid = e?.entity.eid
  let comments = useWatch(app.box, eid && `.comment.target=${eid}&*`)
  let out = useWatch(app.box, eid && `.edge.from=${eid}&*`)
  let into = useWatch(app.box, eid && `.edge.to=${eid}&*`)
  let wanted = e
    ? [
      ...new Set(
        named(app.vocab, [e, ...comments.value, ...out.value, ...into.value]),
      ),
    ]
      .filter((x) => x != eid).sort()
    : []
  useWatch(app.box, wanted.length ? `.eid=${wanted.join(',')}&*` : undefined)
  useEffect(() => {
    if (e) {
      let said = human(app.vocab)(e)
      document.title = `${said} ${label(e, '')} · ${app.name}`.trim()
    }
  }, [e])
  if (!e) {
    return h(
      'p',
      { class: 'Quiet' },
      !lookup(id)
        ? `“${id}” is not an id.`
        : found.ready
        ? `Nothing is called ${id}.`
        : 'Loading…',
    )
  }
  let tags = new Set(Object.values(relations(app.vocab)))
  let tag = (b: Bundle) => Object.keys(b).find((k) => tags.has(k)) ?? 'edge'
  let group = (
    edges: Bundle[],
    end: 'from' | 'to',
    title: (t: string) => string,
  ) => {
    let by = new Map<string, Bundle[]>()
    for (let x of edges) {
      let other = (x.edge as Record<string, string>)[end]
      let t = title(tag(x))
      by.set(t, [
        ...(by.get(t) ?? []),
        app.box.ent(other) ?? { entity: { eid: other } },
      ])
    }
    return [...by].map(([title, items]): Related => ({ title, items }))
  }
  let at = (b: Bundle) =>
    String((b.created as { at?: string } | undefined)?.at ?? '')
  return view(app, e, 'Page', {
    relations: [
      ...group(out.value, 'to', (t) => t),
      ...group(into.value, 'from', (t) => `${t} this`),
    ],
    comments: [...comments.value].sort((a, b) => at(a).localeCompare(at(b))),
  })
}

// The bar at the top: the space's name home, and one field that goes to an id
// or searches for anything else.
let Bar = ({ app, go }: { app: App; go: (to: string) => void }) =>
  h(
    'header',
    { class: 'Bar' },
    h('a', { class: 'Bar_Home', href: '/' }, app.name),
    h(
      'form',
      {
        class: 'Bar_Go',
        onSubmit: (event: Event) => {
          event.preventDefault()
          let field = (event.currentTarget as HTMLFormElement).elements
            .namedItem('go') as HTMLInputElement
          let said = field.value.trim()
          if (!said) return
          go(lookup(said) ? `/${said}` : `/?q=${encodeURIComponent(said)}`)
          field.blur()
        },
      },
      h('input', {
        name: 'go',
        type: 'search',
        placeholder: 'Go to T-123, or search…',
        autocomplete: 'off',
        spellcheck: false,
      }),
    ),
  )

/** The whole page: the bar, then home or the entity the address names. Links
 * move within the app without reloading it; everything else is the browser's. */
export let Shell = ({ app }: { app: App }) => {
  let [at, move] = useState(() => place(location))
  let go = (to: string) => {
    history.pushState(null, '', to)
    move(place(location))
    scrollTo(0, 0)
  }
  useEffect(() => {
    let back = () => move(place(location))
    let click = (event: MouseEvent) => {
      let a = (event.target as Element | null)?.closest?.('a[href]')
      if (
        !a || event.defaultPrevented || event.button != 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey ||
        a.getAttribute('target')
      ) return
      let url = new URL((a as HTMLAnchorElement).href)
      if (url.origin != location.origin) return
      event.preventDefault()
      go(url.pathname + url.search + url.hash)
    }
    addEventListener('popstate', back)
    addEventListener('hashchange', back)
    document.addEventListener('click', click)
    return () => {
      removeEventListener('popstate', back)
      removeEventListener('hashchange', back)
      document.removeEventListener('click', click)
    }
  }, [])
  return h(
    'div',
    { class: 'App' },
    h(Bar, { app, go }),
    h(
      'main',
      { class: 'Main' },
      'id' in at
        ? h(Entity, { app, id: at.id, key: at.id })
        : h(Home, { app, q: at.home, key: at.home }),
    ),
  )
}
