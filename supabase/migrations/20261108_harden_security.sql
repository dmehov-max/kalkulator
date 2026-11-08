-- Затягане на сигурността (08.11.2026). Пълно описание: SECURITY.md.
--
-- Дупки преди тази миграция:
--  1. Регистрация с ВСЕКИ имейл (gmail и т.н.): външен човек потвърждава от своята поща,
--     влиза и вижда всички калкулации с имена и телефони на клиенти.
--  2. calc_params: "anon full access" — всеки с публичния ключ сменя цените, вижда
--     себестойност/марж и Google Maps ключа, и може да подмени supabaseUrl в параметрите,
--     така че входът (паролите) на колегите да отиде към чужд сървър.
--  3. catalog_items: "anon full access" — всеки добавя/сменя/трие вещи от каталога.
--  4. save_voice_calc: без ограничение — всеки може да залее базата с фалшиви записи
--     и да презапише стар гласов запис.
--
-- След нея:
--  • акаунт може да се създаде само с @korekt-bg.com (проверка в самата база, trigger);
--  • „служител“ = потвърден @korekt-bg.com акаунт, който не е спрян (проверява се при
--    всяка заявка срещу auth.users — спрян акаунт губи достъп веднага, не след час);
--  • „администратор“ = служител с app_metadata.role = 'admin' или bootstrap имейла;
--  • anon (публичният ключ) няма директен достъп до нито една таблица.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- служител: потвърден, неспрян @korekt-bg.com акаунт (чете auth.users, затова security definer)
create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.email ~* '^[^@[:space:]]+@korekt-bg\.com$'
       and u.email_confirmed_at is not null
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until <= now())
    from auth.users u
    where u.id = auth.uid()
  ), false);
$$;

-- администратор: служител + роля admin в app_metadata (пише се само със service_role,
-- виж supabase/functions/admin-users) или bootstrap имейлът (пази в синхрон с
-- PARAMS_EDITOR_EMAIL в korekt-calculator.jsx и BOOTSTRAP_ADMIN_EMAIL в admin-users)
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_staff() and coalesce((
    select lower(u.email) = 'd.mehov@korekt-bg.com'
        or u.raw_app_meta_data ->> 'role' = 'admin'
    from auth.users u
    where u.id = auth.uid()
  ), false);
$$;

revoke all on function private.is_staff() from public, anon;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.is_admin() to authenticated;

-- --- Регистрация само със служебен имейл (и смяна на имейл към чужд домейн) ---
create or replace function private.enforce_staff_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or new.email !~* '^[^@[:space:]]+@korekt-bg\.com$' then
    raise exception 'Регистрацията е разрешена само със служебен имейл @korekt-bg.com'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_staff_email() from public, anon, authenticated;

drop trigger if exists enforce_staff_email_insert on auth.users;
create trigger enforce_staff_email_insert
  before insert on auth.users
  for each row execute function private.enforce_staff_email();

drop trigger if exists enforce_staff_email_update on auth.users;
create trigger enforce_staff_email_update
  before update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function private.enforce_staff_email();

-- --- calc_params: чете екипът, пише само администратор, никой не трие ---
drop policy if exists "anon full access" on public.calc_params;
revoke all on table public.calc_params from anon, authenticated;
grant select, insert, update on table public.calc_params to authenticated;
create policy "params_select_staff" on public.calc_params
  for select to authenticated using ((select private.is_staff()));
create policy "params_insert_admin" on public.calc_params
  for insert to authenticated with check ((select private.is_admin()));
create policy "params_update_admin" on public.calc_params
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
-- адресът и ключът на базата вече не се пазят в параметрите (идват само от кода)
update public.calc_params set value = value - 'supabaseUrl' - 'supabaseKey' where value ? 'supabaseUrl' or value ? 'supabaseKey';

-- --- catalog_items: екипът чете и добавя, трие само администратор ---
drop policy if exists "anon full access" on public.catalog_items;
revoke all on table public.catalog_items from anon, authenticated;
grant select, insert, update, delete on table public.catalog_items to authenticated;
create policy "catalog_select_staff" on public.catalog_items
  for select to authenticated using ((select private.is_staff()));
create policy "catalog_insert_staff" on public.catalog_items
  for insert to authenticated with check ((select private.is_staff()));
create policy "catalog_update_staff" on public.catalog_items
  for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "catalog_delete_admin" on public.catalog_items
  for delete to authenticated using ((select private.is_admin()));

-- --- calculations: екипът чете/пише, трие само администратор ---
drop policy if exists "calc_select_authenticated" on public.calculations;
drop policy if exists "calc_insert_authenticated" on public.calculations;
drop policy if exists "calc_update_authenticated" on public.calculations;
drop policy if exists "calc_delete_authenticated" on public.calculations;
revoke all on table public.calculations from anon;
create policy "calc_select_staff" on public.calculations
  for select to authenticated using ((select private.is_staff()));
create policy "calc_insert_staff" on public.calculations
  for insert to authenticated with check ((select private.is_staff()));
create policy "calc_update_staff" on public.calculations
  for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy "calc_delete_admin" on public.calculations
  for delete to authenticated using ((select private.is_admin()));

-- --- offers: само екипът; anon няма никакви права ---
drop policy if exists "offers_select_authenticated" on public.offers;
drop policy if exists "offers_insert_authenticated" on public.offers;
drop policy if exists "offers_update_authenticated" on public.offers;
revoke all on table public.offers from anon, authenticated;
grant select, insert, update on table public.offers to authenticated;
create policy "offers_select_staff" on public.offers
  for select to authenticated using ((select private.is_staff()));
create policy "offers_insert_staff" on public.offers
  for insert to authenticated with check ((select private.is_staff()));
create policy "offers_update_staff" on public.offers
  for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));

-- --- Гласовият асистент (anon ключ, сървърно на компютъра в офиса) ---
-- Пише само нови/скорошни "calc:voice-..." записи, с ограничение на броя и размера,
-- и не може да презапише чужд (не-гласов) или стар гласов запис.
create or replace function public.save_voice_calc(p_id text, p_status text, p_data jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_num bigint;
  v_recent int;
begin
  if p_id is null or p_id !~ '^calc:voice-[A-Za-z0-9_.:-]{1,100}$' then
    raise exception 'save_voice_calc: позволени са само id "calc:voice-..."';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 200000 then
    raise exception 'save_voice_calc: липсват или са твърде много данни';
  end if;
  if p_status is not null and p_status not in ('калкулация', 'заявка') then
    raise exception 'save_voice_calc: непозволен статус';
  end if;
  -- до 60 нови гласови записа на час за целия проект (срещу заливане)
  select count(*) into v_recent from public.calculations
   where id like 'calc:voice-%' and created_at > now() - interval '1 hour';
  if v_recent >= 60 and not exists (select 1 from public.calculations where id = p_id) then
    raise exception 'save_voice_calc: твърде много записи за последния час';
  end if;
  insert into public.calculations (id, status, data)
  values (p_id, coalesce(nullif(p_status, ''), 'калкулация'), p_data)
  on conflict (id) do update set status = excluded.status, data = excluded.data
    where public.calculations.created_at > now() - interval '3 hours'
  returning calc_number into v_num;
  if v_num is null then
    raise exception 'save_voice_calc: записът е заключен (по-стар от 3 часа)';
  end if;
  return v_num;
end;
$$;
revoke all on function public.save_voice_calc(text, text, jsonb) from public;
grant execute on function public.save_voice_calc(text, text, jsonb) to anon, authenticated;

-- Цени за гласовия асистент: само клиентските ставки — без себестойност, марж,
-- ключове и адреси. (Асистентът казва цена на клиента, тези ставки не са тайна.)
create or replace function public.voice_pricing()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select value
    - 'supabaseUrl' - 'supabaseKey' - 'mapsApiKey'
    - 'workerCostDefault' - 'workerCostByCity' - 'truckCostPerHour' - 'truckCostPerKm'
  from public.calc_params where id = 'pricing';
$$;
revoke all on function public.voice_pricing() from public;
grant execute on function public.voice_pricing() to anon, authenticated;
