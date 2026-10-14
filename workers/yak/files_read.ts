// What an app_files read answers when it names several paths, or none: the
// app's text files, each with its SHA-256, up to READ bytes in all, and every
// path it did not answer with why. An assistant coming back to an app reads
// it in one call, not one call per file (T-124200).
//
// It knows paths and an `open` that says a file's size before its bytes, and
// nothing of where the bytes live: today an app's draft over its release,
// later its git objects (D-124238). So a file past the budget costs its size
// and never its bytes, and the budget bounds what one call holds in memory.
import { type Opened, utf8 } from '@yaks/blob'
import { sha256 } from './versions.ts'
import { size } from './meter.ts'

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
    sha: await sha256(bytes),
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
    binary.length ? `Not text: ${binary.map((u) => u.path).join(', ')}.` : '',
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
