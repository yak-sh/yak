// The driver-path prelude, its own module so it can evaluate BEFORE
// @db/sqlite in any module graph that needs the ordering statically — a
// worker's graph refuses a dynamic bare import ("not a dependency"), so
// store/sqlite.ts imports this, then '@db/sqlite', and evaluation order
// (depth-first, declaration order) makes the env var visible when the driver
// initializes. Linux uses the system library
// because @db/sqlite's bundled x86_64 library crashes during
// sqlite3_initialize on Deno 2.9.
//
// TODO(T-34183): only src/ comes through here. The eight test harnesses in
// packages/ import '@db/sqlite' directly, so on Linux they load the bundled
// library and segfault — which nobody saw, because an interactive shell on
// this box happens to carry DENO_SQLITE_PATH and every run inherited it. The
// `test:packages` task exports it instead, which is a second copy of the table
// below; the fix is for those harnesses to take their Database from one
// prelude the way store/sqlite.ts does, and then that export comes out again.
let paths: Record<string, string> = {
  linux: 'libsqlite3.so.0',
  darwin: '/usr/lib/libsqlite3.dylib',
  windows: 'sqlite3.dll',
}
export let sqlitePath = Deno.env.get('DENO_SQLITE_PATH') ??
  paths[Deno.build.os]
if (!sqlitePath) {
  throw new Error(`No system SQLite library for ${Deno.build.os}`)
}
Deno.env.set('DENO_SQLITE_PATH', sqlitePath)
