// Copying a tile provider's newest build into the host's maps bucket, with
// the label fonts its style names: one command on the box.
//
//   deno run -A packages/maps/refresh.ts [provider] [--date YYYYMMDD] [--fonts-only]
//
// The archive streams from the provider's `builds` address into the bucket
// under its `archive` key (rclone copyurl, a multipart upload that replaces
// the object only once it is whole, so the door serves the old build until
// then). The fonts come from protomaps/basemaps-assets on GitHub. The
// bucket's S3 credentials are the box's vault secrets MAPS_R2_ACCESS_KEY_ID
// and MAPS_R2_SECRET_ACCESS_KEY: a token that reads and writes the yak-maps
// bucket alone, handed to rclone in its environment and nowhere else.
import { reveal } from '@yaks/secrets'
import { vaultOf } from '@yaks/cli/vault'
import { TILES, type Tiles } from './providers.ts'
import { FONTS } from './style.ts'

/** The bucket a refresh writes to, as S3 reaches it. */
export let BUCKET = {
  name: 'yak-maps',
  endpoint: 'https://0f9613dfd3f0451df0bd0f12a1372ea3.r2.cloudflarestorage.com',
}

let FONTS_REPO = 'https://github.com/protomaps/basemaps-assets'

/** The days a build may be named by, newest first: today and the week
 * before, as YYYYMMDD. A provider keeps a week of daily builds.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { days } from './refresh.ts'
 * assertEquals(days(new Date('2026-11-26T20:00:00Z')).slice(0, 2), [
 *   '20261126',
 *   '20261125',
 * ])
 * ```
 */
export let days = (now: Date): string[] =>
  Array.from(
    { length: 8 },
    (_, i) =>
      new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10)
        .replaceAll('-', ''),
  )

/** The address of a provider's build of `date`. */
export let buildOf = (p: Tiles, date: string): string => {
  if (!p.builds) throw new Error(`${p.name} has no builds to copy`)
  return p.builds.replaceAll('{date}', date)
}

/** The newest build the provider serves, as its address and size. */
export let newest = async (
  p: Tiles,
  now = new Date(),
): Promise<{ url: string; bytes: number }> => {
  for (let date of days(now)) {
    let url = buildOf(p, date)
    let res = await fetch(url, { method: 'HEAD' })
    if (res.ok) {
      return { url, bytes: Number(res.headers.get('content-length') ?? 0) }
    }
  }
  throw new Error(`${p.name}: no build in the last week at ${p.builds}`)
}

let rclone = async (args: string[], env: Record<string, string>) => {
  let child = new Deno.Command('rclone', {
    args: [
      ...args,
      '--s3-provider=Cloudflare',
      `--s3-endpoint=${BUCKET.endpoint}`,
      '--s3-no-check-bucket',
      '--stats=1m',
      '--stats-one-line',
    ],
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  let { success } = await child.output()
  if (!success) throw new Error(`rclone ${args[0]} failed`)
}

let git = async (args: string[], cwd?: string) => {
  let { success } = await new Deno.Command('git', { args, cwd }).output()
  if (!success) throw new Error(`git ${args[0]} failed`)
}

/** Copy the label fonts the style names into the bucket under the
 * provider's `glyphs`. */
export let fonts = async (p: Tiles, env: Record<string, string>) => {
  if (!p.glyphs) return
  let dir = await Deno.makeTempDir({ prefix: 'maps-fonts-' })
  try {
    await git([
      'clone',
      '--depth=1',
      '--filter=blob:none',
      '--sparse',
      FONTS_REPO,
      dir,
    ])
    let stacks = Object.values(FONTS).map((f) => `fonts/${f}`)
    await git(['sparse-checkout', 'set', ...stacks], dir)
    await rclone(
      [
        'copy',
        `${dir}/fonts`,
        `:s3:${BUCKET.name}/${p.glyphs}`,
        '--transfers=32',
      ],
      env,
    )
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

/** Copy a provider's newest build (or the build of `date`) into the bucket. */
export let archive = async (
  p: Tiles,
  env: Record<string, string>,
  date?: string,
) => {
  if (!p.archive) throw new Error(`${p.name} is served by another site`)
  let { url, bytes } = date
    ? { url: buildOf(p, date), bytes: 0 }
    : await newest(p)
  console.log(`maps: ${url} (${(bytes / 1e9).toFixed(1)} GB) to ${p.archive}`)
  await rclone([
    'copyurl',
    url,
    `:s3:${BUCKET.name}/${p.archive}`,
    '--s3-chunk-size=128M',
    '--s3-upload-concurrency=8',
  ], env)
}

if (import.meta.main) {
  let args = Deno.args.filter((a) => !a.startsWith('--'))
  let flag = (name: string) => {
    let i = Deno.args.indexOf(`--${name}`)
    return i < 0 ? undefined : Deno.args[i + 1] ?? ''
  }
  let p = TILES[args[0] ?? 'protomaps']
  if (!p) throw new Error(`no tile provider ${args[0]}`)
  let home = Deno.env.get('YAK_DATA') || `${Deno.env.get('HOME')}/.yak`
  let vault = vaultOf(`${home}/yak.db`)
  let env: Record<string, string> = {}
  for (
    let [name, as] of [
      ['MAPS_R2_ACCESS_KEY_ID', 'RCLONE_S3_ACCESS_KEY_ID'],
      ['MAPS_R2_SECRET_ACCESS_KEY', 'RCLONE_S3_SECRET_ACCESS_KEY'],
    ]
  ) {
    let value = await reveal(vault, name)
    if (!value) throw new Error(`the box's vault has no ${name}`)
    env[as] = value
  }
  await fonts(p, env)
  if (!Deno.args.includes('--fonts-only')) await archive(p, env, flag('date'))
  console.log('maps: refreshed')
}
