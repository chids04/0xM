
// used to benchmark performance of different endpoints
class BenchmarkService {
  private benchmarks: { [label: string]: number[] } = {};
  private readonly endpoint = "/api/log-time"; // Hardcoded

  start(label: string): () => void {
    if (!this.benchmarks[label]) {
      this.benchmarks[label] = [];
    }
    const startTime = performance.now();
    return () => {
      const endTime = performance.now();
      const duration = endTime - startTime;
      this.benchmarks[label].push(duration);

      // Immediately send to the server
      this.sendBenchmark(label, duration);
    };
  }

  private async sendBenchmark(label: string, duration: number) {
    try {
      const payload = {
        label,
        duration,
      };

      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error("Failed to send benchmark to server:", error);
    }
  }

  exportAsJson(): string {
    return JSON.stringify(this.benchmarks, null, 2);
  }

  reset(): void {
    this.benchmarks = {};
  }
}

const benchmarkService = new BenchmarkService();
export default benchmarkService;
