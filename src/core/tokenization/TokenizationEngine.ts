import { EventEmitter } from 'events';
import { SmartContractEngine } from '../smartcontracts/SmartContractEngine';
import { AuditTrail } from '../audit/AuditTrail';
import { PermissionManager, Permission } from '../accesscontrol/PermissionManager';
import { createHash } from 'crypto';

export enum AssetType {
    REAL_ESTATE = 'real_estate',
    COMPANY_SHARES = 'company_shares',
    COMMODITIES = 'commodities',
    STABLECOIN = 'stablecoin',
    DIGITAL_CREDITS = 'digital_credits',
    NFT = 'nft'
}

export enum AssetStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected',
    SUSPENDED = 'suspended',
    RETIRED = 'retired'
}

export interface DigitalAsset {
    id: string;
    name: string;
    symbol: string;
    type: AssetType;
    totalSupply: number;
    circulatingSupply: number;
    price: number;
    description: string;
    issuer: string;
    contractAddress: string;
    status: AssetStatus;
    metadata: AssetMetadata;
    compliance: ComplianceInfo;
    createdAt: number;
    updatedAt: number;
}

export interface AssetMetadata {
    // Real Estate
    propertyAddress?: string;
    propertyType?: string;
    squareFootage?: number;
    valuationDate?: number;
    appraisalReport?: string;
    
    // Company Shares
    companyName?: string;
    isin?: string;
    totalShares?: number;
    shareClass?: string;
    
    // Commodities
    commodityType?: string;
    quantity?: number;
    unit?: string;
    storageLocation?: string;
    quality?: string;
    
    // Stablecoin
    backingAsset?: string;
    reserveRatio?: number;
    auditor?: string;
    
    // Common
    documents?: string[];
    legalDocuments?: string[];
    valuationMethod?: string;
    lastValuation?: number;
}

export interface ComplianceInfo {
    kycRequired: boolean;
    amlRequired: boolean;
    accreditedInvestorOnly: boolean;
    jurisdictionRestrictions: string[];
    maxHoldingPerUser?: number;
    transferRestrictions: string[];
    complianceScore: number;
    lastAuditDate?: number;
}

export interface TokenizationRequest {
    assetType: AssetType;
    name: string;
    symbol: string;
    totalSupply: number;
    price: number;
    description: string;
    metadata: AssetMetadata;
    compliance: ComplianceInfo;
    requester: string;
    documents?: File[];
}

export interface Wallet {
    address: string;
    userId: string;
    balances: Map<string, number>;
    frozen: boolean;
    kycStatus: 'pending' | 'verified' | 'rejected';
    amlStatus: 'pending' | 'cleared' | 'flagged';
    createdAt: number;
    lastActivity: number;
}

export class TokenizationEngine extends EventEmitter {
    private smartContracts: SmartContractEngine;
    private auditTrail: AuditTrail;
    private permissionManager: PermissionManager;
    private assets: Map<string, DigitalAsset>;
    private wallets: Map<string, Wallet>;
    private pendingRequests: Map<string, TokenizationRequest>;

    constructor(
        smartContracts: SmartContractEngine,
        auditTrail: AuditTrail,
        permissionManager: PermissionManager
    ) {
        super();
        this.smartContracts = smartContracts;
        this.auditTrail = auditTrail;
        this.permissionManager = permissionManager;
        this.assets = new Map();
        this.wallets = new Map();
        this.pendingRequests = new Map();
    }

    // Asset Tokenization Methods
    async tokenizeAsset(request: TokenizationRequest): Promise<string> {
        const requestId = this.generateRequestId();
        this.pendingRequests.set(requestId, request);

        // Log tokenization request
        await this.auditTrail.logSystemEvent('ASSET_TOKENIZATION_REQUESTED', {
            requestId,
            assetType: request.assetType,
            name: request.name,
            requester: request.requester
        });

        // Validate request
        const validation = await this.validateTokenizationRequest(request);
        if (!validation.valid) {
            await this.auditTrail.logSystemEvent('ASSET_TOKENIZATION_REJECTED', {
                requestId,
                reason: validation.reason
            });
            throw new Error(`Tokenization request rejected: ${validation.reason}`);
        }

        // Deploy smart contract
        const contractAddress = await this.deployAssetContract(request);
        
        // Create digital asset record
        const asset: DigitalAsset = {
            id: this.generateAssetId(),
            name: request.name,
            symbol: request.symbol,
            type: request.assetType,
            totalSupply: request.totalSupply,
            circulatingSupply: 0,
            price: request.price,
            description: request.description,
            issuer: request.requester,
            contractAddress,
            status: AssetStatus.APPROVED,
            metadata: request.metadata,
            compliance: request.compliance,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.assets.set(asset.id, asset);
        this.pendingRequests.delete(requestId);

        // Mint initial supply to issuer
        await this.mintTokens(contractAddress, request.requester, request.totalSupply);

        await this.auditTrail.logSystemEvent('ASSET_TOKENIZED', {
            assetId: asset.id,
            contractAddress,
            totalSupply: request.totalSupply,
            issuer: request.requester
        });

        this.emit('assetTokenized', asset);
        return asset.id;
    }

    async tokenizeRealEstate(request: {
        name: string;
        propertyAddress: string;
        propertyType: string;
        squareFootage: number;
        totalValue: number;
        tokenPrice: number;
        requester: string;
        appraisalReport?: string;
    }): Promise<string> {
        const metadata: AssetMetadata = {
            propertyAddress: request.propertyAddress,
            propertyType: request.propertyType,
            squareFootage: request.squareFootage,
            valuationDate: Date.now(),
            appraisalReport: request.appraisalReport,
            valuationMethod: 'professional_appraisal',
            lastValuation: request.totalValue
        };

        const compliance: ComplianceInfo = {
            kycRequired: true,
            amlRequired: true,
            accreditedInvestorOnly: true,
            jurisdictionRestrictions: ['US', 'EU', 'UK'],
            transferRestrictions: ['accredited_investors_only', 'holding_period_1_year'],
            complianceScore: 85
        };

        const totalSupply = Math.floor(request.totalValue / request.tokenPrice);

        const tokenizationRequest: TokenizationRequest = {
            assetType: AssetType.REAL_ESTATE,
            name: request.name,
            symbol: this.generateSymbol(request.name),
            totalSupply,
            price: request.tokenPrice,
            description: `Tokenized ownership of ${request.propertyAddress}`,
            metadata,
            compliance,
            requester: request.requester
        };

        return this.tokenizeAsset(tokenizationRequest);
    }

    async tokenizeCompanyShares(request: {
        companyName: string;
        isin: string;
        totalShares: number;
        sharePrice: number;
        shareClass: string;
        requester: string;
    }): Promise<string> {
        const metadata: AssetMetadata = {
            companyName: request.companyName,
            isin: request.isin,
            totalShares: request.totalShares,
            shareClass: request.shareClass,
            valuationMethod: 'market_cap',
            lastValuation: request.totalShares * request.sharePrice
        };

        const compliance: ComplianceInfo = {
            kycRequired: true,
            amlRequired: true,
            accreditedInvestorOnly: false,
            jurisdictionRestrictions: ['US', 'EU', 'UK', 'JP'],
            maxHoldingPerUser: Math.floor(request.totalShares * 0.05), // 5% max per user
            transferRestrictions: ['sec_compliance', 'shareholder_approval'],
            complianceScore: 90
        };

        const tokenizationRequest: TokenizationRequest = {
            assetType: AssetType.COMPANY_SHARES,
            name: `${request.companyName} Shares`,
            symbol: this.generateSymbol(request.companyName) + '_SHARES',
            totalSupply: request.totalShares,
            price: request.sharePrice,
            description: `Digital shares of ${request.companyName} (${request.shareClass})`,
            metadata,
            compliance,
            requester: request.requester
        };

        return this.tokenizeAsset(tokenizationRequest);
    }

    async tokenizeCommodities(request: {
        commodityType: string;
        quantity: number;
        unit: string;
        totalValue: number;
        tokenPrice: number;
        storageLocation: string;
        quality: string;
        requester: string;
    }): Promise<string> {
        const metadata: AssetMetadata = {
            commodityType: request.commodityType,
            quantity: request.quantity,
            unit: request.unit,
            storageLocation: request.storageLocation,
            quality: request.quality,
            valuationMethod: 'spot_price',
            lastValuation: request.totalValue
        };

        const compliance: ComplianceInfo = {
            kycRequired: true,
            amlRequired: true,
            accreditedInvestorOnly: false,
            jurisdictionRestrictions: [], // Global commodity
            transferRestrictions: ['physical_verification'],
            complianceScore: 75
        };

        const totalSupply = Math.floor(request.totalValue / request.tokenPrice);

        const tokenizationRequest: TokenizationRequest = {
            assetType: AssetType.COMMODITIES,
            name: `${request.commodityType} Tokens`,
            symbol: this.generateSymbol(request.commodityType) + '_COMMODITY',
            totalSupply,
            price: request.tokenPrice,
            description: `Tokenized ${request.commodityType} stored at ${request.storageLocation}`,
            metadata,
            compliance,
            requester: request.requester
        };

        return this.tokenizeAsset(tokenizationRequest);
    }

    async issueStablecoin(request: {
        name: string;
        symbol: string;
        backingAsset: string;
        totalSupply: number;
        auditor: string;
        reserveRatio: number;
        requester: string;
    }): Promise<string> {
        const metadata: AssetMetadata = {
            backingAsset: request.backingAsset,
            reserveRatio: request.reserveRatio,
            auditor: request.auditor,
            valuationMethod: 'backing_ratio',
            lastValuation: request.totalSupply
        };

        const compliance: ComplianceInfo = {
            kycRequired: true,
            amlRequired: true,
            accreditedInvestorOnly: false,
            jurisdictionRestrictions: [], // Global stablecoin
            transferRestrictions: ['reserve_verification'],
            complianceScore: 95
        };

        const tokenizationRequest: TokenizationRequest = {
            assetType: AssetType.STABLECOIN,
            name: request.name,
            symbol: request.symbol,
            totalSupply: request.totalSupply,
            price: 1.0, // Stablecoins are typically $1
            description: `${request.name} stablecoin backed by ${request.backingAsset}`,
            metadata,
            compliance,
            requester: request.requester
        };

        return this.tokenizeAsset(tokenizationRequest);
    }

    async issueDigitalCredits(request: {
        name: string;
        symbol: string;
        programType: string;
        totalSupply: number;
        expirationDate?: number;
        usageRestrictions?: string[];
        requester: string;
    }): Promise<string> {
        const metadata: AssetMetadata = {
            valuationMethod: 'program_value',
            lastValuation: request.totalSupply,
            documents: request.usageRestrictions
        };

        const compliance: ComplianceInfo = {
            kycRequired: false,
            amlRequired: false,
            accreditedInvestorOnly: false,
            jurisdictionRestrictions: [], // Program-specific
            transferRestrictions: request.usageRestrictions || [],
            complianceScore: 80
        };

        const tokenizationRequest: TokenizationRequest = {
            assetType: AssetType.DIGITAL_CREDITS,
            name: request.name,
            symbol: request.symbol,
            totalSupply: request.totalSupply,
            price: 1.0,
            description: `${request.name} digital credits for ${request.programType}`,
            metadata,
            compliance,
            requester: request.requester
        };

        return this.tokenizeAsset(tokenizationRequest);
    }

    // Wallet System
    async createWallet(userId: string): Promise<Wallet> {
        const address = this.generateWalletAddress();
        
        const wallet: Wallet = {
            address,
            userId,
            balances: new Map(),
            frozen: false,
            kycStatus: 'pending',
            amlStatus: 'pending',
            createdAt: Date.now(),
            lastActivity: Date.now()
        };

        this.wallets.set(address, wallet);

        await this.auditTrail.logSystemEvent('WALLET_CREATED', {
            address,
            userId
        });

        this.emit('walletCreated', wallet);
        return wallet;
    }

    async getWallet(userId: string): Promise<Wallet | null> {
        for (const wallet of this.wallets.values()) {
            if (wallet.userId === userId) {
                return wallet;
            }
        }
        return null;
    }

    async getWalletByAddress(address: string): Promise<Wallet | null> {
        return this.wallets.get(address) || null;
    }

    async updateWalletBalance(
        walletAddress: string,
        assetId: string,
        amount: number
    ): Promise<boolean> {
        const wallet = this.wallets.get(walletAddress);
        if (!wallet || wallet.frozen) {
            return false;
        }

        const currentBalance = wallet.balances.get(assetId) || 0;
        const newBalance = currentBalance + amount;

        if (newBalance < 0) {
            return false; // Insufficient balance
        }

        wallet.balances.set(assetId, newBalance);
        wallet.lastActivity = Date.now();

        await this.auditTrail.logSystemEvent('WALLET_BALANCE_UPDATED', {
            walletAddress,
            assetId,
            amount,
            newBalance
        });

        this.emit('balanceUpdated', { walletAddress, assetId, newBalance });
        return true;
    }

    async freezeWallet(walletAddress: string, reason: string): Promise<boolean> {
        const wallet = this.wallets.get(walletAddress);
        if (!wallet) {
            return false;
        }

        wallet.frozen = true;

        await this.auditTrail.logSystemEvent('WALLET_FROZEN', {
            walletAddress,
            reason
        });

        this.emit('walletFrozen', { walletAddress, reason });
        return true;
    }

    async unfreezeWallet(walletAddress: string): Promise<boolean> {
        const wallet = this.wallets.get(walletAddress);
        if (!wallet) {
            return false;
        }

        wallet.frozen = false;

        await this.auditTrail.logSystemEvent('WALLET_UNFROZEN', {
            walletAddress
        });

        this.emit('walletUnfrozen', walletAddress);
        return true;
    }

    // Asset Management
    async getAsset(assetId: string): Promise<DigitalAsset | null> {
        return this.assets.get(assetId) || null;
    }

    async getAssetsByType(type: AssetType): Promise<DigitalAsset[]> {
        return Array.from(this.assets.values()).filter(asset => asset.type === type);
    }

    async getAssetsByIssuer(issuer: string): Promise<DigitalAsset[]> {
        return Array.from(this.assets.values()).filter(asset => asset.issuer === issuer);
    }

    async updateAssetPrice(assetId: string, newPrice: number): Promise<boolean> {
        const asset = this.assets.get(assetId);
        if (!asset) {
            return false;
        }

        const oldPrice = asset.price;
        asset.price = newPrice;
        asset.updatedAt = Date.now();

        await this.auditTrail.logSystemEvent('ASSET_PRICE_UPDATED', {
            assetId,
            oldPrice,
            newPrice
        });

        this.emit('priceUpdated', { assetId, oldPrice, newPrice });
        return true;
    }

    async retireAsset(assetId: string, reason: string): Promise<boolean> {
        const asset = this.assets.get(assetId);
        if (!asset) {
            return false;
        }

        asset.status = AssetStatus.RETIRED;
        asset.updatedAt = Date.now();

        await this.auditTrail.logSystemEvent('ASSET_RETIRED', {
            assetId,
            reason
        });

        this.emit('assetRetired', { assetId, reason });
        return true;
    }

    // Compliance Tools
    async validateTokenizationRequest(request: TokenizationRequest): Promise<{
        valid: boolean;
        reason?: string;
    }> {
        // Check user permissions
        const user = this.permissionManager.getUserByAddress(request.requester);
        if (!user) {
            return { valid: false, reason: 'User not found' };
        }

        const hasPermission = this.permissionManager.hasPermission(user.id, Permission.DEPLOY_CONTRACTS);
        if (!hasPermission) {
            return { valid: false, reason: 'Insufficient permissions' };
        }

        // Validate basic requirements
        if (!request.name || !request.symbol || request.totalSupply <= 0 || request.price <= 0) {
            return { valid: false, reason: 'Invalid basic parameters' };
        }

        // Asset-specific validation
        switch (request.assetType) {
            case AssetType.REAL_ESTATE:
                if (!request.metadata.propertyAddress || !request.metadata.squareFootage) {
                    return { valid: false, reason: 'Missing real estate metadata' };
                }
                break;

            case AssetType.COMPANY_SHARES:
                if (!request.metadata.companyName || !request.metadata.isin) {
                    return { valid: false, reason: 'Missing company shares metadata' };
                }
                break;

            case AssetType.COMMODITIES:
                if (!request.metadata.commodityType || !request.metadata.quantity) {
                    return { valid: false, reason: 'Missing commodities metadata' };
                }
                break;

            case AssetType.STABLECOIN:
                if (!request.metadata.backingAsset || !request.metadata.reserveRatio) {
                    return { valid: false, reason: 'Missing stablecoin backing information' };
                }
                break;
        }

        return { valid: true };
    }

    async getComplianceReport(assetId: string): Promise<any> {
        const asset = this.assets.get(assetId);
        if (!asset) {
            throw new Error('Asset not found');
        }

        const totalHolders = this.getTotalHolders(assetId);
        const complianceScore = this.calculateComplianceScore(asset);

        return {
            assetId,
            assetName: asset.name,
            complianceScore,
            totalHolders,
            kycRequired: asset.compliance.kycRequired,
            amlRequired: asset.compliance.amlRequired,
            accreditedInvestorOnly: asset.compliance.accreditedInvestorOnly,
            jurisdictionRestrictions: asset.compliance.jurisdictionRestrictions,
            lastAuditDate: asset.compliance.lastAuditDate,
            recommendations: this.getComplianceRecommendations(asset, complianceScore)
        };
    }

    // Private Helper Methods
    private async deployAssetContract(request: TokenizationRequest): Promise<string> {
        // Deploy ERC20-like contract for the asset
        return await this.smartContracts.deployERC20Token(
            request.name,
            request.symbol,
            request.totalSupply,
            request.requester
        );
    }

    private async mintTokens(contractAddress: string, to: string, amount: number): Promise<void> {
        // Mint tokens to the specified address
        await this.smartContracts.callContract({
            contractAddress,
            functionName: 'mint',
            args: [to, amount],
            from: 'system'
        });
    }

    private getTotalHolders(assetId: string): number {
        let holders = 0;
        for (const wallet of this.wallets.values()) {
            if (wallet.balances.get(assetId) && wallet.balances.get(assetId)! > 0) {
                holders++;
            }
        }
        return holders;
    }

    private calculateComplianceScore(asset: DigitalAsset): number {
        let score = asset.compliance.complianceScore;

        // Adjust based on holder distribution
        const holders = this.getTotalHolders(asset.id);
        if (holders > 1000) score += 5;
        if (holders > 10000) score += 10;

        // Adjust based on asset age
        const ageInDays = (Date.now() - asset.createdAt) / (1000 * 60 * 60 * 24);
        if (ageInDays > 365) score += 5;
        if (ageInDays > 1095) score += 10;

        return Math.min(100, score);
    }

    private getComplianceRecommendations(asset: DigitalAsset, score: number): string[] {
        const recommendations: string[] = [];

        if (score < 70) {
            recommendations.push('Consider additional KYC verification');
            recommendations.push('Implement stricter AML monitoring');
        }

        if (asset.compliance.jurisdictionRestrictions.length === 0) {
            recommendations.push('Consider adding jurisdiction restrictions');
        }

        if (!asset.compliance.lastAuditDate || Date.now() - asset.compliance.lastAuditDate > 365 * 24 * 60 * 60 * 1000) {
            recommendations.push('Schedule annual compliance audit');
        }

        return recommendations;
    }

    private generateRequestId(): string {
        return 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    private generateAssetId(): string {
        return 'asset_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    private generateWalletAddress(): string {
        return '0x' + createHash('sha256').update(Date.now() + Math.random().toString()).digest('hex').substring(0, 40);
    }

    private generateSymbol(name: string): string {
        return name.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 6);
    }

    // Statistics and Reporting
    async getTokenizationStatistics(): Promise<{
        totalAssets: number;
        assetsByType: Record<AssetType, number>;
        totalValueLocked: number;
        totalWallets: number;
        activeWallets: number;
        pendingRequests: number;
    }> {
        const assetsByType = {
            [AssetType.REAL_ESTATE]: 0,
            [AssetType.COMPANY_SHARES]: 0,
            [AssetType.COMMODITIES]: 0,
            [AssetType.STABLECOIN]: 0,
            [AssetType.DIGITAL_CREDITS]: 0,
            [AssetType.NFT]: 0
        };

        let totalValueLocked = 0;

        for (const asset of this.assets.values()) {
            assetsByType[asset.type]++;
            totalValueLocked += asset.circulatingSupply * asset.price;
        }

        const activeWallets = Array.from(this.wallets.values()).filter(w => 
            w.lastActivity > Date.now() - 30 * 24 * 60 * 60 * 1000 // Active in last 30 days
        ).length;

        return {
            totalAssets: this.assets.size,
            assetsByType,
            totalValueLocked,
            totalWallets: this.wallets.size,
            activeWallets,
            pendingRequests: this.pendingRequests.size
        };
    }
}
