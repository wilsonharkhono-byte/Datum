import { z } from "zod";

/**
 * The exhaustive list of staff roles in DATUM.
 * Shared by:
 *   - apps/web/lib/projects/staff-mutations.ts (createStaffWithPassword)
 *   - apps/web/app/api/staff/create/route.ts (future)
 *   - apps/mobile CreateStaffForm
 *
 * NOTE: createStaffWithPassword itself stays in web (it needs the service-role
 * admin client). Only the schema lives here so all surfaces share the same
 * validation and error messages.
 */
export const STAFF_ROLES = [
  "principal",
  "designer",
  "pic",
  "site_supervisor",
  "admin",
  "estimator",
] as const;

export type StaffRoleValue = (typeof STAFF_ROLES)[number];

/**
 * Input schema for creating a new staff account.
 * Used by the web server action and (future) /api/staff/create route.
 * Mobile uses this schema for client-side form validation before POSTing.
 */
export const CreateStaffInput = z.object({
  email:         z.string().email("Email tidak valid").max(120),
  fullName:      z.string().min(2, "Nama minimal 2 huruf").max(80),
  role:          z.enum(STAFF_ROLES),
  password:      z.string().min(8, "Password minimal 8 karakter").max(72),
  projectId:     z.string().uuid().optional(),
  roleOnProject: z.string().min(1).max(40).optional(),
  costVisible:   z.boolean().optional(),
});

export type CreateStaffInputType = z.infer<typeof CreateStaffInput>;
