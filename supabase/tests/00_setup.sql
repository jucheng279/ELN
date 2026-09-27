-- 00_setup.sql: bootstrap pgTAP
BEGIN;
SELECT plan(1);
SELECT pass('pgTAP loaded');
SELECT * FROM finish();
ROLLBACK;
