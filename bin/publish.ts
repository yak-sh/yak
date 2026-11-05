// JSR publication uses the npm workspace's membership and each package's JSR
// metadata, without making that metadata the runtime's import resolver.
import config from '../deno.json' with { type: 'json' }
import workspace from '../package.json' with { type: 'json' }

if (import.meta.main) {
  let path = await Deno.makeTempFile({
    dir: new URL('../', import.meta.url).pathname,
    prefix: '.publish-',
    suffix: '.json',
  })
  try {
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        ...config,
        nodeModulesDir: 'none',
        workspace: workspace.workspaces.map((dir) =>
          './' + dir.replace(/^\.\//, '')
        ),
      }),
    )
    let status = await new Deno.Command(Deno.execPath(), {
      args: [
        'publish',
        '--config',
        path,
        ...Deno.args,
      ],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn().status
    Deno.exitCode = status.code
  } finally {
    await Deno.remove(path)
  }
}
