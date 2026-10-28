// The SQLite the repository's tests run on, wherever they run: one version,
// built one way. A machine's own library is whatever its package manager last
// installed (the box's Homebrew had 3.53.3, the gate's runner Ubuntu's 3.46.1
// with other options), and a query's plan, and the VM steps a cost test
// counts, are that library's: a bound that held where an agent landed failed
// on main's gate (T-132932). So the source and its options are pinned here,
// and `library()` builds it once into the user's cache, where every checkout
// on the machine finds it. bin/test.ts hands it to every test runtime by
// `DENO_SQLITE_PATH`, which @yaks/sqlite honors (packages/sqlite/sqlitepath.ts).
//
// The options are Homebrew's for 3.53.3, which the box's processes ran on,
// with what SQLite's own configure adds to them, so a query plans as it did.
// The library is linked -Bsymbolic: Deno exports its embedded SQLite's API
// (`nm -D` lists sqlite3_free, sqlite3_mutex_alloc and eighty more), and a
// library linked without it binds its own calls to those, so Deno's copy runs
// half of it; one built that way crashes in sqlite3MallocInit on its first
// call.
//
//   deno run -A bin/sqlite.ts    # builds it when absent and says its path

export let VERSION = '3.53.3'

let SOURCE = 'https://www.sqlite.org/2026/sqlite-autoconf-3530300.tar.gz'
let SHA256 = 'c917d7db16648ec95f714974ace5e5dcf46b7dc70e26600a0a102a3141125db0'

export let OPTIONS = [
  'API_ARMOR',
  'COLUMN_METADATA',
  'DBSTAT_VTAB',
  'FTS3',
  'FTS3_PARENTHESIS',
  'FTS5',
  'GEOPOLY',
  'MATH_FUNCTIONS',
  'MEMORY_MANAGEMENT',
  'PERCENTILE',
  'PREUPDATE_HOOK',
  'RTREE',
  'SESSION',
  'STAT4',
  'UNLOCK_NOTIFY',
].map((o) => `-DSQLITE_ENABLE_${o}`).concat(
  '-DSQLITE_MAX_VARIABLE_NUMBER=250000',
  '-DSQLITE_USE_URI=1',
  '-DSQLITE_THREADSAFE=1',
)

let mac = Deno.build.os == 'darwin'
let LINK = mac ? ['-dynamiclib'] : ['-shared', '-Wl,-Bsymbolic']
let FILE = mac ? 'libsqlite3.dylib' : 'libsqlite3.so'

let hex = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')

/** Where this build lives: its version and a digest of how it is built, so
 * a change to either is a library of its own. */
export let place = async (
  cache = Deno.env.get('XDG_CACHE_HOME') ?? `${Deno.env.get('HOME')}/.cache`,
) => {
  let how = new TextEncoder().encode([SHA256, ...OPTIONS, ...LINK].join(' '))
  return `${cache}/yak/sqlite/${VERSION}-${(await hex(how)).slice(0, 12)}`
}

let run = async (cmd: string, args: string[], cwd: string) => {
  let out = await new Deno.Command(cmd, { args, cwd, stderr: 'piped' })
    .output()
  if (!out.success) {
    throw new Error(
      `${cmd} ${args[0]} failed building SQLite ${VERSION}: ${
        new TextDecoder().decode(out.stderr).trim()
      }`,
    )
  }
}

// Fetch, check, unpack the amalgamation alone, compile, and put the library
// in place by a rename, so a run that builds beside another finds it whole.
let build = async (dir: string) => {
  let work = `${dir}.${Deno.pid}`
  await Deno.mkdir(work, { recursive: true })
  try {
    let got = await fetch(SOURCE)
    if (!got.ok) throw new Error(`${SOURCE}: ${got.status}`)
    let bytes = new Uint8Array(await got.arrayBuffer())
    if (await hex(bytes) != SHA256) {
      throw new Error(`${SOURCE} is not the source pinned (sha256 differs)`)
    }
    await Deno.writeFile(`${work}/source.tar.gz`, bytes)
    let member = `${SOURCE.split('/').at(-1)!.replace('.tar.gz', '')}/sqlite3.c`
    await run(
      'tar',
      ['-xzf', 'source.tar.gz', '--strip-components=1', member],
      work,
    )
    await run(
      'cc',
      ['-O2', '-fPIC', ...LINK, '-o', FILE, 'sqlite3.c', ...OPTIONS, '-lm'],
      work,
    )
    await Deno.mkdir(dir, { recursive: true })
    await Deno.rename(`${work}/${FILE}`, `${dir}/${FILE}`)
  } finally {
    await Deno.remove(work, { recursive: true }).catch(() => {})
  }
}

/** The pinned library's path, built first when this machine has none. */
export let library = async (cache?: string): Promise<string> => {
  let dir = await place(cache)
  let path = `${dir}/${FILE}`
  if (!await Deno.stat(path).then(() => true, () => false)) await build(dir)
  return path
}

if (import.meta.main) console.log(await library())
