export const roles = ["super_admin", "faculty", "student", "hod"] as const;

export type Role = (typeof roles)[number];

export type RoleAssignment = {
  role: Role;
  department_id: string | null;
  departments: { name: string } | null;
};

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
};
