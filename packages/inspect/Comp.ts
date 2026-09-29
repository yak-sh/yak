/**
 * The sections of a component's page (`_comp`, @yaks/vocab): what it is and
 * which package declares it, its properties, what it refers to and what
 * refers to it, the archetypes it occurs in, and the entities carrying it.
 *
 * @module
 */

import { h } from 'preact'
import { parse } from '@yaks/query'
import { Pairs } from '@yaks/ui'
import type { Bundle, Props, View } from './host.ts'
import { CENSUS } from './List.ts'
import { section } from './page.ts'
import { comp, str, tables } from './read.ts'
import { listed, rows, waiting } from './rows.ts'
import { chip } from './Tile.ts'

let { Key, Value } = Pairs

/** A component's name, off its `_comp` bundle. */
export let nameOf = (e: Bundle): string => str(e, '_comp', 'name')

// Its properties, in declared order.
let props = (e: Bundle) => `._prop&._prop.comp=${e.entity.eid}&.order=_prop.ord`

/** What a component is: its description, its package, and how it is kept. */
let about = section({
  view: 'Inspect.About',
  match: parse('._comp'),
  title: 'About',
  Body: ({ e, io }: Props) => {
    let c = comp(e, '_comp')
    let pkg = str(e, '_comp', 'package')
    let facts = ['kind', 'wire', 'computed', 'bare'].filter((k) =>
      c[k] === true
    )
    let kept = [c.sync && `sync ${c.sync}`, c.durable && `durable ${c.durable}`]
      .filter(Boolean)
    return h(
      Pairs,
      {},
      h(Key, {}, 'package'),
      h(Value, {}, pkg ? h('a', { href: io.link(pkg) }, io.name(pkg)) : '—'),
      h(Key, {}, 'is'),
      h(Value, {}, [...facts, ...kept].join(' · ') || '—'),
      h(Key, {}, 'about'),
      h(Value, {}, str(e, 'doc', 'body') || '—'),
    )
  },
})

/** Its properties, a tile each. */
let properties = section({
  view: 'Inspect.Props',
  match: parse('._comp'),
  title: 'Properties',
  asks: (e) => ({ props: props(e) }),
  count: ({ got }) => got.props?.ready ? rows(got.props).length : undefined,
  Body: ({ io, got }: Props) =>
    waiting(got.props) ??
      listed(io, rows(got.props).map((b) => io.show(b, 'Inspect.Tile'))),
})

// A property as `comp.prop`, off its `_prop` bundle.
let address = (b: Bundle) => str(b, 'doc', 'title') || str(b, '_prop', 'name')

/** What it refers to, through its properties, and which properties refer to
 * it. */
let refers = section({
  view: 'Inspect.Refers',
  match: parse('._comp'),
  title: 'References',
  asks: (e) => ({
    props: props(e),
    into: `._prop&._prop.ref=${nameOf(e)}`,
  }),
  Body: ({ io, got }: Props) => {
    let out = rows(got.props).filter((b) => str(b, '_prop', 'ref'))
    let into = rows(got.into)
    return waiting(got.props) ?? waiting(got.into) ?? h(
      Pairs,
      {},
      out.flatMap((b) => [
        h(
          Key,
          { key: `k ${b.entity.eid}` },
          h('a', { href: io.link(b.entity.eid) }, address(b)),
        ),
        h(
          Value,
          { key: `v ${b.entity.eid}` },
          '→ ',
          chip(str(b, '_prop', 'ref')),
        ),
      ]),
      into.flatMap((b) => [
        h(
          Key,
          { key: `k ${b.entity.eid}` },
          h('a', { href: io.link(b.entity.eid) }, address(b)),
        ),
        h(Value, { key: `v ${b.entity.eid}` }, '→ this'),
      ]),
      !out.length && !into.length
        ? [h(Key, { key: 'none' }, 'none'), h(Value, { key: 'nv' })]
        : null,
    )
  },
})

/** How many archetypes a component's page lists. */
export let ARCHETYPES = 30

/** The sets of components it occurs in, by how many entities are made of
 * each. The census that counts them reads every entity, so it is asked once
 * (README, Limits). */
let archetypes = section({
  view: 'Inspect.Archetypes',
  match: parse('._comp'),
  title: 'Archetypes',
  asks: () => ({
    sets: CENSUS.sets,
    tally: { query: CENSUS.tally, once: true },
  }),
  count: ({ e, got }) =>
    got.sets?.ready
      ? rows(got.sets).filter((s) => tables(s).includes(nameOf(e))).length
      : undefined,
  Body: ({ e, io, got }: Props) => {
    let tally = got.tally?.tally ?? {}
    let mine = rows(got.sets).filter((s) => tables(s).includes(nameOf(e)))
      .toSorted((a, b) =>
        (tally[b.entity.eid] ?? 0) - (tally[a.entity.eid] ?? 0)
      )
    return waiting(got.sets) ??
      listed(
        io,
        mine.slice(0, ARCHETYPES).map((b) =>
          io.show(b, 'Inspect.Tile', { count: tally[b.entity.eid] })
        ),
        mine.length,
      )
  },
})

/** How many carriers a component's page lists. */
export let CARRIERS = 20

/** Some of the entities carrying it, and how many do. */
let carriers = section({
  view: 'Inspect.Carriers',
  match: parse('._comp'),
  title: 'Carried by',
  asks: (e) => ({
    rows: `.${nameOf(e)}&.limit=${CARRIERS}`,
    total: `.${nameOf(e)}&.count`,
  }),
  count: ({ got }) => got.total?.count,
  note: ({ e, io }) =>
    h('a', { href: io.find(`.${nameOf(e)}`) }, `.${nameOf(e)}`),
  Body: ({ e, io, got }: Props) =>
    waiting(got.rows) ??
      listed(
        io,
        rows(got.rows).map((b) => io.show(b, 'Inspect.Tile')),
        got.total?.count,
        `.${nameOf(e)}`,
      ),
})

/** A component's sections. */
export let compViews: View[] = [about, properties, refers, archetypes, carriers]
