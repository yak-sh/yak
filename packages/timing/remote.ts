/** A page-only reader for the box's credential-free tracker doors. Responses
 * live only while this view is mounted, never in the box or browser's durable
 * graph. The ordinary timing views receive the same bundles and query answers. */
import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { matcher } from '@yaks/match'
import { and, type Clause, parse } from '@yaks/query'
import type { Answer, Asks, Bundle, Io } from '@yaks/inspect'
import { Button, Field, Section, Tabs } from '@yaks/ui'

export type Page = { rows: Bundle[]; next?: string }
export type Tree = { trace: Bundle; spans: Bundle[]; next?: string }
/** Read all span pages before reporting a tree ready. A failed later page
 * never draws a partly received flamegraph as a complete capture. */
export let tree = async (
  scope: string,
  eid: string,
  signal: AbortSignal,
  go: typeof fetch = fetch,
): Promise<Tree> => {
  let spans: Bundle[] = [], after = '', seen = new Set<string>()
  let trace: Bundle
  do {
    let params = new URLSearchParams({
      scope,
      eid,
      limit: '100',
      ...after ? { after } : {},
    })
    let r = await go(`/tracker/trace?${params}`, { signal })
    let body = await r.json()
    if (!r.ok) throw Error(body.error ?? 'Remote trace unavailable')
    let page = body as Tree
    trace = page.trace
    spans.push(...page.spans)
    after = page.next ?? ''
    if (after && seen.has(after)) throw Error('Remote trace cursor repeated')
    seen.add(after)
  } while (after)
  return { trace: trace!, spans }
}
let asksText = (a: Asks[string]) => typeof a == 'string' ? a : a.query
let preds = (c: Clause): Clause[] =>
  c.kind == 'and' || c.kind == 'or' ? c.clauses.flatMap(preds) : [c]
/** Answer timing's own queries over remotely read bundles, using the shared
 * query evaluator rather than a second query language or stored mirror. */
export let remoteAnswers = (
  io: Io,
  scope: string,
  asks: Asks,
): Record<string, Answer> => {
  let key = JSON.stringify(asks)
  let [held, set] = useState<{ key: string; answers: Record<string, Answer> }>({
    key: '',
    answers: {},
  })
  useEffect(() => {
    let abort = new AbortController()
    let answer = async (line: string): Promise<Answer> => {
      if (!line) return { rows: [], ready: true }
      let q = parse(line), flat = q.clauses.flatMap(preds)
      let span = flat.find((c) =>
        c.kind == 'pred' && c.path.join('.') == 'span.trace'
      )
      let rows: Bundle[]
      if (span?.kind == 'pred') {
        let v = span.value
        let ids = v?.kind == 'list'
          ? v.items.map((v) => v.kind == 'scalar' ? v.raw : '')
          : v?.kind == 'scalar'
          ? [v.raw]
          : []
        rows = (await Promise.all(ids.map((id) =>
          tree(scope, id, abort.signal)
        ))).flatMap((p) => p.spans)
      } else {
        let r = await fetch(
          `/tracker/traces?${new URLSearchParams({ scope, limit: '100' })}`,
          { signal: abort.signal },
        )
        let body = await r.json()
        if (!r.ok) throw Error(body.error ?? 'Remote traces unavailable')
        rows = (body as Page).rows
      }
      let selected = matcher(
        and(...q.clauses.filter((c) => c.kind != 'count')),
        io.vocab,
      )(rows)
      return { rows: selected, ready: true }
    }
    void Promise.all(
      Object.entries(asks).map(async ([name, a]) => {
        try {
          return [name, await answer(asksText(a))] as const
        } catch (e) {
          return [name, {
            rows: [],
            ready: false,
            error: e instanceof Error ? e.message : 'Remote read failed',
          }] as const
        }
      }),
    ).then((entries) => {
      if (!abort.signal.aborted) {
        set({ key, answers: Object.fromEntries(entries) })
      }
    })
    return () => abort.abort()
  }, [key, scope])
  return held.key == key ? held.answers : Object.fromEntries(
    Object.keys(asks).map((k) => [k, { rows: [], ready: false }]),
  )
}

/** Each side stays an explicit address, including its global space scope. */
export let address = (scope: string, eid?: string, after?: string) =>
  `/?${new URLSearchParams({
    q: '.trace',
    side: 'yaks.app',
    scope,
    ...eid ? { trace: eid } : {},
    ...after ? { after } : {},
  })}`
export let Side = ({ remote = false }: { remote?: boolean }) =>
  h(
    Tabs,
    {},
    h(Tabs.Tab, { href: '/?q=.trace', mod: !remote && 'on' }, 'box'),
    h(Tabs.Tab, { href: address('platform'), mod: remote && 'on' }, 'yaks.app'),
  )
/** A global space eid is supplied explicitly; the independent Worker has no
 * directory binding from which to enumerate spaces. */
export let Scope = ({ scope }: { scope: string }) =>
  h(
    'form',
    { method: 'GET', action: '/' },
    h('input', { type: 'hidden', name: 'q', value: '.trace' }),
    h('input', { type: 'hidden', name: 'side', value: 'yaks.app' }),
    h(Field, {
      name: 'scope',
      value: scope,
      placeholder: 'platform or global space eid',
      'aria-label': 'Tracker scope',
    }),
    h(Button, { type: 'submit' }, 'Read scope'),
  )
export let unavailable = (a?: Answer) =>
  a?.error ? h(Section.Sub, { role: 'alert' }, a.error) : null
