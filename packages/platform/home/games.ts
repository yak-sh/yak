// The games landing page's demos (site/games.tsx): games in the demo space,
// each a conversation with a turn for each feature the page tells, and the
// pictures beside them. Mossvale's picture is its gallery card's; Holdfast's
// is a capture of its first screen kept in the app's own files, taken again
// with `yak admin browse https://yourname.yaks.app/holdfast/ --width 1280
// --height 900 --touch=false --stranger` and sent up with `yak admin upload
// yourname/holdfast`.
import {
  built,
  buyDomain,
  type Demo,
  DEMO_AT,
  live,
  type Scene,
  SHOT,
  them,
  you,
} from './demos.ts'
import type { Feature } from './parts.ts'

/** What the games page tells, in order. */
export const GAME_FEATURES: Feature[] = [
  'build',
  'change',
  'play',
  'helper',
  'code',
  'domain',
]

let picture = (src: string) => ({ src, width: 1280, height: 900 })

let vale = {
  slug: 'vale',
  shot: picture(
    SHOT +
      '0f562744-e91e-4958-bfb7-1ef06af52dc2/af7747ba58d7c51fa8770bed1f44c26377d5042aaa91033ab7b2c13fbe84d826',
  ),
}

let holdfast = {
  slug: 'holdfast',
  shot: picture(
    DEMO_AT +
      'holdfast/api/blob/b7fd442d60021fe8d7bdf9a1d6400705e1bfcff74c31312e073bf0efe0c291c3/20dcd1a3ea707584021c878d3acbc17f51e19bdc51ccdcc6c807c5a8b8cb32f3',
  ),
}

/** The games the page's phone plays, a turn for each of `GAME_FEATURES`. */
export const GAME_DEMOS: Demo[] = [
  {
    slug: 'holdfast',
    name: 'Tower defense',
    turn: [
      [
        you(
          'Make a 3D tower defense game for me and three friends, where we build towers together and share one purse of gold',
        ),
        built('Here’s your game.', holdfast),
      ],
      [
        you('add flying bats in wave 5 that only arrows can hit'),
        them('Done. Bats fly over the walls in wave 5.'),
      ],
      [
        you('let my friends join the same game from a link'),
        them('Invited 3 friends. They sign in with a code by email.'),
      ],
      [
        you('add a scout who tells players which tower to build'),
        them('Done. Ask the scout about the next wave.'),
      ],
      [
        you('where are the wave rules?'),
        them('In rules.ts. Change them yourself, or ask me.'),
      ],
      [
        you('put the game at holdthefort.example'),
        buyDomain,
        you('I bought it and chose the game'),
        live('holdthefort.example'),
      ],
    ],
  },
  {
    slug: 'vale',
    name: 'Fantasy world',
    turn: [
      [
        you(
          'Build a fantasy world my friends and I can explore together, with quests, crafting and a village',
        ),
        built('Here’s your world.', vale),
      ],
      [
        you('add a fishing pond by the village'),
        them('Done. Cast a line from the dock.'),
      ],
      [
        you('show who else is playing right now'),
        them('Done. Friends playing now show by name.'),
      ],
      [
        you('let players talk to the villagers'),
        them('Done. Villagers answer from the world’s story.'),
      ],
      [
        you('let me read the quest code'),
        them('It’s in quests.ts. Change it yourself, or ask me.'),
      ],
      [
        you('put the world at ourvale.example'),
        buyDomain,
        you('I bought it and chose the world'),
        live('ourvale.example'),
      ],
    ],
  },
]

/** What a player asks each game's characters, and where each game lives. */
export const GAME_SCENES: Record<string, Scene> = {
  holdfast: {
    domain: 'holdthefort.example',
    ask: [
      'What’s coming in wave 5?',
      'Bats. They fly over the walls, so build arrows near the gate.',
    ],
  },
  vale: {
    domain: 'ourvale.example',
    ask: [
      'Elder Wren, what do you need?',
      'Four jellies from the moss slimes in the meadow, and I’ll brew you a tonic.',
    ],
  },
}
