// An npm registry in memory, for tests that install packages without the
// network: each package's releases as files, packed the way npm packs them.
import { gzipSync } from 'fflate'

let encode = (text: string) => new TextEncoder().encode(text)

// A gzipped tarball of these files under `package/`, the way npm packs one.
let tgz = (files: Record<string, string | Uint8Array>) => {
  let blocks: Uint8Array[] = []
  for (let [path, content] of Object.entries(files)) {
    let body = typeof content == 'string' ? encode(content) : content
    let head = new Uint8Array(512)
    head.set(encode(`package/${path}`))
    head.set(encode(body.length.toString(8).padStart(11, '0')), 124)
    head[156] = 48
    head.set(encode('ustar\x0000'), 257)
    blocks.push(head, body, new Uint8Array((512 - body.length % 512) % 512))
  }
  blocks.push(new Uint8Array(1024))
  let tar = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0))
  blocks.reduce((at, b) => (tar.set(b, at), at + b.length), 0)
  return gzipSync(tar)
}

/** A registry of these packages, name to version to its files, answering
 * what it was asked in `asked`. */
export let registry = (
  packages: Record<string, Record<string, Record<string, string | Uint8Array>>>,
) => {
  let asked: string[] = []
  let answer = (url: string) => {
    let path = decodeURIComponent(new URL(url).pathname.slice(1))
    asked.push(path)
    let [, name, version] = path.match(/^(.+)\/-\/(.+)\.tgz$/) ?? [, path]
    let releases = packages[name!]
    if (!releases) return new Response('', { status: 404 })
    if (version) return new Response(tgz(releases[version]))
    let versions = Object.fromEntries(
      Object.entries(releases).map(([v, files]) => [v, {
        dependencies: JSON.parse(String(files['package.json'])).dependencies,
        dist: { tarball: `https://registry.test/${name}/-/${v}.tgz` },
      }]),
    )
    let latest = Object.keys(versions).at(-1)
    return Response.json({ 'dist-tags': { latest }, versions })
  }
  let get = ((url: string) => Promise.resolve(answer(url))) as typeof fetch
  return { get, asked }
}
