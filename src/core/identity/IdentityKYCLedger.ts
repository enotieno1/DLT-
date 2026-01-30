import { EventEmitter } from 'events';
import { Blockchain } from '../blockchain/Blockchain';
import { SmartContractEngine } from '../smartcontracts/SmartContractEngine';
import { AuditTrail } from '../audit/AuditTrail';
import { PermissionManager, Permission } from '../accesscontrol/PermissionManager';
import { createHash } from 'crypto';

export enum IdentityType {
    INDIVIDUAL = 'individual',
    BUSINESS = 'business',
    GOVERNMENT = 'government',
    NGO = 'ngo'
}

export enum KYCStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    VERIFIED = 'verified',
    REJECTED = 'rejected',
    EXPIRED = 'expired',
    SUSPENDED = 'suspended'
}

export enum VerificationLevel {
    BASIC = 'basic',
    STANDARD = 'standard',
    ENHANCED = 'enhanced',
    ENTERPRISE = 'enterprise'
}

export interface IdentityRecord {
    id: string;
    type: IdentityType;
    verificationLevel: VerificationLevel;
    kycStatus: KYCStatus;
    personalInfo: PersonalInfo;
    businessInfo?: BusinessInfo;
    documents: IdentityDocument[];
    verifications: Verification[];
    sharingConsents: SharingConsent[];
    riskProfile: RiskProfile;
    createdAt: number;
    updatedAt: number;
    lastVerified?: number;
    expiresAt?: number;
    issuer: string;
    signature: string;
    hash: string;
}

export interface PersonalInfo {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    nationality: string;
    taxId: string;
    phoneNumber: string;
    email: string;
    addresses: Address[];
    biometricData?: BiometricData;
}

export interface BusinessInfo {
    businessName: string;
    registrationNumber: string;
    taxId: string;
    businessType: string;
    incorporationDate: string;
    jurisdiction: string;
    directors: Director[];
    shareholders: Shareholder[];
    beneficialOwners: BeneficialOwner[];
}

export interface Address {
    type: 'residential' | 'business' | 'mailing';
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    isPrimary: boolean;
}

export interface Director {
    name: string;
    position: string;
    dateOfBirth: string;
    nationality: string;
    address: Address;
    idNumber: string;
}

export interface Shareholder {
    name: string;
    percentage: number;
    shares: number;
    class: string;
}

export interface BeneficialOwner {
    name: string;
    percentage: number;
    relationship: string;
    dateOfBirth: string;
    nationality: string;
}

export interface BiometricData {
    fingerprint?: string;
    facialRecognition?: string;
    voicePrint?: string;
    irisScan?: string;
    hashed: boolean;
}

export interface IdentityDocument {
    type: 'passport' | 'national_id' | 'driver_license' | 'business_license' | 'tax_certificate' | 'articles_of_incorporation';
    number: string;
    issuingCountry: string;
    issueDate: string;
    expiryDate: string;
    documentHash: string;
    verificationStatus: 'pending' | 'verified' | 'rejected' | 'expired';
    verifiedAt?: number;
    verifiedBy?: string;
}

export interface Verification {
    type: 'document' | 'biometric' | 'address' | 'phone' | 'email' | 'business' | 'enhanced_diligence';
    status: 'pending' | 'passed' | 'failed' | 'expired';
    score: number;
    method: 'manual' | 'automated' | 'third_party';
    verifiedAt?: number;
    verifiedBy?: string;
    details: string;
    evidence?: string;
}

export interface SharingConsent {
    recipient: string;
    purpose: string;
    dataTypes: string[];
    grantedAt: number;
    expiresAt?: number;
    isActive: boolean;
    conditions?: string[];
}

export interface RiskProfile {
    score: number;
    level: 'low' | 'medium' | 'high' | 'critical';
    factors: RiskFactor[];
    lastAssessed: number;
    reviewRequired: boolean;
}

export interface RiskFactor {
    type: string;
    description: string;
    impact: number;
    severity: 'low' | 'medium' | 'high';
}

export interface IdentityVerificationRequest {
    identityType: IdentityType;
    verificationLevel: VerificationLevel;
    personalInfo: PersonalInfo;
    businessInfo?: BusinessInfo;
    documents: IdentityDocument[];
    requester: string;
    purpose: string;
    urgency: 'low' | 'medium' | 'high';
}

export interface IdentitySharingRequest {
    identityId: string;
    recipient: string;
    purpose: string;
    dataTypes: string[];
    duration: number; // in days
    conditions?: string[];
    requester: string;
}

export class IdentityKYCLedger extends EventEmitter {
    private blockchain: Blockchain;
    private smartContracts: SmartContractEngine;
    private auditTrail: AuditTrail;
    private permissionManager: PermissionManager;
    private identities: Map<string, IdentityRecord>;
    private verificationProviders: Map<string, VerificationProvider>;
    private sharingAgreements: Map<string, SharingAgreement>;

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
        this.identities = new Map();
        this.verificationProviders = new Map();
        this.sharingAgreements = new Map();
        
        this.initializeVerificationProviders();
    }

    // Identity Management
    async createIdentity(request: IdentityVerificationRequest): Promise<string> {
        const identityId = this.generateIdentityId();
        
        // Validate request
        const validation = await this.validateIdentityRequest(request);
        if (!validation.valid) {
            throw new Error(`Identity validation failed: ${validation.reason}`);
        }

        // Create identity record
        const identity: IdentityRecord = {
            id: identityId,
            type: request.identityType,
            verificationLevel: request.verificationLevel,
            kycStatus: KYCStatus.PENDING,
            personalInfo: request.personalInfo,
            businessInfo: request.businessInfo,
            documents: request.documents,
            verifications: [],
            sharingConsents: [],
            riskProfile: await this.assessRisk(request),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            issuer: request.requester,
            signature: '',
            hash: ''
        };

        // Calculate hash
        identity.hash = await this.calculateIdentityHash(identity);

        // Store on blockchain
        await this.storeIdentityOnBlockchain(identity);

        // Start verification process
        await this.startVerificationProcess(identity);

        this.identities.set(identityId, identity);

        await this.auditTrail.logSystemEvent('IDENTITY_CREATED', {
            identityId,
            type: request.identityType,
            verificationLevel: request.verificationLevel,
            requester: request.requester
        });

        this.emit('identityCreated', identity);
        return identityId;
    }

    async verifyIdentity(identityId: string, verificationType: string, verifier: string): Promise<boolean> {
        const identity = this.identities.get(identityId);
        if (!identity) {
            throw new Error('Identity not found');
        }

        // Check permissions
        const user = this.permissionManager.getUserByAddress(verifier);
        if (!user || !this.permissionManager.hasPermission(user.id, Permission.AUDIT_SYSTEM)) {
            throw new Error('Insufficient permissions to verify identity');
        }

        // Perform verification
        const verification = await this.performVerification(identity, verificationType, verifier);
        identity.verifications.push(verification);
        identity.updatedAt = Date.now();

        // Update status based on verifications
        await this.updateIdentityStatus(identity);

        // Store updated identity
        await this.storeIdentityOnBlockchain(identity);

        await this.auditTrail.logSystemEvent('IDENTITY_VERIFICATION_COMPLETED', {
            identityId,
            verificationType,
            status: verification.status,
            verifier
        });

        this.emit('identityVerified', { identityId, verification });
        return verification.status === 'passed';
    }

    async shareIdentity(request: IdentitySharingRequest): Promise<boolean> {
        const identity = this.identities.get(request.identityId);
        if (!identity) {
            throw new Error('Identity not found');
        }

        // Check if identity is verified
        if (identity.kycStatus !== KYCStatus.VERIFIED) {
            throw new Error('Only verified identities can be shared');
        }

        // Check if sharing consent exists
        const existingConsent = identity.sharingConsents.find(
            consent => consent.recipient === request.recipient && 
                     consent.purpose === request.purpose && 
                     consent.isActive
        );

        if (!existingConsent) {
            throw new Error('No valid sharing consent found');
        }

        // Create sharing record
        const sharingRecord = {
            identityId: request.identityId,
            recipient: request.recipient,
            purpose: request.purpose,
            sharedAt: Date.now(),
            dataTypes: request.dataTypes,
            consentId: existingConsent,
            sharedBy: request.requester
        };

        // Log sharing event
        await this.auditTrail.logSystemEvent('IDENTITY_SHARED', {
            identityId: request.identityId,
            recipient: request.recipient,
            purpose: request.purpose,
            dataTypes: request.dataTypes,
            sharedBy: request.requester
        });

        this.emit('identityShared', sharingRecord);
        return true;
    }

    async grantSharingConsent(identityId: string, consent: Omit<SharingConsent, 'grantedAt' | 'isActive'>): Promise<boolean> {
        const identity = this.identities.get(identityId);
        if (!identity) {
            throw new Error('Identity not found');
        }

        const newConsent: SharingConsent = {
            ...consent,
            grantedAt: Date.now(),
            isActive: true
        };

        // Remove existing consent for same recipient/purpose
        identity.sharingConsents = identity.sharingConsents.filter(
            c => !(c.recipient === consent.recipient && c.purpose === consent.purpose)
        );

        identity.sharingConsents.push(newConsent);
        identity.updatedAt = Date.now();

        await this.auditTrail.logSystemEvent('SHARING_CONSENT_GRANTED', {
            identityId,
            recipient: consent.recipient,
            purpose: consent.purpose,
            dataTypes: consent.dataTypes
        });

        this.emit('sharingConsentGranted', { identityId, consent: newConsent });
        return true;
    }

    async revokeSharingConsent(identityId: string, recipient: string, purpose: string): Promise<boolean> {
        const identity = this.identities.get(identityId);
        if (!identity) {
            throw new Error('Identity not found');
        }

        const consent = identity.sharingConsents.find(
            c => c.recipient === recipient && c.purpose === purpose && c.isActive
        );

        if (!consent) {
            throw new Error('No active consent found');
        }

        consent.isActive = false;
        identity.updatedAt = Date.now();

        await this.auditTrail.logSystemEvent('SHARING_CONSENT_REVOKED', {
            identityId,
            recipient,
            purpose
        });

        this.emit('sharingConsentRevoked', { identityId, recipient, purpose });
        return true;
    }

    async reduceKYCDuplication(identityId: string): Promise<{
        duplicatesFound: number;
        institutionsNotified: number;
        estimatedSavings: number;
    }> {
        const identity = this.identities.get(identityId);
        if (!identity || identity.kycStatus !== KYCStatus.VERIFIED) {
            throw new Error('Identity not found or not verified');
        }

        // Find potential duplicates based on personal info
        const duplicates = await this.findDuplicateIdentities(identity);
        
        // Notify institutions about verified identity
        const institutionsNotified = await this.notifyInstitutions(identity, duplicates);
        
        // Calculate estimated savings
        const estimatedSavings = institutionsNotified * 50; // $50 per KYC saved

        await this.auditTrail.logSystemEvent('KYC_DUPLICATION_REDUCED', {
            identityId,
            duplicatesFound: duplicates.length,
            institutionsNotified,
            estimatedSavings
        });

        return {
            duplicatesFound: duplicates.length,
            institutionsNotified,
            estimatedSavings
        };
    }

    async getIdentity(identityId: string): Promise<IdentityRecord | null> {
        return this.identities.get(identityId) || null;
    }

    async searchIdentities(criteria: {
        name?: string;
        taxId?: string;
        email?: string;
        phoneNumber?: string;
        businessName?: string;
        registrationNumber?: string;
    }): Promise<IdentityRecord[]> {
        const results: IdentityRecord[] = [];

        for (const identity of this.identities.values()) {
            let match = false;

            if (criteria.name) {
                const fullName = `${identity.personalInfo.firstName} ${identity.personalInfo.lastName}`.toLowerCase();
                if (fullName.includes(criteria.name.toLowerCase())) {
                    match = true;
                }
            }

            if (criteria.taxId && identity.personalInfo.taxId === criteria.taxId) {
                match = true;
            }

            if (criteria.email && identity.personalInfo.email === criteria.email) {
                match = true;
            }

            if (criteria.phoneNumber && identity.personalInfo.phoneNumber === criteria.phoneNumber) {
                match = true;
            }

            if (criteria.businessName && identity.businessInfo?.businessName === criteria.businessName) {
                match = true;
            }

            if (criteria.registrationNumber && identity.businessInfo?.registrationNumber === criteria.registrationNumber) {
                match = true;
            }

            if (match) {
                results.push(identity);
            }
        }

        return results;
    }

    async getIdentityStatistics(): Promise<{
        totalIdentities: number;
        byType: Record<IdentityType, number>;
        byStatus: Record<KYCStatus, number>;
        byLevel: Record<VerificationLevel, number>;
        verifiedCount: number;
        pendingCount: number;
        averageRiskScore: number;
    }> {
        const identities = Array.from(this.identities.values());
        
        const byType: Record<IdentityType, number> = {
            [IdentityType.INDIVIDUAL]: 0,
            [IdentityType.BUSINESS]: 0,
            [IdentityType.GOVERNMENT]: 0,
            [IdentityType.NGO]: 0
        };

        const byStatus: Record<KYCStatus, number> = {
            [KYCStatus.PENDING]: 0,
            [KYCStatus.IN_PROGRESS]: 0,
            [KYCStatus.VERIFIED]: 0,
            [KYCStatus.REJECTED]: 0,
            [KYCStatus.EXPIRED]: 0,
            [KYCStatus.SUSPENDED]: 0
        };

        const byLevel: Record<VerificationLevel, number> = {
            [VerificationLevel.BASIC]: 0,
            [VerificationLevel.STANDARD]: 0,
            [VerificationLevel.ENHANCED]: 0,
            [VerificationLevel.ENTERPRISE]: 0
        };

        let totalRiskScore = 0;

        for (const identity of identities) {
            byType[identity.type]++;
            byStatus[identity.kycStatus]++;
            byLevel[identity.verificationLevel]++;
            totalRiskScore += identity.riskProfile.score;
        }

        const averageRiskScore = identities.length > 0 ? totalRiskScore / identities.length : 0;

        return {
            totalIdentities: identities.length,
            byType,
            byStatus,
            byLevel,
            verifiedCount: byStatus[KYCStatus.VERIFIED],
            pendingCount: byStatus[KYCStatus.PENDING] + byStatus[KYCStatus.IN_PROGRESS],
            averageRiskScore
        };
    }

    // Private Helper Methods
    private async validateIdentityRequest(request: IdentityVerificationRequest): Promise<{
        valid: boolean;
        reason?: string;
    }> {
        // Check required fields
        if (!request.personalInfo.firstName || !request.personalInfo.lastName) {
            return { valid: false, reason: 'Missing name information' };
        }

        if (!request.personalInfo.dateOfBirth) {
            return { valid: false, reason: 'Missing date of birth' };
        }

        if (!request.personalInfo.taxId) {
            return { valid: false, reason: 'Missing tax ID' };
        }

        if (request.identityType === IdentityType.BUSINESS && !request.businessInfo) {
            return { valid: false, reason: 'Business information required for business identity' };
        }

        if (request.documents.length === 0) {
            return { valid: false, reason: 'At least one document required' };
        }

        return { valid: true };
    }

    private async assessRisk(request: IdentityVerificationRequest): Promise<RiskProfile> {
        let score = 0;
        const factors: RiskFactor[] = [];

        // Age assessment
        const age = this.calculateAge(request.personalInfo.dateOfBirth);
        if (age < 18) {
            score += 40;
            factors.push({
                type: 'age',
                description: 'Minor',
                impact: 40,
                severity: 'high'
            });
        } else if (age > 70) {
            score += 20;
            factors.push({
                type: 'age',
                description: 'Senior citizen',
                impact: 20,
                severity: 'medium'
            });
        }

        // Verification level risk
        const levelScores = {
            [VerificationLevel.BASIC]: 30,
            [VerificationLevel.STANDARD]: 20,
            [VerificationLevel.ENHANCED]: 10,
            [VerificationLevel.ENTERPRISE]: 5
        };
        score += levelScores[request.verificationLevel];

        // Document quality assessment
        const documentScore = await this.assessDocumentQuality(request.documents);
        score += documentScore;

        // Determine risk level
        let level: 'low' | 'medium' | 'high' | 'critical';
        if (score >= 80) {
            level = 'critical';
        } else if (score >= 60) {
            level = 'high';
        } else if (score >= 40) {
            level = 'medium';
        } else {
            level = 'low';
        }

        return {
            score,
            level,
            factors,
            lastAssessed: Date.now(),
            reviewRequired: score >= 60
        };
    }

    private calculateAge(dateOfBirth: string): number {
        const birth = new Date(dateOfBirth);
        const today = new Date();
        return today.getFullYear() - birth.getFullYear();
    }

    private async assessDocumentQuality(documents: IdentityDocument[]): Promise<number> {
        let score = 0;
        
        for (const doc of documents) {
            // Check if document is expired
            const expiryDate = new Date(doc.expiryDate);
            if (expiryDate < new Date()) {
                score += 20;
            }

            // Check document type
            const highValueDocs = ['passport', 'national_id'];
            if (highValueDocs.includes(doc.type)) {
                score -= 10;
            } else {
                score += 5;
            }
        }

        return Math.max(0, score);
    }

    private async storeIdentityOnBlockchain(identity: IdentityRecord): Promise<void> {
        // Store identity hash on blockchain
        const transaction = {
            from: 'system',
            to: 'identity-ledger',
            amount: 0,
            timestamp: Date.now(),
            signature: '',
            hash: ''
        };

        await this.blockchain.addTransaction(transaction);
        identity.hash = await this.calculateIdentityHash(identity);
    }

    private async calculateIdentityHash(identity: IdentityRecord): Promise<string> {
        const data = JSON.stringify({
            id: identity.id,
            type: identity.type,
            verificationLevel: identity.verificationLevel,
            personalInfo: {
                firstName: identity.personalInfo.firstName,
                lastName: identity.personalInfo.lastName,
                dateOfBirth: identity.personalInfo.dateOfBirth,
                taxId: identity.personalInfo.taxId
            },
            createdAt: identity.createdAt
        });

        return createHash('sha256').update(data).digest('hex');
    }

    private async startVerificationProcess(identity: IdentityRecord): Promise<void> {
        identity.kycStatus = KYCStatus.IN_PROGRESS;

        // Start document verification
        for (const document of identity.documents) {
            await this.verifyDocument(identity, document);
        }

        // Start biometric verification if available
        if (identity.personalInfo.biometricData) {
            await this.verifyBiometric(identity);
        }
    }

    private async verifyDocument(identity: IdentityRecord, document: IdentityDocument): Promise<void> {
        const verification: Verification = {
            type: 'document',
            status: 'pending',
            score: 0,
            method: 'automated',
            details: `Document verification for ${document.type}`,
            verifiedBy: 'system'
        };

        // Simulate document verification
        setTimeout(() => {
            verification.status = Math.random() > 0.1 ? 'passed' : 'failed';
            verification.score = verification.status === 'passed' ? 85 : 15;
            verification.verifiedAt = Date.now();
            
            identity.verifications.push(verification);
            this.updateIdentityStatus(identity);
        }, 2000);
    }

    private async verifyBiometric(identity: IdentityRecord): Promise<void> {
        const verification: Verification = {
            type: 'biometric',
            status: 'pending',
            score: 0,
            method: 'automated',
            details: 'Biometric verification',
            verifiedBy: 'system'
        };

        // Simulate biometric verification
        setTimeout(() => {
            verification.status = 'passed';
            verification.score = 90;
            verification.verifiedAt = Date.now();
            
            identity.verifications.push(verification);
            this.updateIdentityStatus(identity);
        }, 3000);
    }

    private async performVerification(identity: IdentityRecord, verificationType: string, verifier: string): Promise<Verification> {
        const verification: Verification = {
            type: verificationType as any,
            status: 'pending',
            score: 0,
            method: 'manual',
            details: `Manual verification by ${verifier}`,
            verifiedBy: verifier
        };

        // Simulate verification process
        await new Promise(resolve => setTimeout(resolve, 1000));

        verification.status = Math.random() > 0.1 ? 'passed' : 'failed';
        verification.score = verification.status === 'passed' ? 85 : 25;
        verification.verifiedAt = Date.now();

        return verification;
    }

    private async updateIdentityStatus(identity: IdentityRecord): Promise<void> {
        const allVerifications = identity.verifications;
        
        if (allVerifications.length === 0) {
            return;
        }

        const passedVerifications = allVerifications.filter(v => v.status === 'passed');
        const failedVerifications = allVerifications.filter(v => v.status === 'failed');

        // Determine status based on verification level and results
        const requiredVerifications = this.getRequiredVerifications(identity.verificationLevel);
        
        if (passedVerifications.length >= requiredVerifications && failedVerifications.length === 0) {
            identity.kycStatus = KYCStatus.VERIFIED;
            identity.lastVerified = Date.now();
            identity.expiresAt = Date.now() + (365 * 24 * 60 * 60 * 1000); // 1 year
        } else if (failedVerifications.length > 0) {
            identity.kycStatus = KYCStatus.REJECTED;
        } else {
            identity.kycStatus = KYCStatus.IN_PROGRESS;
        }

        identity.updatedAt = Date.now();
    }

    private getRequiredVerifications(level: VerificationLevel): number {
        const requirements = {
            [VerificationLevel.BASIC]: 1,
            [VerificationLevel.STANDARD]: 2,
            [VerificationLevel.ENHANCED]: 3,
            [VerificationLevel.ENTERPRISE]: 4
        };
        
        return requirements[level];
    }

    private async findDuplicateIdentities(identity: IdentityRecord): Promise<IdentityRecord[]> {
        const duplicates: IdentityRecord[] = [];
        
        for (const existingIdentity of this.identities.values()) {
            if (existingIdentity.id === identity.id) continue;
            
            // Check for potential duplicates based on personal info
            if (existingIdentity.personalInfo.taxId === identity.personalInfo.taxId ||
                existingIdentity.personalInfo.email === identity.personalInfo.email ||
                existingIdentity.personalInfo.phoneNumber === identity.personalInfo.phoneNumber) {
                
                // Only consider if the other identity is verified
                if (existingIdentity.kycStatus === KYCStatus.VERIFIED) {
                    duplicates.push(existingIdentity);
                }
            }
        }

        return duplicates;
    }

    private async notifyInstitutions(identity: IdentityRecord, duplicates: IdentityRecord[]): Promise<number> {
        let notified = 0;
        
        for (const duplicate of duplicates) {
            // In a real implementation, this would notify institutions
            // For demo, we'll simulate the notification
            await this.auditTrail.logSystemEvent('INSTITUTION_NOTIFIED', {
                identityId: identity.id,
                duplicateId: duplicate.id,
                institution: 'financial-institution-' + Math.random().toString(36).substring(2, 6)
            });
            notified++;
        }

        return notified;
    }

    private initializeVerificationProviders(): void {
        this.verificationProviders.set('document-verify', {
            name: 'Document Verification Service',
            type: 'document',
            capabilities: ['passport', 'national_id', 'driver_license'],
            accuracy: 0.95
        });

        this.verificationProviders.set('biometric-auth', {
            name: 'Biometric Authentication',
            type: 'biometric',
            capabilities: ['fingerprint', 'facial', 'voice'],
            accuracy: 0.98
        });

        this.verificationProviders.set('address-verify', {
            name: 'Address Verification',
            type: 'address',
            capabilities: ['residential', 'business'],
            accuracy: 0.92
        });
    }

    private generateIdentityId(): string {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }
}

// Supporting Types
interface VerificationProvider {
    name: string;
    type: string;
    capabilities: string[];
    accuracy: number;
}

interface SharingAgreement {
    id: string;
    parties: string[];
    terms: string;
    dataTypes: string[];
    duration: number;
    createdAt: number;
    isActive: boolean;
}
