/**
 * IS THIS AN ASK FOR A PICTURE? Read off the words alone, with no model, so it costs nothing and says the same every time
 * (routes/bots/botsTalk.ts). Yes, and Talk has the cinema bot's picture engine: the picture is made and is the answer.
 *
 * NARROW ON PURPOSE. A picture costs real money and takes the better part of a minute, so a "no" that should have been a
 * "yes" only means the bot answers in words (and can be asked again plainly), while a "yes" that should have been a "no"
 * spends money on a picture nobody wanted. So it needs a verb of MAKING and a thing that is a PICTURE, close together:
 *
 *   yes   "make a poster for Riya's birthday", "draw a cat on a skateboard", "generate an image of a red fort at dusk",
 *         "create a logo for my bakery", "ek photo bana do jisme…", "logo banao", "imagine a city made of glass"
 *   no    "show me photos of hotels in Goa" (finds), "what is in this photo?", "send the picture to Mom",
 *         "how do I make a poster in Canva?" (a how-to), "can you read this image?"
 *
 * With a photo attached, an EDIT counts too: "remove the background", "make it look like a cartoon", "change the sky".
 */

const MAKE = String.raw`(?:make|create|generate|draw|design|paint|sketch|render|illustrate|produce|craft|imagine)`;
const THING = String.raw`(?:image|picture|pic|photo|illustration|poster|logo|drawing|painting|wallpaper|portrait|sticker|artwork|banner|thumbnail|avatar|icon|cartoon|meme|flyer|invitation)s?`;
const HINGLISH_MAKE = String.raw`(?:bana(?:o|do|de|na|ke|iye|dijiye)?|banao|banwa(?:o|do)?|generate\s+kar(?:o|do|na)?|create\s+kar(?:o|do|na)?)`;

const ASK = [
  // "make a poster…", "draw me a picture of…", "generate an image of…", "create 3 logos…": the verb, then the thing within a few words.
  new RegExp(String.raw`\b${MAKE}\b(?:\s+(?:me|us|her|him|them|a|an|the|my|our|some|one|two|three|four|\d|new|nice|cute|simple|quick|small|big|beautiful|realistic|cartoon|hd|4k|cool|good))*\s+${THING}\b`, "i"),
  // "draw a cat…", "paint a sunset…", "sketch my dog…": a drawing verb is a picture by itself.
  /\b(?:draw|paint|sketch|illustrate)\b\s+(?:me\s+)?(?:a|an|the|my|some|\d+)\b/i,
  // "imagine a city made of glass" at the start: an ask to picture something.
  /^\s*imagine\s+(?:a|an|the|my|some)\b/i,
  // Hinglish: "photo bana do", "ek logo banao", "image generate karo".
  new RegExp(String.raw`\b${THING}\b(?:\s+\S+){0,3}?\s+${HINGLISH_MAKE}\b`, "i"),
];

/** What makes a sentence about a picture a question about it, or a how-to, rather than an ask to make one. */
const NOT = [
  /\bhow\s+(?:do|can|to|should|would)\b/i,
  /\b(?:in|with|using)\s+(?:canva|photoshop|figma|illustrator|lightroom|gimp|procreate|powerpoint|word)\b/i,
  /\b(?:send|share|forward|upload|delete|find|search|show\s+me|look\s+(?:at|for)|read|open|save|print)\b[^.?!]{0,30}\b(?:photo|photos|picture|pictures|image|images|pic|pics)\b/i,
  /\bwhat(?:'s|\s+is|\s+are)?\s+(?:in|on)\s+(?:this|that|the)\s+(?:photo|picture|image|pic)\b/i,
];

const EDIT = /\b(?:remove|erase|replace|change|swap|edit|retouch|recolou?r|colou?ri[sz]e|blur|brighten|fix|clean\s+up|add|put)\b[^.?!]{0,40}\b(?:background|sky|colou?r|face|hair|person|people|object|text|logo|it|this|that|him|her|them|light|lighting)\b|\b(?:make|turn)\s+(?:it|this|that|me|him|her|them|the\s+photo|the\s+picture)\s+(?:into|look|like|a|an)\b|\b(?:cartoon|anime|ghibli|pixar|sketch|watercolou?r|oil\s+painting|pencil\s+drawing)\s+(?:style|version)\b/i;

/** Whether these words ask for a picture to be made (or, with a photo attached, a photo to be changed). */
export function isPictureAsk(words: string, o: { photos?: number } = {}): boolean {
  const w = String(words ?? "").replace(/\s+/g, " ").trim();
  if (w.length < 4 || w.length > 2000) return false;
  if (NOT.some((r) => r.test(w))) return false;
  if (ASK.some((r) => r.test(w))) return true;
  return (o.photos ?? 0) > 0 && EDIT.test(w);
}
