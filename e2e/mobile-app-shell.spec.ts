import { expect, test } from '@playwright/test';

test('mobile WebKit loads the full-height login shell without viewport overflow', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle('My Life Memory');
  await expect(page.getByText('My life memory', { exact: true }).first()).toBeVisible();

  const viewport = await page.evaluate(() => {
    const root = document.getElementById('root');
    const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    return {
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      rootHeight: root?.getBoundingClientRect().height || 0,
      documentWidth: document.documentElement.scrollWidth,
      viewportContent: viewportMeta?.content || '',
    };
  });

  expect(viewport.rootHeight).toBeGreaterThanOrEqual(viewport.innerHeight - 1);
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.innerWidth + 1);
  expect(viewport.viewportContent).toContain('viewport-fit=cover');
  expect(viewport.viewportContent).not.toContain('user-scalable=no');
  expect(pageErrors).toEqual([]);
});
