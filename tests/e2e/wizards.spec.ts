import { expect, test } from './fixtures';
import { open, toast, waitForData } from './helpers';

test.describe('three-step wizards', () => {
  test('Add backend: validates on blur, primary disabled until valid, registers an empty backend', async ({
    page,
  }) => {
    await open(page, 'discovery');
    await waitForData(page);
    await page.getByRole('button', { name: 'Add backend' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add backend' });
    await expect(dlg.getByRole('button', { name: 'Next' })).toBeDisabled();

    const name = dlg.getByRole('textbox', { name: /Backend name/ });
    await name.fill('Bad Name');
    await name.blur();
    await expect(dlg.getByText(/lowercase letters/)).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Next' })).toBeDisabled();
    await name.fill('core_pg');
    await name.blur();
    await expect(dlg.getByText(/already exists/)).toBeVisible();
    await name.fill('risk_pg');
    await expect(dlg.getByRole('button', { name: 'Next' })).toBeEnabled();
    await dlg.getByRole('button', { name: 'Next' }).click();

    await expect(dlg.getByRole('button', { name: 'Next' })).toBeDisabled();
    const host = dlg.getByRole('textbox', { name: /Host/ });
    await host.fill('nonsense');
    await host.blur();
    await expect(dlg.getByText(/Use host:port/)).toBeVisible();
    await host.fill('risk-pg.meridian.internal:5432');
    await dlg.getByRole('textbox', { name: /Database/ }).fill('risk');
    await dlg.getByRole('textbox', { name: /Service user/ }).fill('smartmask_reader');
    await dlg.getByRole('button', { name: 'Next' }).click();

    await expect(dlg).toContainText('A · per-role secure views');
    await dlg.getByRole('button', { name: 'Test connection and add' }).click();
    await expect(toast(page, 'Backend risk_pg added')).toBeVisible();
    await expect(page).toHaveURL(/conn=risk_pg/);
    await expect(page.getByText('risk_pg has no discovered columns')).toBeVisible();
  });

  test('Override column: force a tag with a justification, then undo from the toast', async ({ page }) => {
    await open(page, 'discovery', 'q=city');
    await waitForData(page);
    const grid = page.getByRole('grid', { name: 'Discovered columns' });
    await grid.getByRole('button', { name: 'Override this column' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Override column' });
    await expect(dlg).toContainText('CLEAR');
    await dlg.getByRole('button', { name: 'Next' }).click();
    await expect(dlg.getByRole('button', { name: 'Next' })).toBeDisabled();
    const why = dlg.getByRole('textbox', { name: /Justification/ });
    await why.fill('too short');
    await why.blur();
    await expect(dlg.getByText(/at least 12 characters/)).toBeVisible();
    await why.fill('City plus postcode can identify a household.');
    await dlg.getByRole('button', { name: 'Next' }).click();
    await dlg.getByRole('button', { name: 'Apply override' }).click();
    await expect(toast(page, /Override applied to/)).toBeVisible();
    await expect(grid).toContainText('OVERRIDDEN');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(grid).not.toContainText('OVERRIDDEN');
  });

  test('Override column: clearing requires an explicit acknowledgement', async ({ page }) => {
    await open(page, 'discovery', 'q=customers.ssn');
    await waitForData(page);
    await page
      .getByRole('grid', { name: 'Discovered columns' })
      .getByRole('button', { name: 'Override this column' })
      .first()
      .click();
    const dlg = page.getByRole('dialog', { name: 'Override column' });
    await dlg.getByRole('button', { name: 'Next' }).click();
    await dlg.getByRole('radio', { name: /Clear/ }).check();
    await dlg
      .getByRole('textbox', { name: /Justification/ })
      .fill('Synthetic test column approved by privacy office.');
    await dlg.getByRole('button', { name: 'Next' }).click();
    await expect(dlg.getByRole('button', { name: 'Unmask column' })).toBeDisabled();
    await dlg.getByRole('checkbox').check();
    await expect(dlg.getByRole('button', { name: 'Unmask column' })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });
});
