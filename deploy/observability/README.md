# Carbon observability bundle

Ready-to-import Prometheus rules and Grafana dashboards for a Carbon-API
deployment. Everything here reads the `/metrics` endpoint the API already
exposes (Prometheus text format) and the OTLP export from `tracing.ts`.

## Layout

```
deploy/observability/
├── prometheus/
│   ├── carbon.rules.yml    # recording rules
│   └── carbon.alerts.yml   # alerts (extracted from DEPLOY.md)
└── grafana/
    ├── carbon-api-overview.json   # ~15-panel service dashboard
    └── carbon-tracing.json        # links to Jaeger/Tempo + span reference
```

## Prometheus

Copy both YAML files into the directory that prometheus.yml's `rule_files:`
globs — e.g. `/etc/prometheus/rules/`. Reload prometheus (`kill -HUP` or
`POST /-/reload`) and confirm they show up under Status → Rules.

```yaml
# prometheus.yml
rule_files:
  - /etc/prometheus/rules/carbon.rules.yml
  - /etc/prometheus/rules/carbon.alerts.yml

scrape_configs:
  - job_name: carbon-api
    metrics_path: /metrics
    static_configs:
      - targets: ['carbon-api:8080']
    # If CARBON_METRICS_TOKEN is set:
    # authorization:
    #   type: Bearer
    #   credentials: <token>
```

## Grafana

Two options.

**UI**: Dashboards → New → Import → upload the JSON file, pick your
Prometheus datasource for the `DS_PROMETHEUS` variable, Save.

**Script**: `scripts/observability/import-grafana.sh <grafana-host>` will
POST both dashboards using `$GRAFANA_TOKEN`.

The tracing dashboard is largely a hub of external links. Edit the two
`links[].url` values at the top of `carbon-tracing.json` to point at your
Jaeger install and Grafana Tempo datasource before importing.
