"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const poa_1 = require("./core/consensus/poa");
const node_types_1 = require("./core/types/node.types");
const http_1 = require("http");
const dotenv_1 = require("dotenv");
// Load environment variables
(0, dotenv_1.config)();
class EnterpriseDLTNode {
    constructor() {
        this.nodeInfo = {
            id: process.env.NODE_ID || 'node-1',
            address: process.env.NODE_ADDRESS || 'localhost',
            port: parseInt(process.env.NODE_PORT || '3000'),
            role: process.env.NODE_ROLE || node_types_1.NodeRole.PEER,
            publicKey: process.env.NODE_PUBLIC_KEY || 'default-public-key',
            status: node_types_1.NodeStatus.ACTIVE,
            lastSeen: Date.now(),
            reputation: 100
        };
        const consensusConfig = {
            blockTime: parseInt(process.env.BLOCK_TIME || '5000'),
            validatorSet: (process.env.VALIDATOR_SET || '').split(',').filter(v => v),
            blockGasLimit: process.env.BLOCK_GAS_LIMIT || '1000000',
            minValidators: parseInt(process.env.MIN_VALIDATORS || '3'),
            votingPeriod: parseInt(process.env.VOTING_PERIOD || '10000')
        };
        this.consensus = new poa_1.ProofOfAuthority(consensusConfig, this.nodeInfo);
        this.setupEventHandlers();
    }
    setupEventHandlers() {
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
    async start() {
        console.log(`Starting Enterprise DLT Node: ${this.nodeInfo.id}`);
        console.log(`Role: ${this.nodeInfo.role}`);
        console.log(`Address: ${this.nodeInfo.address}:${this.nodeInfo.port}`);
        // Start HTTP server for API
        this.server = (0, http_1.createServer)((req, res) => {
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
    async handleRequest(req, res) {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/health' && req.method === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify({
                status: 'healthy',
                nodeId: this.nodeInfo.id,
                role: this.nodeInfo.role,
                timestamp: Date.now()
            }));
            return;
        }
        if (req.url === '/validators' && req.method === 'GET') {
            res.writeHead(200);
            res.end(JSON.stringify({
                validators: this.consensus.getValidatorSet(),
                isValidator: this.consensus.isNodeValidator()
            }));
            return;
        }
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
    }
    async startConsensusLoop() {
        console.log('Starting consensus loop...');
        setInterval(async () => {
            try {
                // In a real implementation, this would get pending transactions
                const transactions = [];
                if (transactions.length > 0) {
                    const block = await this.consensus.proposeBlock(transactions);
                    console.log(`Proposed block: ${block.hash}`);
                }
            }
            catch (error) {
                console.error('Error in consensus loop:', error);
            }
        }, this.consensus['config'].blockTime);
    }
    async stop() {
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
//# sourceMappingURL=app.js.map