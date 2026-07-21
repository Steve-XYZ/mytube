export interface ProcessPerformanceMetric {
  pid: number;
  type: string;
  cpuPercent: number;
  workingSetSizeKb: number;
}

interface PerformanceMonitorOptions {
  getProcessMetrics: () => ProcessPerformanceMetric[];
  onLag: (lagMs: number, metrics: ProcessPerformanceMetric[]) => void;
  onMetrics: (metrics: ProcessPerformanceMetric[]) => void;
  intervalMs?: number;
  lagThresholdMs?: number;
  metricsIntervalMs?: number;
  now?: () => number;
}

const DEFAULT_SAMPLE_INTERVAL_MS = 5_000;
const DEFAULT_LAG_THRESHOLD_MS = 250;
const DEFAULT_METRICS_INTERVAL_MS = 5 * 60_000;

export class MainProcessPerformanceMonitor {
  private readonly intervalMs: number;
  private readonly lagThresholdMs: number;
  private readonly metricsIntervalMs: number;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private expectedAt = 0;
  private lastMetricsAt = 0;

  constructor(private readonly options: PerformanceMonitorOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
    this.lagThresholdMs = options.lagThresholdMs ?? DEFAULT_LAG_THRESHOLD_MS;
    this.metricsIntervalMs = options.metricsIntervalMs ?? DEFAULT_METRICS_INTERVAL_MS;
    this.now = options.now ?? (() => performance.now());
  }

  start(): void {
    if (this.timer) return;
    const now = this.now();
    this.expectedAt = now + this.intervalMs;
    this.lastMetricsAt = now;
    this.options.onMetrics(this.options.getProcessMetrics());
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private sample(): void {
    const now = this.now();
    const lagMs = Math.max(0, Math.round(now - this.expectedAt));
    this.expectedAt = now + this.intervalMs;

    if (lagMs >= this.lagThresholdMs) {
      this.options.onLag(lagMs, this.options.getProcessMetrics());
    }

    if (now - this.lastMetricsAt >= this.metricsIntervalMs) {
      this.lastMetricsAt = now;
      this.options.onMetrics(this.options.getProcessMetrics());
    }
  }
}

export function formatProcessMetrics(metrics: ProcessPerformanceMetric[]): string {
  return metrics
    .map(
      (metric) =>
        `${metric.type}:${metric.pid} rss_mib=${(metric.workingSetSizeKb / 1024).toFixed(1)} cpu_pct=${metric.cpuPercent.toFixed(1)}`,
    )
    .join('; ');
}
