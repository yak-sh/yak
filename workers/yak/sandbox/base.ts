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
//
// The registry answers "Layer already exists" per repository and mounts
// nothing across them (a mount request answers 202, a fresh upload). So the
// base is pushed into the repository each deploy pushes its image to,
// wrangler's own name for the container: `<worker>-<class>[-<env>]`.

import { parse } from '@std/toml'

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

type Conf = {
  name: string
  containers?: { name?: string; class_name: string }[]
  env?: Record<string, Conf>
}

/** The repository a deploy to `env` pushes its image to: the container's
 * name, which wrangler defaults to `<worker>-<class>[-<env>]`, lowercased. */
export let repo = (toml: string, env?: string) => {
  let root = parse(toml) as Conf
  let conf = env ? root.env?.[env] : root
  let box = conf?.containers?.[0]
  if (!conf || !box) throw new Error(`no container in ${env ?? 'production'}`)
  return box.name ??
    `${conf.name}-${box.class_name}${env ? '-' + env : ''}`.toLowerCase()
      .replaceAll(' ', '-')
}

/** The environment a wrangler argv deploys to, if not production. */
export let envOf = (args: string[]) => {
  for (let [i, a] of args.entries()) {
    if (a == '--env' || a == '-e') return args[i + 1]
    if (a.startsWith('--env=')) return a.slice(6)
  }
}

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

let must = async (go: Run, cmd: string[], input?: string) => {
  let r = await go(cmd, input)
  if (!r.ok) throw new Error(`${cmd.slice(0, 3).join(' ')} failed`)
  return r.out
}

/**
 * Make the base ./Dockerfile names present for a deploy to `env`: sign docker
 * in, and build and push the base into each repository missing it. A dry run
 * builds what is missing and pushes nothing. `wrangler` is the argv prefix
 * that runs this Worker's pinned wrangler.
 */
export let based = async (
  { wrangler, env, dry = false, go = run, has = held }: {
    wrangler: string[]
    env?: string
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
  let toml = await Deno.readTextFile(here('../wrangler.toml'))
  let mine = `${REGISTRY}/${account_id}/${repo(toml, env)}:${want}`
  let missing = []
  for (let ref of new Set([from, mine])) {
    if (!await has(ref, password)) missing.push(ref)
  }
  if (!missing.length) return from
  if (missing.includes(from)) {
    await must(go, ['docker', 'build', '-t', from, here('base').pathname])
  } else await must(go, ['docker', 'pull', from])
  for (let ref of missing) {
    if (ref != from) await must(go, ['docker', 'tag', from, ref])
    if (dry) continue
    // The push is what timed out; a second or third try resumes it, since
    // the layers that made it already exist.
    let pushed = false
    for (let i = 0; i < 3 && !pushed; i++) {
      pushed = (await go(['docker', 'push', ref])).ok
    }
    if (!pushed) throw new Error(`docker push ${ref} failed three times`)
  }
  return from
}
