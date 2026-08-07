import { useEffect, useState } from 'react';
import { Button, Modal } from '../ui';
import { landing, honesty } from '../copy/strings';
import { useDispatch } from '../state/app';
import { useData } from '../data/DataProvider';

const SEEN_KEY = 'pp:seen-landing';
const EVENT_DATE = '2025-10-23';

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Opens on first visit and from the ? in the top bar. Layered so a duty officer
 * can read four lines and start, while anyone who wants the method can open it.
 */
export function LandingModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dispatch = useDispatch();
  const { manifest } = useData();

  const start = () => {
    dispatch({ type: 'SET_DATE', date: EVENT_DATE });
    dispatch({ type: 'SEEK', hour: 5 });
    dispatch({ type: 'PLAY' });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={landing.title}
      hideTitle
      width={720}
      footer={
        <>
          <Button variant="primary" onClick={start}>
            {landing.cta}
          </Button>
          {/* Both required statements, pinned beside the CTA. They were inside
              a collapsed <details> and at the very bottom of a scrolling body,
              which put them off-screen entirely in the screenshot everyone
              shares. A limitation below the fold is a limitation nobody read. */}
          <span className="pp-landing__pin pp-t-caption">{landing.footerNote}</span>
          <span className="pp-t-caption pp-c-muted pp-landing__ctanote">{landing.ctaNote}</span>
          <Button variant="ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>
            {landing.dismiss}
          </Button>
        </>
      }
    >
      <p className="pp-t-label pp-c-muted pp-landing__eyebrow">{landing.eyebrow}</p>
      <h1 className="pp-landing__title">{landing.title}</h1>
      <p className="pp-t-body-lg pp-landing__lede">{landing.lede}</p>

      <section className="pp-landing__section">
        <h2 className="pp-t-label pp-c-muted">{landing.forOfficer.heading}</h2>
        <ul className="pp-landing__list">
          {landing.forOfficer.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>

      <details className="pp-landing__details">
        <summary>{landing.howItWorks.heading}</summary>
        <p>{landing.howItWorks.body}</p>
        <p>{landing.howItWorks.controls}</p>
      </details>

      <details className="pp-landing__details">
        <summary>{landing.limits.heading}</summary>
        <ul className="pp-landing__list">
          {landing.limits.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </details>

      <details className="pp-landing__details">
        <summary>Where the data comes from</summary>
        <p className="pp-t-caption">
          {manifest
            ? `${manifest.attribution.movement}. ${manifest.attribution.gis} Basemap ${manifest.attribution.basemap}.`
            : honesty.attribution}
        </p>
        {manifest && (
          <p className="pp-t-caption pp-c-muted">
            Built {manifest.built_at.slice(0, 10)} · newest movement data{' '}
            {manifest.data_vintage.movement_latest_date} · feed lag{' '}
            {manifest.data_vintage.feed_lag}
          </p>
        )}
      </details>

      <p className="pp-t-caption pp-landing__emergency">{honesty.emergency}</p>
    </Modal>
  );
}

/** First-visit state, kept out of the global reducer — it is not app state. */
export function useLanding() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!seen()) setOpen(true);
  }, []);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* private browsing; it just reopens next time */
    }
  };

  return { open, close, reopen: () => setOpen(true) };
}
