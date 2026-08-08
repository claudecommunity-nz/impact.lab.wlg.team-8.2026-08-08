/**
 * The README screenshots, at exactly 1920x1080.
 *
 * Separate from shots.spec.ts because that one shoots the demo projector
 * (1512x900, 2x) and these are documentation images at a fixed 1080p —
 * deviceScaleFactor 1 so the PNG is 1920x1080 on the nose, not 3840x2160.
 *
 * Output lands in e2e/shots/readme/. Run with `just poc-shots-readme`.
 */

import { test, expect, type Page } from '@playwright/test';

const DIR = 'e2e/shots/readme';

// HEADED for the same reason as shots.spec.ts: headless Chromium composites
// MapLibre's canvas but not deck.gl's, so every map shot comes back with a
// basemap and no flow layer.
test.use({
  headless: false,
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});

async function week(page: Page) {
  await page.goto('/#/');
  await expect(page.locator('.pp-cal__chip')).toHaveCount(7);
  // deck.gl paints on a rAF after the artefact resolves.
  await page.waitForTimeout(1500);
}

async function seek(page: Page, hour: number) {
  await page.locator('.pp-weekchart__range').fill(String(hour));
  await page.waitForTimeout(700);
}

test('week', async ({ page }) => {
  await week(page);
  // Tue 4 Aug 18:00 — the frame that shows the instrument doing its job:
  // citywide below forecast, the CBD painted along recognisable streets.
  await seek(page, 24 + 18);
  await page.screenshot({ path: `${DIR}/week.png` });
});

test('streets', async ({ page }) => {
  await week(page);
  await page.locator('.pp-bar__tab', { hasText: 'Streets' }).click();
  await expect(page.locator('.pp-shell__stage--table')).toBeVisible();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/streets.png` });
});

test('areas', async ({ page }) => {
  await page.goto('/#/areas');
  await expect(page.locator('.pp-bar__tab', { hasText: 'Areas' })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${DIR}/areas.png` });
});
