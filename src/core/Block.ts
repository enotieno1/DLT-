import { Transaction } from './Transaction';
import { CryptoUtils } from '../crypto/CryptoUtils';

export class Block {
  public index: number;
  public previousHash: string;
  public transactions: Transaction[];
  public timestamp: number;
  public hash: string;
  public nonce: number;
  public validator: string;

  constructor(
    index: number,
    previousHash: string,
    transactions: Transaction[],
    timestamp: number,
    hash?: string,
    nonce: number = 0,
    validator: string = ''
  ) {
    this.index = index;
    this.previousHash = previousHash;
    this.transactions = transactions;
    this.timestamp = timestamp;
    this.nonce = nonce;
    this.validator = validator;
    this.hash = hash || this.calculateHash();
  }

  public calculateHash(): string {
    return CryptoUtils.calculateHash(
      this.index.toString() +
      this.previousHash +
      JSON.stringify(this.transactions) +
      this.timestamp.toString() +
      this.nonce.toString() +
      this.validator
    );
  }

  public hasValidTransactions(): boolean {
    for (const tx of this.transactions) {
      if (!tx.isValid()) {
        return false;
      }
    }
    return true;
  }

  public getTransactionCount(): number {
    return this.transactions.length;
  }

  public getTotalValue(): number {
    return this.transactions.reduce((total, tx) => total + tx.amount, 0);
  }

  public toJSON(): object {
    return {
      index: this.index,
      previousHash: this.previousHash,
      transactions: this.transactions.map(tx => tx.toJSON()),
      timestamp: this.timestamp,
      hash: this.hash,
      nonce: this.nonce,
      validator: this.validator
    };
  }

  public static fromJSON(json: any): Block {
    const transactions = json.transactions.map((tx: any) => Transaction.fromJSON(tx));
    return new Block(
      json.index,
      json.previousHash,
      transactions,
      json.timestamp,
      json.hash,
      json.nonce,
      json.validator
    );
  }
}
