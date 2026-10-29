/**
 * DELETE YOUR ACCOUNT, ON THE WEB — served at /delete-account, and as x0bot.com/delete-account through the site's proxy
 * (TAILZU-WEB vercel.json). Google Play asks for a page where someone can ask for their account to be deleted without the app;
 * this is it, and the privacy policy and the terms link to it.
 *
 * The person signs in the way the app signs in, with a code mailed to their address (Supabase's email code, through
 * POST /v1/account/deletion/web/code and /verify, routes/accountDeletion.ts: an account is never made here), then uses the app's own
 * Delete account (POST /v1/account/deletion): the same seven days to change their mind, Keep my account (DELETE) until then.
 * The page says what is deleted and what is kept.
 *
 * Served with a policy that runs only this page's own script (by nonce), connects only to its own origin, and loads nothing from
 * anyone else (no pixel, no tag manager). Cloudflare's Turnstile is allowed only when a site key is set (DELETE_PAGE_TURNSTILE_SITE_KEY,
 * or TURNSTILE_SITE_KEY), for the day Supabase's attack protection asks for it.
 */
import { esc } from "../../seo/head.js";
import { siteShell } from "./shell.js";

const TURNSTILE = "https://challenges.cloudflare.com";

/** The policy the page is served with. */
export function deletePageCsp(nonce: string, captcha: boolean): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'${captcha ? ` ${TURNSTILE}` : ""}`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: https://x0bot.com https://api.x0bot.com",
    "connect-src 'self'",
    ...(captcha ? [`frame-src ${TURNSTILE}`] : []),
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** What goes, and what stays: the same account as the app's Delete account (server.ts eraseAccount). */
export const DELETED = [
  "Your account and how you sign in to it (your email address or phone number, and your name)",
  "Your profile and settings, the personality and words Keybot learned, and your dictation history",
  "Your bots, what they remember, their keys, and your chats with them",
  "Your calendar, to-dos, meeting notes, and the files, photos and videos you uploaded or made",
  "Your Code bot projects, and your links to GitHub and to the apps you connected",
  "The spaces you made, with everything in them; your place in other spaces, and everything you shared in them",
  "Your usage records, notification tokens and the record of your purchases on our side",
];
export const KEPT = [
  "Messages you sent in chats with other people stay in those chats for them, under the name you had then. Things you shared in other people's spaces are deleted.",
  "Reports you made, and reports about things you sent, are kept as a safety record, without your account.",
  "Apple, Google and Razorpay keep their own records of what you bought, as the law asks them to. Deleting your account doesn't cancel a subscription: cancel it in the App Store, Google Play or the app first.",
  "Crash reports and diagnostic logs, which can hold your account's ID, are kept for up to 90 days.",
];

const CSS = `
  .del { max-width: 640px; }
  .del h1 { margin-bottom: 14px; }
  .del .lede { margin-bottom: 30px; }
  .box { background: var(--raise); border: 1px solid var(--rule); border-radius: 22px; padding: 24px; margin: 0 0 36px; display: grid; gap: 14px; }
  .box p { margin: 0; }
  .box label { display: grid; gap: 8px; font-size: 14px; color: var(--grey); text-transform: none; }
  .box input[type=email], .box input[type=text] { text-transform: none; font-size: 17px; color: var(--white); background: transparent; border: 1px solid var(--rule); border-radius: 14px; min-height: 50px; padding: 0 16px; }
  .box input:focus { outline: 2px solid var(--white); outline-offset: 1px; }
  .box .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .box .check { display: flex; gap: 10px; align-items: flex-start; font-size: 15px; color: var(--grey); }
  .box .check input { margin-top: 5px; }
  .linkish { background: none; border: 0; color: var(--grey); text-decoration: underline; cursor: pointer; padding: 0; font-size: 14px; }
  .when { font-family: var(--serif); font-size: 30px; line-height: 1.2; color: var(--white); text-transform: none; }
  .err { color: #F2A28B; min-height: 1.2em; text-transform: none; }
  .ok { color: var(--white); }
  [hidden] { display: none !important; }
`;

/** The page. `captchaKey`: a Turnstile site key, or "" for none. */
export function deleteAccountHtml(o: { nonce: string; graceDays: number; captchaKey?: string }): string {
  const days = o.graceDays;
  const captcha = (o.captchaKey ?? "").trim();
  const list = (items: string[]) => `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
  const main = `<article class="prose del">
<p class="eye">Your account</p>
<h1>Delete your X0 Bot account</h1>
<p class="lede">You can delete your X0 Bot account here without the app. Sign in with the email address on your account, and ask for it to be deleted. It is deleted ${days} days later, so you have ${days} days to change your mind.</p>

<div class="box" id="flow" aria-live="polite">
  <div id="s-email">
    <label>Your account's email address
      <input id="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" maxlength="254"></label>
    ${captcha ? `<div id="captcha" data-sitekey="${esc(captcha)}"></div>` : ""}
    <p class="row" style="margin-top:14px"><button class="btn" id="send" type="button">Email me a code</button></p>
    <p class="meta" style="margin-top:10px;font-size:14px;color:var(--dim)">We'll email you a code to sign in. This page never makes a new account.</p>
  </div>
  <div id="s-code" hidden>
    <p>If an account uses <strong id="sent-to"></strong>, we've emailed it a code. It can take a minute.</p>
    <label>The code from the email
      <input id="code" type="text" autocomplete="one-time-code" inputmode="numeric" placeholder="123456" maxlength="10"></label>
    <p class="row"><button class="btn" id="verify" type="button">Sign in</button>
      <button class="linkish" id="resend" type="button">Send a new code</button>
      <button class="linkish" id="other" type="button">Use another email</button></p>
  </div>
  <div id="s-ask" hidden>
    <p>Signed in as <strong id="who"></strong>.</p>
    <p>Your account will be deleted on <strong id="would-go"></strong>. Until then nothing is removed, your bots stop working, and you're signed out everywhere. Sign in before then and choose <strong>Keep my account</strong> to keep everything as it was.</p>
    <label class="check"><input type="checkbox" id="sure"> I understand that after ${days} days my account and everything listed below is deleted for good.</label>
    <p class="row"><button class="btn" id="delete" type="button" disabled>Delete my account</button></p>
  </div>
  <div id="s-set" hidden>
    <p>Your account will be deleted on</p>
    <p class="when" id="goes"></p>
    <p>Until then nothing is removed and your bots are stopped. Changed your mind? Sign in to the app, or here, before that day and choose <strong>Keep my account</strong>.</p>
    <p class="row"><button class="btn" id="keep" type="button">Keep my account</button></p>
  </div>
  <div id="s-kept" hidden>
    <p class="ok">Your account is kept, as it was. Your bots work again.</p>
  </div>
  <p class="err" id="err" role="alert"></p>
</div>

<h2>How it works</h2>
<ol>
  <li>Enter the email address you sign in to X0 Bot with, and we email you a code.</li>
  <li>Enter the code to sign in, then choose <strong>Delete my account</strong>.</li>
  <li>Your account is deleted ${days} days later. Until then you can sign in and choose <strong>Keep my account</strong>, here or in the app.</li>
</ol>
<p>In the app, the same is under <strong>You, Delete account</strong>. Signed up with your phone number, or can't get the code? Email <a href="mailto:privacy@x0bot.com">privacy@x0bot.com</a> from your account's address, or tell us the number, and we'll delete it for you.</p>

<h2>What is deleted</h2>
<p>After the ${days} days, for good:</p>
${list(DELETED)}

<h2>What is kept</h2>
${list(KEPT)}
<p>More in our <a href="/privacy">privacy policy</a>. X0 Bot is made by XOOTEQ LAB PRIVATE LIMITED.</p>
</article>`;

  // The flow: the code and the session stay in this page's memory only; nothing is written to the browser.
  const script = `(function(){
var $=function(id){return document.getElementById(id)};var token="",email="";
var steps=["s-email","s-code","s-ask","s-set","s-kept"];
function show(id){steps.forEach(function(s){$(s).hidden=s!==id});err("")}
function err(t){$("err").textContent=t||""}
function day(ms){return new Date(ms).toLocaleDateString(undefined,{day:"numeric",month:"long",year:"numeric"})}
function api(method,path,body){var h={"content-type":"application/json"};if(token)h.authorization="Bearer "+token;
 return fetch(path,{method:method,headers:h,body:body===undefined?undefined:JSON.stringify(body),credentials:"omit"}).then(function(r){
  return r.text().then(function(t){var j={};try{j=JSON.parse(t)}catch(e){}j.status=r.status;return j})})}
function busy(b,on){b.disabled=on}
function captchaToken(){try{return window.turnstile?window.turnstile.getResponse()||undefined:undefined}catch(e){return undefined}}
function send(){email=$("email").value.trim().toLowerCase();if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){err("That doesn't look like an email address.");return}
 busy($("send"),true);api("POST","/v1/account/deletion/web/code",{email:email,captcha:captchaToken()}).then(function(j){busy($("send"),false);
  if(j.status===200){$("sent-to").textContent=email;show("s-code");$("code").focus()}else err(j.message||"Couldn't send a code. Try again in a minute.")},
  function(){busy($("send"),false);err("Couldn't reach us. Check your connection and try again.")})}
function status(){return api("GET","/v1/account/deletion").then(function(j){
  if(j.status===401){token="";show("s-email");err("Your sign-in here ended. Sign in again with a new code.");return}
  if(j.status!==200){err(j.message||"Couldn't read your account. Try again.");return}
  $("who").textContent=email;
  if(j.scheduled){$("goes").textContent=day(j.scheduled.deleteAt);show("s-set")}else{$("would-go").textContent=day(j.deleteAtIfNow);show("s-ask")}})}
function verify(){var c=$("code").value.replace(/\\D/g,"");if(c.length<6){err("Enter the code from the email.");return}
 busy($("verify"),true);api("POST","/v1/account/deletion/web/verify",{email:email,code:c}).then(function(j){busy($("verify"),false);
  if(j.status===200&&j.token){token=j.token;$("code").value="";return status()}err(j.message||"That code didn't work. Check it, or send a new one.")},
  function(){busy($("verify"),false);err("Couldn't reach us. Check your connection and try again.")})}
function del(){busy($("delete"),true);api("POST","/v1/account/deletion").then(function(j){busy($("delete"),false);
  if(j.status===202&&j.scheduled){$("goes").textContent=day(j.scheduled.deleteAt);show("s-set")}
  else if(j.status===401){token="";show("s-email");err("Your sign-in here ended. Sign in again with a new code.")}
  else err(j.message||"Couldn't delete the account. Try again.")},function(){busy($("delete"),false);err("Couldn't reach us. Check your connection and try again.")})}
function keep(){busy($("keep"),true);api("DELETE","/v1/account/deletion").then(function(j){busy($("keep"),false);
  if(j.status===200){show("s-kept")}
  else if(j.status===401){token="";$("email").value=email;show("s-email");err("We signed you out everywhere when you asked to delete. To keep your account, sign in again with a new code.")}
  else err(j.message||"Couldn't keep the account. Try again.")},function(){busy($("keep"),false);err("Couldn't reach us. Check your connection and try again.")})}
$("send").onclick=send;$("email").onkeydown=function(e){if(e.key==="Enter")send()};
$("verify").onclick=verify;$("code").onkeydown=function(e){if(e.key==="Enter")verify()};
$("resend").onclick=send;$("other").onclick=function(){show("s-email");$("email").focus()};
$("sure").onchange=function(){$("delete").disabled=!$("sure").checked};
$("delete").onclick=del;$("keep").onclick=keep;
${captcha ? `var s=document.createElement("script");s.src="${TURNSTILE}/turnstile/v0/api.js?onload=tzCaptcha&render=explicit";s.async=true;
window.tzCaptcha=function(){try{window.turnstile.render("#captcha",{sitekey:$("captcha").getAttribute("data-sitekey")})}catch(e){}};document.head.appendChild(s);` : ""}
})();`;

  return siteShell({
    title: "Delete your account",
    path: "/delete-account",
    description: "Delete your X0 Bot account without the app: sign in with your email, ask for deletion, and change your mind within 7 days.",
    noindex: true,
    pixel: false,
    css: CSS,
    main,
    script,
    nonce: o.nonce,
  });
}
