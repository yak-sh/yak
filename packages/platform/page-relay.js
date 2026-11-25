import { comps } from '@yaks/graph/bundle'
import { isAlias, mint, substitute } from '@yaks/graph/identity'

// Preserve the original page write for bundles that have no relay component.
// If both transports write the same new entity, the store still picks its id.
export let split = (bundles, defs) => {
  let stored = [], relay = [], unnamed = new Set()
  for (let bundle of bundles) {
    let peer = Object.keys(bundle ?? {}).filter((name) =>
      defs[name]?.sync == 'peers'
    )
    if (!peer.length) {
      stored.push(bundle)
      continue
    }
    let eid = bundle.entity?.eid
    if (eid == null) {
      eid = `$${mint()}`
      unnamed.add(eid)
    }
    let keep = { ...bundle, entity: { ...bundle.entity, eid } }
    let say = { entity: { eid } }
    for (let name of peer) {
      say[name] = keep[name]
      delete keep[name]
    }
    relay.push(say)
    if (keep.$delete || keep.tombstone || comps(keep).length) stored.push(keep)
  }
  return { stored, relay, unnamed }
}

export let relayed = (relay, receipt, unnamed, vocab) => {
  let at = new Map(Object.entries(receipt.aliases))
  for (let { entity: { eid } } of relay) {
    if (isAlias(eid) && !at.has(eid)) at.set(eid, mint())
  }
  let sent = substitute(relay, vocab, at)
  let aliases = Object.fromEntries([...at].filter(([id]) => !unnamed.has(id)))
  let rows = new Map(receipt.bundles.map(({ $alias, ...row }) => [
    row.entity.eid,
    unnamed.has($alias) || $alias === undefined ? row : { ...row, $alias },
  ]))
  for (let [i, b] of sent.entries()) {
    let was = rows.get(b.entity.eid)
    let alias = relay[i].entity.eid
    let row = { ...was, entity: was?.entity ?? b.entity }
    if (!row.$alias && Object.hasOwn(aliases, alias)) row.$alias = alias
    for (let [name, patch] of comps(b)) {
      row[name] = patch == null ? null : { ...row[name], ...patch }
    }
    rows.set(b.entity.eid, row)
  }
  return { sent, answer: { ...receipt, aliases, bundles: [...rows.values()] } }
}

// Membership and projection come from the server. A relay is a component
// patch, with null clearing a component or a property of it.
export let landRelay = (sub, bundle) => {
  let eid = bundle.entity.eid
  let row = sub.rows.get(eid)
  if (!row) return false
  let scope = sub.coverage.get(eid)
  let held = sub.relays.get(eid) ?? {}
  let next = { ...held }
  for (let [name, value] of comps(bundle)) {
    let fields = scope === true || !scope ? true : scope[name]
    if (!fields) continue
    if (value == null) {
      next[name] = null
      continue
    }
    let before = name in next ? next[name] : row[name]
    let patch = fields === true ? value : Object.fromEntries(
      Object.entries(value).filter(([prop]) => fields.includes(prop)),
    )
    if (fields !== true && fields.length && !Object.keys(patch).length) continue
    let merged = { ...before, ...patch }
    for (let prop of Object.keys(merged)) {
      if (merged[prop] == null) delete merged[prop]
    }
    next[name] = fields !== true && fields.length && !Object.keys(merged).length
      ? null
      : merged
  }
  if (!Object.keys(next).length) return false
  sub.relays.set(eid, next)
  return Object.keys(next).some((name) => next[name] !== held[name])
}

export let withRelay = (row, held) => {
  if (!held) return row
  let out = { ...row, ...held }
  for (let [name, value] of Object.entries(held)) {
    if (value == null) delete out[name]
  }
  return out
}
