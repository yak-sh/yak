/** Authored designs installed as store rows. Playing always reads these from the graph. */
import { uuidOf } from '@yaks/game'
import type { MapDesign, Row, TowerDesign } from './model.ts'

export const ids = {
  maps: [
    '88cbd568-c109-40be-94b5-614179bf8377',
    '209d96eb-d9ab-42ad-a0dc-6e5c82592b74',
    '4eb69a58-3de0-441e-9bd6-d39b9b2275d6',
  ],
  enemies: {
    runner: '9b2af82b-9b51-4b45-b52a-52c5e093ec9b',
    swarm: 'e07fe161-d29e-4476-8233-807e585b44ce',
    armoured: '162faadf-55e1-4305-8324-cba903974ad4',
    giant: '44fac756-8289-42fd-8b99-91ff57869b17',
  },
  towers: {
    arrow: [
      '89ae5167-ed94-4778-a840-dc1d0b2b8381',
      '7c4a9b9d-cfeb-4cba-a437-4592e393bd0c',
      '9c3aa834-8925-4e26-b188-bf77b7e48d75',
    ],
    cannon: [
      'd99bbbf4-1840-4b41-bebc-31a65cff95b5',
      '61110e2b-87ee-4a9f-8bbc-c883981c90e5',
      '005721ea-c615-4bbf-a471-a82f48ba5d07',
    ],
    frost: [
      '24215b72-4f49-4b49-a49b-8d15506fd47d',
      '62b29454-ac03-4d1e-8070-0f475d491ca5',
      'e823c7e2-7936-4299-9a9e-46138d442b67',
    ],
    arcane: [
      '17dba9dc-9990-4e22-a68b-fbbbf80bd770',
      'b6fb8eb5-592b-4258-a0b7-895f502f05c5',
      '19ec2d1d-c75f-4d64-8e15-5372668fe806',
    ],
  },
}
const maps: MapDesign[] = [
  {
    name: 'The Orchard',
    path: [[-12, 0, -7], [-7, 0, -7], [-7, 0, 5], [0, 0, 5], [0, 0, -4], [
      8,
      0,
      -4,
    ], [8, 0, 8]],
    slots: [
      [-9, -3],
      [-4, -3],
      [-4, 2],
      [-10, 5],
      [-4, 8],
      [3, 2],
      [3, -7],
      [8, -7],
      [5, 6],
      [11, 2],
    ],
    gold: 250,
    lives: 20,
  },
  {
    name: 'Riverbend',
    path: [
      [-13, 0, 5],
      [-9, 0, 5],
      [-9, 0, -5],
      [-2, 0, -5],
      [-2, 0, 4],
      [5, 0, 4],
      [5, 0, -7],
      [12, 0, -7],
    ],
    slots: [
      [-12, 0],
      [-6, 1],
      [-6, -8],
      [1, -2],
      [1, 7],
      [8, 0],
      [8, -4],
      [11, 4],
      [-6, 8],
      [-12, -7],
    ],
    gold: 265,
    lives: 20,
  },
  {
    name: 'The Switchback',
    path: [[-13, 0, -8], [10, 0, -8], [10, 0, -1], [-9, 0, -1], [-9, 0, 7], [
      12,
      0,
      7,
    ]],
    slots: [
      [-8, -5],
      [-2, -5],
      [4, -5],
      [7, 2],
      [1, 3],
      [-5, 3],
      [-12, 3],
      [-3, 10],
      [5, 10],
      [13, 2],
    ],
    gold: 280,
    lives: 18,
  },
]
const towerRows = (
  key: keyof typeof ids.towers,
  name: string,
  color: string,
  costs: number[],
  stats: Pick<
    TowerDesign,
    'range' | 'rate' | 'damage' | 'splash' | 'slow' | 'speed'
  >,
): Row[] =>
  ids.towers[key].map((eid, tier) => ({
    entity: { eid },
    tower_design: {
      name: `${name}${tier ? ` ${['', 'II', 'III'][tier]}` : ''}`,
      cost: costs[tier],
      ...stats,
      range: stats.range + tier * 0.6,
      rate: stats.rate * (1 + tier * 0.16),
      damage: Math.round(stats.damage * (1 + tier * 0.9)),
      splash: stats.splash ? stats.splash + tier * 0.2 : 0,
      slow: stats.slow ? Math.min(0.7, stats.slow + tier * 0.08) : 0,
      pierce: key == 'arcane' ? 1 : 0,
      upgrade: ids.towers[key][tier + 1] ?? null,
      figure: { kind: key, tint: color, tier: tier + 1 },
    },
  }))
export const seed: Row[] = [
  ...maps.map((map_design, i) => ({
    entity: { eid: ids.maps[i] },
    map_design,
  })),
  ...[
    {
      id: ids.enemies.runner,
      name: 'Hare',
      hp: 30,
      speed: 2.3,
      armour: 0,
      bounty: 6,
      tint: '#e7a75b',
      size: 0.7,
    },
    {
      id: ids.enemies.swarm,
      name: 'Bramble',
      hp: 19,
      speed: 1.6,
      armour: 0,
      bounty: 4,
      tint: '#86aa65',
      size: 0.6,
    },
    {
      id: ids.enemies.armoured,
      name: 'Ironback',
      hp: 95,
      speed: 1.1,
      armour: 65,
      bounty: 12,
      tint: '#8c9ba8',
      size: 1,
    },
    {
      id: ids.enemies.giant,
      name: 'Stoneheart',
      hp: 420,
      speed: 0.7,
      armour: 35,
      bounty: 35,
      tint: '#ba8d85',
      size: 1.5,
    },
  ].map(({ id, tint, size, ...enemy }) => ({
    entity: { eid: id },
    enemy_design: { ...enemy, figure: { tint, size } },
  })),
  ...towerRows('arrow', 'Ranger', '#d4b565', [55, 80, 130], {
    range: 5.3,
    rate: 1.5,
    damage: 15,
    splash: 0,
    slow: 0,
    speed: 22,
  }),
  ...towerRows('cannon', 'Bombard', '#de8a59', [95, 125, 180], {
    range: 5,
    rate: 0.55,
    damage: 38,
    splash: 2.2,
    slow: 0,
    speed: 11,
  }),
  ...towerRows('frost', 'Winterglass', '#80c8d3', [75, 90, 145], {
    range: 4.6,
    rate: 0.9,
    damage: 9,
    splash: 0.9,
    slow: 0.4,
    speed: 16,
  }),
  ...towerRows('arcane', 'Starwell', '#b396d9', [110, 140, 220], {
    range: 5.5,
    rate: 0.75,
    damage: 57,
    splash: 0,
    slow: 0,
    speed: 20,
  }),
  ...ids.maps.flatMap((map, m) =>
    Array.from({ length: 12 }, (_, i): Row => {
      let n = i + 1
      let enemy = n < 3
        ? ids.enemies.runner
        : n % 3 == 0
        ? ids.enemies.armoured
        : ids.enemies.swarm
      return {
        entity: { eid: uuidOf(`${map}/wave/${n}`) },
        wave_design: {
          map,
          n,
          groups: [
            {
              enemy,
              count: 7 + n * 2 + m,
              gap: enemy == ids.enemies.swarm ? 0.35 : 0.65,
            },
            ...(n >= 4
              ? [{ enemy: ids.enemies.runner, count: n + m, gap: 0.35 }]
              : []),
            ...(n % 4 == 0
              ? [{ enemy: ids.enemies.giant, count: n / 4, gap: 1.8 }]
              : []),
          ],
        },
      }
    })
  ),
]
