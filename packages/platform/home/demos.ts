type Link = { label: string; href: string }
type Shot = { src: string; width: number; height: number }
export type Line = {
  who: 'you' | 'them'
  text: string
  link?: Link
  shot?: Shot
}
export type Demo = { slug: string; name: string; turn: Line[][] }

const SHOT = '/gallery/image/'
const DEMO_AT = 'https://yourname.yaks.app/'
const you = (text: string): Line => ({
  who: 'you',
  text: text[0].toUpperCase() + text.slice(1),
})
const them = (text: string): Line => ({ who: 'them', text })
/** The first reply: the app, its picture and its link. */
const built = (text: string, d: { slug: string; shot: Shot }): Line => ({
  who: 'them',
  text,
  shot: d.shot,
  link: { label: 'Open demo', href: `${DEMO_AT}${d.slug}/` },
})
const live = (domain: string) => them(`Your app is ready at ${domain}.`)
/** Where to buy a domain and have it connected to the app. */
const buyDomain: Line = {
  who: 'them',
  text:
    'You can buy a domain in your plan settings. Choose this app at checkout and we’ll connect it for you.',
  link: { label: 'See the plans', href: '#cost' },
}

/** The features, in the order of the turns: the hero is turn 0. */
export const TURNS = [
  'build',
  'change',
  'connect',
  'email',
  'sell',
  'helper',
  'team',
  'domain',
] as const

const d = (
  slug: string,
  name: string,
  shot: string,
  turns: (dd: { slug: string; shot: Shot }) => Line[][],
  height = 900,
): Demo => {
  const at = { slug, shot: { src: SHOT + shot, width: 1280, height } }
  return { slug, name, turn: turns(at) }
}

/** The demos, in the live carousel's order with Wren's Bakery first. */
export const DEMOS: Demo[] = [
  d(
    'menu',
    'Bakery',
    '09f6250e-6a17-4090-a1a3-321dc8c06c3b/8a36b2e856af08517ebfa8ddf765e9deab575b9cce3a6b8d106af75c40fc2117',
    (a) => [
      [
        you(
          'Make me a menu for my farmer’s market bakery, with prices and a photo of each bake',
        ),
        built('Here’s your menu.', a),
      ],
      [
        you('let me mark things sold out from my phone'),
        them('Done. One tap marks an item sold out.'),
      ],
      [
        you('add each order to my Google Sheet too'),
        them('Connected. Each order adds a row.'),
      ],
      [
        you('email people when a sold-out bake is back'),
        them('Done. Customers can sign up on each sold-out item.'),
        you('post the specials I email you on Fridays'),
        them('Email them to yourname.menu@yaks.app.'),
      ],
      [
        you('take orders for Saturday pickup, paid ahead'),
        them('Orders are open. Payments go to your Stripe account.'),
      ],
      [
        you('answer customers’ questions about allergens'),
        them('Done. A helper answers from your recipes.'),
      ],
      [
        you('let Sam and Ana edit the menu too'),
        them('Invited. They sign in with a code by email.'),
      ],
      [
        you('put the menu at wrensbakery.example'),
        buyDomain,
        you('I bought it and chose the menu'),
        live('wrensbakery.example'),
      ],
    ],
  ),
  d(
    'directory',
    'Directory',
    '6f759635-ecc7-4f01-bcdb-83e6d5a6a4f6/89398f0312a1b1887582bb9012ea511ad7cb9fe64424a79e756ab7155038c877',
    (a) => [
      [
        you(
          'Build a members-only directory for our church, with families, phones and birthdays',
        ),
        built('Here’s your directory.', a),
      ],
      [
        you('add anniversaries beside the birthdays'),
        them('Done. Each family has an anniversary.'),
      ],
      [
        you('put our events on the church’s Google Calendar'),
        them('Connected. New events go on the calendar.'),
      ],
      [
        you('email me the week’s birthdays every Monday at 7'),
        them('Set. This week has 3 birthdays.'),
        you('post the bulletin I email each Friday'),
        them('Email the bulletin to yourname.directory@yaks.app.'),
      ],
      [
        you('sell tickets to the pancake breakfast, $8 each'),
        them('Tickets are on sale, paid by card.'),
      ],
      [
        you('let visitors ask about service times and parking'),
        them('Done. A helper answers from your pages.'),
      ],
      [
        you('only members can open the directory'),
        them('Done. Members sign in with a code by email.'),
      ],
      [
        you('put the directory at fairview.example.org'),
        buyDomain,
        you('I bought it and chose the directory'),
        live('fairview.example.org'),
      ],
    ],
  ),
  d(
    'bookclub',
    'Book club',
    '57a0765b-9b8e-4529-954f-9fe911955ded/807a1bf3336bfc13d4651dd3ba00b8607f88244b9a15b8fb6246dfbbda9cccb1',
    (a) => [
      [
        you(
          'Make a page for our book club: the book, the next meeting and who’s hosting',
        ),
        built('Here’s your book club.', a),
      ],
      [
        you('let members vote on the next book'),
        them('Voting is on. One vote each.'),
      ],
      [
        you('make a Zoom link for each online meeting'),
        them('Connected. Each meeting has a link.'),
      ],
      [
        you('remind everyone two days before each meeting'),
        them('Reminders set for 9 members.'),
        you('add the books I email you to the shortlist'),
        them('Email them to yourname.bookclub@yaks.app.'),
      ],
      [
        you('sell tickets to the author night, $15'),
        them('On sale. 40 seats.'),
      ],
      [
        you('let members ask about books we’ve read'),
        them('Done. A helper answers from your notes.'),
      ],
      [you('invite the other eight members'), them('Invited 8 members.')],
      [
        you('put the club at ourbookclub.example'),
        buyDomain,
        you('I bought it and chose the book club'),
        live('ourbookclub.example'),
      ],
    ],
  ),
  d(
    'guestbook',
    'Guestbook',
    '3c9dd847-3fce-4784-be3e-b04070515a3c/6c2c57c6b1e7874400e09e23181162d71f56726aef5c13685544ea188c10e4d4',
    (a) => [
      [
        you(
          'Build a guestbook for Mom’s 70th that anyone with the link can sign',
        ),
        built('Here’s your guestbook.', a),
      ],
      [
        you('let guests add a photo'),
        them('Done. Each message can have a photo.'),
      ],
      [
        you('save every photo to our Google Drive folder'),
        them('Connected. New photos go to the folder.'),
      ],
      [
        you('message the guests a thank-you from me'),
        them('Sent emails to 21 guests.'),
        you('add the photos my sister emails'),
        them('She can send them to yourname.guestbook@yaks.app.'),
      ],
      [
        you('let guests chip in for Mom’s gift'),
        them('Done. Gifts go to your Stripe account.'),
      ],
      [
        you('let guests ask when and where the party is'),
        them('Done. A helper answers from the invitation.'),
      ],
      [
        you('let my sister help run the guestbook'),
        them('Invited her as an editor.'),
      ],
      [
        you('put the guestbook at margaretturns70.example'),
        buyDomain,
        you('I bought it and chose the guestbook'),
        live('margaretturns70.example'),
      ],
    ],
    800,
  ),
  d(
    'trip',
    'Trip',
    'b03852bc-e2d2-4c99-9edc-38eff6ff18b5/ed8d13000c43319fe561d6a6567125db375c0fdaa8409665d327e4dddefe2e41',
    (a) => [
      [
        you(
          'Make a trip planner for the six of us in Lisbon: the days, who’s coming and what to pack',
        ),
        built('Here’s your trip planner.', a),
      ],
      [
        you('give each person a packing list to tick off'),
        them('Done. Everyone has a list.'),
      ],
      [
        you('bring in the budget from our Google Sheet'),
        them('Connected. The budget reads from the sheet.'),
      ],
      [
        you('email everyone the plan the night before each day'),
        them('Set. The first one goes out Friday.'),
        you('add the bookings I forward'),
        them('Forward them to yourname.trip@yaks.app.'),
      ],
      [
        you('collect each person’s $180 share for the villa'),
        them('Done. Shares go to your Stripe account.'),
      ],
      [
        you('let everyone ask what’s on for a day'),
        them('Done. A helper answers from the plan.'),
      ],
      [you('invite the other five'), them('Invited 5 people.')],
      [
        you('put the planner at reyesinlisbon.example'),
        buyDomain,
        you('I bought it and chose the trip planner'),
        live('reyesinlisbon.example'),
      ],
    ],
  ),
  d(
    'recipes',
    'Recipes',
    'c195a2cb-e637-427b-8782-197176d6ff4e/59f846c653f52459906f63cc6906c63b9f3acee4935f9dae5d3d1bc036c660f4',
    (a) => [
      [
        you(
          'Build a recipe box for our family’s recipes, with ingredients, steps and notes',
        ),
        built('Here’s your recipe box.', a),
      ],
      [
        you('add a photo to each recipe'),
        them('Done. Tap a recipe to add one.'),
      ],
      [
        you('bring in the recipes from my Notion page'),
        them('Connected. Added 37 recipes.'),
      ],
      [
        you('email the family a recipe every Sunday'),
        them('Set. Sundays at 9 am.'),
        you('add the recipes Grandma emails'),
        them('She can send them to yourname.recipes@yaks.app.'),
      ],
      [
        you('sell printed copies of our cookbook, $24'),
        them('On sale. Orders are listed in your app.'),
      ],
      [
        you('suggest a dinner from what’s in my kitchen'),
        them('Done. Type what you have, and the helper suggests one.'),
      ],
      [
        you('let my cousins add recipes too'),
        them('Invited 4 cousins as editors.'),
      ],
      [
        you('put the recipes at grandmaskitchen.example'),
        buyDomain,
        you('I bought it and chose the recipe box'),
        live('grandmaskitchen.example'),
      ],
    ],
  ),
]

/** What each demo's pictures beside the words show: the service it connects,
 * the letter it sends, the mail it takes in, what it sells and what a
 * visitor asks its helper. A page that doesn't tell a feature needs none of
 * its picture. */
export type Scene = {
  connects?: string
  domain?: string
  letter?: [string, string]
  mail?: [string, string]
  sale?: [string, number]
  ask?: [string, string]
}
export const SCENES: Record<string, Scene> = {
  menu: {
    connects: 'google-sheet',
    domain: 'wrensbakery.example',
    letter: [
      'Back in stock: rye sourdough',
      'The rye sourdough is back this Saturday. Order ahead for pickup.',
    ],
    mail: ['Friday specials', 'specials.pdf'],
    sale: ['Saturday pickup: 2 rye sourdough', 14],
    ask: [
      'Is the rye sourdough nut-free?',
      'Yes. The rye sourdough is made without nuts.',
    ],
  },
  directory: {
    connects: 'google-calendar',
    domain: 'fairview.example.org',
    letter: [
      'This week’s birthdays',
      'Three birthdays this week: Ruth on Monday, Daniel on Wednesday and Mae on Friday.',
    ],
    mail: ['This Sunday’s bulletin', 'bulletin.pdf'],
    sale: ['Pancake breakfast ticket', 8],
    ask: [
      'Where do I park on Sunday?',
      'In the lot behind the hall, or on Elm Street.',
    ],
  },
  bookclub: {
    connects: 'zoom',
    domain: 'ourbookclub.example',
    letter: [
      'Book club on Thursday',
      'We meet Thursday at 7. The Zoom link is on the club’s page.',
    ],
    mail: ['For the shortlist', 'three-books.txt'],
    sale: ['Author night ticket', 15],
    ask: [
      'Which book are we reading in May?',
      'The book with the most votes, chosen on April 20.',
    ],
  },
  guestbook: {
    connects: 'google-drive',
    domain: 'margaretturns70.example',
    letter: [
      'Thank you for coming!',
      'Mom loved every message. Thank you for being there.',
    ],
    mail: ['More party photos', 'photos.zip'],
    sale: ['A gift for Mom', 25],
    ask: [
      'When does the party start?',
      'Saturday at 2 pm, at the community hall.',
    ],
  },
  trip: {
    connects: 'google-sheet',
    domain: 'reyesinlisbon.example',
    letter: [
      'Tomorrow: Sintra',
      'The 9:10 train from Rossio. Bring good shoes.',
    ],
    mail: ['Booking: the villa', 'booking.pdf'],
    sale: ['Your share of the villa', 180],
    ask: [
      'What’s on for Tuesday?',
      'Sintra: the 9:10 train from Rossio, then the palace.',
    ],
  },
  recipes: {
    connects: 'notion',
    domain: 'grandmaskitchen.example',
    letter: [
      'Sunday’s recipe: pierogi',
      'This week, Grandma’s pierogi, with her notes on the dough.',
    ],
    mail: ['Aunt Rose’s apple cake', 'apple-cake.jpg'],
    sale: ['The printed family cookbook', 24],
    ask: [
      'What can I make with eggs, spinach and feta?',
      'Grandma’s spinach frittata, or spanakopita.',
    ],
  },
}
