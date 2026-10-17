export const VERSION = 'turbo-4';
export const PREFIX = 'turbo-arcade-v4-';
/* Four characters without look-alikes (0/O, 1/I/L), so a code can be read out loud. */
export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;
export const BITS = {lp:1<<0,mp:1<<8,hp:1<<1,lk:1<<9,mk:1<<10,hk:1<<11,coin:1<<2,start:1<<3,up:1<<4,down:1<<5,left:1<<6,right:1<<7};
BITS.ppp=BITS.lp|BITS.mp|BITS.hp;BITS.kkk=BITS.lk|BITS.mk|BITS.hk;
export const ALL_INPUTS=0xfff;
export function normalizeMask(mask){mask&=ALL_INPUTS;if((mask&(BITS.left|BITS.right))===(BITS.left|BITS.right))mask&=~(BITS.left|BITS.right);if((mask&(BITS.up|BITS.down))===(BITS.up|BITS.down))mask&=~(BITS.up|BITS.down);return mask;}
export function directionMask(x,y){if(Math.hypot(x,y)<.18)return 0;const a=Math.atan2(y,x);const sector=(Math.round(a/(Math.PI/4))+8)%8;return [BITS.right,BITS.right|BITS.down,BITS.down,BITS.down|BITS.left,BITS.left,BITS.left|BITS.up,BITS.up,BITS.up|BITS.right][sector];}
export function randomCode(){const bytes=crypto.getRandomValues(new Uint8Array(CODE_LENGTH));return Array.from(bytes,b=>ALPHABET[b%ALPHABET.length]).join('');}
export function normalizeCode(text){const code=String(text??'').toUpperCase().replace(/[^A-Z0-9]/g,'');return validCode(code)?code:null}
export function validCode(s){return typeof s==='string'&&s.length===CODE_LENGTH&&[...s].every(c=>ALPHABET.includes(c));}
const session=s=>typeof s==='string'&&/^[a-z0-9]{1,12}$/.test(s),frame=f=>Number.isSafeInteger(f)&&f>=0;
/* State chunks (match sync) may be large; everything else is small. */
export function decodePacket(data){if(typeof data!=='string'||data.length>70000)return null;let m;try{m=JSON.parse(data)}catch{return null}if(!m||typeof m!=='object'||Array.isArray(m)||typeof m.t!=='string')return null;if(m.t!=='sc'&&data.length>2048)return null;
 switch(m.t){case'input':return Number.isSafeInteger(m.seq)&&m.seq>=0&&Number.isInteger(m.mask)&&m.mask>=0&&m.mask<=ALL_INPUTS?m:null;
 case'ping':case'pong':return Number.isFinite(m.at)&&m.at>=0?m:null;
 case'hello':return m.version===VERSION&&typeof m.session==='string'&&/^[a-f0-9]{32}$/.test(m.session)?m:null;
 case'presence':return typeof m.away==='boolean'&&typeof m.paused==='boolean'?m:null;
 case'pause':return typeof m.paused==='boolean'?m:null;
 case'state':return typeof m.paused==='boolean'&&typeof m.started==='boolean'&&typeof m.ready==='boolean'?m:null;
 case'ready':case'accepted':case'bye':case'resume':case'mediaRetry':return m;
 case'reject':return typeof m.reason==='string'&&m.reason.length<200?m:null;
 case'rumble':return (m.hit===0||m.hit===1)&&Number.isFinite(m.amount)&&m.amount>=0&&m.amount<=1?m:null;
 case'li':return session(m.s)&&frame(m.f)&&Array.isArray(m.m)&&m.m.length>=1&&m.m.length<=64&&m.m.every(x=>Number.isInteger(x)&&x>=0&&x<=ALL_INPUTS)&&m.f>=m.m.length-1?m:null;
 case'need':return session(m.s)&&frame(m.f)?m:null;
 case'ck':return session(m.s)&&frame(m.f)&&typeof m.h==='string'&&m.h.length<=16?m:null;
 case'sync':return session(m.id)&&frame(m.f)&&['new','resume','fix'].includes(m.kind)&&Number.isInteger(m.n)&&m.n>=1&&m.n<=64?m:null;
 case'sc':return session(m.id)&&Number.isInteger(m.i)&&m.i>=0&&m.i<64&&typeof m.d==='string'&&/^[A-Za-z0-9+/=]*$/.test(m.d)?m:null;
 case'synced':return session(m.id)?m:null;
 case'countdown':return Number.isInteger(m.value)&&m.value>=0&&m.value<=3?m:null;
 default:return null;}}
export class InputGuard{constructor(){this.reset()}reset(){this.seq=-1;this.mask=0;this.at=0}accept(m,now){if(m.seq<=this.seq)return false;this.seq=m.seq;this.mask=normalizeMask(m.mask);this.at=now;return true}expired(now){return this.mask!==0&&now-this.at>350}}
