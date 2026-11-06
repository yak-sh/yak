import * as system from '@yaks/process/system'
// Which SQLite library the FFI driver opens (./ffi/ffi.ts): the one the
// environment names, else the system's.
//
// Never upstream @db/sqlite's prebuilt. On Linux x86_64 it kills the process
// the moment it initializes: `sqlite3_initialize` calls through a null pointer
// inside `sqlite3MallocInit` under Deno 2.9 — a SIGSEGV with an empty stderr,
// before a line of ours runs. A library linked without -Bsymbolic crashes the
// same way under a Deno that links the system's libsqlite3 (Homebrew's does):
// that library's API is in the process first, and the second library's calls
// to its own functions bind to it. Every platform's system library is fine.
// This repository's tests name one SQLite built one way, wherever they run
// (bin/sqlite.ts).

let paths: Record<string, string> = {
  linux: 'libsqlite3.so.0',
  darwin: '/usr/lib/libsqlite3.dylib',
  windows: 'sqlite3.dll',
}

/** The library the driver opens: what the environment already names, else
 * this platform's system SQLite. */
export let sqlitePath: string = system.env.get('DENO_SQLITE_PATH') ??
  paths[system.os]

if (!sqlitePath) {
  throw new Error(`No system SQLite library for ${system.os}`)
}
