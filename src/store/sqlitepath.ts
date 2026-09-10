// The driver-path prelude, its own module so it can evaluate BEFORE
// @db/sqlite in any module graph that needs the ordering statically — a
// worker's graph refuses a dynamic bare import ("not a dependency"), so
// store/sqlite.ts imports this, then '@db/sqlite', and evaluation order
// (depth-first, declaration order) makes the env var visible when the driver
// initializes. Linux uses the system library
// because @db/sqlite's bundled x86_64 library crashes during
// sqlite3_initialize on Deno 2.9.
//
// packages/ has the same prelude of its own (@yaks/sqlite/db, T-34183) rather
// than importing this one: a worker's module graph resolves no bare specifier,
// so store/sqlite.ts — which a worker may pull in — can reach only relative
// files and fully qualified ones. Two small copies of the table below, one per
// side of that seam; packages/sqlite/sqlitepath_test.ts holds the rule that
// makes either of them worth anything.
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
