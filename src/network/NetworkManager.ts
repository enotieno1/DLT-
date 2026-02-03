import { EventEmitter } from 'events';
import WebSocket, { Server as WebSocketServer } from 'ws';
import { Transaction } from '../core/Transaction';
import { Block } from '../core/Block';
import { NodeConfig } from '../core/Node';

export interface Peer {
  id: string;
  address: string;
  port: number;
  ws?: WebSocket;
  lastSeen: number;
}

export class NetworkManager extends EventEmitter {
  private config: NodeConfig;
  private peers: Map<string, Peer> = new Map();
  private server?: WebSocketServer;
  private isRunning: boolean = false;

  constructor(config: NodeConfig) {
    super();
    this.config = config;
  }

  public async initialize(): Promise<void> {
    try {
      // Start WebSocket server
      this.server = new WebSocketServer({ 
        port: this.config.port,
        host: this.config.address
      });

      this.server.on('connection', (ws: WebSocket, req) => {
        this.handleConnection(ws, req);
      });

      this.server.on('error', (error) => {
        console.error('WebSocket server error:', error);
      });

      this.isRunning = true;
      console.log(`🌐 Network manager started on ${this.config.address}:${this.config.port}`);
    } catch (error) {
      throw new Error(`Failed to initialize network manager: ${error}`);
    }
  }

  private handleConnection(ws: WebSocket, req: any): void {
    const peerId = this.generatePeerId(req.socket.remoteAddress, req.socket.remotePort);
    
    const peer: Peer = {
      id: peerId,
      address: req.socket.remoteAddress,
      port: req.socket.remotePort,
      ws: ws,
      lastSeen: Date.now()
    };

    this.peers.set(peerId, peer);
    console.log(`🤝 Peer connected: ${peerId}`);

    ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(peerId, data.toString());
    });

    ws.on('close', () => {
      this.handleDisconnection(peerId);
    });

    ws.on('error', (error) => {
      console.error(`Peer ${peerId} error:`, error);
      this.handleDisconnection(peerId);
    });

    // Send welcome message
    this.sendMessage(peerId, {
      type: 'welcome',
      nodeId: this.config.id,
      timestamp: Date.now()
    });
  }

  private handleMessage(peerId: string, message: string): void {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'welcome':
          console.log(`👋 Received welcome from ${data.nodeId}`);
          break;
          
        case 'transaction':
          const transaction = Transaction.fromJSON(data.transaction);
          this.emit('transaction:received', transaction);
          break;
          
        case 'block':
          const block = Block.fromJSON(data.block);
          this.emit('block:received', block);
          break;
          
        case 'ping':
          this.sendMessage(peerId, {
            type: 'pong',
            timestamp: Date.now()
          });
          break;
          
        case 'pong':
          // Update last seen for peer
          const peer = this.peers.get(peerId);
          if (peer) {
            peer.lastSeen = Date.now();
          }
          break;
          
        default:
          console.log(`📨 Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error(`Error handling message from ${peerId}:`, error);
    }
  }

  private handleDisconnection(peerId: string): void {
    this.peers.delete(peerId);
    console.log(`👋 Peer disconnected: ${peerId}`);
  }

  private generatePeerId(address: string, port: number): string {
    return `${address}:${port}`;
  }

  public async connectToPeer(address: string, port: number): Promise<boolean> {
    try {
      const ws = new WebSocket(`ws://${address}:${port}`);
      
      return new Promise((resolve, reject) => {
        ws.on('open', () => {
          const peerId = this.generatePeerId(address, port);
          const peer: Peer = {
            id: peerId,
            address: address,
            port: port,
            ws: ws,
            lastSeen: Date.now()
          };
          
          this.peers.set(peerId, peer);
          console.log(`🤝 Connected to peer: ${peerId}`);
          resolve(true);
        });

        ws.on('error', (error: Error) => {
          reject(error);
        });
      });
    } catch (error) {
      console.error(`Failed to connect to peer ${address}:${port}:`, error);
      return false;
    }
  }

  public async broadcastTransaction(transaction: Transaction): Promise<void> {
    const message = {
      type: 'transaction',
      transaction: transaction.toJSON(),
      timestamp: Date.now()
    };

    this.broadcast(message);
  }

  public async broadcastBlock(block: Block): Promise<void> {
    const message = {
      type: 'block',
      block: block.toJSON(),
      timestamp: Date.now()
    };

    this.broadcast(message);
  }

  private broadcast(message: any): void {
    const messageStr = JSON.stringify(message);
    
    for (const [peerId, peer] of this.peers) {
      if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
        try {
          peer.ws.send(messageStr);
        } catch (error) {
          console.error(`Failed to send message to peer ${peerId}:`, error);
        }
      }
    }
  }

  private sendMessage(peerId: string, message: any): void {
    const peer = this.peers.get(peerId);
    if (peer && peer.ws && peer.ws.readyState === WebSocket.OPEN) {
      try {
        peer.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error(`Failed to send message to peer ${peerId}:`, error);
      }
    }
  }

  public async pingPeers(): Promise<void> {
    const message = {
      type: 'ping',
      timestamp: Date.now()
    };

    this.broadcast(message);
  }

  public getConnectedPeers(): Peer[] {
    return Array.from(this.peers.values());
  }

  public getPeerCount(): number {
    return this.peers.size;
  }

  public async shutdown(): Promise<void> {
    this.isRunning = false;
    
    // Close all peer connections
    for (const [peerId, peer] of this.peers) {
      if (peer.ws) {
        peer.ws.close();
      }
    }
    this.peers.clear();

    // Close server
    if (this.server) {
      this.server.close();
    }

    console.log('🛑 Network manager shutdown complete');
  }

  public isNetworkRunning(): boolean {
    return this.isRunning;
  }
}
