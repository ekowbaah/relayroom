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
