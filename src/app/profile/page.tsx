import Link from "next/link";
import { ArrowLeft, GraduationCap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { ProfileForm } from "@/components/profile-form";
import { signOut } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { profile } = await requireUser();
  return <main className="profile-page"><header className="profile-top"><Link href="/" className="brand"><span className="brand-mark"><GraduationCap size={22} /></span><span>Campus<span className="brand-light">OS</span></span></Link><form action={signOut}><button className="text-button" type="submit">Sign out</button></form></header><section className="profile-wrap"><Link href="/dashboard" className="back-link"><ArrowLeft size={16} /> Back to workspace</Link><p className="eyebrow">ACCOUNT SETTINGS</p><h1>Your profile</h1><p className="page-subtitle">Keep your account details up to date.</p><div className="profile-card"><div className="profile-card-heading"><span className="user-avatar large">{profile.full_name.trim().charAt(0).toUpperCase() || "U"}</span><div><h2>Personal details</h2><p>Changes are saved to your college account.</p></div></div><ProfileForm name={profile.full_name} email={profile.email} /></div></section></main>;
}
