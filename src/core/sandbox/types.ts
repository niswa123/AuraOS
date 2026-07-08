/**
 * AuraOS Cognitive Container - Type Definitions
 * Contracts for sandbox execution, resource limits, and result structures.
 */

export interface ResourceLimits {
  /** Maximum RAM in bytes (default: 256MB) */
  memoryBytes: number;
  /** CPU allocation in fractional cores (default: 0.5) */
  cpuCores: number;
  /** Maximum execution time in milliseconds (default: 30s) */
  timeoutMs: number;
  /** Maximum number of processes inside the container */
  pidsLimit: number;
  /** Disable network access inside sandbox */
  networkDisabled: boolean;
}

export interface SandboxConfig {
  /** Unique execution ID for tracking */
  executionId: string;
  /** Language runtime: 'python' | 'node' */
  runtime: 'python' | 'node';
  /** The source code string to execute */
  code: string;
  /** Resource constraints for this execution */
  limits: ResourceLimits;
  /** Optional environment variables to inject */
  env?: Record<string, string>;
  /** Optional stdin input to pipe into the process */
  stdin?: string;
}

export interface ExecutionResult {
  /** Unique execution ID */
  executionId: string;
  /** Exit code of the process (0 = success) */
  exitCode: number;
  /** Captured stdout output */
  stdout: string;
  /** Captured stderr output */
  stderr: string;
  /** Total execution duration in milliseconds */
  durationMs: number;
  /** Whether execution was killed by timeout */
  timedOut: boolean;
  /** Whether execution was killed by OOM */
  oomKilled: boolean;
  /** Container ID used for this execution */
  containerId: string;
  /** Recovered intermediate checkpoint variables */
  checkpointVars?: Record<string, any>;
}

export type SandboxStatus = 'idle' | 'creating' | 'running' | 'completed' | 'timeout' | 'error' | 'oom_killed';

export const DEFAULT_LIMITS: ResourceLimits = {
  memoryBytes: 256 * 1024 * 1024,   // 256 MB
  cpuCores: 0.5,
  timeoutMs: 30_000,                 // 30 seconds
  pidsLimit: 64,
  networkDisabled: true,
};

export const MAX_LIMITS: ResourceLimits = {
  memoryBytes: 1024 * 1024 * 1024,   // 1 GB
  cpuCores: 2.0,
  timeoutMs: 300_000,                 // 5 minutes
  pidsLimit: 256,
  networkDisabled: false,
};
