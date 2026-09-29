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
export let assetUrl = (
  ref: string,
  mount: string,
  bare: string,
  release: string,
  reserved: (path: string) => boolean = () => false,
) => {
  if (!ref || ref.startsWith('#')) return ref
  let base = new URL(mount, 'https://app.invalid')
  let url
  try {
    url = new URL(ref, base)
  } catch {
    return ref
  }
  if (url.origin != base.origin) return ref
  if (reserved(url.pathname)) return ref
  let path = url.pathname.startsWith(mount)
    ? url.pathname.slice(mount.length)
    : url.pathname.startsWith(bare)
    ? url.pathname.slice(bare.length)
    : null
  if (
    !path || path.startsWith('api/') || path.startsWith('~') ||
    !/\.[a-z0-9]+$/i.test(path) || /\.html?$/i.test(path)
  ) return ref
  return `${mount}api/assets/${release}/${path}${url.search}${url.hash}`
}
