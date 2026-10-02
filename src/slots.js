// The slot model.
//
// A slot is one post an account owes at a planned time. A due slot stays owed until a post lands.
// There are two kinds of refusal, and the engine treats them differently.
//
//   SlotStillOwed   One candidate was refused: a copy gate, an empty draft, a media step, an image
//                   over a size limit. Another draft or another form answers it, so the engine
//                   composes again inside the same slot.
//
//   PlatformSignal  The platform said something about the account: a captcha, a ban or suspension
//                   wall, an identity mismatch, a failed sign-in, a refused token, a rate limit.
//                   Another draft cannot answer it, so the slot stops and the account is halted
//                   until a person takes the one step the signal names.
//
// Everything else is a fault in PostRail's own machinery or in the network. A fault leaves the
// slot owed and the next tick tries again.

export class SlotStillOwed extends Error {
  constructor(why, { tried = 0, kind = '', critique = '' } = {}) {
    super(String(why || 'the draft was refused'));
    this.name = 'SlotStillOwed';
    this.slotStillOwed = true;
    this.tried = tried;
    this.kind = kind;
    this.critique = critique || String(why || '');
  }
}

export const SIGNALS = {
  captcha: 'Open the account in a normal browser, answer the captcha yourself, then run `postrail resume <account>`.',
  ban: 'Read the notice on the account. PostRail stays stopped for this account until you run `postrail resume <account>`.',
  'identity-mismatch': 'The credentials sign in as a different account than the registry names. Fix the credentials or the handle, then run `postrail resume <account>`.',
  'signed-out': 'Sign in again or replace the token, then run `postrail resume <account>`.',
  forbidden: 'The platform refused the request for this account or app. Check its permissions, then run `postrail resume <account>`.',
  'rate-limit': 'The platform asked for fewer requests. Lower the cadence or wait, then run `postrail resume <account>`.',
  'own-timeline': 'The account could not load its own page. Open it by hand to see why, then run `postrail resume <account>`.',
};

export class PlatformSignal extends Error {
  constructor(signal, detail = '', step = '') {
    super(`STOPPED: ${signal}${detail ? `. ${detail}` : ''}`);
    this.name = 'PlatformSignal';
    this.platformSignal = signal;
    this.detail = detail;
    this.step = step || SIGNALS[signal] || 'Check the account by hand, then run `postrail resume <account>`.';
  }
}

/** A delivery fault that is not a statement about the account. `retryable` says whether sending
 *  the same post again can help (a 5xx, a dropped connection) or not (a bad request). */
export class TransportError extends Error {
  constructor(message, { status = 0, retryable = false, body = '' } = {}) {
    super(message);
    this.name = 'TransportError';
    this.status = status;
    this.retryable = retryable;
    this.body = body;
  }
}

export const isOurs = (e) => Boolean(e && (e.slotStillOwed || e.name === 'SlotStillOwed'));
export const isTheirs = (e) => Boolean(e && (e.platformSignal || e.name === 'PlatformSignal'));

/**
 * The retry loop, written once so no caller writes half of it.
 *
 * `fn(i, critique)` composes and sends one candidate. It returns something truthy when a post
 * landed. Throwing SlotStillOwed, or returning nothing, takes the next attempt, and the refusal
 * text is handed to the next call as `critique` so the writer knows what to change. A
 * PlatformSignal or a fault ends the loop at once and goes to the caller.
 */
export async function attempts(fn, { max = 12, log = null, what = 'draft' } = {}) {
  const refusals = [];
  let critique = '';
  for (let i = 0; i < max; i += 1) {
    try {
      const out = await fn(i, critique);
      if (out) return { result: out, attempts: i + 1, refusals };
      refusals.push(`attempt ${i + 1}: nothing composed`);
      critique = 'The last attempt produced nothing. Write the post.';
    } catch (e) {
      if (!isOurs(e)) throw e;
      /* A long refusal is cut at its last whole sentence inside 200 characters, never mid-word. */
      const first = String(e.message).split('\n')[0];
      const cut = first.slice(0, 200);
      const line = first.length <= 200 ? first : ((cut.match(/^.*[.!?](?=\s)/) || [])[0] || `${cut.replace(/\s+\S*$/, '')}...`);
      refusals.push(`attempt ${i + 1}: ${line}`);
      critique = e.critique || line;
    }
    if (log) log(`${what}: ${refusals[refusals.length - 1].replace(/[.\s]+$/, '')}. Composing another draft.`);
  }
  throw new SlotStillOwed(
    `${max} attempts were each refused and the slot is still owed. Tried: ${refusals.join(' | ').slice(0, 800)}`,
    { tried: max },
  );
}

/**
 * Exit codes for the CLI and for a scheduler that wraps it.
 *   0   the post landed, the refusal was ours, or a platform signal was recorded. None of these is
 *       a fault in PostRail, so none of them should trip a scheduler's failure counter.
 *   75  a hold: the window is closed or the min-gap has not passed. Try again later.
 *   1   a fault in PostRail's own machinery, a provider outage or a network failure.
 */
export function exitCode(e) {
  if (!e) return 0;
  if (e.held) return 75;
  if (isOurs(e) || isTheirs(e)) return 0;
  return 1;
}

const THEIRS_IN_TEXT = [
  [/\b(re|h)?captcha\b|are you a robot|unusual traffic|verify (that )?(you are|you're) (a )?human|press and hold/i, 'captcha'],
  [/(account|profile|channel|page)[^.\n]{0,40}\b(suspended|banned|restricted|locked|deactivated|permanently disabled)\b|\b(suspension|shadowban|shadow-ban)\b|your account has been (suspended|locked|restricted|disabled)/i, 'ban'],
  [/identity mismatch|signed in as [^\n]{0,40}\bnot\b|wrong account|handle mismatch/i, 'identity-mismatch'],
  [/not logged in|session (has )?expired|please (sign|log) in|re-?authenticat|invalid[_ ]grant|token (is |has )?(expired|revoked|invalid)|ExpiredToken|InvalidToken|AuthenticationRequired/i, 'signed-out'],
  [/\brate[ _-]?limit(ed)?\b|too many requests|RateLimitExceeded/i, 'rate-limit'],
];

/** The platform signal a page or an error body carries, or null when there is none. */
export function signalInText(text) {
  const t = String(text || '');
  for (const [re, signal] of THEIRS_IN_TEXT) if (re.test(t)) return signal;
  return null;
}

/** Turn an HTTP answer into the right error, or null for a success. */
export function errorForHttp(status, bodyText, platform = '') {
  if (status >= 200 && status < 300) return null;
  const body = String(bodyText || '').slice(0, 600);
  const fromText = signalInText(body);
  const where = platform ? `${platform} answered ${status}` : `answered ${status}`;
  if (fromText === 'ban' || fromText === 'captcha' || fromText === 'identity-mismatch') {
    return new PlatformSignal(fromText, `${where}: ${body.slice(0, 200)}`);
  }
  if (status === 401) return new PlatformSignal('signed-out', `${where}: ${body.slice(0, 200)}`);
  if (status === 403) return new PlatformSignal('forbidden', `${where}: ${body.slice(0, 200)}`);
  if (status === 429) return new PlatformSignal('rate-limit', `${where}: ${body.slice(0, 200)}`);
  if (fromText === 'signed-out') return new PlatformSignal('signed-out', `${where}: ${body.slice(0, 200)}`);
  return new TransportError(`${where}: ${body.slice(0, 300)}`, { status, retryable: status >= 500 || status === 408 || status === 409, body });
}
