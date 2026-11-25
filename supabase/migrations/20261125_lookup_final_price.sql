-- Цената от калкулатора е крайната за клиента — ДДС не се добавя (Додо, 25.11.2026).
-- client_calc_lookup връщаше total × 1.2; сега връща total.
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'client_calc_lookup';
  if position('::numeric * 1.2)' in src) = 0 then raise notice 'вече е без ДДС'; return; end if;
  execute replace(src, '(d->>''total'')::numeric * 1.2)', '(d->>''total'')::numeric)');
end $$;
