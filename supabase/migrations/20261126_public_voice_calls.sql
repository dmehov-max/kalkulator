-- Разговор с гласовия асистент от формата за клиенти (klient.html) — Додо, 26.11.2026.
-- Пропускът се дава без вход, затова ограничаваме:
--   до 3 разговора на час от един адрес и до 40 на денонощие общо за сайта.
-- Дължината на разговора (15 мин) и мълчанието (60 сек) пази самият асистент.
create table if not exists private.voice_public_calls (
  id bigserial primary key,
  ip_hash text not null,
  room text not null,
  created_at timestamptz not null default now()
);
revoke all on private.voice_public_calls from public, anon, authenticated;
create index if not exists voice_public_calls_recent on private.voice_public_calls (created_at);

-- вика се само от функцията livekit-token със service_role; връща null, ако е позволено, иначе причина
create or replace function public.voice_public_allow(p_ip_hash text, p_room text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip int; v_all int;
begin
  if p_ip_hash is null or length(p_ip_hash) < 16 or p_room !~ '^klient-[a-z0-9-]{6,60}$' then
    return 'invalid';
  end if;
  perform pg_advisory_xact_lock(hashtext('voice_public_allow'));
  select count(*) into v_all from private.voice_public_calls where created_at > now() - interval '24 hours';
  if v_all >= 40 then return 'day_limit'; end if;
  select count(*) into v_ip from private.voice_public_calls where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if v_ip >= 3 then return 'ip_limit'; end if;
  delete from private.voice_public_calls where created_at < now() - interval '7 days';
  insert into private.voice_public_calls (ip_hash, room) values (p_ip_hash, p_room);
  return null;
end;
$$;
revoke all on function public.voice_public_allow(text, text) from public, anon, authenticated;
grant execute on function public.voice_public_allow(text, text) to service_role;
