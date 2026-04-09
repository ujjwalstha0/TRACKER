export type ExecutionDecisionSide = 'BUY' | 'SELL';
export type ExecutionDecisionOutcome =
  | 'PENDING'
  | 'CORRECT'
  | 'PARTIAL'
  | 'WRONG'
  | 'SKIPPED';

export interface ExecutionDecisionEntryDto {
  id: number;
  tradeDate: string;
  side: ExecutionDecisionSide;
  symbol: string;
  reason: string;
  plan: string | null;
  confidence: number;
  outcome: ExecutionDecisionOutcome;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
