// The wire client's Deno half: the CLI-only doors that touch the process
// around it — the worktree climb that names a delegated child, and the pipe
// and @file grammar that read a body from stdin or disk. client.ts names no
// runtime, so the wire imports clean anywhere; importing this module is what
// hands it the process (client.ts `proc`). Everything here reads lazily, at
// the call, never at import.
import { type Param, proc, type Stdin } from './client.ts'

// The linked git worktree a path stands in, or undefined in the main checkout.
// A linked worktree's `.git` is a FILE (a `gitdir:` pointer) while the main
// checkout's is a directory everyone shares — only the former is one agent's
// own tree. Walk up so a tool run from a subdirectory still resolves the root.
let parentDir = (p: string) => {
  let i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}
export let worktreeRoot = (dir = Deno.cwd()): string | undefined => {
  let d = dir
  while (true) {
    try {
      if (Deno.statSync(`${d}/.git`).isFile) return d
    } catch { /* no .git at this level — keep climbing */ }
    let up = parentDir(d)
    if (up == d) return
    d = up
  }
}
proc.tree = worktreeRoot

let slurp = () => {
  let chunks: Uint8Array[] = [], buf = new Uint8Array(65536)
  for (let n: number | null; (n = Deno.stdin.readSync(buf)) != null;) {
    chunks.push(buf.slice(0, n))
  }
  // Concatenate the BYTES and decode once — a per-chunk decode splits a
  // multibyte character that straddles a read boundary.
  let all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (let c of chunks) {
    all.set(c, at)
    at += c.length
  }
  return new TextDecoder().decode(all)
}

export let stdin: Stdin = {
  terminal: () => Deno.stdin.isTerminal(),
  read: slurp,
}

// stdin is read ONLY for the explicit @- ask, never implicitly: a harness
// holding the pipe open but silent would block forever (T-5854) and no
// guard can tell that pipe from a slow one, so a TTY fails fast instead.
// And it is consumable once — a second @- would read empty, and an empty
// value CLEARS the column (the failure that wiped four session briefs),
// so the second ask is refused loudly rather than served that emptiness.
let piped = (io: Stdin, as: string) => {
  if (io.taken) {
    throw new Error(
      `${as}: stdin was already read by ${io.taken} — a pipe is ` +
        `consumable once, and the second read would clear the column`,
    )
  }
  if (io.terminal()) throw new Error(`${as}: stdin is a TTY — pipe it in`)
  io.taken = as
  let v = io.read().trim()
  // An empty pipe is the same silent clear this door exists to prevent, so
  // it is refused: clearing is `.prop=`, said deliberately.
  if (!v) throw new Error(`${as}: stdin was empty`)
  return v
}

// A pipe on stdin that no @- door drank. Since stdin is never read implicitly
// (above), a verb cannot ADOPT a piped body — it would have to slurp to see
// one, and that slurp is the T-5854 hang (an inherited open pipe never gives
// EOF). So a verb whose trailing words are its TITLE instead REFUSES a
// piped-but-unread stdin, turning a silent drop (a heredoc lost with exit 0,
// which mis-minted M-14370) into a loud, recoverable error naming the @- door.
// Never reads, so it cannot block; a TTY is not a pipe.
export let unreadPipe = (io: Stdin = stdin) =>
  !io.terminal() && io.taken == null

// A value starting with @ is read by the tool itself: @file is a FILE,
// @- is piped stdin — the safe doors for long bodies. Shell substitution
// offers the same and fails silently ($(cat) in a zsh pipeline reads
// nothing, and an empty value CLEARS the column — this wiped four session
// briefs, 2026-07-22); a missing file here is a loud error instead.
// Literal leading @: @@. `as` is the token the caller actually typed, so
// an error names the door the user reached for and not a synonym.
// A DROPPED @ is indistinguishable from success: the path lands as the
// whole body and the door prints its cheerful receipt. Two operators hit it
// independently (T-10612), and it lands on the CAREFUL path — long bodies
// written to a file first, which is where the content matters most.
//
// Narrow on purpose, three ways: only `body` (a filesystem path is the
// whole point of `repo.path`), only a lone whitespace-free token, and only
// one holding a '/' that stats as a file — so prose is untouched, a bare
// word like 'done' can never trip it even beside a file of that name, and a
// path that does NOT exist stays storable as text.
export let isFile = (v: string) => {
  try {
    return Deno.statSync(v).isFile
  } catch {
    return false
  }
}

let dropped = (p: Param, as: string) => {
  let v = p.value
  if (p.prop != 'body' || typeof v != 'string') return
  if (!/^\S+$/.test(v) || !v.includes('/')) return
  if (!isFile(v)) return
  // @@ would escape to a LITERAL leading @ — '@/tmp/x' — so it is not the
  // door out of here; the pipe is. Named because it is verified to work.
  // `as` already names the token the caller typed, so it is not repeated.
  throw new Error(
    `${as}: names a file that exists — did you mean @${v}? ` +
      `(to store the path itself as text, pipe it in with @-)`,
  )
}

// The body flag SAID IN THE VALUE POSITION — `.body=@file` handed to a door
// as the body itself, so the whole dot-param lands as prose and the door
// prints its cheerful receipt. Neither guard above can see it: '.body=@/tmp/x'
// does not stat as a file, and it does not open with @, so it is never read.
// It cost a portfolio ruling on a launch-gating task and a production-security
// decision in a single session, both of which then fanned out as mail.
//
// Narrow the same three ways: only `body`, only a lone whitespace-free token,
// and only one opening with a body-flag spelling AND carrying a remainder —
// so prose is untouched and a body of exactly '.body=' stays storable.
//
// The remainder is what the caller meant, so the error names THAT rather than
// a spelling: the correction is to the value, which makes it right at every
// door — `.body=`, `--body=`, and the lone positional token alike. Naming a
// concrete flag would be wrong for whichever door the caller was not at.
let misplaced = (p: Param, as: string) => {
  let v = p.value
  if (p.prop != 'body' || typeof v != 'string') return
  if (!/^\S+$/.test(v)) return
  let meant = /^(?:--body=|\.body=|body=)(.+)$/.exec(v)?.[1]
  if (!meant) return
  throw new Error(
    `${as}: a body flag in the value position — the body is '${meant}', ` +
      `not '${v}'. Pass just '${meant}'. ` +
      `(to store the whole token as text, pipe it in with @-)`,
  )
}

// The same flag with a SPACE instead of '=' — `task comment T-1 .body @file` —
// falls in the seam between every guard above: not a flag (no leading --, so
// the unknown-flag check never sees it), not a dot-param (no =, so param()
// never sees it), and TWO tokens, so the lone-token tests in `misplaced` and
// `dropped` cannot fire. Each guard is individually right; the spelling lives
// in the gap between them, at the same cost as its siblings (T-10873).
//
// Multi-token, so it cannot live in inflate, which only ever sees one value:
// it belongs to the doors that hold `words`. Narrow so prose opening with the
// word `.body` is untouched — exactly two tokens, and the second must be a
// REFERENCE or an existing file, which is what a caller who meant the flag
// would always have typed.
export let separated = (words: string[]) => {
  if (words.length != 2) return
  let [flag, v] = words
  if (!/^(?:--|-|\.)?body$/.test(flag)) return
  if (!v.startsWith('@') && !isFile(v)) return
  // The VALUE is what they meant, the same reasoning `misplaced` uses: the
  // correction is right at every door, where naming a spelling would not be.
  throw new Error(
    `${flag} ${v}: a body flag with a space instead of '=' — the body is ` +
      `'${v}'. Pass just '${v}'. ` +
      `(to store both words as text, pipe them in with @-)`,
  )
}

export let inflate = (
  p: Param,
  io = stdin,
  as = `.${p.prop}=${p.value}`,
): Param => {
  let v = p.value
  // A bare '-' IS the pipe — the unix spelling, and the one --body
  // answers (T-5866). Held literal, it swallowed whole heredocs and
  // reported success (T-11771): stdin at one door and a one-character
  // string at the next is not a spelling any hand can hold. EXACT only —
  // a value merely CONTAINING a hyphen ('a-b', '--') is prose. No door
  // stores a lone literal '-'; the pipe is the way if one ever must.
  if (v == '-' || v == '@-') return { ...p, value: piped(io, as) }
  if (typeof v != 'string' || !v.startsWith('@')) {
    misplaced(p, as)
    dropped(p, as)
    return p
  }
  if (v.startsWith('@@')) return { ...p, value: v.slice(1) }
  try {
    return { ...p, value: Deno.readTextFileSync(v.slice(1)) }
  } catch {
    throw new Error(`${as}: no such file`)
  }
}
