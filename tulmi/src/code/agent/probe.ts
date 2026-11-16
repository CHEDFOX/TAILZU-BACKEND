/**
 * THE PROBE: ONE SCRIPT, RUN INSIDE THE PAGE, THAT COLLECTS WHAT ONLY A REAL BROWSER KNOWS.
 *
 * The floor (floor.ts) reads the page's HTML, which is free and works everywhere but can only see what is written down. The things that actually
 * decide whether a page is usable are not written down anywhere: what colour the text CAME OUT, whether anything is visible when you tab to it,
 * whether the layout survives a phone, whether the motion stops when the person has asked for less of it. Those exist only once a browser has done
 * layout and resolved the cascade — so this is the one thing in the design layer that needs a real Chrome, and it says so when it cannot have one.
 *
 * THIS FILE COLLECTS; IT DOES NOT JUDGE. The script returns measurements, and `coherence.ts` reads them in Node, where the reasoning can be tested
 * without a browser at all. That split is deliberate: a page script is the worst possible place to put logic, because nothing in it can be unit
 * tested and every mistake is invisible until a real page hits it. So the script is dumb on purpose — walk, read, count, return — and every
 * judgement (what counts as off-scale, which colours are the same colour, where the grid is) happens in TypeScript with tests around it.
 *
 * WHAT IT MEASURES, and why each one needs the browser:
 *
 *   animations     `document.getAnimations()` AFTER prefers-reduced-motion has been emulated. Nothing else can answer "does this page actually
 *                  stop moving when asked": a CSS grep finds the media query, not whether it covers the animation that is still running. No
 *                  packaged tool does this — Lighthouse has no such audit
 *   focus          for each focusable: read its styles, focus it, read them again, and require a MEASURABLE difference. The author's CSS merely
 *                  mentioning `outline` proves nothing; only the before-and-after does
 *   overflow       the document scrolling sideways at phone width, and which element sticks out. A static read cannot know
 *   text           the size, weight and resolved colours of text AS DRAWN, with its character count, so "too small" can be weighed by how much
 *                  text it is rather than by how many elements
 *   styles         every computed value actually used, counted. CSS source over-counts (dead rules, framework defaults nobody reached) and
 *                  under-counts (anything a script set). What the person sees is the computed value, so that is what is counted
 *   rects          the box of every visible block, which is the input the 2003 layout-aesthetics work wanted and never had: it approximated
 *                  these from pixels. A browser knows them exactly, and knows which element each one is
 *
 * SAFETY. The script reads; it never clicks, submits, navigates or writes to the page, and the one thing it does touch — focus — is put back where
 * it was, as is the scroll position. It is bounded everywhere (`LIMITS`), because a page with 50,000 nodes must not hang a job. It returns a plain
 * object and swallows its own errors per-section, so one unreadable corner of a page costs that corner and not the whole measurement.
 */

/** How much of a page the probe will look at. A job is not a crawler: these are the bounds that keep it a few milliseconds. */
export const LIMITS = {
  /** Elements walked for computed styles. */
  elements: 4_000,
  /** Focusable elements actually focused and compared. */
  focus: 60,
  /** Text-bearing leaves measured. */
  text: 1_200,
  /** Boxes kept for the grid. */
  rects: 600,
  /** Animations reported. */
  animations: 40,
  /** Elements named as sticking out sideways. */
  overflow: 10,
} as const;

/** A measured animation that was still running after the page was asked for less motion. */
export interface ProbeAnimation {
  /** A short selector for the element it is on. */
  at: string;
  /** Milliseconds, or null when the browser would not say. */
  ms: number | null;
  /** True when it never stops. */
  forever: boolean;
  name: string;
}

/** One focusable element, and whether anything visibly happened when it was focused. */
export interface ProbeFocus {
  at: string;
  /** What changed when it took focus: "outline", "box-shadow", "border", "background", "size", or "" for nothing at all. */
  changed: string;
  /** Whether the browser itself considers it focus-visible (so a mouse-only :focus is not counted as a keyboard ring). */
  visible: boolean;
}

/** A run of text as it was drawn. */
export interface ProbeText {
  px: number;
  weight: number;
  chars: number;
  /** Resolved colours, "r,g,b". Empty when they could not be resolved. */
  fg: string;
  bg: string;
  at: string;
}

/** The box of one visible block, for the grid. */
export interface ProbeRect { x: number; y: number; w: number; h: number; at: string }

/** Everything one run of the probe collected. Every field can be empty: a section that threw costs that section only. */
export interface ProbeResult {
  /** The size the page was measured at. */
  viewport: { w: number; h: number };
  /** The document's own scrolling width against the viewport: sideways scroll at this width when wider. */
  doc: { scrollWidth: number; clientWidth: number };
  /** Elements whose box crosses the right edge, worst first. */
  overflow: Array<{ at: string; px: number }>;
  /** Only filled when the probe was run with reduced motion emulated. */
  animations: ProbeAnimation[];
  focus: ProbeFocus[];
  text: ProbeText[];
  /** Every computed value actually used, with how many elements used it: "16px" -> 231. */
  styles: {
    color: Record<string, number>;
    background: Record<string, number>;
    fontSize: Record<string, number>;
    fontFamily: Record<string, number>;
    weight: Record<string, number>;
    radius: Record<string, number>;
    shadow: Record<string, number>;
    spacing: Record<string, number>;
    duration: Record<string, number>;
  };
  rects: ProbeRect[];
  /** How many elements were walked, and whether a limit cut the walk short. */
  walked: number;
  cut: boolean;
  /** What the page itself threw while being measured, per section. Never empty-checked by callers: it is for the log. */
  trouble: string[];
}

/** An empty result, for a probe that could not be run at all. */
export const noProbe = (): ProbeResult => ({
  viewport: { w: 0, h: 0 }, doc: { scrollWidth: 0, clientWidth: 0 }, overflow: [], animations: [], focus: [], text: [],
  styles: { color: {}, background: {}, fontSize: {}, fontFamily: {}, weight: {}, radius: {}, shadow: {}, spacing: {}, duration: {} },
  rects: [], walked: 0, cut: false, trouble: [],
});

/**
 * The script, as source to evaluate in the page. It is an expression (an IIFE) so `Runtime.evaluate` returns its value, and it takes its bounds
 * from here rather than hard-coding them, so the limits above are the only place they are written.
 *
 * `withMotion` asks for the animation pass, which is only meaningful once the caller has emulated `prefers-reduced-motion: reduce` and reloaded:
 * anything still running then is motion the page did not turn off.
 */
export function probeSource(o: { withMotion?: boolean } = {}): string {
  const lim = JSON.stringify(LIMITS);
  const motion = o.withMotion ? "true" : "false";
  return `(function(){
var L=${lim},WANT_MOTION=${motion};
var out={viewport:{w:0,h:0},doc:{scrollWidth:0,clientWidth:0},overflow:[],animations:[],focus:[],text:[],
  styles:{color:{},background:{},fontSize:{},fontFamily:{},weight:{},radius:{},shadow:{},spacing:{},duration:{}},
  rects:[],walked:0,cut:false,trouble:[]};
function oops(where,e){try{out.trouble.push(where+": "+String((e&&e.message)||e).slice(0,160));}catch(_){}}
function bump(m,v){if(!v)return;m[v]=(m[v]||0)+1;}
// A short, human name for an element, for a report a person reads. Never its text: that could carry anything.
function at(el){try{
  var n=el.tagName?el.tagName.toLowerCase():"?";
  if(el.id&&/^[\\w-]{1,40}$/.test(el.id))return n+"#"+el.id;
  var c=(el.getAttribute&&el.getAttribute("class")||"").trim().split(/\\s+/).filter(function(x){return x&&x.length<24;}).slice(0,2).join(".");
  return c?n+"."+c:n;
}catch(e){return "?";}}
function visible(el,cs){try{
  if(cs.display==="none"||cs.visibility==="hidden"||cs.visibility==="collapse")return false;
  if(parseFloat(cs.opacity||"1")<0.05)return false;
  var r=el.getBoundingClientRect();
  return r.width>0.5&&r.height>0.5;
}catch(e){return false;}}
// "rgb(1, 2, 3)" / "rgba(1,2,3,.5)" -> "1,2,3", and nothing for a colour that is see-through.
function rgb(v){try{
  var m=/rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,/\\s]+([\\d.]+))?/i.exec(v||"");
  if(!m)return "";
  if(m[4]!==undefined&&parseFloat(m[4])<0.1)return "";
  return Math.round(+m[1])+","+Math.round(+m[2])+","+Math.round(+m[3]);
}catch(e){return "";}}
// What is actually behind this text: the nearest ancestor that paints something.
function behind(el){try{
  for(var p=el;p&&p.nodeType===1;p=p.parentElement){
    var c=getComputedStyle(p);
    if(c.backgroundImage&&c.backgroundImage!=="none")return "";
    var s=rgb(c.backgroundColor);
    if(s)return s;
  }
  return "255,255,255";
}catch(e){return "";}}

try{out.viewport={w:innerWidth,h:innerHeight};
  out.doc={scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth};}catch(e){oops("viewport",e);}

// ---- the walk: computed styles, text as drawn, boxes, and what sticks out sideways
var all=[];
try{all=Array.prototype.slice.call(document.body?document.body.querySelectorAll("*"):[],0,L.elements);
  out.cut=!!(document.body&&document.body.querySelectorAll("*").length>L.elements);}catch(e){oops("walk",e);}
var over=[];
for(var i=0;i<all.length;i++){
  var el=all[i];
  try{
    var cs=getComputedStyle(el);
    if(!visible(el,cs))continue;
    out.walked++;
    var r=el.getBoundingClientRect();
    bump(out.styles.color,rgb(cs.color));
    bump(out.styles.background,rgb(cs.backgroundColor));
    bump(out.styles.fontSize,cs.fontSize);
    bump(out.styles.fontFamily,(cs.fontFamily||"").split(",")[0].replace(/["']/g,"").trim());
    bump(out.styles.weight,cs.fontWeight);
    if(cs.borderRadius&&cs.borderRadius!=="0px")bump(out.styles.radius,cs.borderRadius);
    if(cs.boxShadow&&cs.boxShadow!=="none")bump(out.styles.shadow,cs.boxShadow);
    var sp=[cs.paddingTop,cs.paddingRight,cs.paddingBottom,cs.paddingLeft,cs.marginTop,cs.marginBottom,cs.rowGap,cs.columnGap];
    for(var k=0;k<sp.length;k++){var v=sp[k];if(v&&v!=="0px"&&v!=="normal"&&/px$/.test(v))bump(out.styles.spacing,v);}
    if(cs.transitionDuration&&cs.transitionDuration!=="0s")bump(out.styles.duration,cs.transitionDuration);
    if(cs.animationDuration&&cs.animationDuration!=="0s")bump(out.styles.duration,cs.animationDuration);
    // The boxes, for the grid: blocks big enough to be structure, not every inline span.
    if(out.rects.length<L.rects&&r.width>=24&&r.height>=8&&cs.display!=="inline"){
      out.rects.push({x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),at:at(el)});
    }
    // Text as drawn: a leaf that carries its own words.
    if(out.text.length<L.text){
      var own="";
      for(var c2=0;c2<el.childNodes.length;c2++){if(el.childNodes[c2].nodeType===3)own+=el.childNodes[c2].nodeValue||"";}
      own=own.replace(/\\s+/g," ").trim();
      if(own.length>0){
        out.text.push({px:parseFloat(cs.fontSize)||0,weight:parseInt(cs.fontWeight,10)||400,chars:own.length,
          fg:rgb(cs.color),bg:behind(el),at:at(el)});
      }
    }
    if(r.right>out.viewport.w+1&&r.width<=out.doc.scrollWidth)over.push({at:at(el),px:Math.round(r.right-out.viewport.w)});
  }catch(e){ /* one unreadable element is one element */ }
}
try{over.sort(function(a,b){return b.px-a.px;});out.overflow=over.slice(0,L.overflow);}catch(e){oops("overflow",e);}

// ---- motion: what is STILL running after the page was asked for less of it
if(WANT_MOTION){try{
  var anims=(document.getAnimations?document.getAnimations():[]).slice(0,L.animations*4);
  for(var a=0;a<anims.length&&out.animations.length<L.animations;a++){
    var an=anims[a],t=null,forever=false,nm="";
    try{var tm=an.effect&&an.effect.getTiming?an.effect.getTiming():null;
      t=tm&&typeof tm.duration==="number"?tm.duration:null;
      forever=!!(tm&&(tm.iterations===Infinity||tm.iterations===null&&false));
      nm=an.animationName||(an.effect&&an.effect.target&&an.transitionProperty)||an.constructor.name||"";}catch(e2){}
    // A transition or animation that still runs long, or never stops, is motion the page did not turn off.
    if(forever||(t!==null&&t>100)){
      var tgt="";try{tgt=an.effect&&an.effect.target?at(an.effect.target):"";}catch(e3){}
      out.animations.push({at:tgt,ms:t,forever:forever,name:String(nm).slice(0,40)});
    }
  }
}catch(e){oops("animations",e);}}

// ---- focus: does anything visibly happen when you tab to it
try{
  var was=document.activeElement,sx=scrollX,sy=scrollY;
  var f=Array.prototype.slice.call(document.querySelectorAll(
    'a[href],button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])'),0,L.focus);
  for(var j=0;j<f.length;j++){
    var e2l=f[j];
    try{
      var c0=getComputedStyle(e2l);
      if(!visible(e2l,c0))continue;
      if(e2l.disabled)continue;
      var b={o:c0.outlineStyle+" "+c0.outlineWidth+" "+c0.outlineColor,s:c0.boxShadow,bd:c0.borderColor+" "+c0.borderWidth,bg:c0.backgroundColor};
      var r0=e2l.getBoundingClientRect();
      e2l.focus({preventScroll:true});
      var c1=getComputedStyle(e2l),r1=e2l.getBoundingClientRect();
      var how="";
      if((c1.outlineStyle+" "+c1.outlineWidth+" "+c1.outlineColor)!==b.o&&c1.outlineStyle!=="none"&&parseFloat(c1.outlineWidth)>0)how="outline";
      else if(c1.boxShadow!==b.s&&c1.boxShadow!=="none")how="box-shadow";
      else if((c1.borderColor+" "+c1.borderWidth)!==b.bd)how="border";
      else if(c1.backgroundColor!==b.bg)how="background";
      else if(Math.abs(r1.width-r0.width)>0.5||Math.abs(r1.height-r0.height)>0.5)how="size";
      var vis=false;try{vis=e2l.matches(":focus-visible");}catch(e4){vis=true;}
      out.focus.push({at:at(e2l),changed:how,visible:vis});
    }catch(e5){ /* one element that will not take focus is one element */ }
  }
  try{if(was&&was.focus)was.focus({preventScroll:true});else if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();}catch(e6){}
  try{scrollTo(sx,sy);}catch(e7){}
}catch(e){oops("focus",e);}

return out;})()`;
}

// ------------------------------------------------------------------ running it

/** What the probe needs of a browser: open an address, draw it at a size, optionally lie about reduced motion, and run one expression in it. */
export type ProbeRender = (url: string, o: {
  timeoutMs?: number;
  blockResources?: boolean;
  viewport?: { width: number; height: number; mobile?: boolean };
  reducedMotion?: boolean;
  script?: string;
}) => Promise<{ value?: unknown }>;

/** The phone the overflow pass measures at: the narrowest width WCAG's reflow rule asks a page to survive. */
export const PHONE_WIDTH = 320;
export const PHONE_HEIGHT = 720;

const merge = (base: ProbeResult, extra: Partial<ProbeResult>): ProbeResult => ({ ...base, ...extra, trouble: [...base.trouble, ...(extra.trouble ?? [])] });
const asResult = (v: unknown): ProbeResult | null => (v && typeof v === "object" && Array.isArray((v as ProbeResult).text) ? v as ProbeResult : null);

/**
 * Measures a page, in TWO passes, because the two questions need the page drawn differently.
 *
 *   1. at the size the person will use (the phone, where things actually break): everything — styles, text, boxes, focus, overflow
 *   2. the same page with reduced motion emulated from before it loaded: ONLY what is still moving
 *
 * The second pass needs its own load — emulating the media feature after the fact would miss everything the page already started — so it is a
 * second render of the same address, and it is skipped when the first found nothing to measure. Images and fonts are NOT blocked: a page measured
 * without its fonts has the wrong text sizes and the wrong boxes, which would make every number here a lie.
 *
 * Never throws. A browser that cannot do this returns an empty result with the reason in `trouble`, and the caller says so once.
 */
export async function runProbe(render: ProbeRender, url: string, o: { viewport?: { width: number; height: number; mobile?: boolean }; timeoutMs?: number } = {}): Promise<ProbeResult> {
  const viewport = o.viewport ?? { width: PHONE_WIDTH, height: PHONE_HEIGHT, mobile: true };
  const common = { blockResources: false, viewport, ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) };
  let first: ProbeResult;
  try {
    const got = await render(url, { ...common, script: probeSource() });
    const r = asResult(got.value);
    if (!r) return merge(noProbe(), { trouble: ["the page was drawn but the measurement did not come back"] });
    first = r;
  } catch (err) {
    return merge(noProbe(), { trouble: [`the page could not be opened for measuring: ${String((err as Error)?.message ?? err).slice(0, 160)}`] });
  }
  // What is still moving once the page has been asked for less of it.
  try {
    const got = await render(url, { ...common, reducedMotion: true, script: probeSource({ withMotion: true }) });
    const r = asResult(got.value);
    if (r) return merge(first, { animations: r.animations, trouble: r.trouble });
  } catch { /* the first pass is still a measurement */ }
  return first;
}
