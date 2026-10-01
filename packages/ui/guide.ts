/** The guide uses the page's composition: installed kits, UX specimens and
 * skin coverage, rather than an inventory private to the base package. */
import { h, type VNode } from 'preact'
import { Catalog } from './Catalog.ts'
import type { Props } from './el.ts'
import { Gallery } from './Gallery.ts'
import { Head } from './Head.ts'
import { Index } from './Index.ts'
import { composition, groups, kit, parts } from './kit.ts'
import type { Composition, Piece } from './theme.ts'

export let title = '@yaks/ui'
type Entry = Pick<Piece, 'description' | 'specimens'> & {
  title?: string
  part?: string
}
type Entries = Record<string, Entry>

/** The base retains its familiar groups; other kits carry their own names. */
export let sections = (c: Composition): Record<string, Entries> => {
  parts(c)
  let out: Record<string, Entries> = {}
  for (let [name, pieces] of Object.entries(c.kits)) {
    if (pieces == kit) Object.assign(out, groups)
    else {out[`ui/${name}`] = Object.fromEntries(
        Object.entries(pieces).map((
          [part, entry],
        ) => [`ui/${name}/${part}`, { ...entry, title: part, part }]),
      )}
  }
  for (let [name, ux] of Object.entries(c.ux ?? {})) {
    out[`ux/${name}`] = Object.fromEntries(
      Object.entries(ux.components).map((
        [part, entry],
      ) => [`ux/${name}/${part}`, { ...entry, title: part }]),
    )
  }
  return out
}
export let stopsOf = (c: Composition): string[] => [
  title,
  ...Object.entries(sections(c)).flatMap((
    [g, entries],
  ) => [g, ...Object.keys(entries)]),
]
export let stops = stopsOf(composition)
let entries = (c: Composition): Entries => {
  let out: Entries = {}
  for (let group of Object.values(sections(c))) {
    for (let [id, entry] of Object.entries(group)) {
      if (Object.hasOwn(out, id)) {
        throw new Error(`duplicate guide entry: ${id}`)
      }
      out[id] = entry
    }
  }
  return out
}

let groupTitle = (name: string) =>
  name.startsWith('ui/')
    ? name.slice(3)
    : name.startsWith('ux/')
    ? `UX ${name.slice(3)}`
    : name

type Dressed = { composition?: Composition }
let { Figure, Caption, Stage } = Gallery

/** One entry, including whether the skin names this part. */
export let Specimens = (
  { name, composition: c = composition }: Dressed & { name: string },
): VNode => {
  let part = entries(c)[name]
  if (!part) throw new Error(`unknown guide entry: ${name}`)
  let uiName = part.part ?? (!part.title ? name : undefined)
  let skinned = !!uiName && !!c.skin?.[uiName]
  return h(
    Catalog.Entry,
    { id: name, 'data-skin': skinned ? 'skin' : 'kit' },
    h(Catalog.Title, {}, part.title ?? name),
    h(Catalog.Sub, {}, part.description),
    c.skin && uiName &&
      h(Catalog.Sub, {}, skinned ? 'skin rendering' : 'kit rendering'),
    h(
      Gallery,
      {},
      part.specimens().map(([label, node]) =>
        h(Figure, { key: label }, h(Caption, {}, label), h(Stage, {}, node))
      ),
    ),
  )
}
let Group = (
  { name, composition: c = composition }: Dressed & { name: string },
) =>
  h(
    Catalog.Group,
    { id: name },
    h(Catalog.Heading, {}, groupTitle(name)),
    Object.keys(sections(c)[name]).map((part) =>
      h(Specimens, { key: part, name: part, composition: c })
    ),
  )

/** The same composition as the page being checked. */
export let Guide = ({ composition: c = composition }: Dressed = {}): VNode =>
  h(
    Catalog,
    { id: title },
    h(
      Head,
      {},
      h(Head.Title, {}, title),
      h(
        Head.Sub,
        {},
        'Every kit, every variant. Browser and terminal share the same parts.',
      ),
    ),
    Object.keys(sections(c)).map((name) =>
      h(Group, { key: name, name, composition: c })
    ),
  )
export let Page = (
  { stop, composition: c = composition }: Dressed & { stop: string },
) =>
  stop == title ? h(Guide, { composition: c }) : h(
    Catalog,
    {},
    sections(c)[stop]
      ? h(Group, { name: stop, composition: c })
      : h(Specimens, { name: stop, composition: c }),
  )
export let Contents = (
  { entry, composition: c = composition }: Dressed & {
    entry: (stop: string) => Props
  },
): VNode =>
  h(
    Index,
    {},
    h(Index.Group, {}, h(Index.Head, entry(title), title)),
    Object.entries(sections(c)).map(([g, parts]) =>
      h(
        Index.Group,
        { key: g },
        h(Index.Head, entry(g), groupTitle(g)),
        Object.entries(parts).map(([p, part]) =>
          h(Index.Item, { key: p, ...entry(p) }, part.title ?? p)
        ),
      )
    ),
  )
