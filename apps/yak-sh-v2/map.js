// The package map, drawn from packages.json (bin/package-map.ts writes it
// from the workspace). Each package stands in a column by how deep its
// imports go: the ones that import no other package on the left, and each
// column right of every package it imports. Within a column, packages are
// ordered to sit level with what they are linked to, which uncrosses most of
// the traces. Each import is a trace from the package to what it imports.
// Which group a package belongs to is read off the page's own package list.

let NS = 'http://www.w3.org/2000/svg'

let make = (name, attrs = {}, ...kids) => {
  let node = document.createElementNS(NS, name)
  for (let [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  node.append(...kids)
  return node
}

/** The column each package stands in: one past the deepest of its imports,
 * zero for a package that imports none. A cycle would be cut where found;
 * the workspace has none. */
export let depths = (pkgs) => {
  let by = new Map(pkgs.map((p) => [p.name, p]))
  let depth = new Map()
  let walking = new Set()
  let of = (name) => {
    if (depth.has(name)) return depth.get(name)
    if (walking.has(name)) return -1
    walking.add(name)
    let d = 1 +
      Math.max(-1, ...by.get(name).imports.filter((q) => by.has(q)).map(of))
    walking.delete(name)
    depth.set(name, d)
    return d
  }
  for (let p of pkgs) of(p.name)
  return depth
}

// Order each column by the mean height of its packages' neighbors, sweeping
// left to right and back, an even number of times so the columns end in
// their own order: the barycenter heuristic.
let untangle = (columns, near) => {
  let at = new Map()
  let place = () =>
    columns.forEach((col) =>
      col.forEach((name, i) => at.set(name, (i + .5) / col.length))
    )
  let mean = (name) => {
    let ns = near.get(name) ?? []
    return ns.length
      ? ns.reduce((s, n) => s + at.get(n), 0) / ns.length
      : at.get(name)
  }
  place()
  for (let sweep = 0; sweep < 12; sweep++) {
    for (let col of columns) {
      col.sort((a, b) => mean(a) - mean(b))
      place()
    }
    columns.reverse()
  }
}

// Sizes, in the drawing's own units: a name is set at 10 (man.css), and
// JetBrains Mono's characters are .6 of that wide.
let ROW = 13.5
let CHAR = 6
let GAP = 13
let DOT = 5

/**
 * Draw the map in `figure` from `pkgs`, grouped by `groups` (name → group).
 * `open(name)` is called when a package is chosen. Answers the svg.
 */
export let draw = (figure, pkgs, { groups = new Map(), open }) => {
  let depth = depths(pkgs)
  let by = new Map(pkgs.map((p) => [p.name, p]))
  let users = new Map(pkgs.map((p) => [p.name, []]))
  for (let p of pkgs) for (let q of p.imports) users.get(q)?.push(p.name)
  let near = new Map(
    pkgs.map((p) => [p.name, [...p.imports, ...users.get(p.name)]]),
  )

  let columns = []
  for (let p of [...pkgs].sort((a, b) => a.name.localeCompare(b.name))) {
    ;(columns[depth.get(p.name)] ??= []).push(p.name)
  }
  untangle(columns, near)

  // Each column as wide as its longest name.
  let tall = Math.max(...columns.map((c) => c.length))
  let spot = new Map()
  let x = DOT
  for (let col of columns) {
    let wide = Math.max(...col.map((n) => n.length)) * CHAR
    col.forEach((name, i) => {
      let y = (i - (col.length - 1) / 2) * ROW
      spot.set(name, { x, y, end: x + DOT + name.length * CHAR })
    })
    x += DOT + wide + GAP
  }
  let width = x - GAP + DOT
  let half = (tall * ROW) / 2 + ROW

  let traces = make('g')
  let nodes = make('g')
  let edges = []
  for (let p of pkgs) {
    let from = spot.get(p.name)
    for (let q of p.imports) {
      let to = spot.get(q)
      if (!to) continue
      let sx = from.x - DOT * .6
      let ex = to.end + 3
      let bend = Math.max(12, (sx - ex) * .45)
      let path = make('path', {
        class: 'Map_Edge',
        d: `M${sx},${from.y} C${sx - bend},${from.y} ${
          ex + bend
        },${to.y} ${ex},${to.y}`,
      })
      path.style.setProperty('--delay', `${depth.get(p.name) * 70}ms`)
      edges.push({ path, from: p.name, to: q })
      traces.append(path)
    }
  }

  for (let p of pkgs) {
    let { x, y } = spot.get(p.name)
    let r = 1.3 + Math.sqrt(users.get(p.name).length) * .42
    let node = make(
      'a',
      {
        class: 'Map_Node',
        href: p.jsr
          ? `https://jsr.io/@yaks/${p.name}`
          : `https://github.com/yak-sh/yak/tree/main/packages/${p.name}`,
        'data-pkg': p.name,
      },
      make('circle', { cx: x, cy: y, r }),
      make('text', { x: x + DOT, y }, p.name),
    )
    node.style.setProperty('--delay', `${depth.get(p.name) * 70}ms`)
    nodes.append(node)
  }

  let svg = make(
    'svg',
    {
      viewBox: `0 ${-half} ${width} ${half * 2}`,
      role: 'img',
      'aria-label':
        `The ${pkgs.length} @yaks packages and the imports between them`,
    },
    traces,
    nodes,
  )
  let readout = document.createElement('div')
  readout.className = 'Map_Readout'
  let idle = `${pkgs.length} packages · ${edges.length} imports · ` +
    'point at one; open it for its README'
  readout.textContent = idle
  figure.replaceChildren(svg, readout)
  delete figure.dataset.focus

  let lit = null
  let light = (name) => {
    if (name == lit) return
    lit = name
    for (let { path, from, to } of edges) {
      path.classList.toggle('is-out', from == name)
      path.classList.toggle('is-in', to == name)
    }
    for (let node of nodes.children) {
      let n = node.dataset.pkg
      node.classList.toggle('is-on', n == name)
      node.classList.toggle('is-near', !!name && near.get(name).includes(n))
    }
    if (!name) {
      delete figure.dataset.focus
      readout.textContent = idle
      return
    }
    figure.dataset.focus = ''
    let p = by.get(name)
    let list = (names) =>
      names.length > 16
        ? `${names.slice(0, 16).join(' ')} and ${names.length - 16} more`
        : names.join(' ') || 'none'
    readout.replaceChildren()
    let b = document.createElement('b')
    b.textContent = `@yaks/${name}`
    readout.append(
      b,
      ` · ${groups.get(name) ?? 'package'}${
        p.jsr ? ' · jsr ' + p.jsr : ' · not on JSR'
      }\n` +
        `imports ${p.imports.length}: ${list(p.imports)}\n` +
        `imported by ${users.get(name).length}: ${list(users.get(name))}`,
    )
  }

  let pick = (e) => e.target.closest?.('.Map_Node')?.dataset.pkg
  svg.addEventListener('pointerover', (e) => light(pick(e) ?? null))
  svg.addEventListener('pointerleave', () => light(null))
  svg.addEventListener('focusin', (e) => light(pick(e) ?? null))
  svg.addEventListener('click', (e) => {
    let name = pick(e)
    if (!name || !open || e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    open(name)
  })

  // The beam traces the map once, foundations first.
  for (let { path } of edges) {
    path.style.setProperty('--len', `${Math.ceil(path.getTotalLength())}`)
  }
  svg.classList.add('is-drawing')
  setTimeout(() => svg.classList.remove('is-drawing'), 2600)
  return svg
}
