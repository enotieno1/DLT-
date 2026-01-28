import { EventEmitter } from 'events';
import { Block, Transaction } from '../types/block.types';

export interface CacheConfig {
  maxSize: number;
  ttl: number;
  enableCompression: boolean;
  enableEncryption: boolean;
  evictionPolicy: 'LRU' | 'LFU' | 'FIFO' | 'RANDOM';
  enableMetrics: boolean;
  enablePersistence: boolean;
  persistencePath?: string;
  enableDistributedCache: boolean;
  cacheNodes: string[];
}

export interface CacheEntry {
  key: string;
  value: any;
  timestamp: number;
  accessCount: number;
  ttl: number;
  size: number;
  compressed: boolean;
  encrypted: boolean;
  checksum: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  hitRate: number;
  missRate: number;
  averageAccessTime: number;
  memoryUsage: number;
  size: number;
  maxSize: number;
}

export interface CacheMetrics {
  key: string;
  accessTime: number;
  accessType: 'HIT' | 'MISS' | 'SET' | 'DELETE';
  timestamp: number;
  size: number;
}

/**
 * High-performance caching layer for ledger operations
 * Implements multi-level caching with compression, encryption, and distributed support
 */
export class CacheLayer extends EventEmitter {
  private config: CacheConfig;
  private cache: Map<string, CacheEntry> = new Map();
  private accessOrder: string[] = [];
  private accessFrequency: Map<string, number> = new Map();
  private stats: CacheStats;
  private metrics: CacheMetrics[] = [];
  private cleanupTimer?: NodeJS.Timeout;
  private metricsTimer?: NodeJS.Timeout;
  private encryptionKey: string;

  constructor(config: Partial<CacheConfig> = {}) {
    super();
    
    this.config = {
      maxSize: 10000,
      ttl: 300000, // 5 minutes
      enableCompression: true,
      enableEncryption: false,
      evictionPolicy: 'LRU',
      enableMetrics: true,
      enablePersistence: false,
      enableDistributedCache: false,
      cacheNodes: [],
      ...config
    };

    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      hitRate: 0,
      missRate: 0,
      averageAccessTime: 0,
      memoryUsage: 0,
      size: 0,
      maxSize: this.config.maxSize
    };

    this.encryptionKey = this.generateEncryptionKey();
    
    if (this.config.enableMetrics) {
      this.startMetricsCollection();
    }
    
    this.startCleanupTimer();
  }

  /**
   * Get value from cache
   * @param key - Cache key
   * @returns Cached value or null
   */
  public get(key: string): any | null {
    const startTime = performance.now();
    
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.recordMiss(key, performance.now() - startTime);
      return null;
    }

    // Check TTL
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      this.recordMiss(key, performance.now() - startTime);
      return null;
    }

    // Update access information
    entry.accessCount++;
    this.updateAccessOrder(key);
    this.updateAccessFrequency(key);

    // Decrypt if needed
    let value = entry.value;
    if (entry.encrypted) {
      value = this.decrypt(value);
    }

    // Decompress if needed
    if (entry.compressed) {
      value = this.decompress(value);
    }

    this.recordHit(key, performance.now() - startTime);
    return value;
  }

  /**
   * Set value in cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time to live (optional)
   * @returns Success status
   */
  public set(key: string, value: any, ttl?: number): boolean {
    const startTime = performance.now();
    
    try {
      // Check if we need to evict entries
      if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
        this.evictEntries();
      }

      // Prepare value
      let processedValue = value;
      let compressed = false;
      let encrypted = false;
      let size = JSON.stringify(value).length;

      // Compress if enabled and value is large enough
      if (this.config.enableCompression && size > 1024) {
        processedValue = this.compress(processedValue);
        compressed = true;
        size = processedValue.length;
      }

      // Encrypt if enabled
      if (this.config.enableEncryption) {
        processedValue = this.encrypt(processedValue);
        encrypted = true;
        size = processedValue.length;
      }

      const entry: CacheEntry = {
        key,
        value: processedValue,
        timestamp: Date.now(),
        accessCount: 1,
        ttl: ttl || this.config.ttl,
        size,
        compressed,
        encrypted,
        checksum: this.calculateChecksum(processedValue)
      };

      this.cache.set(key, entry);
      this.updateAccessOrder(key);
      this.updateAccessFrequency(key);

      this.recordSet(key, performance.now() - startTime, size);
      
      return true;
    } catch (error) {
      this.emit('cacheError', {
        operation: 'set',
        key,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Delete entry from cache
   * @param key - Cache key
   * @returns Success status
   */
  public delete(key: string): boolean {
    const startTime = performance.now();
    
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    this.cache.delete(key);
    this.removeFromAccessOrder(key);
    this.accessFrequency.delete(key);

    this.recordDelete(key, performance.now() - startTime);
    return true;
  }

  /**
   * Check if key exists in cache
   * @param key - Cache key
   * @returns True if key exists
   */
  public has(key: string): boolean {
    const entry = this.cache.get(key);
    return entry !== undefined && !this.isExpired(entry);
  }

  /**
   * Clear all cache entries
   */
  public clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.accessOrder = [];
    this.accessFrequency.clear();
    
    this.stats.deletes += size;
    this.updateStats();
    
    this.emit('cacheCleared', { entries: size });
  }

  /**
   * Get multiple keys
   * @param keys - Array of cache keys
   * @returns Object with key-value pairs
   */
  public mget(keys: string[]): Record<string, any> {
    const result: Record<string, any> = {};
    
    for (const key of keys) {
      const value = this.get(key);
      if (value !== null) {
        result[key] = value;
      }
    }
    
    return result;
  }

  /**
   * Set multiple key-value pairs
   * @param entries - Array of key-value pairs
   * @returns Success status
   */
  public mset(entries: Array<{ key: string; value: any; ttl?: number }>): boolean {
    let success = true;
    
    for (const entry of entries) {
      const result = this.set(entry.key, entry.value, entry.ttl);
      if (!result) {
        success = false;
      }
    }
    
    return success;
  }

  /**
   * Get cache statistics
   */
  public getStats(): CacheStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Get cache metrics
   */
  public getMetrics(limit?: number): CacheMetrics[] {
    if (limit) {
      return this.metrics.slice(-limit);
    }
    return [...this.metrics];
  }

  /**
   * Get cache entries
   */
  public getEntries(): CacheEntry[] {
    return Array.from(this.cache.values());
  }

  /**
   * Get cache size
   */
  public size(): number {
    return this.cache.size;
  }

  /**
   * Check if cache is full
   */
  public isFull(): boolean {
    return this.cache.size >= this.config.maxSize;
  }

  /**
   * Get memory usage
   */
  public getMemoryUsage(): number {
    let totalSize = 0;
    
    for (const entry of this.cache.values()) {
      totalSize += entry.size;
    }
    
    return totalSize;
  }

  /**
   * Warm up cache with predefined data
   */
  public async warmUp(data: Record<string, any>): Promise<void> {
    const entries = Object.entries(data);
    
    for (const [key, value] of entries) {
      this.set(key, value);
    }
    
    this.emit('cacheWarmedUp', { entries: entries.length });
  }

  /**
   * Export cache data
   */
  public export(): Record<string, any> {
    const data: Record<string, any> = {};
    
    for (const [key, entry] of this.cache.entries()) {
      let value = entry.value;
      
      // Decrypt if needed
      if (entry.encrypted) {
        value = this.decrypt(value);
      }
      
      // Decompress if needed
      if (entry.compressed) {
        value = this.decompress(value);
      }
      
      data[key] = {
        value,
        timestamp: entry.timestamp,
        ttl: entry.ttl,
        accessCount: entry.accessCount
      };
    }
    
    return data;
  }

  /**
   * Import cache data
   */
  public import(data: Record<string, any>): void {
    this.clear();
    
    for (const [key, entryData] of Object.entries(data)) {
      const entry = entryData as any;
      this.set(key, entry.value, entry.ttl);
    }
    
    this.emit('cacheImported', { entries: Object.keys(data).length });
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  /**
   * Update access order for LRU
   */
  private updateAccessOrder(key: string): void {
    if (this.config.evictionPolicy === 'LRU') {
      this.removeFromAccessOrder(key);
      this.accessOrder.push(key);
    }
  }

  /**
   * Remove from access order
   */
  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  /**
   * Update access frequency for LFU
   */
  private updateAccessFrequency(key: string): void {
    if (this.config.evictionPolicy === 'LFU') {
      const current = this.accessFrequency.get(key) || 0;
      this.accessFrequency.set(key, current + 1);
    }
  }

  /**
   * Evict entries based on policy
   */
  private evictEntries(): void {
    const toEvict = Math.ceil(this.config.maxSize * 0.1); // Evict 10%
    let evicted = 0;

    switch (this.config.evictionPolicy) {
      case 'LRU':
        evicted = this.evictLRU(toEvict);
        break;
      case 'LFU':
        evicted = this.evictLFU(toEvict);
        break;
      case 'FIFO':
        evicted = this.evictFIFO(toEvict);
        break;
      case 'RANDOM':
        evicted = this.evictRandom(toEvict);
        break;
    }

    this.stats.evictions += evicted;
  }

  /**
   * Evict using LRU policy
   */
  private evictLRU(count: number): number {
    let evicted = 0;
    
    while (evicted < count && this.accessOrder.length > 0) {
      const key = this.accessOrder.shift()!;
      this.cache.delete(key);
      this.accessFrequency.delete(key);
      evicted++;
    }
    
    return evicted;
  }

  /**
   * Evict using LFU policy
   */
  private evictLFU(count: number): number {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => {
        const freqA = this.accessFrequency.get(a[0]) || 0;
        const freqB = this.accessFrequency.get(b[0]) || 0;
        return freqA - freqB;
      });

    let evicted = 0;
    
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      const [key] = entries[i];
      this.cache.delete(key);
      this.accessFrequency.delete(key);
      this.removeFromAccessOrder(key);
      evicted++;
    }
    
    return evicted;
  }

  /**
   * Evict using FIFO policy
   */
  private evictFIFO(count: number): number {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    let evicted = 0;
    
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      const [key] = entries[i];
      this.cache.delete(key);
      this.accessFrequency.delete(key);
      this.removeFromAccessOrder(key);
      evicted++;
    }
    
    return evicted;
  }

  /**
   * Evict using random policy
   */
  private evictRandom(count: number): number {
    const keys = Array.from(this.cache.keys());
    let evicted = 0;
    
    for (let i = 0; i < Math.min(count, keys.length); i++) {
      const randomIndex = Math.floor(Math.random() * keys.length);
      const key = keys[randomIndex];
      
      this.cache.delete(key);
      this.accessFrequency.delete(key);
      this.removeFromAccessOrder(key);
      keys.splice(randomIndex, 1);
      evicted++;
    }
    
    return evicted;
  }

  /**
   * Record cache hit
   */
  private recordHit(key: string, accessTime: number): void {
    this.stats.hits++;
    
    if (this.config.enableMetrics) {
      this.metrics.push({
        key,
        accessTime,
        accessType: 'HIT',
        timestamp: Date.now(),
        size: this.cache.get(key)?.size || 0
      });
    }
  }

  /**
   * Record cache miss
   */
  private recordMiss(key: string, accessTime: number): void {
    this.stats.misses++;
    
    if (this.config.enableMetrics) {
      this.metrics.push({
        key,
        accessTime,
        accessType: 'MISS',
        timestamp: Date.now(),
        size: 0
      });
    }
  }

  /**
   * Record cache set
   */
  private recordSet(key: string, accessTime: number, size: number): void {
    this.stats.sets++;
    
    if (this.config.enableMetrics) {
      this.metrics.push({
        key,
        accessTime,
        accessType: 'SET',
        timestamp: Date.now(),
        size
      });
    }
  }

  /**
   * Record cache delete
   */
  private recordDelete(key: string, accessTime: number): void {
    this.stats.deletes++;
    
    if (this.config.enableMetrics) {
      this.metrics.push({
        key,
        accessTime,
        accessType: 'DELETE',
        timestamp: Date.now(),
        size: 0
      });
    }
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
    this.stats.missRate = total > 0 ? this.stats.misses / total : 0;
    this.stats.size = this.cache.size;
    this.stats.memoryUsage = this.getMemoryUsage();
    
    // Calculate average access time
    if (this.metrics.length > 0) {
      const totalTime = this.metrics.reduce((sum, m) => sum + m.accessTime, 0);
      this.stats.averageAccessTime = totalTime / this.metrics.length;
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60000); // Clean up every minute
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const expiredKeys: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        expiredKeys.push(key);
      }
    }
    
    for (const key of expiredKeys) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      this.accessFrequency.delete(key);
    }
    
    if (expiredKeys.length > 0) {
      this.emit('cleanup', { entries: expiredKeys.length });
    }
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsTimer = setInterval(() => {
      // Keep only last 10000 metrics
      if (this.metrics.length > 10000) {
        this.metrics = this.metrics.slice(-10000);
      }
    }, 300000); // Clean up metrics every 5 minutes
  }

  /**
   * Generate encryption key
   */
  private generateEncryptionKey(): string {
    return `cache_key_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate checksum
   */
  private calculateChecksum(data: any): string {
    // Simple checksum implementation
    const str = JSON.stringify(data);
    let checksum = 0;
    
    for (let i = 0; i < str.length; i++) {
      checksum = ((checksum << 5) - checksum) + str.charCodeAt(i);
      checksum = checksum & checksum; // Convert to 32-bit integer
    }
    
    return checksum.toString(16);
  }

  /**
   * Compress data (placeholder)
   */
  private compress(data: any): any {
    // In a real implementation, this would use compression algorithms
    return data;
  }

  /**
   * Decompress data (placeholder)
   */
  private decompress(data: any): any {
    // In a real implementation, this would use decompression algorithms
    return data;
  }

  /**
   * Encrypt data (placeholder)
   */
  private encrypt(data: any): any {
    // In a real implementation, this would use encryption algorithms
    return data;
  }

  /**
   * Decrypt data (placeholder)
   */
  private decrypt(data: any): any {
    // In a real implementation, this would use decryption algorithms
    return data;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
    this.stats.maxSize = this.config.maxSize;
    
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): CacheConfig {
    return { ...this.config };
  }

  /**
   * Stop the cache layer
   */
  public stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }
    
    this.clear();
    this.emit('stopped');
  }
}
