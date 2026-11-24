/** @jsxImportSource preact */
import { Button, Card } from '@yaks/ui'
import { Plan } from '@yaks/platform/home'
import { Page, Yours } from './frame.tsx'
import { attr, type Slots, text } from './copy.ts'

let PLANS = ['free', 'plus', 'pro'] as const

// What every card lists, in the same order, so a reader compares the plans
// across: a card's nth line says the same thing of each plan.
let ITEMS = [
  'domain',
  'renewal',
  'payments',
  'badge',
  'change',
]

// Terms and what each means, a pair under `<at>.<item>`: an item's slots fill
// either of its lines.
let Terms = ({ at, items }: { at: string; items: Record<string, Slots> }) => (
  <dl class='Yours_List'>
    {Object.entries(items).map(([item, slots]) => (
      <div>
        <dt class='Yours_Term' {...text(`${at}.${item}.term`, slots)} />
        <dd class='Yours_Detail' {...text(`${at}.${item}.detail`, slots)} />
      </div>
    ))}
  </dl>
)

// A row of the limits table that explains itself: its name's note.
let noted = (row: string) => ({
  note: <small class='Limits_Note' {...text(`pricing.limits.${row}.note`)} />,
})

export let Pricing = () => (
  <Page
    copy='pricing'
    path='/pricing'
    kind='Pricing'
  >
    <section class='Hello' aria-labelledby='hello'>
      <h1
        class='Title Title-page'
        id='hello'
        {...text('pricing.hello.title')}
      />
      <p
        class='Note Note-lead'
        {...text('home.cost.note', { yours: <Yours /> })}
      />
      <p class='Note' {...text('pricing.hello.lead')} />
    </section>
    <section class='Cost' aria-labelledby='plans'>
      <h2 class='Title' id='plans' {...text('pricing.plans.title')} />
      <div class='Plans'>
        {PLANS.map((plan) => (
          <Plan
            copy={{ attr, text }}
            plan={plan}
            items={ITEMS}
            slots={plan == 'free' ? {} : {
              domain: <b {...text(`home.cost.${plan}.example`)} />,
            }}
          />
        ))}
      </div>
      <p class='Note Note-small' {...text('pricing.plans.renewal')} />
      <p class='Note Note-small' {...text('home.cost.ai')} />
    </section>
    <section aria-labelledby='always'>
      <h2 class='Title' id='always' {...text('pricing.always.title')} />
      <ul class='Plan_List'>
        {[
          'members',
          'visitors',
          'joining',
          'publishing',
          'installing',
          'exporting',
        ].map((item) => (
          <li class='Plan_Item' {...text(`pricing.always.${item}`)} />
        ))}
      </ul>
    </section>
    <section class='Yours' aria-labelledby='paying'>
      <h2 class='Title' id='paying' {...text('pricing.paying.title')} />
      <Terms
        at='pricing.paying'
        items={{
          space: {},
          first: {},
          owner: {},
          limit: {},
          stop: {},
          assistant: {},
          tax: {},
          // The rate sell.ts `quoted` splices in as the page is served.
          fee: { fee: <span class='Fee'>0%</span> },
        }}
      />
    </section>
    <section class='Limits' aria-labelledby='limits'>
      <h2 class='Title' id='limits' {...text('pricing.limits.title')} />
      <div class='Limits_Table'>
        <table class='Limits_Grid'>
          <thead>
            <tr>
              <td class='Limits_Cell Limits_Value' />
              {PLANS.map((plan) => (
                <th
                  class='Limits_Cell Limits_Plan'
                  scope='col'
                  {...text(`pricing.limits.plans.${plan}`)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries<Slots>({
              apps: {},
              data: noted('data'),
              files: noted('files'),
              visits: noted('visits'),
              emails: noted('emails'),
              ai: noted('ai'),
              compute: noted('compute'),
              sandboxes: noted('sandboxes'),
            }).map(([row, slots]) => (
              <tr>
                <th
                  class='Limits_Cell Limits_Name'
                  scope='row'
                  {...text(`pricing.limits.${row}.name`, slots)}
                />
                {PLANS.map((plan) => (
                  <td
                    class='Limits_Cell Limits_Value'
                    {...text(`pricing.limits.${row}.${plan}`)}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Terms
        at='pricing.limits'
        items={{ mail: {}, invitations: {}, guests: {}, open: {} }}
      />
    </section>
    <section aria-labelledby='selling'>
      <h2 class='Title' id='selling' {...text('pricing.selling.title')} />
      <p
        class='Note'
        {...text('pricing.selling.note', {
          terms: <a href='/terms' {...text('pricing.selling.terms')} />,
        })}
      />
    </section>
    <Card class='Join' aria-labelledby='start'>
      <h2 class='Title' id='start' {...text('pricing.start.title')} />
      <p class='Note' {...text('pricing.start.note')} />
      <p class='Join_Doors'>
        <Button mod='go' href='/login' {...text('pricing.start.go')} />
      </p>
    </Card>
  </Page>
)
