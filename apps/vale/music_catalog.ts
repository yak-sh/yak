// The hosted song catalogue joins current main outputs to their song, land
// and audio artifact. Ordering belongs to songs, never to changing blobs.
export let SONGS = '.built.current=true&.built.build.build.variant=main' +
  '&.built.build.build.for.song&.fields=built.current,built.build,' +
  'built.artifact,built.build.build.variant,built.build.build.for.song.land,' +
  'built.build.build.for.song.theme,' +
  'built.build.build.for.song.land.theme_design.land,' +
  'built.artifact.artifact.address,built.artifact.artifact.media_type'

export type Row = {
  entity: { eid: string }
  built?: { build: string; artifact?: string; current?: boolean }
  build?: { for?: string; variant?: string }
  song?: { land: string; theme: string }
  theme_design?: { land: string }
  artifact?: { address: string; media_type: string }
}
export type Track = { id: string; theme: string; sha?: string }
export type Catalog = Record<string, Track[]>

export let catalog = (rows: Row[]): Catalog => {
  let at = new Map(rows.map((row) => [row.entity.eid, row]))
  let lands: Record<string, Map<string, Track>> = {}
  for (let { built } of rows) {
    let build = built && at.get(built.build)?.build
    if (!built || built.current != true || build?.variant != 'main') continue
    let id = build.for, song = id && at.get(id)?.song
    let land = song && at.get(song.land)?.theme_design?.land
    if (!id || !song || !land) continue
    let blob = built.artifact && at.get(built.artifact)?.artifact
    let sha = blob && blob.media_type?.startsWith('audio/')
      ? blob.address
      : undefined
    let group = lands[land] ??= new Map()
    group.set(id, { id, theme: song.theme, sha })
  }
  return Object.fromEntries(
    Object.entries(lands).map(([land, songs]) => [
      land,
      [...songs.values()].sort((a, b) =>
        a.theme < b.theme
          ? -1
          : a.theme > b.theme
          ? 1
          : a.id < b.id
          ? -1
          : a.id > b.id
          ? 1
          : 0
      ),
    ]),
  )
}

export let track = (songs: Track[], next: string | null, bad: Set<string>) => {
  let index = songs.findIndex((song) => song.id == next)
  let ordered = index < 0
    ? songs
    : [...songs.slice(index), ...songs.slice(0, index)]
  // A pending current song waits for its data, rather than consuming its turn.
  return ordered.find((song) => !song.sha || !bad.has(song.sha))
}
