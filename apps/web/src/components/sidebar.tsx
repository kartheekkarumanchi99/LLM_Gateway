'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bell,
  ChevronsUpDown,
  CircleUser,
  CreditCard,
  Eye,
  FileText,
  FlaskConical,
  GitPullRequestArrow,
  History,
  KeyRound,
  KeySquare,
  LayoutDashboard,
  Lock,
  Radar,
  Radio,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { UserMenu } from '@/components/user-menu';

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

const HOME: NavItem[] = [
  { label: 'Overview', href: '/overview', icon: LayoutDashboard },
  { label: 'API Keys', href: '/api-keys', icon: KeyRound },
  { label: 'Files', href: '/files', icon: FileText, badge: 'Beta' },
  { label: 'Guardrails', href: '/guardrails', icon: ShieldCheck },
  { label: 'BYOK', href: '/byok', icon: KeySquare },
  { label: 'Routing', href: '/routing', icon: Route },
  { label: 'Predictive', href: '/predictive', icon: Zap, badge: 'Beta' },
  { label: 'Reliability', href: '/status', icon: Radio, badge: 'New' },
  { label: 'Sentinel', href: '/sentinel', icon: Radar, badge: 'New' },
  { label: 'Presets', href: '/presets', icon: SlidersHorizontal },
  { label: 'Optimizer', href: '/optimize', icon: FlaskConical, badge: 'New' },
  { label: 'Evals (CI)', href: '/evals', icon: GitPullRequestArrow, badge: 'New' },
  { label: 'Time Machine', href: '/traces', icon: History, badge: 'New' },
  { label: 'Tools', href: '/tools', icon: Wrench },
  { label: 'Observability', href: '/observability', icon: Eye },
  { label: 'Classifiers', href: '/classifiers', icon: Tag, badge: 'Beta' },
  { label: 'Settings', href: '/settings', icon: Settings },
];

const ACCOUNT: NavItem[] = [
  { label: 'Profile', href: '/profile', icon: CircleUser },
  { label: 'Activity', href: '/activity', icon: BarChart3 },
  { label: 'Logs', href: '/logs', icon: ScrollText },
  { label: 'Credits', href: '/credits', icon: CreditCard },
  { label: 'Management Keys', href: '/management-keys', icon: Lock },
  { label: 'Notifications', href: '/notifications', icon: Bell },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={
        'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm ' +
        (active
          ? 'bg-gray-100 font-medium text-gray-900'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900')
      }
    >
      <Icon className="h-4 w-4 shrink-0 text-gray-400" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar({
  accountEmail,
  workspaceName,
}: {
  accountEmail?: string | null;
  workspaceName?: string | null;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="p-3">
        <Link
          href="/overview"
          className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
        >
          <span className="grid h-5 w-5 place-items-center rounded bg-gray-100 text-[11px] text-gray-500">
            W
          </span>
          <span className="flex-1 truncate">{workspaceName ?? 'Default Workspace'}</span>
          <ChevronsUpDown className="h-4 w-4 text-gray-400" />
        </Link>
      </div>

      <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2 pb-8">
        {HOME.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}

        <div className="px-3 pb-1 pt-6 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Account
        </div>
        {ACCOUNT.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </nav>

      {accountEmail ? (
        <div className="border-t border-gray-200 p-3">
          <UserMenu email={accountEmail} />
        </div>
      ) : null}
    </aside>
  );
}
