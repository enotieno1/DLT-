# VERIDION CHAIN - Enterprise DLT Solutions

**Trust Transformed - Enterprise-Grade Distributed Ledger Technology**

A comprehensive enterprise-grade DLT platform serving finance, supply chain, identity verification, asset tokenization, digital payments, and government record management.

## 🏢 Business Overview

**Company:** Veridion Chain  
**Mission:** Transform enterprise operations through secure, scalable, and compliant distributed ledger technology  
**Target Markets:** Governments, Financial Institutions, Supply Chain, SMEs, Fintech Companies

## 💼 Product Suite

- **Permissioned Network**: Only authorized nodes can participate
- **Proof of Authority Consensus**: Efficient consensus for enterprise environments
- **Role-Based Access Control**: Granular permissions (Admin, Validator, User, Auditor)
- **Digital Signatures**: ECDSA cryptographic signatures
- **Immutable Ledger**: Cryptographically secured blockchain
- **Audit Logging**: Comprehensive tamper-evident audit trail
- **P2P Network**: Secure peer-to-peer communication
- **REST API**: HTTP interface for external applications

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Enterprise DLT Network                       │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │   Node A    │  │   Node B    │  │   Node C    │  │ Node D  │ │
│  │ (Authority) │  │ (Validator) │  │ (Validator) │  │(Peer)   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 16.0.0 or higher
- TypeScript 5.0.0 or higher
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/enotieno1/enterprise-dlt.git
cd enterprise-dlt

# Install dependencies
npm install

# Build the project
npm run build

# Copy environment configuration
cp .env.example .env
```

### Configuration

Edit the `.env` file to configure your node:

```env
NODE_ID=node-1
NODE_ADDRESS=localhost
NODE_PORT=3000
NODE_ROLE=authority
VALIDATOR_SET=node-1,node-2,node-3
```

### Running the Node

```bash
# Development mode
npm run dev

# Production mode
npm start

# Run tests
npm test
```

## API Endpoints

### Health Check
```
GET /health
```

### Get Validators
```
GET /validators
```

### Submit Transaction
```
POST /transactions
Content-Type: application/json

{
  "from": "0x...",
  "to": "0x...",
  "value": "1000",
  "data": "0x...",
  "signature": "0x..."
}
```

### Get Block
```
GET /blocks/:number
```

### Get Transaction
```
GET /transactions/:hash
```

## Node Roles

- **Authority**: Can propose blocks and participate in consensus
- **Validator**: Can validate blocks and participate in consensus
- **Peer**: Can receive blocks and transactions, but cannot participate in consensus

## Consensus Mechanism

The system uses Proof of Authority (PoA) consensus:

1. **Authority Selection**: Round-robin selection among authorized nodes
2. **Block Proposal**: Selected authority creates block from transaction pool
3. **Validation**: Other validators verify block integrity
4. **Voting**: Validators vote on block validity
5. **Finalization**: Block added to chain upon consensus

## Security Features

- **Digital Signatures**: ECDSA with secp256k1 curve
- **Hash Algorithm**: SHA-256 for blocks, Keccak-256 for transactions
- **Encryption**: TLS 1.3 for P2P communication
- **Access Control**: JWT tokens with role-based permissions

## Development

### Project Structure

```
src/
├── core/                 # Core blockchain logic
│   ├── blockchain/       # Blockchain management
│   ├── consensus/        # Consensus mechanisms
│   ├── crypto/          # Cryptographic utilities
│   └── types/           # Type definitions
├── network/             # P2P networking
├── api/                 # External API layer
├── auth/                # Authentication & authorization
├── storage/             # Data persistence
├── config/              # Configuration management
├── utils/               # Utility functions
└── monitoring/          # Monitoring & metrics
```

### Building

```bash
npm run build
```

### Testing

```bash
npm test
npm run test:watch
```

### Linting

```bash
npm run lint
npm run lint:fix
```

## Docker Deployment

```bash
# Build Docker image
npm run docker:build

# Run with Docker Compose
npm run docker:run
```

## Configuration Options

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| NODE_ID | Unique node identifier | node-1 |
| NODE_ADDRESS | Node IP address | localhost |
| NODE_PORT | Node port | 3000 |
| NODE_ROLE | Node role (authority/validator/peer) | peer |
| BLOCK_TIME | Block creation interval (ms) | 5000 |
| VALIDATOR_SET | Comma-separated validator IDs | - |
| BLOCK_GAS_LIMIT | Maximum gas per block | 1000000 |
| MIN_VALIDATORS | Minimum validators for consensus | 3 |

## Performance

- **Throughput**: 1000+ transactions/second
- **Latency**: <5 seconds for transaction confirmation
- **Block Time**: 5 seconds (configurable)
- **Network**: Minimum 3 nodes for redundancy

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## Support

For support and questions, please open an issue on GitHub.
