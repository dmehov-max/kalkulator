-- Тест на правата в базата (RLS). Не оставя следа: накрая винаги вдига грешка, а с нея
-- Postgres връща назад ВСИЧКО от заявката (тестовите акаунти, записи, промени).
-- Как се пуска: Supabase → SQL Editor → постави целия файл → Run.
-- Резултат: грешка с текст "RLS ТЕСТ: ВСИЧКО МИНАВА (N проверки)" = наред;
--           "RLS ТЕСТ: НЕУСПЕШНИ ..." = има дупка, текстът казва къде.
do $test$
declare
  staff_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  banned_id uuid := gen_random_uuid();
  unconf_id uuid := gen_random_uuid();
  fails text[] := '{}';
  passed int := 0;
  n int;
  v jsonb;

begin
  -- тестови акаунти
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, created_at, updated_at)
  values
    (staff_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-staff@korekt-bg.com',  now(), '{}', now(), now()),
    (admin_id,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-admin@korekt-bg.com',  now(), '{"role":"admin"}', now(), now()),
    (banned_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-banned@korekt-bg.com', now(), '{}', now(), now()),
    (unconf_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-unconf@korekt-bg.com', null,  '{}', now(), now());
  update auth.users set banned_until = now() + interval '100 years' where id = banned_id;
  insert into public.calculations (id, status, data) values ('calc:rls-test-1', 'калкулация', '{"contact":{"name":"Тест"}}');
  insert into public.calculations (id, status, data, created_at) values ('calc:voice-rls-old', 'калкулация', '{}', now() - interval '1 day');

  -- 1. регистрация с чужд домейн → отказ
  begin
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hacker@gmail.com', now(), now());
    fails := fails || 'чужд домейн се регистрира';
  exception when check_violation then passed := passed + 1;
  end;
  -- 1б. смяна на имейл на служител към чужд домейн → отказ
  begin
    update auth.users set email = 'hacker@gmail.com' where id = staff_id;
    fails := fails || 'служител смени имейла си към чужд домейн';
  exception when check_violation then passed := passed + 1;
  end;

  -- 2. anon (публичният ключ): нула достъп до таблиците
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin perform 1 from public.calc_params;   fails := fails || 'anon чете calc_params';   exception when insufficient_privilege then passed := passed + 1; end;
  begin perform 1 from public.catalog_items; fails := fails || 'anon чете catalog_items'; exception when insufficient_privilege then passed := passed + 1; end;
  begin perform 1 from public.calculations;  fails := fails || 'anon чете calculations';  exception when insufficient_privilege then passed := passed + 1; end;
  begin perform 1 from public.offers;        fails := fails || 'anon чете offers';        exception when insufficient_privilege then passed := passed + 1; end;
  begin update public.calc_params set value = value || '{"workerRate":1}'; fails := fails || 'anon пише calc_params'; exception when insufficient_privilege then passed := passed + 1; end;
  begin insert into public.catalog_items (id, group_name, label, m3, kg) values ('x', 'x', 'x', 1, 1); fails := fails || 'anon пише catalog_items'; exception when insufficient_privilege then passed := passed + 1; end;
  begin perform private.is_staff(); fails := fails || 'anon вика private.is_staff'; exception when insufficient_privilege then passed := passed + 1; end;
  -- 2б. гласовият RPC: чужди id и стари записи са заключени, нови минават
  begin perform public.save_voice_calc('calc:rls-test-1', 'калкулация', '{}'); fails := fails || 'voice презаписва обикновена калкулация'; exception when raise_exception then passed := passed + 1; end;
  begin perform public.save_voice_calc('calc:voice-rls-old', 'калкулация', '{}'); fails := fails || 'voice презаписва стар гласов запис'; exception when raise_exception then passed := passed + 1; end;
  begin perform public.save_voice_calc('calc:voice-rls-new', 'потвърдена', '{}'); fails := fails || 'voice слага статус потвърдена'; exception when raise_exception then passed := passed + 1; end;
  begin
    if public.save_voice_calc('calc:voice-rls-new', 'калкулация', '{"a":1}') is null then fails := fails || 'voice: нов запис без номер'; else passed := passed + 1; end if;
  exception when others then fails := fails || ('voice: нов запис не мина: ' || sqlerrm);
  end;
  v := public.voice_pricing();
  if v is null or v ? 'workerCostDefault' or v ? 'mapsApiKey' or v ? 'supabaseKey' or v ? 'truckCostPerHour' then
    fails := fails || 'voice_pricing връща вътрешни/тайни полета'; else passed := passed + 1; end if;
  execute 'reset role';

  -- 3. спрян, непотвърден и „authenticated без акаунт“ — виждат нула
  foreach v in array array[
      jsonb_build_object('sub', banned_id, 'role', 'authenticated', 'email', 'rls-test-banned@korekt-bg.com'),
      jsonb_build_object('sub', unconf_id, 'role', 'authenticated', 'email', 'rls-test-unconf@korekt-bg.com'),
      jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'email', 'fake@korekt-bg.com')] loop
    perform set_config('request.jwt.claims', v::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.calculations;  if n > 0 then fails := fails || ('вижда calculations: ' || (v->>'email')); else passed := passed + 1; end if;
    select count(*) into n from public.calc_params;   if n > 0 then fails := fails || ('вижда calc_params: ' || (v->>'email')); else passed := passed + 1; end if;
    select count(*) into n from public.offers;        if n > 0 then fails := fails || ('вижда offers: ' || (v->>'email')); else passed := passed + 1; end if;
    begin insert into public.calculations (id, status, data) values ('calc:rls-x', 'калкулация', '{}'); fails := fails || ('пише calculations: ' || (v->>'email')); exception when insufficient_privilege then passed := passed + 1; end;
    execute 'reset role';
  end loop;

  -- 4. служител: работи с калкулации/каталог/оферти, но НЕ сменя цени и НЕ трие
  perform set_config('request.jwt.claims', jsonb_build_object('sub', staff_id, 'role', 'authenticated', 'email', 'rls-test-staff@korekt-bg.com')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.calculations where id = 'calc:rls-test-1'; if n = 1 then passed := passed + 1; else fails := fails || 'служител не вижда калкулациите'; end if;
  select count(*) into n from public.calc_params; if n >= 1 then passed := passed + 1; else fails := fails || 'служител не чете параметрите'; end if;
  begin insert into public.calculations (id, status, data) values ('calc:rls-test-2', 'калкулация', '{}'); passed := passed + 1;
  exception when others then fails := fails || ('служител не може да запише калкулация: ' || sqlerrm); end;
  begin insert into public.offers (id, data) values ('RLS-TEST-1', '{}'); passed := passed + 1;
  exception when others then fails := fails || ('служител не може да запише оферта: ' || sqlerrm); end;
  update public.calc_params set value = value || '{"workerRate":1}' where id = 'pricing';
  get diagnostics n = row_count; if n = 0 then passed := passed + 1; else fails := fails || 'служител сменя цените'; end if;
  delete from public.calculations where id = 'calc:rls-test-1';
  get diagnostics n = row_count; if n = 0 then passed := passed + 1; else fails := fails || 'служител трие калкулации'; end if;
  begin update auth.users set raw_app_meta_data = '{"role":"admin"}' where id = staff_id; fails := fails || 'служител си вдига ролята';
  exception when insufficient_privilege then passed := passed + 1; end;
  execute 'reset role';

  -- 5. администратор: сменя цени и трие
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated', 'email', 'rls-test-admin@korekt-bg.com')::text, true);
  execute 'set local role authenticated';
  update public.calc_params set value = value || '{"rlsTest":1}' where id = 'pricing';
  get diagnostics n = row_count; if n = 1 then passed := passed + 1; else fails := fails || 'администратор не може да смени цените'; end if;
  delete from public.calculations where id = 'calc:rls-test-1';
  get diagnostics n = row_count; if n = 1 then passed := passed + 1; else fails := fails || 'администратор не може да трие'; end if;
  execute 'reset role';

  if array_length(fails, 1) is null then
    raise exception 'RLS ТЕСТ: ВСИЧКО МИНАВА (% проверки)', passed;
  else
    raise exception 'RLS ТЕСТ: НЕУСПЕШНИ % от % → %', array_length(fails, 1), passed + array_length(fails, 1), array_to_string(fails, ' | ');
  end if;
end
$test$;
