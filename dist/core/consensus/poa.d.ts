import { Block, Transaction } from '../types/block.types';
import { NodeInfo } from '../types/node.types';
import { EventEmitter } from 'events';
export interface ConsensusConfig {
    blockTime: number;
    validatorSet: string[];
    blockGasLimit: string;
    minValidators: number;
    votingPeriod: number;
}
export interface Vote {
    validator: string;
    blockHash: string;
    decision: boolean;
    signature: string;
    timestamp: number;
}
export declare class ProofOfAuthority extends EventEmitter {
    private config;
    private currentValidator;
    private pendingVotes;
    private isValidator;
    private nodeInfo;
    constructor(config: ConsensusConfig, nodeInfo: NodeInfo);
    proposeBlock(transactions: Transaction[]): Promise<Block>;
    voteOnBlock(blockHash: string, approve: boolean): Promise<Vote>;
    addVote(vote: Vote): Promise<boolean>;
    getNextValidator(): string;
    isNodeValidator(): boolean;
    private createBlock;
    private signBlock;
    private signVote;
    private verifyVoteSignature;
    private checkConsensus;
    private getLatestBlockHash;
    private getLatestBlockNumber;
    getValidatorSet(): string[];
    addValidator(validatorId: string): void;
    removeValidator(validatorId: string): void;
}
//# sourceMappingURL=poa.d.ts.map