// What sandbox_ship (tools.ts) asks the build sandbox for, and where each
// file it finds lands in the app (T-124406). The asking is one shell command
// for every path, so a batch costs one round trip; the landing is pure.
//
// Each path the caller names lands by itself, keeping its folders. A folder
// named outright ships the files inside it. A file, or whatever a glob
// matched, lands under its own name below the deepest folder that path's
// matches share. So `dist`, `dist/*` and `dist/**` all land
// dist/about/index.html at about/index.html, and pkg/*.wasm lands its modules
// beside index.html, where the published description has always put them.
// `into` puts the lot under a folder of the app instead of its root.

import { refuse } from './tool.ts'

// What a path and a glob are made of, and nothing a shell reads as
// punctuation. It is tidiness rather than a boundary: the sandbox is the
// caller's own and sandbox_shell runs anything in it. It keeps one listing
// from becoming three commands.
let SHIP = /^[A-Za-z0-9._\-/*?[\]]+$/
let FOLDER = /^[A-Za-z0-9._\-/]+$/
let GLOB = /[*?[]/

// A path's folders and name, with `.` and empty steps gone. An absolute path
// keeps its leading empty step, so it joins back absolute.
let steps = (path: string) => [
  ...path.startsWith('/') ? [''] : [],
  ...path.split('/').filter((s) => s && s != '.'),
]

let climbs = (path: string) => path.split('/').includes('..')

// The steps every one of these starts with.
let shared = (all: string[][]) =>
  all.reduce((a, b) => {
    let i = 0
    while (i < a.length && a[i] == b[i]) i++
    return a.slice(0, i)
  })

/** A path or glob in the sandbox, as the caller wrote it. */
/// sandboxPath('pkg/*.wasm') -> 'pkg/*.wasm'
/// sandboxPath('a; rm -rf /') throws 'a path inside the sandbox'
/// sandboxPath('pkg/../../etc') throws 'a path inside the sandbox'
export let sandboxPath = (path: string) => {
  if (!SHIP.test(path) || climbs(path)) {
    throw refuse(
      'arguments',
      `paths: ${path} — a path inside the sandbox, e.g. dist, pkg/app.wasm ` +
        'or pkg/*.js',
    )
  }
  return path
}

/** A folder of the app to ship into, relative to its root. */
/// appFolder('/dist/') -> 'dist'
/// appFolder('public/build') -> 'public/build'
/// appFolder('../x') throws 'a folder of the app'
export let appFolder = (path: string) => {
  if (!FOLDER.test(path) || climbs(path)) {
    throw refuse(
      'arguments',
      `into: ${path} — a folder of the app, e.g. dist`,
    )
  }
  return steps(path).filter(Boolean).join('/')
}

/**
 * The one command that lists every regular file each path names, a folder's
 * whole tree included. Each line is `<n>\t<match>\t<inside>`: the path's
 * index, what it matched, and the file's path inside that match (empty for a
 * file matched itself). A relative path is handed over as ./path, so a name
 * starting with a dash reads as a path to find rather than an option.
 */
export let listing = (paths: string[]) =>
  paths.map((p, i) =>
    `find -H ${p.startsWith('/') ? p : `./${p}`} -type f ` +
    `-printf '${i}\\t%H\\t%P\\n'`
  ).join('; ')

/** One file to copy: where it is in the sandbox, and where it lands. */
export type Landing = { from: string; to: string }

/**
 * Where each file the listing found lands in the app. Two different files
 * landing on one path is refused rather than one silently replacing the other.
 */
/// let found = '0\t./dist\tindex.html\n0\t./dist\tabout/index.html\n'
/// landed(['dist'], found) -> [
///     { from: 'dist/index.html', to: 'index.html' },
///     { from: 'dist/about/index.html', to: 'about/index.html' },
///   ]
/// let star = '0\t./dist/index.html\t\n0\t./dist/about\tindex.html\n'
/// landed(['dist/*'], star, 'dist').map((l) => l.to)
///   -> ['dist/index.html', 'dist/about/index.html']
/// let two = '0\t./pkg/app.wasm\t\n1\t./static/app.css\t\n'
/// landed(['pkg/*.wasm', 'static/app.css'], two).map((l) => l.to)
///   -> ['app.wasm', 'app.css']
/// let clash = '0\t./a/index.html\t\n1\t./b/index.html\t\n'
/// landed(['a/index.html', 'b/index.html'], clash) throws 'both land at'
export let landed = (paths: string[], found: string, into = '') => {
  let matched = paths.map(() => [] as string[][])
  for (let line of found.split('\n')) {
    let [n, match, ...inside] = line.split('\t')
    if (inside.length) matched[Number(n)]?.push([match, inside.join('\t')])
  }
  let under = steps(into).filter(Boolean)
  let landings = matched.flatMap((files, i) => {
    if (!files.length) return []
    // A folder named outright is the root of its own files; anything else
    // lands under its own name, below the folder that holds it.
    let whole = !GLOB.test(paths[i])
    let base = shared(
      files.map(([match, inside]) =>
        whole && inside ? steps(match) : steps(match).slice(0, -1)
      ),
    )
    return files.map(([match, inside]) => {
      let from = [...steps(match), ...steps(inside)]
      return {
        from: from.join('/'),
        to: [...under, ...from.slice(base.length)].join('/'),
      }
    })
  })
  let at = new Map<string, Landing>()
  for (let l of landings) {
    let was = at.get(l.to)
    if (was && was.from != l.from) {
      throw refuse(
        'arguments',
        `${was.from} and ${l.from} would both land at ${l.to}; ship them ` +
          'from the folder that holds both, or name one',
      )
    }
    at.set(l.to, l)
  }
  return [...at.values()]
}
