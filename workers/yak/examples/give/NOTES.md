# Give

## The fund

The page gives to the first `fund` row. Change it in place by its alias:

    graph_apply { app: 'give', entities: [
      { entity: { eid: '$fund' },
        alias: { name: 'fund:general' },
        doc: { title: 'The Roof Fund',
               body: 'One line about what the gifts do.' },
        fund: { holder: 'The legal name on the receipt',
                amounts_cents: '2500, 5000, 10000, 25000' } } ] }

- `doc.title` is the first thing a donor reads.
- `holder` is the legal name the receipt says received the gift. Unset, the
  receipt uses the fund's title.
- `amounts_cents` is whole cents in USD, comma separated: 2500 is $25. The page
  preselects the second.
- `statement` replaces the receipt's "No goods or services were provided in
  exchange for this gift." Leave it unset unless something was given.

## What not to change

- Never post a total. The page posts the gift (`cents`) and `cover`; the
  platform adds the fee and charges that.
- Never write `gift` rows. The platform writes one for each payment Stripe
  reports, and sends the receipt.
