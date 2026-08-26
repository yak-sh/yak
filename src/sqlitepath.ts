// The driver-path prelude, its own module so it can evaluate BEFORE
// @db/sqlite in any module graph that needs the ordering statically — a
// worker's graph refuses sqlite.ts's dynamic bare import ("not a
// dependency"), so wsworker.ts imports this, then '@db/sqlite', then
// sqlite.ts, and evaluation order (depth-first, declaration order) makes the
// env var visible when the driver initializes. Linux uses the system library
// because @db/sqlite's bundled x86_64 library crashes during
// sqlite3_initialize on Deno 2.9.
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
