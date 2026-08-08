/**
 * The final integration pass — four tracks merged into one app, asserted.
 *
 * app.spec.ts guards the seams that broke during the build. This file guards
 * the three things a judge can see going wrong on the projector, and that no
 * unit test can reach:
 *
 *   1. the map's overlay boxes overlapping each other,
 *   2. an (i) popover opening half off screen, or refusing to close,
 *   3. a red console — in particular the nested-<button> hydration error that
 *      an (i) in a collapsible Panel's header produces.
 *
 * Everything is measured with getBoundingClientRect and asserted. Nothing here
 * is a pixel diff, so a WebGL driver change cannot fail it.
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/** Same list as app.spec.ts — basemap glyph ranges and headless GL chatter. */
const IGNORED_CONSOLE = [/glyph/i, /SwiftShader/i, /WebGL/i, /Download the React DevTools/i];

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (IGNORED_CONSOLE.some((re) => re.test(m.text()))) return;
    errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/**
 * Past the calendar AND past the last fetch.
 *
 * `toHaveCount(7)` on the chips only proves week.json landed. The feed roster
 * and the area-risk card arrive on later requests and bring three more (i)
 * badges with them, so a badge audit that counted at chip-time enumerated two
 * of five and then indexed into a DOM that had grown underneath it. Waiting for
 * networkidle is the difference between auditing the app and auditing a
 * half-rendered frame of it.
 */
async function gotoSettled(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(page.locator('.pp-cal__chip')).toHaveCount(7);
  await page.waitForLoadState('networkidle');
}

const gotoWeek = (page: Page) => gotoSettled(page, '#/');

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(page: Page, sel: string): Promise<Box> {
  const box = await page.locator(sel).first().boundingBox();
  expect(box, `${sel} has no box`).not.toBeNull();
  return box!;
}

/* ------------------------------------------------------- map overlay grid */

test('no two map overlays intersect, in any state the demo reaches', async ({ page }) => {
  const errors = watchConsole(page);
  await gotoWeek(page);

  const SELECTORS = ['.pp-map__tl', '.pp-map__key', '.pp-map__prov'];

  /** Every overlay inside the map, and none of them touching. Reported as one
   *  list so a failure names which pair collided in which state. */
  const check = async (state: string) => {
    const map = await boxOf(page, '.pp-map');
    const boxes: Array<[string, Box]> = [];
    for (const sel of SELECTORS) boxes.push([sel, await boxOf(page, sel)]);

    for (const [sel, b] of boxes) {
      expect(b.x, `${sel} left of map in ${state}`).toBeGreaterThanOrEqual(map.x - 1);
      expect(b.y, `${sel} above map in ${state}`).toBeGreaterThanOrEqual(map.y - 1);
      expect(b.x + b.width, `${sel} past map right in ${state}`).toBeLessThanOrEqual(
        map.x + map.width + 1,
      );
      expect(b.y + b.height, `${sel} past map bottom in ${state}`).toBeLessThanOrEqual(
        map.y + map.height + 1,
      );
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(
          intersects(boxes[i][1], boxes[j][1]),
          `${boxes[i][0]} x ${boxes[j][0]} in ${state}`,
        ).toBe(false);
      }
    }
  };

  await check('week scope, landing');

  // Day scope re-lays the strip above the map; the map box changes height with
  // it, so the inset grid has to hold at the new size too.
  await page.locator('.pp-cal__scope .pp-pill', { hasText: 'Day' }).click();
  await check('day scope');
  await page.locator('.pp-cal__scope .pp-pill', { hasText: 'Week' }).click();

  // The one state that DID collide during the build: the key's "how to read"
  // disclosure opening over the provenance block.
  const more = page.locator('.pp-map__more').first();
  await more.locator('summary').click();
  await expect(more).toHaveJSProperty('open', true);
  await check('how-to-read open');
  const body = await boxOf(page, '.pp-map__more-body');
  const prov = await boxOf(page, '.pp-map__prov');
  expect(intersects(body, prov), 'how-to-read body x provenance').toBe(false);
  await more.locator('summary').click();

  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------ the (i) badges */

/**
 * Opens every visible (i) on the page and asserts the popover lands wholly
 * inside the viewport and dies on Escape.
 *
 * The popover is `position: fixed` — deliberately, to escape the rails'
 * overflow clipping — which means nothing but this measurement can tell you it
 * is on screen.
 */
async function auditBadges(page: Page, where: string) {
  const badges = page.locator('.pp-info');
  const n = await badges.count();
  expect(n, `no (i) badges found on ${where}`).toBeGreaterThan(0);
  const vp = page.viewportSize()!;
  let checked = 0;

  for (let i = 0; i < n; i++) {
    const b = badges.nth(i);
    if (!(await b.isVisible())) continue;
    // Scroll, then let it STOP before clicking. InfoBadge dismisses on scroll
    // on purpose — it is `position: fixed` and cannot follow a scrolling
    // ancestor — so clicking into the tail of a smooth scroll opens the
    // popover and the same gesture closes it again. That is the automation
    // racing the design, not a bug in it; a person clicks a badge that is
    // already still.
    await b.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await b.click();
    const pop = page.locator('.pp-info__pop');
    await expect(pop, `${where} badge ${i} did not open`).toHaveCount(1);
    const box = (await pop.boundingBox())!;
    expect(box, `${where} badge ${i} popover box`).not.toBeNull();
    expect(box.x, `${where} badge ${i} off left`).toBeGreaterThanOrEqual(0);
    expect(box.y, `${where} badge ${i} off top`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${where} badge ${i} off right`).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height, `${where} badge ${i} off bottom`).toBeLessThanOrEqual(vp.height);
    // The prose behind the (i) is the honesty copy — an empty popover would
    // mean a sentence was lost in the move, which is the failure mode the
    // house rules call out by name.
    expect((await pop.innerText()).trim().length, `${where} badge ${i} is empty`).toBeGreaterThan(
      20,
    );
    await page.keyboard.press('Escape');
    await expect(pop, `${where} badge ${i} survived Escape`).toHaveCount(0);
    checked++;
  }
  expect(checked, `no visible (i) on ${where}`).toBeGreaterThan(0);
  return checked;
}

/** Nested buttons are invalid HTML; React logs a hydration error and the inner
 *  control stops being clickable. It happened once with an (i) in a collapsible
 *  Panel's <button> head, so it is asserted structurally, not just via console. */
async function assertNoNestedButtons(page: Page, where: string) {
  const nested = await page.evaluate(() => document.querySelectorAll('button button').length);
  expect(nested, `nested <button> on ${where}`).toBe(0);
}

// Each badge click waits for actionability against a canvas that repaints every
// frame, so ~3s per badge is normal and the default 30s does not cover twenty.
test.describe.configure({ timeout: 180_000 });

test('every (i) opens fully inside the viewport and closes on Escape', async ({ page }) => {
  const errors = watchConsole(page);

  await gotoWeek(page);
  await assertNoNestedButtons(page, 'week');
  const weekClosed = await auditBadges(page, 'week');

  // With the collapsibles OPEN: this is the state that hides both a clipped
  // popover in a scrolled rail and an (i) that got put in a collapsible head.
  const collapsibles = page.locator('[data-collapsible="true"]');
  const c = await collapsibles.count();
  for (let i = 0; i < c; i++) {
    const head = collapsibles.nth(i);
    if (await head.isVisible()) await head.click();
  }
  await assertNoNestedButtons(page, 'week, collapsibles expanded');
  const weekOpen = await auditBadges(page, 'week, collapsibles expanded');
  expect(weekOpen).toBeGreaterThanOrEqual(weekClosed);

  await gotoSettled(page, '#/streets');
  await expect(page.locator('.pp-st__chev').first()).toBeVisible();
  await page.locator('.pp-st__chev').first().click();
  await expect(page.locator('.pp-st__chev').first()).toHaveAttribute('data-open', 'true');
  await assertNoNestedButtons(page, 'streets, row expanded');
  await auditBadges(page, 'streets, row expanded');

  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------ console walk */

test('a full walk of the demo leaves the console clean', async ({ page }) => {
  const errors = watchConsole(page);
  await gotoWeek(page);

  // Week scope, across the horizon: the wash, the horizon rule and the day
  // banding all re-derive on every seek, and a bad index shows up as NaN in an
  // SVG attribute rather than as a thrown error.
  for (const h of ['9', '60', '95', '120', '167']) {
    await page.locator('.pp-weekchart__range').fill(h);
  }

  // Day scope: a settled day (24 of 24, no horizon mark) and a day that has
  // not happened (0 of 24, wash across the whole chart).
  await page.locator('.pp-cal__scope .pp-pill', { hasText: 'Day' }).click();
  await expect(page.locator('.pp-weekchart__head')).toContainText('24 hourly slots');
  await page.locator('.pp-cal__chip[data-date="2026-08-08"]').click();
  await page.locator('.pp-cal__chip[data-date="2026-08-06"]').click();
  await page.locator('.pp-cal__scope .pp-pill', { hasText: 'Week' }).click();

  // Mode pills re-key every series in the app at once. `car`, not `vehicle` —
  // the pill READS "Vehicles" and its value is the sensor class.
  for (const mode of ['pedestrian', 'car', 'all']) {
    await page.locator(`.pp-cal__modes .pp-pill[data-mode="${mode}"]`).click();
  }

  await gotoSettled(page, '#/streets');
  await page.locator('.pp-st__chev').first().click();
  await gotoWeek(page);

  // No SVG geometry may carry NaN: one NaN in a `d` makes the browser discard
  // the whole path silently, so a trace can vanish with a clean console.
  const nans = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll('svg *'))) {
      for (const a of Array.from(el.attributes)) {
        if (a.value.includes('NaN')) bad.push(`${el.tagName}.${a.name}`);
      }
    }
    return bad;
  });
  expect(nans).toEqual([]);

  expect(errors).toEqual([]);
});
