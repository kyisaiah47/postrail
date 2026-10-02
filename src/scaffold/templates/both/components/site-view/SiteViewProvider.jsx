'use client';

/* WHICH VIEW THIS VISITOR IS READING: Console or Simple.
 *
 * Console is the clean-visitor default. A valid ?view=simple|console wins over the saved choice,
 * and an explicit choice is saved. Only the preference goes to localStorage. */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Welcome from './Welcome';

export const VIEW_KEY = 'postrail:view';
export const WELCOME_OFF_KEY = 'postrail:welcome-off';
export const WELCOME_EVENT = 'postrail:welcome';

const Context = createContext(null);
export const useSiteView = () => useContext(Context);

function readSaved() {
  try { return localStorage.getItem(VIEW_KEY) === 'simple' ? 'simple' : 'console'; } catch { return 'console'; }
}

export default function SiteViewProvider({ example, children }) {
  const [view, setView] = useState('console');

  const choose = useCallback((next) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* a blocked store never breaks the switch */ }
    const url = new URL(window.location.href);
    if (url.searchParams.has('view')) {
      url.searchParams.set('view', next);
      window.history.replaceState(window.history.state, '', url.href);
    }
  }, []);

  useEffect(() => {
    const explicit = new URLSearchParams(window.location.search).get('view');
    if (explicit === 'simple' || explicit === 'console') choose(explicit);
    else setView(readSaved());
  }, [choose]);

  useEffect(() => { document.documentElement.dataset.view = view; }, [view]);

  const welcome = useCallback(() => window.dispatchEvent(new Event(WELCOME_EVENT)), []);

  return (
    <Context.Provider value={{ view, choose, welcome }}>
      {children}
      <Welcome example={example} />
    </Context.Provider>
  );
}
