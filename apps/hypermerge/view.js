// The feeds drawn as hypercore keeps them: a lane per actor, its blocks left
// to right by index, the Merkle tree over them (each node at its flat-tree
// index, so a parent sits between its children), and the signed tree hash at
// the head. Arrows run from a change to what it depends on: solid across
// feeds for its deps, dashed to its own previous seq.

export let W = 64, BW = 52, BH = 30, ROW = 22, X0 = 170, HEAD = 26

let esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/// short('5Hq2wQd9xYz') -> '5Hq2wQ'
export let short = (id) => String(id).slice(0, 6)

/// depth(1) -> 0
/// depth(4) -> 2
/// depth(5) -> 2
/** How many levels of parents a tree over `n` blocks has. */
export let depth = (n) => n > 1 ? Math.floor(Math.log2(n)) : 0

/**
 * The lanes' layout: each lane's top, height and where its leaves sit. `extra`
 * is how many held blocks trail each lane, by actor.
 */
export let layout = (lanes, checks, extra = {}) => {
  let top = 0
  return lanes.map((l, i) => {
    let n = checks[i].trusted.length
    let levels = depth(n)
    let at = {
      top,
      levels,
      leafY: top + HEAD + levels * ROW,
      count: l.blocks.length + (extra[l.actor] ?? 0),
    }
    top += HEAD + levels * ROW + BH + 22
    return at
  })
}

let x = (index) => X0 + index * W / 2

/**
 * The SVG of every lane. `colors` maps an actor to its colour, `held` lists
 * each local editor's unpublished blocks by actor, `selected` is the eid
 * drawn as chosen, and `phase` maps an eid to applied, waiting or pending
 * while a replay is shown.
 */
export let svg = (
  { doc, lanes, checks, colors, held = {}, selected, phase },
) => {
  let extra = Object.fromEntries(
    Object.entries(held).map(([a, rows]) => [a, rows.length]),
  )
  let at = layout(lanes, checks, extra)
  let place = new Map()
  let parts = [], arrows = []
  let wide = Math.max(1, ...at.map((a) => a.count))
  lanes.forEach((l, i) => {
    let { top, leafY } = at[i], c = colors[l.actor] ?? '#888'
    let check = checks[i]
    let name = l.actor == doc ? 'root feed · doc id' : l.member?.name ?? 'actor'
    parts.push(
      `<g class="Lane"><line x1="0" x2="100%" y1="${top}" y2="${top}" class="Lane_rule"/>` +
        `<rect x="8" y="${top + 10}" width="10" height="10" rx="2" fill="${
          esc(c)
        }"/>` +
        `<text x="24" y="${top + 19}" class="Lane_name">${esc(name)}</text>` +
        `<text x="24" y="${top + 34}" class="Lane_key"><title>${
          esc(l.actor)
        }</title>${esc(short(l.actor))}… · ${check.trusted.length} block${
          check.trusted.length == 1 ? '' : 's'
        }</text>`,
    )
    let byIndex = new Map(check.nodes.map((n) => [n.index, n]))
    for (let n of check.nodes) {
      if (!n.depth) continue
      let cx = x(n.index) + BW / 2, cy = leafY - n.depth * ROW + 6
      for (
        let k of [n.index - 2 ** (n.depth - 1), n.index + 2 ** (n.depth - 1)]
      ) {
        let child = byIndex.get(k)
        let ky = child.depth ? leafY - child.depth * ROW + 6 : leafY
        parts.push(
          `<line x1="${cx}" y1="${cy}" x2="${
            x(k) + BW / 2
          }" y2="${ky}" class="Tree_edge"/>`,
        )
      }
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="5" class="Tree_node" data-node="${i}:${n.index}"><title>node ${n.index} · ${n.size} bytes beneath</title></circle>`,
      )
    }
    let status = check.status
    l.blocks.forEach((b) => {
      let bx = X0 + b.index * W
      place.set(`${l.actor}:${b.index + 1}`, { x: bx, y: leafY })
      let s = status.get(b.eid) ?? 'gap'
      let p = phase?.get(b.eid)
      parts.push(
        `<g class="Block Block-${s}${p ? ` Block-${p}` : ''}${
          b.eid == selected ? ' Block-selected' : ''
        }" data-eid="${esc(b.eid)}">` +
          `<rect x="${bx}" y="${leafY}" width="${BW}" height="${BH}" rx="4" fill="${
            esc(c)
          }"/>` +
          `<text x="${bx + 6}" y="${leafY + 13}">#${b.index}</text>` +
          `<text x="${bx + 6}" y="${leafY + 25}" class="Block_seq">seq ${
            b.change?.seq ?? '?'
          }</text>` +
          `<title>${esc(b.change?.message ?? '')} — ${s}</title></g>`,
      )
      if (b.index > 0) {
        arrows.push(
          `<line x1="${bx}" y1="${leafY + BH / 2}" x2="${
            bx - W + BW + 2
          }" y2="${
            leafY + BH / 2
          }" class="Dep Dep-own" marker-end="url(#arrow)"/>`,
        )
      }
    })
    ;(held[l.actor] ?? []).forEach((r, k) => {
      let bx = X0 + (l.blocks.length + k) * W
      parts.push(
        `<g class="Block Block-held"><rect x="${bx}" y="${leafY}" width="${BW}" height="${BH}" rx="4"/>` +
          `<text x="${bx + 6}" y="${leafY + 13}">#${r.block.index}</text>` +
          `<text x="${bx + 6}" y="${
            leafY + 25
          }" class="Block_seq">held</text></g>`,
      )
    })
    if (check.tree) {
      let hx = X0 + check.trusted.length * W + 8 +
        (held[l.actor]?.length ?? 0) * W
      parts.push(
        `<g class="Head"><rect x="${hx}" y="${leafY}" width="128" height="${BH}" rx="4"/>` +
          `<text x="${hx + 8}" y="${leafY + 13}">tree ${
            esc(check.tree.slice(0, 10))
          }…</text>` +
          `<text x="${hx + 8}" y="${leafY + 25}" class="Block_seq">signed by ${
            esc(short(l.actor))
          } ✓</text><title>${esc(check.tree)}</title></g>`,
      )
    }
  })
  for (let l of lanes) {
    for (let b of l.blocks) {
      let from = place.get(`${l.actor}:${b.index + 1}`)
      for (let [a, s] of Object.entries(b.change?.deps ?? {})) {
        let to = place.get(`${a}:${s}`)
        if (!from || !to) continue
        let [fx, fy] = [from.x + BW / 2, from.y + (to.y < from.y ? 0 : BH)]
        let [tx, ty] = [to.x + BW / 2, to.y + (to.y < from.y ? BH : 0)]
        let my = (fy + ty) / 2
        arrows.push(
          `<path d="M${fx},${fy} C${fx},${my} ${tx},${my} ${tx},${ty}" class="Dep" stroke="${
            esc(colors[l.actor] ?? '#888')
          }" marker-end="url(#arrow)"/>`,
        )
      }
    }
  }
  let last = at.at(-1)
  let height = last ? last.leafY + BH + 22 : 40
  return `<svg class="Feeds_svg" width="${
    X0 + wide * W + 160
  }" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" class="Arrow"/></marker></defs>` +
    parts.join('') + `<g class="Deps">${arrows.join('')}</g></svg>`
}
