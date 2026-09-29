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

/** Point a local static reference at its release without moving navigation. */
let local = (
  ref: string,
  mount: string,
  bare: string,
  reserved: (path: string) => boolean,
) => {
  if (!ref || ref.startsWith('#')) return null
  let base = new URL(mount, 'https://app.invalid')
  let url
  try {
    url = new URL(ref, base)
  } catch {
    return null
  }
  if (url.origin != base.origin) return null
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
) => {
  let found = local(ref, mount, bare, reserved)
  return found && /\.[a-z0-9]+$/i.test(found.path) &&
      !/\.html?$/i.test(found.path)
    ? versioned(mount, release, found)
    : ref
}

let mapUrl = (
  ref: string,
  mount: string,
  bare: string,
  release: string,
  reserved: (path: string) => boolean,
) => {
  if (!/^(?:\/|\.\.?\/)/.test(ref)) return ref
  let found = local(ref, mount, bare, reserved)
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

/** Keep local import-map targets and scopes with the script release. */
export let assetMaps = (
  html: string,
  mount: string,
  bare: string,
  release: string,
  reserved: (path: string) => boolean = () => false,
) =>
  html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    (whole, attrs: string, body: string) => {
      let type = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
        .exec(attrs)
      if ((type?.[1] ?? type?.[2] ?? type?.[3])?.toLowerCase() != 'importmap') {
        return whole
      }
      let map
      try {
        map = JSON.parse(body)
      } catch {
        return whole
      }
      if (!map || typeof map != 'object' || Array.isArray(map)) return whole
      let move = (url: string) => mapUrl(url, mount, bare, release, reserved)
      map.imports = mapEntries(map.imports, move)
      if (map.scopes && typeof map.scopes == 'object') {
        map.scopes = Object.fromEntries(
          Object.entries(map.scopes).map(([scope, imports]) => [
            move(scope),
            mapEntries(imports, move),
          ]),
        )
      }
      return whole.replace(body, JSON.stringify(map).replaceAll('<', '\\u003c'))
    },
  )
