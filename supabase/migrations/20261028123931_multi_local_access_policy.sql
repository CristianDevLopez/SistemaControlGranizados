-- Explicitly deny browser roles in addition to private-schema and table grants.
do $$ declare tab text; begin
  foreach tab in array array['businesses','branches','installation','branch_members','branch_runtime','subscription_invoices','subscription_payments','platform_audit'] loop
    execute format('create policy deny_direct_access on private.%I for all to anon,authenticated using(false) with check(false)',tab);
  end loop;
end $$;
