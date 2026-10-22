---
name: business-model
description: >
  How yaks.app thinks about who it is for, what it charges and how it grows:
  people with a problem worth paying to solve, the space as the unit of data
  and billing, free generous in what spreads and bounded in what piles up, and
  pricing as a signal. Use it whenever you touch pricing, plans, allowances or
  limits (the free plan, the Plus plan, meter.ts ceilings, upgrade prompts,
  refusal text), the marketing site (workers/yak/public/index.html,
  pricing.html, help.html), sign-up or onboarding copy, the billing page, the
  gallery or a home-page example, or when you decide who a feature is for,
  even if the request only says "make this paid", "add a limit", "tweak the
  home page", "write the copy", "should this be free?" or "who would use
  this?". How the platform meters and bills is `yaks-app`, how prose reads is
  `writing-documentation`, and a proposal for the owner is `design-docs`.
---

# The business behind yaks.app

yaks.app is a small product made by a few craftsmen, and few people use it yet.
This is when a business takes its shape: not later in a growth push, but now,
in what the free plan gives away, what the first paid feature is, and the first
sentence a stranger reads. Every price, limit, upgrade prompt and example app
says who we're for, so make each one on purpose.

Jeff set these principles on 2026-10-22. His words are in M-131884; read them
whole before you make a call here. What follows is the picture they make, with
his phrases quoted, plus the principles agents added, each marked.

## Problems first, then the right people

Good products solve problems: "we don't build a product and then find someone
to buy it. we find problems and then build a solution." So a feature, a page or
a plan starts from a person. Who is it for, what problem do they have, and
where in their day does it show up? If you can't name the person, you're
building a solution in search of a problem, and polish won't rescue it.

Who that person is matters as much as what their problem is. Product-market fit
means finding the *right* users, because whoever we build for is who we turn
into. Someone unwilling to pay "isn't a *customer*". Building for them pulls the
product away from people with a problem worth paying for, and they recommend it
to people like themselves. So we harness selection bias. One person who came
looking is worth more than many drawn in by a discount, which "*actively*
select[s] for customers who don't really want your product". We don't grow by
discounting.

Start from a literal person. Jeff's first personas are people he knows who use
yaks.app (M-131884). One gets value and would pay, yet pays nothing because
she has never hit a limit. The other is a developer with more ideas than he
builds. Each is "just *one* persona among multiple". D-131886 models several,
says which one is the wedge, and marks the personas that are guesses. A
persona that no one on yaks.app resembles stays a guess until someone who came
on their own fits it.

These principles aren't only for us. Jeff wants an operator on yaks.app that
"takes the ideas, a smart set of principles like we're building now and it
just comes up with something". When that operator builds someone's business,
it brings this way of thinking to their idea too.

## Sharing is the marketing; value is what gets paid for

Word of mouth is the goal, and "bottom-up growth is the only way to grow a
company. this cannot be added later". It lives in the plan, the limits and the
product itself. Our free users are "our marketing team": everyone who is invited
into a space, opens a shared app on their phone or sees "Made with yaks.app" is
a chance for the next person to start. So nothing that spreads the product sits
behind a payment. Think Slack: "start free, invite many others, pay for
increased power/history/security."

Yet people who get value should have a reason to pay *something*. What each
limit sits on is what holds those two pulls together:

- **Free is generous with people and bounded in what piles up.** *(An agent's
  addition.)* Members, invitations, visitors, publishing, installing someone's
  app and exporting are unlimited on every plan, because they're how the next
  person arrives. Apps, storage, history, model spend, a custom domain and
  taking payments grow as a group comes to rely on a space, and that reliance
  is what we charge for.
- **The space is the unit.** Jeff: "the space is where all the data lives and
  thus we account for the billing there also." A space is one address, its
  apps, their data and the people in it. It's the space that gets upgraded,
  not a person, and what one space uses never counts against another. Today
  meter.ts still pools emails, builds and the model budget across each owner's
  spaces. T-131890 moves all of it onto the space.
- **A limit lands on whoever can act on it.** *(An agent's addition.)* When a
  space runs out of something, its owner hears about it, in a sentence that
  names the space, the limit and the one thing to do. A guest who finds an app
  paused is a recommendation we won't get.
- **Upgrades come by pull, not by limits alone.** Someone getting value may
  never hit a limit, and "sometimes you really do just have to wait a bit for
  users to get to the point where they upgrade." So the Plus plan carries what
  a maker wants next, and the product helps them get there. That's the
  custom domain that's their next step, or the features already on their
  list, built sooner. "i'm not talking a salesman."

"a business is a flywheel. everything must contribute to the cycle and not
detract." Here's ours. Someone asks their assistant for an app, and it's live at
their address within minutes. They invite the people it's for. Some of those
people have problems of their own and start a space. The spaces people rely on
outgrow free and pay. The money makes the product better, and the first minute
gets more magical. Before you ship a limit, a price or a line of copy, find
where it sits in that cycle. If it slows any turn, it's wrong, whatever revenue
it promises.

At its best, the cycle runs through a maker. She makes a tool for herself,
shares it with her team, publishes it, and then sells it, and the people who
buy it become yaks.app's users. In Jeff's words: "if we could organically grow
her little tools for herself into a business where she makes money from
sharing them with others, that'd be amazing for her and us." Each step should
be a small, obvious move from the one before. What yaks.app gives at each
step, and what's still missing, is in D-131886.

## Blow their minds

"Wow, this product is really good! Check this out." That sentence is the whole
growth strategy, and only a 9+/10 product gets it said: intuitive, slick, fast,
good. Part of that is finding people who are yearning for what we make. The
rest is making it well. We're craftsmen, and we want customers who notice.

Copy is part of the product, and Jeff finds that "sometimes the prose is so
casual it's just not clear." A pricing page that needs a paragraph on how
allowances pool across five spaces has a confused product underneath it.

- **One unit, one sentence.** *(An agent's addition.)* If a stranger can't say
  in one sentence what they'd pay for and what it buys, the plan is wrong,
  however fair it is. "Each space is free or on the Plus plan" passes. "Free
  allowances are yours, not each space's" doesn't.

Write for the stranger:

- Define "space" before you use it.
- Say "the Plus plan" (M-37846).
- Use the one-liner as it stands (M-37845).
- Show real apps from the yourname space (M-37804).
- Let prompts start from the person's own situation (M-37856).

How a sentence reads in general is `writing-documentation`.

## Pricing is a signal

A price tells each visitor whether the product is for them before they've read
a word: "no corporate CTO is going to find $9/mo product and think it's for
them. they are expecting 6-7 figures." So a price is set by who it should draw
in. A flat price per space, with every member free, says *for a person, their
team and the things they run*. Per-seat pricing, "Contact sales" and an enterprise tier say
something else. They wait until a customer we want asks for something only
they would buy.

The people we want already pay for an assistant: "if they aren't paying for
claude, they probably just don't need our product."

## Trust, and where to look

- **Leaving is easy, and nothing is held hostage.** *(An agent's addition, from
  M-4522 and M-59093.)* Export is free on every plan. A lapsed plan never
  deletes anything, and a limit stops growth, never anyone's data. People
  recommend what they trust. A trap that keeps one customer loses the ten that
  customer would have told.
- **The people who came on their own are the evidence.** *(An agent's
  addition.)* Look at what they built and whom they invited, and read what
  they sent through the connector's `feedback` tool, before you invent a
  persona. Count the cycle: invitations accepted, copies installed, and spaces
  upgraded along with what tipped each one. Sign-ups alone don't tell you
  much. Their words are signal, the way Jeff's are.
- **Be found where the problem shows up.** *(An agent's addition.)* People
  realize they need an app while they're talking to their assistant, so
  that's where yaks.app should be found: the assistants' connector
  directories, and an app someone shared with them. People who arrive that way
  chose us, and that's the selection bias we want.

## Where it lives

- **The numbers.** They live in workers/yak/meter.ts (`FREE`, `PLUS`,
  `LETTERS`, `BUDGET`, `PRICE`, `SPACES`), and site_test.ts holds the pages to
  them. The plan is `plan{tier, customer, subscription, status, until, ending,
  at}` on the space (packages/platform/vocab.json). Checkout, the billing
  portal and the Stripe webhook are in workers/yak/billing.ts. How metering
  and refusals work is `yaks-app`.
- **The site.** The home page is workers/yak/public/index.html, which carries
  a JSON-LD copy of the plans. Next to it are pricing.html, help.html and the
  Limits section of docs/technical.md. The connector's skills in
  plugins/yaks.app mirror the guide. The plan card a signed-in person sees is
  /manage/billing, in workers/yak/pages.ts.
- **The model in full.** D-131886 covers the personas, the growth cycle, free
  and Plus, and the site's information architecture. The calls that are
  Jeff's are put to him as decisions there.

When this skill is wrong or missing something, fix it in the same change.
