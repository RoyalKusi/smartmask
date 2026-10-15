import { expect, test } from '@playwright/test';
import { open, setRole, toast, trackConsole, waitForData } from './helpers';

test.describe('SmartMask Console: the flows that must work end to end', () => {
  test('role switch re-masks the result without re-running and writes an audit event', async ({ page }) => {
    const errors = trackConsole(page);
    await open(page, 'workbench');
    await page.getByTestId('run-query').click();
    const masked = page.getByRole('grid', { name: /Masked result for Admin/ });
    await expect(masked).toContainText('4111-1111-1111-1111', { timeout: 20_000 });
    await expect(masked).toContainText('128450.00');

    await setRole(page, 'support');
    const support = page.getByRole('grid', { name: /Masked result for Support/ });
    await expect(support).toContainText('4111-XXXX-XXXX-1111');
    await expect(support).toContainText('100,000–149,999');
    // The base-table pane (evaluator connection) is unchanged by the role.
    await expect(page.getByRole('grid', { name: /Base-table result/ })).toContainText('4111-1111-1111-1111');

    await setRole(page, 'analyst');
    const analyst = page.getByRole('grid', { name: /Masked result for Analyst/ });
    await expect(analyst).toContainText(/tok_[0-9a-f]{24}/);
    await expect(analyst).toContainText('[REDACTED]');
    await expect(analyst).not.toContainText('4111-1111');

    await open(page, 'audit', 'role=analyst&type=ROLE_SWITCH');
    await expect(page.getByRole('grid', { name: 'Audit events' })).toContainText('ROLE_SWITCH');
    expect(errors).toEqual([]);
  });

  test('run query: stage strip, SM-PRED-001 and SM-DERIVED-001 rejections, SM-PARSE-001', async ({ page }) => {
    await open(page, 'workbench', 'role=support&sample=probe');
    await page.getByTestId('run-query').click();
    await expect(page.getByRole('alert').filter({ hasText: 'SM-PRED-001' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('list', { name: 'Pipeline' }).getByRole('listitem').nth(1)).toHaveAttribute('data-state', 'fail');

    await open(page, 'workbench', 'role=analyst&sample=derived');
    await page.getByTestId('run-query').click();
    await expect(page.getByRole('alert').filter({ hasText: 'SM-DERIVED-001' })).toBeVisible({ timeout: 20_000 });

    await open(page, 'workbench', 'role=admin&sample=parse');
    await page.getByTestId('run-query').click();
    await expect(page.getByRole('alert').filter({ hasText: 'SM-PARSE-001' }).first()).toBeVisible({ timeout: 20_000 });

    // Admin may run the literal predicate.
    await open(page, 'workbench', 'role=admin&sample=probe');
    await page.getByTestId('run-query').click();
    await expect(page.getByRole('list', { name: 'Pipeline' }).getByRole('listitem').nth(5)).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
  });

  test('joins on tokens work: equal inputs give equal tokens', async ({ page }) => {
    await open(page, 'workbench', 'role=analyst&sample=tokenjoin');
    await page.getByTestId('run-query').click();
    const grid = page.getByRole('grid', { name: /Masked result for Analyst/ });
    await expect(grid).toContainText(/tok_/, { timeout: 20_000 });
    const rows = grid.getByRole('row');
    const first = rows.nth(2);
    const cells = await first.getByRole('gridcell').allInnerTexts();
    const toks = cells.map((c) => c.trim()).filter((c) => c.startsWith('tok_'));
    expect(toks.length).toBeGreaterThanOrEqual(2);
    expect(toks[0]).toBe(toks[1]);
  });

  test('scan populates the table progressively and the review decision updates the catalog and Overview', async ({ page }) => {
    await open(page, 'discovery', 'conn=ledger_lite');
    await waitForData(page);
    await page.getByRole('button', { name: /Scan ledger_lite/ }).click();
    await expect(page.getByRole('progressbar', { name: /Scanning ledger_lite/ })).toBeVisible();
    await expect(toast(page, 'Scan of ledger_lite complete')).toBeVisible({ timeout: 20_000 });

    await open(page, 'overview');
    await expect(page.locator('.sm-kpi').nth(1)).toContainText('45', { timeout: 20_000 });

    await open(page, 'review');
    await expect(page.getByRole('article').first()).toBeVisible();
    const before = await page.getByRole('article').count();
    expect(before).toBeGreaterThan(5);
    await page.getByRole('article').filter({ hasText: 'legacy_cards.c1' }).getByRole('button', { name: 'Approve' }).click();
    await expect(toast(page, 'Approved legacy_cards.c1')).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(before - 1);

    await open(page, 'overview');
    await expect(page.locator('.sm-kpi').nth(1)).toContainText('46', { timeout: 20_000 });
    await open(page, 'audit', 'type=REVIEW_DECISION&q=legacy_cards.c1');
    await expect(page.getByRole('grid', { name: 'Audit events' })).toContainText('REVIEW_DECISION');
  });

  test('clearing a column needs a justification', async ({ page }) => {
    await open(page, 'review');
    const card = page.getByRole('article').filter({ hasText: 'settlements.order_ref' });
    await card.getByRole('button', { name: 'Clear…' }).click();
    const dlg = page.getByRole('alertdialog');
    const clear = dlg.getByRole('button', { name: 'Clear column' });
    await expect(clear).toBeDisabled();
    const why = dlg.getByLabel(/Justification/);
    await why.fill('short');
    await why.blur();
    await expect(dlg.getByText(/at least 12 characters/)).toBeVisible();
    await expect(clear).toBeDisabled();
    await why.fill('16-digit order reference numbers, not card numbers.');
    await expect(clear).toBeEnabled();
    await clear.click();
    await expect(toast(page, 'Cleared settlements.order_ref')).toBeVisible();
  });

  test('policy edit: invalid YAML disables Save and flags the line; a valid edit updates the matrix and bumps the version', async ({ page }) => {
    await open(page, 'policy');
    await expect(page.getByText('policy_version 7')).toBeVisible();
    const editor = page.getByRole('textbox', { name: 'Policy YAML editor' });
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n- stray');
    const issues = page.getByRole('list', { name: 'Validation issues' });
    await expect(issues).toContainText('SM-POL-001');
    await expect(issues).toContainText(/Line (2[0-9]|[3-9][0-9])/);
    await expect(page.getByRole('button', { name: /Save as v8/ })).toBeDisabled();
    await expect(page.locator('.cm-lintRange-error').first()).toBeVisible();
    await page.getByRole('button', { name: 'Revert' }).click();
    await expect(page.getByText('Valid', { exact: true })).toBeVisible();

    // Semantic error: single-line YAML flow mapping with an unknown role.
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('{"policy_version": 7, "fail_mode": "closed", "rules": [{"role": "ROLE_BOGUS", "tag": "PII_HIGH", "function": "REDACT"}]}');
    await expect(issues).toContainText('SM-POL-002');
    await expect(page.getByRole('button', { name: /Save as v8/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Revert' }).click();
    await expect(page.getByText('Valid', { exact: true })).toBeVisible();

    // Guardrail: PLAINTEXT for Support on PII_HIGH is blocked.
    await page.getByRole('button', { name: 'Let support see full card numbers' }).click();
    await expect(page.getByText('SM-POL-003').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Discard' }).click();

    await page.getByRole('button', { name: 'Redact balances for support' }).click();
    await expect(page.getByText(/Golden-query diff/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Approve and publish' }).click();
    await expect(toast(page, 'Policy v8 published')).toBeVisible();
    await expect(page.getByText('policy_version 8')).toBeVisible();
    await expect(page.getByRole('cell', { name: /Support FINANCIAL_CONFIDENTIAL: REDACT/ })).toBeVisible();
  });

  test('policy bump invalidates the plan cache: the next run is a miss, then a hit', async ({ page }) => {
    await open(page, 'workbench');
    await page.getByTestId('run-query').click();
    await expect(page.getByText(/plan cache (hit|miss)/)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('run-query').click();
    await expect(page.getByText('plan cache hit')).toBeVisible({ timeout: 20_000 });
    await open(page, 'performance');
    await page.getByRole('button', { name: /Republish policy/ }).click();
    await expect(toast(page, /Policy v\d+ published/)).toBeVisible();
    await open(page, 'workbench');
    await page.getByTestId('run-query').click();
    await expect(page.getByText('plan cache miss')).toBeVisible({ timeout: 20_000 });
  });

  test('tamper test: corrupting an event breaks the chain and Verify Chain pinpoints it', async ({ page }) => {
    await open(page, 'audit');
    await waitForData(page);
    await expect(page.getByText('Chain verified').first()).toBeVisible();
    await page.getByRole('button', { name: 'Tamper test…' }).click();
    await page.getByRole('button', { name: 'Corrupt event' }).click();
    await expect(page.getByText('An event was modified')).toBeVisible();
    await page.getByRole('button', { name: 'Verify chain' }).click();
    await expect(page.getByText(/Chain BROKEN at event #\d+/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/stored hash does not match/)).toBeVisible();
    await page.getByRole('button', { name: 'Show event' }).click();
    await expect(page.getByRole('grid', { name: 'Audit events' })).toContainText('Hash mismatch');
    await page.getByRole('button', { name: 'Restore corrupted event' }).click();
    await expect(toast(page, 'Event restored from backup')).toBeVisible();
  });

  test('verification: base tables are unchanged after a query batch', async ({ page }) => {
    await open(page, 'verification');
    await waitForData(page);
    await expect(page.getByText('Raw data unchanged')).toBeVisible();
    await page.getByRole('button', { name: 'Run verification batch' }).click();
    await expect(page.locator('.fui-ToastTitle', { hasText: 'Verification passed' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Raw data unchanged')).toBeVisible();
  });

  test('export report produces JSON and CSV downloads', async ({ page }) => {
    await open(page, 'discovery', 'state=REVIEW');
    await waitForData(page);
    await page.getByRole('button', { name: 'Export report' }).click();
    const dlg = page.getByRole('dialog', { name: 'Export report' });
    await expect(dlg.getByRole('button', { name: 'Next' })).toBeEnabled();
    await dlg.getByRole('button', { name: 'Next' }).click();
    await dlg.getByRole('textbox', { name: /File name/ }).fill('!!');
    await dlg.getByRole('textbox', { name: /File name/ }).blur();
    await expect(dlg.getByText(/Use 3–40 letters/)).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Next' })).toBeDisabled();
    await dlg.getByRole('textbox', { name: /File name/ }).fill('review columns');
    await dlg.getByRole('button', { name: 'Next' }).click();
    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await dlg.getByRole('button', { name: 'Download' }).click();
    await expect.poll(() => downloads.length).toBe(2);
    expect(downloads.sort()).toEqual(['review-columns.csv', 'review-columns.json']);
  });

  test('state lives in the URL and survives refresh and Back/Forward', async ({ page }) => {
    await open(page, 'discovery', 'state=ENFORCED&tag=PII_HIGH&sort=s:desc&q=ssn');
    await waitForData(page);
    const grid = page.getByRole('grid', { name: 'Discovered columns' });
    await expect(grid).toContainText('customers');
    await page.reload();
    await waitForData(page);
    await expect(page.locator('#disc-q')).toHaveValue('ssn');
    await expect(page).toHaveURL(/state=ENFORCED/);
    await expect(page).toHaveURL(/tag=PII_HIGH/);
    await setRole(page, 'analyst');
    await page.goBack();
    await expect(page).not.toHaveURL(/role=analyst/);
    await page.goForward();
    await expect(page).toHaveURL(/role=analyst/);
  });

  test('chaos: injected 500 shows an error panel with a code and Retry recovers', async ({ page }) => {
    await open(page, 'review');
    await waitForData(page);
    await page.keyboard.press('Control+Shift+E');
    await page.getByLabel('Inject HTTP 500 on reads').check();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('link', { name: 'Policy Studio' }).click();
    await expect(page.getByText('SM-API-500')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Technical details')).toBeVisible();
    await page.keyboard.press('Control+Shift+E');
    await page.getByLabel('Inject HTTP 500 on reads').uncheck();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('heading', { name: 'Policy Studio' })).toBeVisible();
    await expect(page.getByText('policy_version 7')).toBeVisible({ timeout: 20_000 });
  });

  test('schema drift: rename triggers a rescan and the new column is reviewed', async ({ page }) => {
    await open(page, 'discovery');
    await waitForData(page);
    await page.getByRole('button', { name: 'Simulate schema drift' }).click();
    await expect(page.getByText('Schema drift reconciled')).toBeVisible({ timeout: 30_000 });
    await open(page, 'review');
    await expect(page.getByRole('article').filter({ hasText: 'contacts.handset' })).toBeVisible({ timeout: 20_000 });
  });

  test('anomalies: three injected anomalies, acknowledge with undo, dismiss with confirmation', async ({ page }) => {
    await open(page, 'anomalies');
    await waitForData(page);
    const grid = page.getByRole('grid', { name: 'Anomaly alerts' });
    await expect(grid).toContainText('t.chikwanha');
    await expect(grid).toContainText('a.kulkarni');
    await expect(grid).toContainText('m.desai');
    await grid.getByRole('button', { name: 'Acknowledge' }).first().click();
    await expect(toast(page, /Alert AN-\d+ acknowledged/)).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await grid.getByRole('button', { name: 'Dismiss' }).first().click();
    await expect(page.getByRole('alertdialog')).toContainText('Dismiss alert');
    await page.getByRole('button', { name: 'Dismiss alert' }).click();
    await expect(toast(page, /Alert AN-\d+ dismissed/)).toBeVisible();
  });

  test('performance: percentile chart, waterfall and budget gauge render', async ({ page }) => {
    await open(page, 'performance');
    await waitForData(page);
    await expect(page.getByRole('meter')).toBeVisible();
    await expect(page.getByText('Stage latency waterfall (mean)')).toBeVisible();
    await expect(page.getByText('simulated', { exact: false }).first()).toBeVisible();
  });

  test('command palette and keyboard shortcuts', async ({ page }) => {
    await open(page, 'overview');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('audit');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/audit/);
  });
});
