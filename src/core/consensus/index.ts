export { ProofOfAuthority, ConsensusConfig, Vote } from './poa';
export { ConsensusEngine, ConsensusState, Checkpoint } from './ConsensusEngine';
export { FaultTolerantConsensus, FaultTolerantConfig, ValidatorHealth, ConsensusRound, NetworkPartition } from './FaultTolerantConsensus';
export { ByzantineFaultTolerance, ByzantineConfig, Accusation, Evidence, SlashingRecord } from './ByzantineFaultTolerance';
export { ValidatorHealthMonitor, HealthMetrics, HealthThresholds, HealthAlert, HealthReport } from './ValidatorHealthMonitor';
export { AutomaticFailover, FailoverConfig, FailoverNode, FailoverEvent, LeaderElectionResult } from './AutomaticFailover';
export { NetworkPartitionHandler, PartitionConfig, PartitionNode, PartitionInfo, SyncRequest } from './NetworkPartitionHandler';
export { ConsensusRecovery, RecoveryConfig, RecoveryState, RecoveryCheckpoint, RecoveryProgress } from './ConsensusRecovery';

// Re-export commonly used types
export type { 
  ConsensusConfig as IConsensusConfig,
  Vote as IVote,
  ConsensusState as IConsensusState,
  Checkpoint as ICheckpoint
} from './ConsensusEngine';

export type {
  FaultTolerantConfig as IFaultTolerantConfig,
  ValidatorHealth as IValidatorHealth,
  ConsensusRound as IConsensusRound,
  NetworkPartition as INetworkPartition
} from './FaultTolerantConsensus';

export type {
  ByzantineConfig as IByzantineConfig,
  Accusation as IAccusation,
  Evidence as IEvidence,
  SlashingRecord as ISlashingRecord
} from './ByzantineFaultTolerance';

export type {
  HealthMetrics as IHealthMetrics,
  HealthThresholds as IHealthThresholds,
  HealthAlert as IHealthAlert,
  HealthReport as IHealthReport
} from './ValidatorHealthMonitor';

export type {
  FailoverConfig as IFailoverConfig,
  FailoverNode as IFailoverNode,
  FailoverEvent as IFailoverEvent,
  LeaderElectionResult as ILeaderElectionResult
} from './AutomaticFailover';

export type {
  PartitionConfig as IPartitionConfig,
  PartitionNode as IPartitionNode,
  PartitionInfo as IPartitionInfo,
  SyncRequest as ISyncRequest
} from './NetworkPartitionHandler';

export type {
  RecoveryConfig as IRecoveryConfig,
  RecoveryState as IRecoveryState,
  RecoveryCheckpoint as IRecoveryCheckpoint,
  RecoveryProgress as IRecoveryProgress
} from './ConsensusRecovery';
