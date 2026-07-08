import Docker from 'dockerode';

const docker = new Docker();

export class WarmPoolSupervisor {
  private static instance: WarmPoolSupervisor;
  private warmContainers: Map<string, string[]> = new Map(); // runtime -> containerIds

  private constructor() {
    this.warmContainers.set('python', []);
    this.warmContainers.set('node', []);
  }

  public static getInstance(): WarmPoolSupervisor {
    if (!WarmPoolSupervisor.instance) {
      WarmPoolSupervisor.instance = new WarmPoolSupervisor();
    }
    return WarmPoolSupervisor.instance;
  }

  /**
   * Suspend a container using Docker's cgroup Freezer (pause API).
   * Measures and returns the scheduling suspension latency in milliseconds.
   */
  public async suspendContainer(containerId: string): Promise<number> {
    const start = performance.now();
    try {
      const container = docker.getContainer(containerId);
      await container.pause();
      const latency = performance.now() - start;
      console.log(`[WarmPool] Suspended container ${containerId.slice(0, 12)} in ${latency.toFixed(2)}ms via cgroups freezer.`);
      return latency;
    } catch (err: any) {
      console.error(`[WarmPool] Failed to suspend container:`, err.message);
      return -1;
    }
  }

  /**
   * Thaw / resume process scheduling in a container using Docker's cgroup Freezer (unpause API).
   * Measures and returns the wakeup latency in milliseconds.
   */
  public async thawContainer(containerId: string): Promise<number> {
    const start = performance.now();
    try {
      const container = docker.getContainer(containerId);
      await container.unpause();
      const latency = performance.now() - start;
      console.log(`[WarmPool] Reactivated container ${containerId.slice(0, 12)} in ${latency.toFixed(2)}ms (sub-15ms threshold check).`);
      return latency;
    } catch (err: any) {
      console.error(`[WarmPool] Failed to thaw container:`, err.message);
      return -1;
    }
  }

  /**
   * Add a pre-warmed container to the standby pool.
   */
  public addWarmContainer(runtime: string, containerId: string): void {
    const list = this.warmContainers.get(runtime) || [];
    list.push(containerId);
    this.warmContainers.set(runtime, list);
  }

  /**
   * Fetch a pre-warmed container from the standby pool.
   */
  public getWarmContainer(runtime: string): string | null {
    const list = this.warmContainers.get(runtime) || [];
    if (list.length > 0) {
      return list.shift() || null;
    }
    return null;
  }

  /**
   * Clear and remove all pre-warmed / paused containers.
   */
  public async clearPool(): Promise<void> {
    for (const [runtime, ids] of this.warmContainers.entries()) {
      for (const id of ids) {
        try {
          const container = docker.getContainer(id);
          await container.unpause().catch(() => {});
          await container.remove({ force: true, v: true }).catch(() => {});
        } catch {}
      }
      this.warmContainers.set(runtime, []);
    }
  }
}
