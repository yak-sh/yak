// What an app_files read answers when it names several paths, or none: the
// app's text files, each with its SHA-256, up to READ bytes in all, and every
// path it did not answer with why. An assistant coming back to an app reads
// it in one call, not one call per file (T-124200).
//
// It knows paths and an `open` that says a file's size before its bytes, and
// nothing of where the bytes live: today an app's draft over its release,
// later its git objects (D-124238). So a file past the budget costs its size
// and never its bytes, and the budget bounds what one call holds in memory.
import { mediaTypeOf, mimeOf, type Opened, utf8 } from '@yaks/blob'
import { digest } from '@yaks/graph/sha256'
import { size } from '@yaks/fp'
import type { Image } from '@yaks/tools/value'
import { base64, type Bytes } from './bytes.ts'

/** The most bytes of file text one read of several files answers: well
 * inside what a client shows a model of one tool result. One path alone is
 * read whole. */
export let READ = 64 * 1024

export type Read = { path: string; sha: string; size: number; text: string }

/** A path the read did not answer: no file there, a file that is not text,
 * or one past what the budget had left. */
export type Unread = {
  path: string
  why: 'missing' | 'binary' | 'budget'
  size?: number
}

export type Perused = { files: Read[]; unread: Unread[] }

// A file whose size fit, read: its text, or why it has none.
let take = async (path: string, o: Opened): Promise<Read | Unread> => {
  let bytes = new Uint8Array(await new Response(await o.read()).arrayBuffer())
  if (!utf8(bytes)) return { path, why: 'binary', size: bytes.byteLength }
  return {
    path,
    sha: await digest(bytes),
    size: bytes.byteLength,
    text: new TextDecoder().decode(bytes),
  }
}

/**
 * The files at these paths, in their order, while their sizes fit the budget.
 * One that does not fit is passed over and the next tried, so a big file
 * leaves room for the small ones after it.
 */
export let peruse = async (
  paths: string[],
  open: (path: string) => Promise<Opened | null>,
  budget = READ,
): Promise<Perused> => {
  let named = [...new Set(paths)]
  let opened = await Promise.all(named.map(open))
  let left = budget
  let all = await Promise.all(
    named.map((path, i): Read | Unread | Promise<Read | Unread> => {
      let o = opened[i]
      if (!o) return { path, why: 'missing' }
      if (o.size > left) return { path, why: 'budget', size: o.size }
      left -= o.size
      return take(path, o)
    }),
  )
  return {
    files: all.filter((r): r is Read => 'text' in r),
    unread: all.filter((r): r is Unread => 'why' in r),
  }
}

// A fence one backtick longer than any run of them in the text, so a file
// holding a fence of its own (a README) stays inside this one.
let fence = (text: string) =>
  '`'.repeat(
    Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)),
  )

let block = ({ path, sha, text }: Read) => {
  let f = fence(text)
  let ext = /\.([a-z0-9]+)$/i.exec(path)?.[1] ?? ''
  return `${path} — sha256 ${sha}\n${f}${ext}\n${text}` +
    `${text.endsWith('\n') || !text ? '' : '\n'}${f}`
}

let named = (unread: Unread[], why: Unread['why']) =>
  unread.filter((u) => u.why == why)

// The answer in words: each file under its path and sha, fenced, then what
// was not read and the version a deploy names as its base. claude.ai's model
// reads only these words, so every fact the value holds is said here too.
export let perusal = ({ files, unread }: Perused, version: number) => {
  let gone = named(unread, 'missing')
  let binary = named(unread, 'binary')
  let past = named(unread, 'budget')
  return [
    ...files.length || unread.length ? files.map(block) : ['(no files)'],
    gone.length ? `No file ${gone.map((u) => u.path).join(', ')}.` : '',
    binary.length
      ? `Not text: ${binary.map((u) => u.path).join(', ')} — op: read with ` +
        'path answers one as what it is.'
      : '',
    past.length
      ? `Past the ${size(READ)} one read answers: ${
        past.map((u) => `${u.path} (${size(u.size ?? 0)})`).join(', ')
      } — op: read with paths reads more, and with path reads one whole.`
      : '',
    version
      ? `Live v${version}; app_deploy(base: ${version}) releases edits ` +
        'made over these.'
      : 'Nothing is released yet.',
  ].filter(Boolean).join('\n')
}

/** The most bytes of an image one read answers as a picture: what a model
 * takes in one image, 5 MB once base64. */
export let SEEN = 3.75 * 1024 * 1024

export type Glanced = {
  text: string
  value: { sha: string; size: number; mediaType: string; content?: string }
  images?: Image[]
}

/**
 * One file, read whole as what it is: text as its text, a picture a model
 * can see as that picture, and any other bytes as their sha, size and media
 * type. Never bytes decoded as text, which no model reads and every later
 * turn of a conversation carries again (T-1577).
 */
export let glance = async (
  path: string,
  bytes: Bytes,
): Promise<Glanced> => {
  let sha = await digest(bytes)
  if (utf8(bytes)) {
    let content = new TextDecoder().decode(bytes)
    let mediaType = mimeOf(path)
    return {
      text: content,
      value: { sha, size: bytes.byteLength, mediaType, content },
    }
  }
  let image = mediaTypeOf(bytes)
  let mediaType = image ?? mimeOf(path)
  let value = { sha, size: bytes.byteLength, mediaType }
  let said = `${path} — ${mediaType}, ${size(bytes.byteLength)}, sha256 ${sha}`
  if (image && bytes.byteLength <= SEEN) {
    return {
      text: `${said}; the picture is beside these words.`,
      value,
      images: [{ data: base64(bytes), mime_type: image }],
    }
  }
  return {
    text: `${said}; not text, so its bytes are not answered${
      image ? ` (a picture past the ${size(SEEN)} one read shows)` : ''
    }.`,
    value,
  }
}
