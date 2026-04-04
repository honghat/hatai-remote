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
  Wifi, WifiOff, Pause, Play, History, ListChecks, Activity, Eye, Layout, Search,
  Image as ImageIcon, AtSign, SquareSlash, Link2
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

function cleanLLMArtifacts(text) {
  if (!text) return text;
  return text
    .replace(/^[\}\s\n]*```[a-zA-Z0-9_#-]*\s*/, "") 
    .replace(/```\s*$/, "")
    .replace(/^[\}\s\n]+/, "")
    .replace(/^\{\s*"$/, "")
    .replace(/<\/?(?:tool|task|think|thought)>/gi, "")
    .trim();
}

// Loose JSON parser for malformed LLM outputs
function looseJsonParse(text) {
  if (!text) return null;
  text = text.trim();
  try { return JSON.parse(text); } catch {
    try {
      const fixed = text.replace(/(['"])?([a-z0-9A-Z_]+)(['"])?\s*:\s*/g, '"$2": ');
      return JSON.parse(fixed);
    } catch {
      const toolMatch = text.match(/"tool"\s*:\s*"([^"]+)"/);
      if (toolMatch) {
         const tool = toolMatch[1];
         const args = {};
         const kvMatches = text.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g);
         for (const m of kvMatches) if (m[1] !== 'tool') args[m[1]] = m[2];
         return { tool, args };
      }
    }
  }
  return null;
}

function parseEventsFromContent(content) {
  if (!content || typeof content !== 'string') return [];

  const events = [];
  let lastIndex = 0;

  const blockRegex = /(<(?:think|thought|tool|task)>[\s\S]*?<\/(?:think|thought|tool|task)>)|(🔧 \*\*.*?\*\*\(.*?\))|(📤 \*\*Result \(.*?\)\*\*: [\s\S]*?)(?=\n\n|\s*🔧|\s*📤 \*\*Result|\s*📸|\s*❌|$)|(\n?📸 Screenshot: .*?(?=\n|$))|(\n?❌ \*\*Error\*\*: .*?(?=\n|$))|(\n?```tool\s*\n?([\s\S]*?)\n?```)|(tool\s*\{[\s\S]*?\}(?=\s*(?:```|\n|$))|\{\s*"tool"\s*:[\s\S]*?\}(?=\s*(?:```|\n|$)))|(\[(?:read_file|list_dir|project_tree|search_code|edit_file|multi_edit_file|write_file|deep_search|run_command|sys_key|sys_click|browser_go|browser_read|screenshot)\]\s*.*?(?=\n|$))|(📋\s*KẾ\s*HOẠCH:[\s\S]*?)(?=\n\n|\s*🔧|\s*📤 \*\*Result|\s*📸|\s*❌|$)/gs;

  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const start = match.index;

    // Text part before block
    if (start > lastIndex) {
      const textPart = cleanLLMArtifacts(stripBase64FromText(content.slice(lastIndex, start).trim()));
      if (textPart && textPart !== '[image data removed]') {
        const { thinking, answer } = parseThinking(textPart);
        if (thinking) events.push({ type: 'thinking', content: thinking });
        if (answer) events.push({ type: 'text', content: answer });
        else if (!thinking) events.push({ type: 'text', content: textPart });
      }
    }

    if (match[1]) { // <think>, <tool>, <task>
      const tagMatch = match[1].match(/<(think|thought|tool|task)>([\s\S]*?)<\/\1>/i);
      if (tagMatch) {
        const tag = tagMatch[1].toLowerCase();
        const inner = tagMatch[2].trim();
        if (tag === 'think' || tag === 'thought') {
          events.push({ type: 'thinking', content: inner });
        } else if (tag === 'tool' || tag === 'task') {
          try {
            const data = JSON.parse(inner);
            if (data.tool) events.push({ type: 'tool_call', tool: data.tool, args: data.args || data });
            else if (data.task) events.push({ type: 'text', content: `🎯 Task: ${data.task}` });
          } catch {
            // Not JSON, treat as text but hide tags
            if (inner) events.push({ type: 'text', content: inner });
          }
        }
      }
    }
    else if (match[2]) { // 🔧 **tool**(JSON)
      const toolMatch = match[2].match(/🔧 \*\*(.*?)\*\*\((.*?)\)/s);
      if (toolMatch) {
        try {
          const tool = toolMatch[1].trim();
          const argsText = toolMatch[2].trim();
          let args = {};
          try { 
            args = JSON.parse(argsText); 
          } catch {
            // Loose parse for malformed args: "key": "value"
            const kvMatches = argsText.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g);
            for (const kv of kvMatches) args[kv[1]] = kv[2];
          }
          events.push({ type: 'tool_call', tool, args });
        } catch { events.push({ type: 'text', content: match[2].trim() }); }
      }
    }
    else if (match[3]) { // 📤 **Result (tool)**: JSON
      const resultMatch = match[3].match(/📤 \*\*Result \((.*?)\)\*\*: ([\s\S]*)/);
      if (resultMatch) {
        const tool = resultMatch[1].trim();
        let rawResult = resultMatch[2].trim();
        let result = rawResult;
        try {
          if (rawResult[0] === '{' || rawResult[0] === '[') {
            result = sanitizeResult(JSON.parse(rawResult));
          }
        } catch { }
        if (typeof result === 'string') result = stripBase64FromText(result);
        
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
    else if (match[4]) { // 📸 Screenshot: path
      const path = match[4].replace(/^\n?📸 Screenshot: /, '').trim();
      const filename = path.split('/').pop();
      events.push({ type: 'screenshot', url: `/agent/screenshots/${filename}` });
    }
    else if (match[5]) { // ❌ **Error**: content
      const errorText = match[5].replace(/^\n?❌ \*\*Error\*\*: /, '').trim();
      events.push({ type: 'error', content: errorText });
    }
    else if (match[6]) { // ```tool ... ```
      const toolData = looseJsonParse(match[7]);
      if (toolData?.tool) {
        events.push({ type: 'tool_call', tool: toolData.tool, args: toolData.args || toolData });
      } else { events.push({ type: 'text', content: match[6] }); }
    } else if (match[8]) {
      const toolData = looseJsonParse(match[8].replace(/^tool\s*/, ''));
      if (toolData?.tool) {
        events.push({ type: 'tool_call', tool: toolData.tool, args: toolData.args || toolData });
      } else { events.push({ type: 'text', content: match[8] }); }
    } else if (match[9]) {
      events.push({ type: 'step', content: match[9].trim() });
    } else if (match[10]) {
      events.push({ type: 'plan', content: match[10].trim() });
    }

    lastIndex = blockRegex.lastIndex;
  }

  // Handle remaining text
  if (lastIndex < content.length) {
    const raw = content.slice(lastIndex).trim();
    const remaining = cleanLLMArtifacts(stripBase64FromText(raw));
    
    if (remaining && remaining !== '[image data removed]') {
      const { thinking, answer } = parseThinking(remaining);
      if (thinking) events.push({ type: 'thinking', content: thinking });
      if (answer) events.push({ type: 'text', content: answer });
      else events.push({ type: 'text', content: remaining });
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
  const [expanded, setExpanded] = useState(false)
  
  // Tự động mở khi đang suy nghĩ, và thu gọn khi xong
  const showExpanded = isStreaming && !isThinkingComplete ? true : expanded

  useEffect(() => {
    if (!isStreaming && isThinkingComplete) {
      setExpanded(false)
    }
  }, [isStreaming, isThinkingComplete])

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
              ? 'bg-primary-600/10 border-primary-500/30 text-primary-700 dark:text-primary-300 ring-4 ring-primary-500/5'
              : 'bg-light-100 hover:bg-white border-light-200 text-light-500 dark:bg-slate-800/40 dark:border-slate-800/60 dark:text-slate-400 dark:hover:bg-slate-800/80 hover:shadow-md'}`}
        >
          <div className="relative">
            {isStreaming && !isThinkingComplete ? (
              <div className="absolute -inset-1.5 bg-primary-500/30 rounded-full animate-ping opacity-75" />
            ) : null}
            <div className={`p-1.5 rounded-lg ${showExpanded ? 'bg-primary-500/20 text-primary-600 dark:text-primary-400' : 'bg-light-200 dark:bg-slate-700/50'}`}>
              <BrainCircuit size={14} className={isStreaming && !isThinkingComplete ? 'animate-pulse' : ''} />
            </div>
          </div>
          <div className="flex flex-col items-start leading-tight">
            <span className="text-[10px] font-black uppercase tracking-[0.15em] opacity-60">Lộ trình suy nghĩ</span>
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
            <div className="absolute left-[22px] top-0 bottom-0 w-px bg-gradient-to-b from-primary-500/40 via-primary-500/10 to-transparent" />
            
            <div className="ml-10 py-1 pr-6">
              <div className="bg-primary-500/[0.03] dark:bg-primary-500/[0.05] border border-primary-500/10 dark:border-primary-500/20 backdrop-blur-md rounded-3xl p-5 shadow-inner">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {cleanThinking ? (
                    cleanThinking.split('\n').filter(l => l.trim()).map((line, idx) => {
                      const isBullet = /^[•\-\*]\s+/.test(line.trim());
                      const isNumber = /^\d+\.\s+/.test(line.trim());
                      const text = line.replace(/^[•\-\*\d\.\s]+/, '').trim();

                      if (isBullet || isNumber) {
                        return (
                          <div key={idx} className="flex gap-3 mb-3 last:mb-0 group/th-item">
                            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-500/10 flex items-center justify-center mt-0.5">
                              {isNumber ? (
                                <span className="text-[10px] font-black text-primary-500">{line.match(/^\d+/)[0]}</span>
                              ) : (
                                <div className="w-1.5 h-1.5 rounded-full bg-primary-500/40" />
                              )}
                            </div>
                            <p className="text-sm leading-relaxed text-light-700 dark:text-primary-100/70 font-medium break-words flex-1">
                              {text}
                            </p>
                          </div>
                        );
                      }
                      
                      return (
                        <p key={idx} className="text-sm leading-relaxed text-light-700 dark:text-primary-100/70 italic font-medium mb-3 last:mb-0 ml-8 opacity-80">
                          {line.trim()}
                        </p>
                      );
                    })
                  ) : (
                    <div className="flex items-center gap-3 text-primary-500/50 italic text-sm py-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce" />
                       <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce [animation-delay:-0.15s]" />
                       <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce [animation-delay:-0.3s]" />
                       <span>Khởi tạo luồng logic...</span>
                    </div>
                  )}
                </div>

                {isStreaming && !isThinkingComplete && cleanThinking && (
                  <div className="flex items-center gap-1 mt-4">
                    <span className="w-1 h-1 rounded-full bg-primary-500/60 animate-ping" />
                    <span className="text-[9px] uppercase tracking-widest font-black text-primary-500/40">Real-time Stream</span>
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
    <ReactMarkdown className="chat-markdown-content text-sm leading-relaxed font-medium break-words overflow-hidden"
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => {
          const text = String(children)
          const isTree = text.includes('├──') || text.includes('└──') || text.includes('│')
          if (isTree) {
            return (
              <div className="my-4 p-4 rounded-xl font-mono text-[12px] whitespace-pre overflow-x-auto bg-black/40 border border-white/5 text-primary-400/90 shadow-inner custom-scrollbar">
                {children}
              </div>
            )
          }
          return <p className="mb-4 last:mb-0 leading-relaxed">{children}</p>
        },
        table: ({ children }) => (
          <div className="my-6 overflow-x-auto rounded-[28px] border border-light-200 dark:border-white/5 shadow-2xl bg-white/[0.01] backdrop-blur-xl custom-scrollbar no-scrollbar scroll-smooth">
            <table className="w-full text-left border-collapse min-w-[400px]">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-[#f8f9fa] dark:bg-white/[0.03] border-b border-light-200 dark:border-white/5">
            {children}
          </thead>
        ),
        th: ({ children }) => (
          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.25em] text-primary-500 whitespace-nowrap">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-6 py-4 text-[13px] border-b border-light-100 dark:border-white/[0.01] text-light-900 dark:text-slate-300 font-medium">
            {children}
          </td>
        ),
        tr: ({ children }) => (
          <tr className="transition-all hover:bg-primary-500/[0.03] group/tr last:border-0">
            {children}
          </tr>
        ),
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
                  customStyle={{ margin: 0, borderRadius: '0 0 0.75rem 0.75rem', border: '1px solid', borderColor: 'inherit', borderTop: 'none', fontSize: '0.75rem' }}
                  className="border-light-300 dark:border-dark-800"
                  {...props}>{codeStr}</SyntaxHighlighter>
              </div>
            )
          }
          return <code className="bg-light-200 dark:bg-dark-950 border border-light-300 dark:border-dark-800 rounded px-1.5 py-0.5 text-xs font-mono text-primary-600 dark:text-primary-300" {...props}>{children}</code>
        },
      }}
    >{stripBase64FromText(content).trim()}</ReactMarkdown>
  )
})

// ── Tool Step ───────────────────────────────────────────────────────────────
const TOOL_META = {
  run_command: { icon: Terminal, label: 'Thực thi Shell', color: 'text-emerald-400', bg: 'bg-emerald-900/20' },
  read_file: { icon: FileText, label: 'Đọc tệp tin', color: 'text-blue-400', bg: 'bg-blue-900/20' },
  write_file: { icon: FileText, label: 'Khởi tạo tệp tin', color: 'text-purple-400', bg: 'bg-purple-900/20' },
  list_dir: { icon: FolderOpen, label: 'Duyệt thư mục', color: 'text-yellow-400', bg: 'bg-yellow-900/20' },
  screenshot: { icon: Camera, label: 'Ảnh chụp màn hình', color: 'text-pink-400', bg: 'bg-pink-900/20' },
  update_docs: { icon: BookOpen, label: 'Cơ sở kiến thức', color: 'text-cyan-400', bg: 'bg-cyan-900/20' },
  deep_search: { icon: Search, label: 'Truy vấn chuyên sâu', color: 'text-orange-400', bg: 'bg-orange-900/20' },
  web_search: { icon: Globe, label: 'Tra cứu thông tin', color: 'text-orange-400', bg: 'bg-orange-900/20' },
  read_web: { icon: Eye, label: 'Trích xuất Web', color: 'text-teal-400', bg: 'bg-teal-900/20' },
  edit_file: { icon: FileText, label: 'Cấu trúc lại tệp', color: 'text-amber-400', bg: 'bg-amber-900/20' },
  search_code: { icon: Terminal, label: 'Truy vấn mã nguồn', color: 'text-violet-400', bg: 'bg-violet-900/20' },
  find_files: { icon: FolderOpen, label: 'Định vị tệp tin', color: 'text-lime-400', bg: 'bg-lime-900/20' },
  browser_go: { icon: Globe, label: 'Điều hướng URL', color: 'text-indigo-400', bg: 'bg-indigo-900/20' },
  browser_read: { icon: Eye, label: 'Phân tích DOM', color: 'text-sky-400', bg: 'bg-sky-900/20' },
  sys_stats: { icon: Activity, label: 'Phân tích hệ thống', color: 'text-emerald-400', bg: 'bg-emerald-900/20' },
  project_tree: { icon: Layout, label: 'Kiến trúc dự án', color: 'text-blue-500', bg: 'bg-blue-900/20' },
  git_ops: { icon: History, label: 'Quản trị Git', color: 'text-pink-500', bg: 'bg-pink-900/20' },
  analyze_document: { icon: FileText, label: 'Phân tích tài liệu', color: 'text-indigo-500', bg: 'bg-indigo-900/20' },
}

// ── Roadmap ─────────────────────────────────────────────────────────────────
function Roadmap({ content, isDark }) {
  const lines = content.split('\n').filter(l => l.trim() && !l.includes('KẾ HOẠCH'))
  return (
    <div className={`my-6 overflow-hidden rounded-[28px] border transition-all duration-500 shadow-2xl relative ${isDark ? 'bg-slate-900/40 border-white/10 shadow-primary-500/5 backdrop-blur-xl' : 'bg-white border-slate-200 shadow-slate-200/50'}`}>
      <div className={`px-8 py-5 border-b flex items-center justify-between relative overflow-hidden ${isDark ? 'border-white/10' : 'bg-slate-50/50 border-slate-200'}`}>
        {isDark && <div className="absolute inset-0 bg-gradient-to-r from-primary-600/10 via-transparent to-transparent opacity-50" />}
        <div className="flex items-center gap-4 relative z-10">
          <div className="p-2.5 bg-primary-500/20 rounded-2xl text-primary-400 shadow-[0_0_15px_rgba(59,130,246,0.2)]"><ListChecks size={20} /></div>
          <div>
            <h4 className={`text-[15px] font-black uppercase tracking-[0.15em] ${isDark ? 'text-white' : 'text-slate-900'}`}>Lộ trình thực thi</h4>
            <p className="text-[10px] text-primary-500 font-black uppercase tracking-[0.2em] opacity-80">Autonomous Logic Workflow</p>
          </div>
        </div>
        <div className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest relative z-10 ${isDark ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}`}>
          Verified Path
        </div>
      </div>
      <div className="p-4 space-y-3">
        {lines.map((line, i) => {
          const toolMatch = line.match(/\[(.*?)\]\s*(.*)/)
          const tool = toolMatch ? toolMatch[1] : null
          const desc = toolMatch ? toolMatch[2] : line.trim().replace(/^[\d.-]+\s*/, '')
          const meta = tool ? TOOL_META[tool] : null
          const ToolIcon = meta?.icon || Zap
          
          return (
            <div key={i} className={`group flex items-start gap-4 p-3 rounded-2xl border transition-all duration-300 hover:scale-[1.01] ${isDark ? 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]' : 'bg-slate-50/50 border-slate-100 hover:bg-slate-50'}`}>
              <div className="flex flex-col items-center gap-1 mt-1">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300 ${meta ? (isDark ? 'bg-primary-500/20 text-primary-400' : 'bg-primary-100 text-primary-600') : (isDark ? 'bg-slate-800 text-slate-500' : 'bg-slate-200 text-slate-400')}`}>
                  <ToolIcon size={14} />
                </div>
                {i < lines.length - 1 && <div className={`w-0.5 h-6 rounded-full ${isDark ? 'bg-white/5' : 'bg-slate-200'}`} />}
              </div>
              <div className="flex-1 min-w-0">
                {tool && (
                  <span className={`text-[9px] font-black uppercase tracking-widest mb-1 block ${meta?.color || 'text-slate-500'}`}>
                    Step {i+1}: {meta?.label || tool}
                  </span>
                )}
                <p className={`text-[13px] leading-relaxed font-medium ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  {desc}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ToolStep = memo(function ToolStep({ step, isStreaming }) {
  const [expanded, setExpanded] = useState(false)
  
  // Auto-collapse when task is done or result is received
  useEffect(() => {
    if (step.result && !isStreaming) {
      setExpanded(false)
    }
  }, [step.result, isStreaming])

  const meta = TOOL_META[step.tool] || { icon: Zap, label: step.tool.replace('_', ' '), color: 'text-slate-400', bg: 'bg-light-100 dark:bg-slate-900/40 border-light-200 dark:border-slate-700/30' }
  const Icon = meta.icon

  const hasResult = !!step.result;
  const isError = step.result?.error || (step.result?.exit_code !== 0 && step.result?.exit_code !== undefined);

  return (
    <div className={`max-w-4xl group/tool transition-all duration-300 ${expanded ? 'mb-6' : 'mb-3'}`}>
      <div className={`relative border rounded-2xl overflow-hidden transition-all duration-300 
        ${expanded ? 'shadow-xl shadow-primary-500/5 ring-1 ring-white/10' : 'shadow-sm hover:shadow-md'} 
        ${meta.bg} ${expanded ? 'bg-opacity-95 dark:bg-opacity-40' : 'bg-opacity-40 dark:bg-opacity-5 hover:bg-opacity-60 dark:hover:bg-opacity-10'}`}
      >
        {/* Glow Effect when expanded */}
        {expanded && <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-none" />}
        
        <button onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-4 px-5 py-3 text-left transition-colors relative z-10"
        >
          {/* Status Indicator */}
          <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-500 shadow-inner
            ${hasResult ? (isError ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500') : 'bg-primary-500/10 text-primary-500 animate-pulse'}`}
          >
            {hasResult ? (
              isError ? <AlertCircle size={20} /> : <CheckCircle2 size={20} className="animate-in zoom-in duration-300" />
            ) : (
              <Icon size={20} className="animate-pulse" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-black tracking-[0.15em] uppercase ${meta.color} opacity-90`}>
                {meta.label}
              </span>
              {(step.args?.path || step.args?.command || step.args?.query) && (
                <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 max-w-[70%]">
                   <span className="text-[10px] font-mono opacity-40 truncate">
                      {step.args.path || step.args.command || step.args.query}
                   </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
             <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-none">
                {hasResult ? 'OK' : '...' }
             </div>
             <div className={`p-1 transition-all duration-300 ${expanded ? 'rotate-180 opacity-40' : 'opacity-20'}`}>
               <ChevronDown size={14} />
             </div>
          </div>
        </button>

        {expanded && (
          <div className="px-5 pb-5 space-y-4 animate-in slide-in-from-top-2 fade-in duration-300 relative z-10">
            {/* Divider */}
            <div className="h-px w-full bg-gradient-to-r from-transparent via-light-300 dark:via-white/10 to-transparent mb-4" />

            {/* Standard Outputs */}
            {step.result?.stdout && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] font-black text-emerald-500/60 uppercase tracking-widest">Output Log</span>
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-500/20" />
                    <div className="w-2 h-2 rounded-full bg-emerald-500/40" />
                    <div className="w-2 h-2 rounded-full bg-emerald-500/60 animate-pulse" />
                  </div>
                </div>
                <div className="bg-slate-950/90 rounded-2xl p-4 border border-emerald-500/20 shadow-inner group/out overflow-hidden relative">
                   <div className="absolute top-0 right-0 p-3 opacity-10 group-hover/out:opacity-20 transition-opacity">
                      <Terminal size={40} className="text-emerald-500" />
                   </div>
                  <pre className="text-[12px] text-emerald-400/95 font-mono whitespace-pre-wrap leading-relaxed break-words relative z-10" style={{ overflowWrap: 'anywhere' }}>
                    {step.result.stdout.trim()}
                  </pre>
                </div>
              </div>
            )}

            {step.result?.stderr && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-black text-red-500/60 uppercase tracking-widest px-1">Runtime Exceptions</span>
                <div className="bg-red-950/20 rounded-2xl p-4 border border-red-500/30 relative overflow-hidden">
                  <div className="absolute inset-0 bg-red-500/[0.02] animate-pulse" />
                  <pre className="text-[12px] text-red-400/90 font-mono whitespace-pre-wrap leading-relaxed break-words relative z-10" style={{ overflowWrap: 'anywhere' }}>
                    {step.result.stderr.trim()}
                  </pre>
                </div>
              </div>
            )}

            {step.result?.content && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-black text-blue-500/60 uppercase tracking-widest px-1">Buffer Content</span>
                <div className="bg-slate-950/80 rounded-2xl p-4 border border-blue-500/20 max-h-96 overflow-y-auto custom-scrollbar shadow-inner">
                  <pre className="text-[12px] text-blue-100/80 font-mono whitespace-pre-wrap leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>
                    {step.result.content}
                  </pre>
                </div>
              </div>
            )}

            {/* List Results (Grid Style) */}
            {step.result?.items && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-950/40 rounded-2xl p-3 border border-white/5 max-h-60 overflow-y-auto">
                {step.result.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 px-3 hover:bg-white/[0.03] rounded-xl transition-all border border-transparent hover:border-white/5 group/item">
                    <div className={`p-1.5 rounded-lg ${item.is_dir ? 'bg-yellow-500/10 text-yellow-500' : 'bg-slate-500/10 text-slate-500'} transition-transform group-hover/item:scale-110`}>
                      {item.is_dir ? <FolderOpen size={14} /> : <FileText size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                       <p className="text-[11px] text-slate-300 font-medium truncate">{item.name}</p>
                       {item.size !== undefined && <p className="text-[9px] text-slate-500 font-mono uppercase">{(item.size / 1024).toFixed(1)} KB</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* General Results (Message/Status) */}
            {step.result?.message && !step.result.items && !step.result.results && !step.result.content && !step.result.stdout && (
              <div className="flex items-start gap-4 bg-white/[0.02] dark:bg-black/20 rounded-2xl p-4 border border-white/5 shadow-inner">
                <div className="w-1.5 h-1.5 rounded-full bg-primary-500 mt-1.5 animate-pulse" />
                <p className="text-[12px] text-light-600 dark:text-slate-400 leading-relaxed font-medium">
                  {step.result.message}
                </p>
              </div>
            )}

            {/* Search results (Premium Cards) */}
            {step.result?.results && (
              <div className="grid grid-cols-1 gap-3">
                {step.result.results.map((r, i) => {
                  let hostname = 'Web'
                  try { if(r.url) hostname = new URL(r.url).hostname.replace('www.', '') } catch { }
                  
                  return (
                    <div key={i} className="group/res block bg-white/40 dark:bg-slate-900/40 p-5 rounded-[1.5rem] border border-light-200 dark:border-slate-800/40 hover:border-primary-500/40 hover:shadow-2xl hover:shadow-primary-500/10 transition-all relative overflow-hidden animate-slide-in" style={{ animationDelay: `${i * 0.1}s` }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-inner">
                            <Globe size={16} />
                          </div>
                          <div>
                            <p className="text-[10px] text-primary-500 font-black uppercase tracking-[0.2em]">{hostname}</p>
                            <h4 className="text-[13px] text-light-900 dark:text-white font-bold line-clamp-1 group-hover/res:text-primary-500 transition-colors">{r.title}</h4>
                          </div>
                        </div>
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noopener noreferrer" className="p-2.5 bg-light-100 hover:bg-primary-500 hover:text-white dark:bg-slate-800/60 dark:hover:bg-primary-600 rounded-xl transition-all shadow-sm">
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                      
                      <p className="text-[12px] text-light-500 dark:text-slate-400 leading-relaxed line-clamp-2 opacity-80 mb-3">
                        {r.snippet || r.content?.substring(0, 160) + '...'}
                      </p>

                      {r.content && (
                         <details className="group/details border-t border-light-100 dark:border-slate-800/40 pt-3">
                            <summary className="list-none cursor-pointer flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-light-400 dark:text-slate-500 hover:text-primary-500 transition-colors">
                               <ChevronRight size={12} className="group-open/details:rotate-90 transition-transform" />
                               View Extracted Intel
                            </summary>
                            <div className="mt-3 p-4 bg-light-50 dark:bg-black/20 rounded-2xl border border-light-100 dark:border-white/5 text-[11px] text-light-600 dark:text-slate-400 font-medium leading-relaxed max-h-48 overflow-y-auto custom-scrollbar italic whitespace-pre-wrap">
                               {r.content}
                            </div>
                         </details>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Error fallback */}
            {step.result?.error && !step.result?.stderr && (
              <div className="flex items-center gap-3 bg-red-500/10 p-4 rounded-2xl border border-red-500/20 text-red-400 shadow-inner">
                <AlertCircle size={18} className="flex-shrink-0" />
                <span className="text-xs font-bold leading-relaxed">{step.result.error}</span>
              </div>
            )}
          </div>
        )}
      </div>
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

    events.forEach((ev, idx) => {
      const isLast = idx === events.length - 1

      if (ev.type === 'thinking') {
        const clean = ev.content.replace(/<\/?(?:think|thought)>/gi, '').trim()
        if (clean && !thoughts.includes(clean)) thoughts.push(clean)
      } else if (ev.type === 'thinking_token') {
        const clean = ev.content || ""
        if (clean) {
          // Streaming logic: append to last thought if it's also a token, or start new
          if (isStreaming && isLast) isThinkingStreaming = true
          
          if (thoughts.length > 0) {
            thoughts[thoughts.length - 1] += clean
          } else {
            thoughts.push(clean)
          }
        }
      } else if (ev.type === 'text') {
        // Detect "📋 KẾ HOẠCH" which comes as text in live runs
        if (ev.content && ev.content.includes('📋 KẾ HOẠCH')) {
          others.push({ ...ev, type: 'plan' })
          return
        }

        const { thinking, answer, isThinkingComplete } = parseThinking(ev.content)
        if (thinking) {
          const clean = thinking.replace(/<\/?(?:think|thought)>/gi, '').trim()
          if (clean && !thoughts.includes(clean)) thoughts.push(clean)
          if (isStreaming && isLast && !isThinkingComplete) isThinkingStreaming = true
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
      } else {
        // tool_call, screenshot, plan, error, step
        others.push(ev)
      }
    })

    // Final cleanup of thinking content (remove duplicates and markdown-style tags)
    const uniqueThoughts = thoughts.map(t => t.replace(/<\/?(?:think|thought)>/gi, '').trim()).filter(Boolean)

    return {
      thinkingContent: uniqueThoughts.join('\n\n'),
      otherItems: others,
      isThinkingStreaming
    }
  }, [events, isStreaming])

  return (
    <div className="flex-1 min-w-0 space-y-4 pt-1 break-words overflow-hidden">
      {(thinkingContent || (isStreaming && isThinkingStreaming)) && (
        <ThinkingBlock
          thinking={thinkingContent}
          isStreaming={isThinkingStreaming}
          isThinkingComplete={!isThinkingStreaming}
        />
      )}

      {(() => {
        // Track how many times each tool has been called so far (for correct result pairing)
        const toolCallCounters = {}
        return otherItems.map((item, i) => {
          switch (item.type) {
            case 'tool_call': {
              // Count which occurrence of this tool this call is
              const callIdx = toolCallCounters[item.tool] ?? 0
              toolCallCounters[item.tool] = callIdx + 1
              // Find the Nth matching tool_result (in events order)
              let matchCount = 0
              const resultEv = events.find(e => {
                if (e.type !== 'tool_result' || e.tool !== item.tool) return false
                return matchCount++ === callIdx
              })
              return <ToolStep key={i} step={{ tool: item.tool, args: item.args, result: resultEv?.result }} isStreaming={isStreaming} />
            }
            case 'screenshot':
              return <ScreenshotBlock key={i} url={item.url} base64={item.base64} path={item.path} />
            case 'step':
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3 mb-6 rounded-2xl border animate-fade-in bg-primary-500/10 border-primary-500/20 text-primary-400">
                  <div className="p-1.5 bg-primary-500/20 rounded-lg"><Activity size={14} className="animate-pulse" /></div>
                  <span className="text-[11px] font-black uppercase tracking-widest leading-none">{item.content}</span>
                </div>
              )
            case 'answer':
              return (
                <div key={i} className="chat-bubble-ai max-w-none text-light-900 dark:text-white leading-relaxed font-medium">
                  <ChatMarkdown content={item.content} />
                </div>
              )
            case 'plan':
              return <Roadmap key={i} content={item.content} isDark={document.documentElement.classList.contains('dark')} />
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
        })
      })()}
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
        ${active ? 'bg-primary-600/10 dark:bg-primary-600/15 border border-primary-500/20' : 'hover:bg-light-200 dark:hover:bg-slate-800/50'}`}
    >
      <Zap size={14} className={`flex-shrink-0 ${active ? 'text-primary-600 dark:text-primary-400' : 'text-light-400 dark:text-slate-500'}`} />
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
          <span className={`block text-xs truncate ${active ? 'text-primary-700 dark:text-white font-medium' : 'text-light-600 dark:text-slate-400'}`}>
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
  // Model parameters (read from global settings in localStorage)
  const [temperature] = useState(() => Number(localStorage.getItem('hatai_temp')) || 0.7)
  const [maxTokens] = useState(() => Number(localStorage.getItem('hatai_tokens')) || 4096)
  const [showSettings, setShowSettings] = useState(false)
  const [useDaemon, setUseDaemon] = useState(true)
  const [attachments, setAttachments] = useState([])
  const [isUploadingMedia, setIsUploadingMedia] = useState(false)
  const [isContextOpen, setIsContextOpen] = useState(false)
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
      // ── Legacy wrapper format (task_log) ───────────────────────────
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

      // ── Raw daemon events (broadcast directly from AgentDaemon) ────
      // Filter by session_id:
      //   - If the event has a session_id, only process it for the matching session
      //   - If the event has no session_id (null), only process it when currentSession is also null
      const evSessionId = event.session_id ?? null
      const currentSession = activeSessionRef.current
      if (evSessionId !== null && evSessionId !== currentSession) return
      if (evSessionId === null && currentSession !== null) return

      switch (event.type) {
        case 'session':
          // New session created — update active session
          if (!currentSession && event.session_id) {
            setActiveSession(event.session_id)
            activeSessionRef.current = event.session_id
            api.get('/ai/sessions').then(r => setSessions(r.data)).catch(() => {})
          }
          return

        case 'done':
          setStreaming(false)
          return

        case 'daemon_status':
        case 'heartbeat':
        case 'ack':
        case 'user_inject':
          // UI-level events, not agent content
          return

        case 'tool_call':
        case 'tool_result':
        case 'tool_result_screenshot':
        case 'screenshot':
        case 'text':
        case 'thinking':
        case 'thinking_token':
        case 'error':
          // Route raw agent content events into the last agent message
          setAgentEvents(prev => mergeEvent(prev, event))
          return

        default:
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
        if (m.role === 'user') {
          let attachments = []
          try {
            if (m.attachments) attachments = JSON.parse(m.attachments)
          } catch (e) {
            console.error('Lỗi parse attachments:', e)
          }
          return { role: 'user', content: m.content, id: m.id, attachments }
        }
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

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setIsUploadingMedia(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const resp = await api.post('/ai/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      setAttachments(prev => [...prev, resp.data])
      setIsContextOpen(false)
    } catch (err) {
      alert('Upload failed: ' + err.message)
    } finally {
      setIsUploadingMedia(false)
    }
  }

  // ── Send message to Agent ─────────────────────────────────────────────
  const sendAgentMessage = async (msg) => {
    if (!msg?.trim() || streaming) return
    const trimmed = msg.trim()
    setStreaming(true)

    setAgentEvents(prev => [
      ...prev,
      { role: 'user', content: trimmed, attachments: [...attachments] },
      { role: 'agent', id: Date.now(), events: [] }
    ])

    // Create a new background task for this interaction
    try {
      const res = await api.post('/tasks', {
        prompt: trimmed,
        session_id: activeSession,
        attachments: attachments,
        temperature,
        max_tokens: maxTokens
      })

      // If this was a new session, pick up the ID from backend and refresh list
      if (!activeSession && res.data.session_id) {
        const newId = res.data.session_id
        // Update ref IMMEDIATELY so daemon events for this session aren't filtered out
        // before React re-render propagates the new state value
        activeSessionRef.current = newId
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
    if (!msg && attachments.length === 0) return
    setInput('')
    setAttachments([])
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
        attachments: attachments,
        temperature,
        max_tokens: maxTokens
      })
      setInput('')
      setAttachments([])
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
            className="flex-1 justify-center text-xs py-3 flex items-center gap-2 font-black uppercase tracking-wider rounded-lg
              bg-primary-600 hover:bg-primary-500 text-white shadow-lg shadow-primary-600/10 transition-all active:scale-95"
          >
            <Plus size={14} /> Cuộc hội thoại mới
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
          {sessions.length === 0 && <p className="text-center text-light-700 dark:text-slate-500 text-[10px] py-10 font-bold uppercase tracking-widest opacity-60">Không tìm thấy phiên nào</p>}
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
        {/* Mobile Header - Compact version */}
        <div className="flex md:hidden items-center justify-between px-4 py-3 border-b border-light-200 dark:border-slate-800/40 bg-white/80 dark:bg-dark-950/80 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center shadow-lg shadow-primary-500/20 relative">
              <Bot size={16} className="text-white" />
              <div className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white dark:border-dark-900 ${daemon.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
            </div>
            <div className="flex items-center gap-1.5">
               <span className="text-[10px] font-black uppercase tracking-widest opacity-40">HatAI Chat</span>
               <div className={`w-1 h-1 rounded-full ${daemon.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setChatSidebarOpen(true)} className="p-2 text-light-500 dark:text-slate-400 hover:bg-light-100 dark:hover:bg-dark-900 rounded-lg transition-all" title="History">
              <History size={20} />
            </button>
            <button onClick={handleNewChat} className="p-2 text-light-500 dark:text-slate-400 hover:bg-light-100 dark:hover:bg-dark-900 rounded-lg transition-all" title="New Session">
              <Plus size={20} />
            </button>
          </div>
        </div>

        {/* Desktop Header */}
        <div className="hidden md:flex items-center justify-between px-4 md:px-8 py-4 border-b border-light-200 dark:border-slate-800/50 bg-white/80 dark:bg-dark-950/80 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-3">
              <p className="text-base md:text-lg font-black text-light-900 dark:text-white truncate flex items-center gap-2 tracking-tight">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${daemon.connected ? 'bg-emerald-400' : 'bg-red-400'} opacity-75`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${daemon.connected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                </span>
                Bích Lạc
              </p>
              <div title={daemon.connected ? 'Connected' : 'Offline'}
                className={`p-1.5 rounded-lg border transition-all ${daemon.connected ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 'bg-light-100 dark:bg-dark-900 border-light-200 dark:border-slate-800 text-light-400 dark:text-dark-400'}`}>
                {daemon.connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              </div>
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
          </div>
        </div>


        {/* Messages Container */}
        <div className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth">
          {agentEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-start min-h-full pt-48 pb-20 px-6 animate-fade-in text-center">
              <div className="flex flex-col gap-4 w-full max-w-2xl">
                <div className="flex items-center justify-between px-2">
                  <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-light-500 dark:text-slate-600">Gợi ý nhanh</h2>
                  {!editingQuickPrompts ? (
                    <button onClick={() => setEditingQuickPrompts(true)} className="text-[10px] font-bold text-primary-500 hover:text-primary-400 transition-colors">Sửa gợi ý</button>
                  ) : (
                    <div className="flex gap-4">
                      <button onClick={handleCancelQuickPrompts} className="text-[10px] font-bold text-light-500 hover:text-light-400 transition-colors">Hủy</button>
                      <button onClick={handleSaveQuickPrompts} className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 transition-colors">Lưu</button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                          className="w-full bg-white dark:bg-dark-900 border-2 border-primary-500/30 rounded-2xl px-4 py-2.5 text-xs font-bold text-light-800 dark:text-slate-200 outline-none focus:border-primary-500"
                        />
                      ) : (
                        <button onClick={() => {
                          // Thử lấy phần text sau emoji nếu có, nếu không thì lấy cả line
                          const clean = prompt.match(/^([^\w\s]{1,3})?\s*(.*)/)?.[2] || prompt
                          setInput(clean.trim())
                        }}
                          className="w-full flex items-center gap-3 bg-white dark:bg-dark-900/40 hover:bg-light-100 dark:hover:bg-dark-800 border border-slate-200 dark:border-slate-800/60 
                            rounded-2xl px-5 py-3 text-xs font-bold text-light-800 dark:text-slate-200 transition-all duration-150 shadow-sm active:scale-[0.98] text-left group"
                        >
                          <span className="text-lg transition-transform group-hover:scale-110 duration-150 flex-shrink-0">{prompt.match(/^([^\w\s]{1,3})/) ? prompt.match(/^([^\w\s]{1,3})/)[0] : '✨'}</span>
                          <span className="truncate flex-1 min-w-0 opacity-70 group-hover:opacity-100 transition-opacity">
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
                      <div className="max-w-[85%] flex flex-col items-end gap-3">
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 justify-end">
                            {msg.attachments.map((file, idx) => (
                              <div key={idx} className="relative group w-20 h-20 rounded-[22px] overflow-hidden border border-light-200 dark:border-slate-800 shadow-sm">
                                {file.type?.startsWith('image') ? <img src={file.url} className="w-full h-full object-cover" /> : <div className="flex flex-col items-center justify-center h-full gap-1 opacity-40 bg-light-50 dark:bg-dark-900"><FileCode size={16}/><span className="text-[7px] uppercase font-black">File</span></div>}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="bg-white dark:bg-dark-900/60 border border-light-200 dark:border-slate-800/40 rounded-[24px] px-6 py-4 shadow-sm">
                          <p className="text-base text-light-900 dark:text-slate-100 leading-relaxed whitespace-pre-wrap font-medium">
                            {msg.content.replace(/<\/?(?:think|thought)>[\s\S]*?(?:<\/?(?:think|thought)>|$)/gi, '').replace(/<\/?(?:think|thought)>/gi, '').trim()}
                          </p>
                        </div>
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
        <div className="px-6 md:px-12 pb-8 pt-2 bg-gradient-to-t from-white via-white dark:from-dark-950 dark:via-dark-950 to-transparent">
          <div className="max-w-3xl mx-auto relative">
            <div className="relative flex flex-col bg-white dark:bg-dark-900 border border-slate-200 dark:border-slate-800/60 rounded-3xl shadow-xl transition-all duration-150 focus-within:ring-4 focus-within:ring-primary-500/10 focus-within:border-primary-500/40">
              {attachments.length > 0 && (
                <div className="flex gap-4 px-8 pt-6 overflow-x-auto custom-scrollbar-h pb-2">
                  {attachments.map((file, idx) => (
                    <div key={idx} className="relative group shrink-0">
                      <div className="w-20 h-20 rounded-[22px] overflow-hidden border border-light-200 dark:border-slate-800 shadow-lg">
                        {file.type?.startsWith('image') ? <img src={file.url} className="w-full h-full object-cover" /> : <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40 bg-light-50 dark:bg-dark-900"><FileCode size={20}/><span className="text-[8px] uppercase font-black">File</span></div>}
                      </div>
                      <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 opacity-0 group-hover:opacity-100 transition-all"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px' }}
                onKeyDown={handleKeyDown}
                placeholder="Nhắn với Bích Lạc..."
                className="w-full px-6 py-4 bg-transparent outline-none text-sm md:text-base text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 resize-none max-h-52 custom-scrollbar font-medium"
                style={{ height: 'auto' }}
              />

              <div className="flex items-center justify-between px-6 pb-4">
                <div className="flex items-center gap-3 relative">
                  <input type="file" id="chat-media-upload" className="hidden" onChange={handleFileUpload} accept="image/*,application/pdf" />
                  
                  {/* Elite Context Trigger */}
                  <button 
                    onClick={(e) => { e.stopPropagation(); setIsContextOpen(!isContextOpen); }} 
                    className={`group/plus w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-500 active:scale-95 border ${
                      isContextOpen 
                        ? 'bg-primary-600 border-primary-400 text-white shadow-[0_0_20px_rgba(59,130,246,0.5)]' 
                        : 'bg-white/5 border-white/10 text-slate-500 hover:text-white hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    {isUploadingMedia ? (
                      <Activity size={18} className="animate-spin text-primary-400" />
                    ) : (
                      <Plus size={20} className={`transition-transform duration-500 ${isContextOpen ? 'rotate-45' : 'group-hover/plus:rotate-90'}`} />
                    )}
                  </button>

                  {/* Premium Context Menu */}
                  {isContextOpen && (
                    <>
                      <div className="fixed inset-0 z-[800]" onClick={() => setIsContextOpen(false)} />
                      <div className="absolute bottom-[calc(100%+20px)] left-0 w-72 p-2 rounded-[32px] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[900] animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300 backdrop-blur-2xl bg-slate-900/90 overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-primary-500/10 via-transparent to-transparent opacity-50 pointer-events-none" />
                        <div className="relative z-10">
                          <div className="px-5 py-3 flex items-center justify-between border-b border-white/5 mb-2">
                            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary-500">Phân tích bối cảnh</span>
                            <div className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
                          </div>
                          
                          <div className="space-y-1 p-1">
                            <button onClick={() => document.getElementById('chat-media-upload').click()} className="w-full group/item flex items-center gap-4 px-4 py-3.5 rounded-[24px] hover:bg-white/5 transition-all duration-300 text-slate-400 hover:text-white">
                              <div className="w-10 h-10 rounded-2xl bg-orange-500/10 flex items-center justify-center group-hover/item:scale-110 transition-transform duration-300">
                                <ImageIcon size={20} className="text-orange-500" />
                              </div>
                              <div className="flex flex-col items-start leading-tight">
                                <span className="text-[14px] font-bold">Media & Tệp</span>
                                <span className="text-[10px] opacity-40 font-medium">Đính kèm hình ảnh & tài liệu</span>
                              </div>
                            </button>


                          </div>
                        </div>
                      </div>
                    </>
                  )}

                </div>

                {streaming ? (
                  <button onClick={handleStop}
                    className="flex-shrink-0 w-12 h-12 rounded-[22px] bg-red-500 text-white shadow-xl shadow-red-500/20 hover:bg-red-400 flex items-center justify-center transition-all animate-pulse">
                    <Square size={20} fill="currentColor" />
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <button onClick={handleSend} disabled={!input.trim() && attachments.length === 0}
                      title="Gửi câu hỏi"
                      className="flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-xl bg-primary-600 text-white shadow-[0_10px_30px_rgba(37,99,235,0.3)] hover:bg-primary-500 hover:scale-105 flex items-center justify-center transition-all duration-300 disabled:opacity-20 disabled:grayscale disabled:scale-95 disabled:shadow-none active:scale-90">
                      <Send size={20} fill="currentColor" className={(input.trim() || attachments.length > 0) ? "animate-in zoom-in-50 duration-150" : ""} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
