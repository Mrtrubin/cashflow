-- 短信导入也记入导入批次，历史列表可以区分「文本 / CSV / 短信」。
-- 约束名是 PostgreSQL 自动生成的 import_batches_source_check。

alter table public.import_batches
  drop constraint if exists import_batches_source_check;

alter table public.import_batches
  add constraint import_batches_source_check
  check (source in ('text', 'csv', 'sms'));
