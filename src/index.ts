export type PeerState = "idle"|"joining"|"connected"|"reconnecting"|"closed";
export type Signal =
  | { kind:"offer"; roomId:string; peerId:string; sequence:number; sdp:string }
  | { kind:"answer"; roomId:string; peerId:string; sequence:number; sdp:string }
  | { kind:"ice"; roomId:string; peerId:string; sequence:number; candidate:string };
export interface QualitySample { rttMs:number; jitterMs:number; packetLossPercent:number; bitrateKbps:number; }
export type QualityGrade = "excellent"|"good"|"degraded"|"poor";

export function gradeQuality(sample:QualitySample):QualityGrade {
  if(sample.packetLossPercent>=8 || sample.rttMs>=600 || sample.bitrateKbps<150) return "poor";
  if(sample.packetLossPercent>=3 || sample.rttMs>=350 || sample.jitterMs>=60) return "degraded";
  if(sample.packetLossPercent>=1 || sample.rttMs>=180 || sample.jitterMs>=30) return "good";
  return "excellent";
}

export class RoomPeer {
  state:PeerState="idle"; private nextSequence=1; private lastRemoteSequence=0; private reconnectAttempt=0;
  constructor(readonly roomId:string,readonly peerId:string,readonly polite:boolean){if(!roomId||!peerId)throw new Error("roomId and peerId are required")}
  join(){if(this.state!=="idle"&&this.state!=="reconnecting")throw new Error(`cannot join from ${this.state}`);this.state="joining";}
  connected(){if(this.state!=="joining"&&this.state!=="reconnecting")throw new Error(`cannot connect from ${this.state}`);this.state="connected";this.reconnectAttempt=0;}
  disconnected(){if(this.state==="closed")return;this.state="reconnecting";this.reconnectAttempt++;}
  close(){this.state="closed";}
  reconnectDelayMs(){const base=Math.min(30_000,500*2**Math.max(0,this.reconnectAttempt-1));return base;}
  signal(kind:Signal["kind"],value:string):Signal {if(this.state==="closed")throw new Error("peer is closed");const common={kind,roomId:this.roomId,peerId:this.peerId,sequence:this.nextSequence++};return kind==="ice"?{...common,kind,candidate:value}:{...common,kind,sdp:value};}
  accept(signal:Signal,{makingOffer=false}={}):boolean {
    if(signal.roomId!==this.roomId||signal.peerId===this.peerId||signal.sequence<=this.lastRemoteSequence)return false;
    if(signal.kind==="offer"&&makingOffer&&!this.polite)return false;
    this.lastRemoteSequence=signal.sequence;return true;
  }
}

export type RoomEvent = {type:"joined"|"left";roomId:string;peerId:string;at:number};
export class RoomRegistry {
  private rooms=new Map<string,Map<string,number>>();
  readonly events:RoomEvent[]=[];
  constructor(readonly maxPeers=12,readonly idleTtlMs=60_000){}
  join(roomId:string,peerId:string,now=Date.now()):string[] {
    this.sweep(now); const room=this.rooms.get(roomId)??new Map<string,number>();
    if(!room.has(peerId)&&room.size>=this.maxPeers) throw new Error("room capacity reached");
    const existing=[...room.keys()].filter(id=>id!==peerId);
    room.set(peerId,now); this.rooms.set(roomId,room); this.events.push({type:"joined",roomId,peerId,at:now}); return existing;
  }
  heartbeat(roomId:string,peerId:string,now=Date.now()):boolean {if(this.rooms.get(roomId)?.get(peerId)===undefined)return false;this.rooms.get(roomId)!.set(peerId,now);return true;}
  leave(roomId:string,peerId:string,now=Date.now()):boolean {const room=this.rooms.get(roomId);if(!room?.delete(peerId))return false;if(room.size===0)this.rooms.delete(roomId);this.events.push({type:"left",roomId,peerId,at:now});return true;}
  peers(roomId:string):string[]{return [...(this.rooms.get(roomId)?.keys()??[])].sort();}
  sweep(now=Date.now()):number {let removed=0;for(const [roomId,room] of this.rooms)for(const [peerId,lastSeen] of room)if(now-lastSeen>=this.idleTtlMs){this.leave(roomId,peerId,now);removed++;}return removed;}
}

export type AdaptiveProfile={maxBitrateKbps:number;scaleResolutionDownBy:number;requestKeyFrame:boolean};
export function adaptiveProfile(grade:QualityGrade):AdaptiveProfile {
  switch(grade){case "excellent":return{maxBitrateKbps:2500,scaleResolutionDownBy:1,requestKeyFrame:false};case "good":return{maxBitrateKbps:1500,scaleResolutionDownBy:1,requestKeyFrame:false};case "degraded":return{maxBitrateKbps:700,scaleResolutionDownBy:1.5,requestKeyFrame:false};case "poor":return{maxBitrateKbps:250,scaleResolutionDownBy:2,requestKeyFrame:true};}
}
