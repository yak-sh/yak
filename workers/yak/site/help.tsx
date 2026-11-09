/** @jsxImportSource preact */
import { Chip, Chips } from '@yaks/ui'
import { Data, Page, Yours } from './frame.tsx'

// What an engine reads of the page.
let data = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  'url': 'https://yaks.app/help',
  'mainEntity': [
    {
      '@type': 'Question',
      'name': 'What can I make?',
      'acceptedAnswer': {
        '@type': 'Answer',
        'text':
          'yaks.app supports personal and shared web apps: a recipe box, garden diary, book club schedule, potluck signup sheet, running log, or birthday guestbook.',
      },
    },
    {
      '@type': 'Question',
      'name': 'How do I start?',
      'acceptedAnswer': {
        '@type': 'Answer',
        'text':
          'Sign in with your email. We send a six-digit code; yaks.app does not use passwords. You land on your own space, and the steps for Claude or ChatGPT are there. After connecting, ask your assistant to build an app.',
      },
    },
    {
      '@type': 'Question',
      'name': 'How do I request an app or a change?',
      'acceptedAnswer': {
        '@type': 'Answer',
        'text':
          'Describe what you want in your own words. Your assistant builds the app and gives you its link. Request changes the same way. You do not need to specify every detail before the first version is built.',
      },
    },
    {
      '@type': 'Question',
      'name': 'Where are my apps and data?',
      'acceptedAnswer': {
        '@type': 'Answer',
        'text':
          'Your apps are hosted under a name you choose. For example, a recipe box can use yourname.yaks.app/recipes. Visitors open the URL in a browser and do not need to install anything.',
      },
    },
    {
      '@type': 'Question',
      'name': 'Who can see them?',
      'acceptedAnswer': {
        '@type': 'Answer',
        'text':
          'Set access separately for each app: anyone with the link can read it, anyone with the link can write in it too, or only you and the people you invite. You can change it later.',
      },
    },
    {
      '@type': 'Question',
      'name': 'How do invitations work?',
      'acceptedAnswer': {
        '@type': 'Answer',
        'text':
          'Tell your assistant who, and why. They receive an email with your note and the link, and sign in with the same email address. No prior account or installation is required.',
      },
    },
    {
      '@type': 'Question',
      'name': 'What should I do when an app breaks?',
      'acceptedAnswer': {
        '@type': 'Answer',
        'text':
          'Tell your assistant what you saw. You do not need to diagnose the problem first. Apps record errors automatically, and your assistant receives those errors the next time you use it.',
      },
    },
    {
      '@type': 'Question',
      'name': 'How do I export or delete an app?',
      'acceptedAnswer': {
        '@type': 'Answer',
        'text':
          "Ask your assistant to export the app. It can return the app's data as a list or spreadsheet and provide the app files. Deleted apps stay in the trash for 30 days. You can restore them during that time; after 30 days, they are permanently erased.",
      },
    },
    {
      '@type': 'Question',
      'name': 'How do I contact support?',
      'acceptedAnswer': {
        '@type': 'Answer',
        'text':
          'Email hello@yaks.app for help from a person. You can also ask your assistant to report a problem, which sends your message to the same support inbox. Found a security problem? Email hello@yaks.app.',
      },
    },
    {
      '@type': 'Question',
      'name': 'Where are the technical details?',
      'acceptedAnswer': {
        '@type': 'Answer',
        'text':
          'The technical page covers hosting, data storage, limits, and current limitations. The developer guide documents app data, files, sharing, invitations, errors, and the tools available to an assistant.',
      },
    },
  ],
}

export let Help = () => (
  <Page
    name='Help: building, sharing and exporting your apps'
    description='Answers about building apps, connecting an assistant, sharing, access, exports, and support.'
    path='/help'
    head={<Data of={data} />}
  >
    <div class='Prose_Head'>
      <h1 class='Title Title-page'>Help</h1>
      <p class='Prose_Text'>
        yaks.app gives you an Operator that does things for you and builds the
        apps it needs. You can also build apps by asking Claude or ChatGPT. This
        page covers setup, sharing, exports, and support. For anything else,
        email{' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>.
      </p>
      <Chips as='ul'>
        <li class='Prose_Item'>
          <Chip class='Prose_Link' href='#make'>What can I make?</Chip>
        </li>
        <li class='Prose_Item'>
          <Chip class='Prose_Link' href='#start'>How do I start?</Chip>
        </li>
        <li class='Prose_Item'>
          <Chip class='Prose_Link' href='#ask'>How do I request changes?</Chip>
        </li>
        <li class='Prose_Item'>
          <Chip class='Prose_Link' href='#where'>
            Where are my apps and data?
          </Chip>
        </li>
        <li class='Prose_Item'>
          <Chip class='Prose_Link' href='#who'>Who can see them?</Chip>
        </li>
        <li class='Prose_Item'>
          <Chip class='Prose_Link' href='#invite'>Inviting people</Chip>
        </li>
        <li class='Prose_Item'>
          <Chip class='Prose_Link' href='#broken'>Something's broken</Chip>
        </li>
        <li class='Prose_Item'>
          <Chip class='Prose_Link' href='#out'>Exporting and deleting</Chip>
        </li>
        <li class='Prose_Item'>
          <Chip class='Prose_Link' href='#people'>Contact support</Chip>
        </li>
      </Chips>
    </div>
    <section class='Prose_Section' id='make'>
      <h2 class='Prose_Heading'>What can I make?</h2>
      <p class='Prose_Text'>
        yaks.app supports personal and shared web apps: a recipe box, garden
        diary, book club schedule, potluck signup sheet, running log, or
        birthday guestbook.
      </p>
      <p class='Prose_Text'>
        Start with one or two sentences. Ask for a basic version first, then
        request changes as you use it.
      </p>
      <p class='Prose_Text'>
        You can also ask{' '}
        <q class='Said'>has somebody already made one of these?</q>{' '}
        If someone has published a suitable app, your assistant can install a
        copy in your space. That copy has its own URL and data store; installing
        it does not give the publisher access to your space.
      </p>
    </section>
    <section class='Prose_Section' id='start'>
      <h2 class='Prose_Heading'>How do I start?</h2>
      <p class='Prose_Text'>
        <a class='Prose_Link' href='/login'>Sign in</a>{' '}
        with your email. We send a six-digit code; yaks.app does not use
        passwords. You land on your own space, and the steps for Claude or
        ChatGPT are there. After connecting, ask your assistant to build an app.
      </p>
    </section>
    <section class='Prose_Section' id='ask'>
      <h2 class='Prose_Heading'>How do I request an app or a change?</h2>
      <p class='Prose_Text'>
        Describe what you want in your own words:{' '}
        <q class='Said'>
          Could you make me a recipe box? Something I can share with my sister.
        </q>{' '}
        Your assistant builds the app and gives you its link.
      </p>
      <p class='Prose_Text'>
        Request changes the same way.{' '}
        <q class='Said'>Put the newest ones first.</q>{' '}
        <q class='Said'>Let Ana leave a note on each one.</q>{' '}
        <q class='Said'>Make the photos bigger.</q>{' '}
        You do not need to specify every detail before the first version is
        built.
      </p>
      <p class='Prose_Text'>
        To undo a change, ask to restore an earlier version. The last twenty
        versions are kept. Restoring one changes the app's files, not its saved
        data.
      </p>
    </section>
    <section class='Prose_Section' id='where'>
      <h2 class='Prose_Heading'>Where are my apps and data?</h2>
      <p class='Prose_Text'>
        Your apps are hosted under a name you choose. For example, a recipe box
        can use{' '}
        <code class='Prose_Code'>
          <Yours path='/recipes' />
        </code>. Ask your assistant to choose which app opens at{' '}
        <code class='Prose_Code'>
          <Yours />
        </code>. Visitors open the URL in a browser and do not need to install
        anything.
      </p>
      <p class='Prose_Text'>
        Your space starts with a name from your email address. Change it at any
        time in your space settings, or ask your assistant to move your space.
        Every app moves with it, and old links keep working until someone else
        takes the old name.
      </p>
      <p class='Prose_Text'>
        Each app stores its own recipes, notes, photos, and other data. Changes
        are available on any device. Ask your assistant{' '}
        <q class='Said'>what apps have I made?</q>{' '}
        to list your apps and their links.
      </p>
    </section>
    <section class='Prose_Section' id='who'>
      <h2 class='Prose_Heading'>Who can see them?</h2>
      <p class='Prose_Text'>
        Set access separately for each app. You can change it later. There are
        three options:
      </p>
      <ul class='Prose_List'>
        <li class='Prose_Item'>
          <b>Anyone with the link can read it.</b>{' '}
          This is the default. Only you and invited members can make changes.
        </li>
        <li class='Prose_Item'>
          <b>Anyone with the link can write in it too.</b>{' '}
          For a vote, a signup sheet, or guestbook. Visitors can contribute
          without signing in.
        </li>
        <li class='Prose_Item'>
          <b>Only you and the people you invite.</b>{' '}
          Other visitors cannot open the app.
        </li>
      </ul>
      <p class='Prose_Text'>
        Tell your assistant which option to use:{' '}
        <q class='Said'>let anyone sign up on the potluck list</q>,{' '}
        <q class='Said'>keep the diary private</q>.
      </p>
    </section>
    <section class='Prose_Section' id='invite'>
      <h2 class='Prose_Heading'>How do invitations work?</h2>
      <p class='Prose_Text'>
        Tell your assistant who, and why:{' '}
        <q class='Said'>
          invite ana@example.com to the recipe box, and say it's for Saturday.
        </q>{' '}
        Ana receives an email with your note and a link to accept. Nothing is
        shared with them until they click it, signed in with the same email
        address. No prior account or installation is required.
      </p>
      <p class='Prose_Text'>
        Choose whether the person can edit, only view, or invite other people.
        Membership applies to every app under{' '}
        <code class='Prose_Code'>
          <Yours />
        </code>, not to a single app. Invite only people who should have access
        to the whole space.
      </p>
      <p class='Prose_Text'>
        To remove access, ask <q class='Said'>remove Ana from my space.</q>{' '}
        They can still sign in to yaks.app, but they lose access to your space.
        Their previous contributions are not deleted.
      </p>
    </section>
    <section class='Prose_Section' id='broken'>
      <h2 class='Prose_Heading'>What should I do when an app breaks?</h2>
      <p class='Prose_Text'>
        Tell your assistant what you saw:{' '}
        <q class='Said'>the photo on the pancakes won't load.</q>{' '}
        You do not need to diagnose the problem first.
      </p>
      <p class='Prose_Text'>
        Apps record errors automatically. Your assistant receives those errors
        the next time you use it. You can also ask{' '}
        <q class='Said'>are there any errors in the recipe box?</q>{' '}
        and ask it to make a fix.
      </p>
      <p class='Prose_Text'>
        If a recent change caused the problem, ask to restore an earlier
        version. Restoring app files does not change saved data.
      </p>
    </section>
    <section class='Prose_Section' id='out'>
      <h2 class='Prose_Heading'>How do I export or delete an app?</h2>
      <p class='Prose_Text'>
        Ask your assistant to export the app:{' '}
        <q class='Said'>give me everything in the recipe box as a file.</q>{' '}
        It can return the app's data as a list or spreadsheet and provide the
        app files.
      </p>
      <p class='Prose_Text'>
        To delete it, ask <q class='Said'>delete the recipe box.</q>{' '}
        Deleted apps stay in the trash for 30 days. You can restore them during
        that time; after 30 days, they are permanently erased.
      </p>
      <p class='Prose_Text'>
        To ask for a copy of everything we hold about you, or for your account
        to be closed, write to{' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>.
        The <a class='Prose_Link' href='/privacy'>privacy page</a>{' '}
        says what we keep and for how long.
      </p>
    </section>
    <section class='Prose_Section' id='people'>
      <h2 class='Prose_Heading'>How do I contact support?</h2>
      <p class='Prose_Text'>
        Email{' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>
        {' '}
        for help from a person.
      </p>
      <p class='Prose_Text'>
        You can also ask your assistant to report a problem for you.
      </p>
      <p class='Prose_Text'>
        Found a security problem? Email{' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>.
      </p>
    </section>
    <section class='Prose_Section' id='under'>
      <h2 class='Prose_Heading'>Where are the technical details?</h2>
      <p class='Prose_Text'>
        The <a class='Prose_Link' href='/docs'>documentation</a>{' '}
        covers app data, files, sharing, invitations, errors, and the tools
        available to an assistant. Its{' '}
        <a class='Prose_Link' href='/docs/technical'>technical details</a>{' '}
        page covers hosting, data storage, limits, and current limitations.
      </p>
    </section>
  </Page>
)
