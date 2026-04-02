import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import api from '../api'
import useDaemonSocket from '../hooks/useDaemonSocket'
import {
  Send, Plus, Trash2, Bot, User, X, Menu,
  Loader2, Copy, Check, ChevronDown, ChevronRight,
  Settings2, Brain, Sparkles, BrainCircuit,
  Zap, Terminal, FileText, FolderOpen, Camera,
  BookOpen, CheckCircle2, AlertCircle, Globe, ExternalLink, Square,
  Wifi, WifiOff, Pause, Play
} from 'lucide-react'

// ── Parse events from formatted string ────────────────────────────────

// Helper: strip base64 and image-related keys from a parsed result object
function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return result;
  const clean = {};
  for (const [k, v] of Object.entries(result)) {
    // Skip known image keys
    if (k === 'base64' || k === '_frontend_screenshot' || k === '_frontend_screenshot_path') continue;
    // Skip any value that looks like a long base64 string
    if (typeof v === 'string' && v.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(v.slice(0, 100))) continue;
    clean[k] = v;
  }
  return clean;
}

// Helper: remove inline base64 blobs from raw text (e.g. old DB records with leaked base64)
function stripBase64FromText(text) {
  if (!text || typeof text !== 'string') return text;
  // Match very long base64-like sequences (500+ chars of alphanumeric/+/=/\s)
  return text.replace(/(?:data:image\/[^;]+;base64,)?[A-Za-z0-9+/]{500,}={0,2}/g, '[image data removed]');
}

function parseEventsFromContent(content) {
  if (!content || typeof content !== 'string') return [];

  const events = [];
  let lastIndex = 0;

  // Regex match các block đặc biệt (dùng /gs để hỗ trợ multiline tốt hơn)
  const blockRegex = /(<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>)|(\n🔧 \*\*.*?\*\*\(.*?\)\n)|(\n📤 \*\*Result \(.*?\)\*\*: [\s\S]*?(?=\n🔧|\n📤 \*\*Result|\n📸|\n❌|$))|(\n📸 Screenshot: .*?(?=\n|$))|(\n❌ \*\*Error\*\*: .*?(?=\n|$))/gs;

  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const start = match.index;

    // Xử lý phần text thuần trước block (rất quan trọng để không bị cắt)
    if (start > lastIndex) {
      const textPart = stripBase64FromText(content.slice(lastIndex, start).trim());
      if (textPart && textPart !== '[image data removed]') {
        const { thinking, answer } = parseThinking(textPart);
        if (thinking) {
          events.push({ type: 'thinking', content: thinking });
        }
        if (answer) {
          events.push({ type: 'text', content: answer });
        } else if (!thinking) {
          events.push({ type: 'text', content: textPart });
        }
      }
    }

    // Xử lý từng block đặc biệt
    if (match[1]) { // <think> block
      const inner = match[1].match(/<(?:think|thought)>([\s\S]*?)(?:<\/(?:think|thought)>|$)/i);
      if (inner && inner[1]) {
        events.push({ type: 'thinking', content: inner[1].trim() });
      }
    }
    else if (match[2]) { // Tool call
      const toolMatch = match[2].match(/\n🔧 \*\*(.*?)\*\*\((.*?)\)\n/s);
      if (toolMatch) {
        try {
          const tool = toolMatch[1].trim();
          const args = toolMatch[2] ? JSON.parse(toolMatch[2]) : {};
          events.push({ type: 'tool_call', tool, args });
        } catch {
          events.push({ type: 'text', content: match[2].trim() });
        }
      }
    }
    else if (match[3]) { // Tool result
      const resultMatch = match[3].match(/\n📤 \*\*Result \((.*?)\)\*\*: ([\s\S]*)/);
      if (resultMatch) {
        const tool = resultMatch[1].trim();
        let result = resultMatch[2].trim();
        try {
          if (result[0] === '{' || result[0] === '[') {
            result = sanitizeResult(JSON.parse(result));
          }
        } catch { }
        // If result is still a string, strip any inline base64
        if (typeof result === 'string') {
          result = stripBase64FromText(result);
        }
        // If this is a screenshot tool result, also extract screenshot URL from path
        if (typeof result === 'object' && result !== null) {
          const path = result.path || result.file_path || '';
          if (tool === 'screenshot' && path) {
            const filename = path.split('/').pop();
            events.push({ type: 'screenshot', url: `/agent/screenshots/${filename}` });
          }
        }
        events.push({ type: 'tool_result', tool, result });
      }
    }
    else if (match[4]) { // Screenshot
      const path = match[4].replace(/^\n📸 Screenshot: /, '').trim();
      const filename = path.split('/').pop();
      events.push({ type: 'screenshot', url: `/agent/screenshots/${filename}` });
    }
    else if (match[5]) { // Error
      const errorText = match[5].replace(/^\n❌ \*\*Error\*\*: /, '').trim();
      events.push({ type: 'error', content: errorText });
    }

    lastIndex = blockRegex.lastIndex;
  }

  // Phần còn lại ở cuối chuỗi
  if (lastIndex < content.length) {
    const remaining = stripBase64FromText(content.slice(lastIndex).trim());
    if (remaining && remaining !== '[image data removed]') {
      const { thinking, answer } = parseThinking(remaining);
      if (thinking) events.push({ type: 'thinking', content: thinking });
      if (answer) {
        events.push({ type: 'text', content: answer });
      } else {
        events.push({ type: 'text', content: remaining });
      }
    }
  }

  return events;
}

// Helper mới để xử lý phần text (tách thinking + answer)
function processTextPart(text, events) {
  if (!text) return;

  const { thinking, answer } = parseThinking(text);

  if (thinking) {
    events.push({ type: 'thinking', content: thinking });
  }
  if (answer) {
    events.push({ type: 'text', content: answer });
  } else if (!thinking) {
    // Nếu không có thinking thì đẩy hết vào text
    events.push({ type: 'text', content: text });
  }
}
function parseThinking(content) {
  if (!content || typeof content !== 'string') {
    return { thinking: '', answer: '', isThinkingComplete: true };
  }

  const thinkRegex = /<(?:think|thought)>([\s\S]*?)(?:<\/(?:think|thought)>|$)/gi;

  let fullThinking = '';
  let isThinkingComplete = true;
  let lastEnd = 0;

  let match;
  while ((match = thinkRegex.exec(content)) !== null) {
    const captured = match[1] ? match[1].trim() : '';
    if (captured) {
      if (fullThinking) fullThinking += '\n\n';
      fullThinking += captured;
    }

    // Nếu block không có thẻ đóng → đang stream, chưa hoàn tất
    if (!match[0].includes('</think>') && !match[0].includes('</thought>')) {
      isThinkingComplete = false;
    }

    lastEnd = thinkRegex.lastIndex;
  }

  // Phần answer = nội dung còn lại sau khi loại bỏ tất cả thinking blocks
  let answer = content
    .replace(/<(?:think|thought)>[\s\S]*?(?:<\/(?:think|thought)>|$)/gi, '')
    .replace(/<\/?(?:think|thought)>/gi, '')
    .trim();

  return {
    thinking: fullThinking.trim(),
    answer: answer,
    isThinkingComplete
  };
}
function ThinkingBlock({ thinking, isStreaming, isThinkingComplete }) {
  const [expanded, setExpanded] = useState(true)
  const showExpanded = isStreaming && !isThinkingComplete ? true : expanded

  if (!thinking && !isStreaming) return null
  const cleanThinking = (thinking || '').replace(/<\/?(?:think|thought)>/gi, '').trim()
  if (!cleanThinking && !isStreaming) return null

  return (
    <div className="mb-6 animate-fade-in group/think max-w-[95%]">
      <div className="flex flex-col items-start">
        {/* Toggle Button */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`group flex items-center gap-3 px-4 py-2 rounded-2xl border transition-all duration-500 shadow-sm
            ${showExpanded
              ? 'bg-indigo-600/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-300 ring-4 ring-indigo-500/5'
              : 'bg-light-100 hover:bg-white border-light-200 text-light-500 dark:bg-slate-800/40 dark:border-slate-800/60 dark:text-slate-400 dark:hover:bg-slate-800/80 hover:shadow-md'}`}
        >
          <div className="relative">
            {isStreaming && !isThinkingComplete ? (
              <div className="absolute -inset-1.5 bg-indigo-500/30 rounded-full animate-ping opacity-75" />
            ) : null}
            <div className={`p-1.5 rounded-lg ${showExpanded ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'bg-light-200 dark:bg-slate-700/50'}`}>
              <BrainCircuit size={14} className={isStreaming && !isThinkingComplete ? 'animate-pulse' : ''} />
            </div>
          </div>
          <div className="flex flex-col items-start leading-tight">
            <span className="text-[10px] font-black uppercase tracking-[0.15em] opacity-60">Neural Process</span>
            <span className="text-[11px] font-bold">
              {isStreaming && !isThinkingComplete ? 'Đang phân tích dữ liệu...' : 'Lộ trình suy nghĩ'}
            </span>
          </div>
          <div className={`ml-2 transition-transform duration-500 ${showExpanded ? 'rotate-180 opacity-40' : 'opacity-20'}`}>
            <ChevronDown size={14} />
          </div>
        </button>

        {/* Content Block */}
        {showExpanded && (
          <div className="relative mt-3 w-full animate-slide-down">
            {/* Thread Line */}
            <div className="absolute left-[22px] top-0 bottom-0 w-px bg-gradient-to-b from-indigo-500/40 via-indigo-500/10 to-transparent" />
            
            <div className="ml-10 py-1 pr-6">
              <div className="bg-indigo-500/[0.03] dark:bg-indigo-500/[0.05] border border-indigo-500/10 dark:border-indigo-500/20 backdrop-blur-md rounded-3xl p-5 shadow-inner">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {cleanThinking ? (
                    cleanThinking.split('\n').filter(l => l.trim()).map((line, idx) => {
                      const isBullet = /^[•\-\*]\s+/.test(line.trim());
                      const isNumber = /^\d+\.\s+/.test(line.trim());
                      const text = line.replace(/^[•\-\*\d\.\s]+/, '').trim();

                      if (isBullet || isNumber) {
                        return (
                          <div key={idx} className="flex gap-3 mb-3 last:mb-0 group/th-item">
                            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-500/10 flex items-center justify-center mt-0.5">
                              {isNumber ? (
                                <span className="text-[10px] font-black text-indigo-500">{line.match(/^\d+/)[0]}</span>
                              ) : (
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500/40" />
                              )}
                            </div>
                            <p className="text-sm leading-relaxed text-light-700 dark:text-indigo-100/70 font-medium break-words flex-1">
                              {text}
                            </p>
                          </div>
                        );
                      }
                      
                      return (
                        <p key={idx} className="text-sm leading-relaxed text-light-700 dark:text-indigo-100/70 italic font-medium mb-3 last:mb-0 ml-8 opacity-80">
                          {line.trim()}
                        </p>
                      );
                    })
                  ) : (
                    <div className="flex items-center gap-3 text-indigo-500/50 italic text-sm py-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" />
                       <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.15s]" />
                       <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.3s]" />
                       <span>Khởi tạo luồng logic...</span>
                    </div>
                  )}
                </div>

                {isStreaming && !isThinkingComplete && cleanThinking && (
                  <div className="flex items-center gap-1 mt-4">
                    <span className="w-1 h-1 rounded-full bg-indigo-500/60 animate-ping" />
                    <span className="text-[9px] uppercase tracking-widest font-black text-indigo-500/40">Real-time Stream</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Markdown renderer (memoized — expensive to re-render) ────────────────────
const ChatMarkdown = memo(function ChatMarkdown({ content }) {
  const [copied, setCopied] = useState('')
  const copyCode = (code) => { navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(''), 2000) }

  return (
    <ReactMarkdown className="chat-markdown-content text-sm leading-relaxed font-medium"
      remarkPlugins={[remarkGfm]}
      components={{
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const codeStr = String(children).replace(/\n$/, '')
          if (!inline && match) {
            return (
              <div className="relative group my-3">
                <div className="flex items-center justify-between bg-light-200 dark:bg-dark-950 border border-light-300 dark:border-dark-800 rounded-t-xl px-4 py-2">
                  <span className="text-xs text-light-600 dark:text-dark-400 font-mono">{match[1]}</span>
                  <button onClick={() => copyCode(codeStr)}
                    className="text-light-500 dark:text-dark-400 hover:text-light-900 dark:hover:text-white transition-colors flex items-center gap-1 text-xs"
                  >
                    {copied === codeStr ? <Check size={12} /> : <Copy size={12} />}
                    {copied === codeStr ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div"
                  customStyle={{ margin: 0, borderRadius: '0 0 0.75rem 0.75rem', border: '1px solid', borderColor: 'inherit', borderTop: 'none', fontSize: '0.8rem' }}
                  className="border-light-300 dark:border-dark-800"
                  {...props}>{codeStr}</SyntaxHighlighter>
              </div>
            )
          }
          return <code className="bg-light-200 dark:bg-dark-950 border border-light-300 dark:border-dark-800 rounded px-1.5 py-0.5 text-xs font-mono text-primary-600 dark:text-primary-300" {...props}>{children}</code>
        },
      }}
    >{content}</ReactMarkdown>
  )
})

// ── Tool Step ───────────────────────────────────────────────────────────────
const TOOL_META = {
  run_command: { icon: Terminal, label: 'Shell', color: 'text-emerald-400', bg: 'bg-emerald-900/20 border-emerald-700/30' },
  read_file: { icon: FileText, label: 'Đọc File', color: 'text-blue-400', bg: 'bg-blue-900/20 border-blue-700/30' },
  write_file: { icon: FileText, label: 'Ghi File', color: 'text-purple-400', bg: 'bg-purple-900/20 border-purple-700/30' },
  list_dir: { icon: FolderOpen, label: 'Thư mục', color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-700/30' },
  screenshot: { icon: Camera, label: 'Screenshot', color: 'text-pink-400', bg: 'bg-pink-900/20 border-pink-700/30' },
  update_docs: { icon: BookOpen, label: 'Cập nhật Docs', color: 'text-cyan-400', bg: 'bg-cyan-900/20 border-cyan-700/30' },
  deep_search: { icon: Globe, label: 'Deep Search', color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/30' },
  web_search: { icon: Globe, label: 'Tìm kiếm Web', color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/30' },
  read_web: { icon: Globe, label: 'Đọc trang Web', color: 'text-teal-400', bg: 'bg-teal-900/20 border-teal-700/30' },
  edit_file: { icon: FileText, label: 'Sửa File', color: 'text-amber-400', bg: 'bg-amber-900/20 border-amber-700/30' },
  search_code: { icon: Terminal, label: 'Tìm Code', color: 'text-violet-400', bg: 'bg-violet-900/20 border-violet-700/30' },
  find_files: { icon: FolderOpen, label: 'Tìm File', color: 'text-lime-400', bg: 'bg-lime-900/20 border-lime-700/30' },
}

const ToolStep = memo(function ToolStep({ step }) {
  const [expanded, setExpanded] = useState(false)
  const meta = TOOL_META[step.tool] || { icon: Zap, label: step.tool, color: 'text-slate-400', bg: 'bg-light-100 dark:bg-slate-900/40 border-light-200 dark:border-slate-700/30' }
  const Icon = meta.icon

  return (
    <div className={`max-w-3xl border rounded-2xl overflow-hidden shadow-sm transition-all duration-150 ${meta.bg} ${expanded ? 'bg-opacity-100 dark:bg-opacity-40' : 'bg-opacity-60 dark:bg-opacity-10'}`}>
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-white/5 transition-colors group"
      >
        <div className={`p-1.5 rounded-lg bg-white dark:bg-slate-950/80 ${meta.color} border border-light-200 dark:border-white/5 shadow-inner`}>
          <Icon size={14} className="group-hover:scale-110 transition-transform" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold tracking-tight uppercase ${meta.color}`}>{meta.label}</span>
            {step.result ? (
              step.result.error
                ? <AlertCircle size={13} className="text-red-500" />
                : <CheckCircle2 size={13} className="text-emerald-500" />
            ) : (
              <Loader2 size={12} className="animate-spin text-light-400 dark:text-slate-600" />
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {step.args?.command && <code className="text-[10px] text-light-600 dark:text-slate-400 font-mono truncate bg-light-200 dark:bg-slate-950/40 px-1.5 py-0.5 rounded">$ {step.args.command}</code>}
            {step.args?.path && !step.args?.command && <code className="text-[10px] text-light-600 dark:text-slate-400 font-mono truncate bg-light-200 dark:bg-slate-950/40 px-1.5 py-0.5 rounded">{step.args.path}</code>}
            {step.args?.query && <code className="text-[10px] text-orange-600 dark:text-orange-400/80 font-mono truncate">🔍 {step.args.query}</code>}
            {step.args?.url && !step.args?.query && <code className="text-[10px] text-teal-600 dark:text-teal-400/80 font-mono truncate">🌐 {step.args.url.replace(/^https?:\/\//, '')}</code>}
            {step.tool === 'browser_click' && <code className="text-[10px] text-pink-600 dark:text-pink-400/80 font-mono">🖱️ Click ID: {step.args.selector}</code>}
          </div>
        </div>

        <div className={`p-1 rounded-md text-light-400 dark:text-slate-600 group-hover:text-light-600 dark:group-hover:text-slate-400 transition-all ${expanded ? 'rotate-180' : ''}`}>
          <ChevronDown size={14} />
        </div>
      </button>

      {expanded && step.result && (
        <div className="px-4 pb-4 space-y-3 animate-slide-down border-t border-light-200 dark:border-slate-800/40 pt-3">
          {step.result.stdout && (
            <div className="bg-light-50 dark:bg-dark-950/90 rounded-xl p-3 border border-light-200 dark:border-slate-800/80 shadow-inner group/out relative">
              <span className="absolute top-2 right-2 text-[9px] font-bold text-light-400 dark:text-slate-600 uppercase tracking-widest opacity-0 group-hover/out:opacity-100 transition-opacity">STDOUT</span>
              <pre className="text-[12px] text-emerald-600 dark:text-emerald-400/90 font-mono whitespace-pre-wrap leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>{step.result.stdout.trim()}</pre>
            </div>
          )}
          {step.result.stderr && (
            <div className="bg-red-50 dark:bg-red-950/10 rounded-xl p-3 border border-red-200 dark:border-red-900/20 relative group/err">
              <span className="absolute top-2 right-2 text-[9px] font-bold text-red-400 dark:text-red-900/50 uppercase tracking-widest">STDERR</span>
              <pre className="text-[12px] text-red-600 dark:text-red-400/90 font-mono whitespace-pre-wrap leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>{step.result.stderr.trim()}</pre>
            </div>
          )}
          {step.result.content && step.tool === 'read_file' && (
            <div className="bg-light-50 dark:bg-dark-950/90 rounded-xl p-3 border border-light-200 dark:border-slate-800/80 max-h-80 overflow-y-auto">
              <pre className="text-[12px] text-light-700 dark:text-slate-300 font-mono whitespace-pre-wrap leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>{step.result.content}</pre>
            </div>
          )}
          {step.result.items && (
            <div className="bg-light-50 dark:bg-dark-950/90 rounded-xl p-2 border border-light-200 dark:border-slate-800/80 max-h-48 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-x-4">
              {step.result.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1.5 px-2 hover:bg-light-200 dark:hover:bg-white/5 rounded-lg transition-colors">
                  {item.is_dir ? <FolderOpen size={13} className="text-yellow-600 dark:text-yellow-400/80" /> : <FileText size={13} className="text-light-500 dark:text-slate-500" />}
                  <span className="text-light-700 dark:text-slate-300 truncate">{item.name}</span>
                </div>
              ))}
            </div>
          )}
          {step.result.combined_content && (
            <div className="bg-light-50 dark:bg-dark-950/90 rounded-xl p-3 border border-light-200 dark:border-slate-800/80 max-h-60 overflow-y-auto">
              <pre className="text-[11px] text-light-600 dark:text-slate-400 font-mono whitespace-pre-wrap leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>{step.result.combined_content.slice(0, 3000)}{step.result.combined_content.length > 3000 ? '\n... [truncated]' : ''}</pre>
            </div>
          )}
          {step.result.message && !step.result.items && !step.result.results && !step.result.combined_content && (
            <div className="px-1 text-xs text-light-500 dark:text-slate-400 leading-relaxed italic border-l-2 border-light-300 dark:border-slate-700/50 pl-3">
              {step.result.message}
            </div>
          )}
          {/* Search results */}
          {step.result.results && (
            <div className="space-y-2">
              {step.result.results.map((r, i) => (
                <div key={i} className="bg-white dark:bg-slate-900/60 p-3 rounded-xl border border-light-200 dark:border-slate-800/60 hover:border-orange-500/30 transition-colors group/res">
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-orange-600 dark:text-orange-300 hover:text-orange-700 dark:hover:text-orange-200 font-bold transition-colors">
                    <Globe size={14} className="text-orange-500 dark:text-orange-400/70" />
                    <span className="truncate">{r.title}</span>
                    <ExternalLink size={12} className="opacity-0 group-hover/res:opacity-50" />
                  </a>
                  <p className="text-xs text-light-600 dark:text-slate-400 mt-1.5 leading-relaxed">{r.snippet}</p>
                </div>
              ))}
            </div>
          )}
          {step.result.error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/20 p-3 rounded-xl border border-red-900/30">
              <AlertCircle size={14} />
              <span>{step.result.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

const ScreenshotBlock = memo(function ScreenshotBlock({ url, base64, path }) {
  const [loaded, setLoaded] = useState(false)
  // Prefer base64 data URL (from backend SSE), fallback to URL path
  const mimeType = (path || url || '').endsWith('.jpg') ? 'image/jpeg' : 'image/png'
  const imgSrc = base64
    ? `data:${mimeType};base64,${base64}`
    : url ? `/api${url}` : null

  if (!imgSrc) return null

  return (
    <div className="border border-pink-200 dark:border-pink-700/30 bg-pink-50 dark:bg-pink-900/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-pink-200 dark:border-pink-700/20">
        <Camera size={13} className="text-pink-500 dark:text-pink-400" />
        <span className="text-xs text-pink-600 dark:text-pink-300 font-medium">Screenshot</span>
      </div>
      <div className="p-2">
        {!loaded && <div className="flex items-center justify-center py-6"><Loader2 size={16} className="animate-spin text-slate-500" /></div>}
        <img src={imgSrc} alt="Screenshot"
          className={`rounded-lg w-full max-h-80 object-contain cursor-pointer transition-opacity duration-150 ${loaded ? 'opacity-100' : 'opacity-0 h-0'}`}
          onClick={() => window.open(imgSrc, '_blank')} onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)} />
      </div>
    </div>
  )
})

// ── Agent Message ───────────────────────────────────────────────────────────
function AgentMessage({ events, isStreaming }) {
  // Aggregate all reasoning into a single top-level block for a cleaner UI
  const { thinkingContent, otherItems, isThinkingStreaming } = useMemo(() => {
    let thoughts = []
    const others = []
    let isThinkingStreaming = false

    // Pre-scan for a final consolidated 'thinking' event which is the source of truth
    const finalThinkingEv = events.find(e => e.type === 'thinking')
    if (finalThinkingEv) {
      thoughts.push(finalThinkingEv.content.replace(/<\/?(?:think|thought)>/gi, '').trim())
    }

    events.forEach((ev, idx) => {
      const isLast = idx === events.length - 1
      let contentToProcess = ""
      let markAsStreaming = false

      // If we already have a final thinking event, ignore thinking_tokens to avoid duplication
      if (ev.type === 'thinking_token' && !finalThinkingEv) {
        contentToProcess = ev.content || ""
        markAsStreaming = isStreaming && isLast
      } else if (ev.type === 'text') {
        const { thinking, answer, isThinkingComplete } = parseThinking(ev.content)
        // Only process thinking from text if we don't have a better event
        if (thinking && !finalThinkingEv) {
          contentToProcess = thinking
          markAsStreaming = isStreaming && isLast && !isThinkingComplete
        }
        if (answer) {
          const lastGroup = others.length > 0 ? others[others.length - 1] : null
          if (lastGroup?.type === 'answer') {
            lastGroup.content += answer
          } else {
            others.push({ ...ev, type: 'answer', content: answer })
          }
        }
      } else if (ev.type === 'tool_result') {
        const res = ev.result
        if (res && typeof res === 'object' && !Array.isArray(res)) {
          const screenshotB64 = res._frontend_screenshot || res.base64
          if (screenshotB64 && typeof screenshotB64 === 'string' && screenshotB64.length > 100 && screenshotB64 !== '[image]') {
            others.push({ type: 'screenshot', base64: screenshotB64, path: res.path || res._frontend_screenshot_path || '' })
          }
          const cleanResult = sanitizeResult(res)
          others.push({ ...ev, result: cleanResult })
        } else {
          others.push(ev)
        }
      } else if (ev.type !== 'thinking' && ev.type !== 'thinking_token') {
        others.push(ev)
      }

      if (contentToProcess && !finalThinkingEv) {
        const clean = contentToProcess.replace(/<\/?(?:think|thought)>/gi, '').trim()
        if (clean) {
          let foundContained = false
          for (let i = 0; i < thoughts.length; i++) {
            if (clean.includes(thoughts[i]) || thoughts[i].startsWith(clean)) {
              if (clean.length >= thoughts[i].length) thoughts[i] = clean
              foundContained = true; break
            } else if (thoughts[i].includes(clean)) {
              foundContained = true; break
            }
          }
          if (!foundContained) thoughts.push(clean)
        }
        if (markAsStreaming) isThinkingStreaming = true
      }
    })

    // Clean up junk text fragments (leaked tokens before <think> like "The", "Step", "I")
    const cleanedOthers = others.filter((item) => {
      if (item.type !== 'answer') return true
      const text = (item.content || '').trim()
      if (text.length > 25) return true
      if (/[.!?:,;*|#\-\[\]()]/.test(text)) return true
      if (text.includes('http') || text.includes('```')) return true
      if (text.split(/[\s\n]+/).length > 5) return true
      return false
    })

    return {
      thinkingContent: thoughts.reduce((acc, curr) => {
        if (!acc) return curr
        // If last segment doesn't end in punctuation or is very short, join with space
        if (!/[.!?]$/.test(acc.trim()) || curr.length < 50 || acc.length < 50) {
          return acc.trim() + " " + curr.trim()
        }
        return acc.trim() + "\n\n" + curr.trim()
      }, "").trim(),
      otherItems: cleanedOthers,
      isThinkingStreaming
    }
  }, [events, isStreaming])

  return (
    <div className="flex-1 min-w-0 space-y-4 pt-1">
      {(thinkingContent || (isStreaming && isThinkingStreaming)) && (
        <ThinkingBlock
          thinking={thinkingContent}
          isStreaming={isThinkingStreaming}
          isThinkingComplete={!isThinkingStreaming}
        />
      )}

      {otherItems.map((item, i) => {
        switch (item.type) {
          case 'tool_call': {
            const resultEv = events.find((e, j) => e.type === 'tool_result' && e.tool === item.tool)
            return <ToolStep key={i} step={{ tool: item.tool, args: item.args, result: resultEv?.result }} />
          }
          case 'screenshot':
            return <ScreenshotBlock key={i} url={item.url} base64={item.base64} path={item.path} />
          case 'answer':
            return (
              <div key={i} className="chat-bubble-ai max-w-none text-light-900 dark:text-white leading-relaxed font-medium">
                <ChatMarkdown content={item.content} />
              </div>
            )
          case 'error':
            return (
              <div key={i} className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl px-4 py-3 text-red-400 text-sm font-bold">
                <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                <p>{item.content}</p>
              </div>
            )
          default:
            return null
        }
      })}
      {isStreaming && events.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border border-light-200 dark:border-slate-800 rounded-full bg-light-50 dark:bg-dark-900/40 w-fit animate-pulse">
          <div className="w-1.5 h-1.5 rounded-full bg-primary-500" />
          <span className="text-[10px] font-black uppercase tracking-widest text-light-500 dark:text-slate-500">Evaluating...</span>
        </div>
      )}
    </div>
  )
}

// ── Session Item ────────────────────────────────────────────────────────────
const SessionItem = memo(function SessionItem({ session, active, onSelect, onDelete, onRename }) {
  const [isEditing, setIsEditing] = useState(false)
  const [tempTitle, setTempTitle] = useState(session.title?.replace('🤖 ', '') || 'New Task')

  const handleFinish = () => {
    setIsEditing(false)
    if (tempTitle.trim() && tempTitle !== (session.title?.replace('🤖 ', '') || 'New Task')) {
      onRename(session.id, tempTitle)
    }
  }

  return (
    <div onClick={() => !isEditing && onSelect(session.id)}
      className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 
        ${active ? 'bg-indigo-600/10 dark:bg-indigo-600/15 border border-indigo-500/20' : 'hover:bg-light-200 dark:hover:bg-slate-800/50'}`}
    >
      <Zap size={14} className={`flex-shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-light-400 dark:text-slate-500'}`} />
      <div className="flex-1 min-w-0" onDoubleClick={() => setIsEditing(true)}>
        {isEditing ? (
          <input
            autoFocus
            className="w-full bg-light-200 dark:bg-slate-800 text-xs text-light-900 dark:text-white border-0 p-0 focus:ring-0 rounded"
            value={tempTitle}
            onChange={e => setTempTitle(e.target.value)}
            onBlur={handleFinish}
            onKeyDown={e => e.key === 'Enter' && handleFinish()}
          />
        ) : (
          <span className={`block text-xs truncate ${active ? 'text-indigo-700 dark:text-white font-medium' : 'text-light-600 dark:text-slate-400'}`}>
            {session.title?.replace('🤖 ', '').replace(/<\/?(?:think|thought)>/gi, '') || 'New Task'}
          </span>
        )}
      </div>
      {!isEditing && (
        <button onClick={(e) => { e.stopPropagation(); onDelete(session.id) }}
          className="opacity-0 group-hover:opacity-100 text-light-400 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-all"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
})

// ── Helpers: sessionStorage cache ────────────────────────────────────────────
const CACHE_KEY = 'hatai_chat_cache'

function loadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveCache(activeSession, agentEvents) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ activeSession, agentEvents }))
  } catch { }
}

// ── Helper: merge a single event into the last agent message ─────────────────
function mergeEvent(messages, log) {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'agent') return messages

  const evs = [...last.events]
  const tail = evs.length > 0 ? evs[evs.length - 1] : null

  switch (log.type) {
    case 'thinking_token':
      if (tail?.type === 'thinking_token') {
        evs[evs.length - 1] = { ...tail, content: tail.content + log.content }
      } else {
        evs.push({ type: 'thinking_token', content: log.content })
      }
      break
    case 'thinking': {
      evs.push({ type: 'thinking', content: log.content })
      break
    }
    case 'text':
      if (tail?.type === 'text') {
        evs[evs.length - 1] = { ...tail, content: tail.content + log.content }
      } else {
        evs.push({ type: 'text', content: log.content })
      }
      break
    case 'tool_call':
      evs.push({ type: 'tool_call', tool: log.tool, args: log.args })
      break
    case 'tool_result':
      evs.push({ type: 'tool_result', tool: log.tool, result: log.result })
      break
    case 'tool_result_screenshot':
      evs.push({ type: 'screenshot', base64: log.base64, path: log.path })
      break
    case 'screenshot':
      evs.push({ type: 'screenshot', url: log.content || log.url, base64: log.base64, path: log.path })
      break
    default:
      evs.push(log)
      break
  }
  return messages.map((m, i) => i === messages.length - 1 ? { ...m, events: evs } : m)
}

// ── Main Agent Page ─────────────────────────────────────────────────────────
export default function Chat() {
  const navigate = useNavigate()
  const cached = useRef(loadCache()).current
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState(cached?.activeSession ?? null)
  const [agentEvents, setAgentEvents] = useState(cached?.agentEvents ?? [])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [temperature, setTemperature] = useState(0.5)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [geminiKey, setGeminiKey] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState('')
  const [openaiApiBase, setOpenaiApiBase] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [useDaemon, setUseDaemon] = useState(true)
  const [editingQuickPrompts, setEditingQuickPrompts] = useState(false)
  const [quickPrompts, setQuickPrompts] = useState(() => {
    const saved = localStorage.getItem('hatai_quick_prompts')
    return saved ? JSON.parse(saved) : [
      '🔍 Tìm kiến thức về AI mới nhất (Session)',
      '🧠 Truy vấn dữ liệu trong phiên chat này',
      '📂 Liệt kê cấu trúc dự án hiện tại',
      '🔧 Kiểm tra backend và tình trạng hệ thống',
    ]
  })
  const [tempQuickPrompts, setTempQuickPrompts] = useState([...quickPrompts])
  const activeSessionRef = useRef(activeSession)

  // Sync ref with state + persist to sessionStorage
  useEffect(() => {
    activeSessionRef.current = activeSession
    saveCache(activeSession, agentEvents)
  }, [activeSession, agentEvents])

  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  // ── Persistent Daemon Connection ───────────────────────────────────────
  const daemon = useDaemonSocket()

  // Handle daemon events — update agentEvents in real-time
  useEffect(() => {
    daemon.onEvent((event) => {
      if (event.type === 'task_log') {
        if (event.session_id !== activeSessionRef.current) return
        const log = event.log
        if (log.type === 'done') { setStreaming(false); return }
        setAgentEvents(prev => mergeEvent(prev, log))
        return
      }

      if (event.type === 'task_result') {
        setStreaming(false)
        if (event.session_id === activeSessionRef.current) {
          fetchMessages(activeSessionRef.current)
        }
        return
      }
    })
  }, [daemon])

  const scrollBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollBottom() }, [agentEvents])

  // Load sessions
  useEffect(() => {
    api.get('/ai/sessions').then(r => setSessions(r.data)).catch(() => { })
  }, [])

  useEffect(() => {
    if (showSettings) {
      api.get('/ai/settings').then(r => {
        setGeminiKey(r.data.gemini_api_key || '')
        setOllamaUrl(r.data.ollama_url || '')
        setOpenaiApiBase(r.data.openai_api_base || '')
      }).catch(() => { })
    }
  }, [showSettings])

  const handleSaveSettings = async () => {
    setSavingSettings(true)
    try {
      await api.post('/ai/settings', {
        gemini_api_key: geminiKey,
        ollama_url: ollamaUrl,
        openai_api_base: openaiApiBase
      })
      alert('Đã lưu cấu hình API')
    } catch (e) {
      alert('Lỗi khi lưu cấu hình: ' + e.message)
    }
    setSavingSettings(false)
  }

  const handleNewChat = () => {
    setActiveSession(null)
    setAgentEvents([])
    setInput('')
  }

  const fetchMessages = async (id) => {
    if (!id) return
    try {
      const res = await api.get(`/ai/sessions/${id}/messages`)
      console.log(`[API] Fetched ${res.data.length} messages for session ${id}`)
      const formatted = res.data.map(m => {
        if (m.role === 'user') return { role: 'user', content: m.content, id: m.id }
        else {
          const events = parseEventsFromContent(m.content)
          return { role: 'agent', events, id: m.id }
        }
      })
      setAgentEvents(formatted)
    } catch (err) {
      console.error('Không thể tải lịch sử chat:', err)
    }
  }

  const handleSelectSession = async (id) => {
    if (id === activeSession) return
    setActiveSession(id)
    setAgentEvents([])
    await fetchMessages(id)
  }

  const handleDeleteSession = async (id) => {
    try {
      await api.delete(`/ai/sessions/${id}`)
      setSessions(prev => prev.filter(s => s.id !== id))
      if (activeSession === id) handleNewChat()
    } catch (err) {
      alert('Lỗi khi xóa: ' + err.message)
    }
  }

  const handleRenameSession = async (id, newTitle) => {
    try {
      await api.put(`/ai/sessions/${id}`, { title: newTitle })
      setSessions(prev => prev.map(s => {
        if (s.id === id) return { ...s, title: newTitle }
        return s
      }))
    } catch (err) {
      alert('Lỗi khi đổi tên: ' + err.message)
    }
  }

  // ── Send message to Agent ─────────────────────────────────────────────
  const sendAgentMessage = async (msg) => {
    if (!msg?.trim() || streaming) return
    const trimmed = msg.trim()
    setStreaming(true)

    setAgentEvents(prev => [
      ...prev,
      { role: 'user', content: trimmed },
      { role: 'agent', id: Date.now(), events: [] }
    ])

    // Create a new background task for this interaction
    try {
      const res = await api.post('/tasks', {
        prompt: trimmed,
        session_id: activeSession,
        temperature,
        max_tokens: maxTokens
      })

      // If this was a new session, pick up the ID from backend and refresh list
      if (!activeSession && res.data.session_id) {
        const newId = res.data.session_id
        setActiveSession(newId)
        api.get('/ai/sessions').then(r => setSessions(r.data)).catch(() => { })
      }

      // The task is now running. Real-time updates handled by daemon.onEvent ('task_log')
    } catch (err) {
      setStreaming(false)
      alert('Không thể tạo tác vụ: ' + err.message)
    }
  }

  const handleSend = async () => {
    const msg = input.trim()
    if (!msg) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    // If agent is currently running, inject the message as user intervention
    if (streaming && daemon.connected) {
      daemon.inject(msg)
      // Show the intervention in the UI
      setAgentEvents(prev => [
        ...prev,
        { role: 'user', content: `📝 ${msg}`, isIntervention: true }
      ])
      return
    }

    await sendAgentMessage(msg)
  }

  const handleCreateTask = async () => {
    const msg = input.trim()
    if (!msg || streaming) return
    try {
      await api.post('/tasks', {
        prompt: msg,
        temperature,
        max_tokens: maxTokens
      })
      setInput('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      navigate('/tasks')
    } catch (err) {
      alert('Lỗi tạo task chạy ngầm: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleStop = () => {
    if (daemon.connected) {
      daemon.cancel()
    } else {
      api.post('/agent/stop').catch(() => { })
    }
    setStreaming(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleSaveQuickPrompts = () => {
    setQuickPrompts([...tempQuickPrompts])
    localStorage.setItem('hatai_quick_prompts', JSON.stringify(tempQuickPrompts))
    setEditingQuickPrompts(false)
  }

  const handleCancelQuickPrompts = () => {
    setTempQuickPrompts([...quickPrompts])
    setEditingQuickPrompts(false)
  }

  const [sidebarOpen, setChatSidebarOpen] = useState(false)

  return (
    <div className="flex h-full relative overflow-hidden bg-white dark:bg-dark-950 transition-colors duration-150">
      {/* Sessions Sidebar - Responsive */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-72 bg-white dark:bg-dark-950 border-r border-light-200 dark:border-slate-800/50 flex flex-col transition-transform duration-150 md:relative md:translate-x-0
        ${sidebarOpen ? 'translate-x-0 shadow-2xl md:shadow-none' : '-translate-x-full'}
      `}>
        <div className="p-4 border-b border-light-200 dark:border-slate-800/50 flex items-center justify-between">
          <button id="new-chat-btn" onClick={() => { handleNewChat(); setChatSidebarOpen(false); }}
            className="flex-1 justify-center text-sm py-2.5 flex items-center gap-2 font-black uppercase tracking-widest rounded-xl
              bg-primary-600 hover:bg-primary-500 text-white shadow-lg shadow-primary-600/10 transition-all active:scale-95"
          >
            <Plus size={16} /> New Session
          </button>
          <button onClick={() => setChatSidebarOpen(false)} className="p-2 text-light-400 dark:text-slate-500 md:hidden ml-2 hover:bg-light-100 dark:hover:bg-dark-900 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          {sessions.map(s => (
            <SessionItem key={s.id} session={s} active={activeSession === s.id}
              onSelect={(id) => { handleSelectSession(id); setChatSidebarOpen(false); }}
              onDelete={handleDeleteSession} onRename={handleRenameSession} />
          ))}
          {sessions.length === 0 && <p className="text-center text-light-400 dark:text-slate-600 text-[10px] py-10 font-black uppercase tracking-widest opacity-40">No sessions found</p>}
        </div>
      </div>

      {/* Mobile Backdrop for Chat Sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden animate-fade-in backdrop-blur-[2px]"
          onClick={() => setChatSidebarOpen(false)}
        />
      )}

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-transparent">
        {/* Header */}
        <div className="flex items-center justify-between px-4 md:px-8 py-5 border-b border-light-200 dark:border-slate-800/50 bg-white/80 dark:bg-dark-950/80 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setChatSidebarOpen(true)} className="p-2 text-light-500 dark:text-slate-400 hover:bg-light-100 dark:hover:bg-dark-900 rounded-xl transition-all md:hidden">
              <Menu size={22} />
            </button>
            <div className="min-w-0">
              <p className="text-base md:text-lg font-black text-light-900 dark:text-white truncate flex items-center gap-2 tracking-tight">
                <span className="relative flex h-2.5 w-2.5">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${daemon.connected ? 'bg-emerald-400' : 'bg-red-400'} opacity-75`}></span>
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${daemon.connected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`}></span>
                </span>
                HatAI Smart Agent
              </p>
              <p className="text-[10px] text-light-500 dark:text-slate-600 uppercase tracking-[0.2em] font-black truncate hidden sm:block opacity-70">
                {daemon.connected ? (
                  <span className="text-emerald-600 dark:text-emerald-400">HatAI Active</span>
                ) : 'SSE Fallback'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Daemon controls */}
            {daemon.connected && daemon.daemonState === 'running' && (
              <button onClick={() => daemon.pause()} title="Pause daemon"
                className="p-2 text-amber-500 hover:bg-amber-500/10 rounded-xl transition-all">
                <Pause size={18} />
              </button>
            )}
            {daemon.connected && daemon.daemonState === 'paused' && (
              <button onClick={() => daemon.resume()} title="Resume daemon"
                className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-xl transition-all">
                <Play size={18} />
              </button>
            )}
            {/* Connection indicator */}
            <button onClick={() => setUseDaemon(!useDaemon)} title={useDaemon ? 'Daemon mode (click to switch to SSE)' : 'SSE mode (click to switch to Daemon)'}
              className={`p-2 rounded-xl transition-all ${useDaemon && daemon.connected ? 'text-emerald-500 hover:bg-emerald-500/10' : 'text-light-400 dark:text-dark-400 hover:bg-light-100 dark:hover:bg-dark-900'}`}>
              {daemon.connected ? <Wifi size={18} /> : <WifiOff size={18} />}
            </button>
          </div>
          <button id="chat-settings-btn" onClick={() => setShowSettings(!showSettings)}
            className={`p-2.5 rounded-xl transition-all duration-150 ${showSettings ? 'text-primary-600 bg-primary-600/10 rotate-90 scale-110 shadow-lg' : 'text-light-400 dark:text-dark-400 hover:text-light-900 dark:hover:text-white hover:bg-light-100 dark:hover:bg-dark-900'}`}
          >
            <Settings2 size={20} />
          </button>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-light-50 dark:bg-dark-900 border-b border-light-200 dark:border-slate-800/50 px-6 py-8 animate-fade-in shadow-inner overflow-y-auto max-h-[60vh] custom-scrollbar">
            <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-12">
              <div className="space-y-6 flex-shrink-0 md:w-64">
                <h4 className="font-black text-light-900 dark:text-slate-200 text-[10px] uppercase tracking-[0.2em] border-b border-light-200 dark:border-slate-800 pb-2 opacity-60">Engine Settings</h4>
                <div className="space-y-6">
                  <div>
                    <div className="flex justify-between mb-3 text-[11px] font-bold">
                      <label className="text-light-700 dark:text-slate-400">Temperature</label>
                      <span className="text-primary-600">{temperature}</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.1" value={temperature}
                      onChange={e => setTemperature(+e.target.value)} className="w-full accent-primary-600 h-1 bg-light-200 dark:bg-dark-800 rounded-full appearance-none cursor-pointer" />
                  </div>
                  <div>
                    <div className="flex justify-between mb-3 text-[11px] font-bold">
                      <label className="text-light-700 dark:text-slate-400">Context Limit</label>
                      <span className="text-primary-600">{maxTokens}</span>
                    </div>
                    <input type="range" min="256" max="8192" step="256" value={maxTokens}
                      onChange={e => setMaxTokens(+e.target.value)} className="w-full accent-primary-600 h-1 bg-light-200 dark:bg-dark-800 rounded-full appearance-none cursor-pointer" />
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-6">
                <h4 className="font-black text-light-900 dark:text-slate-200 text-[10px] uppercase tracking-[0.2em] border-b border-light-200 dark:border-slate-800 pb-2 opacity-60">Credentials</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="col-span-1">
                    <label className="block text-[11px] font-bold text-light-600 dark:text-slate-400 mb-2">Gemini API Key</label>
                    <input type="password" className="input-field w-full py-2.5 px-4 text-xs font-mono"
                      placeholder="AIzaSy..." value={geminiKey} onChange={e => setGeminiKey(e.target.value)} />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-[11px] font-bold text-light-600 dark:text-slate-400 mb-2">Ollama Host</label>
                    <input type="text" className="input-field w-full py-2.5 px-4 text-xs font-mono"
                      placeholder="http://localhost:11434" value={ollamaUrl} onChange={e => setOllamaUrl(e.target.value)} />
                  </div>
                  <div className="col-span-full">
                    <label className="block text-[11px] font-bold text-light-600 dark:text-slate-400 mb-2">Custom Base URL</label>
                    <div className="flex gap-3">
                      <input type="text" className="input-field flex-1 py-2.5 px-4 text-xs font-mono"
                        placeholder="http://127.0.0.1:8080/v1" value={openaiApiBase} onChange={e => setOpenaiApiBase(e.target.value)} />
                      <button onClick={handleSaveSettings} disabled={savingSettings}
                        className="bg-primary-600 hover:bg-primary-500 text-white px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 shadow-xl shadow-primary-600/20 active:scale-95">
                        {savingSettings ? <Loader2 size={16} className="animate-spin" /> : 'Apply'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Messages Container */}
        <div className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth">
          {agentEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-full py-20 px-6 animate-fade-in text-center">
              <div className="w-24 h-24 rounded-[42px] bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800 shadow-2xl flex items-center justify-center mb-12 transform hover:scale-105 transition-transform duration-150">
                <Bot size={48} className="text-primary-500" />
              </div>
              <h1 className="text-3xl md:text-5xl font-black text-light-900 dark:text-white tracking-tighter mb-4">How can I help you?</h1>
              <p className="max-w-md text-light-500 dark:text-slate-500 text-base md:text-lg font-medium leading-relaxed mb-16 opacity-80">
                Your autonomous agent is ready to build, search, and automate the web for you.
              </p>
              <div className="flex flex-col gap-6 w-full max-w-2xl">
                <div className="flex items-center justify-between px-2">
                  <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-light-400 dark:text-slate-600">Quick Actions</h2>
                  {!editingQuickPrompts ? (
                    <button onClick={() => setEditingQuickPrompts(true)} className="text-[10px] font-bold text-primary-500 hover:text-primary-400 transition-colors">Edit Suggestions</button>
                  ) : (
                    <div className="flex gap-4">
                      <button onClick={handleCancelQuickPrompts} className="text-[10px] font-bold text-light-500 hover:text-light-400 transition-colors">Cancel</button>
                      <button onClick={handleSaveQuickPrompts} className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 transition-colors">Save Changes</button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(editingQuickPrompts ? tempQuickPrompts : quickPrompts).map((prompt, idx) => (
                    <div key={idx} className="relative group">
                      {editingQuickPrompts ? (
                        <input
                          value={prompt}
                          onChange={(e) => {
                            const next = [...tempQuickPrompts]
                            next[idx] = e.target.value
                            setTempQuickPrompts(next)
                          }}
                          className="w-full bg-white dark:bg-dark-900 border-2 border-primary-500/30 rounded-[24px] px-7 py-5 text-sm font-bold text-light-800 dark:text-slate-200 outline-none focus:border-primary-500"
                        />
                      ) : (
                        <button onClick={() => {
                          // Thử lấy phần text sau emoji nếu có, nếu không thì lấy cả line
                          const clean = prompt.match(/^([^\w\s]{1,3})?\s*(.*)/)?.[2] || prompt
                          setInput(clean.trim())
                        }}
                          className="w-full flex items-center gap-4 bg-white dark:bg-dark-900/40 hover:bg-light-100 dark:hover:bg-dark-800 border border-light-200 dark:border-slate-800/60 
                            rounded-[24px] px-7 py-5 text-sm font-bold text-light-800 dark:text-slate-200 transition-all duration-150 shadow-sm active:scale-[0.98] text-left group"
                        >
                          <span className="text-2xl transition-transform group-hover:scale-125 duration-150">{prompt.match(/^([^\w\s]{1,3})/) ? prompt.match(/^([^\w\s]{1,3})/)[0] : '✨'}</span>
                          <span className="truncate flex-1 opacity-70 group-hover:opacity-100 transition-opacity">
                            {prompt.match(/^([^\w\s]{1,3})?\r?\n?\s*(.*)/)?.[2] || prompt}
                          </span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto w-full px-6 py-12 space-y-12">
              {agentEvents.map((msg, i) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id || i} className="flex gap-4 flex-row-reverse animate-slide-up group">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-light-100 dark:bg-dark-900 border border-light-200 dark:border-slate-800 shadow-sm transition-transform group-hover:scale-110">
                        <User size={20} className="text-light-400 dark:text-slate-500" />
                      </div>
                      <div className="max-w-[85%] bg-white dark:bg-dark-900/60 border border-light-200 dark:border-slate-800/40 rounded-[24px] px-6 py-4 shadow-sm">
                        <p className="text-base text-light-900 dark:text-slate-100 leading-relaxed whitespace-pre-wrap font-medium">
                          {msg.content.replace(/<\/?(?:think|thought)>[\s\S]*?(?:<\/?(?:think|thought)>|$)/gi, '').replace(/<\/?(?:think|thought)>/gi, '').trim()}
                        </p>
                      </div>
                    </div>
                  )
                }
                if (msg.role === 'agent') {
                  return (
                    <div key={msg.id || i} className="flex gap-4 animate-slide-up group">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-primary-600 border border-primary-500 shadow-lg shadow-primary-500/20 transition-transform group-hover:scale-110">
                        <Bot size={20} className="text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <AgentMessage events={msg.events || []} isStreaming={streaming && i === agentEvents.length - 1} />
                      </div>
                    </div>
                  )
                }
                return null
              })}
            </div>
          )}
          <div ref={messagesEndRef} className="h-32" />
        </div>

        {/* Floating Input Dock */}
        <div className="px-6 md:px-12 pb-10 pt-2 bg-gradient-to-t from-white via-white dark:from-dark-950 dark:via-dark-950 to-transparent">
          <div className="max-w-4xl mx-auto relative">
            <div className="relative flex flex-col bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800/60 rounded-[32px] shadow-2xl transition-all duration-150 focus-within:ring-4 focus-within:ring-primary-500/10 focus-within:border-primary-500/40 overflow-hidden">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 220) + 'px' }}
                onKeyDown={handleKeyDown}
                placeholder="Talk to HatAI..."
                className="w-full px-8 py-7 bg-transparent outline-none text-base md:text-lg text-light-900 dark:text-white placeholder-light-400 dark:placeholder-slate-600 resize-none max-h-60 custom-scrollbar font-medium"
                style={{ height: 'auto' }}
              />

              <div className="flex items-center justify-between px-8 pb-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/10 rounded-full">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <p className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest leading-none">System Stable</p>
                  </div>
                </div>

                {streaming ? (
                  <button onClick={handleStop}
                    className="flex-shrink-0 w-12 h-12 rounded-[22px] bg-red-500 text-white shadow-xl shadow-red-500/20 hover:bg-red-400 flex items-center justify-center transition-all animate-pulse">
                    <Square size={20} fill="currentColor" />
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={handleCreateTask} disabled={!input.trim()}
                      title="Chạy ngầm (Background Task)"
                      className="flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-[20px] md:rounded-[22px] bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500 hover:text-white flex items-center justify-center transition-all disabled:opacity-30 disabled:grayscale active:scale-90">
                      <Zap size={22} className={input.trim() ? "animate-in zoom-in-50 duration-150" : ""} />
                    </button>
                    <button onClick={handleSend} disabled={!input.trim()}
                      title="Gửi câu hỏi"
                      className="flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-[20px] md:rounded-[22px] bg-primary-600 text-white shadow-xl shadow-primary-600/30 hover:bg-primary-500 flex items-center justify-center transition-all disabled:opacity-20 disabled:grayscale disabled:scale-95 disabled:shadow-none active:scale-90">
                      <Send size={24} fill="currentColor" className={input.trim() ? "animate-in zoom-in-50 duration-150" : ""} />
                    </button>
                  </div>
                )}
              </div>
            </div>
            <p className="text-center text-[9px] text-light-500 dark:text-slate-500 mt-5 font-black uppercase tracking-[0.2em] opacity-40">HatAI Agent Powered by Advanced Reasoning Engine</p>
          </div>
        </div>
      </div>
    </div>
  )
}
