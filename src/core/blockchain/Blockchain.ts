import { Block } from './SimpleBlock';
import { Transaction } from './SimpleBlock';
import { Level } from 'level';
import { EventEmitter } from 'events';

export class Blockchain extends EventEmitter {
    private chain: Block[];
    private difficulty: number;
    private pendingTransactions: Transaction[];
    private db: Level;
    private isPrivate: boolean;
    private networkType: 'private' | 'public' | 'hybrid';

    constructor(networkType: 'private' | 'public' | 'hybrid' = 'private', dbPath: string = './blockchain.db') {
        super();
        this.chain = [];
        this.difficulty = 4;
        this.pendingTransactions = [];
        this.networkType = networkType;
        this.isPrivate = networkType === 'private';
        this.db = new Level(dbPath);
        
        this.initializeChain();
    }

    private async initializeChain(): Promise<void> {
        try {
            const genesisBlock = await this.db.get('genesis');
            if (genesisBlock) {
                this.chain = JSON.parse(genesisBlock);
            } else {
                await this.createGenesisBlock();
            }
        } catch (error) {
            await this.createGenesisBlock();
        }
    }

    private async createGenesisBlock(): Promise<void> {
        const genesisBlock = new Block(
            0,
            Date.now(),
            [],
            '0',
            this.networkType,
            'genesis-creator'
        );
        
        genesisBlock.hash = genesisBlock.calculateHash();
        this.chain.push(genesisBlock);
        
        await this.db.put('genesis', JSON.stringify(this.chain));
        this.emit('blockCreated', genesisBlock);
    }

    getLatestBlock(): Block {
        return this.chain[this.chain.length - 1] || this.chain[0];
    }

    async addTransaction(transaction: Transaction): Promise<void> {
        if (!this.isValidTransaction(transaction)) {
            throw new Error('Invalid transaction');
        }

        this.pendingTransactions.push(transaction);
        this.emit('transactionAdded', transaction);
    }

    private isValidTransaction(transaction: Transaction): boolean {
        return Boolean(transaction.from && 
               transaction.to && 
               transaction.amount > 0 &&
               transaction.timestamp > 0);
    }

    async minePendingTransactions(miningRewardAddress: string): Promise<void> {
        const rewardTransaction: Transaction = {
            from: 'system',
            to: miningRewardAddress,
            amount: 10,
            timestamp: Date.now(),
            signature: '',
            hash: ''
        };

        this.pendingTransactions.push(rewardTransaction);

        const block = new Block(
            this.chain.length,
            Date.now(),
            this.pendingTransactions,
            this.getLatestBlock().hash,
            this.networkType,
            miningRewardAddress
        );

        block.mineBlock(this.difficulty);
        
        this.chain.push(block);
        this.pendingTransactions = [];
        
        await this.db.put('block_' + block.index, JSON.stringify(block));
        await this.db.put('genesis', JSON.stringify(this.chain));
        
        this.emit('blockMined', block);
    }

    getBalance(address: string): number {
        let balance = 0;

        for (const block of this.chain) {
            for (const transaction of block.transactions) {
                if (transaction.from === address) {
                    balance -= transaction.amount;
                }
                if (transaction.to === address) {
                    balance += transaction.amount;
                }
            }
        }

        return balance;
    }

    async getAllTransactions(): Promise<Transaction[]> {
        const transactions: Transaction[] = [];
        
        for (const block of this.chain) {
            transactions.push(...block.transactions);
        }
        
        return transactions;
    }

    async getTransactionHistory(address: string): Promise<Transaction[]> {
        const allTransactions = await this.getAllTransactions();
        return allTransactions.filter(tx => tx.from === address || tx.to === address);
    }

    isChainValid(): boolean {
        for (let i = 1; i < this.chain.length; i++) {
            const currentBlock = this.chain[i];
            const previousBlock = this.chain[i - 1];

            if (currentBlock.hash !== currentBlock.calculateHash()) {
                return false;
            }

            if (currentBlock.previousHash !== previousBlock.hash) {
                return false;
            }
        }

        return true;
    }

    async getBlock(index: number): Promise<Block | null> {
        if (index < 0 || index >= this.chain.length) {
            return null;
        }
        
        try {
            const blockData = await this.db.get('block_' + index);
            return JSON.parse(blockData);
        } catch (error) {
            return this.chain[index];
        }
    }

    getChainInfo() {
        return {
            length: this.chain.length,
            networkType: this.networkType,
            isPrivate: this.isPrivate,
            difficulty: this.difficulty,
            pendingTransactions: this.pendingTransactions.length,
            latestBlock: this.getLatestBlock().hash
        };
    }

    async createAuditTrail(): Promise<any> {
        const auditTrail = {
            timestamp: Date.now(),
            chainLength: this.chain.length,
            networkType: this.networkType,
            isValid: this.isChainValid(),
            blocks: this.chain.map(block => ({
                index: block.index,
                hash: block.hash,
                timestamp: block.timestamp,
                transactionCount: block.transactions.length,
                merkleRoot: block.merkleRoot
            }))
        };

        await this.db.put('audit_' + Date.now(), JSON.stringify(auditTrail));
        return auditTrail;
    }

    async verifyIntegrity(): Promise<boolean> {
        const currentChain = this.chain;
        const storedChain = await this.db.get('genesis');
        
        if (JSON.stringify(currentChain) !== storedChain) {
            return false;
        }
        
        return this.isChainValid();
    }
}
