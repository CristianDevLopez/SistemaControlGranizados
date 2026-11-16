import { createClient } from '@supabase/supabase-js';

// Ejecutar solo en un entorno privado. Por defecto, muestra el plan sin modificar Auth.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  throw new Error('Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno privado.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const apply = process.argv.includes('--apply');
const { data: profiles, error } = await client.from('profiles').select('id').eq('role', 'admin');
if (error) throw new Error('No se pudieron consultar los administradores. No se modificaron factores.');
let found = 0;
let removed = 0;
for (const profile of profiles ?? []) {
  const { data, error } = await client.auth.admin.mfa.listFactors({ userId: profile.id });
  if (error) throw new Error('No se pudieron consultar los factores de un administrador.');
  for (const factor of data.factors.filter((factor) => factor.factor_type === 'totp')) {
    found++;
    if (apply) {
      const { error } = await client.auth.admin.mfa.deleteFactor({ userId: profile.id, id: factor.id });
      if (error) throw new Error('No se pudo retirar un factor. Revisa Auth y vuelve a ejecutar el proceso.');
      removed++;
    }
  }
  if (apply) {
    const { data, error } = await client.auth.admin.mfa.listFactors({ userId: profile.id });
    if (error || data.factors.some((factor) => factor.factor_type === 'totp'))
      throw new Error('No se pudo confirmar la eliminación de todos los factores TOTP.');
  }
}
console.log(
  JSON.stringify({ project: new URL(url).host, apply, admins: profiles?.length ?? 0, found, removed }),
);
