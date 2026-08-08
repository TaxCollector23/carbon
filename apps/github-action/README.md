# @carbon/github-action

Spin up a Carbon replica of your API on every pull request and post the URL as a comment.

## Usage

```yaml
name: PR replica
on:
  pull_request:
jobs:
  replica:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: carbon-dev/github-action@v0
        with:
          spec-path: ./openapi.yaml
          upstream-url: https://api.example.com
```

## Inputs

| Name          | Required | Description                                             |
|---------------|----------|---------------------------------------------------------|
| `spec-path`   | yes      | Path to the OpenAPI, Postman, or HAR spec.              |
| `upstream-url`| no       | Optional upstream to proxy on cache miss.               |
| `api-key`     | no       | Carbon Cloud API key (only for hosted control plane).   |

## Outputs

| Name          | Description                                             |
|---------------|---------------------------------------------------------|
| `replica-url` | Ephemeral URL of the running Carbon replica.            |
