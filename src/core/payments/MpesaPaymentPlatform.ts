import { EventEmitter } from 'events';
import { SecureFinancialLedger } from '../financial/SecureFinancialLedger';
import { AuditTrail } from '../audit/AuditTrail';
import { PermissionManager } from '../accesscontrol/PermissionManager';

export enum MpesaTransactionType {
    PAYBILL = 'PAYBILL',
    BUY_GOODS = 'BUY_GOODS',
    SEND_MONEY = 'SEND_MONEY',
    WITHDRAW_CASH = 'WITHDRAW_CASH',
    AIRTIME = 'AIRTIME',
    BUSINESS_PAYMENT = 'BUSINESS_PAYMENT',
    SALARY_PAYMENT = 'SALARY_PAYMENT'
}

export enum MpesaTransactionStatus {
    PENDING = 'PENDING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    REVERSED = 'REVERSED',
    TIMEOUT = 'TIMEOUT'
}

export interface MpesaTransaction {
    id: string;
    transactionType: MpesaTransactionType;
    transactionRef: string;
    originParty: string;
    destinationParty: string;
    amount: number;
    currency: string;
    timestamp: Date;
    status: MpesaTransactionStatus;
    phoneNumber: string;
    accountNumber?: string;
    businessNumber?: string;
    narrative?: string;
    metadata: {
        [key: string]: any;
    };
    blockchainTxId?: string;
    settlementTime?: number;
    fraudScore?: number;
}

export interface MpesaAccount {
    phoneNumber: string;
    accountName: string;
    accountType: 'PERSONAL' | 'BUSINESS' | 'AGENT';
    businessNumber?: string;
    tillNumber?: string;
    isActive: boolean;
    dailyLimit: number;
    monthlyLimit: number;
    currentDailyUsage: number;
    currentMonthlyUsage: number;
    kycStatus: 'VERIFIED' | 'PENDING' | 'UNVERIFIED';
    registeredAt: Date;
    lastActivity: Date;
}

export interface MpesaBusinessConfig {
    businessNumber: string;
    businessName: string;
    businessType: string;
    settlementAccount: string;
    callbackUrl: string;
    securityCredential: string;
    initiatorName: string;
    shortCode: string;
    organizationId: string;
    supportedTransactionTypes: MpesaTransactionType[];
    transactionLimits: {
        daily: number;
        monthly: number;
        perTransaction: number;
    };
    commissionRates: {
        paybill: number;
        buyGoods: number;
        sendMoney: number;
        withdrawal: number;
    };
}

export class MpesaPaymentPlatform extends EventEmitter {
    private transactions: Map<string, MpesaTransaction> = new Map();
    private accounts: Map<string, MpesaAccount> = new Map();
    private businessConfigs: Map<string, MpesaBusinessConfig> = new Map();
    private financialLedger: SecureFinancialLedger;
    private auditTrail: AuditTrail;
    private permissionManager: PermissionManager;
    private apiKey: string;
    private apiSecret: string;
    private sandboxMode: boolean;

    constructor(
        financialLedger: SecureFinancialLedger,
        auditTrail: AuditTrail,
        permissionManager: PermissionManager,
        config: {
            apiKey: string;
            apiSecret: string;
            sandboxMode?: boolean;
        }
    ) {
        super();
        this.financialLedger = financialLedger;
        this.auditTrail = auditTrail;
        this.permissionManager = permissionManager;
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.sandboxMode = config.sandboxMode || true;
        
        this.initializeDefaultBusinesses();
    }

    // Account Management
    async registerAccount(accountData: Omit<MpesaAccount, 'isActive' | 'currentDailyUsage' | 'currentMonthlyUsage' | 'registeredAt' | 'lastActivity'>): Promise<MpesaAccount> {
        const account: MpesaAccount = {
            ...accountData,
            isActive: true,
            currentDailyUsage: 0,
            currentMonthlyUsage: 0,
            registeredAt: new Date(),
            lastActivity: new Date()
        };

        // Validate permissions
        if (!this.permissionManager.hasPermission('SYSTEM', 'MPESA_ACCOUNT_CREATE')) {
            throw new Error('Insufficient permissions to create M-Pesa account');
        }

        // Validate KYC for business accounts
        if (account.accountType === 'BUSINESS' && account.kycStatus !== 'VERIFIED') {
            throw new Error('Business accounts require KYC verification');
        }

        this.accounts.set(account.phoneNumber, account);

        // Log to audit trail
        await this.auditTrail.logEvent({
            eventType: 'MPESA_ACCOUNT_REGISTERED',
            userId: 'SYSTEM',
            resourceId: account.phoneNumber,
            details: {
                accountType: account.accountType,
                accountName: account.accountName,
                kycStatus: account.kycStatus
            }
        });

        // Emit event
        this.emit('accountRegistered', account);

        return account;
    }

    async updateAccountLimits(phoneNumber: string, dailyLimit: number, monthlyLimit: number, updater: string): Promise<MpesaAccount> {
        const account = this.accounts.get(phoneNumber);
        if (!account) {
            throw new Error('Account not found');
        }

        // Validate permissions
        if (!this.permissionManager.hasPermission(updater, 'MPESA_LIMIT_UPDATE')) {
            throw new Error('Insufficient permissions to update account limits');
        }

        account.dailyLimit = dailyLimit;
        account.monthlyLimit = monthlyLimit;

        // Log to audit trail
        await this.auditTrail.logEvent({
            eventType: 'MPESA_LIMITS_UPDATED',
            userId: updater,
            resourceId: phoneNumber,
            details: {
                dailyLimit,
                monthlyLimit
            }
        });

        // Emit event
        this.emit('limitsUpdated', account);

        return account;
    }

    // Business Configuration
    async configureBusiness(config: MpesaBusinessConfig, configurator: string): Promise<MpesaBusinessConfig> {
        // Validate permissions
        if (!this.permissionManager.hasPermission(configurator, 'MPESA_BUSINESS_CONFIG')) {
            throw new Error('Insufficient permissions to configure M-Pesa business');
        }

        this.businessConfigs.set(config.businessNumber, config);

        // Log to audit trail
        await this.auditTrail.logEvent({
            eventType: 'MPESA_BUSINESS_CONFIGURED',
            userId: configurator,
            resourceId: config.businessNumber,
            details: {
                businessName: config.businessName,
                businessType: config.businessType,
                supportedTransactionTypes: config.supportedTransactionTypes
            }
        });

        // Emit event
        this.emit('businessConfigured', config);

        return config;
    }

    // Transaction Processing
    async initiateTransaction(transactionData: Omit<MpesaTransaction, 'id' | 'timestamp' | 'status' | 'blockchainTxId' | 'settlementTime' | 'fraudScore'>): Promise<MpesaTransaction> {
        const transaction: MpesaTransaction = {
            ...transactionData,
            id: this.generateTransactionId(),
            timestamp: new Date(),
            status: MpesaTransactionStatus.PENDING
        };

        // Validate accounts
        const originAccount = this.accounts.get(transaction.originParty);
        const destinationAccount = this.accounts.get(transaction.destinationParty);

        if (!originAccount || !destinationAccount) {
            throw new Error('Invalid origin or destination account');
        }

        // Check account limits
        if (!this.checkAccountLimits(originAccount, transaction.amount)) {
            throw new Error('Transaction exceeds account limits');
        }

        // Fraud detection
        const fraudScore = await this.assessFraudRisk(transaction);
        transaction.fraudScore = fraudScore;

        if (fraudScore > 80) {
            transaction.status = MpesaTransactionStatus.FAILED;
            throw new Error('Transaction blocked due to high fraud risk');
        }

        // Process with M-Pesa API
        try {
            const mpesaResponse = await this.processWithMpesaAPI(transaction);
            
            if (mpesaResponse.success) {
                transaction.status = MpesaTransactionStatus.COMPLETED;
                transaction.transactionRef = mpesaResponse.transactionRef;
                
                // Update account usage
                this.updateAccountUsage(originAccount, transaction.amount);
                
                // Record on blockchain
                const blockchainTx = await this.recordTransactionOnBlockchain(transaction);
                transaction.blockchainTxId = blockchainTx.txId;
                transaction.settlementTime = blockchainTx.settlementTime;
                
                // Update financial ledger
                await this.financialLedger.processTransaction({
                    id: transaction.id,
                    type: 'MPESA_PAYMENT',
                    amount: transaction.amount,
                    currency: transaction.currency,
                    fromAccount: transaction.originParty,
                    toAccount: transaction.destinationParty,
                    metadata: {
                        mpesaTransactionRef: transaction.transactionRef,
                        phoneNumber: transaction.phoneNumber,
                        transactionType: transaction.transactionType
                    }
                });
                
            } else {
                transaction.status = MpesaTransactionStatus.FAILED;
            }
        } catch (error) {
            transaction.status = MpesaTransactionStatus.TIMEOUT;
            console.error('M-Pesa API error:', error);
        }

        // Store transaction
        this.transactions.set(transaction.id, transaction);

        // Log to audit trail
        await this.auditTrail.logEvent({
            eventType: 'MPESA_TRANSACTION_PROCESSED',
            userId: 'SYSTEM',
            resourceId: transaction.id,
            details: {
                transactionType: transaction.transactionType,
                amount: transaction.amount,
                status: transaction.status,
                fraudScore: transaction.fraudScore
            }
        });

        // Emit event
        this.emit('transactionProcessed', transaction);

        return transaction;
    }

    async processCallback(callbackData: any): Promise<void> {
        const transactionRef = callbackData.TransactionRef;
        const resultCode = callbackData.ResultCode;
        const resultDesc = callbackData.ResultDesc;

        // Find the transaction
        const transaction = Array.from(this.transactions.values())
            .find(tx => tx.transactionRef === transactionRef);

        if (!transaction) {
            console.error('Transaction not found for callback:', transactionRef);
            return;
        }

        // Update transaction status based on callback
        if (resultCode === 0) {
            transaction.status = MpesaTransactionStatus.COMPLETED;
        } else {
            transaction.status = MpesaTransactionStatus.FAILED;
        }

        // Log callback
        await this.auditTrail.logEvent({
            eventType: 'MPESA_CALLBACK_RECEIVED',
            userId: 'SYSTEM',
            resourceId: transaction.id,
            details: {
                resultCode,
                resultDesc,
                callbackData
            }
        });

        // Emit event
        this.emit('callbackReceived', transaction);
    }

    async reverseTransaction(transactionId: string, reason: string, reverser: string): Promise<MpesaTransaction> {
        const transaction = this.transactions.get(transactionId);
        if (!transaction) {
            throw new Error('Transaction not found');
        }

        if (transaction.status !== MpesaTransactionStatus.COMPLETED) {
            throw new Error('Only completed transactions can be reversed');
        }

        // Validate permissions
        if (!this.permissionManager.hasPermission(reverser, 'MPESA_TRANSACTION_REVERSE')) {
            throw new Error('Insufficient permissions to reverse transaction');
        }

        // Process reversal with M-Pesa API
        try {
            const reversalResponse = await this.processReversalWithMpesaAPI(transaction);
            
            if (reversalResponse.success) {
                transaction.status = MpesaTransactionStatus.REVERSED;
                
                // Reverse blockchain transaction
                if (transaction.blockchainTxId) {
                    await this.reverseBlockchainTransaction(transaction.blockchainTxId);
                }
                
                // Update financial ledger
                await this.financialLedger.processTransaction({
                    id: transaction.id + '_REVERSAL',
                    type: 'MPESA_REVERSAL',
                    amount: -transaction.amount,
                    currency: transaction.currency,
                    fromAccount: transaction.destinationParty,
                    toAccount: transaction.originParty,
                    metadata: {
                        originalTransactionId: transaction.id,
                        reversalReason: reason
                    }
                });
            }
        } catch (error) {
            console.error('M-Pesa reversal error:', error);
            throw new Error('Failed to process reversal');
        }

        // Log to audit trail
        await this.auditTrail.logEvent({
            eventType: 'MPESA_TRANSACTION_REVERSED',
            userId: reverser,
            resourceId: transaction.id,
            details: {
                reason,
                reversalAmount: transaction.amount
            }
        });

        // Emit event
        this.emit('transactionReversed', transaction);

        return transaction;
    }

    // Query Methods
    getTransaction(transactionId: string): MpesaTransaction | undefined {
        return this.transactions.get(transactionId);
    }

    getTransactionsByPhone(phoneNumber: string): MpesaTransaction[] {
        return Array.from(this.transactions.values())
            .filter(tx => tx.phoneNumber === phoneNumber || tx.originParty === phoneNumber || tx.destinationParty === phoneNumber);
    }

    getTransactionsByStatus(status: MpesaTransactionStatus): MpesaTransaction[] {
        return Array.from(this.transactions.values())
            .filter(tx => tx.status === status);
    }

    getTransactionsByDateRange(startDate: Date, endDate: Date): MpesaTransaction[] {
        return Array.from(this.transactions.values())
            .filter(tx => tx.timestamp >= startDate && tx.timestamp <= endDate);
    }

    getAccount(phoneNumber: string): MpesaAccount | undefined {
        return this.accounts.get(phoneNumber);
    }

    getBusinessConfig(businessNumber: string): MpesaBusinessConfig | undefined {
        return this.businessConfigs.get(businessNumber);
    }

    // Analytics and Reporting
    getTransactionStatistics(timeframe: 'TODAY' | 'WEEK' | 'MONTH' | 'YEAR'): {
        totalTransactions: number;
        totalVolume: number;
        successRate: number;
        averageTransactionValue: number;
        transactionTypes: { [type: string]: number };
        topMerchants: Array<{ businessNumber: string; volume: number; count: number }>;
    } {
        const now = new Date();
        let startDate: Date;

        switch (timeframe) {
            case 'TODAY':
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                break;
            case 'WEEK':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'MONTH':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'YEAR':
                startDate = new Date(now.getFullYear(), 0, 1);
                break;
        }

        const transactions = this.getTransactionsByDateRange(startDate, now);
        const completedTransactions = transactions.filter(tx => tx.status === MpesaTransactionStatus.COMPLETED);

        // Transaction types breakdown
        const transactionTypes: { [type: string]: number } = {};
        transactions.forEach(tx => {
            transactionTypes[tx.transactionType] = (transactionTypes[tx.transactionType] || 0) + 1;
        });

        // Top merchants
        const merchantVolumes: { [businessNumber: string]: { volume: number; count: number } } = {};
        completedTransactions.forEach(tx => {
            if (tx.businessNumber) {
                if (!merchantVolumes[tx.businessNumber]) {
                    merchantVolumes[tx.businessNumber] = { volume: 0, count: 0 };
                }
                merchantVolumes[tx.businessNumber].volume += tx.amount;
                merchantVolumes[tx.businessNumber].count += 1;
            }
        });

        const topMerchants = Object.entries(merchantVolumes)
            .map(([businessNumber, data]) => ({ businessNumber, ...data }))
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 10);

        return {
            totalTransactions: transactions.length,
            totalVolume: completedTransactions.reduce((sum, tx) => sum + tx.amount, 0),
            successRate: transactions.length > 0 ? (completedTransactions.length / transactions.length) * 100 : 0,
            averageTransactionValue: completedTransactions.length > 0 ? 
                completedTransactions.reduce((sum, tx) => sum + tx.amount, 0) / completedTransactions.length : 0,
            transactionTypes,
            topMerchants
        };
    }

    // Helper Methods
    private generateTransactionId(): string {
        return 'MPESA_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    private checkAccountLimits(account: MpesaAccount, amount: number): boolean {
        return (account.currentDailyUsage + amount) <= account.dailyLimit &&
               (account.currentMonthlyUsage + amount) <= account.monthlyLimit;
    }

    private updateAccountUsage(account: MpesaAccount, amount: number): void {
        account.currentDailyUsage += amount;
        account.currentMonthlyUsage += amount;
        account.lastActivity = new Date();
    }

    private async assessFraudRisk(transaction: MpesaTransaction): Promise<number> {
        let score = 0;

        // Amount-based risk
        if (transaction.amount > 100000) score += 30;
        else if (transaction.amount > 50000) score += 20;
        else if (transaction.amount > 10000) score += 10;

        // Frequency-based risk
        const recentTransactions = this.getTransactionsByPhone(transaction.phoneNumber)
            .filter(tx => Date.now() - tx.timestamp.getTime() < 24 * 60 * 60 * 1000);
        
        if (recentTransactions.length > 20) score += 25;
        else if (recentTransactions.length > 10) score += 15;

        // Time-based risk
        const hour = new Date().getHours();
        if (hour < 6 || hour > 22) score += 10;

        // Account age risk
        const account = this.accounts.get(transaction.phoneNumber);
        if (account && Date.now() - account.registeredAt.getTime() < 7 * 24 * 60 * 60 * 1000) {
            score += 20;
        }

        return Math.min(score, 100);
    }

    private async processWithMpesaAPI(transaction: MpesaTransaction): Promise<{ success: boolean; transactionRef?: string }> {
        // Simulate M-Pesa API call
        // In production, this would make actual API calls to Safaricom M-Pesa API
        
        if (this.sandboxMode) {
            // Sandbox simulation
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
            
            // Simulate 95% success rate
            if (Math.random() < 0.95) {
                return {
                    success: true,
                    transactionRef: 'SAF_' + Date.now()
                };
            } else {
                return { success: false };
            }
        }

        // Production API call would go here
        throw new Error('Production M-Pesa API not implemented');
    }

    private async processReversalWithMpesaAPI(transaction: MpesaTransaction): Promise<{ success: boolean }> {
        // Simulate reversal API call
        if (this.sandboxMode) {
            await new Promise(resolve => setTimeout(resolve, 500));
            return { success: true };
        }

        // Production reversal API call would go here
        throw new Error('Production M-Pesa reversal API not implemented');
    }

    private async recordTransactionOnBlockchain(transaction: MpesaTransaction): Promise<{ txId: string; settlementTime: number }> {
        // Record transaction on blockchain for immutability
        const startTime = Date.now();
        
        // Simulate blockchain recording
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const txId = 'BLOCKCHAIN_' + transaction.id;
        const settlementTime = Date.now() - startTime;

        return { txId, settlementTime };
    }

    private async reverseBlockchainTransaction(txId: string): Promise<void> {
        // Simulate blockchain reversal
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    private initializeDefaultBusinesses(): void {
        // Initialize some default business configurations for demo
        const defaultBusinesses: MpesaBusinessConfig[] = [
            {
                businessNumber: '174379',
                businessName: 'Veridion Chain Ltd',
                businessType: 'FINTECH',
                settlementAccount: 'VERIDION_SETTLEMENT',
                callbackUrl: 'https://api.veridion.com/mpesa/callback',
                securityCredential: 'demo_credential',
                initiatorName: 'VERIDION_API',
                shortCode: '174379',
                organizationId: 'VERIDION_ORG',
                supportedTransactionTypes: [
                    MpesaTransactionType.PAYBILL,
                    MpesaTransactionType.BUY_GOODS,
                    MpesaTransactionType.BUSINESS_PAYMENT
                ],
                transactionLimits: {
                    daily: 10000000,
                    monthly: 100000000,
                    perTransaction: 500000
                },
                commissionRates: {
                    paybill: 0.01,
                    buyGoods: 0.015,
                    sendMoney: 0.02,
                    withdrawal: 0.025
                }
            }
        ];

        defaultBusinesses.forEach(business => {
            this.businessConfigs.set(business.businessNumber, business);
        });
    }
}
