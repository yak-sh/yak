// The apps the home pages show (site/home.tsx, site/build.tsx): each one's
// address in the demo space (gallery-demo.ts `DEMO`), its name and what it is
// for. A page names its demos in its file. Each wears the platform's
// `featured` mark (featured-move.ts), which is what lets the gallery serve a
// private one's picture (gallery.ts `featured`); an app added here is featured
// with `gallery_feature` so its card has its picture.

/** One example: its address, its name, and what it is for. */
export type Example = [slug: string, title: string, sub: string]

/** The carousel of the home page that pitches the Operator, and of
 * /operator. */
export let HOME: Example[] = [
  ['garden', 'Garden Diary', 'Note what you planted and how it grew.'],
  ['bookclub', 'Book Club', 'Choose books and plan your next meeting.'],
  ['trip', 'Travel Planner', "Plan the days, who's coming and what to pack."],
  ['recipes', 'Recipe Box', 'Save recipes and share them with family.'],
  [
    'guestbook',
    'Birthday Guestbook',
    'Collect birthday messages from friends.',
  ],
  ['chores', 'Chore Chart', 'Keep track of whose turn it is.'],
  [
    'housebook',
    'Housebook',
    'Your home’s manual: appliances, upkeep, paint colors and papers.',
  ],
  [
    'sound-lab',
    'Sound Lab',
    'Build beats, shape sounds and export your music.',
  ],
  [
    'vale',
    'Mossvale',
    'A fantasy world to play in the browser, with quests and crafting.',
  ],
]

/** The carousel of the home page that leads with the app a visitor gets,
 * things for work first. */
export let BUILD: Example[] = [
  [
    'menu',
    'Wren’s Bakery',
    'A market stall’s menu with prices, marked sold out from a phone.',
  ],
  [
    'directory',
    'Church Directory',
    'A members-only directory with families, photos and birthdays.',
  ],
  ['trip', 'Travel Planner', "Plan the days, who's coming and what to pack."],
  ['recipes', 'Recipe Box', 'Save recipes and share them with family.'],
  ['chores', 'Chore Chart', 'Keep track of whose turn it is.'],
]

/** Every app a home page shows, each once. */
export let DEMOS = [...new Set([...HOME, ...BUILD].map(([slug]) => slug))]
