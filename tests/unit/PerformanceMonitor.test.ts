import { afterEach, describe, expect, it, vi } from 'vitest';
import { MainProcessPerformanceMonitor, formatProcessMetrics } from '../../src/main/performance/PerformanceMonitor';

describe('MainProcessPerformanceMonitor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports event-loop lag above the configured threshold', () => {
    vi.useFakeTimers();
    let now = 0;
    const onLag = vi.fn();
    const monitor = new MainProcessPerformanceMonitor({
      intervalMs: 1_000,
      lagThresholdMs: 250,
      metricsIntervalMs: 60_000,
      now: () => now,
      getProcessMetrics: () => [],
      onLag,
      onMetrics: vi.fn(),
    });
    monitor.start();

    now = 1_300;
    vi.advanceTimersByTime(1_000);

    expect(onLag).toHaveBeenCalledWith(300, []);
    monitor.stop();
  });

  it('formats process memory and CPU without exposing unrelated details', () => {
    expect(
      formatProcessMetrics([
        { pid: 10, type: 'Browser', cpuPercent: 12.345, workingSetSizeKb: 128 * 1024 },
        { pid: 11, type: 'Tab', cpuPercent: 0.5, workingSetSizeKb: 64 * 1024 },
      ]),
    ).toBe('Browser:10 rss_mib=128.0 cpu_pct=12.3; Tab:11 rss_mib=64.0 cpu_pct=0.5');
  });
});
