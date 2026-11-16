/**
 * THE ONE THING THIS MODULE BORROWS FROM THE REST OF THE SERVER: the model call.
 *
 * Kept behind this file so src/discover depends on a TYPE and nothing else — the tests hand in a fake, the server
 * hands in callModel, and the catalogue, the bar and the feed stay runnable with no gateway in sight.
 */
export type { CallFn } from "../code/work/model.js";
