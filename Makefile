.PHONY: help setup dev dev-api dev-worker dev-web build lint format test test-e2e db-migrate db-generate reset infra-up infra-down

help:
	@echo "Available targets:"
	@echo "  setup       Install deps + start infra + migrate DB"
	@echo "  dev         Start api, worker, and web concurrently"
	@echo "  dev-api     Start api server only"
	@echo "  dev-worker  Start BullMQ worker only"
	@echo "  dev-web     Start web only"
	@echo "  build       Build all packages"
	@echo "  lint        Lint all packages"
	@echo "  format      Format all packages"
	@echo "  test        Run unit tests
  test-e2e    Run E2E tests (requires infra running)"
	@echo "  db-migrate  Run database migrations"
	@echo "  db-generate Generate migrations from schema"
	@echo "  reset       Wipe infra volumes + reinstall + migrate"
	@echo "  infra-up    Start postgres + redis"
	@echo "  infra-down  Stop postgres + redis"

setup:
	cp -n .env.example .env 2>/dev/null || true
	pnpm install
	$(MAKE) infra-up
	@echo "Waiting for postgres..."
	@until docker compose exec -T postgres pg_isready -U sms 2>/dev/null; do sleep 1; done
	$(MAKE) db-migrate

dev:
	pnpm dev

dev-api:
	pnpm dev:api

dev-worker:
	pnpm dev:worker

dev-web:
	pnpm dev:web

build:
	pnpm build

lint:
	pnpm lint

format:
	pnpm format

test:
	pnpm test

test-e2e:
	$(MAKE) infra-up
	@echo "Waiting for postgres..."
	@until docker compose exec -T postgres pg_isready -U sms 2>/dev/null; do sleep 1; done
	$(MAKE) db-migrate
	pnpm --filter @sms/api test:e2e

db-migrate:
	pnpm db:migrate

db-generate:
	pnpm db:generate

infra-up:
	docker compose up -d

infra-down:
	docker compose down

reset:
	docker compose down -v
	pnpm install
	$(MAKE) infra-up
	@echo "Waiting for postgres..."
	@until docker compose exec -T postgres pg_isready -U sms 2>/dev/null; do sleep 1; done
	$(MAKE) db-migrate
