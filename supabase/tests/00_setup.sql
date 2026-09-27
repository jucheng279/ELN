-- =============================================================
-- 00_setup.sql — pgTAP extension bootstrap (no fixture data)
-- =============================================================
-- This file only ensures the pgtap extension is available.
-- Each test file creates its own fixtures within its transaction.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(1);
SELECT pass('pgTAP extension loaded');
SELECT * FROM finish();
ROLLBACK;
