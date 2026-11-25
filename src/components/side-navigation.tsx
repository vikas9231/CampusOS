"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, BookOpen, CalendarDays, ChartNoAxesCombined, ClipboardCheck, FileText, GraduationCap, LayoutDashboard, Megaphone, Settings, Users, Wallet } from "lucide-react";

const icons = { dashboard: LayoutDashboard, people: Users, academics: BookOpen, reports: ChartNoAxesCombined, notices: Megaphone, settings: Settings, attendance: ClipboardCheck, timetable: CalendarDays, assignments: FileText, courses: BookOpen, fees: Wallet, students: GraduationCap, faculty: Users, assistant: Bot };
type IconName = keyof typeof icons;

export function SideNavigation({ links }: { links: { label: string; href: string; icon: string }[] }) {
  const pathname = usePathname();
  return <nav className="side-nav">{links.map(({ label, href, icon }) => {
    const Icon = icons[icon as IconName] || LayoutDashboard;
    const active = pathname === href || (href !== "/admin" && href !== "/faculty" && href !== "/student" && href !== "/hod" && pathname.startsWith(`${href}/`));
    return <Link key={href} className={`nav-item ${active ? "active" : ""}`} href={href}><Icon size={18} /><span>{label}</span></Link>;
  })}</nav>;
}
