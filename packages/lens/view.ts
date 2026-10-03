import { type Bundle, type Comp, Stale, token } from '@yaks/graph'
import { matcher } from '@yaks/match'
import { parse } from '@yaks/query'
import type { PropSchema, Vocab } from '@yaks/vocab'

/** A scalar view has one canonical path, a retired default, or a referenced mark. */
export type ViewProp =
  | { path: string; convert?: 'milliseconds' }
  | { retired: unknown }
  | { ack: { component: string; ref: string; mark: string; order: string } }
export type ComponentView = {
  from: string
  declaration: PropSchema
  match: string
  props: Record<string, ViewProp>
}
/** Facts are supplied by the graph boundary; compiled translations perform no I/O. */
export type Facts = {
  facts?: Bundle[]
  vocab?: Vocab
  now?: number
  patch?: boolean
  migrate?: boolean
  canonical?: boolean
}
let comp = (b: Bundle | undefined, c: string) => b?.[c] as Comp | undefined
let value = (b: Bundle | undefined, path: string) => {
  let [c, p] = path.split('.')
  return comp(b, c)?.[p]
}
function fail(message: string): never {
  throw new Error(`Lens: ${message}`)
}
let scalar = (
  v: unknown,
  mapping: Extract<ViewProp, { path: string }>,
  inverse = false,
) => {
  if (v == null || !mapping.convert) return v
  if (inverse) {
    if (typeof v != 'number' || !Number.isFinite(v)) {
      fail('expected milliseconds')
    }
    return new Date(v).toISOString()
  }
  if (typeof v != 'string' || !Number.isFinite(Date.parse(v))) {
    fail('expected date-time')
  }
  return Date.parse(v)
}
let marked = (
  prop: Extract<ViewProp, { ack: object }>,
  eid: string,
  facts: Bundle[],
) =>
  facts.filter((r) =>
    comp(r, prop.ack.component)?.[prop.ack.ref] == eid && !!r[prop.ack.mark]
  )
    .toSorted((a, b) =>
      String(value(b, prop.ack.order) ?? '').localeCompare(
        String(value(a, prop.ack.order) ?? ''),
      ) || b.entity.eid.localeCompare(a.entity.eid)
    )

export let viewSources = (view: ComponentView): string[] => [view.from]
export let viewDependencies = (view: ComponentView): string[] => [
  ...new Set([
    ...parse(view.match).clauses.flatMap((c) =>
      'path' in c ? c.path.slice(0, 1) : []
    ),
    ...Object.values(view.props).flatMap((p) =>
      'path' in p
        ? [p.path.split('.')[0]]
        : 'ack' in p
        ? [p.ack.component, p.ack.mark, p.ack.order.split('.')[0]]
        : []
    ),
  ]),
]
export let validateView = (v: ComponentView): void => {
  if (
    !v || !/^[A-Za-z_]\w*$/.test(v.from) || !v.declaration?.properties ||
    !v.match || !v.props
  ) fail('invalid component view')
  parse(v.match)
  for (let [name, p] of Object.entries(v.props)) {
    if (!v.declaration.properties[name]) {
      fail(`undeclared view property ${v.from}.${name}`)
    }
    if ('path' in p) {
      if (!/^\w+\.\w+$/.test(p.path) || p.path.split('.')[0] == v.from) {
        fail('view path must name a canonical comp.prop')
      }
      if (p.convert && p.convert != 'milliseconds') {
        fail('unknown scalar conversion')
      }
    } else if ('ack' in p) {
      if (
        !p.ack.component || !p.ack.ref || !p.ack.mark ||
        !/^\w+\.\w+$/.test(p.ack.order)
      ) fail('invalid acknowledgement relation')
    } else if (!('retired' in p)) fail('unknown view property mapping')
  }
  for (let name of Object.keys(v.declaration.properties)) {
    if (!v.props[name]) fail(`unmapped view property ${v.from}.${name}`)
  }
}

export let getViews = (
  rows: Bundle[],
  views: ComponentView[],
  ctx: Facts = {},
): Bundle[] => {
  if (!views.length) return rows
  let facts = ctx.facts ?? rows
  let at = new Map(facts.map((r) => [r.entity.eid, r]))
  let out = rows
  for (let v of views.toReversed()) {
    if (!ctx.vocab) fail('component views need the canonical vocabulary')
    let belongs = matcher(parse(v.match), ctx.vocab, { now: ctx.now })
    out = out.map((row) => {
      let held = at.get(row.entity.eid)
      let whole = ctx.patch ? merge(held, row) : row
      if (whole[v.from]) {
        // Expansion leaves source rows readable until the rehearsed mover
        // contracts them. The same pure move reconstructs them without writes.
        let moved = putViews([whole], [v], {
          ...ctx,
          facts: [
            whole,
            ...facts.filter((r) => r.entity.eid != whole.entity.eid),
          ],
          migrate: true,
        })
        whole = merge(whole, moved[0])
        let restored = new Map(facts.map((r) => [r.entity.eid, r]))
        for (let patch of moved.slice(1)) {
          restored.set(
            patch.entity.eid,
            merge(restored.get(patch.entity.eid), patch),
          )
        }
        facts = [...restored.values()]
      }
      let { [v.from]: _, ...canonical } = row
      if (!belongs([whole]).length) {
        let removed = row[v.from] === null ||
          Object.values(v.props).some((p) =>
            'path' in p && row[p.path.split('.')[0]] === null
          )
        return ctx.patch && (removed || held && belongs([held]).length)
          ? { ...canonical, [v.from]: null } as Bundle
          : canonical as Bundle
      }
      let props: Comp = {}
      for (let [name, p] of Object.entries(v.props)) {
        if ('path' in p) {
          let got = scalar(value(whole, p.path), p, true)
          if (got !== undefined) props[name] = got
        } else if ('retired' in p) props[name] = p.retired
        else {props[name] = marked(p, row.entity.eid, facts)[0]?.entity.eid ??
            null}
      }
      return { ...canonical, [v.from]: props } as Bundle
    })
    // A request mark patch changes its addressed source view too.
    if (ctx.patch) {
      let have = new Set(out.map((r) => r.entity.eid))
      for (let p of Object.values(v.props)) {
        if (!('ack' in p)) continue
        for (let row of rows) {
          if (!(p.ack.mark in row) && !(p.ack.component in row)) continue
          let eid = comp(row, p.ack.component)?.[p.ack.ref] ??
            comp(at.get(row.entity.eid), p.ack.component)?.[p.ack.ref]
          if (typeof eid != 'string' || have.has(eid)) continue
          let source = at.get(eid)
          if (!source || !belongs([source]).length) continue
          let virtual = getViews([source], [v], { ...ctx, patch: false })[0]
          out.push({ entity: source.entity, [v.from]: virtual[v.from] })
          have.add(eid)
        }
      }
    }
  }
  return out
}
let merge = (held: Bundle | undefined, patch: Bundle): Bundle => {
  let out = { ...held, ...patch } as Bundle
  for (let [c, p] of Object.entries(patch)) {
    if (p === null) delete out[c]
    else if (c != 'entity' && !c.startsWith('$') && p && typeof p == 'object') {
      out[c] = { ...comp(held, c), ...p }
    }
  }
  return out
}

/** Whole-change translation allows an old property to write a referenced entity.
 * Every generated patch retains the source actor and canonical preconditions. */
export let putViews = (
  rows: Bundle[],
  views: ComponentView[],
  ctx: Facts = {},
): Bundle[] => {
  let out = rows
  let facts = ctx.facts ?? []
  let at = new Map(facts.map((r) => [r.entity.eid, r]))
  for (let v of views) {
    out = out.flatMap((row) => {
      let source = row[v.from] as Comp | null | undefined
      let guarded = row.$was?.[v.from]
      if (source === undefined && !guarded) return [row]
      let { [v.from]: _, ...rest } = row
      let patch = rest as Bundle
      let was = { ...row.$was }
      delete was[v.from]
      if (row.$was) patch.$was = was
      let extra: Bundle[] = []
      let held = at.get(row.entity.eid)
      let old = guarded
        ? getViews(held ? [held] : [], [v], { ...ctx, patch: false })[0]
        : undefined
      for (let [name, p] of Object.entries(v.props)) {
        if (guarded && Object.hasOwn(guarded, name)) {
          let current = comp(old, v.from)?.[name] ?? null
          if (token(current) != guarded[name]) {
            throw new Stale(row.entity.eid, v.from, name, current)
          }
          if ('path' in p) {
            let [c, prop] = p.path.split('.')
            patch.$was = {
              ...patch.$was,
              [c]: { ...patch.$was?.[c], [prop]: token(value(held, p.path)) },
            }
          }
        }
        if (
          source === undefined ||
          source !== null && !Object.hasOwn(source, name)
        ) continue
        let got = source === null ? null : source[name]
        if ('retired' in p) continue
        if ('path' in p) {
          let [c, prop] = p.path.split('.')
          if (ctx.migrate) {
            let clock = Object.values(v.props).find((p) =>
              'path' in p && p.convert == 'milliseconds'
            )
            if (clock && 'path' in clock) {
              let oldTimeName = Object.keys(v.props).find((k) =>
                v.props[k] === clock
              )!
              if (
                value(held, clock.path) != null &&
                Number(value(held, clock.path)) >=
                  Number(scalar(source?.[oldTimeName], clock))
              ) continue
            }
          }
          let current = comp(patch, c)
          let next = scalar(got, p)
          if (
            !ctx.migrate && current && Object.hasOwn(current, prop) &&
            JSON.stringify(current[prop]) != JSON.stringify(next)
          ) fail(`conflicting writes to ${v.from}.${name} and ${p.path}`)
          patch[c] = { ...current, [prop]: next }
          continue
        }
        if (ctx.migrate && got == null) continue
        let targets = got === null
          ? marked(p, row.entity.eid, facts)
          : [at.get(String(got))]
        if (
          got !== null &&
          (!targets[0] ||
            comp(targets[0], p.ack.component)?.[p.ack.ref] != row.entity.eid)
        ) fail('acknowledgement must address its source entity')
        for (let target of targets) {
          if (!target || ctx.migrate && target[p.ack.mark]) continue
          let mark: Comp | null = got === null ? null : {}
          if (ctx.migrate && mark) {
            let atProp = Object.entries(v.props).find(([, mapping]) =>
              'path' in mapping && mapping.convert == 'milliseconds'
            )?.[0]
            mark = {
              ...comp(held, 'created'),
              ...comp(held, 'updated'),
              ...(atProp && source?.[atProp] ? { at: source[atProp] } : {}),
            }
          }
          extra.push({
            entity: target.entity,
            [p.ack.mark]: mark,
            ...(row.$actor ? { $actor: row.$actor } : {}),
            $was: {
              [p.ack.component]: { [p.ack.ref]: token(row.entity.eid) },
              [p.ack.mark]: Object.fromEntries(
                ['at', 'by', 'via'].map((
                  k,
                ) => [k, token(comp(target, p.ack.mark)?.[k])]),
              ),
            },
          })
        }
      }
      if (source === null) {
        for (let p of Object.values(v.props)) {
          if ('path' in p) patch[p.path.split('.')[0]] = null
        }
      }
      if (source) {
        for (let name of Object.keys(source)) {
          if (!v.props[name]) fail(`unknown view property ${v.from}.${name}`)
        }
      }
      return [patch, ...extra]
    })
  }
  return out
}

/** A normal write consumes any pending source it depends on. Partial writes
 * first carry the whole canonical fact across; clearing a view cannot revive
 * the old stored value on the next read. The shell preserves generated historic
 * stamps after admission, never stamps supplied by the caller. */
export let stageViews = (
  rows: Bundle[],
  views: ComponentView[],
  ctx: Facts = {},
): Bundle[] => {
  let translated = ctx.canonical ? rows : putViews(rows, views, ctx)
  if (
    ctx.migrate || !ctx.vocab || !views.some((v) => ctx.vocab!.comp(v.from))
  ) return translated
  let facts = ctx.facts ?? []
  let at = new Map(facts.map((r) => [r.entity.eid, r]))
  let bases: Bundle[] = []
  for (let v of views) {
    if (!ctx.vocab.comp(v.from)) continue
    for (let held of facts) {
      if (!held[v.from]) continue
      let incoming = rows.find((r) =>
        r.entity.eid == held.entity.eid &&
        (v.from in r || Object.values(v.props).some((p) =>
          'path' in p && p.path.split('.')[0] in r
        ))
      )
      let related = rows.find((r) =>
        Object.values(v.props).some((p) =>
          'ack' in p && p.ack.mark in r &&
          (at.get(r.entity.eid)?.[p.ack.component] as Comp | undefined)
              ?.[p.ack.ref] == held.entity.eid
        )
      )
      let writer = incoming ?? related
      if (!writer) continue
      let source = { ...comp(held, v.from) }
      // A clear means the legacy acknowledgement is deliberately forgotten.
      for (let [name, p] of Object.entries(v.props)) {
        if (
          'ack' in p &&
          (incoming?.[v.from] === null ||
            comp(incoming, v.from)?.[name] === null ||
            related?.[p.ack.mark] === null &&
              source[name] == related.entity.eid)
        ) delete source[name]
      }
      let moved = putViews([{ ...held, [v.from]: source }], [v], {
        ...ctx,
        migrate: true,
      })
      let base = moved[0]
      base[v.from] = null
      base.$actor = writer.$actor
      base.$was = {
        [v.from]: Object.fromEntries(
          Object.keys(v.declaration.properties ?? {}).map((
            p,
          ) => [p, token(comp(held, v.from)?.[p])]),
        ),
      }
      for (let p of Object.values(v.props)) {
        if ('path' in p) {
          let [c, name] = p.path.split('.')
          base.$was[c] = {
            ...base.$was[c],
            [name]: token(comp(held, c)?.[name]),
          }
        }
      }
      bases.push(base)
      for (let mark of moved.slice(1)) {
        let mapping = Object.values(v.props).find((p) =>
          'ack' in p && p.ack.mark in mark
        ) as Extract<ViewProp, { ack: object }>
        bases.push({
          ...mark,
          [mapping.ack.mark]: {},
          $actor: writer.$actor,
          $lensKeep: {
            component: mapping.ack.mark,
            value: mark[mapping.ack.mark],
          },
        })
      }
    }
  }
  if (!bases.length) return translated
  let out = new Map<string, Bundle>()
  let merge = (b: Bundle) => {
    let held = out.get(b.entity.eid)
    if (!held) {
      out.set(b.entity.eid, b)
      return
    }
    let next = { ...held, ...b }
    for (let [c, props] of Object.entries(b)) {
      if (
        c != 'entity' && props && typeof props == 'object' && !c.startsWith('$')
      ) next[c] = { ...held[c] as object, ...props }
    }
    if (held.$was || b.$was) {
      next.$was = { ...held.$was }
      for (let [c, props] of Object.entries(b.$was ?? {})) {
        next.$was[c] = { ...next.$was[c], ...props }
      }
    }
    // Repeating an acknowledgement already represented by the source keeps
    // its historical stamps; an explicit clear still clears it.
    let historic = held.$lensKeep as
      | { component: string; value: Comp }
      | undefined
    if (historic && b[historic.component] !== null) {
      next[historic.component] = {}
    }
    if (historic && b[historic.component] === null) delete next.$lensKeep
    out.set(b.entity.eid, next)
  }
  for (let b of [...bases, ...translated]) merge(b)
  return [...out.values()]
}
