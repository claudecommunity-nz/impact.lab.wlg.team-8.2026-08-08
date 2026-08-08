/**
 * Verification for the final UI pass: the four contradictions fixed at 15:00.
 *
 * Headed, like the other shot specs — headless Chromium composites MapLibre's
 * canvas but not deck.gl's, so a headless map frame is a basemap with no edges.
 * Assertions here are on TEXT and BOX GEOMETRY, both of which are true headless
 * too; the headed run is so the screenshots show the instrument.
 */

import { test, expect, type Page } from '@playwright/test';

test.use({ headless: false });
test.describe.configure({ timeout: 180_000 });

const DIR = 'e2e/shots';

async function settled(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(page.locator('.pp-cal__chip')).toHaveCount(7);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
}

/* 1 — the landing modal now shows a scroll edge instead of a sliced line. */
test('the modal body has a sticky fade at its scroll edge', async ({ page }) => {
  // The shared storageState marks the landing as seen so every other spec
  // starts past it; this is the one spec that wants it.
  await page.addInitScript(() => window.localStorage.removeItem('pp:seen-landing'));
  await page.goto('/#/');
  const body = page.locator('.pp-modal__body');
  await expect(body).toHaveCount(1);
  await page.waitForTimeout(600);

  const m = await body.evaluate((e) => {
    const a = getComputedStyle(e, '::after');
    return {
      overflows: e.scrollHeight > e.clientHeight,
      client: e.clientHeight,
      scroll: e.scrollHeight,
      position: a.position,
      height: a.height,
      image: a.backgroundImage,
      events: a.pointerEvents,
    };
  });
  console.log('MODAL', JSON.stringify(m));

  // The fade only earns its place if there is something below the fold.
  expect(m.overflows).toBe(true);
  expect(m.position).toBe('sticky');
  expect(m.image).toContain('gradient');
  expect(m.events).toBe('none');

  await page.screenshot({ path: `${DIR}/uipass-modal-fade.png` });

  // Scrolling to the end must actually reach the end — the proof the negative
  // margin worked, since a pseudo-element that added height could not.
  await body.evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await page.waitForTimeout(400);
  const atEnd = await body.evaluate(
    (e) => Math.abs(e.scrollTop + e.clientHeight - e.scrollHeight) < 2,
  );
  expect(atEnd).toBe(true);

  // At full scroll the gradient must rest on empty space, NOT over the last
  // line. That line is the not-live / call-111 statement, so a fade sitting on
  // it is an honesty regression, not a cosmetic one. The first version of this
  // rule used a negative margin and did exactly that.
  const clear = await body.evaluate((e) => {
    const fade = parseFloat(getComputedStyle(e, '::after').height);
    const fadeTop = e.getBoundingClientRect().bottom - fade;
    const last = [...e.querySelectorAll('*')]
      .filter((n) => /call 111/i.test(n.textContent ?? '') && n.children.length === 0)
      .pop();
    const text = (last ?? e).getBoundingClientRect();
    return { fadeTop, textBottom: text.bottom, overlap: text.bottom - fadeTop };
  });
  console.log('MODAL@end', JSON.stringify(clear));
  // 1px, not 0: the measured box bottom is the line BOX, which carries
  // half-leading below the descender, so it lands ~0.09px into the fade at a
  // 2x device pixel ratio. The glyphs themselves are clear.
  expect(clear.overlap).toBeLessThan(1);

  await page.screenshot({ path: `${DIR}/uipass-modal-scrolled.png` });
});

/* 2 — one noun, two scopes, now distinguishable. */
test('the map provenance figure states its scope', async ({ page }) => {
  await settled(page, '#/');
  const prov = (await page.locator('.pp-map__prov').innerText()).replace(/\n/g, ' · ');
  console.log('PROV', prov);
  expect(prov).toContain('this week');
  expect(prov).toMatch(/camera sites on \d+ edges this week/);
  await page.locator('.pp-map').screenshot({ path: `${DIR}/uipass-map-prov.png` });
});

/* 3 — the two clocks on Streets no longer disagree. */
test('the streets scrubber clock is hour-only and week keeps its day', async ({ page }) => {
  await settled(page, '#/');

  // The exact repro from the finding: settle the week cursor on a day that is
  // NOT the newest confirmed one, then cross to Streets.
  await page.locator('.pp-cal__chip', { hasText: 'Sat' }).click();
  await page.waitForTimeout(500);
  const weekClock = (await page.locator('.pp-weekchart__clock').innerText()).trim();
  console.log('WEEK clock', JSON.stringify(weekClock));
  expect(weekClock).toMatch(/^[A-Za-z]{3}\s+\d+\s+\d{2}:00$/); // day retained here

  await page.locator('.pp-bar__tab', { hasText: 'Streets' }).click();
  await page.waitForTimeout(1200);
  const streetsClock = (await page.locator('.pp-weekchart__clock').innerText()).trim();
  const stamp = (await page.locator('.pp-bar').innerText()).replace(/\n/g, ' · ');
  console.log('STREETS clock', JSON.stringify(streetsClock), '| bar', stamp);

  // Hour only: no weekday token anywhere in the big clock.
  expect(streetsClock).toMatch(/^\d{2}:00$/);
  expect(streetsClock).not.toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/i);
  await page.screenshot({ path: `${DIR}/uipass-streets-clock.png` });

  // AREAS is also chart-less but its header stamp DOES follow the cursor day,
  // so the day must survive there. This is the regression the narrower gate
  // exists to prevent.
  await page.locator('.pp-bar__tab', { hasText: 'Areas' }).click();
  await page.waitForTimeout(1200);
  const areasClock = (await page.locator('.pp-weekchart__clock').innerText()).trim();
  console.log('AREAS clock', JSON.stringify(areasClock));
  expect(areasClock).toMatch(/^[A-Za-z]{3}\s+\d+\s+\d{2}:00$/);
});

/* 4 — no judged count asserted for an hour that has not happened. */
test('the area risk subtitle drops the judged count beyond the horizon', async ({ page }) => {
  await settled(page, '#/');
  const card = page.locator('.pp-panel', { hasText: 'Movement inside a risk area' }).first();
  const sub = card.locator('.pp-panel__subtitle').first();

  const before = (await sub.innerText()).trim();
  console.log('AREA subtitle @settled', JSON.stringify(before));
  expect(before).toContain('judgeable');

  // Past the confirmed horizon (96) — a day that has not happened.
  const range = page.locator('.pp-weekchart__range');
  await range.evaluate((e: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(e, '120');
    e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(900);

  const after = (await sub.innerText()).trim();
  const body = (await card.innerText()).replace(/\n/g, ' · ');
  console.log('AREA subtitle @beyond', JSON.stringify(after));
  console.log('AREA body   @beyond', body.slice(0, 200));

  // The subtitle must no longer assert a count, while the body still explains.
  expect(after).not.toContain('judgeable');
  expect(after).not.toMatch(/\d+ of \d+ areas/);
  expect(body).toMatch(/Beyond the confirmed feed|no zone is scored/i);
  await page.locator('.pp-week__col--right').screenshot({ path: `${DIR}/uipass-area-beyond.png` });
});
