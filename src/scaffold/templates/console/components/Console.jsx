import Link from 'next/link';
import { slotStatus, host } from '@/lib/status';

/* THE CONSOLE. Everything at once: the accounts down the left rail, every slot rolled for today
 * and every recent post and reply in the middle, and the selected account's cadence, caps, mix
 * and halt on the right. The selected account lives in the URL as ?account=. */
export default function Console({ board, selected }) {
  const acct = board.accounts.find((a) => a.id === selected) || board.accounts[0];
  const rolls = board.accounts
    .flatMap((a) => a.slots.map((s) => ({ ...s, account: a })))
    .sort((x, y) => x.atMs - y.atMs);
  return (
    <div className="cx">
      <header className="cx-bar">
        <span className="cx-brand">PostRail</span>
        <span className="mono">{board.date} {board.timezone}</span>
        <span className="cx-bar-note">Replies are {board.repliesOn ? 'on' : 'off'}.</span>
      </header>
      {board.configErrors.length ? (
        <p className="cx-error">The config has problems: {board.configErrors.join(' ')}</p>
      ) : null}
      <div className="cx-grid">
        <nav className="cx-rail" aria-label="Accounts">
          {board.accounts.map((a) => (
            <Link key={a.id} href={`/?account=${encodeURIComponent(a.id)}`} aria-current={a.id === acct?.id ? 'page' : undefined}>
              <span className="cx-rail-name">{a.handle}</span>
              <span className="cx-rail-sub">
                {a.platform} · {a.posted} of {a.slots.length} posted{a.owed ? ` · ${a.owed} owed` : ''}
              </span>
              {a.halt ? <span className="status" data-s="stopped"><i />Stopped</span> : null}
            </Link>
          ))}
        </nav>

        <main className="cx-main">
          <section aria-labelledby="rolls-h">
            <h2 id="rolls-h">Today&rsquo;s rolls</h2>
            <div className="cx-table-wrap">
              <table className="cx-table">
                <thead>
                  <tr><th>Time</th><th>Account</th><th>Kind</th><th>Media</th><th>Status</th><th>Tries</th><th>Post</th></tr>
                </thead>
                <tbody>
                  {rolls.map((s) => {
                    const st = slotStatus(s, s.account.halt);
                    return (
                      <tr key={s.id} data-current={s.account.id === acct?.id || undefined}>
                        <td className="mono">{s.local}</td>
                        <td>{s.account.handle}</td>
                        <td>{s.kind}</td>
                        <td>{s.form}</td>
                        <td><span className="status" data-s={st.key}><i />{st.label}</span></td>
                        <td className="mono">{s.attempts || ''}</td>
                        <td>{s.url ? <a href={s.url}>{host(s.url)}</a> : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="recent-h">
            <h2 id="recent-h">Recent posts and replies</h2>
            {board.recent.length ? (
              <div className="cx-table-wrap">
                <table className="cx-table">
                  <thead>
                    <tr><th>When</th><th>Account</th><th>Kind</th><th>To</th><th>Text</th></tr>
                  </thead>
                  <tbody>
                    {board.recent.slice(0, 60).map((r) => (
                      <tr key={`${r.ts}-${r.accountId}`}>
                        <td className="mono">{r.local}</td>
                        <td>{r.accountId}</td>
                        <td>{r.kind}{r.dry ? ' (dry)' : ''}</td>
                        <td className="mono">{r.author ? `@${r.author}` : ''}</td>
                        <td className="cx-text">{r.url ? <a href={r.url}>{r.text}</a> : r.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="cx-empty">Nothing has posted yet. Run <span className="mono">postrail run --dry</span> to see a tick without sending anything.</p>
            )}
          </section>
        </main>

        <aside className="cx-side" aria-label="Selected account">
          {acct ? (
            <>
              <h2>{acct.handle}</h2>
              <p className="cx-side-sub">{acct.platform} over the {acct.transport} transport{acct.enabled ? '' : ', disabled'}.</p>
              {acct.halt ? (
                <div className="cx-halt">
                  <p><span className="status" data-s="stopped"><i />Stopped by {acct.halt.signal}</span></p>
                  <p>{acct.halt.step}</p>
                </div>
              ) : null}
              <dl className="cx-dl">
                <div><dt>Posts a day</dt><dd>{acct.perDay}</dd></div>
                <div><dt>Window</dt><dd className="mono">{acct.window[0]}:00 to {acct.window[1]}:00</dd></div>
                <div><dt>Minimum gap</dt><dd>{acct.minGapMin} minutes</dd></div>
                <div><dt>Post cap</dt><dd>{acct.caps.postsPerDay} a day</dd></div>
                <div><dt>Reply cap</dt><dd>{acct.caps.repliesPerDay} a day</dd></div>
              </dl>
              <h3>Slot mix</h3>
              <dl className="cx-dl">
                {Object.entries(acct.mix).map(([k, w]) => (
                  <div key={k}><dt>{k}</dt><dd className="mono">{Number(w).toFixed(2)}</dd></div>
                ))}
              </dl>
            </>
          ) : <p>No accounts in the config.</p>}
          <h3>Repetition check</h3>
          <p className="cx-side-sub">
            {board.review.any
              ? 'The last 14 days hold repetition worth reading. Run postrail review --list for the full text.'
              : 'The last 14 days hold no repeated authors, shared threads or near-duplicate posts.'}
          </p>
        </aside>
      </div>
    </div>
  );
}
