import { CryptoUtils } from '../crypto/CryptoUtils';

export interface TransactionData {
  from: string;
  to: string;
  amount: number;
  data?: any;
  timestamp: number;
}

export class Transaction {
  public from: string;
  public to: string;
  public amount: number;
  public data?: any;
  public timestamp: number;
  public signature?: string;
  public hash: string;

  constructor(data: TransactionData) {
    this.from = data.from;
    this.to = data.to;
    this.amount = data.amount;
    this.data = data.data;
    this.timestamp = data.timestamp;
    this.hash = this.calculateHash();
  }

  public calculateHash(): string {
    return CryptoUtils.calculateHash(
      this.from + this.to + this.amount.toString() + this.timestamp.toString()
    );
  }

  public async signTransaction(privateKey: string): Promise<void> {
    if (privateKey === undefined) {
      throw new Error('No private key provided');
    }

    const hashTx = this.from === 'system' ? this.calculateHash() : this.from;
    this.signature = await CryptoUtils.sign(hashTx, privateKey);
  }

  public isValid(): boolean {
    // If the transaction doesn't have a from address, it's a mining reward and is always valid
    if (this.from === null) return true;

    if (!this.signature || this.signature.length === 0) {
      throw new Error('No signature in this transaction');
    }

    const hashTx = this.from === 'system' ? this.calculateHash() : this.from;
    return CryptoUtils.verify(hashTx, this.signature, this.from);
  }

  public toJSON(): object {
    return {
      from: this.from,
      to: this.to,
      amount: this.amount,
      data: this.data,
      timestamp: this.timestamp,
      hash: this.hash,
      signature: this.signature
    };
  }

  public static fromJSON(json: any): Transaction {
    const tx = new Transaction({
      from: json.from,
      to: json.to,
      amount: json.amount,
      data: json.data,
      timestamp: json.timestamp
    });
    tx.hash = json.hash;
    tx.signature = json.signature;
    return tx;
  }

  public static createRewardTransaction(to: string, amount: number): Transaction {
    return new Transaction({
      from: 'system',
      to: to,
      amount: amount,
      timestamp: Date.now()
    });
  }
}
