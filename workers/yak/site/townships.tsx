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
import { type Slots, text } from './copy.ts'
import { Page, Yours } from './frame.tsx'
import { arrow } from './home.tsx'

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
 * minutes made as it goes. The page says it in its copy
 * (`townships.cost.meeting`), which site_test.ts holds to this. */
export let MEETING = 1.25

/** The statutes the page cites, where the state publishes them. */
let LAW = {
  minutes: 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-15-269',
  notice: 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-15-265',
}

/** The dates the Open Meetings Act sets, each by the statute that sets it. */
let RULES = {
  proposed: 'minutes',
  approved: 'minutes',
  notice: 'notice',
} as const

// A statute, linked to where the state publishes it.
let cite = (law: keyof typeof LAW) => (
  <a href={LAW[law]} {...text(`townships.dues.cite.${law}`)} />
)

// What the app does for a township, each a term and its detail under
// `townships.<group>.<item>`, filling the detail's slots.
let Terms = (
  { group, items }: { group: string; items: Record<string, Slots> },
) => (
  <dl class='Yours_List'>
    {Object.entries(items).map(([item, slots]) => (
      <div>
        <dt class='Yours_Term' {...text(`townships.${group}.${item}.term`)} />
        <dd
          class='Yours_Detail'
          {...text(`townships.${group}.${item}.detail`, slots)}
        />
      </div>
    ))}
  </dl>
)

// A link to the sample township's site, its arrow after its words.
let sample = (key: string) => text(key, { arrow: arrow('↗') })

export let Townships = () => (
  <Page
    copy='townships'
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
        <p class='Hello_Kicker' {...text('townships.hello.kicker')} />
        <h1
          class='Title Title-hero'
          id='hello'
          {...text('townships.hello.title')}
        />
        <p class='Note' {...text('townships.hello.lead')} />
        <p class='Join_Doors'>
          <Button
            mod='go'
            href={installAt(APP)}
            data-cta='start'
            {...text('townships.hello.get')}
          />{' '}
          <Button
            href={SAMPLE}
            data-cta='examples'
            {...sample('townships.hello.sample')}
          />
        </p>
        <p class='Note Note-small' {...text('townships.hello.note')} />
      </div>
    </section>
    <section aria-labelledby='dues'>
      <h2 class='Title' id='dues' {...text('townships.dues.title')} />
      <p class='Note' {...text('townships.dues.note')} />
      <ul class='Plan_List'>
        {Object.entries(RULES).map(([rule, law]) => (
          <li
            class='Plan_Item'
            {...text(`townships.dues.law.${rule}`, { cite: cite(law) })}
          />
        ))}
      </ul>
      <Form as='div' class='Dues' data-dues={DUES} hidden>
        <p class='Form_Label' id='meeting' {...text('townships.dues.ask')} />
        <div class='Dues_Fields' role='group' aria-labelledby='meeting'>
          <Form.Field>
            <Form.Label for='dues-day' {...text('townships.dues.day')} />
            <Field id='dues-day' type='date' />
          </Form.Field>
          <Form.Field>
            <Form.Label
              for='dues-time'
              {...text('townships.dues.time', {
                optional: (
                  <Form.Optional {...text('townships.dues.optional')} />
                ),
              })}
            />
            <Field id='dues-time' type='time' />
          </Form.Field>
          <Form.Field>
            <Form.Label for='dues-zone' {...text('townships.dues.zone')} />
            <Field id='dues-zone' choose>
              <option
                value='America/Detroit'
                selected
                {...text('townships.dues.zones.eastern')}
              />
              <option
                value='America/Chicago'
                {...text('townships.dues.zones.central')}
              />
            </Field>
          </Form.Field>
        </div>
        <Check>
          <Check.Input type='checkbox' id='dues-special' />
          <span {...text('townships.dues.special')} />
        </Check>
        <div class='Dues_Said' role='status' aria-live='polite' />
        {
          /* The lines the script says a meeting's dates in, each with a place
            for its date (public/township-dues.js). */
        }
        <template class='Dues_Lines'>
          {Object.entries<Slots>({
            proposed: { day: <span data-at='' /> },
            approved: { day: <span data-at='' /> },
            notice: { hour: <span data-at='' /> },
            untimed: {},
          }).map(([due, slots]) => (
            <li
              class='Plan_Item'
              data-due={due}
              {...text(`townships.dues.said.${due}`, slots)}
            />
          ))}
        </template>
        <Form.Hint {...text('townships.dues.hint')} />
      </Form>
    </section>
    <section class='Yours' aria-labelledby='site'>
      <h2 class='Title' id='site' {...text('townships.site.title')} />
      <Terms
        group='site'
        items={{
          meetings: {},
          search: {},
          notices: {
            sample: (
              <a
                href={SAMPLE}
                data-cta='examples'
                {...sample('townships.site.sample')}
              />
            ),
          },
        }}
      />
    </section>
    <section class='How' aria-labelledby='how'>
      <h2 class='Title' id='how' {...text('townships.how.title')} />
      <ol class='Steps'>
        {['record', 'draft', 'post', 'keep'].map((step) => (
          <li class='Steps_Item'>
            <h3 class='Step_Name' {...text(`townships.how.${step}.name`)} />
            <p class='Note' {...text(`townships.how.${step}.detail`)} />
          </li>
        ))}
      </ol>
      <p class='Note Note-small' {...text('townships.how.note')} />
    </section>
    <section class='Yours' aria-labelledby='clerk'>
      <h2 class='Title' id='clerk' {...text('townships.clerk.title')} />
      <Terms group='clerk' items={{ due: {}, reminder: {}, assistant: {} }} />
    </section>
    <section class='Cost' aria-labelledby='cost'>
      <h2 class='Title' id='cost' {...text('townships.cost.title')} />
      <p
        class='Note'
        {...text('townships.cost.space', {
          yours: <Yours name='yourtownship' path='/township' />,
          domain: <b {...text('townships.cost.domain')} />,
        })}
      />
      <p class='Note' {...text('townships.cost.meeting')} />
      <p
        class='Note Note-small'
        {...text('townships.cost.links', {
          plans: <a href='/pricing' {...text('home.cost.plans')} />,
          behind: (
            <a
              href='/organizations#behind'
              {...text('townships.cost.behind')}
            />
          ),
        })}
      />
    </section>
    <Card class='Join' aria-labelledby='join'>
      <h2 class='Title' id='join' {...text('townships.join.title')} />
      <p class='Join_Doors'>
        <Button
          mod='go'
          href={installAt(APP)}
          data-cta='join'
          {...text('townships.hello.get')}
        />
      </p>
      <p class='Note Note-small' {...text('townships.join.note')} />
    </Card>
  </Page>
)
