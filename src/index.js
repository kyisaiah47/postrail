// PostRail's public API. Everything the CLI does is available here.

export { SlotStillOwed, PlatformSignal, TransportError, SIGNALS, attempts, exitCode, signalInText, errorForHttp, isOurs, isTheirs } from './slots.js';
export { PLATFORMS, FORMS, DEFAULT_SLOTS, loadConfig, validateConfig, mustValidate, accountById, ownHandles, subjectById, normHandle } from './registry.js';
export { planDay, planAll, inWindow, windowBounds, slotsForDay, effectiveGapMin, isBehind, localClock } from './schedule.js';
export { seededRng, rollWeighted } from './rng.js';
export { localDate, zonedToUtc, zonedParts, dayOfWeek } from './time.js';
export { createFileStore, createMemoryStore } from './store.js';
export { createProvider, createStubProvider, ProviderError } from './providers/index.js';
export { checkCopy, patternHits, platformLength, gatesBrief } from './copy/gates.js';
export { buildPrompt, composeDraft, pickSubject, cleanDraft } from './copy/compose.js';
export { renderCardSvg, writeCard, svgToPng, pngRenderer, SIZES, THEMES, PLATFORM_CARD } from './media/card.js';
export { MASTERS, validateSpecSheet, writeSpecSheet, specSheetPrompt, cutPlan, renderCut } from './media/video.js';
export {
  transportFor, createDryTransport, createBlueskyTransport, createXTransport, createThreadsTransport,
  createInstagramTransport, createLinkedInTransport, createYouTubeTransport, createBrowserTransport,
} from './transports/index.js';
export { createReplyGuard, LIMITS as REPLY_LIMITS } from './replies/guard.js';
export { rootKey } from './replies/threads.js';
export { review, formatReview, listTable, hasFindings } from './review.js';
export { runTick, runSlot, runReplies, ensurePlan, buildMedia, sendWithRetry, formOrder } from './engine.js';
export { scaffoldApp } from './scaffold/index.js';
