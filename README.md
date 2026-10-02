# PostRail

PostRail is an open-source agent that posts to your social accounts on a schedule. It plans each account's day, writes each post with the model you choose, attaches a card or a video cut, and sends the post through the platform's official API. A post that comes due stays owed until it lands, and only the platform can stop it.

PostRail is built by [Compound Labs](https://thecompound.tech) and released under the MIT license. The source is at https://github.com/kyisaiah47/postrail, and the site is https://postrail.thecompound.tech.

## What PostRail does

- **Account registry.** Each account is one entry in a config file. The entry declares the platform, the handle, the transport, the cadence and posting window, the daily caps, the mix of slot kinds, and the media each kind carries. Credentials stay in environment variables, and the config only names them.
- **Slot engine.** PostRail plans each account's day once. The plan puts the day's posts inside the window, keeps them at least the minimum gap apart, and moves each one by a few minutes so the account never posts on a fixed clock. When a slot comes due, PostRail runs it until a post lands. A refused draft is written again inside the same slot, and a failed send is retried. A captcha, a ban notice, the wrong account, a failed sign-in, a refused token or a rate limit stops the slot and halts the account until you run `postrail resume`.
- **Copy.** One provider interface covers OpenAI, Anthropic, Gemini and any server that speaks the OpenAI chat format, including a model on your own machine. Every draft passes the copy gates before it is sent. The gates check length the way the platform counts it, links, hashtags, sentences that stop halfway, and repeats of recent posts on any of your accounts. Two optional lists refuse filler phrases and prose shapes that read as advertising.
- **Media.** Cards render as SVG, and as PNG when a renderer is installed. Short and long video cuts come from two masters, one per format. For each cut the model writes a spec sheet at post time, and PostRail checks every quoted sentence and every number on screen against the source before ffmpeg renders the cut.
- **Transports.** PostRail uses the official APIs of Bluesky (the AT Protocol), X, Threads, LinkedIn, Instagram and YouTube. For a platform with no posting API it has a plain Playwright browser transport. The browser transport has no code that hides automation and no code that answers a captcha.
- **Replies.** The reply module is optional and off by default. When you turn it on, it allows one reply per person per platform every seven days across all your accounts, caps replies per day, keeps your accounts to one seat per thread, and refuses a reworded repeat of a pitch you already sent.
- **Review.** `postrail review` reads the actual text of recent posts and replies. It flags people answered over and over, two of your accounts in one thread, a high share of promotional replies, near-duplicate pitches, template openers and near-duplicate posts.
- **Dashboard.** `postrail new-app` writes a Next.js app that shows the day's plan and every post and reply. It offers a Console view, a Simple view or both.

## Install

```sh
npm install postrail
```

PostRail needs Node 20.10 or later. The package `@resvg/resvg-js` installs as an optional dependency and turns cards into PNG files. Install `playwright` only if you use the browser transport, and install ffmpeg only if you post video cuts.

## Try it without sending anything

```sh
node node_modules/postrail/examples/parserail-card/run.mjs
```

The example has three made-up accounts on Bluesky, X and LinkedIn. They post about ParseRail, a Compound Labs product, and every fact they may use is a sentence from ParseRail's live page, read on 2026-10-02. The script prints each account's plan for the day and runs one tick on the dry transport, which checks each post and records it without sending it. The first pitch is written with filler on purpose, so you see the gate refuse it and the slot write a new draft. Each post carries a card, and the script prints the folder that holds the cards and the outbox.

Add `--gemini` and set `GEMINI_API_KEY` to have a Gemini model write the posts instead of the fixed writer.

## Configure

A config is a JSON file (or a module that exports the same object). This is one account:

```json
{
  "timezone": "America/New_York",
  "provider": { "kind": "gemini", "model": "gemini-flash-lite-latest" },
  "subjects": [
    {
      "id": "parserail",
      "name": "ParseRail",
      "url": "https://parserail.thecompound.tech",
      "facts": ["Submit as a job and get a webhook when it finishes."]
    }
  ],
  "accounts": [
    {
      "id": "my-bluesky",
      "platform": "bluesky",
      "handle": "example.bsky.social",
      "transport": { "kind": "bluesky", "identifierEnv": "BSKY_IDENTIFIER", "passwordEnv": "BSKY_APP_PASSWORD" },
      "cadence": { "perDay": 3, "minGapMin": 150, "window": [8, 22], "jitterMin": 20 },
      "caps": { "postsPerDay": 3, "repliesPerDay": 10 },
      "mix": { "pitch": 0.5, "teach": 0.5 },
      "media": { "pitch": { "card": 1 }, "teach": { "card": 0.5, "none": 0.5 } },
      "subjects": ["parserail"],
      "promo": ["ParseRail"]
    }
  ]
}
```

- `cadence.window` is the local posting window, in hours, in the config's time zone. The default is 8 to 22.
- `cadence.minGapMin` is the minimum gap between two posts from the account. While an account is behind its plan, the engine halves the gap so the backlog posts inside the window.
- `mix` sets the weight of each slot kind. The built-in kinds are `pitch`, `teach` and `update`. Add your own under `slots` with an instruction for the writer.
- `media` sets the weight of each media form per slot kind: `none`, `card`, `shorts` or `longform`.
- `subjects` are what the account posts about. The writer may state only the facts listed for the subject.
- `promo` lists words that mark a post or a reply as promotion. The review and the reply guard count them.

Run `postrail validate` to check a config. It prints every problem it finds.

## Run it on a schedule

`postrail run` performs one tick and exits. Run it every 10 to 15 minutes from cron, launchd or a systemd timer:

```sh
*/10 * * * * cd /path/to/project && npx postrail run >> postrail.log 2>&1
```

`postrail run --dry` sends every post to the dry transport. `postrail plan` prints the day's slots and their status.

The exit code tells a scheduler what happened:

| Code | Meaning |
| --- | --- |
| 0 | A post landed, nothing was due, or a platform signal halted an account and was recorded. |
| 75 | A post is due but must wait for the window or the minimum gap. |
| 1 | A fault in PostRail, the model provider or the network. The slot stays owed for the next tick. |

## Bring your own model

```json
{ "provider": { "kind": "openai", "model": "<model>", "apiKeyEnv": "OPENAI_API_KEY" } }
{ "provider": { "kind": "anthropic", "model": "<model>", "apiKeyEnv": "ANTHROPIC_API_KEY" } }
{ "provider": { "kind": "gemini", "model": "gemini-flash-lite-latest", "apiKeyEnv": "GEMINI_API_KEY" } }
{ "provider": { "kind": "openai-compatible", "model": "llama3.1", "baseURL": "http://localhost:11434/v1" } }
```

PostRail reads the key from the named environment variable when it makes a call. It retries a provider that answers 5xx, and it treats a draft that hit the model's output limit as a refused draft.

## Transports

| Platform | Transport | Carries | Credentials |
| --- | --- | --- | --- |
| Bluesky | `bluesky` | Text, up to four images, replies | `identifierEnv` and `passwordEnv`, holding an app password |
| X | `x` | Text, images, video, replies | OAuth 1.0a user keys, or an OAuth 2.0 user token. Posting through the X API is a paid product of X. |
| Threads | `threads` | Text, one image or video, replies | `tokenEnv`, plus `mediaDir` and `mediaBaseUrl` for media |
| LinkedIn | `linkedin` | Text and one image | `tokenEnv` with `w_member_social` (or `w_organization_social` and an `author`) |
| Instagram | `instagram` | One image or one reel per post | `tokenEnv`, `userId`, plus `mediaDir` and `mediaBaseUrl` |
| YouTube | `youtube` | One video per post | `clientIdEnv`, `clientSecretEnv`, `refreshTokenEnv` |
| TikTok, Facebook, other sites | `browser` | Whatever the site's composer accepts | A browser profile you signed into with `postrail login <account>` |

Threads and Instagram fetch media from a public address. Set `mediaDir` to a folder you publish and `mediaBaseUrl` to its address, and PostRail copies each file there before it posts.

Every transport checks that the credentials belong to the handle in the registry before it posts. A mismatch halts the account.

The browser transport takes a recipe of CSS selectors for the site's composer. With `--dry` it opens the composer, types the post and attaches the media, then stops before the click. It runs muted and cancels any click on a mail or phone link.

## Platform signals

A platform signal is something the platform says about the account. PostRail stops the slot, writes a halt for the account, and prints the one step you have to take. These are the signals:

- `captcha`: a challenge page or frame
- `ban`: a notice that the account is suspended, banned, locked or restricted
- `identity-mismatch`: the credentials or the page belong to another account
- `signed-out`: a sign-in wall, an expired session or a refused token (HTTP 401)
- `forbidden`: the platform refused the request for this account or app (HTTP 403)
- `rate-limit`: the platform asked for fewer requests (HTTP 429)

After you deal with it, run `postrail resume <account>`. The next tick posts the slots the account still owes.

## Replies are off by default

The reply module does nothing until you set `"replies": { "enabled": true }`. It is off because automated replies to strangers are the behaviour the platforms' own rules restrict most. X's automation rules forbid automated replies based on keyword searches alone and require approval for any AI reply bot. Bluesky's bot tutorial asks bots to reply only to people who tagged them. Both are quoted below.

When you turn it on, every reply passes these checks:

1. A daily cap per account (`caps.repliesPerDay`, default 20).
2. One reply per person per platform every 168 hours, counted across all your accounts (`replies.authorCooldownH`).
3. One seat per thread: no two of your accounts in one conversation, and no account in it twice. If you pass a function that reads the live thread, its answer wins, and a read that fails skips the thread.
4. No near copy of a recent reply, no reused three-word opener, no reused closing sentence, no four-word phrase already used twice, no fifth question in twenty replies, and no "the hard part is" template opener.
5. No reworded repeat of a pitch: a promotional reply whose words match a recent promotional reply is refused, even when the wording changed.
6. Promotional replies may be at most a quarter of an account's last 30 replies (`replies.promoRatioMax`).

PostRail does not search for people to reply to. You pass the candidates to `runReplies()`, for example the replies and mentions your own posts received.

## The platforms' own rules

These are the clauses on automation that each platform published, quoted from the pages as they read on 2026-10-02 (UTC).

### X

[X Terms of Service](https://x.com/en/tos), read at 14:31 UTC. The version in force is marked "Effective: April 10, 2026". A new version takes effect on October 9, 2026, and it carries the same two numbered items.

> You may not access the Services in any way other than through the currently available, published interfaces that we provide.

> (iii) access or search or attempt to access or search the Services by any means (automated or otherwise) other than through our currently available, published interfaces that are provided by us (and only pursuant to the applicable terms and conditions), unless you have been specifically allowed to do so in a separate agreement with us (NOTE: crawling or scraping the Services in any form, for any purpose without our prior written consent is expressly prohibited);

> (viii) interfere with, or disrupt, (or attempt to do so), the access of any user, host or network, including, without limitation, sending a virus, overloading, flooding, spamming, mail-bombing the Services, or by scripting the creation of Content in such a manner as to interfere with or create an undue burden on the Services.

[X automation rules](https://help.x.com/en/rules-and-policies/x-automation), read at 14:36 UTC, marked "Updated April 2026". The page draws the name X as a logo, which is written [X] below.

> Automation on [X] refers to accounts or apps that take repeated actions without a person actively performing them.

> Use non-API-based forms of automation, such as scripting the [X] website. The use of these techniques may result in the permanent suspension of your account.

> Multiple posts/accounts: You may not post duplicative or substantially similar posts on one account or over multiple accounts you operate.

> Automating these actions to reach many users on an unsolicited basis is an abuse of the feature, and is not permitted. For example, sending automated replies to posts based on keyword searches alone is not permitted.

> However, to safeguard user experience, prevent potential misuse, and ensure alignment with our rules, the deployment or operation of any AI reply bot requires prior written and explicit approval from [X].

PostRail posts to X only through the X API. Its repeat gate refuses a post that matches a recent post on any of your accounts.

### Instagram

[Instagram Terms of Use](https://help.instagram.com/581066165581870), read at 14:34 UTC. The page prints no date.

> You can't attempt to create accounts or access or collect information in unauthorized ways.

> This includes creating accounts or accessing or collecting information in an automated way without our express permission, regardless of whether such automated access or collection is undertaken while logged-in to an Instagram account.

[Meta Community Standards, Spam](https://transparency.meta.com/policies/community-standards/spam/), read at 14:38 UTC. Instagram's community guidelines address now redirects to Meta's Community Standards. Under "We do not allow", the standard lists:

> Posting, sharing, engaging with content or creating accounts, Groups, Pages, Events or other assets, either manually or automatically, at very high frequencies.

> We may place restrictions on accounts that are acting at lower frequencies when other indicators of Spam (e.g., posting repetitive content) or signals of inauthenticity are present.

PostRail posts to Instagram only through Meta's Instagram API.

### TikTok

[TikTok Terms of Service (US)](https://www.tiktok.com/legal/page/us/terms-of-service/en), read at 14:31 UTC, marked "Last updated: July 15, 2026". Section 3.4 says you must not use the Platform to:

> scrape, crawl, export or otherwise extract any data or content in any form, for any purpose, from the Platform using any automated system or software, including automated “bots,” except as approved in writing by TikTok USDS Joint Venture,

> engage in inauthentic commercial behaviors, such as by operating spam or impersonation accounts or any other means further detailed in our Community Guidelines,

The terms have no clause about automated posting. PostRail has no API transport for TikTok, so a TikTok account runs on the browser transport. Read the terms against your own use before you turn it on.

### LinkedIn

[LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement), read at 14:31 UTC, marked "Effective on November 3, 2025". Section 8.2, "Don’ts", opens with "You agree that you will not:" and includes these items, numbered as the page shows them:

> 2. Develop, support or use software, devices, scripts, robots or any other means or processes (such as crawlers, browser plugins and add-ons or any other technology) to scrape or copy the Services, including profiles and other data from the Services;

> 13. Use bots or other unauthorized automated methods to access the Services, add or download contacts, send or redirect messages, create, comment on, like, share, or re-share posts, or otherwise drive inauthentic engagement;

> 16. Interfere with the operation of, or place an unreasonable load on, the Services (e.g., spam, denial of service attack, viruses, manipulating algorithms);

PostRail posts to LinkedIn only through the Posts API, with a token LinkedIn issued to your app.

### Bluesky

[Bluesky Community Guidelines](https://bsky.social/about/support/community-guidelines), read at 14:31 UTC, marked "Last Updated: September 19, 2025".

> Do not send spam or repeatedly post content in ways that disrupt normal conversations or service use.

> Do not artificially manipulate features or social signals to gain unearned reach or mislead users, including engagement metrics, follower counts, or other measures of community interest.

[AT Protocol bot tutorial](https://atproto.com/guides/bot-tutorial), read at 14:35 UTC. The older bot page on docs.bsky.app did not load on 2026-10-02, so these lines come from the tutorial that replaced it.

> As a best practice, bot accounts should identify themselves by adding a self-label to their profile. This helps users and moderation tools recognize automated accounts.

> Keep in mind that bots should respect the network's rate limits.

> Automated bots that post to an account on an regular interval are welcome on the network. If your bot interacts with other users, please only interact (like, repost, reply, etc.) if the user has tagged the bot account. It should be an opt-in interaction, or your bot may be flagged for spam.

## You carry the account risk

The person who runs PostRail carries the risk to the accounts it posts from. PostRail sends what you configure, to accounts you control, on the schedule you set. Each platform decides what its own rules mean, and any of them can limit, suspend or close an account that runs automation, including automation that uses the platform's own API. The MIT license says the software comes with no warranty, and the authors are not liable for what happens to your accounts.

## Use a personal account, not a company account

We recommend that you run PostRail on a personal account that you operate yourself. If a platform restricts a company account, the company loses its public page and every follower it built there. Start with one account, a low cadence and replies off. Read `postrail review --list` after the first week.

## What PostRail will not do

- PostRail has no Reddit support. A config that names Reddit fails validation.
- PostRail has no code that hides automation from a site, answers a captcha, or changes what a page can read about the browser. A captcha stops the slot.
- PostRail does not reply to anyone unless you turn the reply module on and pass it the candidates.

## The dashboard

```sh
npx postrail new-app --app both --dir postrail-app
cd postrail-app && npm install && npm run dev
```

`--app console` writes one dense view with the accounts, every slot for today, every recent post and the selected account's settings. `--app simple` writes one roomy view with a card per account and the details behind disclosures. `--app both` writes both views, a welcome dialog that explains the page and offers the choice, and a footer control to switch at any time. The app reads the same config and state files the agent writes. Set `POSTRAIL_CONFIG` if the config is not at `../postrail.config.json`.

## Video cuts

The two masters are `shorts` (1080 by 1920, 21 to 35 seconds) and `longform` (1920 by 1080, 52 to 58 seconds). Each master lists its beats in order and what a spec sheet must say about each beat. A subject that should get video cuts lists at least four pictures or clips under `assets`. At post time the model writes a spec sheet for that subject. PostRail refuses a sheet that misses a beat, shows the same picture twice, runs outside the duration band, quotes a sentence the source does not contain, or puts a number on screen that the source does not contain. `postrail cut --sheet sheet.json --out cut.mp4` renders a sheet you wrote by hand.

## Development

```sh
npm test        # the test suite, with no network and no paid model
npm run scrub   # the scrub gate
```

The tests use a stub provider, a fake fetch for every API transport, and a fake site on localhost for the browser transport. One test calls Gemini, and it runs only when `GEMINI_API_KEY` is set.

The scrub gate runs in CI on every push and fails the build on personal email addresses, private account handles and identifiers, home directory paths, key-shaped strings, the stealth plugin and other libraries that disguise a browser, captcha services, and overrides of `navigator.webdriver`. Private identifiers are stored as salted hashes, so the gate does not publish the list it protects. The repository owner's handle is refused only in `@` form, and a GitHub link under it passes only when it points at this repository. `node scripts/scrub-gate.mjs --hash token <value>` prints the hash for an identifier you want refused anywhere, and `--hash mention <value>` for a handle refused only in `@` form. The gate has no allowlist and no override.

## License

MIT. Copyright (c) 2026 Compound Labs.
