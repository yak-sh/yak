/**
 * `Inspect.Tile`: one row standing for one thing in an inspector list, a
 * tile per kind. A component is its name in its hue, its package and what it
 * is; a property its address, its type and what it holds; a package its name;
 * an archetype the components it is made of; a transaction when and by whom;
 * a change what it wrote where; anything else its id, kind and title. A tile
 * links to the thing's own inspector page. A list that knows how many
 * entities a row stands for passes it as `ctx.count`.
 *
 * @module
 */

import { type ComponentChildren, h, type VNode } from 'preact'
import { parse } from '@yaks/query'
import { Chip, Tile } from '@yaks/ui'
import type { Props, View } from './host.ts'
import { comp, count, face, line, str, tables, tone } from './read.ts'

let { Id, Kind, Title, Note, Count } = Tile

// The count a list knows, at the end.
let counted = (ctx: Props['ctx']) =>
  typeof ctx.count == 'number' ? h(Count, {}, count(ctx.count)) : null

// A tile linking to the page of the entity it stands for.
let tile = ({ e, io }: Props, ...kids: ComponentChildren[]): VNode =>
  h(Tile, { href: io.link(e.entity.eid) }, ...kids)

/** A component's name, in its hue. */
export let chip = (name: string, href?: string): VNode =>
  h(Chip, { mod: tone(name), href }, name)

/** Components' names side by side, each in its hue, apart where no stylesheet
 * spaces them (a terminal). `href` links each one somewhere. */
export let chips = (
  names: string[],
  href: (name: string) => string | undefined = () => undefined,
): ComponentChildren[] =>
  names.flatMap((n, i) => [i ? ' ' : null, chip(n, href(n))])

let CompTile = (p: Props) => {
  let name = str(p.e, '_comp', 'name')
  let pkg = str(p.e, '_comp', 'package')
  return tile(
    p,
    h(Title, {}, chip(name)),
    pkg ? h(Kind, {}, p.io.name(pkg)) : null,
    h(Note, {}, line(str(p.e, 'doc', 'body'))),
    counted(p.ctx),
  )
}

// A property's type as it reads: `string · enum`, `ref → session`.
export let typed = (prop: Record<string, unknown>): string =>
  [
    [prop.type].flat().filter(Boolean).join('|'),
    prop.format,
    prop.enum ? 'enum' : null,
    prop.ref ? `→ ${prop.ref}` : null,
  ].filter(Boolean).join(' ')

// What is special about a property: who owns it, whether it is stored.
export let flags = (prop: Record<string, unknown>): string[] =>
  ['stamped', 'computed', 'required', 'search', 'unique', 'identity']
    .filter((k) => prop[k] === true)

let PropTile = (p: Props) => {
  let prop = comp(p.e, '_prop')
  return tile(
    p,
    h(Title, {}, str(p.e, 'doc', 'title') || String(prop.name ?? '')),
    h(Kind, {}, typed(prop)),
    h(
      Note,
      {},
      [...flags(prop), line(str(p.e, 'doc', 'body'))].filter(Boolean)
        .join(' · '),
    ),
    counted(p.ctx),
  )
}

let PackageTile = (p: Props) => {
  let names = (p.ctx.comps ?? []) as string[]
  return tile(
    p,
    h(Title, {}, str(p.e, '_package', 'name') || str(p.e, 'doc', 'title')),
    h(
      Note,
      {},
      names.length ? chips(names) : line(str(p.e, 'doc', 'body')),
    ),
    counted(p.ctx),
  )
}

let ArchetypeTile = (p: Props) =>
  tile(
    p,
    h(Title, {}, h(Note, {}, chips(tables(p.e)))),
    counted(p.ctx),
  )

let TxTile = (p: Props) => {
  let tx = comp(p.e, '_tx')
  let who = str(p.e, '_tx', 'by')
  let via = str(p.e, '_tx', 'via')
  return tile(
    p,
    h(Id, {}, `#${tx.seq ?? ''}`),
    h(Kind, {}, tx.at ? p.io.when(String(tx.at)) : ''),
    h(Title, {}, who ? p.io.name(who) : 'someone'),
    h(
      Note,
      {},
      [via && via != who ? `via ${p.io.name(via)}` : '', line(tx.note)]
        .filter(Boolean).join(' · '),
    ),
  )
}

let ChangeTile = (p: Props) => {
  let c = comp(p.e, '_change')
  let name = p.io.name(String(c.comp ?? ''))
  return tile(
    p,
    h(Kind, {}, chip(name)),
    h(Title, {}, p.io.name(String(c.target ?? ''))),
    h(
      Note,
      {},
      'value' in c && c.value != null ? line(face(c.value)) : 'removed',
    ),
  )
}

let AnyTile = (p: Props) =>
  tile(
    p,
    h(Id, {}, p.io.id(p.e)),
    h(Kind, {}, p.io.kind(p.e)),
    h(Title, {}, str(p.e, 'doc', 'title')),
    counted(p.ctx),
  )

/** A tile for each kind the inspector knows, and one for anything. */
export let tiles: View[] = [
  { view: 'Inspect.Tile', match: parse('._comp'), Render: CompTile },
  { view: 'Inspect.Tile', match: parse('._prop'), Render: PropTile },
  { view: 'Inspect.Tile', match: parse('._package'), Render: PackageTile },
  { view: 'Inspect.Tile', match: parse('.archetype'), Render: ArchetypeTile },
  { view: 'Inspect.Tile', match: parse('._tx'), Render: TxTile },
  { view: 'Inspect.Tile', match: parse('._change'), Render: ChangeTile },
  { view: 'Inspect.Tile', match: true, Render: AnyTile },
]
