// `deno task gate [--verbose] [test flags and paths...]`: `deno task check`,
// then `deno task test` once it passed. `--verbose` reaches both; the rest is
// the tests'.
let task = async (name: string, args: string[]) =>
  (await new Deno.Command(Deno.execPath(), {
    args: ['task', '-q', name, ...args],
  }).spawn().status).code

let verbose = Deno.args.filter((a) => a == '--verbose')
Deno.exit(await task('check', verbose) || await task('test', Deno.args))
