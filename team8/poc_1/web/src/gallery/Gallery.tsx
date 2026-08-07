import { useState } from 'react';
import { ThemeScope, useTheme } from '../theme/ThemeProvider';
import { COLOR_TOKENS, PALETTE_NAMES, type ColorToken } from '../theme/palettes';
import { cssColor } from '../theme/color';
import { tokens, type TypeToken } from '../theme/foundations';
import { DIAGNOSIS, honesty, MODE_TOKEN, signedPct } from '../copy/strings';
import { DiagnosisCode, MODES } from '../data/types';
import {
  Callout,
  DiagnosisChip,
  Legend,
  Panel,
  Scrubber,
  StatTile,
  Toggle,
  TwinDotGlyph,
  VitalsTrace,
  formatHour,
} from '../ui';
import { PaletteSwitcher } from './PaletteSwitcher';
import './gallery.css';

/**
 * Every component, in every palette, with no data pipeline attached.
 * All numbers below are SYNTHETIC placeholders shaped like the real ones —
 * this page proves the design, it does not report on Wellington.
 */
export function Gallery() {
  return (
    <div className="pp-gallery">
      <header className="pp-gallery__head">
        <h1 className="pp-t-display">Pōneke Pulse — component gallery</h1>
        <p className="pp-t-body-lg pp-c-secondary">
          Every primitive rendered in both palettes. Numbers here are synthetic. Nothing on this
          page is a measurement.
        </p>
        <a className="pp-t-caption" href="#/">
          ← back to the app shell
        </a>
      </header>

      {PALETTE_NAMES.map((name) => (
        <ThemeScope key={name} palette={name} className="pp-gallery__scope">
          <Specimens />
        </ThemeScope>
      ))}
    </div>
  );
}

function Specimens() {
  const { palette } = useTheme();
  const [hour, setHour] = useState(12);
  const [ghost, setGhost] = useState(true);

  return (
    <div className="pp-gallery__col">
      <div className="pp-gallery__scope-head">
        <h2 className="pp-t-h2">{palette.label}</h2>
        <span className="pp-t-mono-sm pp-c-muted">{palette.scheme}</span>
        <PaletteSwitcher />
      </div>

      <Panel title="Type scale" subtitle="Floor is 13px — nothing smaller survives a projector">
        <div className="pp-stack">
          {(Object.keys(tokens.type) as TypeToken[]).map((t) => (
            <div key={t} className="pp-gallery__typerow">
              <span className="pp-t-mono-sm pp-c-muted">{t}</span>
              <span className={`pp-t-${t}`}>
                {/* A type specimen, not a figure — −43% is the real headline
                    and must not appear on a page that calls itself synthetic. */}
                {t.startsWith('metric') ? '−00%' : 'Thursday 00 Month 0000'}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Colour tokens" subtitle="Authored once as RGB tuples in theme/palettes.ts">
        <div className="pp-gallery__swatches">
          {COLOR_TOKENS.map((t) => (
            <Swatch key={t} token={t} />
          ))}
        </div>
      </Panel>

      <Panel
        title="Percent-change ramp"
        subtitle="Asymmetric domain, Oklab interpolation, 8% dead zone"
        footnote={honesty.deadZone}
      >
        <Legend
          title="Change vs expected"
          scale={{ kind: 'gradient', from: -100, to: 50 }}
          note="Deficit lines sit inside their ghost; surplus lines overflow it. Direction never depends on hue alone."
        />
      </Panel>

      <Panel title="Panels" subtitle="Three tones">
        <div className="pp-stack">
          <Panel title="Default tone" subtitle="graphite and hairlines">
            <p className="pp-t-body pp-c-secondary">Chrome recedes; the map is the lit object.</p>
          </Panel>
          <Panel title="Warn tone" tone="warn" subtitle="degraded coverage" footnote="22 of 24 hours reported.">
            <p className="pp-t-body pp-c-secondary">Still detecting, with the basis stated.</p>
          </Panel>
          <Panel title="Blind tone" tone="blind" subtitle="refuse to panic" collapsible>
            <p className="pp-t-body pp-c-secondary">
              Hatched, frozen, and declining to call it.
            </p>
          </Panel>
        </div>
      </Panel>

      <Panel title="StatTile" subtitle="One number and its honesty">
        <div className="pp-grid-2">
          {/* Round numbers on purpose. This page says its figures are synthetic,
              so it must not carry real Wellington measurements or a real street
              name — a shareable page that disclaims true numbers as fake is the
              honesty problem inverted. */}
          <StatTile
            label="Citywide movement"
            value={800000}
            emphasis="hero"
            delta={{ value: -40, direction: 'down' }}
            basis="synthetic — vs 11 same-weekday days, holidays and partial ingests excluded"
          />
          <StatTile label="Expected" value={1400000} basis="synthetic — baseline median" />
          <StatTile label="Lines reporting" value={350} unit="of 400" />
          <StatTile label="Citywide delta" value={0} state="suppressed" basis="13 of 24 hours reported" />
          <StatTile label="Cars at this line" value={0} state="unknown" basis="footpath counter — no car baseline" />
          <StatTile
            label="Example counter"
            value={1800}
            delta={{ value: 19, direction: 'up' }}
            basis="synthetic — 11 same-weekday days behind it"
          />
        </div>
      </Panel>

      <Panel title="Diagnosis chips" subtitle="Typed by ratio, not by size of change">
        <div className="pp-stack">
          <div className="pp-row">
            {Object.values(DIAGNOSIS).map((d) => (
              <DiagnosisChip key={d.code} code={d.code} confidence={d.code === DiagnosisCode.CANNOT_TYPE ? 0 : 2} />
            ))}
          </div>
          <div className="pp-row">
            {Object.values(DIAGNOSIS).map((d) => (
              <DiagnosisChip key={d.code} code={d.code} confidence={1} compact onClick={() => {}} />
            ))}
          </div>
          <div className="pp-row">
            <TwinDotGlyph pedestrian="filled" vehicle="filled" size={18} />
            <TwinDotGlyph pedestrian="hollow" vehicle="filled" size={18} />
            <TwinDotGlyph pedestrian="struck" vehicle="struck" size={18} />
            <span className="pp-t-caption pp-c-secondary">
              filled = held up · hollow = collapsed · struck = not viable here
            </span>
          </div>
        </div>
      </Panel>

      <Panel title="Legends" subtitle="Driven from tokens; no hand-written swatches">
        <div className="pp-stack">
          <Legend
            title="Observability"
            scale={{
              kind: 'categorical',
              items: [
                { label: 'Sensor silent', token: 'sem-offline', note: 'no row reported — NOT zero traffic', pattern: 'hatch' },
                { label: 'Measured zero', token: 'sem-zero-observed', note: 'row reported, count genuinely 0' },
                { label: 'Mode not viable', token: 'sem-unknown', note: 'cannot compare at this counter' },
                { label: 'Suppressed', token: 'sem-suppressed', note: 'coverage too poor to judge' },
              ],
            }}
            note={honesty.coverage}
          />
          <Legend
            title="Transport modes"
            scale={{
              kind: 'categorical',
              items: MODES.map((m) => ({ label: m, token: MODE_TOKEN[m] })),
            }}
            note="Charts and legends only — never the map line fill."
          />
          <Legend
            title="Pulse"
            scale={{
              kind: 'ramp',
              stops: [
                { label: 'ghost', token: 'sem-ghost' },
                { label: 'calm', token: 'sem-pulse-healthy' },
                { label: 'peak', token: 'sem-pulse-healthy-core' },
                { label: 'deficit', token: 'sem-deficit' },
                { label: 'severe', token: 'sem-deficit-hot' },
              ],
            }}
          />
        </div>
      </Panel>

      <Panel title="Scrubber" subtitle="Hours the feed never delivered are hatched before you play">
        <div className="pp-stack">
          <Scrubber
            min={0}
            max={24}
            step={0.25}
            value={hour}
            onChange={setHour}
            ariaLabel="Hour of day"
            readout={formatHour(hour)}
            marks={[
              { at: 8, label: 'warning', token: 'status-provisional' },
              { at: 18, label: 'expires', token: 'status-provisional' },
            ]}
          />
          <Scrubber
            min={0}
            max={24}
            step={1}
            value={hour}
            onChange={setHour}
            ariaLabel="Hour of day, partial ingest"
            readout={formatHour(hour)}
            unavailable={[
              [0, 5],
              [18, 24],
            ]}
          />
        </div>
      </Panel>

      <Panel title="Toggles" subtitle="Including why a thing is off">
        <div className="pp-stack">
          <Toggle label="Ghost overlay" checked={ghost} onChange={setGhost} hint="the city as it should have been" />
          <Toggle label="Pulse animation" checked onChange={() => {}} hint="global heartbeat, one phase" />
          <Toggle
            label="Diagnosis icons"
            checked={false}
            onChange={() => {}}
            disabled
            disabledReason="no typed anomalies on an unobservable day"
          />
        </div>
      </Panel>

      <Panel title="Callouts" subtitle="The honesty component">
        <div className="pp-stack">
          <Callout intent="info" title="Replay, not live" persistent={false}>
            {honesty.latency}
          </Callout>
          <Callout intent="limitation" title="Hazard planning, not emergency information">
            {honesty.emergency}
          </Callout>
          <Callout intent="refusal" title={honesty.refusalTitle}>
            Only 13 of 24 hours reported on 4 Oct 2025. A naive detector reads this as{' '}
            {signedPct(-64)} citywide. It is a partial ingest, not an event.
          </Callout>
          <Callout intent="limitation" title="Weather warning provenance">
            {honesty.manualWarning}
          </Callout>
        </div>
      </Panel>

      <Panel
        title="VitalsTrace"
        subtitle="Pure SVG. Unreported hours are breaks, never zeros."
        footnote="Synthetic series. The right-hand trace is shaped like a partial ingest, not like a real day."
      >
        <div className="pp-stack">
          <VitalsTrace
            actual={NORMAL}
            expected={EXPECTED}
            band={{ lo: BAND_LO, hi: BAND_HI }}
            cursor={hour}
            onSeek={setHour}
            ariaSummary="Citywide pedestrian volume tracking its expected profile through the day."
          />
          <VitalsTrace
            actual={STORM}
            expected={EXPECTED}
            band={{ lo: BAND_LO, hi: BAND_HI }}
            cursor={hour}
            onSeek={setHour}
            ariaSummary="Observed volume falls far below expected between 08:00 and 18:00, then recovers."
          />
          <VitalsTrace
            actual={PARTIAL}
            expected={EXPECTED}
            gaps={[
              [0, 5],
              [18, 24],
            ]}
            cursor={hour}
            onSeek={setHour}
            ariaSummary="Only 13 hours were reported. The trace is broken across the hours the feed never delivered."
          />
        </div>
      </Panel>
    </div>
  );
}

function Swatch({ token }: { token: ColorToken }) {
  const { palette } = useTheme();
  const [r, g, b] = palette.color[token];
  return (
    <div className="pp-gallery__swatch">
      <span className="pp-gallery__chip" style={{ background: cssColor(token) }} />
      <span className="pp-t-mono-sm">{token}</span>
      <span className="pp-t-mono-sm pp-c-muted">
        {r} {g} {b}
      </span>
    </div>
  );
}

/* --- synthetic series, shaped like the real ones ---------------------- */
const EXPECTED = Float32Array.from([
  6, 4, 3, 3, 5, 14, 38, 72, 100, 84, 70, 74, 82, 76, 70, 74, 88, 96, 70, 44, 30, 22, 15, 9,
]);
const BAND_LO = EXPECTED.map((v) => v * 0.82);
const BAND_HI = EXPECTED.map((v) => v * 1.18);
const NORMAL = EXPECTED.map((v, i) => v * (0.94 + 0.1 * Math.sin(i)));
// pedestrians fall roughly twice as hard as cars, and the gap closes as the warning expires
const STORM = EXPECTED.map((v, i) => (i < 5 ? v * 1.15 : i < 18 ? v * 0.26 : v * 0.7));
const PARTIAL = EXPECTED.map((v, i) => (i >= 5 && i < 18 ? v * 0.98 : 0));
