// The task page's pure view of one hero's completions. The completion eid is
// derived from task and hero so retries and two tabs name the same row.

export let completionEid = async (task, player) => {
  let bytes = new TextEncoder().encode(`village-done/${task}/${player}`)
  let hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  hash[6] = (hash[6] & 15) | 128
  hash[8] = (hash[8] & 63) | 128
  let hex = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`
}

export let completed = (rows, player) =>
  new Set(
    rows.filter((r) => r.village_done?.player == player)
      .map((r) => r.village_done.task),
  )
