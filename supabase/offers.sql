-- Оферти към клиенти (раздел „📄 Оферти“ в калкулатора, файл oferti.html).
-- Цялата оферта е в data (jsonb) — същата структура като във формата.
-- Четене и запис само за логнати колеги (authenticated), анонимният ключ не вижда нищо.
create table if not exists public.offers (
  id text primary key,                         -- напр. BG-2026-0001 / INT-2026-0001
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text,                             -- имейл на колегата, запазил последно
  created_at timestamptz not null default now()
);

alter table public.offers enable row level security;

create policy "offers_select_authenticated" on public.offers
  for select to authenticated using (true);
create policy "offers_insert_authenticated" on public.offers
  for insert to authenticated with check (true);
create policy "offers_update_authenticated" on public.offers
  for update to authenticated using (true) with check (true);
