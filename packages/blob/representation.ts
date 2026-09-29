// A byte address says which bytes; a representation says how those bytes are
// served. Its identity includes the app/store scope, type and filename, so a
// later edit cannot change the headers at an already-issued URL.

import { sha256 } from '@yaks/graph'
import { mediaType } from './content_type.ts'

export type Representation = {
  scope: string
  address: string
  media_type: string
  name?: string
}

export let representation = (
  scope: string,
  address: string,
  mime: string,
  name = '',
): { eid: string; row: Representation; path: string } => {
  let row: Representation = {
    scope,
    address,
    media_type: mediaType(mime),
    ...(name ? { name } : {}),
  }
  let eid = sha256(JSON.stringify(['representation', scope, row]))
  return { eid, row, path: `${address}/${eid}` }
}

export let represents = (
  eid: string,
  row: Representation,
): boolean =>
  /^[0-9a-f]{64}$/.test(row.address) &&
  !!row.scope && row.media_type == mediaType(row.media_type) &&
  representation(row.scope, row.address, row.media_type, row.name).eid == eid

export let addressed = (
  path: string,
): { sha: string; eid: string | null } | null => {
  let match = /^([0-9a-f]{64})(?:\/([0-9a-f]{64}))?$/.exec(path)
  return match ? { sha: match[1], eid: match[2] ?? null } : null
}
