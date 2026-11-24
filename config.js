// Judging setup. Changing criteria here also needs matching columns in db.js.
module.exports = {
  CRITERIA: [
    { id: 'innovation', column: 'innovation', name: 'Innovation', max: 10 },
    { id: 'feasibility', column: 'feasibility', name: 'Feasibility', max: 10 },
    { id: 'businessImpact', column: 'business_impact', name: 'Business impact', max: 10 },
    { id: 'execution', column: 'execution', name: 'Execution', max: 10 },
    { id: 'presentation', column: 'presentation', name: 'Presentation', max: 10 },
  ],
  PHASES: [
    { id: 'phase1', short: 'Phase 1', name: 'Phase 1, blind review', setting: 'phase1_open' },
    { id: 'phase2', short: 'Phase 2', name: 'Phase 2, after the demo', setting: 'phase2_open' },
  ],
  SESSION_DAYS: 7,
  BCRYPT_ROUNDS: 12,
  MIN_PASSWORD: 8,
};
