// The fixed-sleep ban, wired into the gate. A fast test must be deterministic:
// it waits on a fact (until) or yields once (tick), never sleeps a span that a
// loaded box would stretch past its pad. So a raw `sleep(N)`/`delay(N)` or a
// `setTimeout(fn, <number>)` inside a Deno.test body is refused here. Heavy
// tests wrapped in `slow()` are exempt — they ride real subprocesses and their
// waits are the point. Run: `deno task sleepcheck` (folded into `deno task
// check`).
//
// The parser is string/comment/template aware so a delay named in a string or
// a comment never trips it, and so a `slow(...)` body is skipped whole.

// Every *_test.ts(x) under a root, hand-walked so the check carries no new
// dependency (the lockfile is frozen). vendor and the graph's own dirs stay out.
let testFiles = function* (dir: string): Generator<string> {
  for (let e of Deno.readDirSync(dir)) {
    if (/^(vendor|node_modules)$/.test(e.name) || e.name.startsWith('.')) {
      continue
    }
    let path = `${dir}/${e.name}`
    if (e.isDirectory) yield* testFiles(path)
    else if (/_test\.tsx?$/.test(e.name)) yield path
  }
}

// One test block: the call (Deno.test or slow), its name, and its body span.
type Block = { kind: 'test' | 'slow'; name: string; body: string; at: number }

// Skip a string/template/comment starting at i; return the index just past it,
// or i if nothing starts here. Templates can nest ${...} with more strings, so
// recurse through the expression holes.
let skip = (s: string, i: number): number => {
  let c = s[i]
  if (c == '/' && s[i + 1] == '/') {
    let n = s.indexOf('\n', i)
    return n < 0 ? s.length : n
  }
  if (c == '/' && s[i + 1] == '*') {
    let n = s.indexOf('*/', i + 2)
    return n < 0 ? s.length : n + 2
  }
  if (c == '"' || c == "'") {
    let j = i + 1
    while (j < s.length && s[j] != c) j += s[j] == '\\' ? 2 : 1
    return j + 1
  }
  if (c == '`') {
    let j = i + 1
    while (j < s.length && s[j] != '`') {
      if (s[j] == '\\') j += 2
      else if (s[j] == '$' && s[j + 1] == '{') {
        let depth = 1
        j += 2
        while (j < s.length && depth) {
          let k = skip(s, j)
          if (k > j) j = k
          else {
            if (s[j] == '{') depth++
            if (s[j] == '}') depth--
            j++
          }
        }
      } else j++
    }
    return j + 1
  }
  return i
}

// The body block of a callback: from the `{` after the call's `=>` (or the
// object arg's `{`), brace-matched past strings and comments. `open` is the
// index of the call's opening `(`.
let bodyFrom = (s: string, open: number): { body: string; end: number } => {
  // find the first `{` that opens a block, skipping strings/comments
  let i = open
  while (i < s.length && s[i] != '{') {
    let k = skip(s, i)
    i = k > i ? k : i + 1
  }
  let depth = 0, start = i
  while (i < s.length) {
    let k = skip(s, i)
    if (k > i) {
      i = k
      continue
    }
    if (s[i] == '{') depth++
    else if (s[i] == '}') {
      depth--
      if (!depth) return { body: s.slice(start, i + 1), end: i + 1 }
    }
    i++
  }
  return { body: s.slice(start), end: s.length }
}

// The name string right after the call's `(` (or `{ name: '...' }` form).
let nameAt = (s: string, open: number): string => {
  let m = s.slice(open, open + 200).match(
    /\(\s*(['"`])(.*?)\1|\(\s*\{\s*name\s*:\s*(['"`])(.*?)\3/s,
  )
  return m ? (m[2] ?? m[4] ?? '') : ''
}

// Every Deno.test(...) and slow(...) block in a source file.
export let blocks = (src: string): Block[] => {
  let out: Block[] = []
  let re = /\b(Deno\.test|slow)\s*\(/g
  for (let m; (m = re.exec(src));) {
    let open = m.index + m[0].length - 1
    let { body, end } = bodyFrom(src, open)
    out.push({
      kind: m[1] == 'slow' ? 'slow' : 'test',
      name: nameAt(src, open),
      body,
      at: src.slice(0, m.index).split('\n').length,
    })
    re.lastIndex = end
  }
  return out
}

// A fixed span inside a body: sleep/delay called on a number, or setTimeout
// with a numeric second arg. tick()/until() and setTimeout(x, 0) are fine.
let BANS: [RegExp, string][] = [
  [/\b(sleep|delay)\s*\(\s*[\dA-Za-z_]/, 'sleep()/delay()'],
  [/\bsetTimeout\s*\([^,)]*,\s*([1-9]\d*|0[.\d]*[1-9])/, 'setTimeout(fn, N)'],
]

let violations = (roots = ['src', 'channels']) => {
  let bad: string[] = []
  for (let root of roots) {
    for (let path of testFiles(root)) {
      let src = Deno.readTextFileSync(path)
      for (let b of blocks(src)) {
        if (b.kind == 'slow') continue // the heavy tier may sleep — that's its job
        for (let [re, what] of BANS) {
          let hit = b.body.match(re)
          if (hit) {
            bad.push(
              `${path}:${b.at}  «${b.name}» — fixed ${what}: ${
                hit[0].trim()
              }\n    use until()/tick() from ./testing.ts, or wrap the test in slow()`,
            )
          }
        }
      }
    }
  }
  return bad
}

if (import.meta.main) {
  let bad = violations()
  if (bad.length) {
    console.error(
      `sleepcheck: ${bad.length} fixed sleep(s) in fast tests:\n\n` +
        bad.join('\n'),
    )
    Deno.exit(1)
  }
  console.log('sleepcheck: no fixed sleeps in fast tests')
}
