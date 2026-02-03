import * as crypto from 'crypto';

export class CryptoUtils {
  private static readonly ALGORITHM = 'sha256';

  public static calculateHash(data: string): string {
    return crypto.createHash(this.ALGORITHM).update(data).digest('hex');
  }

  public static async sign(data: string, privateKey: string): Promise<string> {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(data);
    return sign.sign(privateKey, 'hex');
  }

  public static verify(data: string, signature: string, publicKey: string): boolean {
    try {
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(data);
      return verify.verify(publicKey, signature, 'hex');
    } catch (error) {
      return false;
    }
  }

  public static generateKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });

    return { publicKey, privateKey };
  }

  public static async signTransaction(transaction: any, nodeId: string): Promise<any> {
    // In a real implementation, this would use the node's private key
    // For now, we'll simulate the signature
    const transactionData = JSON.stringify(transaction);
    const signature = this.calculateHash(transactionData + nodeId);
    
    return {
      ...transaction,
      signature,
      signer: nodeId
    };
  }

  public static verifyTransaction(transaction: any): boolean {
    if (!transaction.signature || !transaction.signer) {
      return false;
    }

    const transactionData = JSON.stringify({
      from: transaction.from,
      to: transaction.to,
      amount: transaction.amount,
      timestamp: transaction.timestamp
    });

    const expectedSignature = this.calculateHash(transactionData + transaction.signer);
    return transaction.signature === expectedSignature;
  }

  public static generateUUID(): string {
    return crypto.randomUUID();
  }

  public static encrypt(data: string, key: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', key);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  public static decrypt(encryptedData: string, key: string): string {
    const textParts = encryptedData.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = textParts.join(':');
    const decipher = crypto.createDecipher('aes-256-cbc', key);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
