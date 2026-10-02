import Disclosure from '@/components/Disclosure';
import { slotStatus, host } from '@/lib/status';

/* THE SIMPLE VIEW. The same board, roomier: what today holds first, then one card per account
 * with its next post and what it already posted, and the detail behind a disclosure. */
export default function SimpleHome({ board }) {
  const total = board.accounts.reduce((n, a) => n + a.slots.length, 0);
  const posted = board.accounts.reduce((n, a) => n + a.posted, 0);
  const halted = board.accounts.filter((a) => a.halt);
  return (
    <main className="sv-home">
      <section className="sv-hero">
        <h1>What your accounts post today</h1>
        <p>
          PostRail plans each account&rsquo;s day inside its posting window, sends each post when it comes due, and keeps
          trying until the post lands. Only the platform can stop it: a captcha, a ban notice, a sign-in wall or the wrong account.
        </p>
        <p className="sv-note">
          Today is {board.date} in {board.timezone}. {posted} of {total} planned posts are out. Replies are {board.repliesOn ? 'on' : 'off'}.
        </p>
      </section>

      {halted.map((a) => (
        <section key={a.id} className="sv-card sv-card-stop" aria-label={`${a.handle} is stopped`}>
          <h2>{a.handle} is stopped</h2>
          <p>The platform showed a {a.halt.signal} signal on {a.halt.at.slice(0, 10)}. {a.halt.step}</p>
        </section>
      ))}

      <section className="sv-grid" aria-label="Accounts">
        {board.accounts.map((a) => (
          <article key={a.id} className="sv-card">
            <h2>{a.handle}</h2>
            <p className="sv-card-sub">
              {a.platform}. {a.perDay} post{a.perDay === 1 ? '' : 's'} a day between {a.window[0]}:00 and {a.window[1]}:00.
            </p>
            <p className="sv-next">
              {a.next ? `The next post goes out at ${a.next.local}. It is a ${a.next.kind} post${a.next.form === 'none' ? '' : ` with a ${a.next.form}`}.` : 'Every post for today is out or owed.'}
              {a.owed ? ` ${a.owed} post${a.owed === 1 ? ' is' : 's are'} owed and will go out on the next run.` : ''}
            </p>
            {a.slots.filter((s) => s.text).map((s) => (
              <blockquote key={s.id} className="sv-post">
                <p>{s.text}</p>
                {s.url ? <a href={s.url}>{host(s.url)}</a> : null}
              </blockquote>
            ))}
            <Disclosure title="Every slot today">
              <ul className="sv-slots">
                {a.slots.map((s) => {
                  const st = slotStatus(s, a.halt);
                  return (
                    <li key={s.id}>
                      <span className="mono">{s.local}</span>
                      <span>{s.kind}, {s.form}</span>
                      <span className="status" data-s={st.key}><i />{st.label}</span>
                    </li>
                  );
                })}
              </ul>
            </Disclosure>
          </article>
        ))}
      </section>

      <section className="sv-section" aria-labelledby="sv-recent">
        <h2 id="sv-recent">Recently posted</h2>
        {board.recent.length ? (
          <div className="sv-recent">
            {board.recent.slice(0, 8).map((r) => (
              <article key={`${r.ts}-${r.accountId}`} className="sv-post">
                <p className="sv-post-meta">{r.accountId}, {r.kind}{r.author ? ` to @${r.author}` : ''}, {r.local}{r.dry ? ', dry run' : ''}</p>
                <p>{r.text}</p>
                {r.url ? <a href={r.url}>{host(r.url)}</a> : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="sv-note">Nothing has posted yet. A dry run shows what a tick would send without sending it.</p>
        )}
        <Disclosure title="Repetition check for the last 14 days">
          {board.review.any ? (
            <p>The review found repetition: the same person answered more than twice, two accounts in one thread, or posts that repeat each other. Run postrail review --list to read the full text.</p>
          ) : (
            <p>No repeated authors, shared threads or near-duplicate posts in the last 14 days.</p>
          )}
        </Disclosure>
      </section>
    </main>
  );
}
