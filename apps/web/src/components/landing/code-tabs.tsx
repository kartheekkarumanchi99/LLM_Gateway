'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

const SNIPPETS: Record<string, string> = {
  cURL: `curl https://your-gateway.dev/v1/chat/completions \\
  -H "Authorization: Bearer $GATEWAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{ "role": "user", "content": "Explain routing in one line." }]
  }'`,
  Python: `from openai import OpenAI

client = OpenAI(
    base_url="https://your-gateway.dev/v1",
    api_key=GATEWAY_API_KEY,
)

resp = client.chat.completions.create(
    model="auto",  # intelligent routing picks the best model
    messages=[{"role": "user", "content": "Explain routing in one line."}],
)
print(resp.choices[0].message.content)`,
  'Node.js': `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://your-gateway.dev/v1",
  apiKey: process.env.GATEWAY_API_KEY,
});

const resp = await client.chat.completions.create({
  model: "auto", // intelligent routing picks the best model
  messages: [{ role: "user", content: "Explain routing in one line." }],
});
console.log(resp.choices[0].message.content);`,
};

export function CodeTabs() {
  const [tab, setTab] = useState('Python');
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(SNIPPETS[tab] ?? '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-[#0d1117] shadow-2xl shadow-violet-500/10">
      <div className="flex items-center gap-1 border-b border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="mr-2 flex gap-1.5 pl-1">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        {Object.keys(SNIPPETS).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors ' +
              (tab === k ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200')
            }
          >
            {k}
          </button>
        ))}
        <button
          onClick={copy}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed text-gray-200">
        <code>{SNIPPETS[tab]}</code>
      </pre>
    </div>
  );
}
