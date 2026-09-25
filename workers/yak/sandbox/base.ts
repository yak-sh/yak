// The sandbox image's toolchain half (T-38057): base/Dockerfile, built and
// pushed once per version of that file instead of on every deploy. Workers
// Builds keeps no layer cache, so the one-file image downloaded every toolchain
// again on each push to main and pushed about nine fresh layers of it, and
// that is where builds failed: a go.dev 404, registry push timeouts.
//
// The base's tag is its Dockerfile's own hash, so one tag never names two
// images and nothing has to be repinned after a push: ./Dockerfile's FROM
// names `base-<hash>`, sandbox_test.ts holds that pin to the file, and
// `based()` runs before a deploy builds the image (wrangler.ts). It signs
// docker in to the registry, since the build pulls the base before wrangler
// signs in to push, and it builds and pushes the base when its tag is missing.
// Staging builds FROM the same tag: the registry shares layers across an
// account's repositories, so staging's push finds every base layer already
// there.

export let REGISTRY = 'registry.cloudflare.com'

let here = (name: string) => new URL(`./${name}`, import.meta.url)

/** The tag base/Dockerfile is pushed under: `base-` and 16 hex of its hash. */
export let tag = async (dockerfile: string) => {
  let sum = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(dockerfile),
  )
  let hex = [...new Uint8Array(sum)]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  return 'base-' + hex.slice(0, 16)
}

/** The image ./Dockerfile builds FROM, as its FROM line names it. */
export let pinned = (dockerfile: string) =>
  /^FROM (\S+)$/m.exec(dockerfile)?.[1]

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
let context = () => [
  ...Deno.env.get('WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST')
    ? ['--network', 'host']
    : [],
  here('base').pathname,
]

let must = async (go: Run, cmd: string[], input?: string) => {
  let r = await go(cmd, input)
  if (!r.ok) throw new Error(`${cmd.slice(0, 3).join(' ')} failed`)
  return r.out
}

/**
 * Make the base ./Dockerfile names present: sign docker in, and build and push
 * the base if the registry lacks it. A dry run builds it and pushes nothing.
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
  let want = await tag(await Deno.readTextFile(here('base/Dockerfile')))
  let from = pinned(await Deno.readTextFile(here('Dockerfile')))
  if (!from?.endsWith(':' + want)) {
    throw new Error(
      `sandbox/Dockerfile builds FROM ${from}, but base/Dockerfile is ${want}`,
    )
  }
  let { username, password, account_id } = JSON.parse(
    await must(go, [
      ...wrangler,
      ...['containers', 'registries', 'credentials', REGISTRY],
      ...['--pull', '--push', '--expiration-minutes', '60', '--json'],
    ]),
  )
  if (!from.startsWith(`${REGISTRY}/${account_id}/`)) {
    throw new Error(`${from} is not in this account's registry`)
  }
  await must(
    go,
    ['docker', 'login', '--password-stdin', '--username', username, REGISTRY],
    password,
  )
  if (await has(from, password)) return from
  await must(go, [...BUILD, '-t', from, ...context()])
  if (dry) return from
  // The push is what timed out; a second or third try resumes it, since the
  // layers that made it already exist.
  for (let i = 0; i < 3; i++) {
    if ((await go(['docker', 'push', from])).ok) return from
  }
  throw new Error(`docker push ${from} failed three times`)
}
