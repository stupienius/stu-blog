import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import 'highlight.js/styles/github.css'
import './Markdown.css'

export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ node: _node, ...props }) => {
            const external = props.href?.startsWith('http')
            return <a {...props} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})} />
          },
          img: ({ node: _node, ...props }) => <img loading="lazy" {...props} />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
