// A brief, read-only account of a land or one world entity. The worker asks
// for only the related rows this account needs; this file only reads them.
import type { Bundle } from './net.ts'
import { comp, num, str } from './bundle.ts'
import { levelOf } from './levels.ts'
import { type Place, placeOf } from './place.ts'

type Related = {
  look?: Bundle
  live?: Bundle
  going?: Bundle
  objective?: Bundle
  progress?: number
  at?: Place
}

let say = (text: string) =>
  text.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/[\\`*_{}\[\]<>|]/g, '\\$&')
let land = (id: string) => levelOf(id)?.name ?? id
let location = (p: Place | null, when: string) =>
  p ? `- ${when}: ${say(land(p.level))} (${p.x}, ${p.z})` : ''
let heading = (name: string, kind: string, id: string) =>
  `### ${say(name)}\n${kind} \`${id}\``

/** State from the rows already fetched for a command target. */
export let inspectOf = (
  target: { level: string } | { row: Bundle; related?: Related },
): string => {
  if ('level' in target) {
    let lv = levelOf(target.level)
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
  let at = related.at ?? placeOf(related.live, 'position') ??
    placeOf(row, 'position')
  let current = location(at, 'Position now')
  let saved = current
    ? ''
    : location(placeOf(row, 'seen'), 'Last saved position')
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
      location(placeOf(row, 'companion'), 'Companion position'),
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
  if (at) {
    return [heading('World target', 'Entity', id), current].filter(Boolean)
      .join('\n')
  }
  return `Entity \`${id}\` has no inspectable Mossvale state.`
}
