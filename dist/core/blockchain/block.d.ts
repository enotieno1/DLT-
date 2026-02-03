import { Block, BlockHeader, Transaction } from '../types/block.types';
export declare class BlockBuilder {
    private block;
    constructor(parentHash: string, number: number, validator: string);
    addTransaction(transaction: Transaction): void;
    setGasLimit(limit: string): void;
    setExtraData(data: string): void;
    build(): Block;
    private calculateTransactionsRoot;
    private calculateReceiptsRoot;
    private calculateStateRoot;
    private calculateBlockHash;
    static calculateBlockHashStatic(header: BlockHeader): string;
    private merkleRoot;
}
export declare function validateBlock(block: Block): boolean;
//# sourceMappingURL=block.d.ts.map