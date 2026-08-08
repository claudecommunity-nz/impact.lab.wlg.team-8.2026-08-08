/**
 * The demo screenshots, generated rather than hand-taken so they cannot drift
 * from the app. Run with `just poc-shots`; output lands in e2e/shots/.
 *
 * These are NOT assertions — they are the deliverable. Kept out of `poc-check`
 * so the gate does not rewrite a dozen PNGs on every run, and out of the
 * assertion spec so a framing change never fails a build.
 */

import { test, expect, type Page } from '@playwright/test';

const DIR = 'e2e/shots';

/**
 * HEADED, and this is not optional. Headless Chromium composites MapLibre's
 * canvas but not deck.gl's: WebGL2 initialises, the picking pass fires its
 * readPixels, and every screenshot still comes back with a basemap and no
 * edges — a map that looks like the flow layer was never built. The assertion
 * suite stays headless because it reads the DOM, but anything that has to show
 * the instrument has to run in a real window.
 */
test.use({ headless: false });

async function week(page: Page) {
  await page.goto('/#/');
  await expect(page.locator('.pp-cal__chip')).toHaveCount(7);
  // deck.gl paints on a rAF after the artefact resolves; without this the map
  // is an empty canvas in every shot.
  await page.waitForTimeout(1200);
}

async function seek(page: Page, hour: number) {
  await page.locator('.pp-weekchart__range').fill(String(hour));
  await page.waitForTimeout(600);
}

test('week view across the horizon', async ({ page }) => {
  await week(page);
  for (const h of [9, 60, 100]) {
    await seek(page, h);
    await page.screenshot({ path: `${DIR}/week-h${String(h).padStart(3, '0')}.png` });
  }
});

test('the bands, close up', async ({ page }) => {
  await week(page);

  await page.locator('.pp-cal').screenshot({ path: `${DIR}/band-calendar.png` });
  await page.locator('.pp-weekchart').screenshot({ path: `${DIR}/band-weekchart.png` });
  await page.locator('.pp-prov').screenshot({ path: `${DIR}/band-footer.png` });

  // "What to watch" and the area-risk read are the two cards carrying the
  // product thesis, so they are shot on their own as well as in situ.
  //
  // Shot at the PANEL, not at the list inside it. The lists scroll inside a
  // fixed-height rail, and an element screenshot of the <ul> expands to its
  // full scroll height — which produced a tall crop with the week chart
  // bleeding through the bottom of it and the panel's own title missing.
  const card = (inner: string) => page.locator('.pp-panel').filter({ has: page.locator(inner) });
  await card('.pp-watch, .pp-watch__empty').first().screenshot({ path: `${DIR}/card-watch.png` });
  await card('.pp-area').first().screenshot({ path: `${DIR}/card-area-risk.png` });
});

test('the edge map, on a flat hour and an event hour', async ({ page }) => {
  await week(page);

  // Thu 09:00 — citywide on forecast. The network reading.
  await page.locator('.pp-shell__stage--week').screenshot({ path: `${DIR}/map-thu09.png` });

  // Tue 4 Aug 18:00 — the demo frame: −16% citywide, the CBD painted oxblood
  // along recognisable streets.
  await seek(page, 24 + 18);
  await page.locator('.pp-shell__stage--week').screenshot({ path: `${DIR}/map-tue18.png` });

  // Same hour, pedestrians only — the per-mode signature the thesis rests on.
  await page.locator('.pp-cal__modes .pp-pill[data-mode="pedestrian"]').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/map-tue18-people.png` });
});

test('the streets tab', async ({ page }) => {
  await week(page);
  await page.locator('.pp-bar__tab', { hasText: 'Streets' }).click();
  await expect(page.locator('.pp-shell__stage--table')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/streets.png` });
});
