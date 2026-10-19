/* FinalBurn Neo (the core Fightcade uses for netplay), pinned to the EmulatorJS stable 2025-06-14 build. */
(()=>{
 try{if(navigator.audioSession)navigator.audioSession.type='playback'}catch{}
 /* Safari only frees the emulator's per-frame garbage (sound clips, frame uploads) when its JavaScript heap grows, and the
    emulator allocates almost nothing there. Left alone, the page's memory climbed ~45 MB a minute until iOS killed it,
    which reloads the page to the main screen. A short-lived buffer every half second keeps collections running:
    measured in WebKit, memory then stays flat (~285 MB) with no change in frame rate. */
 let gcNudge=null;setInterval(()=>{gcNudge=new ArrayBuffer(8<<20);new Uint8Array(gcNudge)[0]=1},500);
 let ready=false,starting=null,url=null;
 /* Online play advances the emulator one frame at a time. Emscripten schedules every main-loop tick through
    requestAnimationFrame or setTimeout with a function named MainLoop_runner; while locked, those ticks are held
    here and run only when step() asks for the next frame. */
 const realRAF=window.requestAnimationFrame.bind(window),realTimeout=window.setTimeout.bind(window);let locked=false,held=[];
 const isRunner=cb=>typeof cb==='function'&&cb.name==='MainLoop_runner';
 window.requestAnimationFrame=cb=>{if(locked&&isRunner(cb)){held.push(cb);return 1}return realRAF(cb)};
 window.setTimeout=(cb,ms,...rest)=>{if(locked&&isRunner(cb)){held.push(cb);return 0}return realTimeout(cb,ms,...rest)};
 function tick(){const due=held;held=[];for(const cb of due)cb(performance.now())}
 /* Our button bits → FBNeo's RetroPad layout for six-button fighters (Y X L = punches, B A R = kicks). */
 const RETRO=[1,10,2,3,4,5,6,7,9,0,8,11];
 const originalContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,opts){return originalContext.call(this,type,(type==='webgl'||type==='webgl2'||type==='experimental-webgl')?{...opts,preserveDrawingBuffer:true}:opts)};
 const masks=[0,0],desired=[0,0],forced=[0,0];let pausedState=true,localGain=null,level=1,health=null,healthTimer=null,onHit=null;const draining=[0,0];
 Object.defineProperty(navigator,'getGamepads',{value:()=>[]});
 /* Life bars, read from the screen: the sampled row crosses both bars at native 384×224 scale.
    Each bar's yellow part is anchored at the KO badge and shrinks outward, so a shorter run means damage. */
 const BAR={y:.112,p1:[.084,.457],p2:[.548,.918]},probe=document.createElement('canvas');probe.width=192;probe.height=1;const probeCtx=probe.getContext('2d',{willReadFrequently:true});
 const yellow=(d,i)=>d[i]>200&&d[i+1]>170&&d[i+2]<110;
 function barRun(d,[from,to],inward){const a=Math.round(from*192),b=Math.round(to*192),len=b-a;let run=0;if(inward){for(let x=b-1;x>=a&&yellow(d,x*4);x--)run++}else{for(let x=a;x<b&&yellow(d,x*4);x++)run++}return run/len}
 function readHealth(){if(!ready||pausedState||!onHit)return;const c=EJS_emulator.canvas;if(!c?.height)return;probeCtx.imageSmoothingEnabled=false;probeCtx.drawImage(c,0,Math.floor(c.height*BAR.y),c.width,1,0,0,192,1);const d=probeCtx.getImageData(0,0,192,1).data;
  /* p1's bar is anchored at its right end, p2's at its left end. */
  const now=[barRun(d,BAR.p1,true),barRun(d,BAR.p2,false)];const prev=health;health=now;if(!prev)return;
  /* The game drains a bar over several frames after each hit: one rumble when the drain starts, none while it continues. */
  const t=performance.now();for(const p of [0,1]){const drop=prev[p]-now[p];if(drop<=0)continue;const ko=now[p]===0&&prev[p]<.5&&now[1-p]>0;/* Ignore scene changes: a real hit leaves the bar on screen. */if(!ko&&(drop<.012||drop>=.5||now[p]===0))continue;const fresh=t-draining[p]>220;draining[p]=t;if(ko)onHit(p,1);else if(fresh)onHit(p,now[p]<.25?.65:.45)}}
 window.arcade={
 get ready(){return ready},get masks(){return [...masks]},
 async start(blob){if(starting)return starting;starting=new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('The arcade took too long to load. Reload and try again.')),60000);
  url=URL.createObjectURL(blob);
  Object.assign(window,{EJS_player:'#game',EJS_core:'fbneo',EJS_gameUrl:url,EJS_gameName:'ssf2tur1.zip',EJS_pathtodata:'vendor/emulator/',EJS_startOnLoaded:true,EJS_forceLegacyCores:true,EJS_language:'en-US',EJS_disableAutoLang:false,EJS_disableDatabases:true,EJS_disableLocalStorage:true,EJS_noAutoFocus:true,EJS_volume:.75,EJS_VirtualGamepadSettings:[],EJS_Buttons:{playPause:false,restart:false,saveState:false,loadState:false,gamepad:false,cheat:false,volume:false,settings:false,fullscreen:false,exitEmulation:false},EJS_defaultControls:{0:{},1:{},2:{},3:{}},EJS_defaultOptions:{'shader':'disabled','virtual-gamepad':'disabled','fbneo-frameskip-type':'disabled','fbneo-samplerate':'44100','fbneo-hiscores':'disabled'},EJS_onGameStart:()=>{
   clearTimeout(timeout);ready=true;URL.revokeObjectURL(url);EJS_emulator.elements?.menuToggle?.style?.setProperty('display','none','important');const al=EJS_emulator.Module?.AL?.currentCtx;if(al?.gain&&al.audioCtx){try{al.gain.disconnect(al.audioCtx.destination);localGain=al.audioCtx.createGain();localGain.gain.value=level;al.gain.connect(localGain);localGain.connect(al.audioCtx.destination)}catch{localGain=null}}const gm=EJS_emulator.gameManager;gm.functions.setKeyboardEnabled?.(0);gm.functions.setFastForwardRatio(4);gm.functions.toggleFastForward(1);const bootDeadline=performance.now()+45000;const boot=setInterval(()=>{if(gm.functions.getFrameNum()>=2000){clearInterval(boot);gm.functions.toggleFastForward(0);resolve()}else if(performance.now()>bootDeadline){clearInterval(boot);gm.functions.toggleFastForward(0);reject(new Error('The arcade is running slowly. Close other tabs and reload.'))}},100);
  }});
  const s=document.createElement('script');s.src='vendor/emulator/loader.js';s.onerror=()=>{clearTimeout(timeout);reject(new Error('Could not load the arcade runtime.'))};document.body.append(s);
 });return starting},
 input(player,value){if(!ready||player<0||player>1)return;desired[player]=value;const mask=value|forced[player];const changed=masks[player]^mask;for(let i=0;i<12;i++)if(changed&(1<<i))EJS_emulator.gameManager.simulateInput(player,RETRO[i],(mask>>i)&1);masks[player]=mask},
 async pulse(player,bit,ms=150){if(!ready)return;const start=performance.now(),frame=EJS_emulator.gameManager.functions.getFrameNum();forced[player]|=bit;this.input(player,desired[player]);await new Promise(resolve=>{const timer=setInterval(()=>{if(pausedState||(performance.now()-start>=ms&&EJS_emulator.gameManager.functions.getFrameNum()-frame>=10)||performance.now()-start>2500){clearInterval(timer);resolve()}},20)});forced[player]&=~bit;this.input(player,desired[player])},
 async frames(count){const start=performance.now(),base=EJS_emulator.gameManager.functions.getFrameNum();await new Promise(resolve=>{const timer=setInterval(()=>{if(pausedState||EJS_emulator.gameManager.functions.getFrameNum()-base>=count||performance.now()-start>6000){clearInterval(timer);resolve()}},20)})},
 pause(paused){pausedState=paused;if(paused){forced[0]=forced[1]=0;this.input(0,0);this.input(1,0)}if(ready)EJS_emulator.gameManager.toggleMainLoop(paused?0:1)},
 async restart(){if(!ready)return;this.pause(true);const gm=EJS_emulator.gameManager;gm.restart();gm.functions.setFastForwardRatio(4);gm.functions.toggleFastForward(1);this.pause(false);const base=gm.functions.getFrameNum(),deadline=performance.now()+45000;await new Promise((resolve,reject)=>{const timer=setInterval(()=>{const frame=gm.functions.getFrameNum();if((frame>=base?frame-base:frame)>=2000){clearInterval(timer);resolve()}else if(performance.now()>deadline){clearInterval(timer);reject(new Error('Restart took too long. Reload the arcade.'))}},100)}).finally(()=>{gm.functions.toggleFastForward(0);this.pause(true)})},
 soundState(){return window.EJS_emulator?.Module?.AL?.currentCtx?.audioCtx?.state||'unavailable'},
 unlock(){const ctx=window.EJS_emulator?.Module?.AL?.currentCtx?.audioCtx;ctx?.resume().catch(()=>{})},
 volume(value){level=Math.max(0,Math.min(1,value));if(!ready)return;if(localGain){localGain.gain.value=level}else{const e=EJS_emulator;e.volume=level;e.setVolume?.(level)}},
 watchHits(callback){onHit=callback;clearInterval(healthTimer);health=null;if(callback)healthTimer=setInterval(readHealth,50)},
 lockstep:{
  /* Hold the main loop; resolves once the next tick is waiting to be stepped. */
  async begin(){locked=true;if(pausedState){pausedState=false;EJS_emulator.gameManager.toggleMainLoop(1)}const until=performance.now()+3000;while(!held.length&&performance.now()<until)await new Promise(r=>realTimeout(r,8));return held.length>0},
  /* Runs one tick with both players' inputs. False when the core produced no frame; retry with the same inputs. */
  step(m0,m1){if(!held.length)return false;window.arcade.input(0,m0);window.arcade.input(1,m1);const gm=EJS_emulator.gameManager,f=gm.functions.getFrameNum();tick();return gm.functions.getFrameNum()!==f},
  state(){return EJS_emulator.gameManager.getState()},
  /* A loaded state takes effect on the next tick, which does not advance the game. */
  load(state){EJS_emulator.gameManager.loadState(state);tick()},
  /* Fingerprint of the game's memory: the first 256 KB of FBNeo's state. Past ~266 KB come sound-chip buffers that
     differ between phones without affecting the game (measured over 3600 frames: never below 266 KB). */
  hash(state){const words=new Uint32Array(state.buffer,state.byteOffset,Math.min(65536,state.length>>2));let h=0x811c9dc5;for(let i=0;i<words.length;i++)h=Math.imul(h^words[i],0x01000193);return (h>>>0).toString(36)},
  end(){locked=false;const due=held;held=[];for(const cb of due)realRAF(cb)},
  get active(){return locked}
 },
 diagnostics(){const e=window.EJS_emulator;return{ready,masks:[...masks],canvas:e?.canvas?{width:e.canvas.width,height:e.canvas.height}:null,audio:!!e?.Module?.AL?.currentCtx?.gain,audioState:this.soundState(),locked,frame:ready?e.gameManager.functions.getFrameNum():0}}
 };
})();
