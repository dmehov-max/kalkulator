-- Защита отвън, втори кръг (решение на Додо, 24.11.2026):
-- 1) записът от гласовия асистент и търсенето на поръчка по ПИН се приемат само с таен ключ на асистента
--    (заглавие x-agent-key; в базата стои само неговият sha256 — private.agent_keys, попълва се ръчно);
-- 2) формата на сайта: до 20 нови запитвания на час от един IP адрес (пази се само хеш на адреса, 1 ден);
-- 3) журналите (offer_events, calc_lookup_attempts) се четат само от служители.

create table if not exists private.agent_keys (
  hash text primary key,
  note text,
  created_at timestamptz not null default now()
);
revoke all on private.agent_keys from public, anon, authenticated;

create or replace function private.is_agent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.agent_keys k
     where k.hash = encode(sha256(convert_to(
       coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-agent-key', ''), 'UTF8')), 'hex'));
$$;
revoke all on function private.is_agent() from public, anon, authenticated;

-- 1а) запис от асистента
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
  if not private.is_agent() then
    raise exception 'save_voice_calc: няма достъп';
  end if;
  if p_id is null or p_id !~ '^calc:voice-[A-Za-z0-9_.:-]{1,100}$' then
    raise exception 'save_voice_calc: позволени са само id "calc:voice-..."';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 200000 then
    raise exception 'save_voice_calc: липсват или са твърде много данни';
  end if;
  if p_status is not null and p_status not in ('калкулация', 'заявка') then
    raise exception 'save_voice_calc: непозволен статус';
  end if;
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

-- 1б) търсене и бележка по номер: проверката на ключа е в общата вътрешна функция
create or replace function public._calc_client_check(p_number bigint, p_pin text, p_from text, p_to text)
returns public.calculations
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.calculations%rowtype;
  v_a text; v_b text; v_from text; v_to text;
  v_ok boolean := false;
  norm constant text := '[^[:alnum:]а-яА-Я]+';
begin
  if not private.is_agent() then
    raise exception 'lookup: няма достъп';
  end if;
  -- лимити: до 3 грешни опита за един номер на час; до 40 грешни общо на час
  if (select count(*) from public.calc_lookup_attempts where not ok and calc_number = p_number and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.calc_lookup_attempts where not ok and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'lookup: твърде много опити';
  end if;
  select * into c from public.calculations where calc_number = p_number and created_at > now() - interval '60 days';
  if found then
    if coalesce(c.data->>'pin', '') ~ '^[0-9]{4}$' and regexp_replace(coalesce(p_pin, ''), '[^0-9]', '', 'g') = c.data->>'pin' then
      v_ok := true;
    else
      v_a := lower(regexp_replace(coalesce(nullif(c.data->'formState'->>'pickupHood', ''), c.data->'formState'->>'pickupCity', ''), norm, '', 'g'));
      v_b := lower(regexp_replace(coalesce(nullif(c.data->'formState'->>'dropoffHood', ''), c.data->'formState'->>'dropoffCity', ''), norm, '', 'g'));
      v_from := lower(regexp_replace(coalesce(p_from, ''), norm, '', 'g'));
      v_to := lower(regexp_replace(coalesce(p_to, ''), norm, '', 'g'));
      if length(v_a) >= 3 and length(v_b) >= 3 and v_a <> v_b
         and ((v_from = v_a and v_to = v_b) or (v_from = v_b and v_to = v_a)) then
        v_ok := true;
      end if;
    end if;
  end if;
  insert into public.calc_lookup_attempts (calc_number, ok) values (p_number, v_ok);
  if not v_ok then
    return null;
  end if;
  return c;
end;
$$;
revoke all on function public._calc_client_check(bigint, text, text, text) from public, anon, authenticated;

-- 2) формата на сайта: лимит по IP адрес
create table if not exists private.site_hits (
  ip_hash text not null,
  calc_id text not null,
  created_at timestamptz not null default now(),
  primary key (ip_hash, calc_id)
);
revoke all on private.site_hits from public, anon, authenticated;
create index if not exists site_hits_recent on private.site_hits (created_at);

create or replace function public.save_site_inquiry(p_id text, p_data jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_num bigint;
  v_recent int;
  v_status text;
  v_new boolean;
  h json := nullif(current_setting('request.headers', true), '')::json;
  v_ip text := coalesce(nullif(h->>'cf-connecting-ip', ''), nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''));
  v_iph text := md5('korekt-site:' || coalesce(v_ip, ''));
begin
  if p_id is null or p_id !~ '^calc:site-[A-Za-z0-9_.:-]{1,100}$' then
    raise exception 'save_site_inquiry: позволени са само id "calc:site-..."';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 200000 then
    raise exception 'save_site_inquiry: липсват или са твърде много данни';
  end if;
  if coalesce(p_data->>'source', '') <> 'сайт' then
    raise exception 'save_site_inquiry: липсва източник';
  end if;
  v_status := case when coalesce(p_data->'contact'->>'phone', '') <> '' then 'заявка' else 'калкулация' end;
  v_new := not exists (select 1 from public.calculations where id = p_id);
  if v_new then
    -- до 150 нови запитвания от сайта на час за целия проект (срещу заливане)
    select count(*) into v_recent from public.calculations
     where id like 'calc:site-%' and created_at > now() - interval '1 hour';
    if v_recent >= 150 then
      raise exception 'save_site_inquiry: твърде много запитвания за последния час';
    end if;
    -- и до 20 на час от един адрес: един бот не изяжда общия лимит на истинските клиенти
    -- (ако адресът липсва в заявката, тази проверка се пропуска — остава общият лимит)
    if v_ip is not null and (select count(*) from private.site_hits
         where ip_hash = v_iph and created_at > now() - interval '1 hour') >= 20 then
      raise exception 'save_site_inquiry: твърде много запитвания от този адрес';
    end if;
  end if;
  insert into public.calculations (id, status, data)
  values (p_id, v_status, p_data)
  on conflict (id) do update set status = excluded.status, data = excluded.data
    where public.calculations.created_at > now() - interval '3 hours'
      and public.calculations.status in ('калкулация', 'заявка')   -- потвърден от колега запис не се пипа отвън
  returning calc_number into v_num;
  if v_num is null then
    raise exception 'save_site_inquiry: записът е заключен';
  end if;
  if v_new and v_ip is not null then
    delete from private.site_hits where created_at < now() - interval '1 day';
    insert into private.site_hits (ip_hash, calc_id) values (v_iph, p_id) on conflict do nothing;
  end if;
  return v_num;
end;
$$;

-- 3) журналите — само за служители; анонимният ключ няма права върху таблиците
drop policy if exists "offer_events_select_authenticated" on public.offer_events;
create policy "offer_events_select_staff" on public.offer_events
  for select to authenticated using ((select private.is_staff()));
drop policy if exists "lookup_attempts_select_authenticated" on public.calc_lookup_attempts;
create policy "lookup_attempts_select_staff" on public.calc_lookup_attempts
  for select to authenticated using ((select private.is_staff()));
revoke all on public.offer_events, public.calc_lookup_attempts from anon;
