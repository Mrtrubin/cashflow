-- 时间戳改用 clock_timestamp()：
-- now() 在同一个事务里返回相同值，同一批同步写入的多行会拿到完全相同的 updated_at，
-- 增量拉取按 updated_at 分页时就可能卡在同一个时间点。clock_timestamp() 在事务内继续前进。

create or replace function public.stamp_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at = clock_timestamp();
  end if;
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
