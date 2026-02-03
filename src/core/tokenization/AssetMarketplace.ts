import { EventEmitter } from 'events';
import { TokenizationEngine, DigitalAsset, AssetType, Wallet } from './TokenizationEngine';
import { AuditTrail } from '../audit/AuditTrail';

export enum OrderType {
    BUY = 'buy',
    SELL = 'sell'
}

export enum OrderStatus {
    PENDING = 'pending',
    FILLED = 'filled',
    PARTIALLY_FILLED = 'partially_filled',
    CANCELLED = 'cancelled',
    EXPIRED = 'expired'
}

export interface Order {
    id: string;
    type: OrderType;
    assetId: string;
    amount: number;
    price: number;
    total: number;
    maker: string; // wallet address
    taker?: string;
    status: OrderStatus;
    filledAmount: number;
    createdAt: number;
    expiresAt?: number;
    metadata?: any;
}

export interface Trade {
    id: string;
    orderId: string;
    assetId: string;
    amount: number;
    price: number;
    total: number;
    maker: string;
    taker: string;
    timestamp: number;
    fee: number;
}

export interface MarketStats {
    assetId: string;
    currentPrice: number;
    volume24h: number;
    priceChange24h: number;
    priceChangePercent24h: number;
    high24h: number;
    low24h: number;
    marketCap: number;
    totalSupply: number;
    circulatingSupply: number;
}

export class AssetMarketplace extends EventEmitter {
    private tokenizationEngine: TokenizationEngine;
    private auditTrail: AuditTrail;
    private orders: Map<string, Order>;
    private trades: Map<string, Trade>;
    private orderBook: Map<string, Map<number, Order[]>>; // assetId -> price -> orders

    constructor(tokenizationEngine: TokenizationEngine, auditTrail: AuditTrail) {
        super();
        this.tokenizationEngine = tokenizationEngine;
        this.auditTrail = auditTrail;
        this.orders = new Map();
        this.trades = new Map();
        this.orderBook = new Map();
    }

    // Order Management
    async createOrder(order: Omit<Order, 'id' | 'status' | 'filledAmount' | 'createdAt'>): Promise<string> {
        const orderId = this.generateOrderId();
        
        const newOrder: Order = {
            ...order,
            id: orderId,
            status: OrderStatus.PENDING,
            filledAmount: 0,
            createdAt: Date.now()
        };

        // Validate order
        const validation = await this.validateOrder(newOrder);
        if (!validation.valid) {
            throw new Error(`Order validation failed: ${validation.reason}`);
        }

        // Check if order can be matched immediately
        const matchResult = await this.tryMatchOrder(newOrder);
        
        if (matchResult.matched) {
            // Order was fully or partially matched
            this.orders.set(orderId, newOrder);
            
            await this.auditTrail.logSystemEvent('ORDER_MATCHED', {
                orderId,
                assetId: newOrder.assetId,
                amount: matchResult.filledAmount,
                price: matchResult.averagePrice
            });

            this.emit('orderMatched', {
                orderId,
                filledAmount: matchResult.filledAmount,
                trades: matchResult.trades
            });
        } else {
            // Add to order book
            this.addOrderToBook(newOrder);
            this.orders.set(orderId, newOrder);

            await this.auditTrail.logSystemEvent('ORDER_CREATED', {
                orderId,
                assetId: newOrder.assetId,
                type: newOrder.type,
                amount: newOrder.amount,
                price: newOrder.price
            });

            this.emit('orderCreated', newOrder);
        }

        return orderId;
    }

    async cancelOrder(orderId: string, canceller: string): Promise<boolean> {
        const order = this.orders.get(orderId);
        if (!order) {
            return false;
        }

        // Verify ownership
        if (order.maker !== canceller) {
            throw new Error('Only order creator can cancel order');
        }

        if (order.status !== OrderStatus.PENDING) {
            throw new Error('Order cannot be cancelled');
        }

        order.status = OrderStatus.CANCELLED;
        this.removeOrderFromBook(order);

        await this.auditTrail.logSystemEvent('ORDER_CANCELLED', {
            orderId,
            assetId: order.assetId,
            canceller
        });

        this.emit('orderCancelled', order);
        return true;
    }

    // Market Data
    async getOrderBook(assetId: string): Promise<{
        bids: { price: number; amount: number; total: number }[];
        asks: { price: number; amount: number; total: number }[];
    }> {
        const assetOrders = this.orderBook.get(assetId) || new Map();
        
        const bids: { price: number; amount: number; total: number }[] = [];
        const asks: { price: number; amount: number; total: number }[] = [];

        for (const [price, orders] of assetOrders.entries()) {
            const totalAmount = orders.reduce((sum, order) => sum + (order.amount - order.filledAmount), 0);
            
            if (orders[0].type === OrderType.BUY) {
                bids.push({ price, amount: totalAmount, total: price * totalAmount });
            } else {
                asks.push({ price, amount: totalAmount, total: price * totalAmount });
            }
        }

        // Sort bids (descending) and asks (ascending)
        bids.sort((a, b) => b.price - a.price);
        asks.sort((a, b) => a.price - b.price);

        return { bids, asks };
    }

    async getMarketStats(assetId: string): Promise<MarketStats | null> {
        const asset = await this.tokenizationEngine.getAsset(assetId);
        if (!asset) {
            return null;
        }

        const trades24h = this.getTradesLast24Hours(assetId);
        const volume24h = trades24h.reduce((sum, trade) => sum + trade.amount, 0);
        
        const prices = trades24h.map(trade => trade.price);
        const currentPrice = asset.price;
        const priceChange24h = prices.length > 0 ? currentPrice - prices[0] : 0;
        const priceChangePercent24h = prices.length > 0 ? (priceChange24h / prices[0]) * 100 : 0;
        const high24h = prices.length > 0 ? Math.max(...prices) : currentPrice;
        const low24h = prices.length > 0 ? Math.min(...prices) : currentPrice;

        return {
            assetId,
            currentPrice,
            volume24h,
            priceChange24h,
            priceChangePercent24h,
            high24h,
            low24h,
            marketCap: currentPrice * asset.circulatingSupply,
            totalSupply: asset.totalSupply,
            circulatingSupply: asset.circulatingSupply
        };
    }

    async getUserOrders(userAddress: string): Promise<Order[]> {
        return Array.from(this.orders.values()).filter(order => 
            order.maker === userAddress || order.taker === userAddress
        );
    }

    async getUserTrades(userAddress: string): Promise<Trade[]> {
        return Array.from(this.trades.values()).filter(trade => 
            trade.maker === userAddress || trade.taker === userAddress
        );
    }

    // Advanced Trading Features
    async createLimitOrder(params: {
        assetId: string;
        type: OrderType;
        amount: number;
        price: number;
        maker: string;
        expiresAt?: number;
    }): Promise<string> {
        return this.createOrder({
            type: params.type,
            assetId: params.assetId,
            amount: params.amount,
            price: params.price,
            total: params.amount * params.price,
            maker: params.maker,
            expiresAt: params.expiresAt
        });
    }

    async createMarketOrder(params: {
        assetId: string;
        type: OrderType;
        amount: number;
        maker: string;
    }): Promise<string> {
        const asset = await this.tokenizationEngine.getAsset(params.assetId);
        if (!asset) {
            throw new Error('Asset not found');
        }

        // For market orders, use current market price
        const marketStats = await this.getMarketStats(params.assetId);
        const price = marketStats?.currentPrice || asset.price;

        return this.createOrder({
            type: params.type,
            assetId: params.assetId,
            amount: params.amount,
            price,
            total: params.amount * price,
            maker: params.maker
        });
    }

    async executeTrade(order1: Order, order2: Order, amount: number): Promise<Trade> {
        const tradeId = this.generateTradeId();
        const price = order1.type === OrderType.BUY ? Math.min(order1.price, order2.price) : order2.price;
        const total = amount * price;
        const fee = total * 0.001; // 0.1% fee

        const trade: Trade = {
            id: tradeId,
            orderId: order1.id,
            assetId: order1.assetId,
            amount,
            price,
            total,
            maker: order1.maker,
            taker: order2.maker,
            timestamp: Date.now(),
            fee
        };

        // Update order statuses
        order1.filledAmount += amount;
        order2.filledAmount += amount;

        if (order1.filledAmount >= order1.amount) {
            order1.status = OrderStatus.FILLED;
        } else {
            order1.status = OrderStatus.PARTIALLY_FILLED;
        }

        if (order2.filledAmount >= order2.amount) {
            order2.status = OrderStatus.FILLED;
        } else {
            order2.status = OrderStatus.PARTIALLY_FILLED;
        }

        // Update wallet balances
        await this.updateWalletBalances(trade);

        // Store trade
        this.trades.set(tradeId, trade);

        await this.auditTrail.logSystemEvent('TRADE_EXECUTED', {
            tradeId,
            orderId: order1.id,
            assetId: trade.assetId,
            amount: trade.amount,
            price: trade.price,
            maker: trade.maker,
            taker: trade.taker
        });

        this.emit('tradeExecuted', trade);
        return trade;
    }

    // Analytics and Reporting
    async getMarketplaceStatistics(): Promise<{
        totalOrders: number;
        totalTrades: number;
        totalVolume24h: number;
        activeAssets: number;
        topAssets: Array<{ assetId: string; volume: number; trades: number }>;
    }> {
        const totalOrders = this.orders.size;
        const totalTrades = this.trades.size;
        
        const trades24h = this.getAllTradesLast24Hours();
        const totalVolume24h = trades24h.reduce((sum, trade) => sum + trade.total, 0);
        
        const activeAssets = new Set(trades24h.map(trade => trade.assetId)).size;
        
        const assetVolumes = new Map<string, { volume: number; trades: number }>();
        for (const trade of trades24h) {
            const current = assetVolumes.get(trade.assetId) || { volume: 0, trades: 0 };
            current.volume += trade.total;
            current.trades += 1;
            assetVolumes.set(trade.assetId, current);
        }

        const topAssets = Array.from(assetVolumes.entries())
            .map(([assetId, data]) => ({ assetId, ...data }))
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 10);

        return {
            totalOrders,
            totalTrades,
            totalVolume24h,
            activeAssets,
            topAssets
        };
    }

    // Private Helper Methods
    private async validateOrder(order: Order): Promise<{ valid: boolean; reason?: string }> {
        // Check if asset exists
        const asset = await this.tokenizationEngine.getAsset(order.assetId);
        if (!asset) {
            return { valid: false, reason: 'Asset not found' };
        }

        // Check if asset is approved for trading
        if (asset.status !== 'approved') {
            return { valid: false, reason: 'Asset not approved for trading' };
        }

        // Validate order parameters
        if (order.amount <= 0 || order.price <= 0) {
            return { valid: false, reason: 'Invalid amount or price' };
        }

        // Check user wallet and balance
        const wallet = await this.tokenizationEngine.getWalletByAddress(order.maker);
        if (!wallet) {
            return { valid: false, reason: 'Wallet not found' };
        }

        if (wallet.frozen) {
            return { valid: false, reason: 'Wallet is frozen' };
        }

        // For sell orders, check if user has sufficient balance
        if (order.type === OrderType.SELL) {
            const balance = wallet.balances.get(order.assetId) || 0;
            if (balance < order.amount) {
                return { valid: false, reason: 'Insufficient balance' };
            }
        }

        return { valid: true };
    }

    private async tryMatchOrder(order: Order): Promise<{
        matched: boolean;
        filledAmount: number;
        averagePrice: number;
        trades: Trade[];
    }> {
        const assetOrders = this.orderBook.get(order.assetId) || new Map();
        const trades: Trade[] = [];
        let filledAmount = 0;
        let totalValue = 0;

        if (order.type === OrderType.BUY) {
            // Match with sell orders (lowest price first)
            const sellPrices = Array.from(assetOrders.keys())
                .filter(price => assetOrders.get(price)![0].type === OrderType.SELL)
                .sort((a, b) => a - b);

            for (const price of sellPrices) {
                if (price <= order.price && filledAmount < order.amount) {
                    const sellOrders = assetOrders.get(price)!.filter(o => o.status === OrderStatus.PENDING);
                    
                    for (const sellOrder of sellOrders) {
                        if (filledAmount >= order.amount) break;

                        const tradeAmount = Math.min(
                            order.amount - filledAmount,
                            sellOrder.amount - sellOrder.filledAmount
                        );

                        const trade = await this.executeTrade(order, sellOrder, tradeAmount);
                        trades.push(trade);
                        
                        filledAmount += tradeAmount;
                        totalValue += tradeAmount * price;

                        // Remove fully filled orders from book
                        if (sellOrder.status === OrderStatus.FILLED) {
                            this.removeOrderFromBook(sellOrder);
                        }
                    }
                }
            }
        } else {
            // Match with buy orders (highest price first)
            const buyPrices = Array.from(assetOrders.keys())
                .filter(price => assetOrders.get(price)![0].type === OrderType.BUY)
                .sort((a, b) => b - a);

            for (const price of buyPrices) {
                if (price >= order.price && filledAmount < order.amount) {
                    const buyOrders = assetOrders.get(price)!.filter(o => o.status === OrderStatus.PENDING);
                    
                    for (const buyOrder of buyOrders) {
                        if (filledAmount >= order.amount) break;

                        const tradeAmount = Math.min(
                            order.amount - filledAmount,
                            buyOrder.amount - buyOrder.filledAmount
                        );

                        const trade = await this.executeTrade(buyOrder, order, tradeAmount);
                        trades.push(trade);
                        
                        filledAmount += tradeAmount;
                        totalValue += tradeAmount * price;

                        // Remove fully filled orders from book
                        if (buyOrder.status === OrderStatus.FILLED) {
                            this.removeOrderFromBook(buyOrder);
                        }
                    }
                }
            }
        }

        if (order.status === OrderStatus.FILLED) {
            this.removeOrderFromBook(order);
        }

        const averagePrice = filledAmount > 0 ? totalValue / filledAmount : order.price;

        return {
            matched: filledAmount > 0,
            filledAmount,
            averagePrice,
            trades
        };
    }

    private addOrderToBook(order: Order): void {
        if (!this.orderBook.has(order.assetId)) {
            this.orderBook.set(order.assetId, new Map());
        }

        const assetOrders = this.orderBook.get(order.assetId)!;
        if (!assetOrders.has(order.price)) {
            assetOrders.set(order.price, []);
        }

        assetOrders.get(order.price)!.push(order);
    }

    private removeOrderFromBook(order: Order): void {
        const assetOrders = this.orderBook.get(order.assetId);
        if (!assetOrders) return;

        const priceOrders = assetOrders.get(order.price);
        if (!priceOrders) return;

        const index = priceOrders.indexOf(order);
        if (index > -1) {
            priceOrders.splice(index, 1);
        }

        if (priceOrders.length === 0) {
            assetOrders.delete(order.price);
        }
    }

    private async updateWalletBalances(trade: Trade): Promise<void> {
        const makerWallet = await this.tokenizationEngine.getWalletByAddress(trade.maker);
        const takerWallet = await this.tokenizationEngine.getWalletByAddress(trade.taker);

        if (!makerWallet || !takerWallet) {
            throw new Error('Wallet not found');
        }

        if (trade.maker === trade.orderId) { // This is a buy order
            // Maker buys, taker sells
            await this.tokenizationEngine.updateWalletBalance(trade.maker, trade.assetId, trade.amount);
            await this.tokenizationEngine.updateWalletBalance(trade.taker, trade.assetId, -trade.amount);
        } else { // This is a sell order
            // Maker sells, taker buys
            await this.tokenizationEngine.updateWalletBalance(trade.maker, trade.assetId, -trade.amount);
            await this.tokenizationEngine.updateWalletBalance(trade.taker, trade.assetId, trade.amount);
        }
    }

    private getTradesLast24Hours(assetId: string): Trade[] {
        const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
        return Array.from(this.trades.values()).filter(trade => 
            trade.assetId === assetId && trade.timestamp >= twentyFourHoursAgo
        );
    }

    private getAllTradesLast24Hours(): Trade[] {
        const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
        return Array.from(this.trades.values()).filter(trade => 
            trade.timestamp >= twentyFourHoursAgo
        );
    }

    private generateOrderId(): string {
        return 'order_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    private generateTradeId(): string {
        return 'trade_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }
}
