'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ChevronDown, ChevronRight, TrendingDown, Wallet, XCircle } from 'lucide-react';
import type { NotifItem, NotifSettings } from '@/lib/notifications';
import { markNotificationsRead, saveNotificationSettings } from '@/lib/notification-actions';
import { Toggle } from '@/components/toggle';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string): string {
  const d = new Date(iso);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes().toString().padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${h}:${m} ${ap} UTC`;
}

export function NotificationsView({
  settings,
  items,
  userEmail,
  connected,
}: {
  settings: NotifSettings;
  items: NotifItem[];
  userEmail: string;
  connected: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [threshold, setThreshold] = useState(settings.lowBalanceThresholdUsd);
  const [email, setEmail] = useState(settings.notifyEmail ?? userEmail);
  const [saved, setSaved] = useState(false);

  const email0 = settings.notifyEmail ?? userEmail;
  const unread = items.filter((i) => !i.read).length;

  function save(patch: Partial<NotifSettings>) {
    start(async () => {
      await saveNotificationSettings(patch);
      router.refresh();
    });
  }
  function saveLowBalance() {
    start(async () => {
      const res = await saveNotificationSettings({ lowBalanceThresholdUsd: threshold, notifyEmail: email });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
        router.refresh();
      }
    });
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">Notifications</h1>
      <p className="mt-1 text-sm text-gray-500">Choose which events notify you and how they&apos;re delivered.</p>

      {!connected ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not connected to a database yet. Set <code className="font-mono">DATABASE_URL</code> and run{' '}
          <code className="font-mono">pnpm db:push</code>.
        </div>
      ) : null}

      {/* Budget & Spend */}
      <Group icon={<Wallet className="h-4 w-4" />} title="Budget & Spend" desc="Stay ahead of credit burn.">
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gray-100 text-gray-500">
              <Wallet className="h-4 w-4" />
            </span>
            <div className="flex-1">
              <div className="font-medium text-gray-900">Low balance alert</div>
              <div className="text-sm text-gray-500">
                Below ${Number(settings.lowBalanceThresholdUsd).toFixed(0)} · Email → {email0 || '—'}
              </div>
            </div>
            <Toggle
              on={settings.lowBalanceEnabled}
              onChange={(v) => save({ lowBalanceEnabled: v })}
              disabled={!connected}
            />
            <button
              onClick={() => setExpanded((e) => !e)}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Configure"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
          {expanded ? (
            <div className="border-t border-gray-100 px-4 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Threshold (USD)</label>
                  <input
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    inputMode="decimal"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Notify email</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                {saved ? <span className="text-xs text-green-600">Saved.</span> : null}
                <button
                  onClick={saveLowBalance}
                  disabled={!connected}
                  className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  Save
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </Group>

      {/* Models */}
      <Group icon={<XCircle className="h-4 w-4" />} title="Models" desc="Keep your integrations current when models change or drop in price.">
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          <Row
            icon={<XCircle className="h-4 w-4" />}
            title="Model deprecation alert"
            subtitle={`Email → ${email0 || 'You'}`}
            on={settings.modelDeprecationEnabled}
            onChange={(v) => save({ modelDeprecationEnabled: v })}
            disabled={!connected}
          />
          <Row
            icon={<TrendingDown className="h-4 w-4" />}
            title="Model price drop alert"
            subtitle={`Email → ${email0 || 'You'}`}
            on={settings.modelPriceDropEnabled}
            onChange={(v) => save({ modelPriceDropEnabled: v })}
            disabled={!connected}
          />
        </div>
      </Group>

      {/* Delivery destinations */}
      <Group icon={<Building2 className="h-4 w-4" />} title="Delivery destinations" desc="Route alerts to Slack or your own webhook endpoint, and add budget alerts for each workspace.">
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-4">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gray-100 text-gray-500">
            <Building2 className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Enterprise</div>
            <div className="text-sm text-gray-600">
              Slack and custom webhook delivery are available on the enterprise plan.
            </div>
          </div>
          <span className="text-sm text-gray-300">Unavailable</span>
        </div>
      </Group>

      {/* Recent alerts feed */}
      <Group icon={null} title="Recent alerts" desc="Alerts generated by the gateway from your rules.">
        <div className="rounded-xl border border-gray-200 bg-white">
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-400">No alerts yet.</div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
                <span className="text-xs text-gray-500">
                  {items.length} alert{items.length === 1 ? '' : 's'}
                  {unread ? ` · ${unread} unread` : ''}
                </span>
                {unread > 0 ? (
                  <button
                    onClick={() => start(async () => { await markNotificationsRead(); router.refresh(); })}
                    className="text-xs font-medium text-violet-600 hover:text-violet-700"
                  >
                    Mark all read
                  </button>
                ) : null}
              </div>
              <div className="divide-y divide-gray-100">
                {items.map((n) => (
                  <div key={n.id} className="flex items-start gap-3 px-4 py-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-gray-200' : 'bg-violet-500'}`} />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">{n.title}</div>
                      {n.body ? <div className="text-sm text-gray-500">{n.body}</div> : null}
                    </div>
                    <span className="shrink-0 text-xs text-gray-400">{fmtDate(n.createdAt)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </Group>
    </div>
  );
}

function Group({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
      <div>
        <div className="flex items-center gap-2 font-medium text-gray-900">
          {icon}
          {title}
        </div>
        <p className="mt-1 text-sm text-gray-500">{desc}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}

function Row({
  icon,
  title,
  subtitle,
  on,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gray-100 text-gray-500">{icon}</span>
      <div className="flex-1">
        <div className="font-medium text-gray-900">{title}</div>
        <div className="text-sm text-gray-500">{subtitle}</div>
      </div>
      <Toggle on={on} onChange={onChange} disabled={disabled} />
    </div>
  );
}
