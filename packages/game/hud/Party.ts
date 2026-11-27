/** Who is in the fight and how they stand: a `Member` a line each, its `Name`,
 * a health bar (the general `Meter`) and its `Hp` in numbers. `turn` marks the
 * one whose turn it is, `own` the player reading it, `low` health under a
 * third, and `down` one knocked out. The same part lists a party or the foes
 * it faces; the caller supplies every value and owns what a tap does. */
import { block, type Colors, Meter, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { type FunctionComponent, h } from 'preact'

/** One line's values: health from 0 to `most`. */
export type Member = {
  name: string
  hp: number
  most: number
  turn?: boolean
  own?: boolean
}

export type PartyProps = { members: Member[]; label?: string }

let List = block('ul', 'Party', { Member: 'li', Name: 'span', Hp: 'span' })

/** A line's marks, from its values. */
export let marks = ({ hp, most, turn, own }: Member): string[] =>
  [
    turn && 'turn',
    own && 'own',
    hp <= 0 ? 'down' : hp < most / 3 && 'low',
  ].filter((m): m is string => !!m)

export let Party: FunctionComponent<PartyProps> = (
  { members, label = 'Party' },
) =>
  h(
    List,
    { 'aria-label': label },
    members.map((m) =>
      h(
        List.Member,
        { mod: marks(m), 'aria-current': m.turn ? 'true' : undefined },
        h(List.Name, {}, m.name),
        h(Meter, { value: m.hp / m.most, width: 10 }),
        h(List.Hp, {}, m.hp > 0 ? `${m.hp}/${m.most}` : 'Down'),
      )
    ),
  )

export let description =
  'A party or its foes, a line each: name, health bar and health.'
export let sheet = (c: Colors): Sheet => ({
  Party_Member: { block: true },
  'Party_Member-turn': { bold: true },
  'Party_Member-down': { fg: c.dim },
  Party_Hp: { fg: c.muted },
})
export let specimens = (): Specimen[] => [
  [
    'A party mid-fight: whose turn, low and down',
    h(Party, {
      members: [
        { name: 'Wren', hp: 9, most: 10, turn: true, own: true },
        { name: 'Ash', hp: 3, most: 10 },
        { name: 'Moss', hp: 0, most: 10 },
      ],
    }),
  ],
  [
    'Foes',
    h(Party, {
      label: 'Foes',
      members: [{ name: 'Wolf', hp: 4, most: 6 }, {
        name: 'Bog troll',
        hp: 12,
        most: 12,
      }],
    }),
  ],
]
