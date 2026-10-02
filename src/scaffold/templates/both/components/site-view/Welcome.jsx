'use client';

/* START HERE. What PostRail does, one labelled illustration of a real slot and the post it
 * became, and the choice of view. Opens by itself on a first visit unless the visitor turned it
 * off or ?welcome=0 is present. Closing or choosing never turns it off; the checkbox does. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSiteView, WELCOME_EVENT, WELCOME_OFF_KEY } from './SiteViewProvider';

function readOff() {
  try { return localStorage.getItem(WELCOME_OFF_KEY) === '1'; } catch { return false; }
}

export default function Welcome({ example }) {
  const mode = useSiteView();
  const dialog = useRef(null);
  const timer = useRef(null);
  const previous = useRef(null);
  const [off, setOff] = useState(false);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOff(readOff());
    const el = dialog.current;
    if (!el) return;
    setMounted(true);
    if (!el.open) { previous.current = document.activeElement; el.showModal(); }
    requestAnimationFrame(() => {
      setVisible(true);
      if (!el.contains(document.activeElement) || document.activeElement === el) el.querySelector('.sv-welcome-top > button')?.focus();
    });
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    if (timer.current) clearTimeout(timer.current);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current = setTimeout(() => {
      dialog.current?.close();
      setMounted(false);
      const back = previous.current;
      if (back && back.isConnected && back !== document.body) back.focus();
    }, reduced ? 0 : 220);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!readOff() && q.get('welcome') !== '0') show();
    window.addEventListener(WELCOME_EVENT, show);
    return () => {
      window.removeEventListener(WELCOME_EVENT, show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [show]);

  function select(view) { mode?.choose(view); close(); }

  return (
    <dialog
      ref={dialog}
      className="sv-welcome"
      data-visible={visible}
      aria-labelledby="sv-welcome-title"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === dialog.current) close(); }}
    >
      {mounted ? (
        <>
          <header className="sv-welcome-top">
            <span className="sv-welcome-brand">PostRail <small>Start here</small></span>
            <button type="button" aria-label="Close welcome" onClick={close}>&times;</button>
          </header>
          <div className="sv-welcome-intro">
            <h2 id="sv-welcome-title">What will your accounts post today?</h2>
            <p>
              PostRail plans a day of posts for each account, writes each one with your own model when it comes due, and
              sends it through the platform&rsquo;s own API. This page shows the day&rsquo;s plan and what already went out.
            </p>
          </div>
          <section className="sv-illustration" aria-label="Illustration of one slot">
            <p className="sv-illustration-label">{example.real ? 'One slot from your ledger' : 'Illustration'}</p>
            <p>At {example.time}, {example.account} posted this {example.kind} post.</p>
            <blockquote>{example.text}</blockquote>
          </section>
          <section className="sv-welcome-choose">
            <h3>How would you like to read it?</h3>
            <p>You can switch anytime.</p>
            <div className="sv-choices">
              <button type="button" onClick={() => select('console')}>
                <b>Console</b>
                <strong>See more at once.</strong>
                <span>Every account, slot and post in one dense table.</span>
              </button>
              <button type="button" onClick={() => select('simple')}>
                <b>Simple</b>
                <strong>Start with the essentials.</strong>
                <span>One card per account, with details you can open as you go.</span>
              </button>
            </div>
          </section>
          <footer>
            <label>
              <input
                type="checkbox"
                checked={off}
                onChange={(e) => {
                  setOff(e.target.checked);
                  try {
                    if (e.target.checked) localStorage.setItem(WELCOME_OFF_KEY, '1');
                    else localStorage.removeItem(WELCOME_OFF_KEY);
                  } catch { /* the choice lasts this visit */ }
                }}
              />
              Don&rsquo;t open this when I come back
            </label>
          </footer>
        </>
      ) : null}
    </dialog>
  );
}
