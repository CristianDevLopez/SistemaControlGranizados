import { expect, type Page } from '@playwright/test';

export async function enterVisibleClosing(
  page: Page,
  cash: string,
  accounts: Record<string, string>,
  items: Record<string, string> = {},
) {
  const dialog = page.getByRole('dialog', { name: 'Cierre de caja' });
  await expect(dialog.getByRole('columnheader', { name: 'Debería haber' })).toBeVisible();
  await dialog.getByLabel('Efectivo', { exact: true }).fill(cash);
  for (const [account, amount] of Object.entries(accounts))
    await dialog.getByLabel(account, { exact: true }).fill(amount);
  for (const input of await dialog.getByRole('spinbutton').all()) {
    const name = await input.getAttribute('aria-label');
    await input.fill(items[name ?? ''] ?? '0');
  }
  const note = dialog.getByLabel('Nota sobre la diferencia');
  if (await note.isVisible()) await note.fill('Volví a contar y confirmé la diferencia.');
  await dialog.getByRole('button', { name: 'Continuar a reparto de efectivo' }).click();
  await expect(dialog).toHaveCount(0);
}

export async function submitCashDistribution(page: Page, amount: string) {
  await page.getByRole('button', { name: 'Repartir efectivo', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirmar pagos y repartir efectivo' });
  await dialog.getByLabel('Confirmo ambos medios', { exact: false }).check();
  await dialog.getByLabel('Efectivo que dejas', { exact: false }).fill(amount);
  await dialog.getByRole('button', { name: 'Enviar cierre' }).click();
  await expect(dialog).toHaveCount(0);
}
