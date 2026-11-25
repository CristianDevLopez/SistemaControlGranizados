import { expect, type Page } from '@playwright/test';

export async function enterVisibleClosing(
  page: Page,
  cash: string,
  accounts: Record<string, string>,
  items: Record<string, string> = {},
) {
  const dialog = page.getByRole('dialog', { name: 'Cierre de caja', exact: true });
  await expect(dialog.getByRole('button', { name: 'Enviar primer conteo' })).toBeVisible();
  await expect(dialog.getByRole('columnheader', { name: 'Debería haber' })).toHaveCount(0);
  await dialog.getByLabel('Efectivo', { exact: true }).fill(cash);
  for (const account of Object.keys(accounts)) {
    const row = dialog.getByRole('row').filter({ hasText: `Ventas · ${account}` });
    await expect(row).toBeVisible();
    await expect(row.getByRole('textbox')).toHaveCount(0);
  }
  for (const input of await dialog.getByRole('spinbutton').all()) {
    const name = await input.getAttribute('aria-label');
    await input.fill(items[name ?? ''] ?? '0');
  }
  await dialog.getByRole('button', { name: 'Enviar primer conteo' }).click();
  await expect(dialog).toHaveCount(0);
  const recount = page.getByRole('dialog', { name: 'Cierre de caja · Segundo conteo' });
  if (await recount.isVisible()) {
    await expect(recount.getByRole('columnheader', { name: 'Debería haber' })).toBeVisible();
    await expect(recount.getByLabel('Efectivo', { exact: true })).toHaveValue(cash);
    const note = recount.getByLabel('Nota sobre la diferencia');
    if (await note.isVisible()) await note.fill('Volví a contar y confirmé la diferencia.');
    await recount.getByRole('button', { name: 'Enviar segundo conteo' }).click();
    await expect(recount).toHaveCount(0);
  }
}

export async function submitCashDistribution(page: Page, amount: string) {
  await page.getByRole('button', { name: 'Repartir efectivo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirmar pagos y repartir efectivo' });
  await dialog.getByLabel('Confirmo ambos medios', { exact: false }).check();
  await dialog.getByLabel('Efectivo que dejas', { exact: false }).fill(amount);
  await dialog.getByRole('button', { name: 'Enviar cierre' }).click();
  await expect(dialog).toHaveCount(0);
}
