-- Поредни номера на калкулациите: досега номерът идваше от sequence и всеки презапис
-- (upsert на същия запис — калкулаторът и гласовият асистент пазят многократно) „изяждаше“ номер.
-- Сега номерът се дава само при истински нов ред: най-големият досега + 1.
create or replace function public.calculations_assign_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.calc_number is null then
    perform pg_advisory_xact_lock(hashtext('public.calculations.calc_number'));  -- двама едновременно не взимат един номер
    select coalesce(max(calc_number), 0) + 1 into new.calc_number from public.calculations;
  end if;
  return new;
end;
$$;

alter table public.calculations alter column calc_number drop default;
drop trigger if exists calculations_assign_number on public.calculations;
create trigger calculations_assign_number before insert on public.calculations
  for each row execute function public.calculations_assign_number();
create unique index if not exists calculations_calc_number_key on public.calculations (calc_number);
