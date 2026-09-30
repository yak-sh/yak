/**
 * The index beside every page: every package the graph's vocabulary is
 * served from, and under it every component it declares, always there, each
 * a link to its page; the one shown lit. It is read off the vocabulary the
 * host was served (@yaks/api `/vocab`), so it lists what the server serves and
 * nothing else, and each link names the entity a name derives
 * (./links.ts), the one the graph describes it in.
 * What is typed in the field above it (`text`, the page hands it down from
 * @yaks/filter) narrows it as it is typed: to the components whose name holds
 * it, and to every component of a package whose name does. The field runs it
 * as a query when it is sent (./Frame.ts).
 *
 * @module
 */

import { h, type JSX } from 'preact'
import * as ui from '@yaks/ui'
import type { Vocab } from '@yaks/vocab'
import type { Io } from './host.ts'
import { compEid, packEid } from './links.ts'

/**
 * The groups an index shows for `text`: each package with the components it
 * declares that match, a package matching by its own name keeping all of
 * them. Components no package declares come last, under none.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { grouped } from './Index.ts'
 * let comp = { component: true, properties: {} }
 * let vocab = loadVocab([
 *   { package: '@yaks/task', $defs: { task: comp, blocked: comp } },
 *   { package: '@yaks/doc', $defs: { doc: comp } },
 * ])
 * grouped(vocab, 'bl') // [['@yaks/task', ['blocked']]]
 * grouped(vocab, 'doc') // [['@yaks/doc', ['doc']]]
 * ```
 */
export let grouped = (
  vocab: Pick<Vocab, 'docs' | 'all' | 'comp'>,
  text: string,
): [string | undefined, string[]][] => {
  let t = text.trim().toLowerCase()
  let has = (s: string) => !t || s.toLowerCase().includes(t)
  let packs = [...new Set(vocab.docs.flatMap((d) => d.package ?? []))]
    .toSorted()
  let by = Map.groupBy(vocab.all, (n) => vocab.comp(n)?.package ?? '')
  let groups: [string | undefined, string[]][] = [
    ...packs.map((p): [string, string[]] => [p, by.get(p) ?? []]),
    [undefined, by.get('') ?? []],
  ]
  return groups.flatMap(([p, cs]): [string | undefined, string[]][] => {
    let whole = !!p && has(p)
    let shown = whole ? cs : cs.filter(has)
    return whole || shown.length ? [[p, shown]] : []
  })
}

/** The index, narrowed by `text`. `here` is the eid of the page shown, where
 * it is one. */
export let Index = (
  { io, here, text }: { io: Io; here?: string; text: string },
): JSX.Element => {
  let groups = grouped(io.vocab, text)
  let item = (Part: typeof ui.Index.Item, eid: string, name: string) =>
    h(Part, { key: eid, href: io.link(eid), mod: eid == here && 'on' }, name)
  return h(
    ui.Index,
    {},
    h(
      ui.Index.Group,
      {},
      h(ui.Index.Head, { href: io.find(''), mod: !here && 'on' }, 'inspect'),
    ),
    groups.map(([p, cs]) =>
      h(
        ui.Index.Group,
        { key: p ?? 'none' },
        p
          ? item(ui.Index.Head, packEid(p), p)
          : h(ui.Index.Head, {}, 'no package'),
        cs.map((n) => item(ui.Index.Item, compEid(n), n)),
      )
    ),
    !groups.length ? h(ui.Rows.More, {}, `nothing is named ${text}`) : null,
  )
}
