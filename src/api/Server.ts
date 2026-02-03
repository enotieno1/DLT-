import express from 'express';
import { DLTNode } from '../core/Node';
import { Transaction } from '../core/Transaction';
import { Block } from '../core/Block';

export class APIServer {
  private app: express.Application;
  private node: DLTNode;
  private port: number;

  constructor(node: DLTNode) {
    this.app = express();
    this.node = node;
    this.port = parseInt(process.env.API_PORT || process.env.NODE_PORT || '3000');
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // CORS headers
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        nodeId: this.node.getId(),
        role: this.node.getRole(),
        timestamp: Date.now(),
        blockchain: {
          length: this.node.getBlockchain().length,
          latestBlock: this.node.getLatestBlock().index
        },
        pendingTransactions: this.node.getPendingTransactions().length
      });
    });

    // Get validators
    this.app.get('/validators', (req, res) => {
      const config = this.node.getConfig();
      res.json({
        validators: config.validatorSet,
        currentValidator: config.validatorSet[0], // Simplified
        nodeRole: config.role
      });
    });

    // Submit transaction
    this.app.post('/transactions', async (req, res) => {
      try {
        const { from, to, amount, data } = req.body;
        
        if (!from || !to || amount <= 0) {
          return res.status(400).json({
            error: 'Invalid transaction data',
            required: ['from', 'to', 'amount']
          });
        }

        const transaction = new Transaction({
          from,
          to,
          amount: parseFloat(amount),
          data,
          timestamp: Date.now()
        });

        await this.node.submitTransaction(transaction);
        
        res.status(201).json({
          success: true,
          transactionId: transaction.hash,
          message: 'Transaction submitted successfully'
        });
      } catch (error) {
        res.status(500).json({
          error: 'Failed to submit transaction',
          details: error
        });
      }
    });

    // Get transaction by ID
    this.app.get('/transactions/:id', (req, res) => {
      const transactionId = req.params.id;
      
      // Search in blockchain
      for (const block of this.node.getBlockchain()) {
        const transaction = block.transactions.find(tx => tx.hash === transactionId);
        if (transaction) {
          return res.json({
            transaction: transaction.toJSON(),
            blockIndex: block.index,
            blockHash: block.hash
          });
        }
      }
      
      // Search in pending transactions
      const pendingTx = this.node.getPendingTransactions().find(tx => tx.hash === transactionId);
      if (pendingTx) {
        return res.json({
          transaction: pendingTx.toJSON(),
          status: 'pending'
        });
      }
      
      res.status(404).json({
        error: 'Transaction not found'
      });
    });

    // Get block by ID
    this.app.get('/blocks/:id', (req, res) => {
      const blockId = req.params.id;
      
      let block;
      if (blockId === 'latest') {
        block = this.node.getLatestBlock();
      } else {
        const index = parseInt(blockId);
        const blockchain = this.node.getBlockchain();
        
        if (index >= 0 && index < blockchain.length) {
          block = blockchain[index];
        }
      }
      
      if (!block) {
        return res.status(404).json({
          error: 'Block not found'
        });
      }
      
      res.json({
        block: block.toJSON(),
        transactionCount: block.getTransactionCount()
      });
    });

    // Get blockchain
    this.app.get('/blockchain', (req, res) => {
      const blockchain = this.node.getBlockchain();
      const { limit, offset } = req.query;
      
      let result = blockchain;
      
      if (offset) {
        const start = parseInt(offset as string);
        result = result.slice(start);
      }
      
      if (limit) {
        const end = parseInt(limit as string);
        result = result.slice(0, end);
      }
      
      res.json({
        blockchain: result.map(block => block.toJSON()),
        totalLength: blockchain.length,
        returnedLength: result.length
      });
    });

    // Get pending transactions
    this.app.get('/transactions/pending', (req, res) => {
      const pendingTransactions = this.node.getPendingTransactions();
      
      res.json({
        pendingTransactions: pendingTransactions.map(tx => tx.toJSON()),
        count: pendingTransactions.length
      });
    });

    // Get node info
    this.app.get('/node/info', (req, res) => {
      const config = this.node.getConfig();
      
      res.json({
        nodeId: config.id,
        address: config.address,
        port: config.port,
        role: config.role,
        validatorSet: config.validatorSet,
        isRunning: this.node.isNodeRunning(),
        blockchain: {
          length: this.node.getBlockchain().length,
          latestBlock: this.node.getLatestBlock().toJSON()
        }
      });
    });

    // Error handling middleware
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('API Error:', err);
      res.status(500).json({
        error: 'Internal server error',
        message: err.message
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method
      });
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.app.listen(this.port, () => {
          console.log(`🌐 API Server listening on port ${this.port}`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  public async stop(): Promise<void> {
    // Express doesn't have a built-in stop method, but we can track server state
    console.log('🛑 API Server stopped');
  }

  public getApp(): express.Application {
    return this.app;
  }

  public getPort(): number {
    return this.port;
  }
}
