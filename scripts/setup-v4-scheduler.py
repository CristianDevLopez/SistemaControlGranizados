"""Configure Dexter's private minute scheduler without printing its credential."""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile

PROJECT = "nglfyhcrpxuuqqnaeevf"
root = Path(__file__).resolve().parent.parent
private = root / ".local"
private.mkdir(exist_ok=True)
credential = secrets.token_hex(32)
cli = shutil.which("supabase")
if not cli:
    raise SystemExit("Supabase CLI is required.")

def run(arguments):
    result = subprocess.run([cli, *arguments], cwd=root, capture_output=True, encoding="utf-8")
    output = (result.stdout + result.stderr).replace(credential, "[REDACTED]")
    if result.returncode:
        raise RuntimeError(output)
    return output

with tempfile.TemporaryDirectory(prefix="scheduler-", dir=private) as folder:
    env_file = Path(folder) / "scheduler.env"
    sql_file = Path(folder) / "scheduler.sql"
    env_file.write_text("DEXTER_SCHEDULER_TOKEN=" + credential + "\n", encoding="utf-8")
    sql_file.write_text("""
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $setup$
declare secret_id uuid;
begin
  select id into secret_id from vault.secrets where name='dexter_v4_scheduler' limit 1;
  if secret_id is null then
    perform vault.create_secret('%s','dexter_v4_scheduler','Private Dexter minute scheduler');
  else
    perform vault.update_secret(secret_id,'%s');
  end if;
end $setup$;
select cron.unschedule(jobid) from cron.job where jobname='dexter-v4-minute';
select cron.schedule('dexter-v4-minute','* * * * *',$job$
  select net.http_post(
    url:='https://%s.supabase.co/functions/v1/dexter/telegram/tick',
    headers:=jsonb_build_object('Content-Type','application/json','x-dexter-scheduler',
      (select decrypted_secret from vault.decrypted_secrets where name='dexter_v4_scheduler' limit 1)),
    body:='{}'::jsonb,timeout_milliseconds:=120000
  );
$job$);
""" % (credential, credential, PROJECT), encoding="utf-8")
    run(["secrets", "set", "--env-file", str(env_file), "--project-ref", PROJECT])
    run(["db", "query", "--linked", "--file", str(sql_file)])
print("Dexter's private scheduler is configured to run every minute.")
