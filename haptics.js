/* Rumble. Android and most browsers: Vibration API. iPhone (iOS 18+): Safari has no Vibration API,
   but toggling a native switch control plays the system haptic. Controllers: gamepad rumble motors. */
export const RUMBLE_MODES=['off','hits','all'];
const iOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
let mode='hits',pendingAt=0;
try{const saved=localStorage.getItem('turbo-rumble');if(RUMBLE_MODES.includes(saved))mode=saved}catch{}
/* iOS only plays the switch haptic inside a user activation: touchend/pointerup/click/keydown, not touchstart.
   Rumbles raised elsewhere (a press, a hit seen on screen, a packet from the host) wait for the next finger lift. */
function iosTick(){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.setAttribute('switch','');label.setAttribute('aria-hidden','true');label.style.display='none';label.append(input);document.head.append(label);label.click();label.remove()}
const activeGesture=()=>navigator.userActivation?.isActive??false;
function iosRumble(){if(activeGesture())iosTick();else pendingAt=performance.now()}
if(iOS)for(const ev of ['touchend','pointerup','click','keydown'])document.addEventListener(ev,()=>{if(pendingAt&&performance.now()-pendingAt<600)iosTick();pendingAt=0},{capture:true,passive:true});
function pads(strong,weak,ms){for(const gp of navigator.getGamepads?.()||[]){try{gp?.vibrationActuator?.playEffect?.('dual-rumble',{duration:ms,strongMagnitude:strong,weakMagnitude:weak})?.catch?.(()=>{})}catch{}}}
function buzz(pattern,ticks){if(navigator.vibrate){try{navigator.vibrate(pattern)}catch{}}else if(iOS)iosRumble()}
export const haptics={
 get mode(){return mode},
 set mode(value){if(!RUMBLE_MODES.includes(value))return;mode=value;try{localStorage.setItem('turbo-rumble',value)}catch{}},
 supported:()=>!!navigator.vibrate||iOS,
 /* A light tick under the thumb when a control is pressed. */
 tap(){if(mode==='all')buzz(8,1)},
 /* You took a hit: stronger with more damage. */
 hit(amount=.5){if(mode==='off')return;const ms=Math.round(35+90*amount);buzz(amount>.6?[ms,40,ms]:ms,amount>.6?3:amount>.25?2:1);pads(Math.min(1,.4+amount),.8,ms)},
 /* Your attack connected. */
 land(amount=.5){if(mode==='off')return;buzz(Math.round(12+20*amount),1);pads(0,.35+amount*.3,60)},
 test(){const previous=mode;mode='hits';this.hit(.7);mode=previous}
};
