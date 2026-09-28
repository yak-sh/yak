// Vale reads a sibling app's completed village tasks at the page boundary.
// The selected hero and all villager behavior stay in Vale; this module reads
// only the completion rows the task app owns, through its documented store.
import { uuidOf } from './rand.ts'

export let WELCOME = uuidOf('village-task/pip/welcome')

export let finished = (
  rows: Record<string, unknown>[],
  task: string,
  player: string,
) =>
  rows.some((r) => {
    let done = r.village_done
    return done && typeof done == 'object' && 'task' in done &&
      'player' in done && done.task == task && done.player == player
  })

export let completion = async (
  query: (filter: string) => Promise<Record<string, unknown>[]>,
  player: string,
): Promise<boolean> =>
  finished(
    await query(`.village_done.task=${WELCOME}&.village_done.player=${player}`),
    WELCOME,
    player,
  )

export let welcomed = async (player: string): Promise<boolean> => {
  // client.js is served beside the page, so its URL is resolved at runtime.
  let module = await import(new URL('api/client.js', document.baseURI).href)
  let sibling = module.store('/village-tasks/api/')
  return completion(sibling.query, player)
}
