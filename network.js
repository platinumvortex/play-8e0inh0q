import {VERSION,PREFIX,randomCode,validCode,decodePacket} from './protocol.js';
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
/* Several independent STUN services: if one is blocked or down, the others still find a direct internet route. */
export const DEFAULT_ICE=[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']},{urls:'stun:stun.cloudflare.com:3478'}];
export const TIMING={heartbeat:1000,lag:3500,disconnect:14000,handshake:15000,retry:1200,mediaRetry:6000};
export class MatchNetwork extends EventTarget{
 constructor(role,code){super();Object.assign(this,{role,code,peer:null,conn:null,call:null,fast:null,pending:null,connected:false,closed:false,acceptedSession:null,stream:null,lastReceived:0,lastMediaRetry:-Infinity,lagging:false,attempt:0,missing:0});this.session=token();this.timers=new Set();if(role==='guest')try{const key='turbo-guest-'+code;this.session=sessionStorage.getItem(key)||this.session;sessionStorage.setItem(key,this.session)}catch{}}
 emit(name,detail){if(!this.closed)this.dispatchEvent(new CustomEvent(name,{detail}))}
 on(name,fn){this.addEventListener(name,e=>fn(e.detail));return this}
 later(fn,ms){const id=setTimeout(()=>{this.timers.delete(id);if(!this.closed)fn()},ms);this.timers.add(id);return id}
 static async host(){for(let i=0;i<6;i++){const n=new MatchNetwork('host',randomCode());try{await n.openPeer();return n}catch(e){n.close();if(e.type!=='unavailable-id')throw e}}throw new Error('Please try opening the arcade again.')}
 static async guest(code){if(!validCode(code))throw new Error('This invitation is incomplete. Ask your friend for a fresh link.');const n=new MatchNetwork('guest',code);try{await n.openPeer();return n}catch(e){n.close();throw e}}
 async openPeer(){let config={iceServers:DEFAULT_ICE,iceCandidatePoolSize:4};try{const r=await fetch('connection.json',{cache:'no-store',signal:AbortSignal.timeout(3000)});if(r.ok){const value=await r.json();if(Array.isArray(value.iceServers)&&value.iceServers.length)config={...config,iceServers:value.iceServers}}}catch{}return new Promise((resolve,reject)=>{
  const p=this.peer=new Peer(this.role==='host'?PREFIX+this.code:undefined,{debug:0,config});let opened=false;
  const timeout=this.later(()=>{if(!opened){reject(new Error('The connection service is unavailable. Check your internet and retry.'));p.destroy()}},18000);
  p.on('open',()=>{if(this.closed||p!==this.peer)return;clearTimeout(timeout);opened=true;this.startHeartbeat();resolve();if(this.role==='guest'&&this.attempt)this.connect()});
  p.on('error',e=>{if(this.closed||p!==this.peer)return;if(!opened){clearTimeout(timeout);reject(e)}else if(!this.connected){if(e.type==='peer-unavailable'&&++this.missing===4)this.emit('missing',this.code);this.emit('warning','Finding your friend’s arcade…');this.scheduleRetry()}});
  p.on('connection',c=>{if(this.closed||this.role!=='host'){c.close();return}this.attach(c)});
  p.on('call',call=>{if(this.closed||this.role!=='guest'||call.peer!==PREFIX+this.code){call.close();return}this.attachCall(call);call.answer()});
  p.on('disconnected',()=>{this.emit('trace','matchmaking server link lost (the match itself is unaffected)');this.reconnectBroker()});
  p.on('close',()=>{if(this.closed||p!==this.peer)return;this.lose();this.reconnectBroker()});
 })}
 reconnectBroker(){if(this.brokerTimer||this.closed)return;this.brokerTimer=this.later(async()=>{this.brokerTimer=null;try{if(this.peer?.destroyed){await this.openPeer();if(this.role==='guest')this.connect()}else if(this.peer?.disconnected)this.peer.reconnect()}catch{}if(this.peer?.disconnected||this.peer?.destroyed)this.reconnectBroker()},2000)}
 connect(){if(this.closed||this.role!=='guest'||this.connected||this.pending)return;if(!this.peer?.open){this.reconnectBroker();this.scheduleRetry();return}const c=this.peer.connect(PREFIX+this.code,{reliable:true,serialization:'raw',metadata:{version:VERSION}});this.pending=c;this.attach(c)}
 attach(c){let accepted=false;const timeout=this.later(()=>{if(!accepted){if(this.pending===c)this.pending=null;c.close();this.scheduleRetry()}},TIMING.handshake);
  // Keep PeerJS attached to its reliable control channel. It otherwise adopts every new channel.
  const pc=c.peerConnection;if(pc){const controlChannel=pc.ondatachannel;pc.ondatachannel=e=>{if(e.channel.label==='arcade-inputs')this.attachFast(e.channel,c);else controlChannel?.call(pc,e)}};
  if(pc?.addEventListener)pc.addEventListener('connectionstatechange',()=>{if(c===this.conn||c===this.pending)this.emit('trace','WebRTC '+pc.connectionState)});
  c.on('open',()=>{if(this.closed){c.close();return}if(this.role==='guest')c.send(JSON.stringify({t:'hello',version:VERSION,session:this.session}))});
  const accept=()=>{const old=this.conn;this.conn=c;this.pending=null;accepted=true;clearTimeout(timeout);this.connected=true;this.attempt=0;this.missing=0;this.lastReceived=performance.now();this.setLag(false);if(old&&old!==c)old.close();this.emit('connected')};
  c.on('data',raw=>{const m=decodePacket(raw);if(!m||this.closed)return;
   if(!accepted){
    if(this.role==='host'&&m.t==='hello'){
     if(c.metadata?.version!==VERSION||this.acceptedSession&&this.acceptedSession!==m.session){c.send(JSON.stringify({t:'reject',reason:c.metadata?.version!==VERSION?'Reload both phones to use the same game version.':'This match already has two players. Ask your friend for a new invitation.'}));this.later(()=>c.close(),200);return}
     this.acceptedSession=m.session;accept();c.send(JSON.stringify({t:'accepted'}));if(pc)try{this.attachFast(pc.createDataChannel('arcade-inputs',{ordered:false,maxRetransmits:0}),c)}catch{}return;
    }
    if(this.role==='guest'&&m.t==='accepted'){accept();return}
    if(m.t==='reject'){this.emit('fatal',m.reason);this.close(false)}return;
   }
   if(c!==this.conn)return;this.received();
   if(m.t==='ping'){this.send({t:'pong',at:m.at});return}if(m.t==='pong'){this.emit('latency',Math.round(performance.now()-m.at));return}
   if(m.t==='bye'){this.acceptedSession=null;this.lose();this.emit('left');c.close();return}
   if(m.t==='mediaRetry'&&this.role==='host'){this.repairMedia();return}this.emit('packet',m);
  });
  const ended=()=>{clearTimeout(timeout);if(this.pending===c)this.pending=null;if(c===this.conn&&!this.closed)this.lose();if(!this.connected)this.scheduleRetry()};c.on('close',()=>{if(c===this.conn)this.emit('trace','data connection closed by the browser');ended()});
  /* Only a real close ends a connection; PeerJS also reports recoverable problems as errors. */
  c.on('error',e=>{if(c===this.conn)this.emit('trace','connection error: '+(e?.type||e?.message||e));if(!accepted)ended()});
 }
 attachFast(channel,c){channel.onmessage=e=>{if(c!==this.conn||!this.connected)return;const m=decodePacket(e.data);if(m?.t==='input'||m?.t==='li'){this.received();this.emit('packet',m)}};channel.onopen=()=>{if(c===this.conn)this.fast=channel};channel.onclose=()=>{if(this.fast===channel)this.fast=null};if(channel.readyState==='open'&&c===this.conn)this.fast=channel}
 received(){this.lastReceived=performance.now();this.setLag(false)}
 setLag(value){if(this.lagging===value)return;this.lagging=value;this.emit('health',!value)}
 /* Frequent input traffic takes the unordered, non-retransmitting channel unless asked to be reliable. */
 send(packet,reliable=false){if(!this.connected||!this.conn?.open)return false;const quick=packet.t==='input'||packet.t==='li',channel=quick&&!reliable&&this.fast?.readyState==='open'?this.fast:null;const buffered=channel?.bufferedAmount??this.conn.dataChannel?.bufferedAmount??0;if(buffered>(channel?4096:packet.t==='sc'?8e6:262144))return false;/* Send on the data channel directly: PeerJS closes the whole connection if a single send throws (a briefly full
    buffer on mobile Wi-Fi), which looked like random disconnects. Here a failed send just reports false. */
  const text=JSON.stringify(packet),dc=channel||this.conn.dataChannel;try{if(dc?.send){if(dc.readyState&&dc.readyState!=='open')return false;dc.send(text)}else this.conn.send(text);return true}catch(e){this.emit('trace','send failed ('+(e?.name||e)+'), connection kept');return false}}
 tick(now=performance.now()){if(this.closed)return;if(this.connected){this.send({t:'ping',at:now});const age=now-this.lastReceived;this.setLag(age>TIMING.lag);if(age>TIMING.disconnect){const c=this.conn;this.lose();c?.close();this.scheduleRetry()}}else if(this.role==='guest')this.scheduleRetry();if(this.role==='host'&&this.connected&&this.stream&&(!this.call||['failed','closed'].includes(this.call.peerConnection?.connectionState)))this.repairMedia()}
 startHeartbeat(){clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>this.tick(),TIMING.heartbeat)}
 lose(){if(!this.connected)return;this.connected=false;this.fast=null;this.emit('disconnected');/* The independent video connection can survive a data reconnect. */}
 scheduleRetry(){if(this.retryTimer||this.closed||this.role!=='guest'||this.connected)return;this.retryTimer=this.later(()=>{this.retryTimer=null;if(this.connected)return;this.emit('retry',++this.attempt);if(this.attempt===3)this.emit('unreachable');this.connect()},Math.min(5000,TIMING.retry*Math.max(1,this.attempt)))}
 startMedia(stream,force=false){this.stream=stream;if(this.role!=='host'||!this.connected)return;const pc=this.call?.peerConnection;if(!force&&this.call?.peer===this.conn.peer&&pc&&!['failed','closed'].includes(pc.connectionState))return;const call=this.peer.call(this.conn.peer,stream,{metadata:{version:VERSION}});if(call)this.attachCall(call)}
 repairMedia(){if(performance.now()-this.lastMediaRetry<TIMING.mediaRetry)return;this.lastMediaRetry=performance.now();if(this.role==='host')this.startMedia(this.stream,true);else this.send({t:'mediaRetry'})}
 attachCall(call){const old=this.call;this.call=call;old?.close();call.on('stream',s=>{if(call!==this.call)return;lowLatency(call.peerConnection);this.emit('stream',s)});
  const ended=()=>{if(call!==this.call||this.closed)return;this.call=null;this.emit('mediaLost');this.later(()=>this.repairMedia(),1200)};call.on('error',ended);call.on('close',ended);
  const pc=call.peerConnection;if(pc?.addEventListener)pc.addEventListener('connectionstatechange',()=>{if(call!==this.call)return;if(pc.connectionState==='connected'){this.emit('mediaConnected');for(const sender of pc.getSenders()){if(sender.track?.kind==='video'){const p=sender.getParameters();if(!p.encodings?.length)p.encodings=[{}];p.encodings[0].maxBitrate=1200000;p.encodings[0].maxFramerate=60;p.degradationPreference='maintain-framerate';sender.setParameters(p).catch(()=>{})}}}else if(pc.connectionState==='failed'){this.emit('mediaLost');this.repairMedia()}})
 }
 close(notify=true){if(notify)this.send({t:'bye'});this.closed=true;clearInterval(this.heartbeat);for(const t of this.timers)clearTimeout(t);this.timers.clear();this.pending?.close();this.call?.close();this.conn?.close();this.peer?.destroy();this.connected=false}
}
/* Play remote frames as soon as they arrive: a fighting game prefers an occasional glitch to added delay. */
function lowLatency(pc){for(const r of pc?.getReceivers?.()||[]){try{if('jitterBufferTarget' in r)r.jitterBufferTarget=0;if('playoutDelayHint' in r)r.playoutDelayHint=0}catch{}}}
