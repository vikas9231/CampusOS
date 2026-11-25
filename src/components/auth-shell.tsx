import { GraduationCap, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function AuthShell({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  return <main className="auth-layout"><section className="auth-aside"><Link href="/" className="brand"><span className="brand-mark"><GraduationCap size={23} /></span><span>Campus<span className="brand-light">OS</span></span></Link><div className="aside-copy"><div className="aside-icon"><Sparkles size={20} /></div><p className="eyebrow">ONE CAMPUS. ONE WORKSPACE.</p><h2>Everything academic, connected.</h2><p>Sign in to your college workspace for a clearer view of teaching, learning, and campus operations.</p></div><div className="aside-foot"><ShieldCheck size={16} /> Secure access for your college community</div></section><section className="auth-main"><div className="mobile-brand"><Link href="/" className="brand"><span className="brand-mark"><GraduationCap size={22} /></span><span>Campus<span className="brand-light">OS</span></span></Link></div>{!configured && <p className="notice error setup-banner" role="status">Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and add your project URL and anon key.</p>}{children}<p className="legal">By continuing, you agree to follow your institution's acceptable use and privacy policies.</p></section></main>;
}
