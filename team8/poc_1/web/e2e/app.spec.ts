/**
 * The integration gate. Six agents built these bands separately and every bug
 * that actually reached the screen this morning was a SEAM bug — a popover
 * clipped by a parent's overflow, a cursor that two components disagreed about,
 * a route that changed the map but not the date. None of them are visible in a
 * typecheck, so they are tested here against a real browser at the demo size.
 *
 * Assertions are behavioural, never pixel-exact. A screenshot diff on a map
 * that renders through WebGL would fail on a driver update and teach us to
 * ignore the suite.
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Third-party noise, listed one message at a time on purpose. A broad filter
 * here would be a way of not noticing our own errors, which is the opposite of
 * what this file is for.
 *
 *   glyph / SwiftShader / WebGL   MapLibre's missing glyph range for Māori
 *                                 diacritics on the CARTO basemap, plus driver
 *                                 chatter from the headless GL implementation.
 *
 * There was briefly a fourth entry here for deck.gl's
 * `Binding weightsTexture not set`, emitted by HeatmapLayer's GPU aggregation.
 * The heat layer was reimplemented on additively blended ScatterplotLayers and
 * the warning went with it, so the filter is gone too — a suppression for a
 * message that can no longer occur is just a place for a real regression to
 * hide later.
 */
const IGNORED_CONSOLE = [
  /glyph/i,
  /SwiftShader/i,
  /WebGL/i,
  /Download the React DevTools/i,
];

/** Attaches a console watcher and returns the collected errors. Every spec
 *  calls this, because "the feature works but the console is red" is a demo
 *  failure the judges can see if anyone opens devtools. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(`${m.type()}: ${text}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** The week artefact is fetched once above the shell; every assertion below is
 *  meaningless until the calendar has its seven real chips. */
async function gotoWeek(page: Page) {
  await page.goto('/#/');
  await expect(page.locator('.pp-cal__chip')).toHaveCount(7);
}

test('tabs switch between the week and the streets', async ({ page }) => {
  const errors = watchConsole(page);
  await gotoWeek(page);

  await expect(page.locator('.pp-shell')).toHaveAttribute('data-route', 'week');
  await expect(page.locator('.pp-shell__stage--week')).toBeVisible();

  await page.locator('.pp-bar__tab', { hasText: 'Streets' }).click();
  await expect(page.locator('.pp-shell')).toHaveAttribute('data-route', 'streets');
  await expect(page.locator('.pp-shell__stage--table')).toBeVisible();
  // The tab that reads as current has to follow the route, or the judge cannot
  // tell which screen they are on.
  await expect(page.locator('.pp-bar__tab[data-active="true"]')).toHaveText('Streets');

  await page.locator('.pp-bar__tab', { hasText: 'Week' }).click();
  await expect(page.locator('.pp-shell')).toHaveAttribute('data-route', 'week');

  expect(errors).toEqual([]);
});

test('the calendar chips move the week cursor', async ({ page }) => {
  const errors = watchConsole(page);
  await gotoWeek(page);

  // Landing is Thu 09:00. The clock is the shared readout the chart, the map
  // stamp and the top bar all derive from, so it is the honest thing to assert.
  const clock = page.locator('.pp-weekchart__clock');
  await expect(clock).toContainText('THU');

  await page.locator('.pp-cal__chip[data-date="2026-08-03"]').click();
  await expect(clock).toContainText('MON');
  // The hour of day must survive a day change: the chip means "same time,
  // different day", and resetting to 00:00 would silently move the cursor.
  await expect(clock).toContainText('09:00');
  await expect(page.locator('.pp-cal__chip[data-date="2026-08-03"]')).toHaveAttribute(
    'data-selected',
    'true',
  );

  // A forecast day is reachable and must not pretend to be a measurement.
  await page.locator('.pp-cal__chip[data-date="2026-08-09"]').click();
  await expect(clock).toContainText('SUN');
  await expect(page.locator('.pp-cal__chip[data-date="2026-08-09"]')).toHaveAttribute(
    'data-state',
    'forecast',
  );

  expect(errors).toEqual([]);
});

test('the scrubber fills the actual line and stops at the feed horizon', async ({ page }) => {
  const errors = watchConsole(page);
  await gotoWeek(page);

  const range = page.locator('.pp-weekchart__range');
  const actual = page.locator('.pp-trace__actual').first();

  // The actual line is drawn only up to min(cursor, horizon), so the length of
  // its path data is a direct proxy for how much of the week has been replayed.
  const dAt = async (hour: number) => {
    await range.fill(String(hour));
    await expect(page.locator('.pp-weekchart__clock')).toBeVisible();
    const d = await actual.getAttribute('d');
    expect(d, `actual path at h=${hour}`).toBeTruthy();
    expect(d).not.toContain('NaN');
    return d!.length;
  };

  const early = await dAt(9);
  const mid = await dAt(60);
  const late = await dAt(100);

  expect(mid).toBeGreaterThan(early);
  // Past index 95 there is no actual and never will be until the feed catches
  // up. The line must STOP, not keep drawing — this is the honesty assertion.
  const atHorizon = await dAt(95);
  expect(late).toBe(atHorizon);

  // ...while the forecast keeps going across the whole week, dashed.
  await expect(page.locator('.pp-trace__ghost--forecast')).toHaveCount(1);
  await expect(page.locator('.pp-trace__unknown')).toBeVisible();

  expect(errors).toEqual([]);
});

test('every disclosure opens and closes', async ({ page }) => {
  const errors = watchConsole(page);

  for (const route of ['#/', '#/streets']) {
    await page.goto(`/${route}`);
    await expect(page.locator('.pp-cal__chip')).toHaveCount(7);

    const details = page.locator('details');
    const n = await details.count();
    expect(n, `no disclosures found on ${route}`).toBeGreaterThan(0);

    for (let i = 0; i < n; i++) {
      const d = details.nth(i);
      if (!(await d.isVisible())) continue;
      const summary = d.locator('summary').first();
      await summary.click();
      await expect(d).toHaveJSProperty('open', true);
      await summary.click();
      await expect(d).toHaveJSProperty('open', false);
    }
  }

  expect(errors).toEqual([]);
});

test('the Context popover is fully visible over the map', async ({ page }) => {
  const errors = watchConsole(page);
  // The context layers live on the replay route's control bar — that is the
  // only screen with a full-bleed map underneath them.
  await page.goto('/#/replay');

  const trigger = page.locator('.pp-pill', { hasText: 'Context' });
  await trigger.click();

  const panel = page.locator('.pp-pop__panel');
  await expect(panel).toBeVisible();

  // The bug this guards: the control row is a scroll container in both axes and
  // clipped the panel to a sliver. `position: fixed` fixed it — assert the box
  // is actually inside the viewport rather than trusting the CSS.
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  const vp = page.viewportSize()!;
  expect(box!.width).toBeGreaterThan(160);
  expect(box!.height).toBeGreaterThan(80);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);

  // And it closes on Escape, so it never sits over the map during a demo.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('the mode pills reselect the series the map is coloured by', async ({ page }) => {
  const errors = watchConsole(page);
  await gotoWeek(page);

  const pill = (mode: string) => page.locator(`.pp-cal__modes .pp-pill[data-mode="${mode}"]`);
  await expect(pill('all')).toHaveAttribute('aria-pressed', 'true');

  // The map stamp recomputes its citywide sentence from the selected series, so
  // a changed headline is evidence the pill reached the layer and not just the
  // pill's own aria state.
  const stamp = page.locator('.pp-map__stamp-line');
  const before = await stamp.textContent();

  await pill('pedestrian').click();
  await expect(pill('pedestrian')).toHaveAttribute('aria-pressed', 'true');
  await expect(stamp).not.toHaveText(before ?? '');

  // The calendar reads the same series — one mode, not one per band.
  const chip = page.locator('.pp-cal__chip[data-date="2026-08-04"] .pp-cal__value');
  const peopleValue = await chip.textContent();
  await pill('car').click();
  await expect(chip).not.toHaveText(peopleValue ?? '');

  expect(errors).toEqual([]);
});

test('leaving the replay route restores a week the map can draw', async ({ page }) => {
  const errors = watchConsole(page);
  await gotoWeek(page);

  // Replay drives `date` to Oct 2025. Hash routing changes the route and
  // nothing else, so without a reconcile the week map came back gated and the
  // one tab where flow is the product had no flow layer on it. Clicking the
  // storm day is what actually moves the date — the route alone does not.
  await page.goto('/#/replay');
  await expect(page.locator('.pp-shell')).toHaveAttribute('data-route', 'replay');
  const storm = page.locator('.pp-pill--day[data-date="2025-10-23"]');
  await storm.click();
  await expect(storm).toHaveAttribute('data-active', 'true');

  await page.goto('/#/');
  await expect(page.locator('.pp-cal__chip')).toHaveCount(7);
  await expect(page.locator('.pp-map__stamp-line')).not.toContainText('No flow layer');

  expect(errors).toEqual([]);
});
