import ReactMarkdown from "react-markdown";

/**
 * Renders admin-supplied legal copy (Markdown) with readable dark-theme typography.
 */
export default function LegalMarkdownProse({ children }) {
  if (!children || !String(children).trim()) return null;
  return (
    <ReactMarkdown
      className="prose prose-invert prose-sm sm:prose-base max-w-none prose-headings:font-semibold prose-p:text-slate-300 prose-li:text-slate-300 prose-strong:text-white prose-a:text-violet-400 prose-a:no-underline hover:prose-a:underline"
      components={{
        a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
      }}
    >
      {String(children)}
    </ReactMarkdown>
  );
}
