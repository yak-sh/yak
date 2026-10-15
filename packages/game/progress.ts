// A level curve with small combat numbers. Kept stable so experience already
// earned keeps its meaning when a game adopts these rules.

export let need = (lvl: number): number => Math.round(80 * (lvl - 1) ** 2.4)

export let maxHp = (lvl: number): number => 48 + lvl * 4

export let power = (lvl: number, dmg = 1): number => (5 + lvl * 0.5) * dmg
