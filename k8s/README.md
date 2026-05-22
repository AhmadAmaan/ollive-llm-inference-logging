# Kubernetes Deployment

This folder provides a self-hosted deployment path for the assignment.

## Included Manifests

- `namespace.yaml`
- `configmap.yaml`
- `secret.example.yaml`
- `postgres.yaml`
- `redis.yaml`
- `app.yaml`
- `worker.yaml`
- `ingress.yaml`

## Apply Order

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.example.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/app.yaml
kubectl apply -f k8s/worker.yaml
kubectl apply -f k8s/ingress.yaml
```

`DATABASE_URL` is intentionally stored in the secret because it contains credentials and must stay aligned with `POSTGRES_PASSWORD`.

## Image

Build and push the app image, then replace `ollive-assignment:latest` in `app.yaml` with your registry reference.

## Tradeoffs

- The app deployment is intentionally set to one replica because request cancellation is tracked in memory.
- Postgres and Redis are deployed in-cluster to keep the self-hosted path complete and easy to evaluate.
- Ingestion processing runs in a separate worker deployment, while cancellation still remains single-replica until that state is externalized.
