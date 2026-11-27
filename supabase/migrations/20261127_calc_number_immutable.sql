-- Номерът на калкулация не се сменя след създаването ѝ, каквото и да се редактира (Додо, 27.11.2026).
create or replace function public.calculations_keep_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.calc_number is distinct from old.calc_number then
    raise exception 'Номерът на калкулация №% не може да се сменя.', old.calc_number;
  end if;
  return new;
end;
$$;
drop trigger if exists calculations_keep_number on public.calculations;
create trigger calculations_keep_number before update on public.calculations
  for each row execute function public.calculations_keep_number();
