import { EventEmitter } from 'events';
import { Blockchain } from '../blockchain/Blockchain';
import { SmartContractEngine } from '../smartcontracts/SmartContractEngine';
import { AuditTrail } from '../audit/AuditTrail';
import { PermissionManager, Permission } from '../accesscontrol/PermissionManager';
import { createHash } from 'crypto';

export enum TransactionType {
    PAYMENT = 'payment',
    TRANSFER = 'transfer',
    SETTLEMENT = 'settlement',
    REVERSAL = 'reversal',
    FEE = 'fee',
    INTEREST = 'interest',
    CROSS_BORDER = 'cross_border'
}

export enum TransactionStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    FAILED = 'failed',
    REVERSED = 'reversed',
    HELD = 'held'
}

export enum FraudRiskLevel {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    CRITICAL = 'critical'
}

export interface FinancialTransaction {
    id: string;
    type: TransactionType;
    status: TransactionStatus;
    amount: number;
    currency: string;
    fromAccount: string;
    toAccount: string;
    fromBank: string;
    toBank: string;
    reference: string;
    description: string;
    metadata: TransactionMetadata;
    fraudRisk: FraudRiskLevel;
    complianceChecks: ComplianceCheck[];
    settlementDetails?: SettlementDetails;
    createdAt: number;
    processedAt?: number;
    settledAt?: number;
    blockHash?: string;
    signature: string;
}

export interface TransactionMetadata {
    ipAddress?: string;
    deviceFingerprint?: string;
    location?: string;
    channel: 'web' | 'mobile' | 'api' | 'branch';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    recurring?: boolean;
    scheduledDate?: number;
    purposeCode?: string;
    regulatoryCode?: string;
}

export interface ComplianceCheck {
    type: 'aml' | 'kyc' | 'sanctions' | 'limits' | 'fraud';
    status: 'pass' | 'fail' | 'review';
    score: number;
    details: string;
    checkedAt: number;
    checkedBy: string;
}

export interface SettlementDetails {
    method: 'rtgs' | 'swift' | 'ach' | 'sepa' | 'crypto';
    reference: string;
    estimatedTime: number;
    actualTime?: number;
    fees: SettlementFees;
    intermediaryBanks: string[];
    trackingNumber?: string;
}

export interface SettlementFees {
    processing: number;
    intermediary: number;
    currency: string;
    total: number;
}

export interface ReconciliationReport {
    period: {
        start: number;
        end: number;
    };
    totalTransactions: number;
    totalAmount: number;
    matchedTransactions: number;
    unmatchedTransactions: number;
    discrepancies: Discrepancy[];
    generatedAt: number;
    status: 'completed' | 'pending' | 'failed';
}

export interface Discrepancy {
    transactionId: string;
    type: 'amount' | 'account' | 'currency' | 'timing';
    expected: any;
    actual: any;
    difference: any;
    severity: 'low' | 'medium' | 'high';
    resolved: boolean;
}

export class SecureFinancialLedger extends EventEmitter {
    private blockchain: Blockchain;
    private smartContracts: SmartContractEngine;
    private auditTrail: AuditTrail;
    private permissionManager: PermissionManager;
    private transactions: Map<string, FinancialTransaction>;
    private pendingTransactions: Map<string, FinancialTransaction>;
    private fraudDetectionRules: FraudRule[];
    private settlementEngine: SettlementEngine;
    private reconciliationEngine: ReconciliationEngine;

    constructor(
        blockchain: Blockchain,
        smartContracts: SmartContractEngine,
        auditTrail: AuditTrail,
        permissionManager: PermissionManager
    ) {
        super();
        this.blockchain = blockchain;
        this.smartContracts = smartContracts;
        this.auditTrail = auditTrail;
        this.permissionManager = permissionManager;
        this.transactions = new Map();
        this.pendingTransactions = new Map();
        this.fraudDetectionRules = this.initializeFraudRules();
        this.settlementEngine = new SettlementEngine(blockchain, auditTrail);
        this.reconciliationEngine = new ReconciliationEngine(auditTrail);
    }

    // Transaction Processing
    async submitTransaction(transaction: Omit<FinancialTransaction, 'id' | 'createdAt' | 'status'>): Promise<string> {
        const transactionId = this.generateTransactionId();
        
        const financialTransaction: FinancialTransaction = {
            ...transaction,
            id: transactionId,
            status: TransactionStatus.PENDING,
            createdAt: Date.now()
        };

        // Validate transaction
        const validation = await this.validateTransaction(financialTransaction);
        if (!validation.valid) {
            throw new Error(`Transaction validation failed: ${validation.reason}`);
        }

        // Perform fraud detection
        const fraudRisk = await this.assessFraudRisk(financialTransaction);
        financialTransaction.fraudRisk = fraudRisk.level;

        // Perform compliance checks
        const complianceChecks = await this.performComplianceChecks(financialTransaction);
        financialTransaction.complianceChecks = complianceChecks;

        // Check if transaction should be held for review
        if (fraudRisk.level === FraudRiskLevel.HIGH || fraudRisk.level === FraudRiskLevel.CRITICAL) {
            financialTransaction.status = TransactionStatus.HELD;
            await this.auditTrail.logSystemEvent('TRANSACTION_HELD', {
                transactionId,
                reason: `High fraud risk: ${fraudRisk.reason}`
            });
        } else if (complianceChecks.some(check => check.status === 'review')) {
            financialTransaction.status = TransactionStatus.HELD;
            await this.auditTrail.logSystemEvent('TRANSACTION_HELD', {
                transactionId,
                reason: 'Compliance review required'
            });
        } else {
            financialTransaction.status = TransactionStatus.PROCESSING;
            await this.processTransaction(financialTransaction);
        }

        this.pendingTransactions.set(transactionId, financialTransaction);
        this.transactions.set(transactionId, financialTransaction);

        this.emit('transactionSubmitted', financialTransaction);
        return transactionId;
    }

    async processTransaction(transaction: FinancialTransaction): Promise<void> {
        try {
            transaction.status = TransactionStatus.PROCESSING;
            transaction.processedAt = Date.now();

            // Add to blockchain
            await this.addToLedger(transaction);

            // Initiate settlement if applicable
            if (transaction.type === TransactionType.SETTLEMENT || 
                transaction.type === TransactionType.CROSS_BORDER) {
                const settlementDetails = await this.settlementEngine.initiateSettlement(transaction);
                transaction.settlementDetails = settlementDetails;
            }

            transaction.status = TransactionStatus.COMPLETED;
            transaction.settledAt = Date.now();

            await this.auditTrail.logSystemEvent('TRANSACTION_COMPLETED', {
                transactionId: transaction.id,
                amount: transaction.amount,
                currency: transaction.currency,
                fromAccount: transaction.fromAccount,
                toAccount: transaction.toAccount
            });

            this.emit('transactionCompleted', transaction);

        } catch (error) {
            transaction.status = TransactionStatus.FAILED;
            await this.auditTrail.logSystemEvent('TRANSACTION_FAILED', {
                transactionId: transaction.id,
                error: error.message
            });
            throw error;
        }
    }

    async reverseTransaction(transactionId: string, reason: string, reverser: string): Promise<boolean> {
        const transaction = this.transactions.get(transactionId);
        if (!transaction) {
            throw new Error('Transaction not found');
        }

        if (transaction.status !== TransactionStatus.COMPLETED) {
            throw new Error('Only completed transactions can be reversed');
        }

        // Check permissions
        const user = this.permissionManager.getUserByAddress(reverser);
        if (!user || !this.permissionManager.hasPermission(user.id, Permission.WRITE_BLOCKCHAIN)) {
            throw new Error('Insufficient permissions to reverse transaction');
        }

        // Create reversal transaction
        const reversal: FinancialTransaction = {
            id: this.generateTransactionId(),
            type: TransactionType.REVERSAL,
            status: TransactionStatus.PENDING,
            amount: -transaction.amount,
            currency: transaction.currency,
            fromAccount: transaction.toAccount,
            toAccount: transaction.fromAccount,
            fromBank: transaction.toBank,
            toBank: transaction.fromBank,
            reference: `REVERSAL-${transaction.id}`,
            description: `Reversal of transaction ${transaction.id}: ${reason}`,
            metadata: {
                originalTransactionId: transaction.id,
                reversalReason: reason,
                channel: 'api',
                priority: 'high'
            },
            fraudRisk: FraudRiskLevel.LOW,
            complianceChecks: [],
            createdAt: Date.now(),
            signature: ''
        };

        await this.processTransaction(reversal);
        
        // Update original transaction status
        transaction.status = TransactionStatus.REVERSED;

        await this.auditTrail.logSystemEvent('TRANSACTION_REVERSED', {
            originalTransactionId: transactionId,
            reversalTransactionId: reversal.id,
            reason,
            reverser
        });

        this.emit('transactionReversed', { original: transaction, reversal });
        return true;
    }

    // Fraud Detection
    async assessFraudRisk(transaction: FinancialTransaction): Promise<{
        level: FraudRiskLevel;
        score: number;
        reason: string;
        alerts: string[];
    }> {
        let riskScore = 0;
        const alerts: string[] = [];

        for (const rule of this.fraudDetectionRules) {
            const result = await rule.evaluate(transaction);
            if (result.triggered) {
                riskScore += result.score;
                alerts.push(result.alert);
            }
        }

        // Determine risk level based on score
        let level: FraudRiskLevel;
        let reason: string;

        if (riskScore >= 80) {
            level = FraudRiskLevel.CRITICAL;
            reason = 'Critical fraud risk detected';
        } else if (riskScore >= 60) {
            level = FraudRiskLevel.HIGH;
            reason = 'High fraud risk detected';
        } else if (riskScore >= 40) {
            level = FraudRiskLevel.MEDIUM;
            reason = 'Medium fraud risk detected';
        } else {
            level = FraudRiskLevel.LOW;
            reason = 'Low fraud risk';
        }

        return { level, score: riskScore, reason, alerts };
    }

    // Settlement System
    async initiateCrossBorderPayment(payment: {
        amount: number;
        currency: string;
        fromAccount: string;
        toAccount: string;
        fromBank: string;
        toBank: string;
        beneficiaryBank: string;
        intermediaryBanks: string[];
        purpose: string;
        reference: string;
    }): Promise<string> {
        const transaction: FinancialTransaction = {
            id: this.generateTransactionId(),
            type: TransactionType.CROSS_BORDER,
            status: TransactionStatus.PENDING,
            amount: payment.amount,
            currency: payment.currency,
            fromAccount: payment.fromAccount,
            toAccount: payment.toAccount,
            fromBank: payment.fromBank,
            toBank: payment.toBank,
            reference: payment.reference,
            description: `Cross-border payment: ${payment.purpose}`,
            metadata: {
                beneficiaryBank: payment.beneficiaryBank,
                channel: 'api',
                priority: 'high',
                purposeCode: payment.purpose,
                regulatoryCode: 'XCB'
            },
            fraudRisk: FraudRiskLevel.MEDIUM,
            complianceChecks: [],
            createdAt: Date.now(),
            signature: ''
        };

        return this.submitTransaction(transaction);
    }

    // Reconciliation System
    async generateReconciliationReport(startDate: number, endDate: number): Promise<ReconciliationReport> {
        return this.reconciliationEngine.generateReport(startDate, endDate);
    }

    async autoReconcile(): Promise<ReconciliationReport> {
        const now = Date.now();
        const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
        return this.reconciliationEngine.generateReport(twentyFourHoursAgo, now);
    }

    // Analytics and Reporting
    async getTransactionStatistics(period: 'hour' | 'day' | 'week' | 'month'): Promise<{
        totalTransactions: number;
        totalAmount: number;
        averageAmount: number;
        successRate: number;
        fraudDetectionRate: number;
        settlementTime: number;
        byType: Record<TransactionType, number>;
        byCurrency: Record<string, number>;
        byBank: Record<string, number>;
    }> {
        const endTime = Date.now();
        let startTime: number;

        switch (period) {
            case 'hour':
                startTime = endTime - (60 * 60 * 1000);
                break;
            case 'day':
                startTime = endTime - (24 * 60 * 60 * 1000);
                break;
            case 'week':
                startTime = endTime - (7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                startTime = endTime - (30 * 24 * 60 * 60 * 1000);
                break;
        }

        const transactions = Array.from(this.transactions.values())
            .filter(tx => tx.createdAt >= startTime && tx.createdAt <= endTime);

        const totalTransactions = transactions.length;
        const totalAmount = transactions.reduce((sum, tx) => sum + tx.amount, 0);
        const averageAmount = totalTransactions > 0 ? totalAmount / totalTransactions : 0;
        const completedTransactions = transactions.filter(tx => tx.status === TransactionStatus.COMPLETED);
        const successRate = totalTransactions > 0 ? (completedTransactions.length / totalTransactions) * 100 : 0;
        const fraudTransactions = transactions.filter(tx => tx.fraudRisk === FraudRiskLevel.HIGH || tx.fraudRisk === FraudRiskLevel.CRITICAL);
        const fraudDetectionRate = totalTransactions > 0 ? (fraudTransactions.length / totalTransactions) * 100 : 0;

        const settlementTimes = completedTransactions
            .filter(tx => tx.settledAt && tx.processedAt)
            .map(tx => tx.settledAt! - tx.processedAt!);
        const averageSettlementTime = settlementTimes.length > 0 ? settlementTimes.reduce((a, b) => a + b, 0) / settlementTimes.length : 0;

        const byType: Record<TransactionType, number> = {} as any;
        const byCurrency: Record<string, number> = {};
        const byBank: Record<string, number> = {};

        for (const tx of transactions) {
            byType[tx.type] = (byType[tx.type] || 0) + 1;
            byCurrency[tx.currency] = (byCurrency[tx.currency] || 0) + 1;
            byBank[tx.fromBank] = (byBank[tx.fromBank] || 0) + 1;
            byBank[tx.toBank] = (byBank[tx.toBank] || 0) + 1;
        }

        return {
            totalTransactions,
            totalAmount,
            averageAmount,
            successRate,
            fraudDetectionRate,
            settlementTime: averageSettlementTime,
            byType,
            byCurrency,
            byBank
        };
    }

    // Private Helper Methods
    private async validateTransaction(transaction: FinancialTransaction): Promise<{
        valid: boolean;
        reason?: string;
    }> {
        if (!transaction.fromAccount || !transaction.toAccount) {
            return { valid: false, reason: 'Missing account information' };
        }

        if (transaction.amount <= 0) {
            return { valid: false, reason: 'Invalid amount' };
        }

        if (transaction.fromAccount === transaction.toAccount) {
            return { valid: false, reason: 'Cannot transfer to same account' };
        }

        return { valid: true };
    }

    private async performComplianceChecks(transaction: FinancialTransaction): Promise<ComplianceCheck[]> {
        const checks: ComplianceCheck[] = [];

        // AML Check
        const amlCheck = await this.performAMLCheck(transaction);
        checks.push(amlCheck);

        // Sanctions Check
        const sanctionsCheck = await this.performSanctionsCheck(transaction);
        checks.push(sanctionsCheck);

        // Limits Check
        const limitsCheck = await this.performLimitsCheck(transaction);
        checks.push(limitsCheck);

        return checks;
    }

    private async performAMLCheck(transaction: FinancialTransaction): Promise<ComplianceCheck> {
        // Simplified AML check - in production would use actual AML databases
        const suspiciousPatterns = [
            transaction.amount > 10000,
            transaction.metadata.channel === 'branch' && transaction.amount > 5000,
            transaction.type === TransactionType.CROSS_BORDER && transaction.amount > 25000
        ];

        const riskScore = suspiciousPatterns.filter(Boolean).length * 25;
        const status = riskScore >= 50 ? 'review' : 'pass';

        return {
            type: 'aml',
            status: status as 'pass' | 'fail' | 'review',
            score: riskScore,
            details: `AML check completed with risk score ${riskScore}`,
            checkedAt: Date.now(),
            checkedBy: 'system'
        };
    }

    private async performSanctionsCheck(transaction: FinancialTransaction): Promise<ComplianceCheck> {
        // Simplified sanctions check
        const status = 'pass'; // In production would check against sanctions lists
        
        return {
            type: 'sanctions',
            status: status as 'pass' | 'fail' | 'review',
            score: 0,
            details: 'Sanctions check passed',
            checkedAt: Date.now(),
            checkedBy: 'system'
        };
    }

    private async performLimitsCheck(transaction: FinancialTransaction): Promise<ComplianceCheck> {
        // Simplified limits check
        const dailyLimit = 50000;
        const status = Math.abs(transaction.amount) <= dailyLimit ? 'pass' : 'review';
        const score = Math.abs(transaction.amount) > dailyLimit ? 75 : 0;

        return {
            type: 'limits',
            status: status as 'pass' | 'fail' | 'review',
            score,
            details: `Daily limit check: ${transaction.amount} vs ${dailyLimit}`,
            checkedAt: Date.now(),
            checkedBy: 'system'
        };
    }

    private async addToLedger(transaction: FinancialTransaction): Promise<void> {
        // Add transaction to blockchain
        const blockchainTransaction = {
            from: transaction.fromAccount,
            to: transaction.toAccount,
            amount: transaction.amount,
            timestamp: transaction.createdAt,
            signature: transaction.signature,
            hash: ''
        };

        await this.blockchain.addTransaction(blockchainTransaction);
        transaction.blockHash = await this.calculateTransactionHash(transaction);
    }

    private async calculateTransactionHash(transaction: FinancialTransaction): Promise<string> {
        const data = JSON.stringify({
            id: transaction.id,
            type: transaction.type,
            amount: transaction.amount,
            currency: transaction.currency,
            fromAccount: transaction.fromAccount,
            toAccount: transaction.toAccount,
            reference: transaction.reference,
            createdAt: transaction.createdAt
        });
        
        return createHash('sha256').update(data).digest('hex');
    }

    private initializeFraudRules(): FraudRule[] {
        return [
            new LargeAmountRule(),
            new UnusualLocationRule(),
            new RapidTransactionsRule(),
            new NewAccountRule(),
            new SuspiciousTimeRule()
        ];
    }

    private generateTransactionId(): string {
        return 'txn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }
}

// Fraud Detection Rules
interface FraudRule {
    evaluate(transaction: FinancialTransaction): Promise<{
        triggered: boolean;
        score: number;
        alert: string;
    }>;
}

class LargeAmountRule implements FraudRule {
    async evaluate(transaction: FinancialTransaction): Promise<{
        triggered: boolean;
        score: number;
        alert: string;
    }> {
        const threshold = 50000;
        const triggered = Math.abs(transaction.amount) > threshold;
        return {
            triggered,
            score: triggered ? 30 : 0,
            alert: triggered ? `Large amount transaction: ${transaction.amount}` : ''
        };
    }
}

class UnusualLocationRule implements FraudRule {
    async evaluate(transaction: FinancialTransaction): Promise<{
        triggered: boolean;
        score: number;
        alert: string;
    }> {
        // Simplified location check
        const unusualLocations = ['high-risk-country-1', 'high-risk-country-2'];
        const triggered = unusualLocations.includes(transaction.metadata.location || '');
        return {
            triggered,
            score: triggered ? 25 : 0,
            alert: triggered ? `Transaction from unusual location: ${transaction.metadata.location}` : ''
        };
    }
}

class RapidTransactionsRule implements FraudRule {
    async evaluate(transaction: FinancialTransaction): Promise<{
        triggered: boolean;
        score: number;
        alert: string;
    }> {
        // This would check for rapid transactions from the same account
        // Simplified for demo
        return {
            triggered: false,
            score: 0,
            alert: ''
        };
    }
}

class NewAccountRule implements FraudRule {
    async evaluate(transaction: FinancialTransaction): Promise<{
        triggered: boolean;
        score: number;
        alert: string;
    }> {
        // This would check if account is new
        // Simplified for demo
        return {
            triggered: false,
            score: 0,
            alert: ''
        };
    }
}

class SuspiciousTimeRule implements FraudRule {
    async evaluate(transaction: FinancialTransaction): Promise<{
        triggered: boolean;
        score: number;
        alert: string;
    }> {
        const hour = new Date(transaction.createdAt).getHours();
        const suspiciousHours = [2, 3, 4, 5]; // Early morning transactions
        const triggered = suspiciousHours.includes(hour) && Math.abs(transaction.amount) > 10000;
        
        return {
            triggered,
            score: triggered ? 20 : 0,
            alert: triggered ? `Suspicious time transaction: ${hour}:00` : ''
        };
    }
}

// Settlement Engine
class SettlementEngine {
    private blockchain: Blockchain;
    private auditTrail: AuditTrail;

    constructor(blockchain: Blockchain, auditTrail: AuditTrail) {
        this.blockchain = blockchain;
        this.auditTrail = auditTrail;
    }

    async initiateSettlement(transaction: FinancialTransaction): Promise<SettlementDetails> {
        const method = this.determineSettlementMethod(transaction);
        const fees = this.calculateSettlementFees(transaction, method);
        const estimatedTime = this.estimateSettlementTime(method);
        const intermediaryBanks = this.getIntermediaryBanks(transaction, method);

        const settlementDetails: SettlementDetails = {
            method,
            reference: `SETTLE-${transaction.id}`,
            estimatedTime,
            fees,
            intermediaryBanks,
            trackingNumber: this.generateTrackingNumber()
        };

        await this.auditTrail.logSystemEvent('SETTLEMENT_INITIATED', {
            transactionId: transaction.id,
            method,
            estimatedTime,
            fees: fees.total
        });

        return settlementDetails;
    }

    private determineSettlementMethod(transaction: FinancialTransaction): 'rtgs' | 'swift' | 'ach' | 'sepa' | 'crypto' {
        if (transaction.type === TransactionType.CROSS_BORDER) {
            return 'swift';
        } else if (transaction.amount > 100000) {
            return 'rtgs';
        } else if (transaction.currency === 'EUR') {
            return 'sepa';
        } else if (transaction.amount < 25000) {
            return 'ach';
        } else {
            return 'crypto';
        }
    }

    private calculateSettlementFees(transaction: FinancialTransaction, method: string): SettlementFees {
        const baseFee = method === 'swift' ? 25 : method === 'rtgs' ? 15 : 5;
        const percentageFee = method === 'swift' ? 0.001 : 0.0005;
        
        const processingFee = baseFee;
        const intermediaryFee = Math.abs(transaction.amount) * percentageFee;
        const total = processingFee + intermediaryFee;

        return {
            processing: processingFee,
            intermediary: intermediaryFee,
            currency: transaction.currency,
            total
        };
    }

    private estimateSettlementTime(method: string): number {
        const times = {
            'rtgs': 5 * 60 * 1000, // 5 minutes
            'swift': 2 * 60 * 60 * 1000, // 2 hours
            'ach': 24 * 60 * 60 * 1000, // 24 hours
            'sepa': 8 * 60 * 60 * 1000, // 8 hours
            'crypto': 10 * 60 * 1000 // 10 minutes
        };
        
        return times[method as keyof typeof times] || 60 * 60 * 1000; // 1 hour default
    }

    private getIntermediaryBanks(transaction: FinancialTransaction, method: string): string[] {
        if (method === 'swift' && transaction.fromBank !== transaction.toBank) {
            return ['correspondent-bank-1', 'correspondent-bank-2'];
        }
        return [];
    }

    private generateTrackingNumber(): string {
        return 'TRK' + Date.now() + Math.random().toString(36).substring(2, 8).toUpperCase();
    }
}

// Reconciliation Engine
class ReconciliationEngine {
    private auditTrail: AuditTrail;

    constructor(auditTrail: AuditTrail) {
        this.auditTrail = auditTrail;
    }

    async generateReport(startDate: number, endDate: number): Promise<ReconciliationReport> {
        // In a real implementation, this would compare internal records with external systems
        // For demo, we'll simulate the reconciliation process
        
        const totalTransactions = 1000; // Simulated
        const totalAmount = 5000000; // Simulated
        const matchedTransactions = 980;
        const unmatchedTransactions = 20;

        const discrepancies: Discrepancy[] = [
            {
                transactionId: 'txn_001',
                type: 'amount',
                expected: 1000,
                actual: 950,
                difference: 50,
                severity: 'medium',
                resolved: false
            },
            {
                transactionId: 'txn_002',
                type: 'account',
                expected: 'ACC123',
                actual: 'ACC124',
                difference: 'account mismatch',
                severity: 'high',
                resolved: false
            }
        ];

        const report: ReconciliationReport = {
            period: { start: startDate, end: endDate },
            totalTransactions,
            totalAmount,
            matchedTransactions,
            unmatchedTransactions,
            discrepancies,
            generatedAt: Date.now(),
            status: 'completed'
        };

        await this.auditTrail.logSystemEvent('RECONCILIATION_REPORT_GENERATED', {
            period: report.period,
            totalTransactions,
            matchedTransactions,
            unmatchedTransactions,
            discrepancies: discrepancies.length
        });

        return report;
    }
}
