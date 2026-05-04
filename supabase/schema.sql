create table if not exists public.looki_profiles (
  uid text primary key,
  looki_base_url text not null,
  encrypted_looki_api_key text not null,
  provider_mode text not null default 'managed',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.import_ledger (
  uid text not null,
  idempotency_key text not null,
  target text not null,
  status text not null,
  record jsonb not null,
  provider jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (uid, idempotency_key)
);

create index if not exists import_ledger_uid_updated_at_idx on public.import_ledger (uid, updated_at desc);
create index if not exists import_ledger_target_status_idx on public.import_ledger (target, status);

alter table public.looki_profiles enable row level security;
alter table public.import_ledger enable row level security;
