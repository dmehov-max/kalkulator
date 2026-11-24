-- Клиентът се връща към своята поръчка по номер (гласовият асистент). Решение на Додо, 24.11.2026.
-- Само номерът не стига (номерата са поредни): трябва и ПИН (4 цифри, data.pin) ИЛИ двата квартала/
-- града на поръчката. Асистентът само ЧЕТЕ обобщение и ДОБАВЯ бележка — не променя вещи, адреси и цена.
-- Анонимният ключ не чете таблицата; всичко минава през двете функции по-долу.

create table if not exists public.calc_lookup_attempts (
  id bigserial primary key,
  calc_number bigint,
  ok boolean not null,
  created_at timestamptz not null default now()
);
alter table public.calc_lookup_attempts enable row level security;
drop policy if exists "lookup_attempts_select_authenticated" on public.calc_lookup_attempts;
create policy "lookup_attempts_select_authenticated" on public.calc_lookup_attempts
  for select to authenticated using (true);
create index if not exists calc_lookup_attempts_recent on public.calc_lookup_attempts (created_at);

-- вътрешна проверка: верен ли е ПИН-ът или кварталите; пише опита и пази лимитите
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
      -- двата края на маршрута: кварталите (градско) или градовете (извънградско); редът няма значение
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
    return null;   -- един и същ отговор за „няма такава“ и „грешен ПИН“ — не издаваме кои номера съществуват
  end if;
  return c;
end;
$$;
revoke all on function public._calc_client_check(bigint, text, text, text) from public, anon, authenticated;

-- 1) Обобщение на поръчката за клиента — без име, телефон, имейл и вътрешни суми
create or replace function public.client_calc_lookup(p_number bigint, p_pin text, p_from text, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.calculations%rowtype;
  d jsonb;
  v_hidden boolean;
begin
  c := public._calc_client_check(p_number, p_pin, p_from, p_to);
  if c.id is null then
    return jsonb_build_object('ok', false);
  end if;
  d := c.data;
  -- цена не се казва, ако и при създаването не е била казана (оглед / над лимита / разговор без сметка)
  v_hidden := coalesce((d->'site'->>'needsSurvey')::boolean, false)
              or coalesce(d->>'notes', '') like '%НАД ЛИМИТА%'
              or coalesce((d->>'talkOnly')::boolean, false)
              or coalesce((d->>'total')::numeric, 0) <= 0;
  return jsonb_build_object(
    'ok', true,
    'nomer', c.calc_number,
    'data', to_char(c.created_at at time zone 'Europe/Sofia', 'DD.MM.YYYY'),
    'status', c.status,
    'usluga', d->>'service',
    'ot', coalesce(nullif(d->'formState'->>'pickupHood', ''), nullif(d->'formState'->>'pickupCity', ''), d->>'city'),
    'do', coalesce(nullif(d->'formState'->>'dropoffHood', ''), nullif(d->'formState'->>'dropoffCity', '')),
    'grad', d->>'city',
    'veshti', coalesce((select jsonb_agg(jsonb_build_object('vesht', i->>'label', 'broi', (i->>'qty')::int)) from jsonb_array_elements(coalesce(d->'items', '[]'::jsonb)) i), '[]'::jsonb),
    'cena_eur', case when v_hidden then null else round((d->>'total')::numeric * 1.2) end,
    'cena_ne_e_kazana', v_hidden
  );
end;
$$;
revoke all on function public.client_calc_lookup(bigint, text, text, text) from public;
grant execute on function public.client_calc_lookup(bigint, text, text, text) to anon, authenticated;

-- 2) Бележка от клиента към поръчката (само добавяне; колегата прави промените)
create or replace function public.client_calc_add_note(p_number bigint, p_pin text, p_from text, p_to text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.calculations%rowtype;
  v_notes jsonb;
begin
  if p_note is null or length(btrim(p_note)) = 0 or length(p_note) > 600 then
    raise exception 'note: празна или твърде дълга бележка';
  end if;
  c := public._calc_client_check(p_number, p_pin, p_from, p_to);
  if c.id is null then
    return jsonb_build_object('ok', false);
  end if;
  v_notes := coalesce(c.data->'clientNotes', '[]'::jsonb);
  if jsonb_array_length(v_notes) >= 10 then
    raise exception 'note: твърде много бележки към тази поръчка';
  end if;
  update public.calculations
     set data = data || jsonb_build_object('clientNotes', v_notes || jsonb_build_array(jsonb_build_object(
           'text', btrim(p_note), 'at', to_char(now() at time zone 'Europe/Sofia', 'DD.MM.YYYY HH24:MI'), 'via', 'гласов асистент')))
   where id = c.id;
  return jsonb_build_object('ok', true, 'nomer', c.calc_number);
end;
$$;
revoke all on function public.client_calc_add_note(bigint, text, text, text, text) from public;
grant execute on function public.client_calc_add_note(bigint, text, text, text, text) to anon, authenticated;
