// Combat over values: games supply their critical-hit and armour tuning;
// health is a ledger scoped to one target and one life.
export type BlowRules = {
  sure: boolean
  luck: number
  greatAt: number
  greatScale: number
  spread: number
}

/** One roll drives both the critical hit and the variation within its tenth. */
export let blow = (
  might: number,
  roll: number,
  rules: BlowRules,
): { dmg: number; great: boolean } => {
  let great = rules.sure || roll > rules.greatAt - rules.luck
  let base = might * (1 - rules.spread + (roll % 0.1) * 20 * rules.spread)
  return { dmg: Math.round(base * (great ? rules.greatScale : 1)), great }
}

/** Diminishing armour reduction, with a game's minimum damage floor. */
export let through = (
  dmg: number,
  armour: number,
  scale: number,
  minimum: number,
): number => Math.max(minimum, Math.round(dmg * 100 / (100 + scale * armour)))

/** Collapse duplicate falls within a respawn window into one life. Respawn
 * delays are in seconds; timestamps are in milliseconds. */
export let fallOf = (
  rows: readonly { at: number }[],
  respawn: number | ((at: number) => number),
  now: number,
): { down: boolean; fell: number } => {
  let back = (at: number) =>
    at + (typeof respawn == 'number' ? respawn : respawn(at)) * 1000
  let fell = 0
  for (let r of [...rows].sort((a, b) => a.at - b.at)) {
    if (!fell || r.at >= back(fell)) fell = r.at
  }
  return { down: !!fell && now < back(fell), fell }
}

/** Damage from other targets or lives never counts toward this health. */
export let hpOf = (
  eid: string,
  most: number,
  life: number,
  dealt: readonly { foe: string; life: number; dmg: number }[],
): number => {
  let n = 0
  for (let d of dealt) if (d.foe == eid && d.life == life) n += d.dmg
  return Math.max(0, most - n)
}
