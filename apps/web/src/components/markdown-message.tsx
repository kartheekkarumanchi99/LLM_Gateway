'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Renders assistant Markdown (headings, lists, GFM tables, code, links) to styled React
// elements — never raw HTML, so LLM output can't inject markup.
const components: Components = {
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-lg font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-base font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-violet-600 underline underline-offset-2 hover:text-violet-700"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-4 border-gray-300 pl-3 italic text-gray-600">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-gray-900 p-3 text-[12.5px] leading-relaxed text-gray-100">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const text = String(children ?? '');
    const isBlock = /language-/.test(className ?? '') || text.includes('\n');
    if (isBlock) return <code className={`font-mono ${className ?? ''}`}>{children}</code>;
    return (
      <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.85em] text-violet-700">{children}</code>
    );
  },
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-left font-semibold text-gray-700">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-gray-100 px-3 py-1.5 align-top">{children}</td>,
};

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
