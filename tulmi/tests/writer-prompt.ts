/**
 * The writer, as the tests that read its prompt see it (not a test file; vitest runs only *.test.ts).
 *
 * The writer is a role (principles/roles.ts, `writer`): a stable block, the same bytes for everyone, and the data of the
 * call, fenced, at the head of the user message (pipeline/assistPrompt.ts writerContext). A rule is asserted on the block;
 * a fact about one call is asserted on the data; and `told()` is both, for a test that asks what the model was told in all.
 */
import { writerContext, type WriterCall } from "../src/pipeline/assistPrompt.js";
import { stableBlock } from "../src/principles/roles.js";

/** The writer's stable block. */
export const WRITER = stableBlock("writer");

/** The data that follows it for a call. */
export const dataFor = (o: WriterCall): string => writerContext(o);

/** What the model is told on a call, whole: the block, then the data. */
export const told = (o: WriterCall): string => `${WRITER}\n${writerContext(o)}`;
