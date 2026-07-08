/**
 * AuraOS Cognitive Container - Sandbox Orchestrator
 * High-level execution engine that manages sandboxed code runs
 * with resource limits, timeout enforcement, and cleanup.
 */

import {
  createContainer,
  runContainer,
  inspectContainer,
  killContainer,
  removeContainer,
  imageExists,
} from './docker-client.js';
import type { SandboxConfig, ExecutionResult, ResourceLimits } from './types.js';
import { DEFAULT_LIMITS, MAX_LIMITS } from './types.js';
import { execSync } from 'child_process';
import fs from 'fs';
import { AuraFSService } from './aura-fs.js';

const RUNTIME_IMAGES: Record<string, string> = {
  python: 'auraos-python-runner',
  node: 'auraos-node-runner',
};

/**
 * Clamp resource limits to the allowed maximums.
 */
function clampLimits(limits: Partial<ResourceLimits>): ResourceLimits {
  return {
    memoryBytes: Math.min(limits.memoryBytes ?? DEFAULT_LIMITS.memoryBytes, MAX_LIMITS.memoryBytes),
    cpuCores: Math.min(limits.cpuCores ?? DEFAULT_LIMITS.cpuCores, MAX_LIMITS.cpuCores),
    timeoutMs: Math.min(limits.timeoutMs ?? DEFAULT_LIMITS.timeoutMs, MAX_LIMITS.timeoutMs),
    pidsLimit: Math.min(limits.pidsLimit ?? DEFAULT_LIMITS.pidsLimit, MAX_LIMITS.pidsLimit),
    networkDisabled: limits.networkDisabled ?? DEFAULT_LIMITS.networkDisabled,
  };
}

/**
 * Execute agent-generated code inside an isolated Docker sandbox.
 *
 * Lifecycle:
 *   1. Validate that the runner image exists.
 *   2. Create a container with resource constraints.
 *   3. Pipe code via shell command argument.
 *   4. Start the container and capture stdout/stderr.
 *   5. Enforce timeout via a parallel kill timer.
 *   6. Inspect exit state (OOM, exit code).
 *   7. Remove the container.
 *   8. Return structured ExecutionResult.
 */
export async function executeInSandbox(config: SandboxConfig): Promise<ExecutionResult> {
  const startTime = Date.now();
  const limits = clampLimits(config.limits);
  const imageName = RUNTIME_IMAGES[config.runtime];

  if (!imageName) {
    throw new Error(`Unsupported runtime: ${config.runtime}. Supported: ${Object.keys(RUNTIME_IMAGES).join(', ')}`);
  }

  // Verify image availability
  const hasImage = await imageExists(imageName);
  if (!hasImage) {
    throw new Error(
      `Runner image "${imageName}" not found. Build it first:\n` +
      `  docker build -t ${imageName} ./docker/${config.runtime}-runner`
    );
  }

  // Determine the execution command based on runtime
  // The entrypoint.sh already calls python3/node, so we only pass args
  const cmd = config.runtime === 'python'
    ? ['-c', config.code]
    : ['-e', config.code];

  // Build environment variables array
  const envArray = Object.entries(config.env || {}).map(([k, v]) => `${k}=${v}`);

  // Create the container with resource constraints
  const container = await createContainer({
    image: imageName,
    cmd,
    memoryBytes: limits.memoryBytes,
    cpuCores: limits.cpuCores,
    pidsLimit: limits.pidsLimit,
    networkDisabled: limits.networkDisabled,
    env: envArray,
  });

  const containerId = container.id;
  let timedOut = false;

  // Set up timeout enforcement
  const timeoutHandle = setTimeout(async () => {
    timedOut = true;
    console.warn(`[AuraOS Sandbox] Execution ${config.executionId} timed out after ${limits.timeoutMs}ms. Killing container ${containerId.slice(0, 12)}.`);
    await killContainer(container);
  }, limits.timeoutMs);

  let stdout = '';
  let stderr = '';
  let exitCode = -1;
  let oomKilled = false;

  try {
    // Run the container and capture output
    const output = await runContainer(container);
    stdout = output.stdout;
    stderr = output.stderr;

    // Inspect the container's final state
    const inspection = await inspectContainer(container);
    exitCode = inspection.exitCode;
    oomKilled = inspection.oomKilled;
  } catch (error: any) {
    stderr += `\n[AuraOS Sandbox Error] ${error.message}`;
    exitCode = -1;
  } finally {
    // Clear the timeout timer
    clearTimeout(timeoutHandle);
  }

  // Attempt to recover state checkpoints from the SQLite-backed AuraFS database inside the stopped container
  let checkpointVars: any = undefined;
  const targetDbPath = `/tmp/aurafs_${config.executionId}.db`;
  try {
    // 1. Try AuraFS SQLite recovery first
    execSync(`docker cp ${containerId}:/tmp/agent_workspace.db ${targetDbPath}`, { stdio: 'ignore' });
    if (fs.existsSync(targetDbPath)) {
      const auraFS = new AuraFSService(config.executionId);
      await auraFS.init();
      const content = await auraFS.readFile('/tmp/state_checkpoint.json');
      if (content) {
        checkpointVars = JSON.parse(content.toString('utf8'));
        console.log(`[AuraOS Sandbox] Recovered checkpoint state variables via AuraFS SQL:`, checkpointVars);
      }
      await auraFS.destroy();
    }
  } catch (err) {
    // Silent skip for AuraFS
  }

  // 2. Fallback to direct file copy to support legacy integration tests
  if (!checkpointVars) {
    const tempCheckpointFile = `/tmp/checkpoint_${config.executionId}.json`;
    try {
      execSync(`docker cp ${containerId}:/tmp/state_checkpoint.json ${tempCheckpointFile}`, { stdio: 'ignore' });
      if (fs.existsSync(tempCheckpointFile)) {
        const raw = fs.readFileSync(tempCheckpointFile, 'utf8');
        checkpointVars = JSON.parse(raw);
        console.log(`[AuraOS Sandbox] Recovered checkpoint state variables from sandbox:`, checkpointVars);
        fs.unlinkSync(tempCheckpointFile);
      }
    } catch (err) {
      // No checkpoint written or container failed before write
    }
  }

  // Always clean up the container
  try {
    await removeContainer(container);
  } catch (cleanupErr) {
    // Ignore cleanup error if already removed
  }

  const durationMs = Date.now() - startTime;

  // Log execution summary
  const status = oomKilled ? 'OOM_KILLED' : timedOut ? 'TIMEOUT' : exitCode === 0 ? 'SUCCESS' : 'FAILED';
  console.log(
    `[AuraOS Sandbox] Execution ${config.executionId} | ` +
    `Runtime: ${config.runtime} | Status: ${status} | ` +
    `Duration: ${durationMs}ms | Exit: ${exitCode} | ` +
    `Container: ${containerId.slice(0, 12)}`
  );

  return {
    executionId: config.executionId,
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    durationMs,
    timedOut,
    oomKilled,
    containerId,
    checkpointVars,
  };
}

/**
 * Execute code with default resource limits.
 * Convenience wrapper for quick executions.
 */
export async function quickExecute(
  runtime: 'python' | 'node',
  code: string,
  executionId?: string,
): Promise<ExecutionResult> {
  return executeInSandbox({
    executionId: executionId || `exec-${Date.now()}`,
    runtime,
    code,
    limits: DEFAULT_LIMITS,
  });
}
