-- Звукови записи на разговорите с гласовия асистент (решение на Додо, 24.11.2026).
-- Файловете са в частната кофа „calls“; качва ги само edge функцията call-recording (с ключа на
-- асистента), слушат ги само служители. Пътят стои в calculations.data.audio.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('calls', 'calls', false, 26214400, array['audio/ogg'])
on conflict (id) do nothing;

drop policy if exists "calls_select_staff" on storage.objects;
create policy "calls_select_staff" on storage.objects
  for select to authenticated using (bucket_id = 'calls' and (select private.is_staff()));

-- p_path null → само проверка (верен ключ + записът съществува); иначе закача записа към калкулацията
create or replace function public.agent_audio_attach(p_hash text, p_id text, p_path text, p_bytes bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.agent_keys k where k.hash = p_hash) then
    return false;
  end if;
  if p_id is null or p_id !~ '^calc:voice-[A-Za-z0-9_.:-]{1,100}$'
     or not exists (select 1 from public.calculations where id = p_id) then
    return false;
  end if;
  if p_path is not null then
    update public.calculations
       set data = data || jsonb_build_object('audio', jsonb_build_object(
             'path', p_path, 'bytes', p_bytes, 'at', to_char(now() at time zone 'Europe/Sofia', 'DD.MM.YYYY HH24:MI')))
     where id = p_id;
  end if;
  return true;
end;
$$;
revoke all on function public.agent_audio_attach(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.agent_audio_attach(text, text, text, bigint) to service_role;

-- късен презапис от асистента (дописване на разговора) не бива да изтрие закачения звук
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
  values (p_id, coalesce(nullif(p_status, ''), 'калкулация'), p_data - 'audio')
  on conflict (id) do update set status = excluded.status,
    data = case when public.calculations.data ? 'audio'
                then excluded.data || jsonb_build_object('audio', public.calculations.data->'audio')
                else excluded.data end
    where public.calculations.created_at > now() - interval '3 hours'
  returning calc_number into v_num;
  if v_num is null then
    raise exception 'save_voice_calc: записът е заключен (по-стар от 3 часа)';
  end if;
  return v_num;
end;
$$;
