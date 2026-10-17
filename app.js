import {BITS,InputGuard,validCode,normalizeCode} from './protocol.js';
import {Controls} from './controls.js';
import {MatchNetwork} from './network.js';
import {getRom,storeRom,validateRom,decryptRom} from './rom.js';
import {haptics} from './haptics.js';
const $=id=>document.getElementById(id),wait=ms=>new Promise(r=>setTimeout(r,ms));
const store={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
const S={role:'host',rom:null,engineReady:false,started:false,paired:false,paused:true,localPause:false,away:document.hidden,remotePause:false,remoteAway:false,guestReady:false,mediaReady:false,linkHealthy:true,net:null,mask:0,seq:0,muted:false,volume:.8,audioUnlocked:false,busy:false,startingRound:false,roundPending:false,roundPractice:false,roundEpoch:0,reason:'',fatal:false,page:'home',hostError:'',view:'fit',warnedLag:false};
const startBusy=[false,false];
const remote=new InputGuard();let pulseMask=0,pulseUntil=0,toastTimer,framePromise,wakeLock,videoWatchdog,roomPromise,silentAudio;
const engine=()=>$('emulatorFrame').contentWindow?.arcade;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000)}
function status(text){$('connectionBadge').title=text}
function badge(text,cls=''){$('connectionBadge').textContent=text;$('connectionBadge').className='pill badge '+cls}
function overlay(title,text='',resume=false){$('screenMessageTitle').textContent=title;$('screenMessageText').textContent=text;$('screenMessage').hidden=false;$('resumeButton').hidden=!resume}
function hideOverlay(){$('screenMessage').hidden=true;$('retryConnection').hidden=true;$('leaveOverlay').hidden=true}
function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>d.close())}
function showDialog(id){closeDialogs();$(id).showModal();controls.release()}
function isPlaying(){return S.started&&!S.paused&&!S.away&&!document.querySelector('dialog[open]')}
function bodyState(){document.body.classList.toggle('playing',isPlaying());document.body.classList.toggle('engine-ready',S.engineReady)}
const controls=new Controls({enabled:isPlaying,change:mask=>{const previous=S.mask;S.mask=mask;if(S.role==='guest')sendInput();else applyInput(0,mask,previous)},menu:openMenu});
function sendInput(){if(S.role==='guest')S.net?.send({t:'input',seq:S.seq++,mask:S.paused||S.away?0:S.mask|(performance.now()<pulseUntil?pulseMask:0)})}
function release(){pulseMask=0;pulseUntil=0;controls.release();S.mask=0;if(S.engineReady){engine().input(0,0);engine().input(1,0)}sendInput()}
async function acquireWake(){try{if(navigator.wakeLock&&!document.hidden)wakeLock=await navigator.wakeLock.request('screen')}catch{}}
function presence(){if(S.role==='guest')S.net?.send({t:'presence',paused:S.localPause,away:S.away})}
/* Pause reasons are worded for the reader: the host's "your menu" is the guest's "your friend's menu". */
const MIRROR={'Your menu is open':'Your friend opened the menu','Your friend opened the menu':'Your menu is open','Come back to the arcade to continue':'Your friend will be right back','Your friend will be right back':'Come back to the arcade to continue'};
function sendState(){if(S.role==='host')S.net?.send({t:'state',paused:S.paused,started:S.started,ready:S.guestReady,reason:MIRROR[S.reason]??S.reason})}
function pauseReason(){if(S.away)return 'Come back to the arcade to continue';if(S.localPause)return 'Your menu is open';if(S.paired){if(S.remoteAway)return 'Your friend will be right back';if(S.remotePause)return 'Your friend opened the menu';if(!S.net?.connected||!S.linkHealthy)return 'Reconnecting automatically…';if(!S.mediaReady||!S.guestReady)return 'Restoring your friend’s screen…'}return ''}
function renderPause(){bodyState();if(!S.started)return;if(S.paused){overlay(S.localPause||S.reason.includes('menu')?'PAUSED':'ONE MOMENT',S.reason,S.localPause)}else hideOverlay()}
function updatePause(){if(S.role==='guest'){S.rom=null;return}S.reason=pauseReason();const paused=!!S.reason,changed=paused!==S.paused;S.paused=paused;if(paused&&changed)release();if(S.engineReady&&changed)engine().pause(paused);renderPause();if(changed)sendState();if(!paused&&S.roundPending)queueMicrotask(startRound)}

/* Lobby: solo, host a room, or join one by code */
function showPage(page){S.page=page;lobby();if(page==='join')setTimeout(()=>$('joinCode').focus(),50);if(page==='host')host()}
function lobby(){const n=S.net,code=n?.code||'····',hosting=S.role==='host'&&!!n;
 for(const el of document.querySelectorAll('.lobby-page'))el.hidden=el.dataset.page!==S.page;
 $('lobby').hidden=S.started||S.role==='guest';
 $('roomCode').textContent=$('roomCodeDialog').textContent=code;$('roomCodeTop').textContent=n?.code||'';$('roomBadge').hidden=!hosting||!S.started;
 $('soloButton').disabled=!S.engineReady||S.busy;$('practiceButton').disabled=!S.engineReady||S.busy;
 $('loadingNote').textContent=S.engineReady?'Fight the CPU, or a friend over the internet.':'Starting the original arcade…';
 const note=!n?(S.hostError||'Opening your room…'):n.connected?(S.mediaReady?'Player 2 is here. Fight!':'Player 2 found. Sending the picture…'):'Waiting for player 2. Keep this screen open.';
 $('hostNote').textContent=note+(n&&!S.engineReady?' The arcade is still loading.':'');$('roomStatus').textContent=n?.connected?note:'Your friend taps Join with code, or opens the link. The match starts by itself.';
 $('shareInvite').disabled=$('shareDialog').disabled=$('copyInvite').disabled=!n;if(n)$('inviteLink').value=inviteURL();
 $('inviteMenu').hidden=S.role==='guest'||S.paired;$('restartButton').hidden=S.role==='guest';
 bodyState()}
/* The public site only carries an encrypted ROM; the key travels in the private link (?k=…), never to GitHub's files. */
async function downloadRom(){const key=new URLSearchParams(location.search).get('k');if(key){const response=await fetch('rom/game.bin');if(response.ok){try{return await decryptRom(await response.arrayBuffer(),key)}catch{throw new Error('This link’s game key is wrong. Open the exact link you were given.')}}}const response=await fetch('rom/ssf2tur1.zip');if(!response.ok)throw new Error(key?'The game could not load. Check your connection and reload.':'Open the game from your private link (it ends in ?k=…).');return response.blob()}
async function ensureEngine(){if(framePromise)return framePromise;framePromise=(async()=>{if(!engine())await new Promise(r=>$('emulatorFrame').addEventListener('load',r,{once:true}));try{S.rom=await getRom()}catch{}if(S.role==='guest'){S.rom=null;return}if(!S.rom){S.rom=await validateRom(await downloadRom());try{await storeRom(S.rom)}catch{}}if(S.role==='guest'){S.rom=null;return}await engine().start(S.rom);if(S.role==='guest'){S.rom=null;return}S.engineReady=true;engine().pause(S.away||S.localPause);S.paused=S.away||S.localPause;engine().volume(S.muted?0:S.volume);engine().unlock();engine().watchHits(onHit);soundUI();lobby();if(S.net?.connected)startMedia()})();return framePromise}
async function host(){if(roomPromise)return roomPromise;S.hostError='';roomPromise=(async()=>{try{badge('OPENING ROOM');lobby();const n=await MatchNetwork.host();if(S.role==='guest'){n.close(false);return}S.net=n;bindNetwork(n);badge('WAITING');lobby();if(n.connected&&S.engineReady)startMedia()}catch(e){badge('OFFLINE','warn');S.hostError='Could not reach the matchmaking service. Check your internet, then tap Host online again.';roomPromise=null;S.page='host';lobby()}})();return roomPromise}
/* Switching this page into player 2: stop the local arcade, the host's phone runs the only emulator. */
function joinCode(code){history.replaceState(null,'','#room='+code);if(S.net){S.net.close();S.net=null}roomPromise=null;engine()?.watchHits?.(null);S.engineReady=false;S.rom=null;$('emulatorFrame').src='about:blank';join(code)}
async function join(code){S.role='guest';S.paired=true;$('lobby').hidden=true;$('emulatorFrame').hidden=true;overlay('JOINING ROOM '+code,'Connecting to your friend’s arcade…');badge('CONNECTING');lobby();try{S.net=await MatchNetwork.guest(code);bindNetwork(S.net);S.net.connect();await acquireWake()}catch(e){S.fatal=true;overlay('ARCADE UNAVAILABLE',e.message);$('retryConnection').hidden=false;$('leaveOverlay').hidden=false;badge('OFFLINE','warn')}}
function bindNetwork(net){net.on('connected',()=>{if(net!==S.net)return;remote.reset();S.seq=0;S.linkHealthy=true;S.fatal=false;badge('CONNECTED','connected');if(S.role==='host'){S.guestReady=false;S.remoteAway=false;S.remotePause=false;if(S.engineReady)startMedia();updatePause();sendState();haptics.land(.3)}else{presence();if(S.mediaReady)net.send({t:'ready'});overlay('CONNECTED','Waiting for the picture from your friend’s arcade…')}lobby()});
 net.on('packet',m=>{if(net!==S.net)return;
  if(m.t==='input'&&S.role==='host'){const previous=remote.mask;if(remote.accept(m,performance.now()))applyInput(1,remote.mask,previous)}
  else if(m.t==='ready'&&S.role==='host'){S.guestReady=true;lobby();if(!S.paired)beginFight();else updatePause();sendState()}
  else if(m.t==='presence'&&S.role==='host'){S.remotePause=m.paused;S.remoteAway=m.away;updatePause();sendState()}
  else if(m.t==='state'&&S.role==='guest'){S.started=m.started;S.guestReady=m.ready;S.reason=typeof m.reason==='string'?m.reason:'';S.paused=m.paused||S.localPause||S.away||!S.linkHealthy;renderPause();lobby()}
  else if(m.t==='rumble'&&S.role==='guest'){if(m.hit)haptics.hit(m.amount);else haptics.land(m.amount)}
 });
 net.on('stream',stream=>{if(net!==S.net)return;const video=$('remoteVideo');video.hidden=false;video.onplaying=()=>{if(net!==S.net)return;S.mediaReady=true;net.send({t:'ready'});presence();if(!S.started)hideOverlay();soundUI();lobby()};video.srcObject=stream;guestVolume();video.play().catch(()=>{video.muted=true;video.play().catch(()=>overlay('TAP TO PLAY','Tap the screen to continue the live arcade.'))});startVideoWatchdog()});
 net.on('mediaConnected',()=>{if(net!==S.net)return;if(S.role==='host'){S.mediaReady=true;updatePause();lobby();if(S.guestReady&&!S.paired)beginFight()}});
 net.on('mediaLost',()=>{if(net!==S.net)return;S.mediaReady=false;if(S.role==='host'){S.guestReady=false;updatePause()}else{release();S.paused=true;overlay('RESTORING VIDEO','Your fight resumes automatically.')}lobby()});
 net.on('health',healthy=>{if(net!==S.net)return;S.linkHealthy=healthy;if(S.role==='host')updatePause();else if(!healthy){release();S.paused=true;overlay('RECONNECTING','Your fight resumes automatically.')}if(!healthy)badge('RECONNECTING','warn')});
 net.on('disconnected',()=>{if(net!==S.net)return;release();S.linkHealthy=false;if(S.role==='host')updatePause();else{S.paused=true;overlay('RECONNECTING','Keeping your place. No need to rejoin.')}badge('RECONNECTING','warn');status('Restoring the connection automatically…');lobby()});
 net.on('retry',()=>{if(net===S.net)status('Finding your friend. Keep their arcade open…')});
 net.on('latency',ms=>{if(net!==S.net)return;badge(ms+' MS',ms>160?'warn':'connected');status(S.role==='host'?'Player 1 · live two-player arcade':'Player 2 · live two-player arcade');if(ms>180&&!S.warnedLag){S.warnedLag=true;toast('The connection is slow ('+ms+' ms). A stronger Wi-Fi signal helps.')}});
 net.on('missing',code=>{if(net===S.net&&!net.connected){overlay('NO ROOM '+code,'Nobody is hosting this code right now. Check the code; the host must keep their room open. Still trying…');$('leaveOverlay').hidden=false}});
 net.on('unreachable',()=>{if(net===S.net&&!net.connected){overlay('STILL CONNECTING','Keep your friend’s arcade open. Some strict networks block direct connections; try another Wi-Fi or mobile data.');$('leaveOverlay').hidden=false}});
 net.on('warning',message=>{if(net===S.net)status(message)});
 net.on('fatal',message=>{if(net!==S.net)return;S.fatal=true;release();S.paused=true;overlay('MATCH UNAVAILABLE',message);$('leaveOverlay').hidden=false;badge('UNAVAILABLE','warn')});
 net.on('left',()=>{if(net!==S.net)return;S.guestReady=false;S.mediaReady=false;badge('WAITING');updatePause();lobby();toast('Player 2 left. Your room stays open for a new challenger.')});
}
function startMedia(){try{S.net.startMedia(engine().capture())}catch(e){overlay('VIDEO UNAVAILABLE',e.message)}}

/* Sound. iOS only unlocks audio on touchend/click/keydown (not touchstart), and mutes Web Audio
   with the ring/silent switch unless the page declares itself a media player. */
const IOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
try{if(navigator.audioSession)navigator.audioSession.type='playback'}catch{}
function silentWav(){const rate=8000,n=800,b=new DataView(new ArrayBuffer(44+n*2));const w=(o,s)=>[...s].forEach((c,i)=>b.setUint8(o+i,c.charCodeAt(0)));w(0,'RIFF');b.setUint32(4,36+n*2,true);w(8,'WAVEfmt ');b.setUint32(16,16,true);b.setUint16(20,1,true);b.setUint16(22,1,true);b.setUint32(24,rate,true);b.setUint32(28,rate*2,true);b.setUint16(32,2,true);b.setUint16(34,16,true);w(36,'data');b.setUint32(40,n*2,true);return URL.createObjectURL(new Blob([b],{type:'audio/wav'}))}
function playbackSession(){if(!IOS||navigator.audioSession||silentAudio)return;try{silentAudio=new Audio(silentWav());silentAudio.loop=true;silentAudio.setAttribute('playsinline','');silentAudio.play().catch(()=>{silentAudio=null})}catch{}}
function guestVolume(){const v=$('remoteVideo');try{v.volume=S.volume}catch{}if(S.audioUnlocked||!v.paused)v.muted=S.muted||S.volume===0}
function soundUI(){const v=$('remoteVideo'),running=S.role==='guest'?!v.paused&&!v.muted||(S.muted&&S.audioUnlocked):engine()?.soundState?.()==='running';S.audioUnlocked=!!running;const b=$('soundButton');b.textContent=!running?'TAP FOR SOUND':S.muted?'MUTED':'SOUND ON';b.classList.toggle('sound-locked',!running);b.setAttribute('aria-label',!running?'Enable game audio':S.muted?'Turn sound on':'Mute sound')}
function unlockAudio(){playbackSession();if(S.role!=='guest'){engine()?.unlock?.();setTimeout(soundUI,120);return}/* Calling play() inside the gesture also unlocks the element for the stream that arrives later (WebKit). */const v=$('remoteVideo');v.muted=S.muted||S.volume===0;S.audioUnlocked=true;v.play().catch(()=>{});setTimeout(soundUI,120)}
function applyVolume(){if(S.role==='guest')guestVolume();else engine()?.volume?.(S.muted?0:S.volume);soundUI()}
for(const ev of ['pointerup','touchend','click','keydown'])document.addEventListener(ev,e=>{if(e.target.closest?.('#soundButton'))return;if(!S.audioUnlocked)unlockAudio();acquireWake()},{capture:true,passive:true});

/* Rumble: the host reads both life bars; player 1 is this phone, player 2 is told over the network. */
function onHit(player,amount){if(!S.started||S.paused)return;if(player===0){haptics.hit(amount);S.net?.send({t:'rumble',hit:0,amount})}else{haptics.land(amount);S.net?.send({t:'rumble',hit:1,amount})}}

function startVideoWatchdog(){clearInterval(videoWatchdog);let last=-1,stale=0;videoWatchdog=setInterval(()=>{if(S.role!=='guest'||!S.net?.connected||S.away||S.localPause||S.reason.includes('menu')||S.reason.includes('back')){stale=0;return}const v=$('remoteVideo'),frames=v.getVideoPlaybackQuality?.().totalVideoFrames??v.webkitDecodedFrameCount;if(frames===undefined)return;if(frames===last)stale++;else{stale=0;if(!S.mediaReady&&frames>0){S.mediaReady=true;S.net.send({t:'ready'})}}last=frames;if(stale===3)v.play().catch(()=>{});if(stale>=7){S.net.repairMedia();stale=0}},1000)}
async function pulse(player,bit,ms=150){if(!S.engineReady||S.paused)return;await engine().pulse(player,bit,ms)}
function applyInput(player,mask,previous){if(!S.engineReady)return;engine().input(player,S.paused?0:mask&~BITS.start);if((mask&BITS.start)&&!(previous&BITS.start))startWithCredit(player)}
async function startWithCredit(player){if(!isPlaying()||!S.engineReady||S.roundPending||startBusy[player])return;startBusy[player]=true;const epoch=S.roundEpoch;try{await pulse(player,BITS.coin);await engine().frames(30);if(isPlaying()&&epoch===S.roundEpoch)await pulse(player,BITS.start,160)}finally{startBusy[player]=false}}
async function insertAndStart(two,alreadyPlaying=false){await wait(250);if(S.paused)return false;await pulse(0,BITS.coin);await wait(180);if(S.paused)return false;await pulse(0,BITS.coin);await wait(1300);if(S.paused)return false;if(!alreadyPlaying)await pulse(0,BITS.start,160);if(two){await engine().frames(90);if(S.paused)return false;await pulse(1,BITS.start,160)}return !S.paused}
async function startRound(){if(!S.roundPending||S.startingRound||S.paused||!S.engineReady)return;S.startingRound=true;const epoch=S.roundEpoch;try{if(await insertAndStart(S.paired,S.roundPractice)&&epoch===S.roundEpoch)S.roundPending=false}finally{S.startingRound=false;if(S.roundPending&&!S.paused)setTimeout(startRound,300)}}
function beginFight(){if(S.role!=='host'||!S.guestReady||!S.mediaReady||S.paired)return;S.roundEpoch++;S.roundPractice=S.started;S.roundPending=true;S.paired=true;S.started=true;closeDialogs();S.localPause=false;updatePause();sendState();lobby();unlockAudio();acquireWake();startRound();toast('Player 2 joined. Fight!')}
function solo(){if(!S.engineReady||S.busy||S.paired)return;S.roundEpoch++;S.started=true;S.roundPending=true;closeDialogs();updatePause();lobby();unlockAudio();acquireWake();startRound()}
function openMenu(){S.localPause=true;release();if(S.role==='guest'){S.paused=true;presence()}else updatePause();lobby();showDialog('menuDialog')}
function resume(){closeDialogs();S.localPause=false;unlockAudio();if(S.role==='guest')presence();else updatePause();acquireWake();bodyState()}
function inviteURL(){const u=new URL(location.href);u.hash='room='+S.net.code;return u.href}
async function invite(){if(!S.net){await host();if(!S.net)return}if(navigator.share){try{await navigator.share({title:'Street Fighter II · Fight me',text:'Join my arcade with code '+S.net.code+':',url:inviteURL()});return}catch(e){if(e.name==='AbortError')return}}try{await navigator.clipboard.writeText(inviteURL());toast('Invite link copied. Send it to your friend.')}catch{if(!$('roomDialog').open)showDialog('roomDialog');$('inviteLink').select()}}
async function openRoom(){S.localPause=true;release();updatePause();showDialog('roomDialog');lobby();await host();lobby()}
function exit(){release();S.net?.close();engine()?.stopCapture?.();wakeLock?.release().catch(()=>{});location.replace(location.pathname)}

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
$('restartButton').onclick=async()=>{if(!S.engineReady||S.busy)return;S.busy=true;closeDialogs();S.localPause=true;updatePause();overlay('RESTARTING','Getting the fighters ready…');try{await engine().restart();S.localPause=false;S.paused=true;updatePause();sendState();S.roundEpoch++;S.roundPractice=false;S.roundPending=true;startRound()}catch(e){toast(e.message)}finally{S.busy=false}};
$('startButton').onclick=()=>{if(!S.started&&S.role==='host'){solo();return}if(!isPlaying())return;haptics.tap();if(S.role==='guest'){pulseMask=BITS.start;pulseUntil=performance.now()+200;sendInput();setTimeout(sendInput,210)}else startWithCredit(0)};
$('soundButton').onclick=()=>{if(!S.audioUnlocked){S.muted=false;unlockAudio()}else{S.muted=!S.muted;applyVolume()}store.set('turbo-muted',S.muted?'1':'0')};
$('helpButton').onclick=()=>showDialog('helpDialog');
for(const b of document.querySelectorAll('[data-close]'))b.onclick=resume;for(const d of document.querySelectorAll('dialog'))d.addEventListener('cancel',e=>{e.preventDefault();resume()});
$('controlSize').oninput=e=>{document.documentElement.style.setProperty('--size',e.target.value);store.set('turbo-controls-size',e.target.value)};
$('volume').oninput=e=>{S.volume=Number(e.target.value);if(S.volume>0)S.muted=false;applyVolume();store.set('turbo-volume',String(S.volume))};
function setView(view){S.view=view==='big'?'big':'fit';document.body.classList.toggle('view-big',S.view==='big');for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===S.view));store.set('turbo-view',S.view)}
function setRumble(mode){haptics.mode=mode;for(const b of document.querySelectorAll('[data-rumble]'))b.setAttribute('aria-pressed',String(b.dataset.rumble===haptics.mode))}
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>setView(b.dataset.view);
for(const b of document.querySelectorAll('[data-rumble]'))b.onclick=()=>{setRumble(b.dataset.rumble);if(haptics.mode!=='off')haptics.test()};
function availability(){S.away=document.hidden;if(S.away)release();if(S.role==='guest'){if(S.away)S.paused=true;presence();if(!S.away){$('remoteVideo').play().catch(()=>{});S.net?.connect()}}else updatePause();if(!S.away){acquireWake();setTimeout(soundUI,300)}}
document.addEventListener('visibilitychange',availability);
window.addEventListener('pagehide',()=>{release();if(S.role==='guest')S.net?.send({t:'presence',away:true,paused:S.localPause})});window.addEventListener('pageshow',availability);
setInterval(()=>{if(S.role==='guest')sendInput();if(S.role==='host'&&remote.expired(performance.now())){remote.mask=0;engine()?.input?.(1,0)}},50);
setInterval(()=>{soundUI();sendState();presence();bodyState();if(S.role==='guest'&&S.mediaReady&&S.net?.connected)S.net.send({t:'ready'})},1000);
window.addEventListener('online',()=>{S.net?.connect();S.net?.reconnectBroker()});
(async()=>{const size=Number(store.get('turbo-controls-size'));if(size>=.8&&size<=1.25){$('controlSize').value=size;document.documentElement.style.setProperty('--size',size)}const volume=Number(store.get('turbo-volume')??.8);if(volume>=0&&volume<=1){S.volume=volume;$('volume').value=volume}S.muted=store.get('turbo-muted')==='1';setView(store.get('turbo-view'));setRumble(haptics.mode);
 const room=normalizeCode(new URLSearchParams(location.hash.slice(1)).get('room'));if(room&&validCode(room))join(room);else{lobby();ensureEngine().catch(e=>{if(S.role==='guest'){S.rom=null;return}overlay('ARCADE COULD NOT START',e.message);$('retryConnection').hidden=false})}
 if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{})})();
if(['127.0.0.1','localhost'].includes(location.hostname))window.__turbo={state:S,engine,remote,availability,haptics,onHit,audio:()=>({video:$('remoteVideo')}),diagnostics:()=>({role:S.role,engineReady:S.engineReady,started:S.started,paired:S.paired,paused:S.paused,reason:S.reason,localPause:S.localPause,away:S.away,remoteAway:S.remoteAway,remotePause:S.remotePause,guestReady:S.guestReady,mediaReady:S.mediaReady,connected:S.net?.connected,call:S.net?.call?.peerConnection?.connectionState,data:S.net?.conn?.peerConnection?.connectionState,fast:S.net?.fast?.readyState,engine:engine()?.diagnostics?.()})};
