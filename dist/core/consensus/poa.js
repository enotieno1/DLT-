"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProofOfAuthority = void 0;
const node_types_1 = require("../types/node.types");
const events_1 = require("events");
class ProofOfAuthority extends events_1.EventEmitter {
    constructor(config, nodeInfo) {
        super();
        this.currentValidator = 0;
        this.pendingVotes = new Map();
        this.isValidator = false;
        this.config = config;
        this.nodeInfo = nodeInfo;
        this.isValidator = this.isNodeValidator();
    }
    async proposeBlock(transactions) {
        if (!this.isValidator) {
            throw new Error('Node is not authorized to propose blocks');
        }
        // Get latest block hash (simplified - would come from blockchain storage)
        const parentHash = await this.getLatestBlockHash();
        const blockNumber = await this.getLatestBlockNumber() + 1;
        // Create block
        const block = await this.createBlock(parentHash, blockNumber, transactions);
        // Sign block
        block.signature = await this.signBlock(block);
        this.emit('blockProposed', block);
        return block;
    }
    async voteOnBlock(blockHash, approve) {
        if (!this.isValidator) {
            throw new Error('Node is not authorized to vote');
        }
        const vote = {
            validator: this.nodeInfo.id,
            blockHash,
            decision: approve,
            signature: await this.signVote(blockHash, approve),
            timestamp: Date.now()
        };
        this.emit('voteCast', vote);
        return vote;
    }
    async addVote(vote) {
        // Verify vote signature
        if (!await this.verifyVoteSignature(vote)) {
            return false;
        }
        // Add vote to pending votes
        const votes = this.pendingVotes.get(vote.blockHash) || [];
        votes.push(vote);
        this.pendingVotes.set(vote.blockHash, votes);
        // Check if we have enough votes for consensus
        return await this.checkConsensus(vote.blockHash);
    }
    getNextValidator() {
        const validators = this.config.validatorSet;
        const validator = validators[this.currentValidator];
        this.currentValidator = (this.currentValidator + 1) % validators.length;
        return validator || '';
    }
    isNodeValidator() {
        return this.config.validatorSet.includes(this.nodeInfo.id) &&
            (this.nodeInfo.role === node_types_1.NodeRole.AUTHORITY || this.nodeInfo.role === node_types_1.NodeRole.VALIDATOR);
    }
    async createBlock(parentHash, number, transactions) {
        // This would use the BlockBuilder from blockchain/block.ts
        // For now, return a simplified block structure
        const block = {
            hash: '',
            parentHash: parentHash || '',
            number,
            timestamp: Date.now(),
            transactions,
            validator: this.nodeInfo.id,
            signature: '',
            stateRoot: '',
            transactionsRoot: '',
            receiptsRoot: '',
            gasLimit: this.config.blockGasLimit,
            gasUsed: '0',
            extraData: ''
        };
        return block;
    }
    async signBlock(block) {
        // In a real implementation, this would use the node's private key
        // For now, return a mock signature
        return `signature_${block.hash}_${this.nodeInfo.id}`;
    }
    async signVote(blockHash, approve) {
        // In a real implementation, this would use the node's private key
        return `vote_signature_${blockHash}_${approve}_${this.nodeInfo.id}`;
    }
    async verifyVoteSignature(vote) {
        // In a real implementation, this would verify the cryptographic signature
        // For now, just check basic format
        return vote.signature.startsWith('vote_signature_') &&
            vote.signature.includes(vote.blockHash) &&
            vote.signature.includes(vote.decision.toString());
    }
    async checkConsensus(blockHash) {
        const votes = this.pendingVotes.get(blockHash) || [];
        const approveVotes = votes.filter(v => v.decision);
        const rejectVotes = votes.filter(v => !v.decision);
        // Need majority approval
        const totalValidators = this.config.validatorSet.length;
        const requiredVotes = Math.floor(totalValidators * 0.5) + 1;
        if (approveVotes.length >= requiredVotes) {
            this.emit('consensusReached', blockHash, true);
            this.pendingVotes.delete(blockHash);
            return true;
        }
        if (rejectVotes.length >= requiredVotes) {
            this.emit('consensusReached', blockHash, false);
            this.pendingVotes.delete(blockHash);
            return false;
        }
        return false;
    }
    async getLatestBlockHash() {
        // In a real implementation, this would query the blockchain storage
        return '0x0000000000000000000000000000000000000000000000000000000000000000';
    }
    async getLatestBlockNumber() {
        // In a real implementation, this would query the blockchain storage
        return 0;
    }
    getValidatorSet() {
        return [...this.config.validatorSet];
    }
    addValidator(validatorId) {
        if (!this.config.validatorSet.includes(validatorId)) {
            this.config.validatorSet.push(validatorId);
            this.emit('validatorAdded', validatorId);
        }
    }
    removeValidator(validatorId) {
        const index = this.config.validatorSet.indexOf(validatorId);
        if (index > -1) {
            this.config.validatorSet.splice(index, 1);
            this.emit('validatorRemoved', validatorId);
        }
    }
}
exports.ProofOfAuthority = ProofOfAuthority;
//# sourceMappingURL=poa.js.map