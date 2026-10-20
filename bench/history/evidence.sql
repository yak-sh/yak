-- How far the journal agrees with the created/updated stamps, per entity.
.mode list
create temp table first as
  select c.entity, c.at, c.by, c.via,
    (select min(j.tx) from journal_change j where j.entity = c.entity) tx
  from created c;
select 'created rows', count(*) from first;
select 'created, no journal record', count(*) from first where tx is null;
select 'created before journal began', count(*) from first
  where at < (select min(ts) from journal_tx);
select 'created after journal began, no record', count(*) from first
  where tx is null and at >= (select min(ts) from journal_tx);
create temp table cmp as
  select f.*, t.ts, t.actor, t.via tvia from first f join journal_tx t on t.id = f.tx;
select 'with record', count(*) from cmp;
select 'at equal', count(*) from cmp where at = ts;
select 'at within 1s', count(*) from cmp
  where abs(julianday(at) - julianday(ts)) * 86400 <= 1;
select 'first record later than created by >1s', count(*) from cmp
  where (julianday(ts) - julianday(at)) * 86400 > 1;
select 'by equal', count(*) from cmp where by is actor;
select 'via equal', count(*) from cmp where via is tvia;
select 'by null in stamp', count(*) from cmp where by is null;
select 'actor null in journal', count(*) from cmp where actor is null;
-- updated: the latest journal transaction for the entity vs the stamp.
create temp table last as
  select u.entity, u.at, u.by, u.via,
    (select max(j.tx) from journal_change j where j.entity = u.entity) tx
  from updated u;
select 'updated rows', count(*) from last;
select 'updated, no journal record', count(*) from last where tx is null;
create temp table ucmp as
  select l.*, t.ts, t.actor, t.via tvia from last l join journal_tx t on t.id = l.tx;
select 'updated at within 1s of last record', count(*) from ucmp
  where abs(julianday(at) - julianday(ts)) * 86400 <= 1;
select 'updated later than last record by >1s', count(*) from ucmp
  where (julianday(at) - julianday(ts)) * 86400 > 1;
select 'updated by equal', count(*) from ucmp where by is actor;
-- changes per transaction, fields per change
select 'changes/tx', round(1.0 * (select count(*) from journal_change) / (select count(*) from journal_tx), 2);
select 'fields/change', round(1.0 * (select count(*) from journal_field) / (select count(*) from journal_change), 2);
select 'journal span', min(ts), max(ts) from journal_tx;
