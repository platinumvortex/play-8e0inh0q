/* Rumble. Android and most browsers: Vibration API. iPhone (iOS 18+): Safari has no Vibration API,
   but toggling a native switch control plays the system haptic. Controllers: gamepad rumble motors. */
export const RUMBLE_MODES=['off','hits','all'];
const iOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
let mode='hits',toggle=null;
try{const saved=localStorage.getItem('turbo-rumble');if(RUMBLE_MODES.includes(saved))mode=saved}catch{}
function iosTick(){if(!toggle){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.setAttribute('switch','');label.setAttribute('aria-hidden','true');label.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';label.append(input);document.body.append(label);toggle=label}toggle.click()}
function pads(strong,weak,ms){for(const gp of navigator.getGamepads?.()||[]){try{gp?.vibrationActuator?.playEffect?.('dual-rumble',{duration:ms,strongMagnitude:strong,weakMagnitude:weak})?.catch?.(()=>{})}catch{}}}
function buzz(pattern,ticks){if(navigator.vibrate){try{navigator.vibrate(pattern)}catch{}}else if(iOS){iosTick();for(let i=1;i<ticks;i++)setTimeout(iosTick,i*70)}}
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
