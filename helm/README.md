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

## Tradeoffs

- The chart defaults to a single application replica because cancellation is still tracked in memory.
- Postgres is bundled by default for self-hosted completeness, but the chart supports switching to an external database.
