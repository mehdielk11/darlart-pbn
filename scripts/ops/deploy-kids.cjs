/** The combined Kids deployment is retired. Do not reapply independent-owner guards. */
console.error('The old combined Kids deployment is retired. No changes were made.');
console.error('Build with npm run build:workflows, prepare credential-bound imports with scripts/ops/prepare-shared-imports.cjs, then follow automation/SHARED-KIDS-ROLLOUT.md.');
process.exitCode = 1;
