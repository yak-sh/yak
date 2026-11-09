/** @jsxImportSource preact */
import { Button, Card } from '@yaks/ui'
import { GET_PLAN } from '../route.ts'
import { Page, Yours } from './frame.tsx'

export let Pricing = () => (
  <Page
    name='Pricing: your first space is free, and the Plus plan is $9 a month'
    description='You pay for a space, not for people, and invite as many as you like on any plan. Your first space is free. The Plus plan is $9 a month for a space, and the Pro plan $49.'
    path='/pricing'
    kind='Pricing'
  >
    <section class='Hello' aria-labelledby='hello'>
      <h1 class='Title Title-page' id='hello'>Pricing</h1>
      <p class='Note Note-lead'>
        You pay for a space, not for people. Invite as many as you like on any
        plan.
      </p>
      <p class='Note'>
        A space is your own address, like{' '}
        <Yours />, with the apps there, their data and the people you invite.
      </p>
    </section>
    <section class='Cost' aria-labelledby='plans'>
      <h2 class='Title' id='plans'>Each space is free or on a paid plan</h2>
      <div class='Plans'>
        <Card as='div' class='Plan'>
          <h3 class='Plan_Price'>Free</h3>
          <p class='Note Note-small'>Your first space.</p>
          <ul class='Plan_List'>
            <li class='Plan_Item'>5 apps</li>
            <li class='Plan_Item'>Unlimited visitors</li>
            <li class='Plan_Item'>1 GB of app data</li>
            <li class='Plan_Item'>1 GB of photos and files</li>
            <li class='Plan_Item'>100 emails a month</li>
            <li class='Plan_Item'>No custom domain</li>
            <li class='Plan_Item'>No payments</li>
            <li class='Plan_Item'>A small “Made with yaks.app” badge</li>
            <li class='Plan_Item'>AI use included</li>
            <li class='Plan_Item'>
              Your Operator, or your own assistant, makes the changes
            </li>
          </ul>{' '}
          <Button mod='go' href='/login'>Start Free</Button>
        </Card>
        <Card as='div' class='Plan Plan-plus'>
          <h3 class='Plan_Price'>
            $9
            <span class='Plan_Per'>&#32;a month</span>
          </h3>
          <p class='Note Note-small'>The Plus plan, for any space.</p>
          <ul class='Plan_List'>
            <li class='Plan_Item'>Unlimited apps</li>
            <li class='Plan_Item'>Unlimited visitors</li>
            <li class='Plan_Item'>10 GB of app data</li>
            <li class='Plan_Item'>50 GB of photos and files</li>
            <li class='Plan_Item'>2,500 emails a month</li>
            <li class='Plan_Item'>
              A custom domain, like <b>ourbookclub.com</b>
            </li>
            <li class='Plan_Item'>Take payments with Stripe</li>
            <li class='Plan_Item'>No yaks.app badge</li>
            <li class='Plan_Item'>AI use included</li>
            <li class='Plan_Item'>
              Your Operator, or your own assistant, makes the changes
            </li>
          </ul>{' '}
          <Button mod='go' href={GET_PLAN}>
            Get Started
          </Button>
        </Card>
        <Card as='div' class='Plan Plan-pro'>
          <h3 class='Plan_Price'>
            $49
            <span class='Plan_Per'>&#32;a month</span>
          </h3>
          <p class='Note Note-small'>The Pro plan. Or $490 a year.</p>
          <ul class='Plan_List'>
            <li class='Plan_Item'>Unlimited apps</li>
            <li class='Plan_Item'>Unlimited visitors</li>
            <li class='Plan_Item'>10 GB of app data</li>
            <li class='Plan_Item'>50 GB of photos and files</li>
            <li class='Plan_Item'>2,500 emails a month</li>
            <li class='Plan_Item'>
              A custom domain, like <b>ourtownship.org</b>
            </li>
            <li class='Plan_Item'>Take payments with Stripe</li>
            <li class='Plan_Item'>No yaks.app badge</li>
            <li class='Plan_Item'>AI use included</li>
            <li class='Plan_Item'>
              Your staff ask the Operator by email or chat, and it makes the
              change
            </li>
          </ul>{' '}
          <Button mod='go' href={GET_PLAN}>
            Get Started
          </Button>
        </Card>
      </div>
    </section>
    <section aria-labelledby='always'>
      <h2 class='Title' id='always'>Free on every plan</h2>
      <ul class='Plan_List'>
        <li class='Plan_Item'>Members and invitations, as many as you like</li>
        <li class='Plan_Item'>Visitors to your apps</li>
        <li class='Plan_Item'>Joining other people's spaces</li>
        <li class='Plan_Item'>Publishing your apps to the gallery</li>
        <li class='Plan_Item'>Installing a copy of someone's published app</li>
        <li class='Plan_Item'>Exporting your data, and deleting it</li>
      </ul>
    </section>
    <section class='Yours' aria-labelledby='paying'>
      <h2 class='Title' id='paying'>How paying works</h2>
      <dl class='Yours_List'>
        <div>
          <dt class='Yours_Term'>
            A space is one address and everything in it.
          </dt>
          <dd class='Yours_Detail'>
            That's its apps, their data and its people. Each space has its own
            plan and its own limits, and what one space uses never counts
            against another.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>
            Your first space is free, and you can join as many as you like.
          </dt>
          <dd class='Yours_Detail'>
            You can own one free space. Every other space you make is on the
            Plus plan or the Pro plan. Spaces other people invite you into never
            count toward yours. If you already own more than one free space,
            they all stay free.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>
            A space's owner pays for it, and members never do.
          </dt>
          <dd class='Yours_Detail'>
            Only an owner can upgrade a space, change its plan or cancel it,
            from that space's settings. Editors and viewers never pay, and
            there's no charge for each person.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>At a limit, nothing is deleted.</dt>
          <dd class='Yours_Detail'>
            Adding stops: a new app, more data or another email waits until the
            space has room or moves to a paid plan. The owner is told which
            limit the space reached and how to upgrade, and your assistant hears
            when a space nears one. Members keep using everything, and visitors
            are always served.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>
            If you stop paying, the space goes back to free.
          </dt>
          <dd class='Yours_Detail'>
            A paid plan runs to the end of the month you paid for. Then the
            space has the free plan's limits again and stops taking payments.
            Its apps and data stay.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>
            Your Claude or ChatGPT plan pays for your assistant, and yaks.app
            keeps what it makes online.
          </dt>
          <dd class='Yours_Detail'>
            Your assistant builds and changes your apps on your own
            subscription, and that never spends a space's AI use. A space's AI
            use is for the AI its apps use themselves, such as reading a photo
            or speaking, and for yaks.app's built-in builder.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>Prices include tax.</dt>
          <dd class='Yours_Detail'>
            Any sales tax or VAT is in the price. Nothing is added at checkout.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>
            We take <span class='Fee'>0%</span> of each sale.
          </dt>
          <dd class='Yours_Detail'>
            Stripe charges its own processing fees. How selling works is below.
          </dd>
        </div>
      </dl>
    </section>
    <section class='Limits' aria-labelledby='limits'>
      <h2 class='Title' id='limits'>Every limit, plan by plan</h2>
      <div class='Limits_Table'>
        <table class='Limits_Grid'>
          <thead>
            <tr>
              <td class='Limits_Cell Limits_Value' />
              <th class='Limits_Cell Limits_Plan' scope='col'>Free</th>
              <th class='Limits_Cell Limits_Plan' scope='col'>Plus</th>
              <th class='Limits_Cell Limits_Plan' scope='col'>Pro</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th class='Limits_Cell Limits_Name' scope='row'>Apps</th>
              <td class='Limits_Cell Limits_Value'>5</td>
              <td class='Limits_Cell Limits_Value'>Unlimited</td>
              <td class='Limits_Cell Limits_Value'>Unlimited</td>
            </tr>
            <tr>
              <th class='Limits_Cell Limits_Name' scope='row'>
                App data{' '}
                <small class='Limits_Note'>
                  What your apps save, like entries, lists and settings.
                </small>
              </th>
              <td class='Limits_Cell Limits_Value'>1 GB</td>
              <td class='Limits_Cell Limits_Value'>10 GB</td>
              <td class='Limits_Cell Limits_Value'>10 GB</td>
            </tr>
            <tr>
              <th class='Limits_Cell Limits_Name' scope='row'>
                Photos and files{' '}
                <small class='Limits_Note'>
                  Pictures and documents your apps keep.
                </small>
              </th>
              <td class='Limits_Cell Limits_Value'>1 GB</td>
              <td class='Limits_Cell Limits_Value'>50 GB</td>
              <td class='Limits_Cell Limits_Value'>50 GB</td>
            </tr>
            <tr>
              <th class='Limits_Cell Limits_Name' scope='row'>
                Visits a month{' '}
                <small class='Limits_Note'>
                  Counted in request units: each request for a page or its data
                  is one, and 20 live updates are one. Past it, visitors are
                  still served and the owner is told.
                </small>
              </th>
              <td class='Limits_Cell Limits_Value'>50,000</td>
              <td class='Limits_Cell Limits_Value'>1,000,000</td>
              <td class='Limits_Cell Limits_Value'>1,000,000</td>
            </tr>
            <tr>
              <th class='Limits_Cell Limits_Name' scope='row'>
                Emails a month{' '}
                <small class='Limits_Note'>
                  Sent or received by your apps. Invitations don't count.
                </small>
              </th>
              <td class='Limits_Cell Limits_Value'>100</td>
              <td class='Limits_Cell Limits_Value'>2,500</td>
              <td class='Limits_Cell Limits_Value'>2,500</td>
            </tr>
            <tr>
              <th class='Limits_Cell Limits_Name' scope='row'>
                AI use{' '}
                <small class='Limits_Note'>
                  What models and voice cost, in your apps and in the built-in
                  builder.
                </small>
              </th>
              <td class='Limits_Cell Limits_Value'>Included</td>
              <td class='Limits_Cell Limits_Value'>Included</td>
              <td class='Limits_Cell Limits_Value'>Included</td>
            </tr>
            <tr>
              <th class='Limits_Cell Limits_Name' scope='row'>
                Builds a month{' '}
                <small class='Limits_Note'>
                  With yaks.app's built-in builder, for people without an
                  assistant of their own. A build counts when it puts an app
                  online.
                </small>
              </th>
              <td class='Limits_Cell Limits_Value'>5</td>
              <td class='Limits_Cell Limits_Value'>100</td>
              <td class='Limits_Cell Limits_Value'>100</td>
            </tr>
            <tr>
              <th class='Limits_Cell Limits_Name' scope='row'>
                Compute time a month{' '}
                <small class='Limits_Note'>
                  Time your sandbox runs commands, and compiling code at deploy.
                </small>
              </th>
              <td class='Limits_Cell Limits_Value'>1 hour</td>
              <td class='Limits_Cell Limits_Value'>10 hours</td>
              <td class='Limits_Cell Limits_Value'>10 hours</td>
            </tr>
            <tr>
              <th class='Limits_Cell Limits_Name' scope='row'>
                Sandboxes at once{' '}
                <small class='Limits_Note'>
                  Each sandbox is a computer of its own.
                </small>
              </th>
              <td class='Limits_Cell Limits_Value'>1</td>
              <td class='Limits_Cell Limits_Value'>2</td>
              <td class='Limits_Cell Limits_Value'>2</td>
            </tr>
          </tbody>
        </table>
      </div>
      <dl class='Yours_List'>
        <div>
          <dt class='Yours_Term'>Mail to your apps always arrives.</dt>
          <dd class='Yours_Detail'>
            At the email limit, only sending stops. The count starts again on
            the first day of each month.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>Invitations are free, up to 50 an hour.</dt>
          <dd class='Yours_Detail'>
            Invite as many people as you like, on any plan. Invitations never
            count toward the month's emails, and one person may send 50 an hour.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>
            Visitors who aren't signed in have a per-minute pace.
          </dt>
          <dd class='Yours_Detail'>
            Anyone not signed in can make up to 300 requests a minute for an
            app's data from one place, and past that is asked to wait a minute.
            You and the people in your space aren't counted.
          </dd>
        </div>
        <div>
          <dt class='Yours_Term'>
            Visitors to an open app keep a visitor's pace.
          </dt>
          <dd class='Yours_Detail'>
            On an app anyone with the link can add to, each visitor may send 30
            changes a minute, 16 KB at a time, and upload files of up to 2 MB. A
            visitor changes only what they added. You and your editors aren't
            held to these limits.
          </dd>
        </div>
      </dl>
    </section>
    <section aria-labelledby='selling'>
      <h2 class='Title' id='selling'>Sell from your apps on a paid plan</h2>
      <p class='Note'>
        Take payments on the Plus plan or the Pro plan. Connect your Stripe
        account to receive payments, and handle refunds and disputes there.{' '}
        <a href='/terms'>Selling terms</a>.
      </p>
    </section>
    <Card class='Join' aria-labelledby='start'>
      <h2 class='Title' id='start'>Start with a free space</h2>
      <p class='Note'>
        You can move a space to a paid plan later, from that space.
      </p>
      <p class='Join_Doors'>
        <Button mod='go' href='/login'>Start free</Button>
      </p>
    </Card>
  </Page>
)
