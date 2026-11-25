"use client";

import { useActionState } from "react";
import { updateProfile, type ProfileActionState } from "@/app/actions/profile";

const initialState: ProfileActionState = {};

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState(updateProfile, initialState);
  return <form action={action} className="profile-form"><label>Full name<input name="full_name" defaultValue={name} minLength={2} maxLength={100} required /></label><label>Email address<input value={email} disabled readOnly /></label>{state.error && <p className="notice error" role="alert">{state.error}</p>}{state.success && <p className="notice success" role="status">{state.success}</p>}<button className="button primary" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button></form>;
}
