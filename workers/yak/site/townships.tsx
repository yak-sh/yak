/** @jsxImportSource preact */
// The landing page for a Michigan township (variant.ts `township`): what the
// township app does for a clerk and the residents, and a calculator of the
// dates the Open Meetings Act makes a meeting's notice and minutes due. Only
// its own address shows it, so that address is its canonical one.
//
// The app is the published `township-office`, whose sample copy stands in the
// demo space at yourname.yaks.app/township. Its button installs a copy. The
// calculator runs that app's own deadlines.js, imported from the sample's
// address as the page runs (public/township-dues.js), so the page and every
// township's meeting pages count the days alike.
//
// It names and quotes no township until one says we may. Everything it
// promises is the app's: the Record page, the drafted minutes, the due dates
// and the reminder are in its deadlines.js, minutes.js and record.js, the
// search and the notices in its site.js.
import { Button, Card, Check, Field, Form } from '@yaks/ui'
import { installAt } from '@yaks/platform/routes'
import { BUDGET, PRICE, YEARLY } from '../meter.ts'
import { Page, Yours } from './frame.tsx'

/** Where the page lives. */
export let PATH = '/townships'

/** The name the township app is published under, which its button installs. */
export let APP = 'township-office'

/** The sample township's site, a copy of the app in the demo space. */
export let SAMPLE = 'https://yourname.yaks.app/township/'

/** The app's own function of what a meeting makes due, served open to every
 * origin: `dues(starts, zone)` answers `{proposed, approved, notice}`. */
export let DUES = `${SAMPLE}deadlines.js`

/** About what recording a two-hour meeting live costs in AI, in dollars:
 * Deepgram's Nova-3 hearing it with its speakers told apart, $0.0097 a
 * minute (@yaks/speech DEEPGRAM), $1.16 for two hours, and the drafts of its
 * minutes made as it goes. */
export let MEETING = 1.25

/** The statutes the page cites, where the state publishes them. */
let LAW = {
  minutes: 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-15-269',
  notice: 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-15-265',
}

let Cite = ({ law, said }: { law: keyof typeof LAW; said: string }) => (
  <a href={LAW[law]}>{said}</a>
)

export let Townships = () => (
  <Page
    name="AI for townships — a Michigan township website that drafts the board's minutes as it meets"
    title="AI for townships — a Michigan township website that drafts the board's minutes as it meets"
    description="A website for a Michigan township: meetings, documents and notices, proposed minutes drafted from the meeting as it happens, and the dates the Open Meetings Act makes them due. Work out any meeting's notice and minutes deadlines on the page."
    path={PATH}
    kind='Home'
    head={
      <>
        <script src='cta.js' defer />
        <script src='township-dues.js' defer />
      </>
    }
  >
    <section class='Hello' aria-labelledby='hello'>
      <div class='Hello_Copy'>
        <p class='Hello_Kicker'>For Michigan townships</p>
        <h1 class='Title Title-hero' id='hello'>
          A township website that drafts the board's minutes as it meets
        </h1>
        <p class='Note'>
          Meetings, documents and notices for residents, and proposed minutes
          ready for the clerk to correct a few minutes after the board adjourns.
        </p>
        <p class='Join_Doors'>
          <Button mod='go' href={installAt(APP)} data-cta='start'>
            Get your township's copy
          </Button>{' '}
          <Button href={SAMPLE} data-cta='examples'>
            See a sample township's site <span aria-hidden='true'>↗</span>
          </Button>
        </p>
        <p class='Note Note-small'>
          Free to start. It is a new site at an address of its own, and the site
          your township has now isn't changed.
        </p>
      </div>
    </section>
    <section aria-labelledby='dues'>
      <h2 class='Title' id='dues'>
        When a meeting's notice and minutes are due
      </h2>
      <p class='Note'>Michigan's Open Meetings Act sets three dates:</p>
      <ul class='Plan_List'>
        <li class='Plan_Item'>
          Proposed minutes are available to the public within 8 business days
          after the meeting (<Cite law='minutes' said='MCL 15.269' />).
        </li>
        <li class='Plan_Item'>
          Approved minutes are available within 5 business days after the
          meeting that approves them (<Cite law='minutes' said='MCL 15.269' />).
        </li>
        <li class='Plan_Item'>
          A special meeting, or a regular one moved to a new date, is noticed at
          least 18 hours before it starts (<Cite
            law='notice'
            said='MCL 15.265'
          />).
        </li>
      </ul>
      <Form as='div' class='Dues' data-dues={DUES} hidden>
        <p class='Form_Label' id='meeting'>
          Type a meeting's date to see its dates
        </p>
        <div class='Dues_Fields' role='group' aria-labelledby='meeting'>
          <Form.Field>
            <Form.Label for='dues-day'>The meeting's date</Form.Label>
            <Field id='dues-day' type='date' />
          </Form.Field>
          <Form.Field>
            <Form.Label for='dues-time'>
              The time it starts <Form.Optional>(for its notice)</Form.Optional>
            </Form.Label>
            <Field id='dues-time' type='time' />
          </Form.Field>
          <Form.Field>
            <Form.Label for='dues-zone'>Time zone</Form.Label>
            <Field id='dues-zone' choose>
              <option value='America/Detroit' selected>Eastern</option>
              <option value='America/Chicago'>Central</option>
            </Field>
          </Form.Field>
        </div>
        <Check>
          <Check.Input type='checkbox' id='dues-special' />
          It is a special meeting, or a regular one moved to a new date
        </Check>
        <div class='Dues_Said' role='status' aria-live='polite' />
        <Form.Hint>
          Business days skip weekends and Michigan's legal holidays. These are
          the dates the township site works out on every meeting's page, by the
          same calculation, and nothing you type here is sent to us.
        </Form.Hint>
      </Form>
    </section>
    <section class='Yours' aria-labelledby='site'>
      <h2 class='Title' id='site'>What residents find on the site</h2>
      <dl class='Yours_List'>
        <div>
          <dt class='Yours_Term'>Every board's meetings</dt>
          <dd class='Yours_Detail'>
            Each with its agenda and minutes beside it, on a calendar residents
            can add to their own phones.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>Search inside the documents</dt>
          <dd class='Yours_Detail'>
            Agendas, minutes, budgets and ordinances as PDFs, and a search that
            reads inside them and opens the page a word is on.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>Notices</dt>
          <dd class='Yours_Detail'>
            Special meetings and notices on the home page, and the board's
            minutes emailed to residents who ask for them.{' '}
            <a href={SAMPLE} data-cta='examples'>
              Open the sample site <span aria-hidden='true'>↗</span>
            </a>
          </dd>
        </div>
      </dl>
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how'>Minutes drafted as the board meets</h2>
      <ol class='Steps'>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>Press Record when the meeting starts</h3>
          <p class='Note'>
            Press it on the meeting's page, on a laptop or phone in the room.
            The words appear as they are said. Pause during a closed session:
            nothing is heard or kept while paused. A meeting recorded on
            something else can be uploaded afterwards.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>The draft fills in as the meeting goes</h3>
          <p class='Note'>
            Each motion, who moved and seconded it and how it ended, and each
            member's vote on a roll call. Name the voices, and the draft says
            who spoke. Whatever the recording doesn't make plain is left blank
            and marked unsure.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>The clerk corrects it and posts it</h3>
          <p class='Note'>
            Play any line back from the recording, fix what needs it, and post
            the draft as the proposed minutes: residents read them on the
            meeting's page, and those who asked are emailed them. Once the board
            approves them, the clerk marks them approved. Nothing is posted
            without the clerk.
          </p>
        </li>
        <li class='Steps_Item'>
          <h3 class='Step_Name'>
            The recording is kept as long as the law says
          </h3>
          <p class='Note'>
            Michigan's records schedule for townships keeps a recording made for
            minutes until they are approved, plus one day (General Schedule 25,
            item 25.201). Then the page offers to delete it, and nothing is
            deleted unless the clerk chooses to.
          </p>
        </li>
      </ol>
      <p class='Note Note-small'>
        Only the township's editors hear the recordings and see the drafts.
      </p>
    </section>
    <section class='Yours' aria-labelledby='clerk'>
      <h2 class='Title' id='clerk'>
        Due dates on every meeting, and an assistant for the rest
      </h2>
      <dl class='Yours_List'>
        <div>
          <dt class='Yours_Term'>Each meeting's page says what is due</dt>
          <dd class='Yours_Detail'>
            “Proposed minutes due Friday, Nov 20”, counted from the meeting, and
            “posted” once they are.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>A reminder before a date is missed</dt>
          <dd class='Yours_Detail'>
            Three business days before minutes are due and not yet posted, the
            township's assistant emails the clerk. It reminds, and blocks
            nothing.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>An assistant that keeps the site</dt>
          <dd class='Yours_Detail'>
            Email or chat with it to put a meeting on the calendar, call one
            off, post a notice or add minutes someone sent as a file. It makes
            the change and writes back. On yaks.app it is called the Operator.
          </dd>
        </div>
      </dl>
    </section>
    <section class='Cost' aria-labelledby='cost'>
      <h2 class='Title' id='cost'>
        Free to start, with your own domain on a plan
      </h2>
      <p class='Note'>
        Your township's copy lives in a space: its address on yaks.app, like
        {' '}
        <Yours name='yourtownship' path='/township' />, its apps and the people
        you invite to edit them. The site, the minutes and the reminders work on
        the free plan. Your own domain, like{' '}
        <b>yourtownship.org</b>, is on the Plus plan at ${PRICE.plus}{' '}
        a month. The Pro plan, at ${PRICE.pro} a month or ${YEARLY.pro}{' '}
        a year, adds a larger AI budget and support.
      </p>
      <p class='Note'>
        Recording a two-hour meeting live uses about ${MEETING.toFixed(2)}{' '}
        of AI, from the space's monthly AI budget: ${BUDGET.free}{' '}
        on the free plan and ${BUDGET.pro}{' '}
        on the Pro plan. Nothing is charged beyond the plan's price unless the
        space's owner buys more AI credit on the Pro plan, up to a monthly cap
        they set.
      </p>
      <p class='Note Note-small'>
        <a href='/pricing'>Compare plans and limits</a>.{' '}
        <a href='/organizations#behind'>
          Who is behind yaks.app, and who fixes its mistakes
        </a>.
      </p>
    </section>
    <Card class='Join' aria-labelledby='join'>
      <h2 class='Title' id='join'>Start your township's site</h2>
      <p class='Join_Doors'>
        <Button mod='go' href={installAt(APP)} data-cta='join'>
          Get your township's copy
        </Button>
      </p>
      <p class='Note Note-small'>Free to start, with a sign-in by email.</p>
    </Card>
  </Page>
)
