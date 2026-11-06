import * as io from '@yaks/file/io'
// The land lock of a checkout, a module of its own that imports nothing else
// from the workspace: a `yak` command takes it before it loads any module of
// the checkout it may land under (@yaks/cli/yak).

/** Hold the land lock of the checkout whose Git directory is `gitdir` until
 * the returned release: exclusive for the landing that writes the checkout,
 * shared for a reader that needs it whole. Git's own `index.lock` refuses a
 * second writer instead of waiting for it, so whatever writes the shared
 * checkout's index waits here first. */
export let hold = async (
  gitdir: string,
  exclusive: boolean,
): Promise<() => void> => {
  let file = await io.open(`${gitdir}/land.lock`, {
    create: true,
    write: true,
  })
  await file.lock(exclusive)
  return () => file.close()
}
