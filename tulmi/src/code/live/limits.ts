/**
 * THE NUMBERS OF THE LIVE SESSION (docs/cloudflare-jobs.md section 10). Nothing in this file reaches a network, a clock or a store.
 *
 * Three of them are settings the person running the server can change (config.ts): CODE_SESSION_IDLE_SEC, CODE_SESSION_MAX_MIN and
 * CODE_ACTIONS_MONTHLY_MIN. The rest are the shape of the thing, and are here so a test and a reader find them in one place.
 */

/** A session with no command for this long is closed (CODE_SESSION_IDLE_SEC). */
export const SESSION_IDLE_SEC_DEFAULT = 120;
/** The most minutes of live session one job may use in all, and the time limit of the workflow that hosts the runner (CODE_SESSION_MAX_MIN). */
export const SESSION_MAX_MIN_DEFAULT = 20;
/** The person's GitHub Actions minutes a month that Tailzu counts against (CODE_ACTIONS_MONTHLY_MIN, a free plan's 2,000). */
export const ACTIONS_MONTHLY_MIN_DEFAULT = 2000;
/** At this share of the month's minutes the person is told, once. */
export const ACTIONS_NOTIFY_AT = 0.8;
/** At this share placement stops choosing GitHub's computers, until the month turns over. */
export const ACTIONS_STOP_AT = 0.95;

/** The most text a job's copy holds. Over it the job is `remote`: grep and glob run on the runner. */
export const WORKSPACE_MAX_BYTES = 50 * 1024 * 1024;
/** Files kept in a copy. */
export const WORKSPACE_FILES_MAX = 20_000;
/** Names of files that were left out (and why) kept for list and glob. */
export const SKIPPED_MAX = 50_000;
/** A copy untouched for this long is deleted by an alarm: Tailzu never keeps a person's code. */
export const WORKSPACE_IDLE_MS = 6 * 60 * 60_000;
/** A file bigger than this is not read into a copy (the project brain's own limit). */
export const FILE_MAX_BYTES = 512 * 1024;
/** The tarball may be this big compressed, and inflate to this much (the project brain's limits). */
export const TARBALL_MAX_BYTES = 300 * 1024 * 1024;
export const TARBALL_EXPANDED_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** The whole download and unpack of a copy. */
export const PREPARE_TIMEOUT_MS = 5 * 60_000;

/** read: lines returned by default and at most, characters of one line, and characters in all. */
export const READ_LINES_DEFAULT = 2000;
export const READ_LINES_MAX = 5000;
export const READ_LINE_CHARS = 2000;
export const READ_CHARS_MAX = 120_000;

/** list: entries returned. */
export const LIST_MAX = 500;
/** glob: paths returned. */
export const GLOB_MAX = 500;

/** grep. */
export const GREP_PATTERN_MAX = 300;
export const GREP_RESULTS_DEFAULT = 100;
export const GREP_RESULTS_MAX = 500;
export const GREP_CONTEXT_MAX = 5;
/** A line is cut to this many characters for matching, and to GREP_OUT_CHARS in the answer. */
export const GREP_LINE_MATCH_CHARS = 1000;
export const GREP_OUT_CHARS = 300;
/** The whole answer. */
export const GREP_OUT_MAX = 40_000;
/**
 * The budgets that cut a search short with `partial: true`. TIME is what the spec asks for and what the clock gives where the clock moves
 * (Node); a Workers isolate's clock only moves when the code waits for I/O, so a search that never waits would never see time pass. The WORK
 * budget (characters tested) is what bounds it there, and is deterministic.
 */
export const GREP_FILE_MS = 250;
export const GREP_TOTAL_MS = 2_500;
export const GREP_FILE_CHARS = 600_000;
export const GREP_TOTAL_CHARS = 30 * 1024 * 1024;

/** A runner session. */
export const RUNNER_TOKEN_TTL_MS = 15 * 60_000;
/** A device's ticket (the desktop app's connection to the Worker) and an app's viewer ticket. */
export const DEVICE_TICKET_TTL_MS = 2 * 60_000;
export const VIEWER_TICKET_TTL_MS = 2 * 60_000;
/** The output of a command kept in the room, and what a result carries (the router's own 8 KB). */
export const OUTPUT_HOLD_CHARS = 64 * 1024;
/** A viewer is sent at most this much new output at once. */
export const VIEWER_OUT_CHARS = 2000;
/** Recent compact events kept for a viewer that joins late. */
export const VIEWER_BACKLOG = 100;
/** A message a socket may send, in bytes. */
export const MESSAGE_MAX_BYTES = 2 * 1024 * 1024;
/** A person's mid-task message. */
export const SAID_MAX_CHARS = 4000;
export const SAID_KEEP = 20;
/** Commands run in a session that wait their turn, and how long a command waits for a runner to connect. */
export const EXEC_QUEUE_MAX = 8;
/** The room gives a command this long past its own time limit before it stops waiting for the runner. */
export const EXEC_GRACE_MS = 20_000;
/** A search forwarded to a runner. */
export const SEARCH_TIMEOUT_MS = 60_000;

/**
 * THE PREVIEW: the project's dev server, running on the job's runner, seen live through the room (docs/cloudflare-jobs.md "The preview").
 * A preview that gets no request for this long is closed (CODE_PREVIEW_IDLE_SEC); the job's session minutes cap it all the same.
 */
export const PREVIEW_IDLE_SEC_DEFAULT = 300;
/** The most a response may carry, from the runner through the room to the browser. Over it: 502 preview_too_large. */
export const PREVIEW_RES_MAX_BYTES = 10 * 1024 * 1024;
/** The most a request body may carry (it travels in ONE frame, base64: a frame is at most 2 MB). */
export const PREVIEW_REQ_MAX_BYTES = 1024 * 1024;
/** A response goes from the runner in pieces of at most this many bytes (base64 inflates by a third; a frame is at most 2 MB). */
export const PREVIEW_CHUNK_BYTES = 192 * 1024;
/** Requests in flight through one room at once. */
export const PREVIEW_PENDING_MAX = 32;
/** The whole of one request, from the browser asking to the last byte. */
export const PREVIEW_REQUEST_MS = 55_000;
/** How long the dev server is given to answer its first request. */
export const PREVIEW_READY_SEC_DEFAULT = 90;
export const PREVIEW_READY_SEC_MAX = 180;
/** The room writes "the preview was used" at most this often (a write per request would be a row per asset). */
export const PREVIEW_TOUCH_MS = 5_000;
