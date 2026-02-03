# VERIDION CHAIN - Enterprise DLT Solutions

Trust Transformed - Enterprise-Grade Distributed Ledger Technology

A comprehensive enterprise-grade DLT platform serving finance, supply chain, identity verification, asset tokenization, digital payments, and government record management.

## 🏢 Business Overview

Company: Veridion Chain
Mission: Transform enterprise operations through secure, scalable, and compliant distributed ledger technology
Target Markets: Governments, Financial Institutions, Supply Chain, SMEs, Fintech Companies

## 💼 Product Suite

- Permissioned Network: Only authorized nodes can participate
- Proof of Authority Consensus: Efficient consensus for enterprise environments
- Role-Based Access Control: Granular permissions (Admin, Validator, User, Auditor)
- Digital Signatures: ECDSA cryptographic signatures
- Immutable Ledger: Cryptographically secured blockchain
- Audit Logging: Comprehensive tamper-evident audit trail
- P2P Network: Secure peer-to-peer communication
- REST API: HTTP interface for external applications
=======
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
>>>>>>> 8e112d1604ce3e9da87bc6f846767ac082e7babf

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
<<<<<<< HEAD
│                    Enterprise DLT Network                        │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────┐ │
│ │   Node A    │ │   Node B    │ │   Node C    │ │ Node D  │ │
│ │ (Authority) │ │ (Validator) │ │ (Validator) │ │ (Peer)  │ │
│ └─────────────┘ └─────────────┘ └─────────────┘ └─────────┘ │
=======
│                    Enterprise DLT Network                       │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │   Node A    │  │   Node B    │  │   Node C    │  │ Node D  │ │
│  │ (Authority) │  │ (Validator) │  │ (Validator) │  │(Peer)   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ │
>>>>>>> 8e112d1604ce3e9da87bc6f846767ac082e7babf
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites
<<<<<<< HEAD
=======

>>>>>>> 8e112d1604ce3e9da87bc6f846767ac082e7babf
- Node.js 16.0.0 or higher
- TypeScript 5.0.0 or higher
- Git

### Installation
<<<<<<< HEAD
=======

>>>>>>> 8e112d1604ce3e9da87bc6f846767ac082e7babf
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
<<<<<<< HEAD
Edit the .env file to configure your node:

```
=======

Edit the `.env` file to configure your node:

```env
>>>>>>> 8e112d1604ce3e9da87bc6f846767ac082e7babf
NODE_ID=node-1
NODE_ADDRESS=localhost
NODE_PORT=3000
NODE_ROLE=authority
VALIDATOR_SET=node-1,node-2,node-3
```

### Running the Node
<<<<<<< HEAD
=======

>>>>>>> 8e112d1604ce3e9da87bc6f846767ac082e7babf
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
<<<<<<< HEAD
- `GET /health` - Check node health status

### Get Validators
- `GET /validators` - Get list of active validators

### Submit Transaction
- `POST /transactions` - Submit a new transaction

### Get Block
- `GET /blocks/:id` - Get block by ID

### Get Transaction
- `GET /transactions/:id` - Get transaction by ID

## Node Roles

### Authority Node
- Manages network permissions
- Can add/remove validators
- Maintains network governance

### Validator Node
- Participates in consensus
- Validates transactions
- Creates new blocks

### Peer Node
- Can submit transactions
- Can query the ledger
- Cannot participate in consensus

## Consensus Mechanism

The network uses Proof of Authority (PoA) consensus:
- Authority nodes designate validators
- Validators take turns creating blocks
- Blocks are validated by majority of validators
- Finality is achieved through validator signatures

## Security Features

- ECDSA digital signatures
- Role-based access control
- Immutable audit trail
- Secure P2P communication
- Permissioned network access
=======
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
>>>>>>> 8e112d1604ce3e9da87bc6f846767ac082e7babf

## Development

### Project Structure
<<<<<<< HEAD
```
src/
├── core/           # Core blockchain logic
├── network/        # P2P networking
├── api/           # REST API endpoints
├── crypto/        # Cryptographic functions
├── consensus/     # Consensus mechanism
└── utils/         # Utility functions
```

### Building
=======

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

>>>>>>> 8e112d1604ce3e9da87bc6f846767ac082e7babf
```bash
npm run build
```

### Testing
<<<<<<< HEAD
```bash
npm test
```

### Linting
=======

```bash
npm test
npm run test:watch
```

### Linting

>>>>>>> 8e112d1604ce3e9da87bc6f846767ac082e7babf
```bash
npm run lint
npm run lint:fix
```

## Docker Deployment

```bash
# Build Docker image
<<<<<<< HEAD
docker build -t veridion-chain .

# Run container
docker run -p 3000:3000 veridion-chain
```

## Performance

- Transaction throughput: 1000+ tx/sec
- Block finality: < 5 seconds
- Network latency: < 100ms
- Storage efficiency: Optimized for enterprise workloads

## License

MIT License - see LICENSE file for details

## Contributing

Please read CONTRIBUTING.md for details on our code of conduct and the process for submitting pull requests.

## Support

For support and questions:
- Create an issue in the GitHub repository
- Contact the development team
- Check the documentation

## About

VERIDION CHAIN is developed by the enterprise DLT team at Veridion, bringing together expertise in blockchain technology, enterprise security, and distributed systems.

## Resources

- [Documentation](https://docs.veridion-chain.com)
- [API Reference](https://api.veridion-chain.com)
- [Whitepaper](https://whitepaper.veridion-chain.com)
- [Community Forum](https://community.veridion-chain.com)
=======
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
>>>>>>> 8e112d1604ce3e9da87bc6f846767ac082e7babf
