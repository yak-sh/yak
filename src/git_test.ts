// The projection's commit, on scratch repos: it must take the paths it
// wrote and nothing else — not a neighbour's staged work, not a file git
// never heard of — and a repo that can't commit must cost a report, not a
// throw. Every case builds its own repo, so nothing here touches a live one.
import { assert, assertEquals } from '@std/assert'
import { commit, standing } from './git.ts'

let dec = new TextDecoder()
// stderr is held, not inherited: git narrates harmlessly (an upstream not
// configured yet, an empty clone) and a suite that prints `fatal:` while
// passing teaches everyone to stop reading it. A failure still gets the
// whole of it, which is when it's worth anything.
let sh = async (cwd: string, ...args: string[]) => {
  let { success, stdout, stderr } = await new Deno.Command('git', {
    args: ['-C', cwd, ...args],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  assert(success, `git ${args.join(' ')}\n${dec.decode(stderr)}`)
  return dec.decode(stdout).trim()
}

// The fixture: a repo tracking one projection file and one neighbour the
// projection has no business touching.
let repo = async () => {
  let dir = Deno.realPathSync(Deno.makeTempDirSync())
  await sh(dir, 'init', '-q', '-b', 'main')
  await sh(dir, 'config', 'user.email', 'test@example.com')
  await sh(dir, 'config', 'user.name', 'Test')
  await sh(dir, 'config', 'commit.gpgsign', 'false')
  Deno.mkdirSync(`${dir}/.tasks`)
  Deno.writeTextFileSync(`${dir}/.tasks/AGENTS.md`, 'one\n')
  Deno.writeTextFileSync(`${dir}/other.md`, 'work\n')
  await sh(dir, 'add', '.')
  await sh(dir, 'commit', '-qm', 'init')
  return dir
}
let write = (p: string, body: string) => (Deno.writeTextFileSync(p, body), p)
let script = (path: string, body: string) => {
  Deno.writeTextFileSync(path, body)
  Deno.chmodSync(path, 0o755)
}

// One projection file as commit() hears it. `push` unspoken is the
// default every venture starts on: commit here, and nothing leaves.
let one = (path: string, push?: boolean) => ({ path, push })

Deno.test('commit: takes the paths it wrote, leaves a staged neighbour staged', async () => {
  let dir = await repo()
  try {
    let file = write(`${dir}/.tasks/AGENTS.md`, 'two\n')
    // a concurrent agent's work, half of it staged
    write(`${dir}/other.md`, 'wip\n')
    await sh(dir, 'add', 'other.md')
    assertEquals(await commit([one(file)], 'personas: materialize'), {
      committed: [dir],
      pushed: [],
      untracked: [],
      failed: [],
    })
    // the commit carries exactly the one path
    assertEquals(
      await sh(dir, 'show', '--name-only', '--format=%s', 'HEAD'),
      [
        'personas: materialize',
        '',
        '.tasks/AGENTS.md',
      ].join('\n'),
    )
    // and the neighbour is still staged, still uncommitted
    assertEquals(await sh(dir, 'diff', '--cached', '--name-only'), 'other.md')
    assertEquals(await sh(dir, 'show', 'HEAD:other.md'), 'work')
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('commit: passes over the untracked, the unchanged, and the repo-less', async () => {
  let dir = await repo()
  try {
    let log = () => sh(dir, 'log', '--format=%s')
    let before = await log()
    // git has never heard of this path — writing it is our business,
    // adding it to someone's repo is not
    let fresh = write(`${dir}/.tasks/new.md`, 'hello\n')
    // tracked, but its bytes are HEAD's already: nothing to record
    let same = `${dir}/.tasks/AGENTS.md`
    // no repo at all
    let loose = write(`${Deno.makeTempDirSync()}/AGENTS.md`, 'hello\n')
    let out = await commit(
      [one(fresh), one(same), one(loose)],
      'personas: materialize',
    )
    assertEquals(out, {
      committed: [],
      pushed: [],
      untracked: [fresh, loose],
      failed: [],
    })
    assertEquals(await log(), before)
    assertEquals(await sh(dir, 'status', '--porcelain'), '?? .tasks/new.md')
    Deno.removeSync(loose.slice(0, loose.lastIndexOf('/')), { recursive: true })
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('commit: a repo mid-merge keeps the file and reports the refusal', async () => {
  let dir = await repo()
  try {
    let file = write(`${dir}/.tasks/AGENTS.md`, 'two\n')
    // MERGE_HEAD is the state git itself reads: with one present it
    // refuses any partial commit ("cannot do a partial commit during a
    // merge") — the same wall a live conflict or rebase puts up.
    Deno.writeTextFileSync(
      `${dir}/.git/MERGE_HEAD`,
      await sh(dir, 'rev-parse', 'HEAD'),
    )
    let out = await commit([one(file)], 'personas: materialize')
    assertEquals(out.committed, [])
    assertEquals(out.failed.length, 1)
    assert(out.failed[0].startsWith(`${dir}: `), out.failed[0])
    // the write survives, uncommitted — exactly where we started
    assertEquals(Deno.readTextFileSync(file), 'two\n')
    assertEquals(await sh(dir, 'log', '--format=%s'), 'init')
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

// The fleet's shape: a bare origin, a shared checkout that tracks it, and
// a second clone standing in for everyone who ships by pushing. `tree` is
// the checkout the materializer writes into.
let paired = async () => {
  let base = Deno.realPathSync(Deno.makeTempDirSync())
  let origin = `${base}/origin.git`
  await sh(base, 'init', '--bare', '-q', '-b', 'main', origin)
  let named = async (name: string) => {
    let at = `${base}/${name}`
    await sh(at, 'config', 'user.email', 'test@example.com')
    await sh(at, 'config', 'user.name', 'Test')
    await sh(at, 'config', 'commit.gpgsign', 'false')
    return at
  }
  // `ship` is built rather than cloned: cloning a bare repo before it has
  // a branch warns and leaves git guessing at an upstream that isn't there.
  Deno.mkdirSync(`${base}/ship`)
  await sh(`${base}/ship`, 'init', '-q', '-b', 'main')
  await sh(`${base}/ship`, 'remote', 'add', 'origin', origin)
  let ship = await named('ship')
  Deno.mkdirSync(`${ship}/.tasks`)
  Deno.writeTextFileSync(`${ship}/.tasks/AGENTS.md`, 'one\n')
  Deno.writeTextFileSync(`${ship}/other.md`, 'work\n')
  await sh(ship, 'add', '.')
  await sh(ship, 'commit', '-qm', 'init')
  await sh(ship, 'push', '-q', '-u', 'origin', 'main')
  await sh(base, 'clone', '-q', origin, 'tree')
  let tree = await named('tree')
  return { base, origin, ship, tree, file: `${tree}/.tasks/AGENTS.md` }
}

// What origin has heard. The one question every push test asks — of the
// bare repo itself, so no fetch of ours can flatter the answer.
let landed = (w: { origin: string }) => sh(w.origin, 'rev-parse', 'main')

// Someone ships the normal way, moving origin without touching the tree.
// Which file matters: origin landing on the projection's own path is what
// pins our fresh write against the fast-forward.
let shipped = async (w: { ship: string }, at = 'other.md') => {
  write(`${w.ship}/${at}`, 'a fix nobody here has\n')
  await sh(w.ship, 'commit', '-qam', 'a fix nobody here has')
  await sh(w.ship, 'push', '-q', 'origin', 'main')
}

// One undrained `personas: materialize`, by hand.
let ours = async (w: { tree: string }, body: string) => {
  write(`${w.tree}/.tasks/AGENTS.md`, body)
  await sh(w.tree, 'commit', '-qam', 'personas: materialize')
}

Deno.test('standing: level, ahead, behind, and no upstream at all', async () => {
  let w = await paired()
  try {
    assertEquals(await standing(w.tree), { ahead: 0, behind: 0 })
    await ours(w, 'ours\n')
    assertEquals(await standing(w.tree), { ahead: 1, behind: 0 })
    await shipped(w)
    await sh(w.tree, 'fetch', '-q')
    assertEquals(await standing(w.tree), { ahead: 1, behind: 1 })
  } finally {
    Deno.removeSync(w.base, { recursive: true })
  }
  // A branch with nowhere to be behind answers nothing, never zero — the
  // fixture above, which every other test in this file leans on.
  let solo = await repo()
  try {
    assertEquals(await standing(solo), undefined)
  } finally {
    Deno.removeSync(solo, { recursive: true })
  }
})

Deno.test('commit: behind-only fast-forwards first, then commits', async () => {
  let w = await paired()
  try {
    await shipped(w)
    // The tree has not fetched, so it believes it is level. That belief is
    // the bug: every shared checkout in the fleet reads `0 behind` for
    // exactly this reason, which is why the fetch lives inside the sync.
    assertEquals(await standing(w.tree), { ahead: 0, behind: 0 })

    let file = write(w.file, 'projected\n')
    let out = await commit([one(file)], 'personas: materialize')
    assertEquals(out.failed, [])
    assertEquals(out.committed, [w.tree])
    // Took origin's commit and kept ours on top: nothing discarded, and
    // the tree can now receive a fix from origin at all — the whole point.
    assertEquals(await standing(w.tree), { ahead: 1, behind: 0 })
    assertEquals(
      await sh(w.tree, 'log', '--format=%s'),
      ['personas: materialize', 'a fix nobody here has', 'init'].join('\n'),
    )
    assertEquals(
      Deno.readTextFileSync(`${w.tree}/other.md`),
      'a fix nobody here has\n',
    )
  } finally {
    Deno.removeSync(w.base, { recursive: true })
  }
})

// The case that corrected the first draft of this fix: when origin's
// commit lands on the projection's own path, our fresh write pins the
// working tree and git refuses the fast-forward. Committing anyway is
// precisely how a merely-behind branch becomes a diverged one.
Deno.test('commit: behind on the projection path itself is refused, not forced', async () => {
  let w = await paired()
  try {
    await shipped(w, '.tasks/AGENTS.md')

    let file = write(w.file, 'projected\n')
    let out = await commit([one(file)], 'personas: materialize')
    assertEquals(out.committed, [])
    assertEquals(out.failed.length, 1)
    assert(out.failed[0].includes('1 behind upstream (0 ahead)'), out.failed[0])

    // Behind, but NOT diverged: `git pull --ff-only` still repairs this
    // tree once the projection write is out of the way.
    assertEquals(await standing(w.tree), { ahead: 0, behind: 1 })
    assertEquals(Deno.readTextFileSync(file), 'projected\n')
    assertEquals(await sh(w.tree, 'log', '--format=%s'), 'init')
  } finally {
    Deno.removeSync(w.base, { recursive: true })
  }
})

Deno.test('commit: a diverged branch is refused, the file stays written', async () => {
  let w = await paired()
  try {
    await ours(w, 'ours\n')
    await shipped(w)

    let file = write(w.file, 'projected\n')
    let out = await commit([one(file)], 'personas: materialize')
    assertEquals(out.committed, [])
    assertEquals(out.failed.length, 1)
    assert(out.failed[0].includes('1 behind upstream (1 ahead)'), out.failed[0])

    // The contract: on disk, absent from history, and the fork no deeper
    // than it already was — repairable, not compounding.
    assertEquals(Deno.readTextFileSync(file), 'projected\n')
    assertEquals(await standing(w.tree), { ahead: 1, behind: 1 })
    assertEquals(
      await sh(w.tree, 'log', '--format=%s'),
      ['personas: materialize', 'init'].join('\n'),
    )
  } finally {
    Deno.removeSync(w.base, { recursive: true })
  }
})

// Ungranted is the default, and the default is that origin never hears
// from us — not for the commit we just made, not for the chain behind it.
// A venture the graph knows nothing about lands here too: absent reads as
// no, which is the only reading that can't deploy something by accident.
Deno.test('commit: ahead-only commits, and without the grant nothing leaves', async () => {
  let w = await paired()
  try {
    await ours(w, 'ours\n')
    let was = await landed(w)
    let file = write(w.file, 'projected\n')
    // A second projection file in the same checkout, granted — one file's
    // yes can't speak for a repo another file says nothing about.
    let out = await commit(
      [one(write(`${w.tree}/other.md`, 'projected too\n'), true), one(file)],
      'personas: materialize',
    )
    assertEquals(out.failed, [])
    assertEquals(out.committed, [w.tree])
    assertEquals(out.pushed, [])
    assertEquals(await standing(w.tree), { ahead: 2, behind: 0 })
    assertEquals(await landed(w), was)
  } finally {
    Deno.removeSync(w.base, { recursive: true })
  }
})

// The grant, and what it is for: the chain goes, and the tree that has
// been reading `N ahead` for months reads level again.
Deno.test('commit: a granted push drains the whole chain and levels the tree', async () => {
  let w = await paired()
  try {
    await ours(w, 'two\n')
    await ours(w, 'three\n')
    assertEquals(await standing(w.tree), { ahead: 2, behind: 0 })

    let file = write(w.file, 'projected\n')
    let out = await commit([one(file, true)], 'personas: materialize')
    assertEquals(out.failed, [])
    assertEquals(out.committed, [w.tree])
    assertEquals(out.pushed, [w.tree])
    assertEquals(await standing(w.tree), { ahead: 0, behind: 0 })
    assertEquals(await landed(w), await sh(w.tree, 'rev-parse', 'HEAD'))
  } finally {
    Deno.removeSync(w.base, { recursive: true })
  }
})

// The backlog drains even when this run has nothing to write, which is
// what makes the grant self-healing: no hand repair, no sweep — the next
// persona edit anywhere is what empties the repo that was left behind.
Deno.test('commit: the grant drains a chain with nothing left to write', async () => {
  let w = await paired()
  try {
    await ours(w, 'projected\n')
    let out = await commit([one(w.file, true)], 'personas: materialize')
    assertEquals(out.committed, [])
    assertEquals(out.pushed, [w.tree])
    assertEquals(out.failed, [])
    assertEquals(await standing(w.tree), { ahead: 0, behind: 0 })
  } finally {
    Deno.removeSync(w.base, { recursive: true })
  }
})

// A protected branch is not stale: fetching cannot make its policy change,
// so retrying would only ask the same forbidden question twice.
Deno.test('commit: a persistent refusal is reported without retrying', async () => {
  let w = await paired()
  try {
    let hook = `${w.origin}/hooks/pre-receive`
    script(
      hook,
      '#!/bin/sh\nprintf x >> "$GIT_DIR/tries"\necho "fetch first" >&2\nexit 1\n',
    )
    let was = await landed(w)

    let file = write(w.file, 'projected\n')
    let out = await commit([one(file, true)], 'personas: materialize')
    assertEquals(out.committed, [w.tree])
    assertEquals(out.pushed, [])
    assertEquals(out.failed.length, 1)
    assert(out.failed[0].includes('push refused'), out.failed[0])
    assert(!out.failed[0].endsWith('()'), out.failed[0])

    assertEquals(Deno.readTextFileSync(`${w.origin}/tries`), 'x')
    assertEquals(await landed(w), was)
    assertEquals(await standing(w.tree), { ahead: 1, behind: 0 })
  } finally {
    Deno.removeSync(w.base, { recursive: true })
  }
})

// Move main from pre-push, after the caller reads the advertised ref but before
// its update arrives. The next fetch sees the winner, and one rebase can retain
// both commits before the retry publishes ours.
Deno.test('commit: a stale push rebases and retries once', async () => {
  let w = await paired()
  try {
    write(`${w.ship}/other.md`, 'the winning push\n')
    await sh(w.ship, 'commit', '-qam', 'the winning push')
    let winner = await sh(w.ship, 'rev-parse', 'HEAD')
    let tried = `${w.base}/tried`
    let tries = `${w.base}/tries`
    script(
      `${w.tree}/.git/hooks/pre-push`,
      '#!/bin/sh\n' +
        `printf x >> "${tries}"\n` +
        `if test ! -e "${tried}"; then\n` +
        `  touch "${tried}"\n` +
        `  git -C "${w.ship}" push -q origin main\n` +
        'fi\n' +
        'exit 0\n',
    )

    let file = write(w.file, 'projected\n')
    let out = await commit([one(file, true)], 'personas: materialize')
    assertEquals(out.committed, [w.tree])
    assertEquals(out.pushed, [w.tree])
    assertEquals(out.failed, [])
    assertEquals(Deno.readTextFileSync(tries), 'xx')
    assertEquals(await standing(w.tree), { ahead: 0, behind: 0 })
    assertEquals(await landed(w), await sh(w.tree, 'rev-parse', 'HEAD'))
    assertEquals(await sh(w.tree, 'rev-parse', 'HEAD^'), winner)
  } finally {
    Deno.removeSync(w.base, { recursive: true })
  }
})

Deno.test('commit: a second stale push reports its reason and stops', async () => {
  let w = await paired()
  try {
    write(`${w.ship}/other.md`, 'the first winning push\n')
    await sh(w.ship, 'commit', '-qam', 'the first winning push')
    await sh(w.ship, 'branch', 'first')
    write(`${w.ship}/other.md`, 'the second winning push\n')
    await sh(w.ship, 'commit', '-qam', 'the second winning push')
    let tried = `${w.base}/tried`
    let tries = `${w.base}/tries`
    script(
      `${w.tree}/.git/hooks/pre-push`,
      '#!/bin/sh\n' +
        `printf x >> "${tries}"\n` +
        `if test ! -e "${tried}"; then\n` +
        `  touch "${tried}"\n` +
        `  git -C "${w.ship}" push -q origin first:main\n` +
        'else\n' +
        `  git -C "${w.ship}" push -q origin main\n` +
        'fi\n' +
        'exit 0\n',
    )

    let file = write(w.file, 'projected\n')
    let out = await commit([one(file, true)], 'personas: materialize')
    assertEquals(out.committed, [w.tree])
    assertEquals(out.pushed, [])
    assertEquals(out.failed.length, 1)
    assert(out.failed[0].startsWith(`${w.tree}: push retry refused (`))
    assert(!out.failed[0].endsWith('()'), out.failed[0])
    assertEquals(Deno.readTextFileSync(tries), 'xx')
  } finally {
    Deno.removeSync(w.base, { recursive: true })
  }
})

// The grant is permission to drain, never permission to overrun: a tree
// that is behind still declines, still keeps the write on disk, and still
// tells origin nothing.
Deno.test('commit: the grant does not weaken the refusal to commit onto a behind branch', async () => {
  let w = await paired()
  try {
    await shipped(w, '.tasks/AGENTS.md')
    let was = await landed(w)

    let file = write(w.file, 'projected\n')
    let out = await commit([one(file, true)], 'personas: materialize')
    assertEquals(out.committed, [])
    assertEquals(out.pushed, [])
    assertEquals(out.failed.length, 1)
    assert(out.failed[0].includes('1 behind upstream (0 ahead)'), out.failed[0])
    assertEquals(Deno.readTextFileSync(file), 'projected\n')
    assertEquals(await landed(w), was)
  } finally {
    Deno.removeSync(w.base, { recursive: true })
  }
})
