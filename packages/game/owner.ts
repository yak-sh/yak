// Elect the page that moves an unplayed entity from caller-supplied players.
// Only awake pages in the entity's active radius participate.
export type OwnerSpot = { x: number; z: number; awake: boolean }

/** The lexically first eligible page eid, or the empty string. Radius is
 * inclusive and uses horizontal distance from the entity's home. */
export let ownerOf = (
  players: Iterable<readonly [string, OwnerSpot]>,
  home: { x: number; z: number },
  radius: number,
): string => {
  let owner = ''
  for (let [who, spot] of players) {
    if (!spot.awake || Math.hypot(spot.x - home.x, spot.z - home.z) > radius) {
      continue
    }
    if (!owner || who < owner) owner = who
  }
  return owner
}
