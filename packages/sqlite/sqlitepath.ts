// Which SQLite library the FFI driver opens, said before the driver loads.
//
// @db/sqlite reaches a NATIVE library through FFI, and when nothing names one
// it downloads a prebuilt. On Linux x86_64 that prebuilt kills the process the
// moment it initializes: `sqlite3_initialize` calls through a null pointer
// inside `sqlite3MallocInit` under Deno 2.9 — a SIGSEGV with an empty stderr,
// before a line of ours runs. Every platform's SYSTEM library is fine, so name
// that instead.
//
// This is its own module because ES evaluation runs a module's dependencies
// before its body, in declaration order: ./db.ts imports this first, then
// '@db/sqlite', so the environment already says the path when the driver
// initializes. Take `Database` from ./db.ts and this ordering is not something
// a caller has to know.

let paths: Record<string, string> = {
  linux: 'libsqlite3.so.0',
  darwin: '/usr/lib/libsqlite3.dylib',
  windows: 'sqlite3.dll',
}

/** The library @db/sqlite will open: what the environment already names, else
 * this platform's system SQLite. */
export let sqlitePath: string = Deno.env.get('DENO_SQLITE_PATH') ??
  paths[Deno.build.os]

if (!sqlitePath) {
  throw new Error(`No system SQLite library for ${Deno.build.os}`)
}
Deno.env.set('DENO_SQLITE_PATH', sqlitePath)
