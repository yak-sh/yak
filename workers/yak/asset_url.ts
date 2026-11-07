// A release's browser address: local static references in its page and the
// versioned path that resolves them belong to the same mount.

let UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
let RELEASE = new RegExp(`(?:^|/)\\.releases/[^/]+/(${UUID})$`)
let ASSET = new RegExp(`^/assets/(${UUID})/(.+)$`)

/** The immutable release id, only where the app serves a release. */
export let releaseId = (source: string | null | undefined) =>
  RELEASE.exec(source ?? '')?.[1] ?? null

/** An app API path naming one asset in one release. */
export let assetPath = (path: string) => {
  let found = ASSET.exec(path)
  return found ? { release: found[1], path: `/${found[2]}` } : null
}

// A browser address's file in this release, as the app's files name it, or
// null when it is not one of the app's own static files: another origin, a
// sibling app, the platform's API, another release.
let releaseFile = (
  address: string,
  release: { source?: string | null },
  request: string,
  mount: string,
  folder: string,
) => {
  try {
    let base = new URL(mount, request)
    let url = new URL(address, base)
    if (url.origin != base.origin || !url.pathname.startsWith(base.pathname)) {
      return null
    }
    let path = url.pathname.slice(base.pathname.length)
    if (path.startsWith('api/')) {
      let asset = assetPath('/' + path.slice(4))
      if (!asset || asset.release != releaseId(release.source)) return null
      path = asset.path.slice(1)
    }
    return (folder ? `${folder}/` : '') + decodeURIComponent(path)
  } catch {
    return null
  }
}

/** A release that cannot run because it lacks a file its page loads: the
 * script the page names (the module's entry) and `missing`, the file that
 * was refused (the report's `file`, the entry itself by default) and that the
 * release does not hold. A refused file the release does hold was the
 * platform's to serve, not the app's to fix, so it answers null, as does any
 * report that is not this release's script failure. `folder` is the one the
 * app serves (wrangler's `assets.directory`). */
export let failedScript = (
  report: { version?: number | null; message: string; file?: string },
  release: {
    version: number
    source?: string | null
    files: Record<string, string>
  },
  request: string,
  mount: string,
  folder = '',
) => {
  if (report.version != release.version) return null
  let match = /^failed to load script (\S+)$/.exec(report.message)
  if (!match) return null
  let file = (address: string) =>
    releaseFile(address, release, request, mount, folder)
  let script = file(match[1])
  if (script == null || !Object.hasOwn(release.files, script)) return null
  let missing = file(report.file ?? match[1])
  return missing == null || Object.hasOwn(release.files, missing)
    ? null
    : { script, missing }
}

/** Where a release asset's reference to the app's API belongs. A release
 * holds the app's files and never its API, but a module's `./api/client.js`
 * resolves against the module's own address, below the release. The answer
 * climbs back out relatively, so it keeps whatever mount the browser asked
 * through: a prefix, a front page's root, a sandbox's token. */
export let apiOut = (asset: string) =>
  asset.startsWith('/api/')
    ? '../'.repeat(asset.split('/').length) + asset.slice('/api/'.length)
    : null

/** Point a local static reference at its release without moving navigation.
 * `base` is where the page resolves it from: the mount, or the page's own
 * folder under it. */
let local = (
  ref: string,
  mount: string,
  bare: string,
  reserved: (path: string) => boolean,
  base = mount,
) => {
  if (!ref || ref.startsWith('#')) return null
  let from = new URL(base, 'https://app.invalid')
  let url
  try {
    url = new URL(ref, from)
  } catch {
    return null
  }
  if (url.origin != from.origin) return null
  if (reserved(url.pathname)) return null
  let path = url.pathname.startsWith(mount)
    ? url.pathname.slice(mount.length)
    : url.pathname.startsWith(bare)
    ? url.pathname.slice(bare.length)
    : null
  return path == null || path.startsWith('api/') || path.startsWith('~')
    ? null
    : { path, url }
}

let versioned = (
  mount: string,
  release: string,
  found: NonNullable<ReturnType<typeof local>>,
) => {
  let { path, url } = found
  return `${mount}api/assets/${release}/${path}${url.search}${url.hash}`
}

export let assetUrl = (
  ref: string,
  mount: string,
  bare: string,
  release: string,
  reserved: (path: string) => boolean = () => false,
  base = mount,
) => {
  let found = local(ref, mount, bare, reserved, base)
  return found && /\.[a-z0-9]+$/i.test(found.path) &&
      !/\.html?$/i.test(found.path)
    ? versioned(mount, release, found)
    : ref
}

let ADDRESS = /^(?:\/|\.\.?\/)/

let mapUrl = (
  ref: string,
  mount: string,
  bare: string,
  release: string,
  reserved: (path: string) => boolean,
  base: string,
) => {
  if (!ADDRESS.test(ref)) return ref
  let found = local(ref, mount, bare, reserved, base)
  return found && !/\.html?$/i.test(found.path)
    ? versioned(mount, release, found)
    : ref
}

let mapEntries = (
  entries: unknown,
  move: (url: string) => string,
): unknown =>
  entries && typeof entries == 'object' && !Array.isArray(entries)
    ? Object.fromEntries(
      Object.entries(entries).map(([key, value]) => [
        move(key),
        typeof value == 'string' ? move(value) : value,
      ]),
    )
    : entries

let SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
let typeOf = (attrs: string) => {
  let type = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
  return (type?.[1] ?? type?.[2] ?? type?.[3] ?? '').trim().toLowerCase()
}
let SCRIPTS = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
])
// `import … from './x.js'`, `export … from './x.js'`, `import './x.js'` and
// `import('./x.js')`: a module named by its address, not computed.
let SPECIFIER = /\b(?:from|import)\s*\(?\s*(['"])((?:\/|\.\.?\/)[^'"\n]*)\1/g

// What a page's own scripts import by address, keyed by the address the
// browser resolves and pointed at its release, the rule `<script src>` follows
// (`assetUrl`). A page's inline module importing `./cooking.js` would
// otherwise fetch the app's mutable address, which is asked again on every
// load; its release address never changes, so the browser keeps it. A
// release's module asking for the app's API (`./api/client.js`, below the
// release) is pointed at the same address the page imports it by, so the
// client is one module, not a second copy behind `apiOut`'s redirect. Both
// are pointed at `client`, the client's name of its bytes, where there is one:
// the browser keeps it, where `./api/client.js` is asked again on every load.
// The address a page's reference resolves to, as an import map keys it.
let resolved = (ref: string, base: string) => {
  let url = new URL(ref, new URL(base, 'https://app.invalid'))
  return url.href.slice(url.origin.length)
}

let imported = (
  html: string,
  mount: string,
  bare: string,
  release: string,
  reserved: (path: string) => boolean,
  base: string,
  client: string | null,
) => {
  let imports: Record<string, string> = {}
  let modules = false
  for (let [, attrs, body] of html.matchAll(SCRIPT)) {
    let type = typeOf(attrs)
    modules ||= type == 'module'
    if (!SCRIPTS.has(type)) continue
    for (let [, , ref] of body.matchAll(SPECIFIER)) {
      let next = assetUrl(ref, mount, bare, release, reserved, base)
      if (next == ref) continue
      imports[resolved(ref, base)] = next
    }
  }
  if (modules) {
    imports[`${mount}api/assets/${release}/api/`] = `${mount}api/`
    if (client) {
      for (let at of [`${mount}api/`, `${mount}api/assets/${release}/api/`]) {
        imports[`${at}client.js`] = `${mount}api/${client}`
      }
    }
  }
  return imports
}

let mapJson = (map: unknown) => JSON.stringify(map).replaceAll('<', '\\u003c')

/** Keep a page's local modules with its release: an import map's local
 * targets and scopes move to it, and what the page's scripts import by
 * address is added to the page's import map (one written at the head when
 * the page has none), where the author's own entry for the same address
 * wins. A page of modules imports the store client by `client`, its name
 * below the app's `api/` (sheets.ts `client`), and asks for it beside the
 * map, so it arrives with the page's first module rather than after it. */
export let assetMaps = (
  html: string,
  mount: string,
  bare: string,
  release: string,
  reserved: (path: string) => boolean = () => false,
  base = mount,
  client: string | null = null,
) => {
  let imports = imported(html, mount, bare, release, reserved, base, client)
  let named = imports[`${mount}api/client.js`]
  let preload = (map: Record<string, unknown>) =>
    named && map[`${mount}api/client.js`] == named
      ? `<link rel="modulepreload" href="${named}">`
      : ''
  let merged = false
  let move = (url: string) => mapUrl(url, mount, bare, release, reserved, base)
  let page = html.replace(SCRIPT, (whole, attrs: string, body: string) => {
    if (typeOf(attrs) != 'importmap') return whole
    let map
    try {
      map = JSON.parse(body)
    } catch {
      return whole
    }
    if (!map || typeof map != 'object' || Array.isArray(map)) return whole
    let plain = map.imports == null ||
      typeof map.imports == 'object' && !Array.isArray(map.imports)
    let own: Record<string, unknown> = plain ? map.imports ?? {} : {}
    map.imports = mapEntries(map.imports, move)
    if (map.scopes && typeof map.scopes == 'object') {
      map.scopes = Object.fromEntries(
        Object.entries(map.scopes).map(([scope, imports]) => [
          move(scope),
          mapEntries(imports, move),
        ]),
      )
    }
    // The first map is the one every browser reads. An author's key by
    // address answers the page's own import of it too, before the release's.
    if (!merged && plain) {
      let theirs = Object.entries(own).filter(([key]) => ADDRESS.test(key))
        .map(([key, value]) => [
          resolved(key, base),
          typeof value == 'string' ? move(value) : value,
        ])
      map.imports = {
        ...imports,
        ...Object.fromEntries(theirs),
        ...map.imports as Record<string, unknown>,
      }
    }
    let first = !merged && plain
    merged = true
    return whole.replace(body, mapJson(map)) +
      (first ? preload(map.imports as Record<string, unknown>) : '')
  })
  if (merged || !Object.keys(imports).length) return page
  // Ahead of every module, and of any `<meta>` policy the head carries.
  let head = /<head\b[^>]*>/i.exec(page)
  let at = head ? head.index + head[0].length : page.search(/<script\b/i)
  return page.slice(0, at) +
    `<script type="importmap">${mapJson({ imports })}</script>` +
    preload(imports) + page.slice(at)
}
