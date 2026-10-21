-- Cashflow 初始结构（Neon / Lakebase Postgres）
--
-- 与旧版 Supabase 迁移的差异：
--   * 去掉 RLS 与 auth.uid()：数据库凭据只存在于 Next 服务端，鉴权在服务端完成
--   * user_id 外键指向 Neon Auth（Managed Better Auth）的 neon_auth."user"
--   * updated_at / created_at 一律由触发器写入服务端时间，避免设备时钟偏差影响 LWW 冲突判断

create table public.accounts (
  id               uuid primary key,
  user_id          uuid not null references neon_auth."user" (id) on delete cascade,
  name             text not null,
  type             text not null check (type in ('cash', 'bank', 'credit', 'ewallet', 'other')),
  currency         text not null default 'CNY' check (currency = 'CNY'),
  opening_balance  bigint not null default 0,
  archived         boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create table public.categories (
  id          uuid primary key,
  user_id     uuid not null references neon_auth."user" (id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('income', 'expense')),
  parent_id   uuid references public.categories (id),
  icon        text not null default '',
  color       text not null default '',
  archived    boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.import_batches (
  id          uuid primary key,
  user_id     uuid not null references neon_auth."user" (id) on delete cascade,
  source      text not null check (source in ('text', 'csv')),
  total       integer not null default 0,
  imported    integer not null default 0,
  skipped     integer not null default 0,
  failed      integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.transactions (
  id               uuid primary key,
  user_id          uuid not null references neon_auth."user" (id) on delete cascade,
  kind             text not null check (kind in ('income', 'expense', 'transfer')),
  amount           bigint not null check (amount > 0),
  occurred_on      date not null,
  occurred_time    time,
  category_id      uuid references public.categories (id),
  account_id       uuid not null references public.accounts (id),
  to_account_id    uuid references public.accounts (id),
  payee            text,
  note             text,
  tags             text[] not null default '{}',
  import_batch_id  uuid references public.import_batches (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint transfer_has_target check ((kind = 'transfer') = (to_account_id is not null)),
  constraint transfer_differs check (kind <> 'transfer' or to_account_id <> account_id)
);

create table public.budgets (
  id           uuid primary key,
  user_id      uuid not null references neon_auth."user" (id) on delete cascade,
  category_id  uuid references public.categories (id),
  amount       bigint not null check (amount > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- 账号设置：随账号同步（默认账户、账期起始日）
create table public.user_settings (
  user_id             uuid primary key references neon_auth."user" (id) on delete cascade,
  default_account_id  uuid references public.accounts (id) on delete set null,
  period_start_day    integer not null default 1 check (period_start_day between 1 and 28),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 服务端时间：所有同步实体的 updated_at 由数据库决定
create or replace function public.stamp_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at = now();
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- 删除优先：已软删除的记录不会被其他设备的更新复活
create or replace function public.keep_deleted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    new.deleted_at = old.deleted_at;
  end if;
  return new;
end;
$$;

create trigger accounts_stamp before insert or update on public.accounts
  for each row execute function public.stamp_timestamps();
create trigger accounts_keep_deleted before update on public.accounts
  for each row execute function public.keep_deleted();

create trigger categories_stamp before insert or update on public.categories
  for each row execute function public.stamp_timestamps();
create trigger categories_keep_deleted before update on public.categories
  for each row execute function public.keep_deleted();

create trigger import_batches_stamp before insert or update on public.import_batches
  for each row execute function public.stamp_timestamps();
create trigger import_batches_keep_deleted before update on public.import_batches
  for each row execute function public.keep_deleted();

create trigger transactions_stamp before insert or update on public.transactions
  for each row execute function public.stamp_timestamps();
create trigger transactions_keep_deleted before update on public.transactions
  for each row execute function public.keep_deleted();

create trigger budgets_stamp before insert or update on public.budgets
  for each row execute function public.stamp_timestamps();
create trigger budgets_keep_deleted before update on public.budgets
  for each row execute function public.keep_deleted();

create trigger user_settings_stamp before insert or update on public.user_settings
  for each row execute function public.stamp_timestamps();

-- 增量拉取游标：每张同步表都按 (user_id, updated_at) 扫描
create index accounts_user_updated_idx on public.accounts (user_id, updated_at);
create index categories_user_updated_idx on public.categories (user_id, updated_at);
create index import_batches_user_updated_idx on public.import_batches (user_id, updated_at);
create index transactions_user_updated_idx on public.transactions (user_id, updated_at);
create index transactions_user_occurred_idx on public.transactions (user_id, occurred_on);
create index budgets_user_updated_idx on public.budgets (user_id, updated_at);
create index user_settings_user_updated_idx on public.user_settings (user_id, updated_at);
