// The graph pane: every entity in the page's graph as it stands, grouped by
// kind, and every write as it lands, told by the graph's own `effect` phase
// (yak.js `watch`). A row that is new or moved glows as it changes. The
// tools, calls and results the command line writes are counted rather than
// listed, since every line typed writes a call and its result and moves the
// call as it runs; the writes name a call once, as it is made.

// The stamps every write leaves, which say nothing about what it changed.
let STAMPS = ['created', 'updated']

// The components an edge carries besides its relation.
let EDGE = new Set(['entity', 'edge', ...STAMPS])

let MARK = { open: '○', done: '●', cancelled: '×' }

// What a row says about one entity, given how to name the others.
let rows = {
  task: (b, y, name) =>
    `${MARK[y.status(b)] ?? '?'} ${b.doc?.title ?? ''}` +
    (b.claim?.session ? `  [${name(b.claim.session)}]` : ''),
  edge: (b, _y, name) =>
    `${name(b.edge?.from)} ${Object.keys(b).find((k) => !EDGE.has(k)) ?? '→'} ${
      name(b.edge?.to)
    }`,
  session: (b) =>
    /^[0-9a-f-]{36}$/.test(b.entity.eid) ? 'session' : b.entity.eid,
  conflict: (b, _y, name) =>
    `${name(b.conflict?.loser)} lost ${name(b.conflict?.target)} to ${
      name(b.conflict?.holder)
    }`,
  entry: (b, _y, name) =>
    `${name(b.entry?.session)} "${String(b.content?.body ?? '').slice(0, 40)}"`,
}

let GROUPS = [
  ['tasks', ['task']],
  ['edges', ['edge']],
  ['sessions', ['session', 'entry']],
  ['conflicts', ['conflict']],
]

let COUNTED = ['tool', 'call', 'result', 'error', 'exception']

let el = (tag, cls, text) => {
  let node = document.createElement(tag)
  if (cls) node.className = cls
  if (text != null) node.textContent = text
  return node
}

/** Draw the graph pane in `body` (its count in `count`) from yak `y`, and
 * keep it drawn as the graph changes. */
export let graphPane = (body, count, y) => {
  let before = new Map()
  let feed = el('div', 'Graph_Writes')
  let listing = el('div', 'Graph_List')
  body.replaceChildren(listing, el('div', 'Graph_Label', 'writes'), feed)

  let draw = (moved = new Set()) => {
    let all = y.everything()
    let by = new Map(all.map((b) => [b.entity.eid, b]))
    let name = (eid) => {
      let b = by.get(eid)
      return b ? y.id(b) : eid ? y.short(eid) : '?'
    }
    let counted = Object.fromEntries(COUNTED.map((c) => [c, 0]))
    let kinds = new Map()
    for (let b of all) {
      let c = COUNTED.find((c) => b[c])
      if (c) {
        counted[c]++
        continue
      }
      let k = y.kind(b)
      kinds.set(k, [...kinds.get(k) ?? [], b])
    }
    let row = (b, k) => {
      let r = el('div', 'Graph_Row')
      if (moved.has(b.entity.eid)) {
        r.classList.add(before.has(b.entity.eid) ? 'is-moved' : 'is-new')
      }
      r.append(
        el('span', 'Graph_Id', y.id(b)),
        el('span', 'Graph_Text', (rows[k] ?? (() => k))(b, y, name)),
      )
      return r
    }
    let shown = new Set(GROUPS.flatMap(([, ks]) => ks))
    let groups = [
      ...GROUPS,
      ['other', [...kinds.keys()].filter((k) => !shown.has(k))],
    ].flatMap(([title, ks]) => {
      let items = ks.flatMap((k) => (kinds.get(k) ?? []).map((b) => [b, k]))
      if (!items.length) return []
      let group = el('div', 'Graph_Group')
      group.append(
        el('div', 'Graph_Head', `${title} ${items.length}`),
        ...items.map(([b, k]) => row(b, k)),
      )
      return [group]
    })
    listing.replaceChildren(
      ...groups,
      el(
        'div',
        'Graph_Sum',
        `${counted.tool} tools · ${counted.call} calls · ` +
          `${counted.result + counted.error + counted.exception} results`,
      ),
    )
    count.textContent = `${all.length} entities`
    before = new Map(all.map((b) => [b.entity.eid, JSON.stringify(b)]))
    return { name, by }
  }

  // One line per entity a write touched, + new, ~ changed, − gone, naming
  // the components it wrote; a call once, as it is made, and its runs and
  // results not at all.
  let told = ({ applied, refused }, name, by, was) => {
    let line = (b) => {
      let eid = b.entity.eid
      let now = by.get(eid) ?? b
      let fresh = !was.has(eid)
      if (now.call) {
        return fresh && b.call
          ? [
            el('div', 'Fresh', `» call ${by.get(b.call.to)?.tool?.name ?? ''}`),
          ]
          : []
      }
      if (COUNTED.some((c) => now[c])) return []
      let sign = b.tombstone ? '−' : fresh ? '+' : '~'
      let comps = Object.keys(b).filter((k) =>
        !['entity', 'tombstone', ...STAMPS].includes(k) && !k.startsWith('$')
      )
      return comps.length || b.tombstone
        ? [el('div', 'Fresh', `${sign} ${name(eid)} ${comps.join(' ')}`)]
        : []
    }
    let lines = refused
      ? [el('div', 'Graph_Refused', `✗ refused: ${refused.message ?? refused}`)]
      : applied.flatMap(line)
    feed.append(...lines)
    while (feed.childElementCount > 40) feed.firstElementChild.remove()
  }

  let seen = (said) => {
    let was = before
    let moved = new Set((said.applied ?? []).map((b) => b.entity.eid))
    let { name, by } = draw(moved)
    told(said, name, by, was)
  }

  let { name, by } = draw()
  told({ applied: y.seeded ?? [] }, name, by, new Map())
  return y.watch(seen)
}
