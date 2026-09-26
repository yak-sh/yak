// Loading yak: the one import of ./yak.js, which pulls every package it needs
// from JSR through esm.sh, the graph it opens with (two tasks and the edge
// between them), and a running account of the modules as they arrive, which
// is what the boot log prints.

// A module esm.sh served for one of the @yaks packages: `@yaks/graph@0.2.3`.
let named = (url) => url.match(/\/jsr\/(@yaks\/[a-z0-9-]+@[\d.]+)/)?.[1]

let esm = (entry) => entry.name.startsWith('https://esm.sh/')

/** How many modules this page fetched from esm.sh so far, and of how many
 * @yaks packages. (Their sizes are esm.sh's to tell, and it does not: a
 * cross-origin response reports its bytes only to a page it allows to see
 * its timing.) */
export let fetched = () => {
  let all = performance.getEntriesByType('resource').filter(esm)
  return {
    modules: all.length,
    packages: new Set(all.map((e) => named(e.name)).filter(Boolean)).size,
  }
}

/** Be told of each @yaks package the first time a module of it arrives:
 * `{ name, ms }`, `ms` being when it arrived after `since` (a
 * `performance.now()`). The answer stops the telling. */
export let arrivals = (tell, since = 0) => {
  let seen = new Set()
  let note = (entries) => {
    for (let e of entries) {
      let name = esm(e) && named(e.name)
      if (!name || seen.has(name)) continue
      seen.add(name)
      tell({ name, ms: Math.round(e.responseEnd - since) })
    }
  }
  note(performance.getEntriesByType('resource'))
  let watcher = new PerformanceObserver((list) => note(list.getEntries()))
  watcher.observe({ type: 'resource' })
  return () => watcher.disconnect()
}

// The graph every example starts from: a task that requires another, so
// `task list`, `graph show T-1` and a claim on T-1 answer something on the
// first try. Written in one batch, so they are T-1, T-2 and E-3.
let seed = (yak) =>
  yak.g.apply([
    {
      entity: { eid: '$yak' },
      doc: { title: 'Shave the yak' },
      task: {},
      filed: { priority: 1 },
    },
    {
      entity: { eid: '$clippers' },
      doc: { title: 'Find the clippers' },
      task: {},
    },
    {
      entity: { eid: '$needs' },
      edge: { from: '$yak', to: '$clippers' },
      requires: {},
    },
  ])

let loading

/** yak, loaded once and seeded: ./yak.js's exports, and `seeded`, the
 * bundles its graph opened with. */
export let yak = () =>
  loading ??= import('./yak.js').then(async (y) => ({
    ...y,
    seeded: await seed(y),
  }))
