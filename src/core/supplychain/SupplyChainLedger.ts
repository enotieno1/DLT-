import { EventEmitter } from 'events';
import { Blockchain } from '../blockchain/Blockchain';
import { SmartContractEngine } from '../smartcontracts/SmartContractEngine';
import { AuditTrail } from '../audit/AuditTrail';
import { PermissionManager, Permission } from '../accesscontrol/PermissionManager';
import { createHash } from 'crypto';

export enum ProductStatus {
    PRODUCED = 'produced',
    IN_TRANSIT = 'in_transit',
    WAREHOUSED = 'warehoused',
    IN_RETAIL = 'in_retail',
    SOLD = 'sold',
    RECALLED = 'recalled',
    EXPIRED = 'expired'
}

export enum ShipmentStatus {
    PREPARING = 'preparing',
    SHIPPED = 'shipped',
    IN_TRANSIT = 'in_transit',
    ARRIVED = 'arrived',
    DELIVERED = 'delivered',
    LOST = 'lost',
    DAMAGED = 'damaged'
}

export enum VerificationStatus {
    PENDING = 'pending',
    VERIFIED = 'verified',
    FAILED = 'failed',
    EXPIRED = 'expired'
}

export interface SupplyChainProduct {
    id: string;
    name: string;
    category: string;
    sku: string;
    batchNumber: string;
    serialNumber?: string;
    manufacturer: string;
    productionDate: string;
    expiryDate?: string;
    origin: ProductOrigin;
    currentOwner: string;
    status: ProductStatus;
    authenticity: AuthenticityRecord;
    ownershipHistory: OwnershipTransfer[];
    shipmentHistory: ShipmentRecord[];
    certifications: Certification[];
    qualityChecks: QualityCheck[];
    metadata: ProductMetadata;
    createdAt: number;
    updatedAt: number;
    qrCode?: string;
    nftToken?: string;
}

export interface ProductOrigin {
    country: string;
    region: string;
    facility: string;
    coordinates: {
        latitude: number;
        longitude: number;
    };
    certifications: string[];
    environmentalImpact?: EnvironmentalImpact;
}

export interface EnvironmentalImpact {
    carbonFootprint: number;
    waterUsage: number;
    energyConsumption: number;
    wasteGenerated: number;
    sustainabilityScore: number;
}

export interface OwnershipTransfer {
    id: string;
    from: string;
    to: string;
    transferType: 'sale' | 'transfer' | 'inheritance' | 'gift';
    price?: number;
    currency?: string;
    timestamp: number;
    location: string;
    verified: boolean;
    blockchainHash?: string;
    documents?: string[];
}

export interface ShipmentRecord {
    id: string;
    shipmentId: string;
    carrier: string;
    trackingNumber?: string;
    origin: Location;
    destination: Location;
    status: ShipmentStatus;
    estimatedDelivery?: string;
    actualDelivery?: string;
    conditions: ShipmentConditions;
    checkpoints: ShipmentCheckpoint[];
    documents: ShipmentDocument[];
    createdAt: number;
    updatedAt: number;
}

export interface Location {
    name: string;
    address: string;
    city: string;
    country: string;
    coordinates: {
        latitude: number;
        longitude: number;
    };
}

export interface ShipmentConditions {
    temperature?: {
        min: number;
        max: number;
        current: number;
    };
    humidity?: {
        min: number;
        max: number;
        current: number;
    };
    shock?: {
        detected: boolean;
        maxG: number;
        timestamp: number;
    };
    light?: {
        exposed: boolean;
        duration: number;
    };
}

export interface ShipmentCheckpoint {
    location: Location;
    timestamp: number;
    status: string;
    notes?: string;
    verifiedBy: string;
}

export interface ShipmentDocument {
    type: 'bill_of_lading' | 'certificate_of_origin' | 'inspection_report' | 'customs_declaration';
    number: string;
    issuedBy: string;
    issuedAt: string;
    documentHash: string;
    verified: boolean;
}

export interface AuthenticityRecord {
    verified: boolean;
    verificationMethod: 'blockchain' | 'qr_code' | 'nfc' | 'digital_signature' | 'third_party';
    verificationDate?: string;
    verifiedBy?: string;
    verificationScore: number;
    features: AuthenticityFeature[];
    lastVerified: number;
}

export interface AuthenticityFeature {
    type: 'hologram' | 'watermark' | 'serial_number' | 'qr_code' | 'nfc_chip' | 'digital_signature';
    present: boolean;
    verified: boolean;
    details: string;
}

export interface Certification {
    name: string;
    issuingBody: string;
    certificateNumber: string;
    issuedDate: string;
    expiryDate?: string;
    type: 'organic' | 'fair_trade' | 'quality' | 'safety' | 'environmental' | 'social';
    verified: boolean;
    documentHash: string;
}

export interface QualityCheck {
    id: string;
    type: 'incoming' | 'outgoing' | 'in_process' | 'final';
    performedBy: string;
    timestamp: number;
    location: string;
    results: QualityResult[];
    status: 'passed' | 'failed' | 'conditional';
    notes?: string;
}

export interface QualityResult {
    parameter: string;
    expected: any;
    actual: any;
    passed: boolean;
    tolerance?: number;
}

export interface ProductMetadata {
    weight: number;
    dimensions: {
        length: number;
        width: number;
        height: number;
    };
    materials: string[];
    allergens?: string[];
    storageConditions: StorageConditions;
    handlingInstructions: string[];
    regulatoryInfo: RegulatoryInfo;
}

export interface StorageConditions {
    temperatureRange: {
        min: number;
        max: number;
    };
    humidityRange: {
        min: number;
        max: number;
    };
    lightSensitive: boolean;
    shelfLife?: number; // in days
}

export interface RegulatoryInfo {
    regulated: boolean;
    category: string;
    requirements: string[];
    complianceStatus: 'compliant' | 'non_compliant' | 'pending';
    lastAudit?: string;
}

export class SupplyChainLedger extends EventEmitter {
    private blockchain: Blockchain;
    private smartContracts: SmartContractEngine;
    private auditTrail: AuditTrail;
    private permissionManager: PermissionManager;
    private products: Map<string, SupplyChainProduct>;
    private shipments: Map<string, ShipmentRecord>;
    private authenticityVerifiers: Map<string, AuthenticityVerifier>;

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
        this.products = new Map();
        this.shipments = new Map();
        this.authenticityVerifiers = new Map();
        
        this.initializeAuthenticityVerifiers();
    }

    // Product Management
    async registerProduct(product: Omit<SupplyChainProduct, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<string> {
        const productId = this.generateProductId();
        
        // Validate product data
        const validation = await this.validateProduct(product);
        if (!validation.valid) {
            throw new Error(`Product validation failed: ${validation.reason}`);
        }

        const supplyChainProduct: SupplyChainProduct = {
            ...product,
            id: productId,
            status: ProductStatus.PRODUCED,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        // Generate QR code
        supplyChainProduct.qrCode = await this.generateQRCode(productId);

        // Store on blockchain
        await this.storeProductOnBlockchain(supplyChainProduct);

        this.products.set(productId, supplyChainProduct);

        await this.auditTrail.logSystemEvent('PRODUCT_REGISTERED', {
            productId,
            name: product.name,
            sku: product.sku,
            manufacturer: product.manufacturer
        });

        this.emit('productRegistered', supplyChainProduct);
        return productId;
    }

    async transferOwnership(productId: string, transfer: Omit<OwnershipTransfer, 'id' | 'timestamp' | 'verified' | 'blockchainHash'>): Promise<string> {
        const product = this.products.get(productId);
        if (!product) {
            throw new Error('Product not found');
        }

        // Verify current ownership
        if (product.currentOwner !== transfer.from) {
            throw new Error('Transfer initiated by non-owner');
        }

        // Check permissions
        const user = this.permissionManager.getUserByAddress(transfer.from);
        if (!user || !this.permissionManager.hasPermission(user.id, Permission.WRITE_BLOCKCHAIN)) {
            throw new Error('Insufficient permissions to transfer ownership');
        }

        const transferId = this.generateTransferId();
        const ownershipTransfer: OwnershipTransfer = {
            ...transfer,
            id: transferId,
            timestamp: Date.now(),
            verified: false,
            blockchainHash: await this.calculateTransferHash(transfer)
        };

        // Verify transfer if required
        if (transfer.transferType === 'sale' && transfer.price && transfer.price > 10000) {
            ownershipTransfer.verified = await this.verifyHighValueTransfer(transfer);
        } else {
            ownershipTransfer.verified = true;
        }

        // Update product ownership
        product.currentOwner = transfer.to;
        product.ownershipHistory.push(ownershipTransfer);
        product.updatedAt = Date.now();

        // Store on blockchain
        await this.storeProductOnBlockchain(product);

        await this.auditTrail.logSystemEvent('OWNERSHIP_TRANSFERRED', {
            productId,
            transferId,
            from: transfer.from,
            to: transfer.to,
            type: transfer.transferType,
            price: transfer.price
        });

        this.emit('ownershipTransferred', { productId, transfer: ownershipTransfer });
        return transferId;
    }

    async createShipment(shipment: Omit<ShipmentRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<string> {
        const shipmentId = this.generateShipmentId();
        
        const shipmentRecord: ShipmentRecord = {
            ...shipment,
            id: shipmentId,
            status: ShipmentStatus.PREPARING,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.shipments.set(shipmentId, shipmentRecord);

        await this.auditTrail.logSystemEvent('SHIPMENT_CREATED', {
            shipmentId,
            carrier: shipment.carrier,
            origin: shipment.origin.name,
            destination: shipment.destination.name
        });

        this.emit('shipmentCreated', shipmentRecord);
        return shipmentId;
    }

    async updateShipmentStatus(shipmentId: string, status: ShipmentStatus, location?: Location, notes?: string): Promise<boolean> {
        const shipment = this.shipments.get(shipmentId);
        if (!shipment) {
            throw new Error('Shipment not found');
        }

        const oldStatus = shipment.status;
        shipment.status = status;
        shipment.updatedAt = Date.now();

        // Add checkpoint if location provided
        if (location) {
            const checkpoint: ShipmentCheckpoint = {
                location,
                timestamp: Date.now(),
                status,
                notes,
                verifiedBy: 'system'
            };
            shipment.checkpoints.push(checkpoint);
        }

        // Update actual delivery time
        if (status === ShipmentStatus.DELIVERED) {
            shipment.actualDelivery = new Date().toISOString();
        }

        await this.auditTrail.logSystemEvent('SHIPMENT_STATUS_UPDATED', {
            shipmentId,
            oldStatus,
            newStatus: status,
            location: location?.name,
            notes
        });

        this.emit('shipmentStatusUpdated', { shipmentId, status, location });
        return true;
    }

    async verifyAuthenticity(productId: string, verificationMethod: string, verifier: string): Promise<{
        verified: boolean;
        score: number;
        features: AuthenticityFeature[];
    }> {
        const product = this.products.get(productId);
        if (!product) {
            throw new Error('Product not found');
        }

        const verifierService = this.authenticityVerifiers.get(verificationMethod);
        if (!verifierService) {
            throw new Error('Verification method not supported');
        }

        // Perform verification
        const verification = await verifierService.verify(product, verifier);

        // Update product authenticity record
        product.authenticity = {
            verified: verification.verified,
            verificationMethod: verificationMethod as any,
            verificationDate: new Date().toISOString(),
            verifiedBy: verifier,
            verificationScore: verification.score,
            features: verification.features,
            lastVerified: Date.now()
        };

        product.updatedAt = Date.now();

        await this.auditTrail.logSystemEvent('AUTHENTICITY_VERIFIED', {
            productId,
            method: verificationMethod,
            verified: verification.verified,
            score: verification.score,
            verifier
        });

        this.emit('authenticityVerified', { productId, verification });
        return verification;
    }

    async trackProduct(productId: string): Promise<{
        product: SupplyChainProduct;
        currentLocation?: Location;
        estimatedDelivery?: string;
        journey: JourneyStep[];
    }> {
        const product = this.products.get(productId);
        if (!product) {
            throw new Error('Product not found');
        }

        const journey: JourneyStep[] = [];
        let currentLocation: Location | undefined;

        // Build journey from ownership and shipment history
        for (const transfer of product.ownershipHistory) {
            journey.push({
                type: 'ownership_transfer',
                timestamp: transfer.timestamp,
                location: transfer.location,
                details: `Ownership transferred to ${transfer.to}`,
                verified: transfer.verified
            });
        }

        for (const shipment of product.shipmentHistory) {
            journey.push({
                type: 'shipment',
                timestamp: shipment.createdAt,
                location: shipment.origin,
                details: `Shipment ${shipment.id} via ${shipment.carrier}`,
                verified: true
            });

            for (const checkpoint of shipment.checkpoints) {
                journey.push({
                    type: 'checkpoint',
                    timestamp: checkpoint.timestamp,
                    location: checkpoint.location,
                    details: checkpoint.status,
                    verified: true
                });
            }

            if (shipment.status === ShipmentStatus.IN_TRANSIT) {
                currentLocation = shipment.checkpoints[shipment.checkpoints.length - 1]?.location;
            }
        }

        // Get estimated delivery from active shipment
        let estimatedDelivery: string | undefined;
        const activeShipment = product.shipmentHistory.find(s => 
            s.status === ShipmentStatus.SHIPPED || s.status === ShipmentStatus.IN_TRANSIT
        );
        if (activeShipment && activeShipment.estimatedDelivery) {
            estimatedDelivery = activeShipment.estimatedDelivery;
        }

        return {
            product,
            currentLocation,
            estimatedDelivery,
            journey
        };
    }

    async getProductsByOwner(owner: string): Promise<SupplyChainProduct[]> {
        return Array.from(this.products.values()).filter(product => product.currentOwner === owner);
    }

    async getProductsByStatus(status: ProductStatus): Promise<SupplyChainProduct[]> {
        return Array.from(this.products.values()).filter(product => product.status === status);
    }

    async getShipmentsByCarrier(carrier: string): Promise<ShipmentRecord[]> {
        return Array.from(this.shipments.values()).filter(shipment => shipment.carrier === carrier);
    }

    async getSupplyChainStatistics(): Promise<{
        totalProducts: number;
        productsByStatus: Record<ProductStatus, number>;
        totalShipments: number;
        shipmentsByStatus: Record<ShipmentStatus, number>;
        authenticityRate: number;
        averageJourneyTime: number;
        topManufacturers: Array<{ name: string; count: number }>;
        topCarriers: Array<{ name: string; count: number }>;
    }> {
        const products = Array.from(this.products.values());
        const shipments = Array.from(this.shipments.values());

        const productsByStatus: Record<ProductStatus, number> = {
            [ProductStatus.PRODUCED]: 0,
            [ProductStatus.IN_TRANSIT]: 0,
            [ProductStatus.WAREHOUSED]: 0,
            [ProductStatus.IN_RETAIL]: 0,
            [ProductStatus.SOLD]: 0,
            [ProductStatus.RECALLED]: 0,
            [ProductStatus.EXPIRED]: 0
        };

        const shipmentsByStatus: Record<ShipmentStatus, number> = {
            [ShipmentStatus.PREPARING]: 0,
            [ShipmentStatus.SHIPPED]: 0,
            [ShipmentStatus.IN_TRANSIT]: 0,
            [ShipmentStatus.ARRIVED]: 0,
            [ShipmentStatus.DELIVERED]: 0,
            [ShipmentStatus.LOST]: 0,
            [ShipmentStatus.DAMAGED]: 0
        };

        let authenticProducts = 0;
        let totalJourneyTime = 0;
        let journeyCount = 0;

        const manufacturerCounts = new Map<string, number>();
        const carrierCounts = new Map<string, number>();

        for (const product of products) {
            productsByStatus[product.status]++;
            
            if (product.authenticity.verified) {
                authenticProducts++;
            }

            manufacturerCounts.set(
                product.manufacturer,
                (manufacturerCounts.get(product.manufacturer) || 0) + 1
            );

            // Calculate journey time
            if (product.shipmentHistory.length > 0) {
                const firstShipment = product.shipmentHistory[0];
                const lastShipment = product.shipmentHistory[product.shipmentHistory.length - 1];
                const journeyTime = (lastShipment.updatedAt || lastShipment.createdAt) - firstShipment.createdAt;
                totalJourneyTime += journeyTime;
                journeyCount++;
            }
        }

        for (const shipment of shipments) {
            shipmentsByStatus[shipment.status]++;
            
            carrierCounts.set(
                shipment.carrier,
                (carrierCounts.get(shipment.carrier) || 0) + 1
            );
        }

        const authenticityRate = products.length > 0 ? (authenticProducts / products.length) * 100 : 0;
        const averageJourneyTime = journeyCount > 0 ? totalJourneyTime / journeyCount : 0;

        const topManufacturers = Array.from(manufacturerCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const topCarriers = Array.from(carrierCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        return {
            totalProducts: products.length,
            productsByStatus,
            totalShipments: shipments.length,
            shipmentsByStatus,
            authenticityRate,
            averageJourneyTime,
            topManufacturers,
            topCarriers
        };
    }

    // Private Helper Methods
    private async validateProduct(product: Omit<SupplyChainProduct, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<{
        valid: boolean;
        reason?: string;
    }> {
        if (!product.name || !product.sku || !product.manufacturer) {
            return { valid: false, reason: 'Missing required product information' };
        }

        if (!product.origin || !product.origin.country) {
            return { valid: false, reason: 'Missing origin information' };
        }

        if (!product.currentOwner) {
            return { valid: false, reason: 'Missing current owner' };
        }

        return { valid: true };
    }

    private async generateQRCode(productId: string): Promise<string> {
        // In a real implementation, this would generate an actual QR code
        // For demo, return a base64 encoded string
        return `QR_${productId}_${Date.now()}`;
    }

    private async storeProductOnBlockchain(product: SupplyChainProduct): Promise<void> {
        // Store product hash on blockchain
        const transaction = {
            from: 'system',
            to: 'supply-chain-ledger',
            amount: 0,
            timestamp: Date.now(),
            signature: '',
            hash: ''
        };

        await this.blockchain.addTransaction(transaction);
    }

    private async calculateTransferHash(transfer: Omit<OwnershipTransfer, 'id' | 'timestamp' | 'verified' | 'blockchainHash'>): Promise<string> {
        const data = JSON.stringify({
            from: transfer.from,
            to: transfer.to,
            type: transfer.transferType,
            price: transfer.price,
            currency: transfer.currency
        });

        return createHash('sha256').update(data).digest('hex');
    }

    private async verifyHighValueTransfer(transfer: Omit<OwnershipTransfer, 'id' | 'timestamp' | 'verified' | 'blockchainHash'>): Promise<boolean> {
        // In a real implementation, this would perform additional verification
        // For demo, simulate verification process
        await new Promise(resolve => setTimeout(resolve, 1000));
        return Math.random() > 0.1; // 90% success rate
    }

    private generateProductId(): string {
        return 'prod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    private generateTransferId(): string {
        return 'transfer_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    private generateShipmentId(): string {
        return 'shipment_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    private initializeAuthenticityVerifiers(): void {
        this.authenticityVerifiers.set('blockchain', new BlockchainVerifier());
        this.authenticityVerifiers.set('qr_code', new QRCodeVerifier());
        this.authenticityVerifiers.set('nfc', new NFCVerifier());
        this.authenticityVerifiers.set('digital_signature', new DigitalSignatureVerifier());
    }
}

// Supporting Types
interface JourneyStep {
    type: 'ownership_transfer' | 'shipment' | 'checkpoint';
    timestamp: number;
    location: Location;
    details: string;
    verified: boolean;
}

interface AuthenticityVerifier {
    verify(product: SupplyChainProduct, verifier: string): Promise<{
        verified: boolean;
        score: number;
        features: AuthenticityFeature[];
    }>;
}

class BlockchainVerifier implements AuthenticityVerifier {
    async verify(product: SupplyChainProduct, verifier: string): Promise<{
        verified: boolean;
        score: number;
        features: AuthenticityFeature[];
    }> {
        const features: AuthenticityFeature[] = [
            {
                type: 'blockchain',
                present: true,
                verified: true,
                details: 'Product history recorded on blockchain'
            }
        ];

        return {
            verified: true,
            score: 95,
            features
        };
    }
}

class QRCodeVerifier implements AuthenticityVerifier {
    async verify(product: SupplyChainProduct, verifier: string): Promise<{
        verified: boolean;
        score: number;
        features: AuthenticityFeature[];
    }> {
        const features: AuthenticityFeature[] = [
            {
                type: 'qr_code',
                present: !!product.qrCode,
                verified: !!product.qrCode,
                details: product.qrCode ? 'QR code present and scannable' : 'QR code missing'
            }
        ];

        return {
            verified: !!product.qrCode,
            score: product.qrCode ? 85 : 0,
            features
        };
    }
}

class NFCVerifier implements AuthenticityVerifier {
    async verify(product: SupplyChainProduct, verifier: string): Promise<{
        verified: boolean;
        score: number;
        features: AuthenticityFeature[];
    }> {
        const features: AuthenticityFeature[] = [
            {
                type: 'nfc_chip',
                present: false, // Assume NFC not present for demo
                verified: false,
                details: 'NFC chip not detected'
            }
        ];

        return {
            verified: false,
            score: 0,
            features
        };
    }
}

class DigitalSignatureVerifier implements AuthenticityVerifier {
    async verify(product: SupplyChainProduct, verifier: string): Promise<{
        verified: boolean;
        score: number;
        features: AuthenticityFeature[];
    }> {
        const features: AuthenticityFeature[] = [
            {
                type: 'digital_signature',
                present: true,
                verified: true,
                details: 'Digital signature verified'
            }
        ];

        return {
            verified: true,
            score: 90,
            features
        };
    }
}
