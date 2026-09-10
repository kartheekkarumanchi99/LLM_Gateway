import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Boxes,
  FlaskConical,
  GitPullRequestArrow,
  Globe,
  History,
  KeySquare,
  Layers,
  Radio,
  Route,
  ShieldCheck,
  Sparkles,
  Tag,
  Zap,
} from 'lucide-react';
import { PROVIDER_CATALOG } from '@llmgw/db/http';
import { CodeTabs } from '@/components/landing/code-tabs';
import { CountUp } from '@/components/landing/count-up';
import { GlowCard } from '@/components/landing/glow-card';
import { HeroSpotlight } from '@/components/landing/hero-spotlight';
import { LandingNav } from '@/components/landing/landing-nav';
import { ReliabilityMock } from '@/components/landing/reliability-mock';
import { Reveal } from '@/components/landing/reveal';
import { ScrollProgress } from '@/components/landing/scroll-progress';
import { getSessionUser } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import { getLandingStats } from '@/lib/landing';

export const dynamic = 'force-dynamic';

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  'x-ai': 'xAI',
  mistralai: 'Mistral AI',
  google: 'Google',
  moonshotai: 'Moonshot AI',
  perplexity: 'Perplexity',
};

const CARDS = [
  {
    icon: Boxes,
    title: 'Every model, one API',
    body: 'Reach every major provider through a single OpenAI-compatible endpoint. Swap models with one string — no SDK changes.',
    href: '/models',
    cta: 'Browse models',
  },
  {
    icon: Radio,
    title: 'Self-healing reliability',
    body: 'A live health mesh scores every provider from real traffic. When one degrades, a circuit breaker reroutes to a healthy, quality-equivalent model.',
    href: '/models',
    cta: 'How failover works',
  },
  {
    icon: Route,
    title: 'Intelligent routing',
    body: 'Adaptive routing ranks models per request by quality, cost, and latency — with predictive, speculative execution to shave the overhead.',
    href: '/rankings',
    cta: 'See rankings',
  },
  {
    icon: ShieldCheck,
    title: 'Guardrails & BYOK',
    body: 'Budgets, PII redaction, model-access policies, and prompt-injection defense. Bring your own keys — prompts only go where you allow.',
    href: '/models',
    cta: 'Explore controls',
  },
];

const GRID = [
  { icon: FlaskConical, title: 'Prompt Optimizer', body: 'Auto-engineer better prompts, judged and ranked on your own examples.' },
  { icon: GitPullRequestArrow, title: 'Prompt & Model CI', body: 'Eval a prompt or model change against real traffic before you ship.' },
  { icon: History, title: 'Agent Time Machine', body: 'Replay any request, diff outputs across models, and trace every step.' },
  { icon: Zap, title: 'Predictive Routing', body: 'Speculative execution commits the best model before you finish typing.' },
  { icon: BarChart3, title: 'Observability', body: 'Every prompt, completion, token, and dollar — streamed where you want it.' },
  { icon: Tag, title: 'Classifiers', body: 'Tag traffic by department, task, or intent with sampled LLM classifiers.' },
  { icon: Layers, title: 'Presets', body: 'Version model + parameter + prompt bundles and call them by slug.' },
  { icon: KeySquare, title: 'Semantic Cache', body: 'Serve near-duplicate requests from cache at ~zero upstream cost.' },
];

function stat(n: number): string {
  if (n >= 1000) return Math.floor(n / 1000) + 'K+';
  if (n <= 0) return '—';
  return n + '+';
}

export default async function LandingPage() {
  const [session, stats] = await Promise.all([getSessionUser(), getLandingStats()]);
  const providers = PROVIDER_CATALOG.map((p) => PROVIDER_NAMES[p.slug] ?? p.slug);

  const modelsStat =
    stats.models > 0
      ? stats.models >= 1000
        ? { num: Math.floor(stats.models / 1000), suffix: 'K+' }
        : { num: stats.models, suffix: '+' }
      : { num: stats.providers, suffix: '+' };
  const STATS = [
    { ...modelsStat, label: stats.models > 0 ? 'Models' : 'Providers' },
    { num: stats.providers, suffix: '', label: 'Providers' },
    { num: 1, suffix: '', label: 'Unified API' },
    { num: 0, suffix: '', label: 'Subscriptions' },
  ];

  return (
    <div className="min-h-screen overflow-x-clip bg-[#fafafa] text-gray-900">
      <ScrollProgress />
      <LandingNav signedIn={!!session} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px]">
          <span className="lg-blob lg-blob-1" />
          <span className="lg-blob lg-blob-2" />
          <span className="lg-blob lg-blob-3" />
        </div>
        <div className="pointer-events-none absolute inset-0 lg-glow" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] lg-grid" />
        <HeroSpotlight />
        <div className="relative mx-auto max-w-4xl px-5 pb-16 pt-20 text-center sm:px-8 sm:pt-28">
          <Reveal>
            <Link
              href="/models"
              className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-100"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {stats.models > 0
                ? `${stat(stats.models)} models across ${stats.providers} providers`
                : 'Smarter routing · self-healing uptime'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="lg-hero-text mx-auto mt-6 max-w-3xl text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
              One API for every model
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-gray-600">
              Route to the best model automatically, fail over when a provider blinks, and see every token — behind a
              single OpenAI-compatible endpoint. Smarter routing, self-healing uptime, no subscriptions.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 transition-transform hover:-translate-y-0.5 hover:bg-violet-700"
              >
                Get API Key <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/models"
                className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 transition-colors hover:border-gray-400"
              >
                <Globe className="h-4 w-4" /> Discover models
              </Link>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <dl className="mx-auto mt-16 grid max-w-2xl grid-cols-2 gap-8 sm:grid-cols-4">
              {STATS.map((s) => (
                <div key={s.label}>
                  <dt className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                    <CountUp value={s.num} suffix={s.suffix} />
                  </dt>
                  <dd className="mt-1 text-sm text-gray-500">{s.label}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>

        {/* Provider strip */}
        <Reveal delay={120}>
          <div className="mx-auto max-w-6xl px-5 pb-14 sm:px-8">
            <p className="text-center text-xs font-medium uppercase tracking-widest text-gray-400">One integration, every provider</p>
            <div className="lg-marquee-wrap mt-5 overflow-hidden">
              <div className="lg-marquee gap-x-10">
                {[...providers, ...providers].map((name, i) => (
                  <span key={i} className="whitespace-nowrap px-2 text-sm font-semibold text-gray-400 transition-colors hover:text-gray-700">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Feature cards */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {CARDS.map((c, i) => (
            <Reveal key={c.title} delay={i * 70}>
              <GlowCard className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-6 transition-all duration-300 hover:-translate-y-1.5 hover:border-violet-200 hover:shadow-2xl hover:shadow-violet-500/10">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-sm transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3">
                  <c.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-gray-900">{c.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">{c.body}</p>
                <Link href={c.href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-700">
                  {c.cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Reliability band */}
      <section className="border-y border-gray-200 bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 sm:px-8 lg:grid-cols-2">
          <Reveal>
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                <Activity className="h-3.5 w-3.5" /> Reliability Mesh
              </div>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-gray-900">
                Out-survive the providers you call
              </h2>
              <p className="mt-3 text-gray-600">
                Every request feeds a live health score. When a provider starts erroring or rate-limiting, its circuit
                breaker trips and traffic reroutes instantly to a healthy, quality-equivalent model — then half-open
                probes bring it back automatically. Users never see the blip.
              </p>
              <ul className="mt-5 space-y-2 text-sm text-gray-700">
                {['Live success-rate, p50/p95 & rate-limit scoring', 'Automatic circuit breakers with self-recovery', 'Quality-equivalent failover, never a hard down'].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 text-emerald-500" /> {f}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <ReliabilityMock providers={providers.slice(0, 4)} />
          </Reveal>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <Reveal>
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900">A full control plane for LLMs</h2>
            <p className="mx-auto mt-3 max-w-2xl text-gray-600">
              Everything you need to run models in production — routing, evaluation, observability, and cost control in one place.
            </p>
          </div>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GRID.map((g, i) => (
            <Reveal key={g.title} delay={(i % 4) * 60}>
              <GlowCard className="group h-full rounded-2xl border border-gray-200 bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-500/5">
                <g.icon className="h-6 w-6 text-violet-600 transition-transform duration-300 group-hover:scale-110" />
                <h3 className="mt-3 font-semibold text-gray-900">{g.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{g.body}</p>
              </GlowCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works + code */}
      <section className="border-t border-gray-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-2">
          <Reveal>
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-gray-900">Start in three steps</h2>
              <ol className="mt-8 space-y-7">
                {[
                  { n: 1, t: 'Create an account', d: 'Sign up and get a workspace. Invite your team into an org later.' },
                  { n: 2, t: 'Add a key or credits', d: 'Bring your own provider keys (BYOK) or top up shared credits — your choice.' },
                  { n: 3, t: 'Get your API key', d: 'Point any OpenAI-compatible SDK at the gateway and send your first request.' },
                ].map((s) => (
                  <li key={s.n} className="flex gap-4">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">
                      {s.n}
                    </span>
                    <div>
                      <div className="font-semibold text-gray-900">{s.t}</div>
                      <div className="mt-0.5 text-sm text-gray-600">{s.d}</div>
                    </div>
                  </li>
                ))}
              </ol>
              <Link
                href="/register"
                className="mt-8 inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
              >
                Create your account <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="min-w-0 lg:pt-4">
              <CodeTabs />
              <p className="mt-3 text-center text-xs text-gray-400">
                Fully OpenAI-compatible. Use <code className="font-mono text-gray-500">model: &quot;auto&quot;</code> to let the router choose.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <Reveal>
          <div className="lg-sheen relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-700 px-8 py-16 text-center shadow-2xl shadow-violet-600/20">
            <div className="pointer-events-none absolute inset-0 opacity-20 lg-grid" />
            <h2 className="relative text-3xl font-bold tracking-tight text-white sm:text-4xl">Ship on every model, worry about none</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-violet-100">
              One endpoint, intelligent routing, and self-healing uptime. Start free — no subscription.
            </p>
            <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/register" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-violet-700 shadow-sm transition-transform hover:-translate-y-0.5">
                Get your API Key
              </Link>
              <Link href="/login" className="rounded-xl border border-white/30 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                Sign in
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-8">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-bold text-white">
              {BRAND.charAt(0)}
            </span>
            <span className="text-sm font-semibold text-gray-900">{BRAND.toLowerCase()}</span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
            <Link href="/models" className="hover:text-gray-900">Models</Link>
            <Link href="/rankings" className="hover:text-gray-900">Rankings</Link>
            <Link href="/benchmarks" className="hover:text-gray-900">Benchmarks</Link>
            <Link href="/chat" className="hover:text-gray-900">Chat</Link>
            <Link href="/login" className="hover:text-gray-900">Sign in</Link>
          </nav>
          <p className="text-xs text-gray-400">© {new Date().getFullYear()} {BRAND}. Self-hostable & vendor-neutral.</p>
        </div>
      </footer>
    </div>
  );
}
