export interface Block {
    hash: string;
    parentHash: string;
    number: number;
    timestamp: number;
    transactions: Transaction[];
    validator: string;
    signature: string;
    stateRoot: string;
    transactionsRoot: string;
    receiptsRoot: string;
    gasLimit: string;
    gasUsed: string;
    extraData: string;
}
export interface BlockHeader {
    parentHash: string;
    number: number;
    timestamp: number;
    validator: string;
    stateRoot: string;
    transactionsRoot: string;
    receiptsRoot: string;
    gasLimit: string;
    gasUsed: string;
    extraData: string;
}
export interface Transaction {
    hash: string;
    from: string;
    to: string;
    value: string;
    data: string;
    nonce: number;
    gasLimit: string;
    gasPrice: string;
    signature: string;
    timestamp: number;
}
export interface TransactionReceipt {
    transactionHash: string;
    blockNumber: number;
    blockHash: string;
    transactionIndex: number;
    status: boolean;
    gasUsed: string;
    logs: Log[];
    contractAddress?: string;
}
export interface Log {
    address: string;
    topics: string[];
    data: string;
    blockNumber: number;
    blockHash: string;
    transactionHash: string;
    transactionIndex: number;
    logIndex: number;
}
export interface GenesisBlock {
    alloc: {
        [address: string]: AccountState;
    };
    chainId: number;
    timestamp: number;
    gasLimit: string;
    difficulty: string;
    extraData: string;
    mixHash: string;
    nonce: string;
}
export interface AccountState {
    balance: string;
    nonce: number;
    code?: string;
    storage?: {
        [key: string]: string;
    };
}
//# sourceMappingURL=block.types.d.ts.map