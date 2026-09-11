// A model/tool step has one writer even when two harness processes open the
// same database. OS locks survive neither crash nor exit; files stay put so
// contenders always lock the same inode, never a replacement after unlink.

import { sha256 } from '@yaks/graph'

export let stepLock = (path: string) => {
  let dir = Deno.realPathSync(path) + '.steps'
  Deno.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return (session: string): (() => void) | undefined => {
    let file = Deno.openSync(
      dir + '/' + sha256(session),
      {
        create: true,
        write: true,
        mode: 0o600,
      },
    )
    try {
      if (!file.tryLockSync(true)) {
        file.close()
        return
      }
    } catch (error) {
      file.close()
      throw error
    }
    return () => file.close()
  }
}
