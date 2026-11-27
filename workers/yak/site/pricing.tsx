/** @jsxImportSource react */
import { Button, Card } from '@yaks/ui'
import { Plan } from '@yaks/platform/home'
import { Page } from './frame.tsx'
import { CostNote, SupportContract } from './home.tsx'
import { attr, list, type Slots, text } from './copy.ts'

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
  <dl className='Yours_List'>
    {Object.entries(items).map(([item, slots]) => (
      <div>
        <dt className='Yours_Term' {...text(`${at}.${item}.term`, slots)} />
        <dd className='Yours_Detail' {...text(`${at}.${item}.detail`, slots)} />
      </div>
    ))}
  </dl>
)

// A row of the limits table that explains itself: its name's note.
let noted = (row: string) => ({
  note: (
    <small className='Limits_Note' {...text(`pricing.limits.${row}.note`)} />
  ),
})

export let Pricing = () => (
  <Page
    copy='pricing'
    path='/pricing'
    kind='Pricing'
  >
    <section className='Hello' aria-labelledby='hello'>
      <h1
        className='Title Title-page'
        id='hello'
        {...text('pricing.hello.title')}
      />
      <CostNote className='Note Note-lead' />
      <p className='Note' {...text('pricing.hello.lead')} />
    </section>
    <section className='Cost' aria-labelledby='plans'>
      <h2 className='Title' id='plans' {...text('pricing.plans.title')} />
      <div className='Plans'>
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
      <SupportContract />
      <p className='Note Note-small' {...text('pricing.plans.renewal')} />
      <p className='Note Note-small' {...text('home.cost.ai')} />
    </section>
    <section aria-labelledby='always'>
      <h2 className='Title' id='always' {...text('pricing.always.title')} />
      <ul
        className='Plan_List'
        {...list(
          'pricing.always.items',
          (says) => <li className='Plan_Item'>{says}</li>,
        )}
      />
    </section>
    <section className='Yours' aria-labelledby='paying'>
      <h2 className='Title' id='paying' {...text('pricing.paying.title')} />
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
          fee: { fee: <span className='Fee'>0%</span> },
        }}
      />
    </section>
    <section className='Limits' aria-labelledby='limits'>
      <h2 className='Title' id='limits' {...text('pricing.limits.title')} />
      <div className='Limits_Table'>
        <table className='Limits_Grid'>
          <thead>
            <tr>
              <td className='Limits_Cell Limits_Value' />
              {PLANS.map((plan) => (
                <th
                  className='Limits_Cell Limits_Plan'
                  scope='col'
                  {...text(`pricing.limits.plans.${plan}`)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries<Slots>({
              apps: {},
              connections: noted('connections'),
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
                  className='Limits_Cell Limits_Name'
                  scope='row'
                  {...text(`pricing.limits.${row}.name`, slots)}
                />
                {PLANS.map((plan) => (
                  <td
                    className='Limits_Cell Limits_Value'
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
      <h2 className='Title' id='selling' {...text('pricing.selling.title')} />
      <p
        className='Note'
        {...text('pricing.selling.note', {
          terms: <a href='/terms' {...text('pricing.selling.terms')} />,
        })}
      />
    </section>
    <Card className='Join' aria-labelledby='start'>
      <h2 className='Title' id='start' {...text('pricing.start.title')} />
      <p className='Note' {...text('pricing.start.note')} />
      <p className='Join_Doors'>
        <Button mod='go' href='/login' {...text('pricing.start.go')} />
      </p>
    </Card>
  </Page>
)
