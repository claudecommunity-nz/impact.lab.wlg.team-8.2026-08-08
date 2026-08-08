/**
 * The six frames of the final integration pass, plus the measurements behind
 * them printed to stdout so the report quotes numbers rather than impressions.
 *
 * HEADED, for the same reason shots.spec.ts is: headless Chromium composites
 * MapLibre's canvas but not deck.gl's, so a headless map screenshot is a
 * basemap with no edges on it. The ASSERTIONS live in final.spec.ts and run
 * headless — this file only has to show the instrument.
 */

import { test, expect, type Page } from '@playwright/test';

test.use({ headless: false });
test.describe.configure({ timeout: 180_000 });

const DIR = 'e2e/shots';

async function settled(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(page.locator('.pp-cal__chip')).toHaveCount(7);
  await page.waitForLoadState('networkidle');
  // deck.gl paints on a rAF after the artefact resolves.
  await page.waitForTimeout(1500);
}

async function rect(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox();
  return b ? `${sel} ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}` : `${sel} ABSENT`;
}

test('the six frames', async ({ page }) => {
  /* 1 — week scope, the landing frame. */
  await settled(page, '#/');
  await page.screenshot({ path: `${DIR}/final-week-scope.png` });
  console.log('WEEK SCOPE');
  console.log(' ', await rect(page, '.pp-map'));
  for (const s of ['.pp-map__tl', '.pp-map__key', '.pp-map__prov']) {
    console.log('  ', await rect(page, s));
  }
  console.log('  forecast points:', await page.locator('.pp-trace__ghost--forecast').evaluate((p) => (p.getAttribute('d') ?? '').split(/[ML]/).length - 1));
  console.log('  head:', (await page.locator('.pp-weekchart__head').innerText()).replace(/\n/g, ' · '));

  /* 3 — the map chrome on its own, so the three corners are inspectable. */
  await page.locator('.pp-map').screenshot({ path: `${DIR}/final-map-chrome.png` });

  /* 4 — the rails, both at once, in the week frame. */
  await page.locator('.pp-week__col--left').screenshot({ path: `${DIR}/final-rail-left.png` });
  await page.locator('.pp-week__col--right').screenshot({ path: `${DIR}/final-rail-right.png` });
  console.log('  left rail  scroll:', await page.locator('.pp-week__col--left').evaluate((e) => `${e.clientHeight} visible / ${e.scrollHeight} total`));
  console.log('  right rail scroll:', await page.locator('.pp-week__col--right').evaluate((e) => `${e.clientHeight} visible / ${e.scrollHeight} total`));

  /* 6 — an open (i), over the map, showing the popover clears the viewport. */
  await page.locator('.pp-info').first().click();
  await expect(page.locator('.pp-info__pop')).toHaveCount(1);
  console.log('  open (i):', await rect(page, '.pp-info__pop'), '| portal parent =', await page.locator('.pp-info__pop').evaluate((e) => e.parentElement?.tagName));
  await page.screenshot({ path: `${DIR}/final-info-open.png` });
  await page.keyboard.press('Escape');

  /* 2 — day scope. */
  await page.locator('.pp-cal__scope .pp-pill', { hasText: 'Day' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/final-day-scope.png` });
  console.log('DAY SCOPE');
  console.log('  head:', (await page.locator('.pp-weekchart__head').innerText()).replace(/\n/g, ' · '));
  console.log('  forecast points:', await page.locator('.pp-trace__ghost--forecast').evaluate((p) => (p.getAttribute('d') ?? '').split(/[ML]/).length - 1));
  console.log('  horizon marks:', await page.locator('.pp-trace__horizon').count(), '| wash rects:', await page.locator('.pp-trace__unknown').count());
  for (const s of ['.pp-map__tl', '.pp-map__key', '.pp-map__prov']) {
    console.log('  ', await rect(page, s));
  }
  await page.locator('.pp-cal__scope .pp-pill', { hasText: 'Week' }).click();

  /* 5 — streets, with a row expanded. */
  await settled(page, '#/streets');
  await page.locator('.pp-st__chev').first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/final-streets-expanded.png` });
  console.log('STREETS');
  console.log('  child rows:', await page.locator('.pp-st__row--child, tr.pp-st__child').count());
  console.log('  per-child (i):', await page.locator('.pp-st__caveat .pp-info').count());
  console.log('  horizon marks in rows:', await page.locator('.pp-streets .pp-trace__horizon').count());
});
