/**
 * THE SAME REAL TASKS IN THE WAYS PEOPLE ACTUALLY TYPE AND SPEAK THEM: HINGLISH (Hindi in Latin letters), HINDI (Devanagari) AND VOICE (what a speech
 * recogniser writes: no punctuation, fillers, code spoken aloud). Each keeps every detail of the original so the same hidden tests are fair; only the
 * wording changes. The names in code stay as they are, because that is how a person says them in any language.
 */
import type { Task } from "../schema.js";
import { variant } from "./lib.js";

const lang = (of: string, id: string, title: string, language: NonNullable<Task["language"]>, request: string, extra: string[] = []): Promise<Task> =>
  variant(of, { id, title, category: "language", language, request, tags: ["language", language, "bakeoff", ...extra] });

export async function tasks(): Promise<Task[]> {
  return Promise.all([
    lang("express-feat-nocontent", "express-lang-nocontent-hinglish", "res.noContent() in Hinglish", "hinglish",
      "Bhai, express ke response object mein `res.noContent()` naam ka method add kar do. Yeh `204 No Content` bhejta hai, body khaali, aur Content-Type, Content-Length aur Transfer-Encoding headers hata deta hai "
      + "chahe pehle set kiye hon. Baaki sab headers (custom wale, cookies) waise ke waise rehne chahiye. Status pehle kuch bhi set ho, hamesha 204 hi jaana chahiye, "
      + "aur method response ko return kare taaki chain ho sake.", ["quick"]),
    lang("bulletproof-vite-feat-uselocalstorage", "vite-lang-uselocalstorage-voice", "useLocalStorage spoken aloud", "voice",
      "okay so uh I need a hook in the hooks folder next to use disclosure its called use local storage it takes a key and an initial value and gives back the value a setter and a remove function "
      + "like use state with a third thing the value is read as json from window dot local storage when the hook mounts and if the key is missing or the text is not valid json it gives the initial value "
      + "the setter takes a value or an updater function that gets the previous value it stores it as json and updates the state remove deletes the key and puts the state back to the initial value "
      + "and two hooks using the same key on the same page have to stay in step but a hook on a different key must not be touched and please make both importable from at slash hooks"),
    lang("zustand-feat-logger", "zustand-lang-logger-hindi", "A logger middleware, in Hindi", "hi",
      "zustand के middleware में एक `logger` middleware जोड़ो, जो `zustand/middleware` से एक्सपोर्ट हो और साथ में `LoggerOptions` टाइप भी। `logger(initializer, options?)` स्टोर को ऐसे wrap करे कि हर state बदलाव पर "
      + "`log('[<name>]', { prev, next })` एक बार call हो, जिसमें `prev` बदलाव से पहले की state हो और `next` बाद की state। Options: `name` (default \"store\"), `log` (default `console.log`), "
      + "`enabled` (एक boolean या boolean लौटाने वाला function, default true; false होने पर कुछ भी log नहीं होना चाहिए), और `select` (एक function जो state का वह हिस्सा चुने जो `prev` और `next` में जाए)। "
      + "अगर बदलाव के बाद state वही object है जो पहले थी, तो log नहीं होना चाहिए। स्टोर का व्यवहार नहीं बदलना चाहिए: state अपडेट होती रहे, subscribers को सुनाई दे, और यह `combine` जैसे दूसरे middleware के साथ चले।"),
    lang("flask-feat-routes-json", "flask-lang-routes-hinglish", "flask routes --format in Hinglish", "hinglish",
      "`flask routes` mein ek `--format` option add karo, do choices ke saath: `table` (default, bilkul wahi jo abhi print hota hai) aur `json`. `json` stdout par ek hi JSON list print kare, har route ke liye ek object: "
      + "`endpoint`, `methods` (sorted list, HEAD aur OPTIONS ke bina jab tak `--all-methods` na diya ho) aur `rule`, plus `domain` key har object mein tabhi jab kam se kam ek rule mein host ya subdomain ho "
      + "(wahi condition jisme table mein Host/Subdomain column aata hai). `--sort` dono formats par lagu hota hai. Agar koi route hi nahi hai to `json` `[]` print kare. Changelog mein bhi note kar do."),
    lang("commander-feat-envprefix", "commander-lang-envprefix-hindi", ".envPrefix() in Hindi", "hi",
      "Command में एक `.envPrefix(prefix)` method जोड़ो। इसके बाद उस command का हर option, जिसका अपना `.env()` नहीं है, अपनी value एक environment variable से पढ़े, जिसका नाम prefix के बाद option के long name को "
      + "UPPER_SNAKE_CASE में लिखकर बनता है: `program.envPrefix('MYAPP_').option('--dry-run')` `MYAPP_DRY_RUN` पढ़ेगा। यह उन options पर भी चले जो इस call से पहले जोड़े गए हों और उन पर भी जो बाद में जोड़े जाएँ। "
      + "पुरानी priority वैसी ही रहे (command line सबसे ऊपर, फिर environment, फिर default); option का अपना `.env()` prefix पर भारी पड़े; `--no-color` जैसे negated options के लिए कोई variable न बने; "
      + "और `--help` में `env: MYAPP_DRY_RUN` वैसे ही दिखे जैसे `.env()` के लिए दिखता है। `.envPrefix()` command को ही लौटाए ताकि chain हो सके। TypeScript typings में भी जोड़ो और Readme में लिखो।"),
    lang("click-bug-0551bf5", "click-lang-writeusage-hinglish", "A click bug, in Hinglish", "hinglish",
      "`HelpFormatter.write_usage` kabhi kabhi usage line mein faltu characters daal deta hai. Isse theek karo."),
    lang("body-parser-feat-rawbody", "body-parser-lang-rawbody-hinglish", "rawBody in Hinglish", "hinglish",
      "Humein webhook signatures verify karne ke liye request ke original bytes chahiye. Chaaron parsers (json, urlencoded, text, raw) mein ek `rawBody` option add karo. Jab woh `true` ho, to request body ke raw bytes "
      + "`req.rawBody` par Buffer ki tarah aane chahiye: Content-Encoding (gzip waghera) hatne ke baad, lekin charset decode hone se pehle, yaani latin1 body apne latin1 bytes rakhe jabki `req.body` decoded string ho. "
      + "Jab woh `true` na ho (missing, false, kuch bhi aur) to `req.rawBody` set nahi hona chahiye. Yeh maujooda `verify` option ke saath bhi chalna chahiye, aur body parse fail hone par bhi bytes wahin rehne chahiye. README mein option document kar do."),
    lang("express-bug-9a34acf", "express-lang-etag-hindi", "An ETag bug, in Hindi", "hi",
      "res.send में जब Transfer-Encoding सेट हो तब ETag बनना बंद हो जाता है। ETag generation को Transfer-Encoding के साथ भी बनाए रखो।"),
    lang("flask-bug-7203fea", "flask-lang-ipv6-voice", "An IPv6 bug spoken aloud", "voice",
      "uh so when the server name config is an ipv six address in square brackets with a port and I call app dot run flask gets the host and the port wrong it should be the address without the brackets and the port on its own can you fix the server name parsing for ipv six"),
  ]);
}
