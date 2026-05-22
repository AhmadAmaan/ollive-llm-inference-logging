# Helm Chart

This directory packages the self-hosted Kubernetes deployment as a Helm chart.

## Chart Location

`helm/ollive-inference-console`

## Install

```bash
helm upgrade --install ollive ./helm/ollive-inference-console \
  --namespace ollive-assignment \
  --create-namespace
```

## Common Overrides

```bash
helm upgrade --install ollive ./helm/ollive-inference-console \
  --namespace ollive-assignment \
  --create-namespace \
  --set image.repository=your-registry/ollive-assignment \
  --set image.tag=latest \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=ollive.local
```

## External Database

If you want to use an external Postgres instance:

```bash
helm upgrade --install ollive ./helm/ollive-inference-console \
  --namespace ollive-assignment \
  --create-namespace \
  --set postgres.enabled=false \
  --set secrets.databaseUrl='postgresql://user:password@db-host:5432/ollive_inference'
```

## External Redis

If you want to use an external Redis instance for the ingestion queue:

```bash
helm upgrade --install ollive ./helm/ollive-inference-console \
  --namespace ollive-assignment \
  --create-namespace \
  --set redis.enabled=false \
  --set secrets.redisUrl='redis://redis-host:6379'
```

## Tradeoffs

- The chart defaults to a single application replica because cancellation is still tracked in memory.
- Postgres and Redis are bundled by default for self-hosted completeness, but the chart supports switching either dependency to an external service.
