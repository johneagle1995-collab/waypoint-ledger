-- Run this once in your Supabase project's SQL Editor.

create table if not exists waypoint_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"members":[],"trips":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table waypoint_data enable row level security;

create policy "Users can view own data"
  on waypoint_data for select
  using (auth.uid() = user_id);

create policy "Users can insert own data"
  on waypoint_data for insert
  with check (auth.uid() = user_id);

create policy "Users can update own data"
  on waypoint_data for update
  using (auth.uid() = user_id);

-- Enables live sync: other signed-in devices get pushed the new row
-- automatically instead of only seeing changes on next reload.
-- (Also flip "Enable Realtime" on this table in Database > Replication if
-- this statement errors because it's already been added via the UI.)
alter publication supabase_realtime add table waypoint_data;

-- Lets a signed-in user permanently delete their own account and all of
-- their data in one action — required by Apple's App Store guidelines
-- since this app supports account creation. Runs with elevated privileges
-- (security definer) but is locked to auth.uid(), so it can only ever
-- delete the caller's own row and their own auth account.
create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from waypoint_data where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_user_account() to authenticated;
