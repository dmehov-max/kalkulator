-- Заключване на таблица calculations (08.11.2026).
-- Преди: една политика "anon full access" (ALL, true) — всеки с публичния anon ключ
-- (стои в кода на страницата) можеше да чете, сменя и трие всички калкулации с имена
-- и телефони на клиенти.
-- След: SELECT/INSERT/UPDATE/DELETE само за authenticated (екипа, @korekt-bg.com).
-- anon няма никакъв директен достъп; гласовият асистент пише през save_voice_calc().

drop policy if exists "anon full access" on public.calculations;

alter table public.calculations enable row level security;

revoke all on table public.calculations from anon;
revoke truncate, references, trigger on table public.calculations from authenticated;
grant select, insert, update, delete on table public.calculations to authenticated;

create policy "calc_select_authenticated" on public.calculations
  for select to authenticated using (true);
create policy "calc_insert_authenticated" on public.calculations
  for insert to authenticated with check (true);
create policy "calc_update_authenticated" on public.calculations
  for update to authenticated using (true) with check (true);
create policy "calc_delete_authenticated" on public.calculations
  for delete to authenticated using (true);

-- Запис от гласовия асистент (anon ключ). Пипа само редове с id "calc:voice-...",
-- не връща нищо друго освен номера на калкулацията.
create or replace function public.save_voice_calc(p_id text, p_status text, p_data jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_num bigint;
begin
  if p_id is null or p_id !~ '^calc:voice-[A-Za-z0-9_.:-]{1,100}$' then
    raise exception 'save_voice_calc: позволени са само id "calc:voice-..."';
  end if;
  if p_data is null or octet_length(p_data::text) > 500000 then
    raise exception 'save_voice_calc: липсват или са твърде много данни';
  end if;
  insert into public.calculations (id, status, data)
  values (p_id, coalesce(nullif(p_status, ''), 'калкулация'), p_data)
  on conflict (id) do update set status = excluded.status, data = excluded.data
  returning calc_number into v_num;
  return v_num;
end;
$$;

revoke all on function public.save_voice_calc(text, text, jsonb) from public;
grant execute on function public.save_voice_calc(text, text, jsonb) to anon, authenticated;
