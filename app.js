import {BITS,VERSION,validCode,normalizeCode} from './protocol.js';
const VERSION_LABEL=VERSION+' · 2026-10-19';
import {Controls} from './controls.js';
import {MatchNetwork} from './network.js';
import {Lockstep,startMacro,delayFor,FRAME_MS} from './lockstep.js';
import {getRom,storeRom,validateRom,decryptRom} from './rom.js';
import {haptics} from './haptics.js';
const $=id=>document.getElementById(id),wait=ms=>new Promise(r=>setTimeout(r,ms));
const store={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
const S={role:'host',rom:null,engineReady:false,started:false,paired:false,paused:true,localPause:false,away:document.hidden,remotePause:false,remoteAway:false,guestReady:false,linkHealthy:true,net:null,mask:0,muted:false,volume:.8,audioUnlocked:false,busy:false,startingRound:false,roundPending:false,roundPractice:false,roundEpoch:0,reason:'',fatal:false,page:'home',hostError:'',view:'fit',warnedLag:false,
 /* Online play: both phones run the arcade in lockstep (see lockstep.js). */
 ls:null,syncing:false,joined:false,stallMs:0,syncStarted:0,syncedAt:-1e9,matchStarted:false,syncId:'',needSync:false,rx:null,rtt:0,stalled:false,checks:new Map,snapshots:new Map,guestChecks:new Map,fixing:false};
const startBusy=[false,false];
let toastTimer,framePromise,wakeLock,roomPromise,silentAudio;
const engine=()=>$('emulatorFrame').contentWindow?.arcade;
/* Connection log: what happened and when, for the Connection info screen in the menu. */
const LOG=(()=>{try{return JSON.parse(sessionStorage.getItem('turbo-log')||'[]')}catch{return []}})(),STATS={drops:0,syncs:0,fixes:0,needs:0,stalls:0,longestStall:0,fps:0};let peerLog=[];
function note(text){const d=new Date();LOG.push(d.toTimeString().slice(0,8)+'  '+text);if(LOG.length>120)LOG.shift();try{sessionStorage.setItem('turbo-log',JSON.stringify(LOG))}catch{}if($('infoDialog')?.open)showInfo()}
note('page loaded'+(LOG.length>1?' (again: this phone reloaded)':''));
const me=()=>S.role==='host'?0:1;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000)}
function status(text){$('connectionBadge').title=text}
function badge(text,cls=''){$('connectionBadge').textContent=text;$('connectionBadge').className='pill badge '+cls}
function overlay(title,text='',resume=false){$('screenMessageTitle').textContent=title;$('screenMessageText').textContent=text;$('screenMessage').hidden=false;$('resumeButton').hidden=!resume}
function hideOverlay(){$('screenMessage').hidden=true;$('retryConnection').hidden=true;$('leaveOverlay').hidden=true}
function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>d.close())}
function showDialog(id){closeDialogs();$(id).showModal();controls.release()}
function isPlaying(){return S.started&&!S.paused&&!S.away&&!document.querySelector('dialog[open]')}
function bodyState(){document.body.classList.toggle('playing',isPlaying());document.body.classList.toggle('engine-ready',S.engineReady)}
const controls=new Controls({enabled:isPlaying,change:mask=>{const previous=S.mask;S.mask=mask;if(S.role==='host'&&!online())applyInput(0,mask,previous)},menu:openMenu});
function online(){return !!(S.ls?.running||S.syncing)}
function release(){controls.release();S.mask=0;if(S.engineReady&&!online()){engine().input(0,0);engine().input(1,0)}}
async function acquireWake(){try{if(navigator.wakeLock&&!document.hidden)wakeLock=await navigator.wakeLock.request('screen')}catch{}}
function presence(){if(S.role==='guest')S.net?.send({t:'presence',paused:S.localPause,away:S.away})}
/* Pause reasons are worded for the reader: the host's "your menu" is the guest's "your friend's menu". */
const MIRROR={'Your menu is open':'Your friend opened the menu','Your friend opened the menu':'Your menu is open','Come back to the arcade to continue':'Your friend will be right back','Your friend will be right back':'Come back to the arcade to continue'};
function sendState(){if(S.role==='host')S.net?.send({t:'state',paused:S.paused,started:S.started,ready:S.guestReady,reason:MIRROR[S.reason]??S.reason})}
function pauseReason(){if(S.away)return 'Come back to the arcade to continue';if(S.localPause)return 'Your menu is open';if(S.paired){if(S.remoteAway)return 'Your friend will be right back';if(S.remotePause)return 'Your friend opened the menu';if(!S.net?.connected||!S.linkHealthy)return 'Reconnecting automatically…';if(!S.guestReady)return 'Loading your friend’s arcade…';if(S.syncing)return 'Lining up the two arcades…'}return ''}
function renderPause(){bodyState();if(!S.started)return;if(S.paused)overlay(S.localPause||S.reason.includes('menu')?'PAUSED':'ONE MOMENT',S.reason,S.localPause);else hideOverlay()}
/* Lockstep pauses itself (neither phone runs a frame without the other's input), so the emulator's own loop is only paused offline. */
function updatePause(){if(S.role==='guest')return;S.reason=pauseReason();const paused=!!S.reason,changed=paused!==S.paused;S.paused=paused;if(paused&&changed)release();if(S.engineReady&&changed&&!engine().lockstep.active)engine().pause(paused);renderPause();if(changed)sendState();if(!paused&&S.roundPending)queueMicrotask(startRound)}

/* Lobby: solo, host a room, or join one by code */
function showPage(page){S.page=page;lobby();if(page==='join')setTimeout(()=>$('joinCode').focus(),50);if(page==='host')host()}
function lobby(){const n=S.net,code=n?.code||'····',hosting=S.role==='host'&&!!n;
 for(const el of document.querySelectorAll('.lobby-page'))el.hidden=el.dataset.page!==S.page;
 $('lobby').hidden=S.started||S.role==='guest';
 $('roomCode').textContent=$('roomCodeDialog').textContent=code;$('roomCodeTop').textContent=n?.code||'';$('roomBadge').hidden=!hosting||!S.started;
 $('soloButton').disabled=!S.engineReady||S.busy;$('practiceButton').disabled=!S.engineReady||S.busy;
 $('loadingNote').textContent=S.engineReady?'Fight the CPU, or a friend over the internet.':'Starting the original arcade…';
 const note=!n?(S.hostError||'Opening your room…'):n.connected?(S.guestReady?'Player 2 is here. Fight!':'Player 2 found. Loading their arcade…'):'Waiting for player 2. Keep this screen open.';
 $('hostNote').textContent=note+(n&&!S.engineReady?' The arcade is still loading.':'');$('roomStatus').textContent=n?.connected?note:'Your friend taps Join with code, or opens the link. The match starts by itself.';
 $('shareInvite').disabled=$('shareDialog').disabled=$('copyInvite').disabled=!n;if(n)$('inviteLink').value=inviteURL();
 $('inviteMenu').hidden=S.role==='guest'||S.paired;$('restartButton').hidden=S.role==='guest'||S.paired;
 bodyState()}
/* The public site only carries an encrypted ROM; the key travels in the private link (?k=…), never to GitHub's files. */
async function downloadRom(){const key=new URLSearchParams(location.search).get('k');if(key){const response=await fetch('rom/game.bin');if(response.ok){try{return await decryptRom(await response.arrayBuffer(),key)}catch{throw new Error('This link’s game key is wrong. Open the exact link you were given.')}}}const response=await fetch('rom/ssf2tur1.zip');if(!response.ok)throw new Error(key?'The game could not load. Check your connection and reload.':'Open the game from your private link (it ends in ?k=…).');return response.blob()}
/* Both players run the arcade: player 2 needs the same ROM, unlocked by the same link. */
async function ensureEngine(){if(framePromise)return framePromise;framePromise=(async()=>{if(!engine())await new Promise(r=>$('emulatorFrame').addEventListener('load',r,{once:true}));try{S.rom=await getRom()}catch{}if(!S.rom){S.rom=await validateRom(await downloadRom());try{await storeRom(S.rom)}catch{}}await engine().start(S.rom);S.engineReady=true;const hold=S.role==='host'?S.away||S.localPause:false;if(!online()){engine().pause(hold);if(S.role==='host')S.paused=hold}engine().volume(S.muted?0:S.volume);engine().unlock();engine().watchHits(onHit);soundUI();lobby();sendReady()})();return framePromise}
async function host(){if(roomPromise)return roomPromise;S.hostError='';roomPromise=(async()=>{try{badge('OPENING ROOM');lobby();const n=await MatchNetwork.host();if(S.role==='guest'){n.close(false);return}S.net=n;bindNetwork(n);badge('WAITING');lobby()}catch(e){badge('OFFLINE','warn');S.hostError='Could not reach the matchmaking service. Check your internet, then tap Host online again.';roomPromise=null;S.page='host';lobby()}})();return roomPromise}
/* Switching this page into player 2 keeps the arcade that is already loading. */
function joinCode(code){history.replaceState(null,'','#room='+code);if(S.net){S.net.close();S.net=null}roomPromise=null;join(code)}
async function join(code){S.role='guest';S.paired=true;S.paused=true;$('lobby').hidden=true;overlay('JOINING ROOM '+code,'Loading the arcade and connecting to your friend…');badge('CONNECTING');lobby();
 ensureEngine().catch(e=>{overlay('ARCADE COULD NOT START',e.message);$('retryConnection').hidden=false;$('leaveOverlay').hidden=false});
 try{S.net=await MatchNetwork.guest(code);bindNetwork(S.net);S.net.connect();await acquireWake()}catch(e){S.fatal=true;overlay('ARCADE UNAVAILABLE',e.message);$('retryConnection').hidden=false;$('leaveOverlay').hidden=false;badge('OFFLINE','warn')}}
/* Player 2 says when its arcade is loaded and waiting for the host's state. */
function sendReady(){if(S.role==='guest'&&S.engineReady&&S.net?.connected&&!S.ls?.running&&!S.syncing)S.net.send({t:'ready'})}
function bindNetwork(net){net.on('connected',()=>{if(net!==S.net)return;S.linkHealthy=true;S.fatal=false;badge('CONNECTED','connected');
  note('connected'+(S.ls?.running?' (match continues at frame '+S.ls.frame+')':''));setTimeout(()=>S.net?.send({t:'log',lines:LOG.slice(-25).map(l=>l.slice(0,110))},true),500);
  if(S.role==='host'){S.guestReady=false;S.needSync=S.paired;S.remoteAway=false;S.remotePause=false;updatePause();sendState();haptics.land(.3)}
  /* After a brief drop both phones still hold the match and every recent input: just carry on.
     Player 2 tells the host which match it is in; anything else gets a fresh sync. */
  else{if(!S.ls?.running){S.syncing=false;sendReady()}else S.net.send({t:'ready',s:S.syncId,f:S.ls.frame});presence();if(!S.engineReady)overlay('CONNECTED','Loading the arcade…')}lobby()});
 net.on('packet',m=>{if(net!==S.net)return;
  if(m.t==='li'){if(S.ls&&m.s===S.syncId)S.ls.receive(m.f,m.m)}
  else if(m.t==='log'){peerLog=m.lines}
  else if(m.t==='need'){if(S.ls&&m.s===S.syncId)S.ls.resend(m.f)}
  else if(m.t==='ck'&&S.role==='host'){if(m.s===S.syncId){S.guestChecks.set(m.f,m.h);compareCheck(m.f)}}
  /* Player 2 only says 'ready' while it has no running match, so it always needs a sync (a duplicate can trail a fresh sync briefly). */
  else if(m.t==='ready'&&S.role==='host'){S.guestReady=true;lobby();const same=S.ls?.running&&m.s===S.syncId;if(same){note('player 2 back in the same match');S.needSync=false;S.ls.resend(Math.max(0,S.ls.frame-60));updatePause()}else if(!S.paired)beginFight();else if(!S.syncing&&performance.now()-S.syncedAt>3000)syncMatch(S.matchStarted?'resume':'new');sendState()}
  else if(m.t==='synced'&&S.role==='host')finishSync(m.id);
  else if(m.t==='sync'&&S.role==='guest'){S.rx={...m,parts:new Array(m.n),got:0};if(m.kind!=='fix'){S.ls?.stop();S.syncing=true;S.syncStarted=performance.now();overlay('GET READY','Lining up the two arcades…')}}
  else if(m.t==='sc'&&S.role==='guest'){const rx=S.rx;if(!rx||rx.id!==m.id||rx.parts[m.i]!==undefined)return;rx.parts[m.i]=m.d;if(++rx.got===rx.n)applySync(rx)}
  else if(m.t==='presence'&&S.role==='host'){S.remotePause=m.paused;S.remoteAway=m.away;updatePause();sendState()}
  else if(m.t==='state'&&S.role==='guest'){S.started=m.started;S.reason=typeof m.reason==='string'?m.reason:'';S.paused=m.paused||S.localPause||S.away||!S.linkHealthy;if(!S.syncing)renderPause();lobby()}
 });
 net.on('health',healthy=>{if(net!==S.net)return;note(healthy?'traffic resumed':'no traffic for 3.5 s');S.linkHealthy=healthy;if(S.role==='host')updatePause();else if(!healthy){release();S.paused=true;overlay('RECONNECTING','Your fight resumes automatically.')}if(!healthy)badge('RECONNECTING','warn')});
 net.on('disconnected',()=>{if(net!==S.net)return;STATS.drops++;note('connection dropped');release();S.linkHealthy=false;if(S.role==='host')updatePause();else{S.paused=true;overlay('RECONNECTING','Keeping your place. No need to rejoin.')}badge('RECONNECTING','warn');status('Restoring the connection automatically…');lobby()});
 net.on('retry',()=>{if(net===S.net)status('Finding your friend. Keep their arcade open…')});
 net.on('latency',ms=>{if(net!==S.net)return;S.rtt=S.rtt?S.rtt*.8+ms*.2:ms;S.ls?.setDelay(delayFor(S.rtt));badge(ms+' MS','connected');status(S.role==='host'?'Player 1 · two-player arcade':'Player 2 · two-player arcade');});
 net.on('missing',code=>{if(net===S.net&&!net.connected){overlay('NO ROOM '+code,'Nobody is hosting this code right now. Check the code; the host must keep their room open. Still trying…');$('leaveOverlay').hidden=false}});
 net.on('unreachable',()=>{if(net===S.net&&!net.connected){overlay('STILL CONNECTING','Keep your friend’s arcade open. Some strict networks block direct connections; try another Wi-Fi or mobile data.');$('leaveOverlay').hidden=false}});
 net.on('warning',message=>{if(net===S.net)status(message)});
 net.on('trace',text=>{if(net===S.net)note(text)});
 net.on('fatal',message=>{if(net!==S.net)return;S.fatal=true;release();S.paused=true;S.ls?.stop();overlay('MATCH UNAVAILABLE',message);$('leaveOverlay').hidden=false;badge('UNAVAILABLE','warn')});
 net.on('left',()=>{if(net!==S.net)return;note('the other player left');stopOnline();if(S.role==='guest'){S.paused=true;overlay('MATCH OVER','Your friend closed their arcade.');$('leaveOverlay').hidden=false;return}S.guestReady=false;badge('WAITING');updatePause();lobby();toast('Player 2 left. Your room stays open for a new challenger.')});
}

/* Match sync. The host freezes its arcade, sends the state, and both phones load it and start at frame 0.
   The same message corrects player 2 later if the two arcades ever disagree (kind 'fix'). */
const toBase64=u=>{let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)};
const fromBase64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function sendSnapshot(id,kind,f,state){const packed=toBase64(fflate.deflateSync(state,{level:1})),size=48000,n=Math.ceil(packed.length/size);S.net.send({t:'sync',id,kind,f,n});
 for(let i=0;i<n;i++){const packet={t:'sc',id,i,d:packed.slice(i*size,(i+1)*size)};for(let tries=0;!S.net?.send(packet);tries++){if(tries>200||!S.net?.connected)return false;await wait(25)}}return true}
async function syncMatch(kind){if(S.role!=='host'||S.syncing)return;S.syncing=true;STATS.syncs++;note('sync ('+kind+') started');S.syncStarted=performance.now();S.needSync=false;S.ls?.stop();S.roundPending=false;updatePause();
 /* Player 2 can finish loading first: wait for this phone's arcade rather than starting without it. */
 try{await ensureEngine()}catch{S.syncing=false;updatePause();return}
 const lock=engine().lockstep;if(!await lock.begin()&&!await lock.begin()){S.syncing=false;overlay('ONLINE PLAY COULD NOT START','Reload both phones and join again.');$('retryConnection').hidden=false;updatePause();return}
 const state=lock.state();lock.load(state);S.syncId=Math.random().toString(36).slice(2,8);S.syncKind=kind;S.checks.clear();S.snapshots.clear();S.guestChecks.clear();S.fixing=false;
 if(!await sendSnapshot(S.syncId,kind,0,state)){S.syncing=false;S.needSync=true;S.guestReady=false;updatePause()}}
function finishSync(id){if(id!==S.syncId||!S.syncing)return;note('sync complete, match running');S.ls=newLockstep(0,S.syncKind==='new'?startMacro(20):[]);S.matchStarted=true;S.syncedAt=performance.now();S.syncing=false;S.stalled=false;updatePause();sendState();lobby()}
async function applySync(rx){S.rx=null;const failed=()=>{if(rx.kind!=='fix'){S.syncing=false;sendReady()}};let state;try{state=fflate.inflateSync(fromBase64(rx.parts.join('')))}catch{failed();return}try{await ensureEngine()}catch{failed();return}const lock=engine().lockstep;
 if(rx.kind==='fix'){if(S.ls?.running&&rx.id===S.syncId){STATS.fixes++;note('corrected from host at frame '+rx.f);S.ls.resync(rx.f,state)}return}
 if(!await lock.begin()&&!await lock.begin()){failed();return}lock.load(state);S.syncId=rx.id;STATS.syncs++;note('synced from host ('+rx.kind+')');if(rx.kind==='new')S.joined=false;
 /* Player 2's credit and Start must reach the game once; a sync that interrupted them sends them again. */
 S.ls=newLockstep(1,!S.joined?startMacro(rx.kind==='new'?150:30):[]);S.syncing=false;S.stalled=false;S.net.send({t:'synced',id:rx.id});renderPause()}
function newLockstep(player,macro){const ls=new Lockstep({engine:engine().lockstep,player,session:S.syncId,delay:delayFor(S.rtt||60),send:(p,reliable)=>{if(p.t==='need')STATS.needs++;return S.net?.send(p,reliable)},onCheckpoint,onStall});ls.start(0,macro);return ls}
function stopOnline(){S.ls?.stop();S.ls=null;S.syncing=false;S.stalled=false;if(S.engineReady){engine().lockstep.end();if(S.paused)engine().pause(true)}}
/* Every 30 frames both phones fingerprint the game's memory; the host corrects player 2 on a mismatch. */
function onCheckpoint(f){const lock=engine().lockstep,state=lock.state(),h=lock.hash(state);
 if(S.role==='guest'){S.net?.send({t:'ck',s:S.syncId,f,h},true);return}
 S.checks.set(f,h);S.snapshots.set(f,state);for(const k of S.snapshots.keys())if(k<f-240)S.snapshots.delete(k);for(const m of [S.checks,S.guestChecks])for(const k of m.keys())if(k<f-1800)m.delete(k);compareCheck(f)}
function compareCheck(f){const mine=S.checks.get(f),theirs=S.guestChecks.get(f);if(mine===undefined||theirs===undefined)return;S.guestChecks.delete(f);if(mine===theirs||S.fixing)return;
 const state=S.snapshots.get(f);if(!state)return;S.fixing=true;console.warn('[lockstep] correcting player 2 at frame',f);STATS.fixes++;note('memory mismatch at frame '+f+': correcting player 2');sendSnapshot(S.syncId,'fix',f,state).finally(()=>setTimeout(()=>S.fixing=false,5000))}
function onStall(ms){if(ms>0)S.stallMs=ms;else if(S.stallMs){if(S.stallMs>250){STATS.stalls++;note('waited '+Math.round(S.stallMs)+' ms for the other phone');}STATS.longestStall=Math.max(STATS.longestStall,S.stallMs);S.stallMs=0}
 const stalled=ms>1500;if(stalled===S.stalled)return;S.stalled=stalled;if(S.role==='host'&&S.paused)return;renderPause()}
/* One clock for online play: each display frame may run up to a few game frames, paced at the arcade's 59.64 Hz. */
let fpsAt=0,fpsFrame=0;
function frameLoop(now){requestAnimationFrame(frameLoop);if(!S.ls?.running||S.syncing)return;
 if(now-fpsAt>5000){if(fpsAt&&S.ls.frame>=fpsFrame)STATS.fps=Math.round((S.ls.frame-fpsFrame)/((now-fpsAt)/1000));fpsAt=now;fpsFrame=S.ls.frame}
 if(S.role==='guest'&&!S.joined&&!S.ls.macro.length&&S.ls.frame>240){S.joined=true;note('player 2 credit and Start sent')}/* A phone showing a pause (its own, or the other player's) stops on the spot. */
 const paused=S.localPause||S.away||S.paused||!!document.querySelector('dialog[open]');S.ls.tick(now,paused||!isPlaying()?0:S.mask,paused)}
requestAnimationFrame(frameLoop);

/* Sound. iOS only unlocks audio on touchend/click/keydown (not touchstart), and mutes Web Audio
   with the ring/silent switch unless the page declares itself a media player. */
const IOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
try{if(navigator.audioSession)navigator.audioSession.type='playback'}catch{}
function silentWav(){const rate=8000,n=800,b=new DataView(new ArrayBuffer(44+n*2));const w=(o,s)=>[...s].forEach((c,i)=>b.setUint8(o+i,c.charCodeAt(0)));w(0,'RIFF');b.setUint32(4,36+n*2,true);w(8,'WAVEfmt ');b.setUint32(16,16,true);b.setUint16(20,1,true);b.setUint16(22,1,true);b.setUint32(24,rate,true);b.setUint32(28,rate*2,true);b.setUint16(32,2,true);b.setUint16(34,16,true);w(36,'data');b.setUint32(40,n*2,true);return URL.createObjectURL(new Blob([b],{type:'audio/wav'}))}
function playbackSession(){if(!IOS||navigator.audioSession||silentAudio)return;try{silentAudio=new Audio(silentWav());silentAudio.loop=true;silentAudio.setAttribute('playsinline','');silentAudio.play().catch(()=>{silentAudio=null})}catch{}}
function soundUI(){const running=engine()?.soundState?.()==='running';S.audioUnlocked=!!running;const b=$('soundButton');b.textContent=!running?'TAP FOR SOUND':S.muted?'MUTED':'SOUND ON';b.classList.toggle('sound-locked',!running);b.setAttribute('aria-label',!running?'Enable game audio':S.muted?'Turn sound on':'Mute sound')}
function unlockAudio(){playbackSession();engine()?.unlock?.();setTimeout(soundUI,120)}
function applyVolume(){engine()?.volume?.(S.muted?0:S.volume);soundUI()}
for(const ev of ['pointerup','touchend','click','keydown'])document.addEventListener(ev,e=>{if(e.target.closest?.('#soundButton'))return;if(!S.audioUnlocked)unlockAudio();acquireWake()},{capture:true,passive:true});

/* Rumble: each phone reads both life bars on its own screen. */
function onHit(player,amount){if(!S.started||S.paused)return;if(player===me())haptics.hit(amount);else haptics.land(amount)}

async function pulse(player,bit,ms=150){if(!S.engineReady||S.paused||online())return;await engine().pulse(player,bit,ms)}
function applyInput(player,mask,previous){if(!S.engineReady)return;engine().input(player,S.paused?0:mask&~BITS.start);if((mask&BITS.start)&&!(previous&BITS.start))startWithCredit(player)}
async function startWithCredit(player){if(!isPlaying()||!S.engineReady||S.roundPending||startBusy[player]||online())return;startBusy[player]=true;const epoch=S.roundEpoch;try{await pulse(player,BITS.coin);await engine().frames(30);if(isPlaying()&&epoch===S.roundEpoch)await pulse(player,BITS.start,160)}finally{startBusy[player]=false}}
async function insertAndStart(alreadyPlaying=false){await wait(250);if(S.paused)return false;await pulse(0,BITS.coin);await wait(180);if(S.paused)return false;await pulse(0,BITS.coin);await wait(1300);if(S.paused)return false;if(!alreadyPlaying)await pulse(0,BITS.start,160);return !S.paused}
async function startRound(){if(!S.roundPending||S.startingRound||S.paused||!S.engineReady||online())return;S.startingRound=true;const epoch=S.roundEpoch;try{if(await insertAndStart(S.roundPractice)&&epoch===S.roundEpoch)S.roundPending=false}finally{S.startingRound=false;if(S.roundPending&&!S.paused&&!online())setTimeout(startRound,300)}}
function beginFight(){if(S.role!=='host'||!S.guestReady||S.paired)return;S.roundEpoch++;S.roundPending=false;S.paired=true;S.started=true;closeDialogs();S.localPause=false;updatePause();lobby();unlockAudio();acquireWake();syncMatch('new');toast('Player 2 joined. Fight!')}
function solo(){if(!S.engineReady||S.busy||S.paired)return;S.roundEpoch++;S.started=true;S.roundPending=true;closeDialogs();updatePause();lobby();unlockAudio();acquireWake();startRound()}
function openMenu(){S.localPause=true;release();if(S.role==='guest'){S.paused=true;presence()}else updatePause();lobby();showDialog('menuDialog')}
function resume(){closeDialogs();S.localPause=false;unlockAudio();if(S.role==='guest')presence();else updatePause();acquireWake();bodyState()}
function inviteURL(){const u=new URL(location.href);u.hash='room='+S.net.code;return u.href}
async function invite(){if(!S.net){await host();if(!S.net)return}if(navigator.share){try{await navigator.share({title:'Street Fighter II · Fight me',text:'Join my arcade with code '+S.net.code+':',url:inviteURL()});return}catch(e){if(e.name==='AbortError')return}}try{await navigator.clipboard.writeText(inviteURL());toast('Invite link copied. Send it to your friend.')}catch{if(!$('roomDialog').open)showDialog('roomDialog');$('inviteLink').select()}}
async function openRoom(){S.localPause=true;release();updatePause();showDialog('roomDialog');lobby();await host();lobby()}
function exit(){release();S.net?.close();wakeLock?.release().catch(()=>{});location.replace(location.pathname+location.search)}

/* Wiring */
/* No iOS text selection, magnifier or callout anywhere outside the code field. */
document.addEventListener('selectstart',e=>{if(!e.target.closest?.('input'))e.preventDefault()});document.addEventListener('contextmenu',e=>{if(!e.target.closest?.('input'))e.preventDefault()});document.addEventListener('dblclick',e=>e.preventDefault());
$('soloButton').onclick=solo;$('practiceButton').onclick=solo;
$('hostButton').onclick=()=>showPage('host');$('joinButton').onclick=()=>showPage('join');
for(const b of document.querySelectorAll('[data-lobby]'))b.onclick=()=>showPage(b.dataset.lobby);
$('joinCode').oninput=e=>{const clean=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);e.target.value=clean;const ok=!!normalizeCode(clean);$('joinSubmit').disabled=!ok;$('joinNote').textContent=clean.length===4&&!ok?'Codes use letters A–Z and 2–9 (no O, I or L, no 0 or 1).':'Works on the same Wi-Fi or across the internet.'};
$('joinForm').onsubmit=e=>{e.preventDefault();const code=normalizeCode($('joinCode').value);if(!code)return;$('joinCode').blur();unlockAudio();joinCode(code)};
$('shareInvite').onclick=$('shareDialog').onclick=invite;$('roomBadge').onclick=openRoom;$('inviteMenu').onclick=openRoom;
$('copyInvite').onclick=async()=>{if(!S.net)return;try{await navigator.clipboard.writeText(inviteURL());toast('Invite link copied.')}catch{$('inviteLink').select()}};
$('exitButton').onclick=$('leaveOverlay').onclick=exit;$('menuButton').onclick=openMenu;$('resumeButton').onclick=$('resumeMenu').onclick=resume;$('retryConnection').onclick=()=>location.reload();
$('restartButton').onclick=async()=>{if(!S.engineReady||S.busy||S.paired)return;S.busy=true;closeDialogs();S.localPause=true;updatePause();overlay('RESTARTING','Getting the fighters ready…');try{await engine().restart();S.localPause=false;S.paused=true;updatePause();sendState();S.roundEpoch++;S.roundPractice=false;S.roundPending=true;startRound()}catch(e){toast(e.message)}finally{S.busy=false}};
$('startButton').onclick=()=>{if(!S.started&&S.role==='host'){solo();return}if(!isPlaying())return;haptics.tap();if(S.ls?.running)S.ls.pressStart();else if(S.role==='host')startWithCredit(0)};
$('soundButton').onclick=()=>{if(!S.audioUnlocked){S.muted=false;unlockAudio()}else{S.muted=!S.muted;applyVolume()}store.set('turbo-muted',S.muted?'1':'0')};
$('helpButton').onclick=()=>showDialog('helpDialog');
function showInfo(){const d=engine()?.diagnostics?.();$('infoSummary').textContent=[(S.role==='host'?'Player 1 (host)':'Player 2')+' · '+VERSION_LABEL,'room '+(S.net?.code||'—')+' · '+(S.net?.connected?'connected':'not connected')+' · ping '+Math.round(S.rtt)+' ms · input delay '+(S.ls?.delay??'—')+' frames','frame '+(S.ls?.frame??'—')+' · '+STATS.fps+' fps · drops '+STATS.drops+' · syncs '+STATS.syncs+' · corrections '+STATS.fixes,'waits >250 ms: '+STATS.stalls+' (longest '+Math.round(STATS.longestStall)+' ms) · input re-requests '+STATS.needs+' · sound '+(d?.audioState||'—')].join('\n');$('infoLog').textContent=(LOG.slice().reverse().join('\n')||'Nothing yet.')+(peerLog.length?'\n\n— other phone —\n'+peerLog.slice().reverse().join('\n'):'')}
$('infoButton').onclick=()=>{showDialog('infoDialog');showInfo()};
$('copyInfo').onclick=async()=>{try{await navigator.clipboard.writeText($('infoSummary').textContent+'\n\n'+$('infoLog').textContent);toast('Copied. Paste it in a message.')}catch{toast('Take a screenshot instead.')}};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=resume;for(const d of document.querySelectorAll('dialog'))d.addEventListener('cancel',e=>{e.preventDefault();resume()});
$('controlSize').oninput=e=>{document.documentElement.style.setProperty('--size',e.target.value);store.set('turbo-controls-size',e.target.value)};
$('volume').oninput=e=>{S.volume=Number(e.target.value);if(S.volume>0)S.muted=false;applyVolume();store.set('turbo-volume',String(S.volume))};
function setView(view){S.view=view==='big'?'big':'fit';document.body.classList.toggle('view-big',S.view==='big');for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===S.view));store.set('turbo-view',S.view)}
function setRumble(mode){haptics.mode=mode;for(const b of document.querySelectorAll('[data-rumble]'))b.setAttribute('aria-pressed',String(b.dataset.rumble===haptics.mode))}
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>setView(b.dataset.view);
for(const b of document.querySelectorAll('[data-rumble]'))b.onclick=()=>{setRumble(b.dataset.rumble);if(haptics.mode!=='off')haptics.test()};
function availability(){S.away=document.hidden;if(S.away)release();if(S.role==='guest'){if(S.away)S.paused=true;presence();if(!S.away)S.net?.connect()}else updatePause();if(!S.away){acquireWake();setTimeout(soundUI,300)}}
document.addEventListener('visibilitychange',availability);
window.addEventListener('pagehide',()=>{release();if(S.role==='guest')S.net?.send({t:'presence',away:true,paused:S.localPause})});window.addEventListener('pageshow',availability);
setInterval(()=>{if(S.syncing&&performance.now()-S.syncStarted>15000){S.syncing=false;S.rx=null;if(S.role==='host')updatePause()}soundUI();sendState();presence();bodyState();sendReady()},1000);
window.addEventListener('online',()=>{S.net?.connect();S.net?.reconnectBroker()});
(async()=>{const size=Number(store.get('turbo-controls-size'));if(size>=.8&&size<=1.25){$('controlSize').value=size;document.documentElement.style.setProperty('--size',size)}const volume=Number(store.get('turbo-volume')??.8);if(volume>=0&&volume<=1){S.volume=volume;$('volume').value=volume}S.muted=store.get('turbo-muted')==='1';setView(store.get('turbo-view'));setRumble(haptics.mode);
 const room=normalizeCode(new URLSearchParams(location.hash.slice(1)).get('room'));if(room&&validCode(room))join(room);else{lobby();ensureEngine().catch(e=>{overlay('ARCADE COULD NOT START',e.message);$('retryConnection').hidden=false})}
 if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{})})();
if(['127.0.0.1','localhost'].includes(location.hostname))window.__turbo={state:S,log:()=>LOG.slice(),stats:()=>({...STATS}),engine,availability,haptics,onHit,FRAME_MS,diagnostics:()=>({role:S.role,engineReady:S.engineReady,started:S.started,paired:S.paired,paused:S.paused,reason:S.reason,localPause:S.localPause,away:S.away,remoteAway:S.remoteAway,remotePause:S.remotePause,guestReady:S.guestReady,syncing:S.syncing,frame:S.ls?.frame,delay:S.ls?.delay,stalled:S.stalled,connected:S.net?.connected,data:S.net?.conn?.peerConnection?.connectionState,fast:S.net?.fast?.readyState,engine:engine()?.diagnostics?.()})};
