import { createHash } from 'crypto';

export interface Transaction {
    from: string;
    to: string;
    amount: number;
    timestamp: number;
    signature: string;
    hash: string;
}

export class Block {
    public index: number;
    public timestamp: number;
    public transactions: Transaction[];
    public previousHash: string;
    public hash: string;
    public nonce: number;
    public networkType: 'private' | 'public' | 'hybrid';
    public validator: string;

    constructor(
        index: number,
        timestamp: number,
        transactions: Transaction[],
        previousHash: string,
        networkType: 'private' | 'public' | 'hybrid',
        validator: string
    ) {
        this.index = index;
        this.timestamp = timestamp;
        this.transactions = transactions;
        this.previousHash = previousHash;
        this.networkType = networkType;
        this.validator = validator;
        this.hash = this.calculateHash();
        this.nonce = 0;
    }

    calculateHash(): string {
        return createHash('sha256')
            .update(this.index + 
                   this.previousHash + 
                   this.timestamp + 
                   JSON.stringify(this.transactions) + 
                   this.nonce + 
                   this.validator)
            .digest('hex');
    }

    mineBlock(difficulty: number): void {
        const target = Array(difficulty + 1).join('0').padEnd(64, '0');
        
        while (this.hash.substring(0, difficulty) !== target) {
            this.nonce++;
            this.hash = this.calculateHash();
        }

        console.log(`Block mined: ${this.hash}`);
    }

    hasValidTransactions(): boolean {
        for (const tx of this.transactions) {
            if (!this.isValidTransaction(tx)) return false;
        }
        return true;
    }

    private isValidTransaction(transaction: Transaction): boolean {
        // Simplified validation - in production would verify signature
        return transaction.from && 
               transaction.to && 
               transaction.amount > 0 &&
               transaction.timestamp > 0;
    }
}
