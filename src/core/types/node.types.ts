export interface NodeInfo {
  id: string;
  address: string;
  port: number;
  role: NodeRole;
  publicKey: string;
  status: NodeStatus;
  lastSeen: number;
  reputation: number;
}

export enum NodeRole {
  AUTHORITY = 'authority',
  VALIDATOR = 'validator',
  PEER = 'peer'
}

export enum NodeStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
  PENDING = 'pending'
}

export interface PeerInfo {
  id: string;
  address: string;
  port: number;
  role: NodeRole;
  lastPing: number;
  latency: number;
}

export interface NetworkConfig {
  nodeId: string;
  address: string;
  port: number;
  role: NodeRole;
  bootstrapNodes: string[];
  maxPeers: number;
  heartbeatInterval: number;
  timeout: number;
}

export interface Message {
  type: MessageType;
  data: any;
  from: string;
  to: string;
  timestamp: number;
  signature?: string;
}

export enum MessageType {
  TRANSACTION = 'transaction',
  BLOCK = 'block',
  PEER_REQUEST = 'peer_request',
  PEER_RESPONSE = 'peer_response',
  HEARTBEAT = 'heartbeat',
  VOTE = 'vote',
  CONSENSUS = 'consensus',
  SYNC_REQUEST = 'sync_request',
  SYNC_RESPONSE = 'sync_response'
}
