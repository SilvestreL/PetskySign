-- PetskySign: the signing link a signer used, kept after they sign so the
-- page they land on (and opening the same link again) can show their copy
-- and its status. Signing clears signing_token_hash, so the link can never
-- be used to sign again; this column is only read to find who signed with
-- it, by signer-completion.ts.

alter table public.signers
  add column if not exists signed_link_token_hash text
    check (signed_link_token_hash is null or length(signed_link_token_hash) = 64);

create unique index if not exists signers_signed_link_token_hash_idx
  on public.signers (signed_link_token_hash)
  where signed_link_token_hash is not null;
