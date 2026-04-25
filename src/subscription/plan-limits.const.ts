import { PlanTier } from '../entities/subscription-plan.entity';

export const PLAN_LIMITS: Record<PlanTier, { roomLimit: number; noteLimit: number; hasLectureSummary: boolean; hasFocusTracker: boolean }> = {
  [PlanTier.FREE]:  { roomLimit: 2,  noteLimit: 5,   hasLectureSummary: false, hasFocusTracker: false },
  [PlanTier.BASIC]: { roomLimit: 5,  noteLimit: 10,  hasLectureSummary: false, hasFocusTracker: false },
  [PlanTier.PRO]:   { roomLimit: 10, noteLimit: 20,  hasLectureSummary: true,  hasFocusTracker: true  },
  [PlanTier.MAX]:   { roomLimit: 50, noteLimit: -1,  hasLectureSummary: true,  hasFocusTracker: true  },
};
