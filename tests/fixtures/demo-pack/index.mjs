// Smallest useful rule pack, for the adapter tests and as a template for pack authors.
// It reports one error when the caller names the target "demo".

/** @type {import('../../../src/contract.mjs').RulePack} */
export default {
  name: 'demo-pack',
  version: '1.0.0',
  targets: ['demo'],
  rules: [
    {
      id: 'RG-DEMO-TARGET',
      severity: 'error',
      summary: 'Demo: the target "demo" was requested.',
      check: ({ targets }) =>
        targets.includes('demo')
          ? [{
              message: 'Demo finding for target "demo".',
              evidence: { target: 'demo' },
              remediation: 'Nothing to fix; this rule exists for tests.',
            }]
          : [],
    },
  ],
};
