# Kubernetes Deployment

This folder provides a self-hosted deployment path for the assignment.

## Included Manifests

- `namespace.yaml`
- `configmap.yaml`
- `secret.example.yaml`
- `postgres.yaml`
- `app.yaml`
- `ingress.yaml`

## Apply Order

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.example.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/app.yaml
kubectl apply -f k8s/ingress.yaml
```

`DATABASE_URL` is intentionally stored in the secret because it contains credentials and must stay aligned with `POSTGRES_PASSWORD`.

## Image

Build and push the app image, then replace `ollive-assignment:latest` in `app.yaml` with your registry reference.

## Tradeoffs

- The app deployment is intentionally set to one replica because request cancellation is tracked in memory.
- Postgres is deployed in-cluster to keep the self-hosted path complete and easy to evaluate.
- For a production multi-replica setup, move cancellation state to shared infrastructure and separate event processing into a worker deployment.
