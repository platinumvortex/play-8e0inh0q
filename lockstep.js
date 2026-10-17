/* Lockstep netplay. Both phones run the same emulator from the same state and exchange only button presses.
   Frame f runs on a phone once both players' inputs for f are known. Each phone schedules its own input a few
   frames ahead (the input delay), so the other player's input normally arrives before it is needed. */
import {BITS} from './protocol.js';
export const FRAME_MS=1000/59.6375; // CPS2 refresh rate
export const CHECK_EVERY=30;
const SEND=16,KEEP=1800,MIN_DELAY=2,MAX_DELAY=8;
/* Credit, then start, as the player's own button presses, so both phones see the same thing on the same frame. */
export function startMacro(wait=0){return [...Array(wait).fill(0),...Array(6).fill(BITS.coin),...Array(30).fill(0),...Array(8).fill(BITS.start)]}
export function delayFor(rtt){return Math.max(MIN_DELAY,Math.min(MAX_DELAY,Math.round(rtt/2/FRAME_MS)+2))}
export class Lockstep{
 /* engine: {step(m0,m1)→bool, load(state)}; send(packet, reliable); player: 0 (host) or 1 (guest). */
 constructor({engine,send,player,session,delay=3,onCheckpoint=null,onStall=null}){Object.assign(this,{engine,send,player,session,delay,onCheckpoint,onStall});this.running=false}
 start(frame,macro=[]){this.frame=frame;this.inputs=[new Map,new Map];this.macro=[...macro];this.prevStart=false;this.acc=0;this.last=performance.now();this.waitingSince=0;this.needAt=0;this.running=true;
  /* Our first `delay` frames are neutral: nothing was pressed before the match started. */
  this.assigned=frame;const own=this.inputs[this.player];while(this.assigned<frame+this.delay)own.set(++this.assigned,0)}
 stop(){this.running=false}
 setDelay(d){this.delay=Math.max(MIN_DELAY,Math.min(MAX_DELAY,d))}
 pressStart(){if(!this.macro.some(m=>m&BITS.start))this.macro.push(...startMacro())}
 /* Our inputs up to frame+delay. A delay increase fills the gap with the current buttons; a decrease waits. */
 produce(mask){const own=this.inputs[this.player],start=(mask&BITS.start)!==0;if(start&&!this.prevStart)this.pressStart();this.prevStart=start;mask&=~BITS.start;
  while(this.assigned<this.frame+this.delay)own.set(++this.assigned,mask|(this.macro.length?this.macro.shift():0));this.share()}
 /* The latest inputs travel together, so one lost packet costs nothing. */
 share(){const own=this.inputs[this.player],m=[];for(let f=Math.max(this.frame-3,this.assigned-SEND+1);f<=this.assigned;f++)if(own.has(f))m.push(own.get(f));else m.length=0;if(m.length)this.send({t:'li',s:this.session,f:this.assigned,m})}
 receive(f,masks){const remote=this.inputs[1-this.player],first=f-masks.length+1;for(let i=0;i<masks.length;i++){const g=first+i;if(g>this.frame&&!remote.has(g))remote.set(g,masks[i])}}
 /* The other phone missed some of our inputs: resend from f over the reliable channel. */
 resend(f){const own=this.inputs[this.player],m=[];for(let g=f;g<=this.assigned&&m.length<64&&own.has(g);g++)m.push(own.get(g));if(m.length)this.send({t:'li',s:this.session,f:f+m.length-1,m},true)}
 tick(now,mask,paused){if(!this.running)return 0;
  if(paused){this.share();this.last=now;this.acc=0;this.onStall?.(0);return 0}
  this.produce(mask);this.acc+=Math.min(now-this.last,250);this.last=now;let ran=0;
  while(this.acc>=FRAME_MS&&ran<4){const f=this.frame+1;if(!this.inputs[this.player].has(f))this.produce(mask);
   const a=this.inputs[0].get(f),b=this.inputs[1].get(f);
   if(a===undefined||b===undefined){this.waitingSince||=now;if(now-this.waitingSince>120&&now-this.needAt>250){this.needAt=now;this.send({t:'need',s:this.session,f},true)}this.acc=Math.min(this.acc,FRAME_MS*2);break}
   /* No frame from the core this tick: keep the same inputs for the next one. */
   if(!this.engine.step(a,b))break;
   this.waitingSince=0;this.frame=f;this.acc-=FRAME_MS;ran++;
   if(f%CHECK_EVERY===0)this.onCheckpoint?.(f);
   if(f%120===0)this.prune()}
  this.onStall?.(this.waitingSince?now-this.waitingSince:0);return ran}
 /* Adopt the host's state for frame f, then replay the frames we already ran with the inputs we already have. */
 resync(f,state){const target=this.frame;this.engine.load(state);this.frame=f;if(target<=f)return 0;let replayed=0,attempts=(target-f)*4+20;
  while(this.frame<target&&attempts--){const g=this.frame+1,a=this.inputs[0].get(g),b=this.inputs[1].get(g);if(a===undefined||b===undefined)break;if(this.engine.step(a,b)){this.frame=g;replayed++}}return replayed}
 prune(){const keep=this.frame-KEEP;for(const map of this.inputs)for(const f of map.keys())if(f<keep)map.delete(f)}
}
