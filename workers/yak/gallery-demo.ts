import { type App, type Directory, META, type Space } from './directory.ts'
import type { Args, Ctx, Out } from './tool.ts'
import type { Files } from './versions.ts'

export let DEMO = 'yourname'

/** Demo files replace their root counterparts only in the gallery copy. */
export let demoFiles = (files: Files): Files => ({
  ...files,
  ...Object.fromEntries(
    Object.entries(files).filter(([path]) => path.startsWith('demo/'))
      .map(([path, sha]) => [path.slice(5), sha]),
  ),
})

export let ours = async (dir: Directory, space: Space) => {
  let meta = await dir.space(META.space)
  if (!meta) return false
  let staff = new Set(await dir.owners(meta))
  return (await dir.owners(space)).some((person) => staff.has(person))
}

export let copyOf = (apps: App[], source: App) =>
  apps.find((app) => !app.trashed && app.installed?.of == source.eid)

/** Install code into the demo space; the source store is never read. */
export let demonstrate = async (
  ctx: Ctx,
  space: Space,
  app: App,
  run: (ctx: Ctx, name: string, args: Args) => Promise<Out>,
) => {
  if (app.access != 'private' || !await ours(ctx.dir, space)) return
  let demo = await ctx.dir.space(DEMO)
  if (!demo) throw new Error('the gallery demo space is missing')
  let copy = copyOf(await ctx.dir.apps(demo), app)
  let copying = { ...ctx, copyFiles: demoFiles }
  if (!copy) {
    let installed = await run(copying, 'app_install', {
      space: DEMO,
      name: app.published!.name,
    })
    copy = await ctx.dir.app(demo, String(installed.value!.app)) ?? undefined
  }
  if (!copy) throw new Error('the gallery copy is missing after installation')
  let changed = copy.installed!.version != app.published!.version
  if (changed) {
    await run(copying, 'app_update', { space: DEMO, app: copy.slug })
  }
  if (copy.access != 'open') {
    await run(ctx, 'app_set', { space: DEMO, app: copy.slug, access: 'open' })
  }
  if (!copy.published || changed || copy.published.version != copy.version) {
    await run(ctx, 'app_publish', {
      space: DEMO,
      app: copy.slug,
      name: copy.published?.name ?? `${app.published!.name.slice(0, 58)}-demo`,
      ...(app.published!.about ? { about: app.published!.about } : {}),
    })
  }
}
