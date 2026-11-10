// Read every public table of a pg_dump custom-format file as JSON rows.
// The dump is restored into a throwaway PostgreSQL container, so column types
// (bigint ids, jsonb, booleans, timestamps) come back as Postgres renders them
// in JSON, never parsed from COPY text here.
//
//   deno run -A bin/pg-export.ts <dump> <out.json> [--image postgres:18]

let [dump, out] = Deno.args.filter((a) => !a.startsWith('--'))
let image = Deno.args.find((a) => a.startsWith('--image='))?.slice(8) ??
  'postgres:18'
if (!dump || !out) {
  throw new Error('Usage: deno run -A bin/pg-export.ts <dump> <out.json>')
}

let run = async (...args: string[]): Promise<string> => {
  let result = await new Deno.Command('docker', { args, stderr: 'piped' })
    .output()
  if (!result.success) {
    throw new Error(
      `docker ${args[0]} failed: ${new TextDecoder().decode(result.stderr)}`,
    )
  }
  return new TextDecoder().decode(result.stdout).trim()
}
let sql = (container: string, query: string) =>
  run(
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    query,
  )

let container = await run(
  'run',
  '-d',
  '--rm',
  '-e',
  'POSTGRES_HOST_AUTH_METHOD=trust',
  '-v',
  `${await Deno.realPath(dump)}:/source.dump:ro`,
  image,
)
try {
  for (let i = 0;; i++) {
    let ready = await new Deno.Command('docker', {
      args: ['exec', container, 'pg_isready', '-U', 'postgres'],
      stdout: 'null',
      stderr: 'null',
    }).output()
    if (ready.success) break
    if (i > 60) throw new Error('PostgreSQL did not start')
    await new Promise((r) => setTimeout(r, 1000))
  }
  // The image's entrypoint restarts the server once after initdb.
  await new Promise((r) => setTimeout(r, 2000))
  await run(
    'exec',
    '-u',
    'root',
    container,
    'pg_restore',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--no-owner',
    '--no-acl',
    '--exit-on-error',
    '/source.dump',
  )
  let names = (await sql(
    container,
    "select tablename from pg_tables where schemaname = 'public' order by 1",
  )).split('\n').filter(Boolean)
  let tables: Record<string, unknown[]> = {}
  for (let name of names) {
    let quoted = '"' + name.replaceAll('"', '""') + '"'
    tables[name] = JSON.parse(
      await sql(
        container,
        `select coalesce(json_agg(t), '[]') from public.${quoted} t`,
      ),
    )
  }
  await Deno.writeTextFile(out, JSON.stringify(tables), { mode: 0o600 })
  console.log(JSON.stringify(Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.length]),
  )))
} finally {
  await run('stop', container).catch(() => {})
}
