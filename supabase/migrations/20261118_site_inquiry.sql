-- Запитване от клиентския калкулатор на сайта (klient.html) — без вход.
-- Клиентът може САМО да добави ново запитване; не чете и не променя нищо.
-- По образец на save_voice_calc (20261108_harden_security.sql).

create or replace function public.save_site_inquiry(p_id text, p_data jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_num bigint;
  v_recent int;
begin
  if p_id is null or p_id !~ '^calc:site-[A-Za-z0-9_.:-]{1,100}$' then
    raise exception 'save_site_inquiry: позволени са само id "calc:site-..."';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 200000 then
    raise exception 'save_site_inquiry: липсват или са твърде много данни';
  end if;
  if coalesce(p_data->>'source', '') <> 'сайт' or coalesce(p_data->'contact'->>'phone', '') = '' then
    raise exception 'save_site_inquiry: липсва източник или телефон';
  end if;
  -- до 40 запитвания от сайта на час за целия проект (срещу заливане)
  select count(*) into v_recent from public.calculations
   where id like 'calc:site-%' and created_at > now() - interval '1 hour';
  if v_recent >= 40 then
    raise exception 'save_site_inquiry: твърде много запитвания за последния час';
  end if;
  -- само нов запис: вече записано запитване не може да се презапише отвън
  insert into public.calculations (id, status, data)
  values (p_id, 'заявка', p_data)
  on conflict (id) do nothing
  returning calc_number into v_num;
  if v_num is null then
    raise exception 'save_site_inquiry: запитването вече е записано';
  end if;
  return v_num;
end;
$$;
revoke all on function public.save_site_inquiry(text, jsonb) from public;
grant execute on function public.save_site_inquiry(text, jsonb) to anon, authenticated;
