// Judging setup. Each phase has its own criteria; every criterion column must exist in score_sheets (db.js).
// A criterion shared by both phases uses the same id and column.
// Phase weights decide how much each phase counts in the final total and must add up to 1.
const C = {
  innovation: { id: 'innovation', column: 'innovation', name: 'Innovation', max: 10 },
  ideaPresentation: { id: 'ideaPresentation', column: 'idea_presentation', name: 'Idea & presentation', max: 10 },
  businessImpact: { id: 'businessImpact', column: 'business_impact', name: 'Business impact', max: 10 },
  feasibility: { id: 'feasibility', column: 'feasibility', name: 'Technical feasibility', max: 10 },
  responsibleAi: { id: 'responsibleAi', column: 'responsible_ai', name: 'Responsible AI', max: 10 },
  presentation: { id: 'presentation', column: 'presentation', name: 'Presentation', max: 10 },
  execution: { id: 'execution', column: 'execution', name: 'Project execution', max: 10 },
};

module.exports = {
  PHASES: [
    { id: 'phase1', short: 'Phase 1', name: 'Phase 1, blind review', setting: 'phase1_open', weight: 0.2,
      criteria: [C.innovation, C.businessImpact, C.feasibility, C.responsibleAi, C.presentation] },
    { id: 'phase2', short: 'Phase 2', name: 'Phase 2, after the demo', setting: 'phase2_open', weight: 0.8,
      criteria: [C.ideaPresentation, C.businessImpact, C.feasibility, C.responsibleAi, C.execution] },
  ],
  SESSION_DAYS: 7,
  BCRYPT_ROUNDS: 12,
  MIN_PASSWORD: 8,
};
