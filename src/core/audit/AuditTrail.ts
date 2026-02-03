import { EventEmitter } from 'events';
import { Level } from 'level';
import { createHash } from 'crypto';

export interface AuditEntry {
    id: string;
    timestamp: number;
    eventType: string;
    userId?: string;
    address?: string;
    action: string;
    details: any;
    hash: string;
    previousHash: string;
    signature?: string;
}

export interface AuditFilter {
    startDate?: number;
    endDate?: number;
    userId?: string;
    address?: string;
    eventType?: string;
    action?: string;
    limit?: number;
    offset?: number;
}

export class AuditTrail extends EventEmitter {
    private db: Level;
    private entries: AuditEntry[];
    private lastHash: string;
    private isImmutable: boolean;
    private batchSize: number;

    constructor(dbPath: string = './audit.db', immutable: boolean = true) {
        super();
        this.db = new Level(dbPath);
        this.entries = [];
        this.lastHash = '0';
        this.isImmutable = immutable;
        this.batchSize = 100;
        
        this.initializeAuditTrail();
    }

    private async initializeAuditTrail(): Promise<void> {
        try {
            const lastEntry = await this.db.get('last_audit_entry');
            if (lastEntry) {
                const entry = JSON.parse(lastEntry);
                this.lastHash = entry.hash;
                this.entries.push(entry);
            }
        } catch (error) {
            // No existing audit trail, start fresh
            await this.createGenesisAuditEntry();
        }
    }

    private async createGenesisAuditEntry(): Promise<void> {
        const genesisEntry: AuditEntry = {
            id: 'audit_genesis',
            timestamp: Date.now(),
            eventType: 'SYSTEM',
            action: 'AUDIT_TRAIL_INITIALIZED',
            details: {
                message: 'Audit trail initialized',
                immutable: this.isImmutable
            },
            hash: this.calculateHash('0', Date.now(), 'SYSTEM', 'AUDIT_TRAIL_INITIALIZED', {}),
            previousHash: '0'
        };

        await this.addEntry(genesisEntry);
    }

    async logEvent(entry: Omit<AuditEntry, 'id' | 'hash' | 'previousHash'>): Promise<string> {
        const auditEntry: AuditEntry = {
            id: this.generateEntryId(),
            ...entry,
            hash: '',
            previousHash: this.lastHash
        };

        auditEntry.hash = this.calculateHash(
            auditEntry.previousHash,
            auditEntry.timestamp,
            auditEntry.eventType,
            auditEntry.action,
            auditEntry.details
        );

        await this.addEntry(auditEntry);
        return auditEntry.id;
    }

    async logTransaction(
        transactionId: string,
        from: string,
        to: string,
        amount: number,
        userId?: string
    ): Promise<string> {
        return this.logEvent({
            timestamp: Date.now(),
            eventType: 'TRANSACTION',
            userId,
            address: from,
            action: 'TRANSACTION_EXECUTED',
            details: {
                transactionId,
                from,
                to,
                amount,
                timestamp: Date.now()
            }
        });
    }

    async logContractInteraction(
        contractAddress: string,
        functionName: string,
        args: any[],
        from: string,
        userId?: string
    ): Promise<string> {
        return this.logEvent({
            timestamp: Date.now(),
            eventType: 'CONTRACT',
            userId,
            address: from,
            action: 'CONTRACT_EXECUTED',
            details: {
                contractAddress,
                functionName,
                args,
                from,
                timestamp: Date.now()
            }
        });
    }

    async logPermissionChange(
        userId: string,
        targetUserId: string,
        permission: string,
        action: 'GRANTED' | 'REVOKED',
        adminAddress: string
    ): Promise<string> {
        return this.logEvent({
            timestamp: Date.now(),
            eventType: 'PERMISSION',
            userId,
            address: adminAddress,
            action: `PERMISSION_${action}`,
            details: {
                targetUserId,
                permission,
                action,
                adminAddress,
                timestamp: Date.now()
            }
        });
    }

    async logSystemEvent(
        action: string,
        details: any,
        userId?: string
    ): Promise<string> {
        return this.logEvent({
            timestamp: Date.now(),
            eventType: 'SYSTEM',
            userId,
            action,
            details
        });
    }

    async logSecurityEvent(
        eventType: 'LOGIN' | 'LOGOUT' | 'FAILED_LOGIN' | 'SUSPICIOUS_ACTIVITY',
        address: string,
        details: any,
        userId?: string
    ): Promise<string> {
        return this.logEvent({
            timestamp: Date.now(),
            eventType: 'SECURITY',
            userId,
            address,
            action: eventType,
            details: {
                ...details,
                address,
                timestamp: Date.now()
            }
        });
    }

    async getAuditTrail(filter?: AuditFilter): Promise<AuditEntry[]> {
        let filteredEntries = [...this.entries];

        if (filter) {
            if (filter.startDate) {
                filteredEntries = filteredEntries.filter(entry => entry.timestamp >= filter.startDate!);
            }
            if (filter.endDate) {
                filteredEntries = filteredEntries.filter(entry => entry.timestamp <= filter.endDate!);
            }
            if (filter.userId) {
                filteredEntries = filteredEntries.filter(entry => entry.userId === filter.userId);
            }
            if (filter.address) {
                filteredEntries = filteredEntries.filter(entry => entry.address === filter.address);
            }
            if (filter.eventType) {
                filteredEntries = filteredEntries.filter(entry => entry.eventType === filter.eventType);
            }
            if (filter.action) {
                filteredEntries = filteredEntries.filter(entry => entry.action === filter.action);
            }
        }

        // Sort by timestamp (newest first)
        filteredEntries.sort((a, b) => b.timestamp - a.timestamp);

        // Apply pagination
        if (filter?.offset) {
            filteredEntries = filteredEntries.slice(filter.offset);
        }
        if (filter?.limit) {
            filteredEntries = filteredEntries.slice(0, filter.limit);
        }

        return filteredEntries;
    }

    async getEntryById(id: string): Promise<AuditEntry | null> {
        return this.entries.find(entry => entry.id === id) || null;
    }

    async getEntriesByUser(userId: string, limit?: number): Promise<AuditEntry[]> {
        return this.getAuditTrail({
            userId,
            limit
        });
    }

    async getEntriesByAddress(address: string, limit?: number): Promise<AuditEntry[]> {
        return this.getAuditTrail({
            address,
            limit
        });
    }

    async getEntriesByEventType(eventType: string, limit?: number): Promise<AuditEntry[]> {
        return this.getAuditTrail({
            eventType,
            limit
        });
    }

    async verifyAuditTrailIntegrity(): Promise<{
        isValid: boolean;
        tamperedEntries: string[];
        lastVerifiedBlock: number;
    }> {
        const tamperedEntries: string[] = [];
        let isValid = true;

        for (let i = 1; i < this.entries.length; i++) {
            const currentEntry = this.entries[i];
            const previousEntry = this.entries[i - 1];

            // Verify hash chain
            if (currentEntry.previousHash !== previousEntry.hash) {
                tamperedEntries.push(currentEntry.id);
                isValid = false;
            }

            // Recalculate and verify hash
            const expectedHash = this.calculateHash(
                currentEntry.previousHash,
                currentEntry.timestamp,
                currentEntry.eventType,
                currentEntry.action,
                currentEntry.details
            );

            if (currentEntry.hash !== expectedHash) {
                tamperedEntries.push(currentEntry.id);
                isValid = false;
            }
        }

        return {
            isValid,
            tamperedEntries,
            lastVerifiedBlock: this.entries.length - 1
        };
    }

    async exportAuditTrail(format: 'json' | 'csv' = 'json', filter?: AuditFilter): Promise<string> {
        const entries = await this.getAuditTrail(filter);

        if (format === 'csv') {
            const headers = ['ID', 'Timestamp', 'Event Type', 'User ID', 'Address', 'Action', 'Details', 'Hash'];
            const csvRows = [headers.join(',')];

            for (const entry of entries) {
                const row = [
                    entry.id,
                    new Date(entry.timestamp).toISOString(),
                    entry.eventType,
                    entry.userId || '',
                    entry.address || '',
                    entry.action,
                    JSON.stringify(entry.details).replace(/"/g, '""'),
                    entry.hash
                ];
                csvRows.push(row.join(','));
            }

            return csvRows.join('\n');
        }

        return JSON.stringify({
            exportedAt: Date.now(),
            totalEntries: entries.length,
            entries
        }, null, 2);
    }

    async getAuditStatistics(): Promise<{
        totalEntries: number;
        entriesByType: Record<string, number>;
        entriesByAction: Record<string, number>;
        dateRange: { start: number; end: number };
        uniqueUsers: number;
        uniqueAddresses: number;
    }> {
        const entries = this.entries;
        const entriesByType: Record<string, number> = {};
        const entriesByAction: Record<string, number> = {};
        const uniqueUsers = new Set<string>();
        const uniqueAddresses = new Set<string>();

        let startTime = Date.now();
        let endTime = 0;

        for (const entry of entries) {
            // Count by type
            entriesByType[entry.eventType] = (entriesByType[entry.eventType] || 0) + 1;
            
            // Count by action
            entriesByAction[entry.action] = (entriesByAction[entry.action] || 0) + 1;
            
            // Track unique users and addresses
            if (entry.userId) uniqueUsers.add(entry.userId);
            if (entry.address) uniqueAddresses.add(entry.address);
            
            // Track date range
            startTime = Math.min(startTime, entry.timestamp);
            endTime = Math.max(endTime, entry.timestamp);
        }

        return {
            totalEntries: entries.length,
            entriesByType,
            entriesByAction,
            dateRange: { start: startTime, end: endTime },
            uniqueUsers: uniqueUsers.size,
            uniqueAddresses: uniqueAddresses.size
        };
    }

    private async addEntry(entry: AuditEntry): Promise<void> {
        if (this.isImmutable && this.entries.length > 0) {
            // Verify integrity before adding new entry
            const integrity = await this.verifyAuditTrailIntegrity();
            if (!integrity.isValid) {
                throw new Error('Audit trail integrity compromised - cannot add new entries');
            }
        }

        this.entries.push(entry);
        this.lastHash = entry.hash;

        // Store in database
        await this.db.put(`audit_${entry.id}`, JSON.stringify(entry));
        await this.db.put('last_audit_entry', JSON.stringify(entry));

        // Emit event
        this.emit('auditEntryAdded', entry);

        // Batch cleanup if needed
        if (this.entries.length % this.batchSize === 0) {
            await this.cleanupOldEntries();
        }
    }

    private async cleanupOldEntries(): Promise<void> {
        // Keep only last 10,000 entries in memory
        if (this.entries.length > 10000) {
            this.entries = this.entries.slice(-5000);
        }
    }

    private generateEntryId(): string {
        return 'audit_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    private calculateHash(
        previousHash: string,
        timestamp: number,
        eventType: string,
        action: string,
        details: any
    ): string {
        const data = previousHash + timestamp + eventType + action + JSON.stringify(details);
        return createHash('sha256').update(data).digest('hex');
    }

    // Compliance and reporting methods
    async generateComplianceReport(startDate: number, endDate: number): Promise<{
        period: { start: number; end: number };
        totalTransactions: number;
        totalUsers: number;
        suspiciousActivities: number;
        complianceScore: number;
        details: any;
    }> {
        const entries = await this.getAuditTrail({
            startDate,
            endDate
        });

        const transactions = entries.filter(e => e.eventType === 'TRANSACTION');
        const securityEvents = entries.filter(e => e.eventType === 'SECURITY');
        const suspiciousActivities = securityEvents.filter(e => e.action === 'SUSPICIOUS_ACTIVITY');
        
        const uniqueUsers = new Set(
            entries.filter(e => e.userId).map(e => e.userId!)
        ).size;

        // Calculate compliance score (simplified)
        const complianceScore = Math.max(0, 100 - (suspiciousActivities.length / Math.max(1, transactions.length)) * 100);

        return {
            period: { start: startDate, end: endDate },
            totalTransactions: transactions.length,
            totalUsers: uniqueUsers,
            suspiciousActivities: suspiciousActivities.length,
            complianceScore,
            details: {
                transactionVolume: transactions.reduce((sum, tx) => sum + (tx.details.amount || 0), 0),
                securityEvents: securityEvents.length,
                auditIntegrity: (await this.verifyAuditTrailIntegrity()).isValid
            }
        };
    }
}
