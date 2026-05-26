alter table public.budget_items
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz;

alter table public.actual_expenses
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz;

alter table public.accommodations
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz;

alter table public.todo_items
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz;

alter table public.guide_items
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz;

alter table public.luggage_items
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz;

alter table public.shared_luggage_items
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz;

create index if not exists budget_items_locked_by_idx on public.budget_items(locked_by);
create index if not exists actual_expenses_locked_by_idx on public.actual_expenses(locked_by);
create index if not exists accommodations_locked_by_idx on public.accommodations(locked_by);
create index if not exists todo_items_locked_by_idx on public.todo_items(locked_by);
create index if not exists guide_items_locked_by_idx on public.guide_items(locked_by);
create index if not exists luggage_items_locked_by_idx on public.luggage_items(locked_by);
create index if not exists shared_luggage_items_locked_by_idx on public.shared_luggage_items(locked_by);
