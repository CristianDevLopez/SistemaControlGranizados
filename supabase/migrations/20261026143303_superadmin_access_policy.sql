-- Explicit defense in depth; the browser also lacks schema/table grants.
create policy deny_direct_access on private.superadmin_access
for all to anon, authenticated using (false) with check (false);
