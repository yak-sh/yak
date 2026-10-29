// The logs drawn as hypercores: a column per actor, its blocks stacked back
// to back from the top by index, as the log holds them. Arrows between the
// columns are the deps, drawn from a change to what it had seen; under the
// last block of each log sits the seal, the tree hash its actor signed.
import { describe } from './describe.js'

export let BW = 160, BH = 44, ROW = 54, TOP = 20, GAP = 72, PAD = 28

let esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/// short('5Hq2wQd9xYz') -> '5Hq2wQ'
export let short = (id) => String(id).slice(0, 6)

/// columns([{}, {}]).map((c) => c.x) -> [28, 260]
/** Where each column stands: its left edge and width. */
export let columns = (lanes) =>
  lanes.map((lane, i) => ({ x: PAD + i * (BW + GAP), w: BW, lane }))

/// let a = { x: 28, y: 20 }, b = { x: 260, y: 74 }
/// dep(b, a) -> 'M260,96 C224,96 224,42 188,42'
/// dep(a, b) -> 'M188,42 C224,42 224,96 260,96'
/**
 * The arrow from a block at `from` to the block it depends on at `to`, edge to
 * facing edge, as an SVG path.
 */
export let dep = (from, to) => {
  let left = to.x < from.x
  let [sx, sy] = [left ? from.x : from.x + BW, from.y + BH / 2]
  let [tx, ty] = [left ? to.x + BW : to.x, to.y + BH / 2]
  let bend = (tx - sx) / 2
  return `M${sx},${sy} C${sx + bend},${sy} ${tx - bend},${ty} ${tx},${ty}`
}

/**
 * The column heads, as HTML laid out to the columns' widths. `looks` maps an
 * actor to its {name, color}; `mine` holds the actors this browser writes as.
 */
export let heads = ({ doc, lanes, checks, looks, mine }) =>
  columns(lanes).map(({ w, lane }, i) => {
    let { name, color } = looks(lane.actor), n = checks[i].trusted.length
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
 * applied, waiting or pending while the doc is rewound, and `seen` holds the
 * eids drawn before, so only a block new to the page arrives animated.
 */
export let logs = (
  { lanes, checks, looks, held = {}, selected, phase, seen = new Set() },
) => {
  let cols = columns(lanes)
  let place = new Map(), all = [], spines = [], seals = [], blocks = []
  let bottom = TOP
  cols.forEach(({ x, lane }, i) => {
    let { color } = looks(lane.actor), check = checks[i]
    let list = [
      ...check.trusted.map((b) => ({ ...b, state: 'ok' })),
      ...(held[lane.actor] ?? []).map((r) => ({
        ...r.block,
        eid: r.entity.eid,
        state: 'held',
      })),
    ]
    let y = (b) => TOP + b.index * ROW
    for (let b of list) {
      place.set(`${lane.actor}:${b.change.seq}`, { x, y: y(b) })
      all.push(b)
    }
    if (list.length > 1) {
      spines.push(
        `<line class="Spine" style="--c:${color}" x1="${x + BW / 2}" x2="${
          x + BW / 2
        }" y1="${TOP + BH / 2}" y2="${y(list.at(-1)) + BH / 2}"/>`,
      )
    }
    for (let b of list) {
      let p = phase?.get(b.eid)
      let cls = [
        'Block',
        `Block-${b.state}`,
        p && `Block-${p}`,
        b.eid == selected && 'Block-selected',
        !seen.has(b.eid) && 'Block-new',
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
    if (list.length) bottom = Math.max(bottom, y(list.at(-1)) + BH)
    if (!check.tree) return
    let sealY = y(list.at(-1)) + BH + 10
    bottom = Math.max(bottom, sealY + 26)
    seals.push(
      `<g class="Seal" style="--c:${color}" transform="translate(${x},${sealY})"><rect width="${BW}" height="26" rx="13"/>` +
        `<text x="${BW / 2}" y="17">✓ signed · ${
          esc(check.tree.slice(0, 8))
        }</text>` +
        `<title>The hash of this log’s Merkle tree, signed with its actor’s key: ${
          esc(check.tree)
        }</title></g>`,
    )
  })

  let deps = all.flatMap((b) =>
    Object.entries(b.change.deps ?? {}).map((
      [a, s],
    ) => [b, place.get(`${a}:${s}`)])
      .filter(([, to]) => to)
      .map(([b, to]) =>
        `<path class="Dep" style="--c:${looks(b.change.actor).color}" d="${
          dep(place.get(`${b.change.actor}:${b.change.seq}`), to)
        }" marker-end="url(#tip)"/>`
      )
  )

  let last = cols.at(-1)
  let width = last ? last.x + last.w + PAD : 2 * PAD
  return `<svg class="Logs_svg" width="${width}" height="${
    bottom + 24
  }" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1,1 L9,5 L1,9 z" class="Tip"/></marker></defs>` +
    `<g class="Spines">${spines.join('')}</g><g class="Deps">${
      deps.join('')
    }</g><g class="Seals">${seals.join('')}</g><g class="Blocks">${
      blocks.join('')
    }</g></svg>`
}
