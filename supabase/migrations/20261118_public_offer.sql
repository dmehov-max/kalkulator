-- Публичен линк към оферта: клиентът отваря oferta.html?t=<токен> без вход, вижда офертата,
-- може да я приеме или да прати въпрос/молба за промяна. Анонимният ключ НЕ чете таблицата offers —
-- само три функции, които работят по токен: public_offer, accept_offer, offer_message.
-- Колегите (authenticated) виждат всичко през съществуващите политики.

alter table public.offers add column if not exists share_token text unique;     -- случаен токен в линка
alter table public.offers add column if not exists public_data jsonb;           -- какво вижда клиентът (без вътрешни бележки и разговор)
alter table public.offers add column if not exists shared_at timestamptz;
alter table public.offers add column if not exists accepted_at timestamptz;
alter table public.offers add column if not exists accepted_data jsonb;

create table if not exists public.offer_events (
  id bigserial primary key,
  offer_id text not null references public.offers(id) on delete cascade,
  kind text not null check (kind in ('view', 'accept', 'change', 'ask')),
  text text,
  data jsonb,
  created_at timestamptz not null default now()
);
alter table public.offer_events enable row level security;
drop policy if exists "offer_events_select_authenticated" on public.offer_events;
create policy "offer_events_select_authenticated" on public.offer_events
  for select to authenticated using (true);
-- няма политика за запис: събитията пишат само функциите по-долу (security definer)

-- 1) Оферта по токен (+ отбелязва „клиентът я е отворил“, най-много веднъж на 10 минути)
create or replace function public.public_offer(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9]{24,64}$' then
    return null;
  end if;
  select * into o from public.offers where share_token = p_token and public_data is not null;
  if not found then return null; end if;
  if not exists (select 1 from public.offer_events
                  where offer_id = o.id and kind = 'view' and created_at > now() - interval '10 minutes') then
    insert into public.offer_events (offer_id, kind) values (o.id, 'view');
  end if;
  return jsonb_build_object('offer', o.public_data, 'acceptedAt', o.accepted_at, 'acceptedData', o.accepted_data);
end;
$$;
revoke all on function public.public_offer(text) from public;
grant execute on function public.public_offer(text) to anon, authenticated;

-- 2) Приемане на офертата (веднъж; след изтичане на срока — не)
create or replace function public.accept_offer(p_token text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers%rowtype;
  v_until date;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9]{24,64}$' then
    raise exception 'accept_offer: невалиден линк';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 20000 then
    raise exception 'accept_offer: невалидни данни';
  end if;
  select * into o from public.offers where share_token = p_token and public_data is not null for update;
  if not found then raise exception 'accept_offer: офертата не е намерена'; end if;
  if o.accepted_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'acceptedAt', o.accepted_at);
  end if;
  v_until := (o.public_data->>'issued')::date + coalesce((o.public_data->>'validDays')::int, 28);
  if v_until < current_date then
    raise exception 'accept_offer: срокът на офертата е изтекъл';
  end if;
  update public.offers set accepted_at = now(), accepted_data = p_data where id = o.id;
  insert into public.offer_events (offer_id, kind, data) values (o.id, 'accept', p_data);
  return jsonb_build_object('ok', true, 'already', false, 'acceptedAt', now());
end;
$$;
revoke all on function public.accept_offer(text, jsonb) from public;
grant execute on function public.accept_offer(text, jsonb) to anon, authenticated;

-- 3) Въпрос или молба за промяна от клиента
create or replace function public.offer_message(p_token text, p_kind text, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.offers%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9]{24,64}$' then
    raise exception 'offer_message: невалиден линк';
  end if;
  if p_kind not in ('change', 'ask') then
    raise exception 'offer_message: непозволен вид';
  end if;
  if p_text is null or length(btrim(p_text)) = 0 or length(p_text) > 2000 then
    raise exception 'offer_message: празно или твърде дълго съобщение';
  end if;
  select * into o from public.offers where share_token = p_token and public_data is not null;
  if not found then raise exception 'offer_message: офертата не е намерена'; end if;
  if (select count(*) from public.offer_events where offer_id = o.id and kind in ('change', 'ask')) >= 20 then
    raise exception 'offer_message: твърде много съобщения';
  end if;
  insert into public.offer_events (offer_id, kind, text) values (o.id, p_kind, btrim(p_text));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.offer_message(text, text, text) from public;
grant execute on function public.offer_message(text, text, text) to anon, authenticated;
