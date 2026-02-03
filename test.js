// Simple test file to demonstrate the VERIDION CHAIN project structure
// This file can be run with Node.js once dependencies are installed

console.log('🚀 VERIDION CHAIN - Enterprise DLT Solutions');
console.log('==========================================');

// Mock implementation for testing without dependencies
class MockTransaction {
  constructor(data) {
    this.from = data.from;
    this.to = data.to;
    this.amount = data.amount;
    this.timestamp = data.timestamp || Date.now();
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return `hash_${this.from}_${this.to}_${this.amount}_${this.timestamp}`;
  }

  isValid() {
    return this.from && this.to && this.amount > 0;
  }
}

class MockBlock {
  constructor(index, previousHash, transactions, timestamp) {
    this.index = index;
    this.previousHash = previousHash;
    this.transactions = transactions;
    this.timestamp = timestamp || Date.now();
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return `block_${this.index}_${this.previousHash}_${this.transactions.length}_${this.timestamp}`;
  }
}

// Demo functionality
function demonstrateDLT() {
  console.log('\n📦 Creating sample transactions...');
  
  const tx1 = new MockTransaction({
    from: 'alice',
    to: 'bob',
    amount: 100
  });

  const tx2 = new MockTransaction({
    from: 'bob',
    to: 'charlie',
    amount: 50
  });

  console.log(`✅ Transaction 1: ${tx1.hash}`);
  console.log(`✅ Transaction 2: ${tx2.hash}`);

  console.log('\n🔗 Creating genesis block...');
  const genesisBlock = new MockBlock(0, '0', [], Date.now());
  console.log(`✅ Genesis Block: ${genesisBlock.hash}`);

  console.log('\n📦 Creating block with transactions...');
  const block1 = new MockBlock(1, genesisBlock.hash, [tx1, tx2], Date.now());
  console.log(`✅ Block 1: ${block1.hash}`);
  console.log(`   - Previous Hash: ${block1.previousHash}`);
  console.log(`   - Transactions: ${block1.transactions.length}`);
  console.log(`   - Timestamp: ${new Date(block1.timestamp).toISOString()}`);

  console.log('\n🌐 Network Configuration:');
  console.log(`   - Node ID: ${process.env.NODE_ID || 'node-1'}`);
  console.log(`   - Address: ${process.env.NODE_ADDRESS || 'localhost'}`);
  console.log(`   - Port: ${process.env.NODE_PORT || 3000}`);
  console.log(`   - Role: ${process.env.NODE_ROLE || 'authority'}`);

  console.log('\n🎯 VERIDION CHAIN is ready to run!');
  console.log('   Install Node.js and run "npm install" to get started.');
}

// Run demonstration
demonstrateDLT();
