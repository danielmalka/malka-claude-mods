// Question wording sent to the decision model (English, one place). Wording from the 2026-10-14 probe.
export const MODELS = {
  haiku: 'Claude Haiku: fastest and cheapest. Fits mechanical, well-specified edits in one place (rename, typo, small config change, a quick lookup).',
  sonnet: 'Claude Sonnet: balanced. Fits routine feature work, bug fixes with a clear cause, writing tests, refactors inside one module.',
  opus: 'Claude Opus: strongest and most expensive. Fits ambiguous or high-stakes work: architecture across many components, hard concurrency or distributed bugs, security-sensitive design.',
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

const EFFORT_CRITERIA = [
  'low: the answer is obvious once the right file is open',
  'medium: a few steps of reasoning, one area of the code',
  'high: several interacting parts must be understood before acting',
  'xhigh: deep investigation with many hypotheses or a long multi-step plan',
  'max: open research problem where every extra step of thinking pays off',
]

export const QUESTIONS = {
  model: {
    type: 'choice',
    instructions: 'Which Claude model best fits the coding task in `prompt`, balancing quality and cost?',
    criteria: MODELS,
  },
  effort: {
    type: 'score',
    instructions: 'How much reasoning effort does the coding task in `prompt` need?',
    criteria: EFFORT_CRITERIA,
  },
}
