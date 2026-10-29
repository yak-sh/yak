// The logs drawn as hypercores: a column per actor, its blocks stacked top to
// bottom by index. A block sits on the first row below everything it depends
// on, so time runs down the page and every dep line points up to what it had
// seen. Beside each column stands its Merkle tree in flat-tree order, each
// parent halfway between its children, and under the last block the seal: the
// hash over the tree's roots that its actor signed.
import { describe } from './describe.js'
import { roots } from './tree.js'

export let BW = 156, BH = 44, ROW = 60, TOP = 20, GAP = 44, PAD = 28, STEP = 14

let esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/// short('5Hq2wQd9xYz') -> '5Hq2wQ'
export let short = (id) => String(id).slice(0, 6)

/// depth(1) -> 0
/// depth(4) -> 2
/// depth(5) -> 2
/** How many levels of parents a tree over `n` blocks has. */
export let depth = (n) => n > 1 ? Math.floor(Math.log2(n)) : 0

/// let c = (actor, seq, deps = {}) => ({ actor, seq, deps })
/// [...rows([c('a', 1), c('a', 2), c('b', 1, { a: 1 }), c('a', 3, { b: 1 })]).values()] -> [0, 1, 1, 2]
/// [...rows([c('b', 1, { a: 9 })]).values()] -> [0]
/**
 * Each change's row, by `actor:seq`: one below the lowest of its own previous
 * change and its deps, so concurrent changes share a row. A dep not among
 * `changes` places nothing.
 */
export let rows = (changes) => {
  let by = new Map(changes.map((c) => [`${c.actor}:${c.seq}`, c]))
  let at = new Map()
  let row = (k) => {
    if (at.has(k)) return at.get(k)
    let c = by.get(k)
    if (!c) return -1
    at.set(k, 0)
    let r = 1 + Math.max(
      row(`${c.actor}:${c.seq - 1}`),
      ...Object.entries(c.deps ?? {}).map(([a, s]) => row(`${a}:${s}`)),
    )
    at.set(k, r)
    return r
  }
  for (let k of by.keys()) row(k)
  return at
}

/** Where each column stands: its left edge and width, the tree beside it. */
export let columns = (lanes, checks) => {
  let x = PAD
  return lanes.map((lane, i) => {
    let w = BW + 26 + Math.max(depth(checks[i].trusted.length), 1) * STEP
    let col = { x, w, lane, check: checks[i] }
    x += w + GAP
    return col
  })
}

/**
 * The column heads, as HTML laid out to the columns' widths. `looks` maps an
 * actor to its {name, color}; `mine` holds the actors this browser writes as.
 */
export let heads = ({ doc, lanes, checks, looks, mine }) =>
  columns(lanes, checks).map(({ w, lane, check }) => {
    let { name, color } = looks(lane.actor), n = check.trusted.length
    let badges = [
      lane.actor == doc &&
      '<span class="Badge" title="The first actor: its key is the doc’s id">root · doc id</span>',
      mine.has(lane.actor) && '<span class="Badge Badge-you">you</span>',
    ].filter(Boolean).join('')
    return `<div class="Head" style="width:${w}px;--c:${color}">
      <div class="Head_name"><i></i>${esc(name)}${badges}</div>
      <div class="Head_key"><code title="${esc(lane.actor)}">${
      esc(short(lane.actor))
    }…</code> · ${n} block${n == 1 ? '' : 's'}</div>
    </div>`
  }).join('')

/**
 * The SVG of every log. `held` lists each offline editor's unshared rows by
 * actor, `selected` is the eid drawn as chosen, `phase` maps an eid to
 * applied, waiting or pending while a replay is shown, and `seen` holds the
 * eids drawn before, so only a block new to the page arrives animated.
 */
export let logs = (
  { lanes, checks, looks, held = {}, selected, phase, seen = new Set() },
) => {
  let cols = columns(lanes, checks)
  let shown = cols.map(({ lane, check }) => [
    ...check.trusted.map((b) => ({ ...b, state: 'ok' })),
    ...(held[lane.actor] ?? []).map((r) => ({
      ...r.block,
      eid: r.entity.eid,
      state: 'held',
    })),
  ])
  let at = rows(shown.flat().map((b) => b.change))
  let y = (b) => TOP + (at.get(`${b.change.actor}:${b.change.seq}`) ?? 0) * ROW
  let place = new Map(), spines = [], trees = [], blocks = [], deps = []
  let bottom = TOP
  cols.forEach(({ x, lane, check }, i) => {
    let { color } = looks(lane.actor), list = shown[i]
    for (let b of list) {
      place.set(`${lane.actor}:${b.change.seq}`, { x, y: y(b) })
    }
    if (list.length > 1) {
      spines.push(
        `<line class="Spine" style="--c:${color}" x1="${x + BW / 2}" x2="${
          x + BW / 2
        }" y1="${y(list[0]) + BH / 2}" y2="${y(list.at(-1)) + BH / 2}"/>`,
      )
    }
    for (let b of list) {
      let p = phase?.get(b.eid), fresh = !seen.has(b.eid)
      let cls = [
        'Block',
        `Block-${b.state}`,
        p && `Block-${p}`,
        b.eid == selected && 'Block-selected',
        fresh && 'Block-new',
      ].filter(Boolean).join(' ')
      let what = describe(b.change)
      blocks.push(
        `<g class="${cls}" data-eid="${
          esc(b.eid)
        }" tabindex="0" role="button" aria-label="${
          esc(what)
        }" style="--c:${color}" transform="translate(${x},${
          y(b)
        })"><g class="Block_in"><rect width="${BW}" height="${BH}" rx="10"/>` +
          `<rect class="Block_edge" width="4" height="${
            BH - 16
          }" x="0" y="8" rx="2"/>` +
          `<text x="14" y="19" class="Block_what">${
            esc(what.length > 21 ? what.slice(0, 20) + '…' : what)
          }</text>` +
          `<text x="14" y="34" class="Block_meta">block ${b.index} · change ${b.change.seq}${
            b.state == 'held' ? ' · not shared' : ''
          }</text><title>${esc(what)}</title></g></g>`,
      )
    }
    let last = list.at(-1)
    if (last) bottom = Math.max(bottom, y(last) + BH)

    // The tree over the trusted blocks: leaves at the blocks' right edges,
    // each parent at the middle of its two children.
    let n = check.trusted.length
    if (!n) return
    let pos = new Map()
    for (let node of check.nodes) {
      if (!node.depth) {
        let b = check.trusted[node.index / 2]
        pos.set(node.index, { x: x + BW, y: y(b) + BH / 2 })
        continue
      }
      let half = 2 ** (node.depth - 1)
      let [a, z] = [pos.get(node.index - half), pos.get(node.index + half)]
      let p = { x: x + BW + 14 + node.depth * STEP, y: (a.y + z.y) / 2 }
      pos.set(node.index, p)
      for (let c of [a, z]) {
        trees.push(
          `<path class="Tree_edge" d="M${p.x},${p.y} C${p.x - 8},${p.y} ${
            c.x + 8
          },${c.y} ${c.x},${c.y}"/>`,
        )
      }
      trees.push(`<circle class="Tree_node" cx="${p.x}" cy="${p.y}" r="3.2"/>`)
    }
    let sealY = y(list.at(-1)) + BH + 26
    bottom = Math.max(bottom, sealY + 30)
    for (let r of roots(n)) {
      let p = pos.get(r)
      trees.push(
        `<path class="Tree_root" d="M${p.x},${p.y} C${p.x + 16},${p.y} ${
          x + BW + 22
        },${sealY - 20} ${x + BW - 18},${sealY + 1}"/>`,
        `<circle class="Tree_node Tree_node-root" style="--c:${color}" cx="${p.x}" cy="${p.y}" r="4.4"/>`,
      )
    }
    trees.push(
      `<g class="Seal" style="--c:${color}" transform="translate(${x},${sealY})"><rect width="${BW}" height="26" rx="13"/>` +
        `<text x="${BW / 2}" y="17">✓ signed · ${
          esc(check.tree.slice(0, 8))
        }</text>` +
        `<title>The tree hash over this log’s roots, signed with its actor’s key: ${
          esc(check.tree)
        }</title></g>`,
    )
  })

  shown.flat().forEach((b) => {
    let from = place.get(`${b.change.actor}:${b.change.seq}`)
    let color = looks(b.change.actor).color
    for (let [a, s] of Object.entries(b.change.deps ?? {})) {
      let to = place.get(`${a}:${s}`)
      if (!from || !to) continue
      let [fx, fy] = [from.x + BW / 2, from.y]
      let [tx, ty] = [to.x + BW / 2, to.y + BH]
      let bend = Math.max(26, (fy - ty) / 2)
      deps.push(
        `<path class="Dep" style="--c:${color}" d="M${fx},${fy} C${fx},${
          fy - bend
        } ${tx},${ty + bend} ${tx},${ty + 3}" marker-end="url(#tip)"/>`,
      )
    }
  })

  let last = cols.at(-1)
  let width = last ? last.x + last.w + PAD : 2 * PAD
  return `<svg class="Logs_svg" width="${width}" height="${
    bottom + 24
  }" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9 z" class="Tip"/></marker></defs>` +
    `<g class="Spines">${spines.join('')}</g><g class="Deps">${
      deps.join('')
    }</g>` +
    `<g class="Trees">${trees.join('')}</g><g class="Blocks">${
      blocks.join('')
    }</g></svg>`
}
