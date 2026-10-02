// Song takes joined to their region and artifact. The package's chosen mark is
// the only selection: the game and this editor read the same served output.

export let TAKES =
  '.built.build.build.variant=main&.built.build.build.for.song' +
  '&.fields=built.build,built.slot,built.artifact,built.current,chosen.at,' +
  'created.at,built.build.build.for.song.theme,' +
  'built.build.build.for.song.land.theme_design.land,' +
  'built.artifact.artifact.address,built.artifact.artifact.media_type'

export type Row = {
  entity: { eid: string }
  built?: { build: string; slot: string; artifact?: string; current?: boolean }
  build?: { for?: string; variant?: string }
  song?: { land: string; theme: string }
  theme_design?: { land: string }
  artifact?: { address: string; media_type: string }
  chosen?: { at?: string }
  created?: { at?: string }
}
export type Take = { id: string; sha: string; chosen: boolean; at?: string }
export type Song = { id: string; land: string; theme: string; takes: Take[] }

export let songs = (rows: Row[]): Song[] => {
  let at = new Map(rows.map((row) => [row.entity.eid, row]))
  let groups = new Map<string, Song>()
  for (let row of rows) {
    let built = row.built
    let build = built && at.get(built.build)?.build
    let id = build?.for
    let song = id && at.get(id)?.song
    let land = song && at.get(song.land)?.theme_design?.land
    let artifact = built?.artifact && at.get(built.artifact)?.artifact
    if (
      !id || !song || !land || !artifact ||
      !artifact.media_type.startsWith('audio/')
    ) continue
    let group = groups.get(id) ?? { id, land, theme: song.theme, takes: [] }
    group.takes.push({
      id: row.entity.eid,
      sha: artifact.address,
      chosen: built?.current == true,
      at: row.created?.at,
    })
    groups.set(id, group)
  }
  return [...groups.values()].sort((a, b) =>
    a.land.localeCompare(b.land) || a.theme.localeCompare(b.theme)
  )
    .map((song) => ({
      ...song,
      takes: song.takes.sort((a, b) =>
        (b.at ?? '').localeCompare(a.at ?? '') || a.id.localeCompare(b.id)
      ),
    }))
}
