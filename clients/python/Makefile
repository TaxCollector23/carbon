.PHONY: install test format lint codegen clean

# Prefer `uv` if available, fall back to plain pip.
PY ?= python3
HAS_UV := $(shell command -v uv 2>/dev/null)

install:
ifeq ($(HAS_UV),)
	$(PY) -m pip install -e ".[dev]"
else
	uv pip install -e ".[dev]"
endif

test:
ifeq ($(HAS_UV),)
	$(PY) -m pytest -q
else
	uv run pytest -q
endif

format:
ifeq ($(HAS_UV),)
	$(PY) -m black carbon_client tests scripts
	$(PY) -m ruff check --fix carbon_client tests scripts
else
	uv run black carbon_client tests scripts
	uv run ruff check --fix carbon_client tests scripts
endif

lint:
ifeq ($(HAS_UV),)
	$(PY) -m ruff check carbon_client tests scripts
	$(PY) -m black --check carbon_client tests scripts
else
	uv run ruff check carbon_client tests scripts
	uv run black --check carbon_client tests scripts
endif

# Regenerate carbon_client/generated.py from the committed OpenAPI snapshot.
codegen:
	$(PY) scripts/codegen.py ../../apps/dashboard/lib/openapi.snapshot.json > carbon_client/generated.py

clean:
	rm -rf build dist *.egg-info .pytest_cache .ruff_cache
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
