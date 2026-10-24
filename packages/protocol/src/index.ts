export type SignalMessage =
  | { type: 'pair'; code: string }
  | { type: 'paired'; role: 'phone' }
  | { type: 'pair-error'; message: string }
  | { type: 'offer'; offer: RTCSessionDescriptionInit; session?: string }
  | { type: 'answer'; answer: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'phone-status'; status: 'connected' | 'disconnected' }
  | { type: 'phone-info'; facingMode: string }
  | { type: 'camera-start'; value?: { resolution?: string; fps?: string; orientation?: string; background?: string; mirror?: string } }
  | { type: 'camera-stop' }
  | { type: 'camera-switch' }
  | { type: 'settings'; value: { resolution?: string; fps?: string; orientation?: string; background?: string; mirror?: string } }
