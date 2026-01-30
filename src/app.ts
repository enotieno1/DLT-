import { ProofOfAuthority } from './core/consensus/poa';
import { NodeInfo, NodeRole, NodeStatus } from './core/types/node.types';
import { ConsensusConfig } from './core/consensus/poa';
import { Transaction } from './core/types/block.types';
import { createServer } from 'http';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';

// Import Enterprise DLT Components
import { Blockchain } from './core/blockchain/Blockchain';
import { SmartContractEngine } from './core/smartcontracts/SmartContractEngine';
import { PermissionManager, Role, Permission } from './core/accesscontrol/PermissionManager';
import { AuditTrail } from './core/audit/AuditTrail';
import { APILayer } from './core/api/APILayer';

// Import Tokenization Components
import { TokenizationEngine } from './core/tokenization/TokenizationEngine';
import { AssetMarketplace } from './core/tokenization/AssetMarketplace';

// Import M-Pesa Payment Platform
import { MpesaPaymentPlatform } from './core/payments/MpesaPaymentPlatform';

// Load environment variables
config();

class EnterpriseDLTNode {
  private nodeInfo: NodeInfo;
  private consensus: ProofOfAuthority;
  private server: any;
  
  // Enterprise DLT Components
  private blockchain: Blockchain;
  private smartContracts: SmartContractEngine;
  private permissionManager: PermissionManager;
  private auditTrail: AuditTrail;
  private apiLayer: APILayer;
  
  // Tokenization Components
  private tokenizationEngine: TokenizationEngine;
  private assetMarketplace: AssetMarketplace;
  
  // M-Pesa Payment Platform
  private mpesaPlatform: MpesaPaymentPlatform;

  constructor() {
    this.nodeInfo = {
      id: process.env.NODE_ID || 'veridion-main-node',
      address: process.env.NODE_ADDRESS || 'localhost',
      port: parseInt(process.env.NODE_PORT || '3001'),
      role: (process.env.NODE_ROLE as NodeRole) || NodeRole.PEER,
      publicKey: process.env.NODE_PUBLIC_KEY || 'veridion-public-key',
      status: NodeStatus.ACTIVE,
      lastSeen: Date.now(),
      reputation: 100
    };

    const consensusConfig: ConsensusConfig = {
      blockTime: parseInt(process.env.BLOCK_TIME || '5000'),
      validatorSet: (process.env.VALIDATOR_SET || '').split(',').filter(v => v),
      blockGasLimit: process.env.BLOCK_GAS_LIMIT || '1000000',
      minValidators: parseInt(process.env.MIN_VALIDATORS || '3'),
      votingPeriod: parseInt(process.env.VOTING_PERIOD || '10000')
    };

    // Initialize Enterprise DLT Components
    this.initializeEnterpriseComponents(consensusConfig);
    
    this.consensus = new ProofOfAuthority(consensusConfig, this.nodeInfo);
    this.setupEventHandlers();
  }

  private async initializeEnterpriseComponents(consensusConfig: ConsensusConfig): Promise<void> {
    // Initialize blockchain with configurable network type
    const networkType = (process.env.NETWORK_TYPE as 'private' | 'public' | 'hybrid') || 'private';
    this.blockchain = new Blockchain(networkType);
    
    // Initialize smart contract engine
    this.smartContracts = new SmartContractEngine(parseInt(process.env.GAS_LIMIT || '1000000'));
    
    // Initialize permission manager
    this.permissionManager = new PermissionManager();
    
    // Initialize audit trail
    this.auditTrail = new AuditTrail('./audit.db', true);
    
    // Initialize API layer
    this.apiLayer = new APILayer(
      this.blockchain,
      this.smartContracts,
      this.permissionManager,
      this.auditTrail
    );

    // Initialize Tokenization Components
    this.tokenizationEngine = new TokenizationEngine(
      this.smartContracts,
      this.auditTrail,
      this.permissionManager
    );
    
    this.assetMarketplace = new AssetMarketplace(
      this.tokenizationEngine,
      this.auditTrail
    );

    // Initialize M-Pesa Payment Platform
    this.mpesaPlatform = new MpesaPaymentPlatform(
      this.auditTrail, // Will be replaced with SecureFinancialLedger when available
      this.auditTrail,
      this.permissionManager,
      {
        apiKey: process.env.MPESA_API_KEY || 'demo_api_key',
        apiSecret: process.env.MPESA_API_SECRET || 'demo_api_secret',
        sandboxMode: process.env.MPESA_SANDBOX_MODE === 'true' || true
      }
    );

    // Create default admin user if not exists
    await this.createDefaultUsers();
    
    // Log system initialization
    await this.auditTrail.logSystemEvent('SYSTEM_INITIALIZED', {
      networkType,
      nodeId: this.nodeInfo.id,
      components: ['blockchain', 'smartcontracts', 'permissions', 'audit', 'api']
    });
  }

  private async createDefaultUsers(): Promise<void> {
    try {
      // Create admin user
      const adminAddress = '0x' + '0'.repeat(40); // Default admin address
      await this.permissionManager.createUser({
        address: adminAddress,
        role: Role.ADMIN,
        metadata: { type: 'system_admin', created: 'system_initialization' }
      });

      // Create validator nodes
      const validators = ['validator-1', 'validator-2', 'validator-3'];
      for (let i = 0; i < validators.length; i++) {
        const validatorAddress = '0x' + '1'.repeat(39) + i.toString();
        await this.permissionManager.createValidator(validatorAddress);
      }

      console.log('Default users created successfully');
    } catch (error) {
      console.error('Error creating default users:', error);
    }
  }

  private setupEventHandlers(): void {
    this.consensus.on('blockProposed', (block) => {
      console.log(`Block proposed: ${block.hash}`);
    });

    this.consensus.on('voteCast', (vote) => {
      console.log(`Vote cast by ${vote.validator}: ${vote.decision ? 'APPROVE' : 'REJECT'}`);
    });

    this.consensus.on('consensusReached', (blockHash, approved) => {
      console.log(`Consensus reached for block ${blockHash}: ${approved ? 'APPROVED' : 'REJECTED'}`);
    });
  }

  public async start(): Promise<void> {
    console.log(`Starting Enterprise DLT Node: ${this.nodeInfo.id}`);
    console.log(`Role: ${this.nodeInfo.role}`);
    console.log(`Address: ${this.nodeInfo.address}:${this.nodeInfo.port}`);

    // Start HTTP server for API
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(this.nodeInfo.port, () => {
      console.log(`Server listening on port ${this.nodeInfo.port}`);
    });

    // Start consensus loop if validator
    if (this.consensus.isNodeValidator()) {
      this.startConsensusLoop();
    }
  }

  private async handleRequest(req: any, res: any): Promise<void> {
    // Handle dashboard route
    if (req.url === '/dashboard' && req.method === 'GET') {
      try {
        const htmlPath = join(__dirname, '..', 'public', 'dashboard.html');
        const htmlContent = readFileSync(htmlPath, 'utf8');
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(htmlContent);
        return;
      } catch (error) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Dashboard not available' }));
        return;
      }
    }

    // Handle investor dashboard route
    if (req.url === '/investor' && req.method === 'GET') {
      try {
        const htmlPath = join(__dirname, '..', 'public', 'investor-dashboard.html');
        const htmlContent = readFileSync(htmlPath, 'utf8');
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(htmlContent);
        return;
      } catch (error) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Investor dashboard not available' }));
        return;
      }
    }

    // Handle M-Pesa dashboard route
    if (req.url === '/mpesa' && req.method === 'GET') {
      try {
        const htmlPath = join(__dirname, '..', 'public', 'mpesa-dashboard.html');
        const htmlContent = readFileSync(htmlPath, 'utf8');
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(htmlContent);
        return;
      } catch (error) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'M-Pesa dashboard not available' }));
        return;
      }
    }

    // Handle root route - serve the HTML interface
    if (req.url === '/' && req.method === 'GET') {
      try {
        const htmlPath = join(__dirname, '..', 'public', 'index.html');
        const htmlContent = readFileSync(htmlPath, 'utf8');
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(htmlContent);
        return;
      } catch (error) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Interface not available' }));
        return;
      }
    }

    // Handle API routes through enterprise API layer
    if (req.url?.startsWith('/api/')) {
      try {
        const apiRequest = {
          method: req.method,
          path: req.url,
          headers: req.headers,
          body: await this.parseRequestBody(req),
          userId: this.getUserIdFromRequest(req),
          address: this.getAddressFromRequest(req)
        };

        const apiResponse = await this.apiLayer.handleRequest(apiRequest);
        
        res.writeHead(apiResponse.status, apiResponse.headers);
        res.end(JSON.stringify(apiResponse.body || apiResponse.error));
        return;
      } catch (error) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'API request failed' }));
        return;
      }
    }

    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'healthy',
        nodeId: this.nodeInfo.id,
        role: this.nodeInfo.role,
        timestamp: Date.now(),
        enterprise: {
          blockchain: this.blockchain.getChainInfo(),
          contracts: this.smartContracts.getAllContracts().length,
          users: this.permissionManager.getAllUsers().length,
          auditEntries: (await this.auditTrail.getAuditStatistics()).totalEntries
        }
      }));
      return;
    }

    if (req.url === '/validators' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        validators: this.consensus.getValidatorSet(),
        isValidator: this.consensus.isNodeValidator(),
        enterpriseValidators: this.permissionManager.getUsersByRole(Role.VALIDATOR).map(v => ({
          id: v.id,
          address: v.address,
          isActive: v.isActive
        }))
      }));
      return;
    }

    // Enterprise DLT specific endpoints
    if (req.url === '/enterprise/info' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        platform: 'Veridion Chain Enterprise DLT',
        version: '1.0.0',
        networkType: process.env.NETWORK_TYPE || 'private',
        components: {
          blockchain: 'Active',
          smartContracts: 'Active',
          permissionManager: 'Active',
          auditTrail: 'Active',
          apiLayer: 'Active'
        },
        statistics: {
          blocks: this.blockchain.getChainInfo().length,
          contracts: this.smartContracts.getAllContracts().length,
          users: this.permissionManager.getAllUsers().length,
          auditEntries: (await this.auditTrail.getAuditStatistics()).totalEntries
        }
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private async parseRequestBody(req: any): Promise<any> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  private getUserIdFromRequest(req: any): string | undefined {
    // Extract user ID from Authorization header or session
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // In production, would verify JWT token
      return 'admin-user'; // Simplified for demo
    }
    return undefined;
  }

  private getAddressFromRequest(req: any): string | undefined {
    // Extract address from request
    return req.headers['x-user-address'] || '0x' + '0'.repeat(40);
  }

  private async startConsensusLoop(): Promise<void> {
    console.log('Starting consensus loop...');
    
    setInterval(async () => {
      try {
        // In a real implementation, this would get pending transactions
        const transactions: Transaction[] = [];
        
        if (transactions.length > 0) {
          const block = await this.consensus.proposeBlock(transactions);
          console.log(`Proposed block: ${block.hash}`);
        }
      } catch (error) {
        console.error('Error in consensus loop:', error);
      }
    }, this.consensus['config'].blockTime);
  }

  public async stop(): Promise<void> {
    if (this.server) {
      this.server.close();
    }
    console.log('Enterprise DLT Node stopped');
  }
}

// Start the node
const node = new EnterpriseDLTNode();

process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await node.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await node.stop();
  process.exit(0);
});

node.start().catch(console.error);
