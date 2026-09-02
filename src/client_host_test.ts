// The Deno half of the wire client: the worktree climb and the @file / pipe
// grammar, tested against a filesystem and fake pipes.
import { assertEquals, assertThrows } from '@std/assert'
import { inflate, separated, unreadPipe, worktreeRoot } from './client_host.ts'

Deno.test('worktreeRoot: a linked worktree resolves, a main checkout does not', async () => {
  let base = await Deno.makeTempDir()
  // a linked worktree: .git is a FILE (a gitdir: pointer)
  let wt = `${base}/wt`
  await Deno.mkdir(`${wt}/sub`, { recursive: true })
  await Deno.writeTextFile(`${wt}/.git`, 'gitdir: /x/.git/worktrees/wt')
  assertEquals(worktreeRoot(wt), wt)
  assertEquals(worktreeRoot(`${wt}/sub`), wt) // from a subdir, still the root
  // a main checkout: .git is a DIRECTORY everyone shares → not one agent's
  let main = `${base}/main`
  await Deno.mkdir(`${main}/.git`, { recursive: true })
  assertEquals(worktreeRoot(main), undefined)
  await Deno.remove(base, { recursive: true })
})

let p = (value: string) => ({ comp: 'doc', prop: 'body', value })
let pipe = (terminal = false) => ({
  terminal: () => terminal,
  read: () => ' the whole brief\n',
})

Deno.test('inflate: @ reads the file loudly, @@ is a literal, plain rides', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole brief\n')
  assertEquals(inflate(p(`@${f}`)).value, 'the whole brief\n')
  assertEquals(inflate(p('@@handle')).value, '@handle')
  assertEquals(inflate(p('plain')).value, 'plain')
  assertThrows(() => inflate(p('@/no/such/file')), Error, 'no such file')
  Deno.removeSync(f)
})

Deno.test('inflate: @- is the pipe — the same door as @file, trimmed', () => {
  assertEquals(inflate(p('@-'), pipe()).value, 'the whole brief')
  // a bare - is the same ask, not a one-character string: the spelling
  // --body already answered, so it means the pipe at every door.
  assertEquals(inflate(p('-'), pipe()).value, 'the whole brief')
})

Deno.test('inflate: only an EXACT - is the pipe, a hyphen in prose is prose', () => {
  for (let v of ['a-b', '-x', '--', '- ', ' -', '-\n-']) {
    assertEquals(inflate(p(v), pipe()).value, v)
  }
})

Deno.test('inflate: a bare - with no pipe fails fast, it never waits', () => {
  let read = 0
  let io = { terminal: () => true, read: () => (read++, 'nope') }
  assertThrows(() => inflate(p('-'), io), Error, '.body=-: stdin is a TTY')
  assertEquals(read, 0)
  // and an empty pipe is refused the same as @-'s: clearing is `.prop=`.
  assertThrows(
    () => inflate(p('-'), { terminal: () => false, read: () => '  \n' }),
    Error,
    '.body=-: stdin was empty',
  )
})

Deno.test('inflate: a TTY fails fast, it never waits on the pipe', () => {
  let read = 0
  let io = { terminal: () => true, read: () => (read++, 'nope') }
  assertThrows(() => inflate(p('@-'), io), Error, '.body=@-: stdin is a TTY')
  assertEquals(read, 0)
})

Deno.test('inflate: stdin is consumable once — the second @- is refused', () => {
  let io = pipe()
  assertEquals(inflate(p('@-'), io).value, 'the whole brief')
  // the second read would come back EMPTY, and an empty value clears the
  // column — the failure that wiped four session briefs.
  assertThrows(
    () => inflate({ comp: 'doc', prop: 'title', value: '@-' }, io),
    Error,
    '.title=@-: stdin was already read by .body=@-',
  )
})

Deno.test('inflate: the refusal names the token that drank the pipe', () => {
  let io = pipe()
  assertEquals(inflate(p('-'), io, '--body=-').value, 'the whole brief')
  assertThrows(
    () => inflate(p('@-'), io),
    Error,
    '.body=@-: stdin was already read by --body=-',
  )
})

Deno.test('inflate: an empty pipe is refused, never a silent clear', () => {
  let io = { terminal: () => false, read: () => '  \n' }
  assertThrows(() => inflate(p('@-'), io), Error, '.body=@-: stdin was empty')
})

Deno.test('unreadPipe: a piped stdin no door drank — never a TTY, never a read', () => {
  let read = 0
  let io = { terminal: () => false, read: () => (read++, 'x') }
  // A heredoc piped without .body=@- — the drop this catches.
  assertEquals(unreadPipe(io), true)
  // A door already drank it: not unread.
  assertEquals(unreadPipe({ ...io, taken: '.body=@-' }), false)
  // A TTY is not a pipe, so nothing was dropped.
  assertEquals(unreadPipe({ ...io, terminal: () => true }), false)
  // It decides by looking, never by reading — a slurp here is the T-5854 hang.
  assertEquals(read, 0)
})

Deno.test('inflate: errors name the token the caller typed', () => {
  assertThrows(
    () => inflate(p('@/no/such/file'), pipe(), '--body=@/no/such/file'),
    Error,
    '--body=@/no/such/file: no such file',
  )
})

// T-10612: a dropped @ stored the path as the whole body and the door
// printed its receipt. Two operators lost content to it independently.
Deno.test('inflate: a dropped @ on an existing file is refused, not stored', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole brief\n')
  assertThrows(() => inflate(p(f)), Error, 'names a file that exists')
  assertThrows(() => inflate(p(f)), Error, `did you mean @${f}`)
  // The @ door still works, which is what earns the suggestion its place.
  assertEquals(inflate(p(`@${f}`)).value, 'the whole brief\n')
  Deno.removeSync(f)
})

Deno.test('inflate: the dropped-@ guard is too narrow to overshoot', () => {
  let f = Deno.makeTempFileSync()
  // A path that does NOT exist stays storable text.
  assertEquals(inflate(p('/no/such/file.md')).value, '/no/such/file.md')
  // Prose merely MENTIONING a path is prose — the token must stand alone.
  assertEquals(inflate(p(`see ${f} for it`)).value, `see ${f} for it`)
  // Only `body`: a filesystem path is the whole point of repo.path.
  assertEquals(inflate({ comp: 'repo', prop: 'path', value: f }).value, f)
  // A bare word never trips, even standing beside a file of that name. The
  // stat is the POSITIVE CONTROL: if cwd moved, this fails loudly rather
  // than passing because the file was simply absent.
  assertEquals(Deno.statSync('README.md').isFile, true)
  assertEquals(inflate(p('README.md')).value, 'README.md')
  Deno.removeSync(f)
})

// The body flag handed over AS the body. The dropped-@ guard cannot see it —
// '.body=@/tmp/x' does not stat as a file — so it sailed through as prose and
// mailed a launch-gating ruling as its own file path.
Deno.test('inflate: a body flag in the value position is refused, not stored', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole ruling\n')
  for (let said of [`.body=@${f}`, `--body=@${f}`, `body=@${f}`]) {
    assertThrows(() => inflate(p(said)), Error, 'body flag in the value')
    assertThrows(() => inflate(p(said)), Error, `Pass just '@${f}'`)
  }
  // The POSITIVE CONTROL for the suggestion: the remainder it names really
  // does read the file, so the error is not sending anyone to a dead door.
  assertEquals(inflate(p(`@${f}`)).value, 'the whole ruling\n')
  Deno.removeSync(f)
})

Deno.test('inflate: the body-flag guard is too narrow to overshoot', () => {
  // Prose that merely opens with the word is prose — the token must stand
  // alone, and these hold whitespace.
  assertEquals(inflate(p('.body=@x is the door')).value, '.body=@x is the door')
  // A remainder is required, so the bare flag stays storable as text.
  assertEquals(inflate(p('.body=')).value, '.body=')
  // Only `body`: another prop carrying the same shape is left alone.
  let other = { comp: 'repo', prop: 'path', value: '.body=@/tmp/x' }
  assertEquals(inflate(other).value, '.body=@/tmp/x')
  // It does not require the remainder to be a FILE: the content is lost
  // either way, and a stale path is exactly when a loud refusal earns most.
  assertThrows(() => inflate(p('.body=@/no/such/file.md')), Error, 'Pass just')
})

// T-10873: the last hole in the family — a body flag with a space instead of
// '='. Not a flag, not a dot-param, and two tokens, so every guard above is
// structurally blind to it.
Deno.test('separated: a body flag with a space instead of = is refused', () => {
  let f = Deno.makeTempFileSync()
  for (let flag of ['.body', '--body', '-body', 'body']) {
    assertThrows(
      () => separated([flag, `@${f}`]),
      Error,
      "space instead of '='",
    )
    assertThrows(() => separated([flag, f]), Error, `the body is '${f}'`)
  }
  Deno.removeSync(f)
})

Deno.test('separated: too narrow to touch prose', () => {
  let f = Deno.makeTempFileSync()
  // Three tokens is prose, whatever it opens with.
  assertEquals(separated(['.body', 'takes', 'a', 'file']), undefined)
  // A second token that is neither a reference nor a file it could have meant.
  assertEquals(separated(['.body', 'somenote']), undefined)
  // A first token that is not a body flag at all.
  assertEquals(separated(['.title', `@${f}`]), undefined)
  assertEquals(separated([f]), undefined)
  Deno.removeSync(f)
})
