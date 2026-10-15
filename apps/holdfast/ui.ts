/** Holdfast's screen reads the same rows as the simulation. Every choice is
 * supplied by the page graph; the HUD retains no game or interaction state. */
import { type ComponentChildren, h, render } from 'preact'
import { Button } from '@yaks/ui'
import { Stats } from '@yaks/game/hud'
import { Disclosure } from '@yaks/ux'
import type { Bundle } from '@yaks/graph'
import { view } from './rules.ts'
import { ids } from './seed.ts'
import type { Row } from './model.ts'

type Page = {
  run: string | null
  map: string
  slot: number
  design: string
  message: string
  online: boolean
  canPlay: boolean
  invite: string
  pending: boolean
  helpRow: Bundle
}
export type Actions = {
  newRun(map: string): void
  chooseMap(map: string): void
  chooseTower(design: string): void
  select(slot: number): void
  build(): void
  upgrade(): void
  sell(): void
  wave(): void
  copy(): void
  leave(): void
  disclosure(bundle: Bundle): void
}

let text = (tag: string, className: string, children: ComponentChildren) =>
  h(tag, { class: className }, children)
let press = (
  label: ComponentChildren,
  onClick: () => void,
  props: Record<string, unknown> = {},
) => h(Button, { type: 'button', onClick, ...props }, label)
let stat = (mark: string, label: string, value: string | number) =>
  h(
    Stats.Stat,
    {},
    h(Stats.Mark, { 'aria-hidden': true }, mark),
    h(Stats.Words, {}, text('strong', 'Quantity', value), ' ', label),
  )
const briefing = [
  [
    '01',
    'The meadow',
    'A generous bend in the road. A good place to learn the ropes.',
    'Gentle',
  ],
  [
    '02',
    'The crossing',
    'A long approach, a tight turn. Make every tower count.',
    'Tactical',
  ],
  [
    '03',
    'The last ridge',
    'Little room for mistakes. Bring a friend and a plan.',
    'Demanding',
  ],
]
const crafts = [
  {
    key: 'arrow' as const,
    icon: '↟',
    role: 'Quick, precise',
    hint: 'Pick off runners',
    className: 'arrow',
  },
  {
    key: 'cannon' as const,
    icon: '✹',
    role: 'Heavy splash',
    hint: 'Break packed groups',
    className: 'cannon',
  },
  {
    key: 'frost' as const,
    icon: '❄',
    role: 'Chill & control',
    hint: 'Slow the rush',
    className: 'frost',
  },
  {
    key: 'arcane' as const,
    icon: '◇',
    role: 'Armour breaker',
    hint: 'Answer iron hides',
    className: 'arcane',
  },
]

let notice = (page: Page) => {
  let message = !page.online
    ? 'Reconnecting. Building and the next wave will wait for the shared world.'
    : !page.canPlay
    ? 'You’re watching. Join through this app’s sharing to build with the team.'
    : page.message
  return message
    ? h(
      'div',
      { class: 'Notice', role: 'status', 'aria-live': 'polite' },
      message,
    )
    : null
}

let landing = (rows: Row[], page: Page, actions: Actions) => {
  let maps = rows.filter((r) => r.map_design)
  let chosen = maps.find((r) => r.entity.eid === page.map) ?? maps[0]
  let disabled = !chosen || !page.online || !page.canPlay || page.pending
  return h(
    'main',
    { class: 'Camp', 'aria-label': 'Holdfast lobby' },
    h('div', { class: 'Camp_Sheen', 'aria-hidden': true }),
    h(
      'section',
      { class: 'Camp_Content' },
      text('p', 'Eyebrow', 'A LITTLE FORT. A SHARED DEFENCE.'),
      text('h1', 'Wordmark', 'HOLDFAST'),
      text('p', 'Camp_Tag', 'Stand together. Hold the line.'),
      text(
        'p',
        'Camp_Intro',
        'Raise a few towers, share the gold, and keep the creatures from your gate. Better with company. Just as brave alone.',
      ),
      h(
        'div',
        { class: 'Camp_Divider' },
        text('h2', 'SectionLabel', 'Choose your ground'),
        text('span', 'Camp_Coop', 'CO-OP TOWER DEFENSE'),
      ),
      h(
        'div',
        { class: 'Maps', role: 'group', 'aria-label': 'Choose a map' },
        maps.map((r, i) => {
          let b = briefing[i] ?? briefing[0]
          return press(
            [
              text('span', 'Map_Number', b[0]),
              h(
                'span',
                { class: 'Map_Words' },
                text('strong', 'Map_Name', r.map_design!.name),
                text('span', 'Map_Description', b[2]),
              ),
              text('span', 'Map_Level', b[3]),
            ],
            () => actions.chooseMap(r.entity.eid),
            {
              class: `Map Map-${i + 1}`,
              'aria-pressed': chosen?.entity.eid === r.entity.eid,
            },
          )
        }),
      ),
      h(
        'div',
        { class: 'Camp_Start' },
        press(
          page.pending ? 'Preparing your fort…' : 'Raise the banner  →',
          () => chosen && actions.newRun(chosen.entity.eid),
          { class: 'Start', mod: 'go', disabled },
        ),
        text(
          'p',
          'Camp_Aside',
          'One purse. Twelve waves. A link for your friends.',
        ),
      ),
      notice(page),
      h(
        'div',
        { class: 'Fieldnotes' },
        text('span', 'Fieldnotes_Title', 'A FIELD GUIDE'),
        text('span', '', 'Arrows for runners.'),
        text('span', '', 'Cannon for crowds.'),
        text('span', '', 'Frost buys time.'),
        text('span', '', 'Arcane cracks armour.'),
      ),
    ),
    h(
      'aside',
      { class: 'Camp_View', 'aria-hidden': true },
      text('span', 'Camp_ViewMark', 'YOUR WATCH BEGINS HERE'),
      text('span', 'Camp_ViewNote', 'A small place worth protecting.'),
    ),
  )
}

let game = (rows: Row[], page: Page, actions: Actions) => {
  let v = view(rows, page.run!)
  if (!v.map || !v.run) {
    return h(
      'main',
      { class: 'Waiting' },
      text('p', 'Eyebrow', 'HOLDFAST'),
      text('h1', '', 'Finding your fort…'),
      text('p', '', 'The shared run is on its way.'),
      press('Back to camp', actions.leave, { mod: 'quiet' }),
      notice(page),
    )
  }
  let tower = v.towers.find((r) => r.tower!.slot === page.slot)
  let designId = tower?.tower?.design ?? page.design
  let design = rows.find((r) => r.entity.eid === designId)?.tower_design
  let upgrade = design?.upgrade
    ? rows.find((r) => r.entity.eid === design.upgrade)?.tower_design
    : undefined
  let dead = v.lives <= 0
  let ended = !!v.run.completed || dead
  let active = !!v.conductor?.conductor
  let disabled = !page.online || !page.canPlay || page.pending || ended
  let selected = page.slot >= 0
  let players = v.players.length
  return h(
    'main',
    { class: 'Battle', 'aria-label': 'Shared tower defence' },
    h(
      'header',
      { class: 'Topbar' },
      h(
        'div',
        { class: 'RunTitle' },
        text('span', 'Eyebrow', 'HOLDFAST'),
        text('h1', '', v.map.name),
      ),
      h(
        Stats,
        { class: 'RunStats', 'aria-label': 'Run resources' },
        stat('◈', 'gold', Math.floor(v.gold)),
        stat('♥', 'lives', Math.max(0, v.lives)),
        stat(
          '⚑',
          'wave',
          `${Math.min(v.wave, v.waves.length)}/${v.waves.length}`,
        ),
      ),
      h(
        'div',
        { class: 'Company' },
        text(
          'span',
          'Company_Count',
          `${players} ${players === 1 ? 'defender' : 'defenders'}`,
        ),
        press('Invite a friend ↗', actions.copy, {
          class: 'Invite',
          title: page.invite || 'Copy this run’s link',
          disabled: !page.online,
        }),
        press('Camp', actions.leave, { mod: 'quiet', class: 'Leave' }),
      ),
    ),
    h('div', { class: 'Battle_Status' }, notice(page)),
    h(
      'aside',
      { class: 'Tactics' },
      h(
        Disclosure,
        {
          e: page.helpRow,
          onChange: actions.disclosure,
          summary: '☷  Build sites & field guide',
          summaryProps: { mod: 'quiet' },
        },
        h(
          'div',
          { class: 'Tactics_Content' },
          text('h2', '', 'A plan, then a little courage.'),
          text(
            'p',
            '',
            'Tap a pale build site in the world, choose a tower, then build. Gold belongs to the whole team; the coloured rings show where your friends are pointing.',
          ),
          text(
            'p',
            '',
            'Upgrade towers for stronger attacks, or sell to recover some gold. Clear a wave to earn its bounty. Let too many creatures through and the gate falls.',
          ),
          h(
            'div',
            { class: 'CounterGuide' },
            crafts.map((c) => text('p', '', `${c.icon} ${c.hint}.`)),
          ),
          text('h3', '', 'Pick a build site'),
          h(
            'div',
            { class: 'Sites', role: 'group', 'aria-label': 'Build sites' },
            v.map.slots.map((_, slot) => {
              let occupied = v.towers.find((r) => r.tower!.slot === slot)
              let name = rows.find((r) =>
                r.entity.eid === occupied?.tower?.design
              )
                ?.tower_design?.name
              return press(
                `${slot + 1}${name ? ' · ' + name : ''}`,
                () => actions.select(slot),
                {
                  'aria-pressed': slot === page.slot,
                  'aria-label': `Site ${slot + 1}${
                    name ? ', ' + name : ', empty'
                  }`,
                },
              )
            }),
          ),
        ),
      ),
    ),
    !ended &&
      h(
        'section',
        { class: 'Workshop', 'aria-label': 'Tower construction' },
        h(
          'div',
          { class: 'Workshop_Header' },
          text(
            'p',
            'Eyebrow',
            selected ? `BUILD SITE ${page.slot + 1}` : 'MAKE YOUR STAND',
          ),
          text(
            'span',
            'Workshop_Hint',
            tower ? 'A tower worth tending.' : 'Tap a pale site to build.',
          ),
        ),
        h(
          'div',
          {
            class: 'Blueprints',
            role: 'group',
            'aria-label': 'Tower blueprints',
          },
          crafts.map((craft) => {
            let id = ids.towers[craft.key][0]
            let d = rows.find((r) => r.entity.eid === id)?.tower_design
            return press(
              [
                text(
                  'span',
                  `Blueprint_Icon Blueprint_Icon-${craft.className}`,
                  craft.icon,
                ),
                h(
                  'span',
                  { class: 'Blueprint_Words' },
                  text('strong', '', d?.name ?? craft.key),
                  text('span', 'Blueprint_Role', craft.role),
                ),
                text('span', 'Blueprint_Price', `${d?.cost ?? '—'} ◈`),
              ],
              () => actions.chooseTower(id),
              {
                class: 'Blueprint',
                title: craft.hint,
                'aria-pressed': !tower && page.design === id,
                disabled: !!tower,
              },
            )
          }),
        ),
        h(
          'div',
          { class: 'BuildDetail' },
          h(
            'div',
            { class: 'BuildDetail_Words' },
            text(
              'h2',
              '',
              selected
                ? design?.name ?? 'Choose a blueprint'
                : 'Find your corner of the fight.',
            ),
            selected && design
              ? text(
                'p',
                '',
                `${design.damage} damage · ${
                  Number(design.range.toFixed(1))
                }m reach${design.splash ? ' · Splash' : ''}${
                  design.slow ? ' · Slowing' : ''
                }`,
              )
              : text(
                'p',
                '',
                'Point at a build site, then choose what it needs.',
              ),
          ),
          h(
            'div',
            { class: 'BuildActions' },
            tower
              ? [
                upgrade &&
                press(`Upgrade · ${upgrade.cost} ◈`, actions.upgrade, {
                  mod: 'go',
                  disabled: disabled || v.gold < upgrade.cost,
                }),
                !upgrade && text('span', 'Maxed', 'Fully upgraded'),
                press('Sell tower', actions.sell, {
                  mod: 'quiet',
                  disabled,
                  title: 'Recover 70% of this tower’s investment',
                }),
              ]
              : press(
                design ? `Build · ${design.cost} ◈` : 'Choose a tower',
                actions.build,
                {
                  mod: 'go',
                  disabled: disabled || !selected || !design ||
                    v.gold < design.cost,
                },
              ),
          ),
        ),
      ),
    !ended &&
      h(
        'aside',
        { class: 'WaveOrder' },
        text('p', 'Eyebrow', active ? 'THEY’RE COMING' : 'A MOMENT TO PREPARE'),
        active
          ? text(
            'p',
            'WaveOrder_Info',
            `${v.creeps.length} on the path · hold your ground`,
          )
          : press(
            `Send wave ${Math.min(v.wave, v.waves.length)}  →`,
            actions.wave,
            {
              mod: 'go',
              disabled,
            },
          ),
      ),
    ended &&
      h(
        'section',
        { class: 'Outcome', role: 'status' },
        text('span', 'Outcome_Mark', dead ? '⚑' : '✦'),
        text(
          'p',
          'Eyebrow',
          dead
            ? 'THE BANNER WILL RISE AGAIN'
            : 'TWELVE WAVES. ONE SHARED VICTORY.',
        ),
        text('h2', '', dead ? 'A brave last stand.' : 'The fort holds.'),
        text(
          'p',
          '',
          dead
            ? 'The gate fell, but the next plan is already taking shape.'
            : 'Every tower mattered. So did the people beside you.',
        ),
        h(
          'div',
          { class: 'Outcome_Actions' },
          press('Defend again', () => actions.newRun(v.run!.run!.map), {
            mod: 'go',
            disabled: !page.online || !page.canPlay || page.pending,
          }),
          press('Choose another map', actions.leave, { mod: 'quiet' }),
        ),
      ),
  )
}

/** Paint from graph values. Repeated frames preserve DOM and focus via Preact. */
export let renderUI = (
  root: HTMLElement,
  rows: Row[],
  page: Page,
  actions: Actions,
): void => {
  render(
    h(
      'div',
      { class: 'Holdfast' },
      page.run ? game(rows, page, actions) : landing(rows, page, actions),
    ),
    root,
  )
}
