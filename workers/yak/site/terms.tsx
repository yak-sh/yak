import { Time } from '@yaks/ui/parts'
/** @jsxImportSource preact */
import { Page } from './frame.tsx'

export let Terms = () => (
  <Page
    copy='terms'
    path='/terms'
  >
    <div class='Prose_Head'>
      <h1 class='Title Title-page'>Terms of service</h1>
      <p class='Prose_When Prose_Text'>
        Last updated <Time written timeZone='UTC' at='2026-11-05T00:00:00Z' />
      </p>
      <p class='Prose_Text'>
        These terms govern your use of yaks.app. By signing in or using the
        site, you agree to them.
      </p>
    </div>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>About us</h2>
      <p class='Prose_Text'>yaks.app is operated by:</p>
      <address class='Prose_Address'>
        Yak Shaving LLC
        <br /> 971 S Centerville Rd, #2009
        <br /> Sturgis, Michigan 49091
        <br /> United States
      </address>
      <p class='Prose_Text'>
        You can reach us at{' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>The service</h2>
      <p class='Prose_Text'>
        yaks.app hosts small apps built for you by your own assistant: Claude,
        ChatGPT, or another assistant that supports the same connector. You ask
        for an app, your assistant builds it, and it runs at an address of
        yours.
      </p>
      <p class='Prose_Text'>
        yaks.app is a new, small service. Features will change, and some of them
        will break.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Accounts and sign-in</h2>
      <p class='Prose_Text'>
        You sign in with your email address, or a US mobile number, and a
        six-digit code we send to it. Anyone who can read your email or your
        texts can get into your account, so keep them secure. Anything done from
        your account is treated as done by you. If something looks wrong, email
        {' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>
        {' '}
        and we'll help.
      </p>
      <p class='Prose_Text'>
        You must be old enough to enter into a contract where you live, and at
        least 13.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Your content</h2>
      <p class='Prose_Text'>
        The apps you make and everything you put in them are yours. We don't
        claim to own any of it. You give us permission to store it, copy it and
        show it to the people you've shared it with, as needed to host it.
      </p>
      <p class='Prose_Text'>
        You're responsible for what you and your guests put in an app, and for
        having the right to put it there. Don't use yaks.app for medical
        records, card numbers, or other information subject to strict legal
        requirements.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Acceptable use</h2>
      <p class='Prose_Text'>
        Our{' '}
        <a class='Prose_Link' href='/acceptable-use'>acceptable use policy</a>
        {' '}
        lists what isn't allowed. It is part of these terms.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>App visibility</h2>
      <p class='Prose_Text'>
        Every app has a setting for who may see it. Private means you and the
        people you've invited. Public means anyone with the link can read it.
        Open means anyone with the link can also write in it. You choose the
        setting and can change it at any time. People you've already sent a link
        to will still have it, so take care when making an app open.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Fees and payment</h2>
      <p class='Prose_Text'>
        We offer a free plan and a paid plan. The{' '}
        <a class='Prose_Link' href='/pricing'>pricing page</a>{' '}
        lists what each plan costs and includes. Stripe sells and charges for
        the paid plan, and we will never charge a card you haven't given us.
      </p>
      <p class='Prose_Text'>
        You can cancel at any time, and the paid plan stays active until the end
        of the month you've paid for. Each plan includes the amounts listed on
        the pricing page. We may also set limits so that one person's use can't
        take the service down for everyone else.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Invites</h2>
      <p class='Prose_Text'>
        Your invite page has a code for the people you'd like to bring to
        yaks.app. Each person who signs up with it and builds their first app
        gives your space one more free month of the Plus plan. If you already
        pay through Stripe, your next charge moves a month later instead.
      </p>
      <p class='Prose_Text'>
        An invite is for somebody else. Inviting yourself, under another address
        or number, isn't allowed, and neither is making accounts to collect the
        free AI use a new person's first space comes with. We watch for both,
        and may take back what was gained that way or close the accounts
        involved.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Selling on yaks.app</h2>
      <p class='Prose_Text'>
        Your apps can take payments. If yours does,{' '}
        <b>you are the merchant</b>, not us. You connect your own Stripe
        account, the charge is made on that account, your name appears on the
        customer's statement, and the money settles into your balance on your
        own payout schedule. You pay Stripe's processing fee out of it, and we
        take a fee per sale. The amount is on the{' '}
        <a class='Prose_Link' href='/pricing'>pricing page</a>.
      </p>
      <p class='Prose_Text'>
        Payment processing services for sellers on yaks.app are provided by
        Stripe and are subject to the{' '}
        <a
          class='Prose_Link'
          href='https://stripe.com/connect-account/legal/full'
        >
          Stripe Connected Account Agreement
        </a>, which includes the{' '}
        <a class='Prose_Link' href='https://stripe.com/legal/ssa'>
          Stripe Terms of Service
        </a>{' '}
        (collectively, the "Stripe Services Agreement"). By agreeing to these
        terms or continuing to sell on yaks.app, you agree to be bound by the
        Stripe Services Agreement, as the same might be modified by Stripe from
        time to time. As a condition of yaks.app enabling payment processing
        services through Stripe, you agree to provide yaks.app accurate and
        complete information about you and your business, and you authorize
        yaks.app to share it and transaction information related to your use of
        the payment processing services provided by Stripe.
      </p>
      <p class='Prose_Text'>
        As the merchant, you are also responsible for describing what you sell
        accurately and delivering it, answering your customers, issuing refunds,
        responding to chargebacks, and paying any tax you owe. You do this in
        your own Stripe dashboard, which holds the money and the records. We
        never see your bank details or your identity documents. Stripe collects
        and keeps those directly. We keep the order (what was bought, what it
        cost, and the buyer's email address) in your app's store.
      </p>
      <p class='Prose_Text'>
        <b>What you may not sell.</b> Our{' '}
        <a class='Prose_Link' href='/acceptable-use'>acceptable use policy</a>
        {' '}
        applies to sales, and so does Stripe's list of{' '}
        <a
          class='Prose_Link'
          href='https://stripe.com/legal/restricted-businesses'
        >
          prohibited and restricted businesses
        </a>, which your Stripe account is held to. In summary, and not as a
        complete list: nothing illegal where you or your buyer are located; no
        adult services or pornography; no gambling or games of chance played for
        money; no weapons, explosives or dangerous materials; no drugs, drug
        paraphernalia, marijuana, or unapproved pharmaceuticals or supplements
        sold on health claims; no counterfeits or anything else that infringes
        someone's copyright or trademark; no debt collection, debt settlement,
        credit repair or payday-style lending; no money transmission,
        cryptocurrency exchange, or buying or selling of financial instruments;
        no multi-level marketing, pyramid schemes, get-rich-quick offers, or
        sales based on promises you cannot keep; and nothing intended to deceive
        or exploit the person paying.
      </p>
      <p class='Prose_Text'>
        These restrictions apply because a shop on yaks.app sells under our name
        as well as yours. We may stop a space from selling, and Stripe may close
        a connected account, each independently of the other. If we stop your
        space from selling, we will tell you why where we can.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Buying on yaks.app</h2>
      <p class='Prose_Text'>
        If you buy something from a yaks app, your contract is with the seller
        and not with us. We host the seller's shop and pass the payment along.
        The seller takes your payment and owes you what you bought, and refunds
        and complaints go to the seller. The seller's email address is on your
        receipt, and replying to the receipt reaches them. If that doesn't
        resolve the problem, email{' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>
        {' '}
        and we will do what we can, but we are not the seller and cannot fulfill
        the sale on the seller's behalf.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Text messages</h2>
      <p class='Prose_Text'>
        If you sign up or sign in with your mobile number, yaks.app texts you
        the sign-in codes you ask for. If you text yaks.app to sign up, or ask
        for texts on your space's Operator page, it also texts you your
        Operator's answers when you text it, and its alerts about your space and
        the apps you build, such as when it finishes a change, needs an answer
        from you, or something needs your attention. Message frequency varies.
        Message and data rates may apply.
      </p>
      <p class='Prose_Text'>
        Reply STOP to stop texts, or HELP for help. You can also stop them on
        the operator page, or email{' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>.
        Carriers aren't liable for delayed or undelivered messages. You don't
        have to agree to texts to use yaks.app. How we handle your number is in
        the <a class='Prose_Link' href='/privacy'>privacy policy</a>.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Termination</h2>
      <p class='Prose_Text'>
        You can stop using yaks.app at any time. Deleting an app deletes its
        data. To close your account entirely, email{' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>
        {' '}
        and we'll remove what we hold, as described in the{' '}
        <a class='Prose_Link' href='/privacy'>privacy policy</a>.
      </p>
      <p class='Prose_Text'>
        We may suspend or close an account that breaks the acceptable use
        policy, or when the law requires us to. Where we can, we'll tell you why
        and give you a chance to retrieve your content.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Disclaimers and limitation of liability</h2>
      <p class='Prose_Text'>
        yaks.app is provided as is. We don't promise it will always be up,
        always be fast, or never lose anything, and we don't promise that an app
        your assistant writes will do what you hoped. Keep your own copy of
        anything you can't afford to lose.
      </p>
      <p class='Prose_Text'>
        To the extent the law allows, we aren't liable for lost data, lost
        profit, or anything we couldn't reasonably have foreseen, and our total
        liability is limited to what you've paid us in the past twelve months.
        Nothing in these terms limits rights that your local law does not allow
        us to exclude.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Changes to these terms</h2>
      <p class='Prose_Text'>
        When we change these terms, we'll update this page and the date at the
        top. If a change matters to you, we'll also send you an email. If you
        keep using the site after a change, you accept the new terms.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Governing law</h2>
      <p class='Prose_Text'>
        These terms are governed by the law of the State of Michigan in the
        United States, and any dispute belongs in the state or federal courts in
        Michigan, unless the law where you live requires otherwise, in which
        case that law applies.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Contact</h2>
      <p class='Prose_Text'>
        You can reach us at{' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>.
        We read every message.
      </p>
    </section>
  </Page>
)
