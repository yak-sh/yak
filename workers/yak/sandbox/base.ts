// The sandbox toolchain image, built explicitly when its Dockerfile changes.
// Worker deploys name its immutable registry tag and never build it. The CLI
// workspace is a Worker asset, downloaded by sandbox/launch.ts on first use.

import { sha256 } from '@yaks/graph/sha256'

export let REGISTRY = 'registry.cloudflare.com'

let here = (name: string) => new URL(`./${name}`, import.meta.url)

/** The tag base/Dockerfile is pushed under: `base-` and 16 hex of its hash. */
export let tag = (dockerfile: string) =>
  'base-' + sha256(dockerfile).slice(0, 16)

/** The stable sandbox image named by the Worker config. */
export let pinned = (dockerfile: string) =>
  /^image = "([^"]+)"$/m.exec(dockerfile)?.[1]

type Run = (cmd: string[], input?: string) => Promise<
  { ok: boolean; out: string }
>

let run: Run = async ([cmd, ...args], input) => {
  let child = new Deno.Command(cmd, {
    args,
    stdin: input == null ? 'null' : 'piped',
    stdout: 'piped',
    stderr: 'inherit',
  }).spawn()
  if (input != null) {
    let w = child.stdin.getWriter()
    await w.write(new TextEncoder().encode(input))
    await w.close()
  }
  let { success, stdout } = await child.output()
  return { ok: success, out: new TextDecoder().decode(stdout) }
}

/** Whether the registry holds `ref`, asked over its own HTTP API rather than
 * `docker manifest`, whose answer for "missing" and "could not ask" is the
 * same exit code: a base taken for missing would be built and pushed again on
 * every deploy, which is the cost this file exists to remove. */
let held = async (ref: string, password: string) => {
  let [, account, name] = ref.split('/')
  let [repo, tag] = name.split(':')
  let r = await fetch(
    `https://${REGISTRY}/v2/${account}/${repo}/manifests/${tag}`,
    {
      method: 'HEAD',
      headers: {
        Authorization: 'Basic ' + btoa(`v1:${password}`),
        Accept: [
          'application/vnd.oci.image.index.v1+json',
          'application/vnd.oci.image.manifest.v1+json',
          'application/vnd.docker.distribution.manifest.v2+json',
          'application/vnd.docker.distribution.manifest.list.v2+json',
        ].join(', '),
      },
    },
  )
  if (r.status == 404) return false
  if (r.ok) return true
  throw new Error(`${REGISTRY} answered ${r.status} for ${ref}`)
}

/** The build wrangler runs for an image, so the base is built the same way.
 * On Workers Builds a build container resolves no host without the host's
 * network, which wrangler adds when the build environment says so. */
let BUILD = [
  ...['docker', 'build', '--load', '--platform', 'linux/amd64'],
  '--provenance=false',
]

let must = async (go: Run, cmd: string[], input?: string) => {
  let r = await go(cmd, input)
  if (!r.ok) throw new Error(`${cmd.slice(0, 3).join(' ')} failed`)
  return r.out
}

/**
 * Provision the toolchain before landing a changed image pin. A dry run
 * builds it and pushes nothing; Worker uploads never call this boundary.
 * `wrangler` is the argv prefix that runs this Worker's pinned wrangler.
 */
export let based = async (
  { wrangler, dry = false, go = run, has = held }: {
    wrangler: string[]
    dry?: boolean
    go?: Run
    has?: (ref: string, password: string) => Promise<boolean>
  },
) => {
  let want = tag(await Deno.readTextFile(here('base/Dockerfile')))
  let from = pinned(await Deno.readTextFile(here('../wrangler.toml')))
  if (!from?.endsWith(':' + want)) {
    throw new Error(
      `wrangler.toml names ${from}, but base/Dockerfile is ${want}`,
    )
  }
  return await imaged({
    wrangler,
    dry,
    go,
    has,
    ref: from,
    pull: true,
    context: here('base').pathname,
  })
}

/** Ensure one source-addressed image exists, independently of Worker uploads.
 * `pull` also authenticates Docker for a later build that reads this image. */
export let imaged = async (
  {
    wrangler,
    context,
    dockerfile,
    ref,
    name,
    dry = false,
    pull = false,
    go = run,
    has = held,
  }: {
    wrangler: string[]
    context: string
    dockerfile?: string
    ref?: string
    name?: string
    dry?: boolean
    pull?: boolean
    go?: Run
    has?: (ref: string, password: string) => Promise<boolean>
  },
) => {
  let { username, password, account_id } = JSON.parse(
    await must(go, [
      ...wrangler,
      ...['containers', 'registries', 'credentials', REGISTRY],
      ...['--pull', '--push', '--expiration-minutes', '60', '--json'],
    ]),
  )
  let from = ref ?? `${REGISTRY}/${account_id}/${name}`
  if (!from.startsWith(`${REGISTRY}/${account_id}/`)) {
    throw new Error(`${from} is not in this account's registry`)
  }
  let login = () =>
    must(
      go,
      ['docker', 'login', '--password-stdin', '--username', username, REGISTRY],
      password,
    )
  // A held sibling image needs no Docker operation. The sandbox base also
  // authenticates its later pull, overlapping login with the registry read
  // and settling both even when either fails.
  let [logged, checked] = await Promise.allSettled([
    pull ? login() : Promise.resolve(),
    has(from, password),
  ])
  if (logged.status == 'rejected') throw logged.reason
  if (checked.status == 'rejected') throw checked.reason
  if (checked.value) return from
  if (!pull) await login()
  await must(go, [
    ...BUILD,
    '-t',
    from,
    ...dockerfile ? ['-f', dockerfile] : [],
    ...Deno.env.get('WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST')
      ? ['--network', 'host']
      : [],
    context,
  ])
  if (dry) return from
  // The push is what timed out; a second or third try resumes it, since the
  // layers that made it already exist.
  for (let i = 0; i < 3; i++) {
    if ((await go(['docker', 'push', from])).ok) return from
  }
  throw new Error(`docker push ${from} failed three times`)
}

if (import.meta.main) {
  let { WRANGLER } = await import('../wrangler.ts')
  console.log(
    await based({ wrangler: WRANGLER, dry: Deno.args.includes('--dry-run') }),
  )
}
