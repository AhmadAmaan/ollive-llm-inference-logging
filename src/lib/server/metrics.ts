import { query, queryOne } from "@/lib/db";
import type { DashboardMetrics, MetricsOverview } from "@/lib/types";

export async function getMetricsOverview(): Promise<MetricsOverview> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const totals = await queryOne<{
    total_inferences: string | number;
    successful: string | number;
    average_latency: string | number | null;
    total_tokens: string | number | null;
    errors_last_24h: string | number;
  }>(
    `
      SELECT
        COUNT(*) AS total_inferences,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS successful,
        AVG(latency_ms) AS average_latency,
        SUM(COALESCE(total_tokens, 0)) AS total_tokens,
        SUM(CASE WHEN created_at >= $1 AND status != 'SUCCESS' THEN 1 ELSE 0 END) AS errors_last_24h
      FROM inference_logs
    `,
    [since],
  );

  const providerMixResult = await query<{
    provider: string;
    count: string | number;
  }>(
    `
      SELECT provider, COUNT(*) AS count
      FROM inference_logs
      GROUP BY provider
      ORDER BY count DESC
    `,
  );

  const recentLogsResult = await query<{
    id: string;
    status: "SUCCESS" | "ERROR" | "CANCELLED";
    provider: string;
    model: string;
    latency_ms: number | null;
    created_at: Date;
  }>(
    `
      SELECT id, status, provider, model, latency_ms, created_at
      FROM inference_logs
      ORDER BY created_at DESC
      LIMIT 5
    `,
  );

  const totalInferences = Number(totals?.total_inferences ?? 0);
  const successful = Number(totals?.successful ?? 0);

  return {
    totalInferences,
    successRate:
      totalInferences === 0
        ? 0
        : Number(((successful / totalInferences) * 100).toFixed(1)),
    averageLatencyMs: totals?.average_latency
      ? Math.round(Number(totals.average_latency))
      : null,
    errorsLast24h: Number(totals?.errors_last_24h ?? 0),
    totalTokens: Number(totals?.total_tokens ?? 0),
    providerMix: providerMixResult.rows.map((item) => ({
      provider: item.provider,
      count: Number(item.count),
    })),
    recentLogs: recentLogsResult.rows.map((log) => ({
      id: log.id,
      status: log.status,
      provider: log.provider,
      model: log.model,
      latencyMs: log.latency_ms,
      createdAt: log.created_at.toISOString(),
    })),
  };
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const dailyThroughputResult = await query<{
    bucket: Date;
    count: string | number;
  }>(
    `
      SELECT date_trunc('day', created_at) AS bucket, COUNT(*) AS count
      FROM inference_logs
      WHERE created_at >= NOW() - INTERVAL '6 days'
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
  );

  const statusBreakdownResult = await query<{
    status: "SUCCESS" | "ERROR" | "CANCELLED";
    count: string | number;
  }>(
    `
      SELECT status, COUNT(*) AS count
      FROM inference_logs
      GROUP BY status
      ORDER BY count DESC
    `,
  );

  const latencyBucketsResult = await query<{
    bucket: string;
    count: string | number;
  }>(
    `
      SELECT
        CASE
          WHEN latency_ms IS NULL THEN 'unknown'
          WHEN latency_ms < 500 THEN '<500ms'
          WHEN latency_ms < 1000 THEN '500ms-1s'
          WHEN latency_ms < 2000 THEN '1s-2s'
          ELSE '>2s'
        END AS bucket,
        COUNT(*) AS count
      FROM inference_logs
      GROUP BY bucket
      ORDER BY count DESC
    `,
  );

  const modelMixResult = await query<{
    provider: string;
    model: string;
    count: string | number;
  }>(
    `
      SELECT provider, model, COUNT(*) AS count
      FROM inference_logs
      GROUP BY provider, model
      ORDER BY count DESC
      LIMIT 8
    `,
  );

  return {
    throughputByDay: dailyThroughputResult.rows.map((item) => ({
      label: item.bucket.toISOString().slice(5, 10),
      count: Number(item.count),
    })),
    statusBreakdown: statusBreakdownResult.rows.map((item) => ({
      status: item.status,
      count: Number(item.count),
    })),
    latencyBuckets: latencyBucketsResult.rows.map((item) => ({
      bucket: item.bucket,
      count: Number(item.count),
    })),
    modelMix: modelMixResult.rows.map((item) => ({
      provider: item.provider,
      model: item.model,
      count: Number(item.count),
    })),
  };
}
