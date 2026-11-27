-- PetskySign: after signing, the signing link offers the signed PDF and the
-- certificate. When the sender asked for the CPF, the copy asks for it again:
-- a link forwarded in a chat no longer hands over the tutor's data. Wrong
-- CPFs are counted apart from the ones before signing.

alter table public.signers
  add column if not exists copy_unlock_attempts integer not null default 0
    check (copy_unlock_attempts >= 0);
