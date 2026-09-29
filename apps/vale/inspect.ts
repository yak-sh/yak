// A brief, read-only account of a land or one world entity. The worker asks
// for only the related rows this account needs; this file only reads them.
import type { Bundle } from './net.ts'
import { comp, num, str } from './bundle.ts'
import { LEVELS } from './levels.ts'

type Related = {
  look?: Bundle
  live?: Bundle
  going?: Bundle
  objective?: Bundle
  progress?: number
}

let say = (text: string) =>
  text.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/[\\`*_{}\[\]<>|]/g, '\\$&')
let land = (id: string) => LEVELS[id]?.name ?? id
let point = (p: Record<string, unknown>) =>
  Number.isFinite(p.x) && Number.isFinite(p.z)
    ? `(${Math.round(num(p.x))}, ${Math.round(num(p.z))})`
    : ''
let location = (p: Record<string, unknown>, when: string) =>
  str(p.level) && point(p)
    ? `- ${when}: ${say(land(str(p.level)))} ${point(p)}`
    : ''
let heading = (name: string, kind: string, id: string) =>
  `### ${say(name)}\n${kind} \`${id}\``

/** State from the rows already fetched for a command target. */
export let inspectOf = (
  target: { level: string } | { row: Bundle; related?: Related },
): string => {
  if ('level' in target) {
    let lv = LEVELS[target.level]
    if (!lv) return 'No such land.'
    let roads = Object.entries(lv.roads).map(([side, to]) =>
      `${side} to ${land(to)}`
    )
    return [
      heading(lv.name, 'Land', lv.id),
      `- Roads: ${roads.length ? roads.map(say).join(', ') : 'none'}`,
    ].join('\n')
  }
  let { row, related = {} } = target
  let id = row.entity.eid
  let live = comp(related.live, 'position')
  let pos = Object.keys(live).length ? live : comp(row, 'position')
  let current = location(pos, 'Position now')
  let saved = current ? '' : location(comp(row, 'seen'), 'Last seen')
  if (row.player) {
    let name = str(comp(related.look, 'look').name, 'Wanderer')
    let objective = comp(related.objective, 'directive')
    let companion = Object.keys(objective).length
      ? `- Companion: ${say(str(objective.goal))} ${related.progress ?? 0}/${
        num(objective.count)
      }`
      : ''
    return [heading(name, 'Hero', id), current || saved, companion].filter(
      Boolean,
    ).join('\n')
  }
  if (row.villager) {
    let v = comp(row, 'villager')
    let name = str(comp(row, 'doc').title, str(v.id, 'Villager'))
    let home = str(v.level)
      ? `- Home: ${say(land(str(v.level)))}${
        str(v.home) ? `, ${say(str(v.home))}` : ''
      }`
      : ''
    let going = str(comp(related.going, 'going').go)
    return [
      heading(name, 'Villager', id),
      current,
      home,
      going ? `- Heading: ${say(going)}` : '',
    ].filter(Boolean).join('\n')
  }
  if (row.directive) {
    let d = comp(row, 'directive')
    let c = comp(row, 'companion')
    return [
      heading('Companion objective', 'Objective', id),
      `- Hero: \`${str(d.player)}\``,
      `- ${say(str(d.goal))}: ${related.progress ?? 0}/${num(d.count)}`,
      str(c.status) ? `- Status: ${say(str(c.status))}` : '',
      point(c) ? `- Position: ${point(c)}` : '',
    ].filter(Boolean).join('\n')
  }
  if (row.item) {
    let item = comp(row, 'item')
    return [
      heading(str(item.kind, 'Item'), 'Item', id),
      str(item.owner) ? `- Hero: \`${str(item.owner)}\`` : '',
      `- Rarity: ${say(str(item.rarity, 'common'))}`,
    ].filter(Boolean).join('\n')
  }
  if (point(pos)) {
    return [heading('World target', 'Entity', id), current].filter(Boolean)
      .join('\n')
  }
  return `Entity \`${id}\` has no inspectable Mossvale state.`
}
