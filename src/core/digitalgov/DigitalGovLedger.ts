import { EventEmitter } from 'events';
import { Blockchain } from '../blockchain/Blockchain';
import { SmartContractEngine } from '../smartcontracts/SmartContractEngine';
import { AuditTrail } from '../audit/AuditTrail';
import { PermissionManager } from '../accesscontrol/PermissionManager';

export enum RecordType {
  LAND_REGISTRY = 'LAND_REGISTRY',
  BUSINESS_REGISTRATION = 'BUSINESS_REGISTRATION',
  ACADEMIC_CERTIFICATE = 'ACADEMIC_CERTIFICATE',
  VOTING_RECORD = 'VOTING_RECORD',
  LEGAL_RECORD = 'LEGAL_RECORD'
}

export enum RecordStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  ARCHIVED = 'ARCHIVED'
}

export interface GovernmentRecord {
  id: string;
  type: RecordType;
  status: RecordStatus;
  title: string;
  description: string;
  data: any;
  owner: string;
  issuer: string;
  issuedAt: Date;
  expiresAt?: Date;
  verifiedAt?: Date;
  metadata: Record<string, any>;
  documentHash?: string;
  tags: string[];
}

export interface LandRegistryRecord extends GovernmentRecord {
  type: RecordType.LAND_REGISTRY;
  data: {
    parcelId: string;
    address: string;
    coordinates: {
      latitude: number;
      longitude: number;
    };
    area: number;
    landUse: string;
    ownershipHistory: Array<{
      owner: string;
      transferredAt: Date;
      price?: number;
    }>;
    encumbrances: Array<{
      type: string;
      description: string;
      amount?: number;
      registeredAt: Date;
    }>;
  };
}

export interface BusinessRegistrationRecord extends GovernmentRecord {
  type: RecordType.BUSINESS_REGISTRATION;
  data: {
    businessName: string;
    registrationNumber: string;
    businessType: string;
    jurisdiction: string;
    incorporationDate: Date;
    authorizedCapital: number;
    directors: Array<{
      name: string;
      id: string;
      role: string;
    }>;
    shareholders: Array<{
      name: string;
      id: string;
      shares: number;
      percentage: number;
    }>;
    businessAddress: string;
    status: 'ACTIVE' | 'INACTIVE' | 'DISSOLVED';
  };
}

export interface AcademicCertificateRecord extends GovernmentRecord {
  type: RecordType.ACADEMIC_CERTIFICATE;
  data: {
    studentName: string;
    studentId: string;
    institution: string;
    degree: string;
    major: string;
    level: string;
    startDate: Date;
    endDate: Date;
    gpa?: number;
    honors?: string[];
    courses: Array<{
      code: string;
      name: string;
      credits: number;
      grade: string;
    }>;
    transcriptHash: string;
  };
}

export interface VotingRecord extends GovernmentRecord {
  type: RecordType.VOTING_RECORD;
  data: {
    electionId: string;
    electionName: string;
    electionDate: Date;
    voterId: string;
    vote: {
      candidateId?: string;
      partyId?: string;
      referendumChoice?: string;
    };
    pollingStation: string;
    verifiedAt: Date;
    isProvisional: boolean;
  };
}

export interface LegalRecord extends GovernmentRecord {
  type: RecordType.LEGAL_RECORD;
  data: {
    caseNumber: string;
    courtName: string;
    caseType: string;
    parties: Array<{
      name: string;
      role: string;
      representation?: string;
    }>;
    filingDate: Date;
    status: 'OPEN' | 'CLOSED' | 'APPEALED' | 'SETTLED';
    documents: Array<{
      type: string;
      description: string;
      fileHash: string;
      filedAt: Date;
    }>;
    hearings: Array<{
      date: Date;
      purpose: string;
      outcome?: string;
    }>;
    judgement?: {
      date: Date;
      summary: string;
      decision: string;
    };
  };
}

export interface VerificationRequest {
  id: string;
  recordId: string;
  requester: string;
  type: 'AUTHENTICITY' | 'OWNERSHIP' | 'STATUS';
  requestedAt: Date;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  processedAt?: Date;
  processedBy?: string;
  notes?: string;
}

export class DigitalGovLedger extends EventEmitter {
  private records: Map<string, GovernmentRecord> = new Map();
  private verificationRequests: Map<string, VerificationRequest> = new Map();
  private blockchain: Blockchain;
  private smartContractEngine: SmartContractEngine;
  private auditTrail: AuditTrail;
  private permissionManager: PermissionManager;

  constructor(
    blockchain: Blockchain,
    smartContractEngine: SmartContractEngine,
    auditTrail: AuditTrail,
    permissionManager: PermissionManager
  ) {
    super();
    this.blockchain = blockchain;
    this.smartContractEngine = smartContractEngine;
    this.auditTrail = auditTrail;
    this.permissionManager = permissionManager;
  }

  // Record Management
  async createRecord(record: Omit<GovernmentRecord, 'id' | 'issuedAt' | 'status'>): Promise<GovernmentRecord> {
    const id = this.generateRecordId();
    const newRecord: GovernmentRecord = {
      ...record,
      id,
      issuedAt: new Date(),
      status: RecordStatus.PENDING
    };

    // Validate permissions
    if (!this.permissionManager.hasPermission(record.issuer, 'GOV_RECORD_CREATE')) {
      throw new Error('Insufficient permissions to create government record');
    }

    // Store record
    this.records.set(id, newRecord);

    // Log to audit trail
    await this.auditTrail.logEvent({
      eventType: 'GOV_RECORD_CREATED',
      userId: record.issuer,
      resourceId: id,
      details: {
        recordType: record.type,
        title: record.title,
        owner: record.owner
      }
    });

    // Emit event
    this.emit('recordCreated', newRecord);

    return newRecord;
  }

  async verifyRecord(recordId: string, verifier: string): Promise<GovernmentRecord> {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error('Record not found');
    }

    // Validate permissions
    if (!this.permissionManager.hasPermission(verifier, 'GOV_RECORD_VERIFY')) {
      throw new Error('Insufficient permissions to verify government record');
    }

    // Update status
    record.status = RecordStatus.VERIFIED;
    record.verifiedAt = new Date();

    // Store on blockchain for immutability
    const recordHash = this.calculateRecordHash(record);
    await this.blockchain.addBlock({
      transactions: [{
        from: verifier,
        to: 'GOVERNMENT_LEDGER',
        amount: 0,
        data: {
          type: 'RECORD_VERIFICATION',
          recordId,
          recordHash,
          verifiedAt: record.verifiedAt
        }
      }]
    });

    // Log to audit trail
    await this.auditTrail.logEvent({
      eventType: 'GOV_RECORD_VERIFIED',
      userId: verifier,
      resourceId: recordId,
      details: {
        recordType: record.type,
        recordHash
      }
    });

    // Emit event
    this.emit('recordVerified', record);

    return record;
  }

  async updateRecord(recordId: string, updates: Partial<GovernmentRecord>, updater: string): Promise<GovernmentRecord> {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error('Record not found');
    }

    // Validate permissions
    if (!this.permissionManager.hasPermission(updater, 'GOV_RECORD_UPDATE') && record.owner !== updater) {
      throw new Error('Insufficient permissions to update government record');
    }

    // Apply updates
    Object.assign(record, updates);

    // Log to audit trail
    await this.auditTrail.logEvent({
      eventType: 'GOV_RECORD_UPDATED',
      userId: updater,
      resourceId: recordId,
      details: {
        updatedFields: Object.keys(updates)
      }
    });

    // Emit event
    this.emit('recordUpdated', record);

    return record;
  }

  // Land Registry Specific Methods
  async registerLand(landData: Omit<LandRegistryRecord, 'id' | 'issuedAt' | 'status' | 'type'>, registrar: string): Promise<LandRegistryRecord> {
    const landRecord: LandRegistryRecord = {
      ...landData,
      type: RecordType.LAND_REGISTRY,
      tags: ['land', 'registry', 'real-estate']
    };

    const createdRecord = await this.createRecord(landRecord);
    return createdRecord as LandRegistryRecord;
  }

  async transferLandOwnership(recordId: string, newOwner: string, transferDetails: { price?: number; date: Date }, transferrer: string): Promise<LandRegistryRecord> {
    const record = this.records.get(recordId) as LandRegistryRecord;
    if (!record || record.type !== RecordType.LAND_REGISTRY) {
      throw new Error('Land registry record not found');
    }

    // Validate permissions
    if (!this.permissionManager.hasPermission(transferrer, 'LAND_TRANSFER') && record.owner !== transferrer) {
      throw new Error('Insufficient permissions to transfer land ownership');
    }

    // Update ownership
    record.data.ownershipHistory.push({
      owner: newOwner,
      transferredAt: transferDetails.date,
      price: transferDetails.price
    });
    record.owner = newOwner;

    // Store transfer on blockchain
    await this.blockchain.addBlock({
      transactions: [{
        from: transferrer,
        to: newOwner,
        amount: 0,
        data: {
          type: 'LAND_TRANSFER',
          recordId,
          previousOwner: record.owner,
          newOwner,
          transferDetails
        }
      }]
    });

    // Log to audit trail
    await this.auditTrail.logEvent({
      eventType: 'LAND_OWNERSHIP_TRANSFERRED',
      userId: transferrer,
      resourceId: recordId,
      details: {
        previousOwner: record.owner,
        newOwner,
        transferDetails
      }
    });

    // Emit event
    this.emit('landOwnershipTransferred', record);

    return record;
  }

  // Business Registration Specific Methods
  async registerBusiness(businessData: Omit<BusinessRegistrationRecord, 'id' | 'issuedAt' | 'status' | 'type'>, registrar: string): Promise<BusinessRegistrationRecord> {
    const businessRecord: BusinessRegistrationRecord = {
      ...businessData,
      type: RecordType.BUSINESS_REGISTRATION,
      tags: ['business', 'registration', 'corporate']
    };

    const createdRecord = await this.createRecord(businessRecord);
    return createdRecord as BusinessRegistrationRecord;
  }

  async updateBusinessStatus(recordId: string, status: 'ACTIVE' | 'INACTIVE' | 'DISSOLVED', updater: string): Promise<BusinessRegistrationRecord> {
    const record = this.records.get(recordId) as BusinessRegistrationRecord;
    if (!record || record.type !== RecordType.BUSINESS_REGISTRATION) {
      throw new Error('Business registration record not found');
    }

    // Validate permissions
    if (!this.permissionManager.hasPermission(updater, 'BUSINESS_STATUS_UPDATE')) {
      throw new Error('Insufficient permissions to update business status');
    }

    record.data.status = status;

    // Log to audit trail
    await this.auditTrail.logEvent({
      eventType: 'BUSINESS_STATUS_UPDATED',
      userId: updater,
      resourceId: recordId,
      details: {
        newStatus: status
      }
    });

    // Emit event
    this.emit('businessStatusUpdated', record);

    return record;
  }

  // Academic Certificate Specific Methods
  async issueCertificate(certificateData: Omit<AcademicCertificateRecord, 'id' | 'issuedAt' | 'status' | 'type'>, institution: string): Promise<AcademicCertificateRecord> {
    const certificateRecord: AcademicCertificateRecord = {
      ...certificateData,
      type: RecordType.ACADEMIC_CERTIFICATE,
      tags: ['academic', 'certificate', 'education']
    };

    const createdRecord = await this.createRecord(certificateRecord);
    return createdRecord as AcademicCertificateRecord;
  }

  async verifyCertificate(recordId: string, verifier: string): Promise<boolean> {
    const record = this.records.get(recordId) as AcademicCertificateRecord;
    if (!record || record.type !== RecordType.ACADEMIC_CERTIFICATE) {
      throw new Error('Academic certificate record not found');
    }

    // Verify certificate authenticity
    const isValid = await this.verifyCertificateAuthenticity(record);

    if (isValid) {
      await this.verifyRecord(recordId, verifier);
    }

    return isValid;
  }

  // Voting System Specific Methods
  async recordVote(voteData: Omit<VotingRecord, 'id' | 'issuedAt' | 'status' | 'type'>, pollingStation: string): Promise<VotingRecord> {
    const voteRecord: VotingRecord = {
      ...voteData,
      type: RecordType.VOTING_RECORD,
      tags: ['voting', 'election', 'democracy']
    };

    const createdRecord = await this.createRecord(voteRecord);
    return createdRecord as VotingRecord;
  }

  async tallyVotes(electionId: string): Promise<{ [candidateId: string]: number }> {
    const votes = Array.from(this.records.values())
      .filter(record => record.type === RecordType.VOTING_RECORD && record.data.electionId === electionId);

    const tally: { [candidateId: string]: number } = {};

    votes.forEach(vote => {
      const votingRecord = vote as VotingRecord;
      if (votingRecord.data.vote.candidateId) {
        tally[votingRecord.data.vote.candidateId] = (tally[votingRecord.data.vote.candidateId] || 0) + 1;
      }
    });

    // Log to audit trail
    await this.auditTrail.logEvent({
      eventType: 'VOTE_TALLY_COMPLETED',
      userId: 'SYSTEM',
      resourceId: electionId,
      details: {
        totalVotes: votes.length,
        results: tally
      }
    });

    return tally;
  }

  // Legal Records Specific Methods
  async createLegalCase(legalData: Omit<LegalRecord, 'id' | 'issuedAt' | 'status' | 'type'>, courtClerk: string): Promise<LegalRecord> {
    const legalRecord: LegalRecord = {
      ...legalData,
      type: RecordType.LEGAL_RECORD,
      tags: ['legal', 'court', 'case']
    };

    const createdRecord = await this.createRecord(legalRecord);
    return createdRecord as LegalRecord;
  }

  async addLegalDocument(recordId: string, document: { type: string; description: string; fileHash: string }, uploader: string): Promise<LegalRecord> {
    const record = this.records.get(recordId) as LegalRecord;
    if (!record || record.type !== RecordType.LEGAL_RECORD) {
      throw new Error('Legal record not found');
    }

    // Validate permissions
    if (!this.permissionManager.hasPermission(uploader, 'LEGAL_DOCUMENT_ADD')) {
      throw new Error('Insufficient permissions to add legal documents');
    }

    record.data.documents.push({
      ...document,
      filedAt: new Date()
    });

    // Log to audit trail
    await this.auditTrail.logEvent({
      eventType: 'LEGAL_DOCUMENT_ADDED',
      userId: uploader,
      resourceId: recordId,
      details: {
        documentType: document.type,
        fileHash: document.fileHash
      }
    });

    // Emit event
    this.emit('legalDocumentAdded', record);

    return record;
  }

  // Verification System
  async requestVerification(recordId: string, requester: string, type: 'AUTHENTICITY' | 'OWNERSHIP' | 'STATUS'): Promise<VerificationRequest> {
    const requestId = this.generateRequestId();
    const verificationRequest: VerificationRequest = {
      id: requestId,
      recordId,
      requester,
      type,
      requestedAt: new Date(),
      status: 'PENDING'
    };

    this.verificationRequests.set(requestId, verificationRequest);

    // Log to audit trail
    await this.auditTrail.logEvent({
      eventType: 'VERIFICATION_REQUESTED',
      userId: requester,
      resourceId: requestId,
      details: {
        recordId,
        verificationType: type
      }
    });

    // Emit event
    this.emit('verificationRequested', verificationRequest);

    return verificationRequest;
  }

  async processVerification(requestId: string, approved: boolean, processor: string, notes?: string): Promise<VerificationRequest> {
    const request = this.verificationRequests.get(requestId);
    if (!request) {
      throw new Error('Verification request not found');
    }

    // Validate permissions
    if (!this.permissionManager.hasPermission(processor, 'VERIFICATION_PROCESS')) {
      throw new Error('Insufficient permissions to process verification requests');
    }

    request.status = approved ? 'APPROVED' : 'REJECTED';
    request.processedAt = new Date();
    request.processedBy = processor;
    request.notes = notes;

    // Log to audit trail
    await this.auditTrail.logEvent({
      eventType: 'VERIFICATION_PROCESSED',
      userId: processor,
      resourceId: requestId,
      details: {
        approved,
        notes
      }
    });

    // Emit event
    this.emit('verificationProcessed', request);

    return request;
  }

  // Query Methods
  getRecord(recordId: string): GovernmentRecord | undefined {
    return this.records.get(recordId);
  }

  getRecordsByType(type: RecordType): GovernmentRecord[] {
    return Array.from(this.records.values()).filter(record => record.type === type);
  }

  getRecordsByOwner(owner: string): GovernmentRecord[] {
    return Array.from(this.records.values()).filter(record => record.owner === owner);
  }

  getRecordsByStatus(status: RecordStatus): GovernmentRecord[] {
    return Array.from(this.records.values()).filter(record => record.status === status);
  }

  searchRecords(query: string, filters?: {
    type?: RecordType;
    status?: RecordStatus;
    owner?: string;
    tags?: string[];
  }): GovernmentRecord[] {
    let records = Array.from(this.records.values());

    // Apply filters
    if (filters) {
      if (filters.type) {
        records = records.filter(record => record.type === filters.type);
      }
      if (filters.status) {
        records = records.filter(record => record.status === filters.status);
      }
      if (filters.owner) {
        records = records.filter(record => record.owner === filters.owner);
      }
      if (filters.tags) {
        records = records.filter(record => 
          filters.tags!.some(tag => record.tags.includes(tag))
        );
      }
    }

    // Apply text search
    if (query) {
      const lowerQuery = query.toLowerCase();
      records = records.filter(record =>
        record.title.toLowerCase().includes(lowerQuery) ||
        record.description.toLowerCase().includes(lowerQuery) ||
        record.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      );
    }

    return records;
  }

  getVerificationRequest(requestId: string): VerificationRequest | undefined {
    return this.verificationRequests.get(requestId);
  }

  getVerificationRequests(requester?: string): VerificationRequest[] {
    const requests = Array.from(this.verificationRequests.values());
    return requester ? requests.filter(req => req.requester === requester) : requests;
  }

  // Analytics and Statistics
  getStatistics(): {
    totalRecords: number;
    recordsByType: { [type: string]: number };
    recordsByStatus: { [status: string]: number };
    pendingVerifications: number;
    recentActivity: GovernmentRecord[];
  } {
    const records = Array.from(this.records.values());
    const verificationRequests = Array.from(this.verificationRequests.values());

    return {
      totalRecords: records.length,
      recordsByType: records.reduce((acc, record) => {
        acc[record.type] = (acc[record.type] || 0) + 1;
        return acc;
      }, {} as { [type: string]: number }),
      recordsByStatus: records.reduce((acc, record) => {
        acc[record.status] = (acc[record.status] || 0) + 1;
        return acc;
      }, {} as { [status: string]: number }),
      pendingVerifications: verificationRequests.filter(req => req.status === 'PENDING').length,
      recentActivity: records
        .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
        .slice(0, 10)
    };
  }

  // Helper Methods
  private generateRecordId(): string {
    return `GOV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateRequestId(): string {
    return `VER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateRecordHash(record: GovernmentRecord): string {
    // Simple hash calculation - in production, use proper cryptographic hash
    return Buffer.from(JSON.stringify(record)).toString('base64');
  }

  private async verifyCertificateAuthenticity(certificate: AcademicCertificateRecord): Promise<boolean> {
    // In a real implementation, this would verify against institutional records
    // For now, we'll do basic validation
    return !!(
      certificate.data.studentName &&
      certificate.data.institution &&
      certificate.data.degree &&
      certificate.data.transcriptHash
    );
  }
}
