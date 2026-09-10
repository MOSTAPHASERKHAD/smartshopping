-- ============================================================
-- Smart Shopping - Cloudflare D1 Migration 0008
-- Managed Services Governance Table (tenant_service_configs)
-- Non-destructive, Zero-Data-Loss, Backward Compatible
-- ============================================================

CREATE TABLE IF NOT EXISTS tenant_service_configs (
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_key TEXT NOT NULL,
    mode        TEXT NOT NULL CHECK(mode IN ('own', 'managed', 'disabled')) DEFAULT 'own',
    config_json TEXT DEFAULT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (tenant_id, service_key),
    CHECK (tenant_id != 'tenant_master_default' OR mode = 'own')
);
