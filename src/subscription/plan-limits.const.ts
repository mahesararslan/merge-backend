import { PlanTier } from '../entities/subscription-plan.entity';

export interface PlanLimits {
  /** Number of rooms a user can create. -1 = unlimited. */
  roomLimit: number;
  /** Number of personal notes a user can create. -1 = unlimited. */
  noteLimit: number;
  /** Per-room cap on student members for rooms owned by a user on this tier. -1 = unlimited. */
  studentsPerRoom: number;
  hasLectureSummary: boolean;
  hasFocusTracker: boolean;
  hasAiAssistant: boolean;
  hasQaBot: boolean;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  // ── Student tiers ──────────────────────────────────────────────────────────
  [PlanTier.STUDENT_FREE]: {
    roomLimit: 0, noteLimit: 5, studentsPerRoom: 0,
    hasLectureSummary: false, hasFocusTracker: false, hasAiAssistant: false, hasQaBot: false,
  },
  [PlanTier.STUDENT_PLUS]: {
    roomLimit: 0, noteLimit: -1, studentsPerRoom: 0,
    hasLectureSummary: false, hasFocusTracker: true, hasAiAssistant: true, hasQaBot: false,
  },

  // ── Instructor tiers ───────────────────────────────────────────────────────
  [PlanTier.INSTRUCTOR_STARTER]: {
    roomLimit: 2, noteLimit: 10, studentsPerRoom: 20,
    hasLectureSummary: false, hasFocusTracker: false, hasAiAssistant: false, hasQaBot: false,
  },
  [PlanTier.INSTRUCTOR_EDUCATOR]: {
    roomLimit: 10, noteLimit: -1, studentsPerRoom: 100,
    hasLectureSummary: true, hasFocusTracker: false, hasAiAssistant: true, hasQaBot: false,
  },
  [PlanTier.INSTRUCTOR_PRO]: {
    roomLimit: -1, noteLimit: -1, studentsPerRoom: -1,
    hasLectureSummary: true, hasFocusTracker: false, hasAiAssistant: true, hasQaBot: true,
  },

  // ── Legacy tiers (existing users still on these values) ───────────────────
  [PlanTier.FREE]: {
    roomLimit: 2, noteLimit: 5, studentsPerRoom: 20,
    hasLectureSummary: false, hasFocusTracker: false, hasAiAssistant: false, hasQaBot: false,
  },
  [PlanTier.BASIC]: {
    roomLimit: 5, noteLimit: 10, studentsPerRoom: 50,
    hasLectureSummary: false, hasFocusTracker: true, hasAiAssistant: true, hasQaBot: false,
  },
  [PlanTier.PRO]: {
    roomLimit: 10, noteLimit: 20, studentsPerRoom: 100,
    hasLectureSummary: true, hasFocusTracker: true, hasAiAssistant: true, hasQaBot: false,
  },
  [PlanTier.MAX]: {
    roomLimit: -1, noteLimit: -1, studentsPerRoom: -1,
    hasLectureSummary: true, hasFocusTracker: true, hasAiAssistant: true, hasQaBot: true,
  },
};

/** Resolves plan limits for any tier value, falling back to free if unknown. */
export function getPlanLimits(tier: PlanTier | string | null | undefined): PlanLimits {
  if (!tier) return PLAN_LIMITS[PlanTier.FREE];
  return PLAN_LIMITS[tier as PlanTier] ?? PLAN_LIMITS[PlanTier.FREE];
}
