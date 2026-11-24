-- PetskySign: a one-time code sent by WhatsApp before the document opens,
-- for signers reached by a link in a chat (most of petsky's tutors), who may
-- have no email address. Same rules as the emailed code (email_code_*).

alter table public.signers
  add column if not exists whatsapp_phone text
    check (whatsapp_phone is null or whatsapp_phone ~ '^55[0-9]{10,11}$'),
  add column if not exists require_whatsapp_code boolean not null default false,
  add column if not exists whatsapp_code_hash text,
  add column if not exists whatsapp_code_expires_at bigint,
  add column if not exists whatsapp_code_sent_at bigint,
  add column if not exists whatsapp_code_attempts integer not null default 0
    check (whatsapp_code_attempts >= 0);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'signers_whatsapp_code_needs_phone'
  ) then
    alter table public.signers
      add constraint signers_whatsapp_code_needs_phone
        check (not require_whatsapp_code or whatsapp_phone is not null);
  end if;
end $$;
