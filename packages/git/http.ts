// Git's smart HTTP, protocol version 2, read only: the two doors a `git clone`
// knocks on, as `Request` in and `Response` out. Whoever mounts them decides
// what a repository IS — a set of refs and an object reader — and this file
// decides nothing else.
//
//   GET  <repo>/info/refs?service=git-upload-pack   what this server can do
//   POST <repo>/git-upload-pack                     ls-refs, and fetch
//
// V2 IS TWO ROUND TRIPS AND NOTHING IS DISCOVERED TWICE. The advertisement
// says only what the server can do — no refs, unlike v0, which sent every ref
// to a client that wanted one. The refs are the answer to `ls-refs`, and a
// pack is the answer to `fetch`, both POSTed to the one endpoint with a
// `command=` line saying which.
//
// WE ADVERTISE WHAT WE IMPLEMENT. No `shallow`, no `filter`, no
// `packfile-uris`, no `wait-for-done`, no `object-format=sha256`: a capability
// named here is one a client may rely on, and a client that never hears of
// shallow never asks for it. `server-option` is named because ignoring the
// options is the whole of implementing it.
//
// WE DO NOT NEGOTIATE, WE SUBTRACT (./objects.ts). A `fetch` that has said
// `done` gets the objects its wants reach less the ones its haves reach, in
// one pack. A `fetch` still negotiating gets the acknowledgments section with
// `NAK` — never a false `ready` — and the client says `done` on the next
// round, resending its haves, which is where the subtraction happens. One
// extra round trip, no state kept between requests.
//
// A WANT MUST BE REACHABLE FROM A REF. Anything else would serve an object
// somebody unlinked or never published by guessing its id — git's own
// `uploadpack.allowAnySHA1InWant=false`. The common case is a want that IS a
// ref, checked with a set; only a want off the tips pays for the walk.
//
// The packfile section is side-band framed, as v2 requires: band 1 is the
// pack. Band 2 is progress nobody asked for and band 3 is an error we send as
// an `ERR` line instead, before any section, where the client reports it as
// the server's own words.

import type { Objects } from './objects.ts'
import { concat } from './oid.ts'
import { BAND, band, DELIM, FLUSH, mark, type Pkt, pkt, read } from './pkt.ts'

/** One ref: its full name, and the object it points at. */
export type Ref = { name: string; oid: string }

/** A repository's refs, as this wire needs them. */
export type Refs = {
  /** every ref, by full name — `refs/heads/main`, not `main` */
  list: () => Promise<Ref[]>
  /** the ref HEAD is a symbolic link to; `refs/heads/main` when unsaid */
  head?: string
}

/** What HEAD points at when a repository does not say. */
export let MAIN = 'refs/heads/main'

/**
 * What this server can do, in the order git writes it. `agent` is a courtesy
 * line every implementation sends; the rest is the contract.
 */
export let CAPS: string[] = [
  'version 2',
  'agent=yaks',
  'ls-refs',
  'fetch',
  'object-format=sha1',
  'server-option',
]

let SERVICE = 'git-upload-pack'

let plain = (status: number, says: string) =>
  new Response(says, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })

let git = (type: string, body: BodyInit) =>
  new Response(body, {
    headers: {
      'content-type': `application/x-git-upload-pack-${type}`,
      'cache-control': 'no-cache',
    },
  })

// The header a v2 client sends. It carries `key=value` pairs joined by `:`,
// so the version is looked for among them rather than compared to the whole.
let v2 = (req: Request) =>
  (req.headers.get('git-protocol') ?? '').split(':').includes('version=2')

let OLD = 'git: this server speaks protocol v2 only — git 2.26 or newer, or ' +
  '`git -c protocol.version=2 clone`\n'

/**
 * The advertisement `GET <repo>/info/refs?service=git-upload-pack` answers:
 * the service line smart HTTP opens with, then {@link CAPS}.
 *
 * It takes no refs, because v2's advertisement carries none — that is the
 * point of v2, and `ls-refs` is where a client asks.
 */
export let advertise = (req: Request): Response => {
  if (new URL(req.url).searchParams.get('service') != SERVICE) {
    return plain(404, `git: only ${SERVICE} is served here\n`)
  }
  if (!v2(req)) return plain(400, OLD)
  return git(
    'advertisement',
    concat([
      pkt(`# service=${SERVICE}\n`),
      mark(FLUSH),
      ...CAPS.map((c) => pkt(c + '\n')),
      mark(FLUSH),
    ]),
  )
}

// A request body as packets, ungzipped if the client gzipped it (git does,
// once the haves grow past a kilobyte).
let asked = async (req: Request): Promise<Pkt[]> => {
  let body = req.body ?? new Blob([]).stream()
  if (req.headers.get('content-encoding') == 'gzip') {
    body = body.pipeThrough(new DecompressionStream('gzip'))
  }
  return read(new Uint8Array(await new Response(body).arrayBuffer()))
}

/** A command as it arrives: its name, the capabilities before the delimiter,
 * and the arguments after it. */
type Said = { command: string; caps: string[]; args: string[] }

let parse = (pkts: Pkt[]): Said => {
  let caps: string[] = []
  let args: string[] = []
  let past = false
  for (let p of pkts) {
    if (typeof p == 'number') {
      if (p == FLUSH) break
      if (p == DELIM) past = true
      continue
    }
    ;(past ? args : caps).push(p)
  }
  let said = (list: string[], key: string) =>
    list.find((c) => c.startsWith(key + '='))?.slice(key.length + 1)
  return { command: said(caps, 'command') ?? '', caps, args }
}

let err = (says: string) => git('result', pkt(`ERR ${says}`))

let body = (lines: Uint8Array[]) =>
  git('result', concat([...lines, mark(FLUSH)]))

let value = (args: string[], key: string) =>
  args.filter((a) => a.startsWith(key + ' ')).map((a) =>
    a.slice(key.length + 1)
  )

// `ls-refs`: every ref, HEAD first. `symrefs` asks what HEAD is a link to;
// `peel` asks for a tag's own target, which is a no-op until something here
// writes a tag; `ref-prefix` is a filter the client offers as a hint and the
// server is free to ignore — we honour it, because it is one comparison.
let lsRefs = async (args: string[], refs: Refs): Promise<Response> => {
  let all = await refs.list()
  let head = refs.head ?? MAIN
  let tip = all.find((r) => r.name == head)
  let sorted = [...all].sort((a, b) => a.name < b.name ? -1 : 1)
  let listed = tip ? [{ ...tip, name: 'HEAD', sym: head }, ...sorted] : sorted
  let prefixes = value(args, 'ref-prefix')
  let symrefs = args.includes('symrefs')
  return body(
    listed
      .filter((r) =>
        !prefixes.length || prefixes.some((p) => r.name.startsWith(p))
      )
      .map((r) =>
        pkt(
          `${r.oid} ${r.name}` +
            (symrefs && 'sym' in r ? ` symref-target:${r.sym}` : '') + '\n',
        )
      ),
  )
}

// Every byte of the answer to a `fetch` that is getting a pack: the section
// header, the pack in band 1, and the flush that ends the response. The pack
// arrives in whatever bites ./pack.ts wrote it in, so it is re-cut here to the
// biggest a packet can hold — a band packet per zlib chunk would spend five
// bytes on every one.
async function* packfile(pack: ReadableStream<Uint8Array>) {
  yield pkt('packfile\n')
  let reader = pack.getReader()
  let rest = new Uint8Array(0)
  while (true) {
    let got = await reader.read()
    if (got.done) break
    rest = concat([rest, got.value])
    while (rest.length >= BAND) {
      yield band(1, rest.subarray(0, BAND))
      rest = rest.slice(BAND)
    }
  }
  if (rest.length) yield band(1, rest)
  yield mark(FLUSH)
}

let streamed = (it: AsyncGenerator<Uint8Array>) =>
  new ReadableStream<Uint8Array>({
    pull: async (c) => {
      let { value, done } = await it.next()
      done ? c.close() : c.enqueue(value)
    },
    cancel: () => void it.return(undefined),
  })

// `fetch`: the wants, less the haves, as a pack — or the acknowledgments
// section, when the client has not finished saying what it holds.
let fetch = async (
  args: string[],
  refs: Refs,
  from: Objects,
): Promise<Response> => {
  let wants = value(args, 'want')
  let haves = value(args, 'have')
  if (!args.includes('done')) {
    return body([pkt('acknowledgments\n'), pkt('NAK\n')])
  }
  if (!wants.length) return body([])

  let tips = new Set((await refs.list()).map((r) => r.oid))
  let stray = wants.filter((w) => !tips.has(w))
  if (stray.length) {
    let ours = new Set(await from.reach([...tips]))
    let bad = stray.find((w) => !ours.has(w))
    if (bad) return err(`upload-pack: not our ref ${bad}`)
  }
  return git('result', streamed(packfile(await from.pack(wants, haves))))
}

/**
 * The answer to `POST <repo>/git-upload-pack`: one command, one response.
 *
 * The caller has already decided this repository may be read — a private app
 * is not found, not refused, at the door its pages use.
 */
export let uploadPack = async (
  req: Request,
  refs: Refs,
  from: Objects,
): Promise<Response> => {
  if (req.method != 'POST') return plain(405, 'git: POST\n')
  if (!v2(req)) return plain(400, OLD)
  let { command, caps, args } = parse(await asked(req))
  let format = caps.find((c) => c.startsWith('object-format='))
  if (format && format != 'object-format=sha1') {
    return err(`upload-pack: ${format} is not served here, only sha1`)
  }
  if (command == 'ls-refs') return lsRefs(args, refs)
  if (command == 'fetch') return fetch(args, refs, from)
  return err(`upload-pack: unknown command ${command || '(none)'}`)
}
