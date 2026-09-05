#!/usr/bin/env -S deno run --allow-read --allow-run=git
// check-bytes — no C0 control byte may be written RAW into a source file.
//
// A raw 0x00 in a .ts file is invisible in an editor and changes nothing at
// runtime — `\x00` spells the same byte — but git sees it and calls the file
// BINARY. A binary file has no diff and no three-way merge, so every branch
// touching it has to be landed one at a time by hand (T-33946: graph.ts and
// mcp.ts each carried two, from a template literal joining key parts with a
// NUL). The same goes for a stray ESC, a BEL, or a lone \r: an escape is the
// spelling that survives a diff.
//
// So: every tracked file that is not a known binary asset must hold only tab,
// newline and printable bytes. Cheap enough to run in `deno task check` —
// ~1200 files, read once.

// Assets that are binary on purpose. Everything else is source and is checked.
let BINARY = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'ico',
  'webp',
  'avif',
  'pdf',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'wasm',
  'zip',
  'gz',
  'mp3',
  'mp4',
  'db',
  'sqlite',
])

// C0 minus tab and newline, plus DEL. \r is refused too: a CRLF file diffs and
// merges as badly as a binary one.
// deno-lint-ignore no-control-regex -- the control class is the subject
let CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g

let ext = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase()

let tracked = async () => {
  let { stdout } = await new Deno.Command('git', {
    args: ['ls-files', '-z'],
  }).output()
  return new TextDecoder().decode(stdout).split('\0').filter(Boolean)
}

/** Where a byte offset falls, as line:col — the only address a reader can use. */
let at = (text: string, offset: number) => {
  let head = text.slice(0, offset)
  let line = head.split('\n').length
  return `${line}:${offset - (head.lastIndexOf('\n') + 1) + 1}`
}

let hex = (ch: string) => '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0')

let offenders: string[] = []
for (let path of await tracked()) {
  if (BINARY.has(ext(path))) continue
  let bytes: Uint8Array
  try {
    bytes = Deno.readFileSync(path)
  } catch {
    continue // a submodule, or a path git knows and the tree does not
  }
  // latin1: every byte is one char, so an offset here is a byte offset.
  let text = new TextDecoder('latin1').decode(bytes)
  for (let hit of text.matchAll(CONTROL)) {
    offenders.push(`${path}:${at(text, hit.index)}: raw ${hex(hit[0])}`)
  }
}

if (offenders.length) {
  console.error(
    `raw control bytes in tracked source (write them as escapes — git calls a
file carrying one BINARY, and a binary file cannot be merged):\n`,
  )
  for (let line of offenders.slice(0, 40)) console.error('  ' + line)
  if (offenders.length > 40) {
    console.error(`  … and ${offenders.length - 40} more`)
  }
  Deno.exit(1)
}
