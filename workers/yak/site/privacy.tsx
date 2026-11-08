/** @jsxImportSource preact */
import { Page } from './frame.tsx'

export let Privacy = () => (
  <Page
    name='Privacy policy'
    description='What yaks.app stores about you, where it lives, and who can see it.'
    path='/privacy'
  >
    <div class='Prose_Head'>
      <h1 class='Title Title-page'>Privacy policy</h1>
      <p class='Prose_When'>Last updated 6 November 2026</p>
      <p>
        We collect as little information as we can. This policy lists all of it.
      </p>
    </div>
    <section>
      <h2>About us</h2>
      <address>
        Yak Shaving LLC
        <br /> 971 S Centerville Rd, #2009
        <br /> Sturgis, Michigan 49091
        <br /> United States
      </address>
      <p>
        Send questions, corrections and deletion requests to{' '}
        <a href='mailto:hello@yaks.app'>hello@yaks.app</a>.
      </p>
    </section>
    <section>
      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Your email address.</strong>{' '}
          We use it to sign you in, to send your code, and to let other people
          invite you to their apps. We don't show it to other people: an app
          shows a name, never an address.
        </li>
        <li>
          <strong>Your name.</strong>{' '}
          When you first sign in, we ask what you'd like to be called. If you
          skip the question, we use the part of your address before the @. That
          name appears beside what you write in an app other people can see.
        </li>
        <li>
          <strong>A session cookie.</strong>{' '}
          We set this cookie for everyone. It ties anything written without
          signing in (guest entries) to the browser that wrote it, and keeps you
          signed in. Signing in puts your name on that browser's guest entries
          across apps. Visitor counts never use this cookie. The{' '}
          <a href='/cookies'>cookies page</a> has the details.
        </li>
        <li>
          <strong>Which campaign brought you.</strong>{' '}
          If the link you followed to yaks.app carries campaign tags or an ad's
          click id, we keep them, and when you arrived, in a second cookie for
          ninety days, so a sign-up can be counted against the campaign that
          brought it. Our own counts of each step from the home page to signing
          up keep the campaign's name, never who took the step. The{' '}
          <a href='/cookies'>cookies page</a> has the details.
        </li>
        <li>
          <strong>Your sign-in codes, briefly.</strong>{' '}
          A code lasts ten minutes and allows five guesses. We never store the
          digits, only a one-way hash of them, so nobody reading our records can
          sign in as you.
        </li>
        <li>
          <strong>The content of your apps.</strong>{' '}
          Everything you and the people you invited write (text, lists, photos
          and any other uploaded file), along with who wrote it and when.
        </li>
        <li>
          <strong>The apps themselves.</strong>{' '}
          The files your assistant writes to build them.
        </li>
        <li>
          <strong>Email your apps send and receive.</strong>{' '}
          An app can have its own email address, like{' '}
          <b>yourspace.yourapp@yaks.app</b>. We keep anything sent to that
          address in the app, including the sender's address, the message and
          any attachments. Anything the app sends goes out under that address.
        </li>
        <li>
          <strong>Your mobile number, if you give one.</strong>{' '}
          You can sign in or sign up with a US mobile number instead of an email
          address, or give one on your space's Operator page. We text it the
          sign-in codes you ask for and, once you've agreed, your Operator's
          answers and its alerts about your space and the apps you build. We
          keep the number, the words you agreed to, and when you agreed, and
          never use them for marketing. Replying STOP, or stopping texts on that
          page, ends texts; the number stays with your account as a way to sign
          in until you ask us to remove it.
        </li>
        <li>
          <strong>Error reports.</strong>{' '}
          If a page or a request fails, we record the error message, where in
          the code it came from, the address being visited, and which version of
          the app was running. We send that report to your assistant so it can
          fix the problem. It isn't a record of what you were doing.
        </li>
        <li>
          <strong>Page counts for your app.</strong>{' '}
          So you can see whether anyone is reading your app, we count each page
          it serves: which page, which country the request came from, which site
          linked to it, and whether the visitor was a person's browser, a search
          crawler or an AI assistant. We keep only the counts. They contain no
          address, name, cookie or user agent string, so they can't identify or
          track a visitor. We keep them for about three months, and only the
          app's own members can see them.
        </li>
        <li>
          <strong>What you say to our builder.</strong>{' '}
          If you have us build an app for you instead of using your own
          assistant, what you type goes to a model that reads and answers it. We
          keep the conversation with your space so you can continue it later.
        </li>
        <li>
          <strong>Feedback you send us.</strong>{' '}
          If you ask your assistant to report a problem or send us a request or
          comment, your words are emailed to us at{' '}
          <a href='mailto:hello@yaks.app'>hello@yaks.app</a>{' '}
          and added to the list where we track them. Your name, your email
          address, the space and app you were in, and the version that was
          running are included, so we can look into it and reply. We keep those
          reports.
        </li>
      </ul>
    </section>
    <section>
      <h2>Information we don't collect</h2>
      <p>
        We don't keep an advertising profile, a history of where else you've
        been, your location, or your contacts. We don't keep your card number
        either: Stripe sells and charges for the paid plan, your card goes to
        Stripe and never through us, and Stripe tells us only your plan and
        whether it's active. We don't sell anything to anyone, ever.
      </p>
    </section>
    <section>
      <h2>Where information is stored</h2>
      <p>
        All of it is on Cloudflare, which hosts yaks.app. Cloudflare's workers
        run the code, its storage holds each app's data and files, its network
        carries every request, its model answers you in the builder, and its
        containers are the sandboxes where your agent runs commands. Cloudflare
        handles this information on our behalf and keeps its own operational
        records of requests, as any host does. That network is worldwide, so
        your information may be stored in a different country from someone
        else's.
      </p>
    </section>
    <section>
      <h2>Who we share information with</h2>
      <p>
        Besides Cloudflare, we share information with three other companies.
        {' '}
        <strong>Stripe</strong>{' '}
        sells the paid plan: we give Stripe your email address so it can bill
        you, and Stripe tells us whether the plan is active.{' '}
        <strong>Telnyx</strong>{' '}
        carries our text messages: when we text you, Telnyx receives your number
        and the message so it can deliver it, and nothing else.{' '}
        <strong>Meta</strong>{' '}
        runs our ads on Facebook and Instagram. If you came to yaks.app by
        clicking one of them, we tell Meta, from our servers, when you open a
        page of this site and when you sign up: the page's address, the time,
        the click id Meta put on the link, and your browser's IP address and
        user agent, which Meta needs to match the event to its ad. We tell Meta
        nothing about visits its ads didn't bring, and never your name, your
        email address or anything in your apps.
      </p>
      <p>
        We don't share your mobile number or your agreement to receive texts
        with anyone else, and nobody uses them for marketing, including us.
      </p>
      <p>
        Apart from telling Meta about the visits its own ads brought, we don't
        share information with advertisers, data brokers or analytics companies.
        Feedback you send us reaches us by email, so it passes through the email
        providers between you and our inbox, as any email does.
      </p>
    </section>
    <section>
      <h2>Buyers</h2>
      <p>
        Some yaks apps sell things. When one does, the seller is the merchant,
        not us (see the <a href='/terms'>terms</a>). Your card details go to
        {' '}
        <strong>Stripe</strong>{' '}
        on Stripe's own page and never touch this platform or the app. Neither
        we nor the seller ever see your card number.
      </p>
      <p>
        We do see the order, and it goes to two places. <b>The seller</b>{' '}
        receives what you bought, what it cost, and the email address you gave
        at checkout, stored in the seller's app so the seller can send you what
        you bought. <b>Stripe</b>{' '}
        takes the payment and holds the record of it under the seller's account.
        We keep our copy of the order for as long as the seller keeps the app.
        Deleting the app deletes it, and the seller can delete a single order.
      </p>
      <p>
        We use your email address only for the receipt the app sends you. We
        don't add you to a list, and we never sell your address.
      </p>
    </section>
    <section>
      <h2>Sellers</h2>
      <p>
        When you connect a Stripe account, we send <strong>Stripe</strong>{' '}
        your email address and the name of your space. Stripe then asks you
        directly for your business details, your identity documents and your
        bank account. <b>Those never come to us.</b>{' '}
        Stripe tells us three things, and we keep only those: the account's id,
        whether Stripe says you may take payments, and whether you finished
        Stripe's form.
      </p>
    </section>
    <section>
      <h2>Email</h2>
      <p>
        We send sign-in codes and invitations through Cloudflare Email Sending.
        Those are the only emails we send you without your asking, and each one
        results from something you or another person did.
      </p>
      <p>
        Email from your apps and feedback you send us go through the same
        service.
      </p>
    </section>
    <section>
      <h2>Analytics</h2>
      <p>
        No advertising or analytics code runs on our pages. We count the steps
        people take from the home page to signing up, with the site and campaign
        that sent them but not who took them, and Cloudflare gives us the
        ordinary request counts any host sees. What Meta is told about visits
        its ads brought is above.
      </p>
    </section>
    <section>
      <h2>Who can see your content</h2>
      <p>
        You set this for each app. Private means you and the members you
        invited. Public means anyone with the link can read it. Open means
        anyone with the link can also write in it. Anyone you invite can see
        what's in that app.
      </p>
      <p>
        Your assistant sees the apps you connected it to, and acts as you when
        it does. We look at the content of your apps only when you ask us for
        help, or when we have to in order to keep the service running or to
        comply with the law.
      </p>
    </section>
    <section>
      <h2>Data retention</h2>
      <p>We keep your information for as long as you have an account.</p>
      <p>
        When you delete an app, it goes to the trash. It stops responding at its
        address immediately, and we keep its data and files for 30 days so you
        can restore it. After 30 days we erase its data, its files and
        everything else belonging to it, and this can't be undone. If you ask us
        to erase it immediately instead, we erase it right away and keep
        nothing.
      </p>
      <p>
        You can close a space by asking your assistant to delete it and
        confirming the link we email you, or by deleting it yourself while
        signed in. The same 30 days apply to the whole space. It stops
        responding at all of its addresses immediately, and we keep its apps,
        their saved data and files, and your conversation with our builder for
        30 days so you can restore it. We also hold the space's address for you
        during those 30 days. After that, we erase everything and the address
        becomes available to others. If you ask for the space to be erased
        immediately instead, your assistant emails you a link for that too, and
        we erase it right away.
      </p>
      <p>
        If you ask us to close your account, we remove everything else,
        including our record of you. Backups and server records expire on their
        own in the following weeks.
      </p>
    </section>
    <section>
      <h2>Your rights</h2>
      <p>
        Email <a href='mailto:hello@yaks.app'>hello@yaks.app</a>{' '}
        to ask for a copy of what we hold, a correction, or deletion, and we'll
        do it. Depending on where you live, including the UK, the EU and
        California, the law may give you these rights formally. We honor these
        requests wherever you live.
      </p>
    </section>
    <section>
      <h2>Children</h2>
      <p>
        yaks.app isn't built for children, and it isn't for anyone under 13. If
        a child's information has ended up here, tell us and we'll remove it.
      </p>
    </section>
    <section>
      <h2>Changes to this policy</h2>
      <p>
        If this policy changes, we'll update this page and the date at the top,
        and we'll email you if the change matters to you.
      </p>
    </section>
  </Page>
)
