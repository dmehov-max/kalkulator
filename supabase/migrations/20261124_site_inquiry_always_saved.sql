-- Всяко запитване от клиентската форма се записва — и без име и телефон (решение на Додо, 24.11.2026).
-- Първо влиза като „калкулация“ (щом клиентът види цената); ако остави данни, същият запис
-- се дописва и става „заявка“. Дописването е позволено само за запис от последните 3 часа.
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
  -- до 150 нови запитвания от сайта на час за целия проект (срещу заливане)
  select count(*) into v_recent from public.calculations
   where id like 'calc:site-%' and created_at > now() - interval '1 hour';
  if v_recent >= 150 and not exists (select 1 from public.calculations where id = p_id) then
    raise exception 'save_site_inquiry: твърде много запитвания за последния час';
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
  return v_num;
end;
$$;
revoke all on function public.save_site_inquiry(text, jsonb) from public;
grant execute on function public.save_site_inquiry(text, jsonb) to anon, authenticated;
