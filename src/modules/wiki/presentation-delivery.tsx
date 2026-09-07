import { withoutPresentationSources } from "./lib/presentation-source";
import fs from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { renderStaticHtml } from "@/lib/render-static-html";
import { db } from "@/db";
import { wikiPresentations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAttachment, getAttachmentAbsolutePath } from "@/lib/files";
import { parsePresentationCanvas, parsePresentationSteps, normalizeSteps, presentationCameraBounds, presentationCameraStep, presentationHiddenIds, stepTarget, unionBounds, type PresentationSnapshot } from "./lib/presentation";
import { PresentationContent } from "./components/presentation-content";
import { presentationIdForToken } from "./presentation-access";

export const presentationMediaIds = (snapshot: PresentationSnapshot) => new Set(snapshot.elements.flatMap((element) => "attachmentId" in element.content ? [element.content.attachmentId] : []));
export function publicPresentation(token: string): PresentationSnapshot | null {
  const id = presentationIdForToken(token);
  const row = id ? db.select().from(wikiPresentations).where(eq(wikiPresentations.id, id)).get() : null;
  if (!row) return null;
  const canvas = parsePresentationCanvas(row.elementsJson);
  return withoutPresentationSources({ ...canvas, title: row.title, steps: normalizeSteps(parsePresentationSteps(row.pathJson), canvas.elements).map((step) => ({ ...step, notes: undefined })) });
}

export async function offlinePresentationMedia(snapshot: PresentationSnapshot) {
  const urls: Record<string, string> = {};
  let size = 0;
  for (const id of presentationMediaIds(snapshot)) {
    const row = getAttachment(id);
    if (!row || !/^(image|audio|video)\//.test(row.mimeType)) throw new Error("Presentation media unavailable");
    size += row.sizeBytes;
    if (size > 100 * 1024 * 1024) throw new Error("Offline media exceeds 100 MB");
    let bytes = await fs.readFile(getAttachmentAbsolutePath(row.storedName));
    if (row.mimeType === "image/svg+xml" && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes, { maxOutputLength: 10 * 1024 * 1024 });
    urls[id] = `data:${row.mimeType};base64,${bytes.toString("base64")}`;
  }
  return urls;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
export type DeliveryLabels = { previous: string; next: string; overview: string; play: string; pause: string; fullscreen: string; noSteps: string };

/** A complete local-file player. No cookies, application code, network fonts or CDN. */
export function renderPresentationHtml(snapshot: PresentationSnapshot, media: (id: string) => string, labels: DeliveryLabels, locale: string) {
  const ordered = [...snapshot.elements.filter((element) => element.type === "frame"), ...snapshot.elements.filter((element) => element.type !== "frame")];
  const allBounds = unionBounds(snapshot.elements.map(presentationCameraBounds)) ?? { x: 0, y: 0, width: 960, height: 540 };
  const scenes = snapshot.steps.map((step, index) => {
    const camera = presentationCameraStep(snapshot.steps, index);
    const target = camera ? stepTarget(camera, snapshot.elements) : null;
    return { bounds: target ? presentationCameraBounds(target) : allBounds, hidden: [...presentationHiddenIds(snapshot.elements, snapshot.steps, index)], duration: step.durationMs ?? snapshot.settings.defaultStepDurationMs, animation: step.animationMs ?? 300 };
  });
  const payload = JSON.stringify({ scenes, allBounds, settings: snapshot.settings, labels, targets: snapshot.elements.map((element) => ({ id: element.id, bounds: presentationCameraBounds(element), step: snapshot.steps.findIndex((step) => step.elementId === element.id && (!step.action || step.action === "camera")) })) }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const body = renderStaticHtml(<div id="scene">{ordered.map((element) => <div key={element.id} data-element={element.id} style={{ position: "absolute", left: element.x, top: element.y, width: element.width, height: element.height, transform: `rotate(${element.rotation}deg)`, backgroundColor: element.background || undefined }}><PresentationContent element={element} mediaUrl={media} /></div>)}</div>);
  return `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(snapshot.title)}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;color:#172033;background:${/^#[a-f\d]{3,8}$/i.test(snapshot.background) ? snapshot.background : "#fff"}}#viewport{position:fixed;inset:0;overflow:hidden;touch-action:none}#scene{position:absolute;transform-origin:0 0}#controls{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;width:max-content;max-width:96vw;padding:8px;border:1px solid #ccd0da;border-radius:16px;background:#fffffff2}button{padding:8px 10px;border:1px solid #ccd0da;border-radius:6px;background:white;cursor:pointer}button:disabled{opacity:.4;cursor:default}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #6366f1}#counter{min-width:60px;text-align:center;font-size:13px}details{font-size:12px}#no-steps{position:fixed;top:12px;left:12px;background:white;padding:10px}[data-element]{transition-property:opacity}video,audio{max-width:100%}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><main id="viewport" aria-label="${escapeHtml(snapshot.title)}">${body}</main>${!scenes.length ? `<p id="no-steps">${escapeHtml(labels.noSteps)}</p>` : ""}<nav id="controls" aria-label="${escapeHtml(snapshot.title)}"><button id="previous">${escapeHtml(labels.previous)}</button><span id="counter" role="status" aria-live="polite"></span><button id="next">${escapeHtml(labels.next)}</button><button id="overview">${escapeHtml(labels.overview)}</button><button id="play">${escapeHtml(labels.play)}</button><button id="fullscreen">${escapeHtml(labels.fullscreen)}</button></nav><script id="presentation-data" type="application/json">${payload}</script><script>
(()=>{"use strict";const d=JSON.parse(document.getElementById('presentation-data').textContent),scene=document.getElementById('scene'),viewport=document.getElementById('viewport'),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;let index=0,x=0,y=0,zoom=1,playing=false,timer=null,drag=null,moved=false,downTarget=null;
const button=id=>document.getElementById(id);const transform=()=>{scene.style.transform='translate('+x+'px,'+y+'px) scale('+zoom+')'};
function fit(b,animate=true){zoom=Math.min(innerWidth/(b.width*1.24),(innerHeight-65)/(b.height*1.24));x=innerWidth/2-(b.x+b.width/2)*zoom;y=(innerHeight-65)/2-(b.y+b.height/2)*zoom;scene.style.transition=animate&&!reduced?'transform '+d.settings.cameraTransitionMs+'ms '+(d.settings.cameraEasing==='ease-out-back'?'cubic-bezier(.34,1.56,.64,1)':d.settings.cameraEasing):'none';transform()}
function schedule(){clearTimeout(timer);if(!playing||!d.scenes.length)return;timer=setTimeout(()=>{if(index<d.scenes.length-1)show(index+1);else if(d.settings.loop)show(0);else toggle(false)},d.scenes[index].duration)}
function toggle(value){playing=value;button('play').textContent=playing?d.labels.pause:d.labels.play;schedule()}
function show(next){index=Math.max(0,Math.min(next,d.scenes.length-1));const state=d.scenes[index];fit(state?state.bounds:d.allBounds);scene.querySelectorAll('[data-element]').forEach(el=>{const hidden=state&&state.hidden.includes(el.dataset.element);el.style.transitionDuration=(reduced?0:state?state.animation:300)+'ms';el.style.opacity=hidden?'0':'1';el.style.pointerEvents=hidden?'none':'';el.inert=!!hidden;if(hidden)el.querySelectorAll('audio,video').forEach(media=>media.pause())});button('counter').textContent=d.scenes.length?(index+1)+' / '+d.scenes.length:'0 / 0';button('previous').disabled=index<=0;button('next').disabled=index>=d.scenes.length-1;button('play').disabled=!d.scenes.length;schedule()}
button('previous').onclick=()=>show(index-1);button('next').onclick=()=>show(index+1);button('overview').onclick=()=>{toggle(false);fit(d.allBounds)};button('play').onclick=()=>{if(!playing&&index===d.scenes.length-1)show(0);toggle(!playing)};button('fullscreen').onclick=()=>{const task=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();task.catch(()=>{})};
document.addEventListener('keydown',event=>{if(event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,textarea,select,a,button,video,audio,summary'))return;if(['ArrowRight','PageDown',' '].includes(event.key)){event.preventDefault();show(index+1)}if(['ArrowLeft','PageUp'].includes(event.key)){event.preventDefault();show(index-1)}if(event.key==='Home'){event.preventDefault();fit(d.allBounds)}});
viewport.addEventListener('wheel',event=>{if(event.target.closest('audio,video,details'))return;event.preventDefault();const next=Math.max(.005,Math.min(20,zoom*Math.exp(-event.deltaY*.001)));x=event.clientX-(event.clientX-x)*next/zoom;y=event.clientY-(event.clientY-y)*next/zoom;zoom=next;scene.style.transition='none';transform()},{passive:false});
viewport.addEventListener('pointerdown',event=>{if(event.target.closest('a,audio,video,details'))return;downTarget=event.target;drag={px:event.clientX,py:event.clientY,x,y};moved=false;viewport.setPointerCapture(event.pointerId)});viewport.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.px,dy=event.clientY-drag.py;if(Math.abs(dx)+Math.abs(dy)>4)moved=true;x=drag.x+dx;y=drag.y+dy;scene.style.transition='none';transform()});viewport.addEventListener('pointerup',()=>{drag=null});viewport.addEventListener('pointercancel',()=>{drag=null});
viewport.addEventListener('click',event=>{if(moved||event.target.closest('a,audio,video,details'))return;const element=(event.target===viewport&&downTarget?downTarget:event.target).closest('[data-element]'),target=element&&d.targets.find(t=>t.id===element.dataset.element);if(target){toggle(false);if(target.step>=0)show(target.step);else fit(target.bounds)}else show(index+1)});addEventListener('resize',()=>fit(d.scenes[index]?d.scenes[index].bounds:d.allBounds,false));show(0)})();
</script></body></html>`;
}
