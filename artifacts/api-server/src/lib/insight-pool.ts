export type InsightCategory = 'opportunity' | 'risk' | 'connection' | 'question';

export interface InsightEntry {
  id: string;
  category: InsightCategory;
  text: string;
  triggers: string[];
}

export const INSIGHT_POOL: InsightEntry[] = [
  // ── Opportunity (15) ────────────────────────────────────────────────────────
  {
    id: 'op-1',
    category: 'opportunity',
    text: 'Budget pressure mentioned — pivot to ROI and total cost of ownership to reframe the conversation.',
    triggers: ['price', 'cost', 'budget', 'expensive', 'afford', 'investment', 'spend', 'pricing'],
  },
  {
    id: 'op-2',
    category: 'opportunity',
    text: 'They seem open to a higher tier — now is a good moment to introduce the premium plan benefits.',
    triggers: ['upgrade', 'premium', 'tier', 'plan', 'better version', 'enterprise'],
  },
  {
    id: 'op-3',
    category: 'opportunity',
    text: 'A follow-up workshop or onboarding session could deepen the relationship and demonstrate ongoing value.',
    triggers: ['workshop', 'training', 'onboarding', 'learn', 'educate', 'teach'],
  },
  {
    id: 'op-4',
    category: 'opportunity',
    text: 'Their pain point aligns perfectly with your core differentiator — make the connection explicit now.',
    triggers: ['problem', 'challenge', 'issue', 'pain', 'frustrat', 'struggle', 'difficult'],
  },
  {
    id: 'op-5',
    category: 'opportunity',
    text: 'They seem open to expanding scope — probe for additional use cases and adjacent needs.',
    triggers: ['expand', 'more', 'additional', 'also need', 'include', 'add', 'besides', 'what else'],
  },
  {
    id: 'op-6',
    category: 'opportunity',
    text: 'A competitor was just mentioned — strong moment to contrast your unique value and highlight a key differentiator.',
    triggers: ['competitor', 'alternative', 'other vendor', 'compar', 'instead', 'evaluat', 'shortlist'],
  },
  {
    id: 'op-7',
    category: 'opportunity',
    text: 'A deadline or quarter-end was mentioned — use the urgency to advance the deal and propose concrete next steps.',
    triggers: ['deadline', 'end of', 'quarter', 'Q1', 'Q2', 'Q3', 'Q4', 'month end', 'urgent', 'by when'],
  },
  {
    id: 'op-8',
    category: 'opportunity',
    text: 'A pilot or proof-of-concept offer could lower the commitment barrier significantly — propose one now.',
    triggers: ['pilot', 'trial', 'test', 'try it', 'proof of concept', 'POC', 'demo', 'evaluate first'],
  },
  {
    id: 'op-9',
    category: 'opportunity',
    text: 'Reframe this as ROI — anchor the conversation in measurable outcomes and quantified benefits.',
    triggers: ['roi', 'return on investment', 'value', 'benefit', 'worth it', 'justify', 'payback'],
  },
  {
    id: 'op-10',
    category: 'opportunity',
    text: 'Ask about their planning cycle — the timing may be perfect to get on the next budget.',
    triggers: ['planning', 'roadmap', 'next year', 'budget cycle', 'fiscal', 'H1', 'H2', 'annual plan'],
  },
  {
    id: 'op-11',
    category: 'opportunity',
    text: 'Strong positive signal — propose a clear next step while momentum is high.',
    triggers: ["let's do", 'move forward', 'proceed', 'sounds interesting', 'love that', 'perfect', 'exactly what'],
  },
  {
    id: 'op-12',
    category: 'opportunity',
    text: 'Broad team adoption was mentioned — position your onboarding support and change management resources.',
    triggers: ['whole team', 'everyone', 'entire org', 'company-wide', 'rollout', 'all our', 'across the'],
  },
  {
    id: 'op-13',
    category: 'opportunity',
    text: 'This use case closely matches a client success story — share it to build credibility and reduce risk.',
    triggers: ['similar', 'like us', 'case study', 'reference', 'example', 'other companies', 'customers like'],
  },
  {
    id: 'op-14',
    category: 'opportunity',
    text: 'Integration interest is a strong buying signal — highlight your ecosystem depth and available connectors.',
    triggers: ['integrat', 'connect', 'API', 'existing system', 'current tool', 'sync with', 'work with'],
  },
  {
    id: 'op-15',
    category: 'opportunity',
    text: 'The cost of inaction is real — quantify the status quo and make the opportunity cost tangible.',
    triggers: ['nothing', 'status quo', 'currently doing', 'manually', 'right now we', 'we just', "haven't solved"],
  },

  // ── Risk (15) ────────────────────────────────────────────────────────────────
  {
    id: 'ri-1',
    category: 'risk',
    text: 'Hesitation detected — surface the real objection before proceeding; vague uncertainty often hides a concrete concern.',
    triggers: ['not sure', 'hesit', 'maybe', 'unsure', 'thinking about it', 'not confident', 'not certain'],
  },
  {
    id: 'ri-2',
    category: 'risk',
    text: 'Vague agreement ahead — confirm specifics before moving on to avoid misalignment later.',
    triggers: ['sounds good', 'sure', 'okay I guess', 'fine', 'alright', 'I suppose', 'probably'],
  },
  {
    id: 'ri-3',
    category: 'risk',
    text: 'Topic drift detected — re-anchor to the core value proposition before the conversation loses focus.',
    triggers: ['anyway', 'by the way', 'speaking of', 'off topic', 'actually', 'different question', 'unrelated'],
  },
  {
    id: 'ri-4',
    category: 'risk',
    text: 'Multiple decision-makers mentioned — map the full buying committee before investing more time.',
    triggers: ['manager', 'boss', 'CEO', 'board', 'committee', 'approval', 'director', 'VP', 'executive'],
  },
  {
    id: 'ri-5',
    category: 'risk',
    text: 'Classic stall pattern — gently surface what\'s really blocking a decision with a direct open question.',
    triggers: ['think about it', 'consider it', 'revisit', 'come back to', 'let me check', 'circle back', 'get back to'],
  },
  {
    id: 'ri-6',
    category: 'risk',
    text: 'Budget authority is unclear — validate who approves spend before investing further time in the deal.',
    triggers: ['sign off', 'budget approval', 'finance team', 'CFO', 'financial controller', 'approve the'],
  },
  {
    id: 'ri-7',
    category: 'risk',
    text: 'Timeline mismatch — understand whether this is a real delay or a soft no before proposing a workaround.',
    triggers: ['not now', 'later this year', 'next quarter', 'not a priority', 'wait and see', 'hold off'],
  },
  {
    id: 'ri-8',
    category: 'risk',
    text: 'Competitive evaluation likely in progress — differentiate on your unique strengths and clarify your moat.',
    triggers: ['evaluating', 'shortlist', 'RFP', 'other options', 'vendor comparison', 'looking at others'],
  },
  {
    id: 'ri-9',
    category: 'risk',
    text: 'Integration complexity raised — offer to loop in your technical team to address concerns directly.',
    triggers: ['complex', 'complicated', 'technical hurdle', 'IT team', 'technical debt', 'difficult to integrate'],
  },
  {
    id: 'ri-10',
    category: 'risk',
    text: 'Legal or compliance concern surfaced — flag internally before making commitments; escalate if needed.',
    triggers: ['legal', 'compliance', 'GDPR', 'security review', 'contract terms', 'lawyers', 'regulatory'],
  },
  {
    id: 'ri-11',
    category: 'risk',
    text: 'A concern or worry was raised — address it head-on now before it becomes a silent blocker.',
    triggers: ['concern', 'worried', 'risky', 'downside', 'what if something', 'nervous about'],
  },
  {
    id: 'ri-12',
    category: 'risk',
    text: 'Price objection surfaced — explore what value benchmark they\'re comparing against before defending the number.',
    triggers: ['too expensive', 'costs too much', 'over budget', 'that\'s a lot', 'can we get a discount', 'lower the price'],
  },
  {
    id: 'ri-13',
    category: 'risk',
    text: 'Long-term commitment hesitancy — consider proposing a shorter pilot period or flexible exit clause.',
    triggers: ['locked in', 'long-term contract', 'annual commitment', 'multi-year', 'cancel anytime', 'no contract'],
  },
  {
    id: 'ri-14',
    category: 'risk',
    text: 'Scope ambiguity — anchor on concrete deliverables and outcomes before agreeing to move forward.',
    triggers: ['not sure what', 'unclear scope', 'it depends on', 'depends on the', 'vague about'],
  },
  {
    id: 'ri-15',
    category: 'risk',
    text: 'Timing objection — clarify whether this is a genuine constraint or a soft no masking a deeper concern.',
    triggers: ['bad time', 'very busy', 'peak season', 'holiday period', 'end of year rush', 'overwhelmed right now'],
  },

  // ── Connection (15) ──────────────────────────────────────────────────────────
  {
    id: 'cn-1',
    category: 'connection',
    text: 'This directly ties back to something raised earlier — connect the dots to reinforce your narrative.',
    triggers: ['earlier', 'before', 'you mentioned', 'you said', 'back to what', 'as I mentioned', 'we discussed'],
  },
  {
    id: 'cn-2',
    category: 'connection',
    text: 'Their stated goal aligns directly with what you described — make the link explicit to strengthen positioning.',
    triggers: ['goal', 'target', 'objective', 'want to achieve', 'aiming for', 'our aim', 'mission'],
  },
  {
    id: 'cn-3',
    category: 'connection',
    text: 'The team structure they described mirrors the reporting challenge from earlier — link them now.',
    triggers: ['team structure', 'org chart', 'reports to', 'hierarchy', 'management layer', 'spans of control'],
  },
  {
    id: 'cn-4',
    category: 'connection',
    text: 'This recurring theme suggests a systemic issue — address it at the root level, not symptom-by-symptom.',
    triggers: ['same issue', 'keeps coming up', 'again and again', 'recurring', 'reoccurring', 'this pattern'],
  },
  {
    id: 'cn-5',
    category: 'connection',
    text: 'Circle back to the ROI example from earlier — they showed real interest there and it reinforces the case.',
    triggers: ['ROI', 'return you mentioned', 'numbers you shared', 'example earlier', 'that case study'],
  },
  {
    id: 'cn-6',
    category: 'connection',
    text: 'Their workflow gap is precisely the problem your product solves — name the connection explicitly.',
    triggers: ['workflow', 'process gap', 'bottleneck', 'manual step', 'inefficient', 'wastes time'],
  },
  {
    id: 'cn-7',
    category: 'connection',
    text: 'The use case just described is a textbook match for your solution — confirm the fit and move to next steps.',
    triggers: ['use case', 'scenario like', 'situation where', 'exactly what', 'fits perfectly', 'that is what'],
  },
  {
    id: 'cn-8',
    category: 'connection',
    text: 'This mirrors an objection you\'ve handled successfully before — leverage that proven response now.',
    triggers: ['similar objection', 'heard before', 'same concern', 'same pushback', 'every client asks'],
  },
  {
    id: 'cn-9',
    category: 'connection',
    text: 'Link this to the success metric they defined at the start — keep the conversation anchored to their stated outcome.',
    triggers: ['measure success', 'KPI', 'key metric', 'how we\'ll know', 'success criteria', 'benchmark'],
  },
  {
    id: 'cn-10',
    category: 'connection',
    text: 'Their decision criteria align with your core strengths — make that mapping visible and explicit.',
    triggers: ['criteria', 'requirement', 'must have', 'need to have', 'non-negotiable', 'key factor'],
  },
  {
    id: 'cn-11',
    category: 'connection',
    text: 'This pain point has now come up multiple times — it\'s clearly the core issue; build your close around it.',
    triggers: ['twice', 'three times', 'keeps coming back', 'mentioned again', 'brought up again', 'another time'],
  },
  {
    id: 'cn-12',
    category: 'connection',
    text: 'They committed to this earlier — reference that agreement to build consistency and momentum.',
    triggers: ['you agreed', 'we established', 'you committed', 'you said yes', 'we both said', 'you confirmed'],
  },
  {
    id: 'cn-13',
    category: 'connection',
    text: 'This connects to the strategic priority they mentioned upfront — reinforce the executive alignment.',
    triggers: ['strategy', 'strategic initiative', 'top priority', 'company vision', 'CEO said', 'company direction'],
  },
  {
    id: 'cn-14',
    category: 'connection',
    text: 'The budget constraint mentioned ties directly to the ROI case — this is the moment to resolve the tension.',
    triggers: ['tight budget', 'limited funds', 'cost constraint', 'financial situation', 'budget pressure'],
  },
  {
    id: 'cn-15',
    category: 'connection',
    text: 'The deadline they mentioned reinforces the urgency established at the start — reference it to accelerate.',
    triggers: ['the deadline', 'by that date', 'that timeline', 'date you gave', 'end date', 'launch date'],
  },

  // ── Question (15) ────────────────────────────────────────────────────────────
  {
    id: 'qu-1',
    category: 'question',
    text: 'Worth asking now: who else needs to be involved in or sign off on the final decision?',
    triggers: ['who decides', 'decision maker', 'sign off', 'approver', 'who approves', 'buying decision'],
  },
  {
    id: 'qu-2',
    category: 'question',
    text: 'Have you confirmed what success looks like for them in concrete terms — a specific metric or outcome in 90 days?',
    triggers: ['success', 'outcome', 'desired result', 'what good looks', 'what done looks', 'measure progress'],
  },
  {
    id: 'qu-3',
    category: 'question',
    text: 'Ask: what does their current end-to-end process look like today — step by step?',
    triggers: ['current process', 'how do you today', 'existing workflow', 'what do you do now', 'current state'],
  },
  {
    id: 'qu-4',
    category: 'question',
    text: 'Probe: what has stopped them from solving this problem before — previous attempts, failed solutions?',
    triggers: ['tried before', 'attempted to', 'previously tried', 'last time you tried', 'done this before'],
  },
  {
    id: 'qu-5',
    category: 'question',
    text: 'Ask: is there a preferred vendor, existing relationship, or internal tool already in place for this?',
    triggers: ['existing vendor', 'current provider', 'already use', 'partner we have', 'internal tool', 'already bought'],
  },
  {
    id: 'qu-6',
    category: 'question',
    text: 'Ask directly: what would need to be true for them to feel confident moving forward right now?',
    triggers: ['feel confident', 'feel comfortable', 'feel good about', 'ready to commit', 'what would help', 'trust the'],
  },
  {
    id: 'qu-7',
    category: 'question',
    text: 'Clarify: is the timeline they mentioned driven by an external event or an internal planning decision?',
    triggers: ['timeline driven', 'date because', 'by that deadline', 'why that date', 'that deadline is'],
  },
  {
    id: 'qu-8',
    category: 'question',
    text: 'Ask: how are they currently quantifying the cost of this problem — in time, revenue, or headcount?',
    triggers: ['cost of the problem', 'how much it costs', 'hours spent', 'resources wasted', 'inefficiency costs'],
  },
  {
    id: 'qu-9',
    category: 'question',
    text: 'Explore: what does their internal adoption and change management process look like for new tools?',
    triggers: ['roll this out', 'adoption process', 'change management', 'get everyone using', 'training plan'],
  },
  {
    id: 'qu-10',
    category: 'question',
    text: 'Ask: what would need to be true to make this a top priority this quarter versus next?',
    triggers: ['why now', 'priority this quarter', 'why this year', 'what changed', 'urgency driver'],
  },
  {
    id: 'qu-11',
    category: 'question',
    text: 'Knowledge gap detected — ask a direct discovery question to fill what\'s unclear before proceeding.',
    triggers: ["don't know", "not sure about", "need to find out", "I'll check", "unclear to me", "need to verify"],
  },
  {
    id: 'qu-12',
    category: 'question',
    text: 'The underlying "why" hasn\'t been surfaced yet — ask what\'s driving this initiative at a personal and business level.',
    triggers: ['why is this', 'reason for this', 'motivation behind', 'what triggered', 'why now specifically'],
  },
  {
    id: 'qu-13',
    category: 'question',
    text: 'Ask: is the whole team aligned on this need, or are there internal debates you should be aware of?',
    triggers: ['internal debate', 'not everyone agrees', 'some pushback', 'alignment issue', 'divided on this'],
  },
  {
    id: 'qu-14',
    category: 'question',
    text: 'Ask: what criteria will they use to evaluate options — and which matters most to them?',
    triggers: ['how will you evaluate', 'criteria for choosing', 'what matters most', 'how to assess', 'selection criteria'],
  },
  {
    id: 'qu-15',
    category: 'question',
    text: 'Define a concrete next step before the call ends — a specific date, action, or deliverable.',
    triggers: ['next step', 'follow up', 'what happens next', 'action item', 'who does what', 'after this call'],
  },
];

/** Score an insight entry against recent transcript text (higher = more relevant) */
export function scoreEntry(entry: InsightEntry, recentText: string): number {
  const lower = recentText.toLowerCase();
  let score = 0;
  for (const trigger of entry.triggers) {
    if (lower.includes(trigger.toLowerCase())) score++;
  }
  return score;
}

/**
 * Pick the highest-scoring unseen insight.
 * Returns null if no entry scores above 0 (better silence than noise).
 */
export function pickScoredInsight(
  recentText: string,
  shownIds: Set<string>
): InsightEntry | null {
  const candidates = INSIGHT_POOL.filter((e) => !shownIds.has(e.id));
  const pool = candidates.length > 0 ? candidates : INSIGHT_POOL; // reset when all shown

  const scored = pool.map((e) => ({ entry: e, score: scoreEntry(e, recentText) }));
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score === 0) return null;
  return best.entry;
}
