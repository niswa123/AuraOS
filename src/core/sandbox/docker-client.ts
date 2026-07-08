/**
 * AuraOS Cognitive Container - Docker Engine API Client
 * Low-level wrapper around dockerode for container lifecycle management.
 */

import Docker from 'dockerode';
import { PassThrough } from 'stream';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export interface ContainerCreateOptions {
  image: string;
  cmd: string[];
  memoryBytes: number;
  cpuCores: number;
  pidsLimit: number;
  networkDisabled: boolean;
  env?: string[];
  stdin?: boolean;
}

export interface ContainerInspectResult {
  exitCode: number;
  oomKilled: boolean;
  running: boolean;
}

/**
 * Create and start a Docker container with resource constraints.
 */
export async function createContainer(opts: ContainerCreateOptions): Promise<Docker.Container> {
  const container = await docker.createContainer({
    Image: opts.image,
    Cmd: opts.cmd,
    Env: opts.env || [],
    OpenStdin: opts.stdin || false,
    StdinOnce: opts.stdin || false,
    AttachStdin: opts.stdin || false,
    AttachStdout: true,
    AttachStderr: true,
    NetworkDisabled: opts.networkDisabled,
    HostConfig: {
      Memory: opts.memoryBytes,
      MemorySwap: opts.memoryBytes, // No swap, hard memory limit
      NanoCpus: Math.round(opts.cpuCores * 1e9),
      PidsLimit: opts.pidsLimit,
      ReadonlyRootfs: false,
      SecurityOpt: ['no-new-privileges'],
    },
  });

  return container;
}

/**
 * Start a container and attach to its output streams.
 * Returns combined stdout and stderr as strings.
 */
export async function runContainer(container: Docker.Container): Promise<{ stdout: string; stderr: string }> {
  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  });

  let stdout = '';
  let stderr = '';

  return new Promise((resolve, reject) => {
    // Docker multiplexed stream: demux stdout and stderr
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    docker.modem.demuxStream(stream, stdoutStream, stderrStream);

    stdoutStream.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    stderrStream.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    container.start()
      .then(() => container.wait())
      .then(() => {
        // Small delay to ensure all stream data is flushed
        setTimeout(() => resolve({ stdout, stderr }), 100);
      })
      .catch(reject);
  });
}

/**
 * Inspect a container's exit state.
 */
export async function inspectContainer(container: Docker.Container): Promise<ContainerInspectResult> {
  const info = await container.inspect();
  return {
    exitCode: info.State.ExitCode ?? -1,
    oomKilled: info.State.OOMKilled ?? false,
    running: info.State.Running ?? false,
  };
}

/**
 * Force-kill a running container (SIGKILL).
 */
export async function killContainer(container: Docker.Container): Promise<void> {
  try {
    const info = await container.inspect();
    if (info.State.Running) {
      await container.kill({ signal: 'SIGKILL' });
    }
  } catch {
    // Container may already be stopped
  }
}

/**
 * Remove a container (force removal even if running).
 */
export async function removeContainer(container: Docker.Container): Promise<void> {
  try {
    await container.remove({ force: true, v: true });
  } catch {
    // Container may already be removed
  }
}

/**
 * Check if a Docker image exists locally.
 */
export async function imageExists(imageName: string): Promise<boolean> {
  try {
    await docker.getImage(imageName).inspect();
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a Docker image from a local Dockerfile directory.
 */
export async function buildImage(contextPath: string, imageName: string): Promise<void> {
  const stream = await docker.buildImage(
    { context: contextPath, src: ['.'] },
    { t: imageName }
  );

  return new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export { docker };
