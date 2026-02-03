import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { DLTNode } from './core/Node';
import { APIServer } from './api/Server';

// Load environment variables
dotenv.config();

class VeridionChain {
  private node: DLTNode;
  private apiServer: APIServer;
  private app: express.Application;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.node = new DLTNode();
    this.apiServer = new APIServer(this.node);
  }

  private setupMiddleware(): void {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  public async start(): Promise<void> {
    try {
      // Start the DLT node
      await this.node.initialize();
      console.log(`✅ DLT Node initialized with ID: ${this.node.getId()}`);
      
      // Start the API server
      await this.apiServer.start();
      console.log(`🚀 VERIDION CHAIN started successfully`);
      console.log(`📡 Node ID: ${this.node.getId()}`);
      console.log(`🌐 API Server running on port ${process.env.NODE_PORT || 3000}`);
      console.log(`🔐 Node Role: ${this.node.getRole()}`);
      
    } catch (error) {
      console.error('❌ Failed to start VERIDION CHAIN:', error);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    try {
      await this.node.shutdown();
      await this.apiServer.stop();
      console.log('🛑 VERIDION CHAIN stopped successfully');
    } catch (error) {
      console.error('❌ Error stopping VERIDION CHAIN:', error);
    }
  }
}

// Handle graceful shutdown
const veridionChain = new VeridionChain();

process.on('SIGINT', async () => {
  console.log('\n🔄 Received SIGINT, shutting down gracefully...');
  await veridionChain.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🔄 Received SIGTERM, shutting down gracefully...');
  await veridionChain.stop();
  process.exit(0);
});

// Start the application
if (require.main === module) {
  veridionChain.start().catch((error) => {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  });
}

export default VeridionChain;
