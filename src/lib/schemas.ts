import { z } from "zod";
import { isValidZone } from "@/lib/time";
import { COURSE_COLORS } from "@/lib/view";

// Shared by settings forms and chat tools (update_preferences / update_habit).

const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM").transform((t) => t.slice(0, 5));

export const preferencesSchema = z
  .object({
    display_name: z.string().trim().max(40).transform((v) => v || null).nullable().optional(),
    timezone: z.string().refine(isValidZone, "Unknown timezone"),
    day_start: time,
    day_end: time,
    min_block_min: z.coerce.number().int().min(15).max(240),
    max_block_min: z.coerce.number().int().min(15).max(480),
    daily_work_cap_min: z.coerce.number().int().min(0).max(1440),
    due_buffer_hours: z.coerce.number().int().min(0).max(168),
    horizon_days: z.coerce.number().int().min(7).max(60),
  })
  .partial()
  .refine((p) => !p.day_start || !p.day_end || p.day_end > p.day_start, "Your day must end after it starts")
  .refine((p) => !p.min_block_min || !p.max_block_min || p.max_block_min >= p.min_block_min, "Longest block must be at least the shortest");

export type PreferencesInput = z.input<typeof preferencesSchema>;

export const habitSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    priority: z.coerce.number().int().min(1).max(99),
    min_min: z.coerce.number().int().min(5).max(600),
    target_min: z.coerce.number().int().min(5).max(600),
    window_start: time,
    window_end: time,
    days_of_week: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Pick at least one day"),
    start_date: z.iso.date(),
    end_date: z.iso.date().nullable().optional(),
    color: z.enum(COURSE_COLORS),
  })
  .refine((h) => h.target_min >= h.min_min, "Target can't be shorter than the minimum")
  .refine((h) => h.window_end > h.window_start, "Window must end after it starts")
  .refine((h) => !h.end_date || h.end_date >= h.start_date, "End date is before the start date");

export type HabitInput = z.input<typeof habitSchema>;
