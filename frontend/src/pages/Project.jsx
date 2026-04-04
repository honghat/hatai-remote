import React, { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import api, { codeApi } from '../api'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'
import Editor from 'react-simple-code-editor'
import { highlight, languages } from 'prismjs/components/prism-core'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-markup'
import 'prismjs/themes/prism-tomorrow.css'
import ModelStatusBadge from '../components/ModelStatusBadge'
import { 
  FileCode, Search, ChevronRight, Activity,
  Wand2, Copy, Save, X, History, Settings, Brain, Trash2,
  Sparkles, ChevronDown, Monitor, RotateCcw, Plus, Mic, ArrowRight,
  GitBranch, ExternalLink, Cpu, Zap, Server, BrainCircuit, Check,
  Image as ImageIcon, AtSign, SquareSlash, Menu, LogOut, Code2, ListTodo, Clock, Puzzle, Bot, Sun, Moon,
  MessageSquare, Link2, FileText, CheckCircle2, AlertCircle, Globe, Pause, Play, Terminal, Camera, BookOpen, FolderOpen,
  ListChecks, FilePlus, FileEdit, FileStack, ListTree, SearchCode, Code
} from 'lucide-react'

const NAV_ITEMS = [
  { path: '/chat', label: 'AI Agent', icon: Zap },
  { path: '/tasks', label: 'Background Tasks', icon: ListTodo },
  { path: '/schedules', label: 'Tác vụ Định kỳ', icon: Clock },
  { path: '/terminal', label: 'SSH Terminal', icon: Monitor },
  { path: '/project', label: 'HatAI Code', icon: Code2 },
  { path: '/skills', label: 'Agent Skills', icon: Puzzle },
  { path: '/brain', label: 'Brain & Memory', icon: Brain },
]

// ── Utility: strip base64 and image-related keys from a parsed result object
function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return result;
  const clean = {};
  for (const [k, v] of Object.entries(result)) {
    if (k === 'base64' || k === '_frontend_screenshot' || k === '_frontend_screenshot_path') continue;
    if (typeof v === 'string' && v.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(v.slice(0, 100))) continue;
    clean[k] = v;
  }
  return clean;
}

// Helper: remove inline base64 blobs from raw text
function stripBase64FromText(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/(?:data:image\/[^;]+;base64,)?[A-Za-z0-9+/]{500,}={0,2}/g, '[image data removed]');
}

// Parse thinking blocks and answer from content
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
    if (!match[0].includes('</think>') && !match[0].includes('</thought>')) {
      isThinkingComplete = false;
    }
    lastEnd = thinkRegex.lastIndex;
  }
  let answer = content
    .replace(/<(?:think|thought)>[\s\S]*?(?:<\/(?:think|thought)>|$)/gi, '')
    .replace(/<\/?(?:think|thought)>/gi, '')
    .trim();
  return { thinking: fullThinking.trim(), answer: answer, isThinkingComplete };
}

// Robust agent content sanitizer
function cleanAgentContent(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<(?:think|thought|tool|task)>[\s\S]*?<\/(?:think|thought|tool|task)>/gi, '')
    .replace(/<\/(?:tool|task|think|thought)>/gi, '')
    .replace(/```tool\s*\n[\s\S]*?\n```/g, '')
    .replace(/```json\s*\n\s*\[?\s*\{"tool"[\s\S]*?\n```/g, '')
    .replace(/^\s*\{"tool":\s*"[^"]*",\s*"args":\s*\{[^}]*\}\s*\}\s*$/gm, '')
    .trim();
}

// Loose JSON parser for malformed LLM outputs
function looseJsonParse(text) {
  if (!text) return null;
  text = text.trim();
  try { return JSON.parse(text); } catch {
    try {
      // Handle "tool": "name" without braces if needed (rare)
      const fixed = text.replace(/(['"])?([a-z0-9A-Z_]+)(['"])?\s*:\s*/g, '"$2": ');
      return JSON.parse(fixed);
    } catch {
      // Final fallback: regex extract
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

function parseEventsFromContent(content) {
  if (!content || typeof content !== 'string') return [];
  const events = [];
  let lastIndex = 0;
  const blockRegex = /(<(?:think|thought|tool|task)>[\s\S]*?<\/(?:think|thought|tool|task)>)|(🔧 \*\*.*?\*\*\(.*?\))|(📤 \*\*Result \(.*?\)\*\*: [\s\S]*?)(?=\n\n|\s*🔧|\s*📤 \*\*Result|\s*📸|\s*❌|$)|(\n?📸 Screenshot: .*?(?=\n|$))|(\n?❌ \*\*Error\*\*: .*?(?=\n|$))|(\n?```tool\s*\n?([\s\S]*?)\n?```)|(tool\s*\{[\s\S]*?\}(?=\s*(?:```|\n|$))|\{\s*"tool"\s*:[\s\S]*?\}(?=\s*(?:```|\n|$)))|(\[(?:read_file|list_dir|project_tree|search_code|edit_file|multi_edit_file|write_file|deep_search|run_command|sys_key|sys_click|browser_go|browser_read|screenshot)\]\s*.*?(?=\n|$))|(📋\s*KẾ\s*HOẠCH:[\s\S]*?)(?=\n\n|\s*🔧|\s*📤 \*\*Result|\s*📸|\s*❌|$)/gs;

  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      const textPart = cleanLLMArtifacts(stripBase64FromText(content.slice(lastIndex, start).trim()));
      if (textPart && textPart !== '[image data removed]') {
        const { thinking, answer } = parseThinking(textPart);
        if (thinking) events.push({ type: 'thinking', content: thinking });
        if (answer) events.push({ type: 'text', content: answer });
        else if (!thinking) events.push({ type: 'text', content: textPart });
      }
    }
    if (match[1]) {
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
            if (inner) events.push({ type: 'text', content: inner });
          }
        }
      }
    } else if (match[2]) {
      const toolMatch = match[2].match(/🔧 \*\*(.*?)\*\*\((.*?)\)/s);
      if (toolMatch) {
        try {
          const tool = toolMatch[1].trim();
          const argsText = toolMatch[2].trim();
          let args = {};
          try { args = JSON.parse(argsText); } catch {
            const kvMatches = argsText.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g);
            for (const kv of kvMatches) args[kv[1]] = kv[2];
          }
          events.push({ type: 'tool_call', tool, args });
        } catch { events.push({ type: 'text', content: match[2].trim() }); }
      }
    } else if (match[3]) {
      const resultMatch = match[3].match(/📤 \*\*Result \((.*?)\)\*\*: ([\s\S]*)/);
      if (resultMatch) {
        const tool = resultMatch[1].trim();
        let rawResult = resultMatch[2].trim();
        let result = rawResult;
        try { if (rawResult[0] === '{' || rawResult[0] === '[') result = sanitizeResult(JSON.parse(rawResult)); } catch { }
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
    } else if (match[4]) {
      const path = match[4].replace(/^\n?📸 Screenshot: /, '').trim();
      const filename = path.split('/').pop();
      events.push({ type: 'screenshot', url: `/agent/screenshots/${filename}` });
    } else if (match[5]) {
      const errorText = match[5].replace(/^\n?❌ \*\*Error\*\*: /, '').trim();
      events.push({ type: 'error', content: errorText });
    } else if (match[6]) {
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

const TOOL_META = {
  shell: { icon: Terminal, label: 'Shell', color: 'text-emerald-400', bg: 'bg-emerald-900/20 border-emerald-700/30' },
  read_file: { icon: FileText, label: 'Đọc File', color: 'text-blue-400', bg: 'bg-blue-900/20 border-blue-700/30' },
  write_file: { icon: FilePlus, label: 'Ghi File', color: 'text-purple-400', bg: 'bg-purple-900/20 border-purple-700/30' },
  edit_file: { icon: FileEdit, label: 'Chỉnh sửa', color: 'text-indigo-400', bg: 'bg-indigo-900/20 border-indigo-700/30' },
  multi_edit_file: { icon: FileStack, label: 'Sửa hàng loạt', color: 'text-indigo-400', bg: 'bg-indigo-900/20 border-indigo-700/30' },
  list_dir: { icon: FolderOpen, label: 'Thư mục', color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-700/30' },
  project_tree: { icon: ListTree, label: 'Cấu trúc dự án', color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-700/30' },
  search_code: { icon: SearchCode, label: 'Tìm code', color: 'text-cyan-400', bg: 'bg-cyan-900/20 border-cyan-700/30' },
  screenshot: { icon: Camera, label: 'Screenshot', color: 'text-pink-400', bg: 'bg-pink-900/20 border-pink-700/30' },
  deep_search: { icon: Globe, label: 'Deep Search', color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/30' },
  web_search: { icon: Globe, label: 'Tìm kiếm Web', color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700/30' },
}

function Roadmap({ content, isDark }) {
  const lines = content.split('\n').filter(l => l.trim() && !l.includes('KẾ HOẠCH'))
  return (
    <div className={`my-6 overflow-hidden rounded-[24px] border transition-all duration-500 shadow-2xl ${isDark ? 'bg-slate-900/60 border-white/10 shadow-primary-500/5' : 'bg-white border-slate-200 shadow-slate-200/50'}`}>
      <div className={`px-6 py-4 border-b flex items-center justify-between ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-500/20 rounded-xl text-primary-400"><ListChecks size={18} /></div>
          <div>
            <h4 className={`text-[13px] font-black uppercase tracking-[0.1em] ${isDark ? 'text-white' : 'text-slate-900'}`}>Lộ trình thực thi</h4>
            <p className="text-[10px] text-primary-500 font-bold opacity-80 uppercase tracking-widest">Execution Roadmap</p>
          </div>
        </div>
        <div className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${isDark ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}`}>
          Verified Sequence
        </div>
      </div>
      <div className="p-4 space-y-3">
        {lines.map((line, i) => {
          const toolMatch = line.match(/\[(.*?)\]\s*(.*)/)
          const tool = toolMatch ? toolMatch[1] : null
          const desc = toolMatch ? toolMatch[2] : line.trim().replace(/^[\d.-]+\s*/, '')
          const meta = tool ? TOOL_META[tool] : null
          const ToolIcon = meta?.icon || Activity
          
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

const ChatMarkdown = React.memo(({ content }) => {
  const [copied, setCopied] = React.useState('')
  const copyCode = (code) => { navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(''), 2000) }

  return (
    <ReactMarkdown 
      remarkPlugins={[remarkGfm]} 
      className="prose prose-sm max-w-none prose-invert"
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
          return <p className="mb-4 last:mb-0 leading-relaxed font-medium">{children}</p>
        },
        table: ({ children }) => (
          <div className="my-6 overflow-x-auto rounded-[28px] border border-white/5 shadow-2xl bg-white/[0.01] backdrop-blur-xl custom-scrollbar no-scrollbar scroll-smooth">
            <table className="w-full text-left border-collapse min-w-[400px]">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-white/[0.03] border-b border-white/5">
            {children}
          </thead>
        ),
        th: ({ children }) => (
          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.25em] text-primary-500 whitespace-nowrap">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-6 py-4 text-[13px] border-b border-white/[0.01] text-slate-300 font-medium">
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
              <div className="relative group my-4 scroll-mt-20">
                <div className="flex items-center justify-between bg-[#1e1e24] border border-white/5 rounded-t-[20px] px-5 py-2.5">
                  <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{match[1]}</span>
                  <button onClick={() => copyCode(codeStr)} className="text-slate-500 hover:text-white transition-all flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest">
                    {copied === codeStr ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    {copied === codeStr ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <SyntaxHighlighter 
                  style={oneDark} 
                  language={match[1]} 
                  PreTag="div" 
                  customStyle={{ margin: 0, padding: '20px', borderRadius: '0 0 20px 20px', border: '1px solid rgba(255,255,255,0.05)', borderTop: 'none', fontSize: '0.75rem', background: '#121217' }} 
                  {...props}
                >
                  {codeStr}
                </SyntaxHighlighter>
              </div>
            )
          }
          return <code className="bg-white/5 border border-white/5 rounded-lg px-1.5 py-0.5 text-xs font-mono text-primary-400" {...props}>{children}</code>
        },
      }}>{stripBase64FromText(content).trim()}</ReactMarkdown>
  )
})

function ThinkingBlock({ thinking, isStreaming, isThinkingComplete }) {
  const [expanded, setExpanded] = React.useState(false)
  const showExpanded = isStreaming && !isThinkingComplete ? true : expanded
  React.useEffect(() => { if (!isStreaming && isThinkingComplete) setExpanded(false) }, [isStreaming, isThinkingComplete])
  if (!thinking && !isStreaming) return null
  const cleanThinking = (thinking || '').replace(/<\/?(?:think|thought)>/gi, '').trim()
  if (!cleanThinking && !isStreaming) return null

  return (
    <div className="mb-6 animate-fade-in group/think max-w-full">
      <button onClick={() => setExpanded(!expanded)} className={`group flex items-center gap-3 px-4 py-2 rounded-2xl border transition-all duration-500 shadow-sm ${showExpanded ? 'bg-primary-600/10 border-primary-500/30 text-primary-300' : 'bg-slate-800/40 border-slate-800/60 text-slate-400 hover:bg-slate-800/80'}`}>
        <div className="relative">
          {isStreaming && !isThinkingComplete && <div className="absolute -inset-1.5 bg-primary-500/30 rounded-full animate-ping opacity-75" />}
          <div className={`p-1.5 rounded-lg ${showExpanded ? 'bg-primary-500/20 text-primary-400' : 'bg-slate-700/50'}`}><BrainCircuit size={14} className={isStreaming && !isThinkingComplete ? 'animate-pulse' : ''} /></div>
        </div>
        <div className="flex flex-col items-start leading-tight">
          <span className="text-[9px] font-black uppercase tracking-[0.15em] opacity-60">Neural Process</span>
          <span className="text-[11px] font-bold">{isStreaming && !isThinkingComplete ? 'Đang phân tích...' : 'Lộ trình suy nghĩ'}</span>
        </div>
        <div className={`ml-1 transition-transform duration-500 ${showExpanded ? 'rotate-180 opacity-40' : 'opacity-20'}`}><ChevronDown size={14} /></div>
      </button>
      {showExpanded && (
        <div className="relative mt-3 ml-8 p-4 bg-primary-500/[0.05] border border-primary-500/10 rounded-2xl animate-in slide-in-from-top-2">
          <div className="prose prose-sm prose-invert max-w-none opacity-80 text-[12px] italic leading-relaxed">
            {cleanThinking.split('\n').filter(l => l.trim()).map((line, idx) => <p key={idx} className="mb-2 last:mb-0">{line}</p>)}
          </div>
        </div>
      )}
    </div>
  )
}

function ToolStep({ step, isStreaming }) {
  const [expanded, setExpanded] = React.useState(false)
  React.useEffect(() => { if (step.result && !isStreaming) setExpanded(false) }, [step.result, isStreaming])
  const meta = TOOL_META[step.tool] || { icon: Zap, label: step.tool.replace('_', ' '), color: 'text-slate-400', bg: 'bg-slate-900/40 border-slate-700/30' }
  const hasResult = !!step.result;
  const isError = step.result?.error || (step.result?.exit_code !== 0 && step.result?.exit_code !== undefined);

  return (
    <div className={`w-full group/tool transition-all duration-300 ${expanded ? 'mb-4' : 'mb-2'}`}>
      <div className={`relative border rounded-2xl overflow-hidden transition-all duration-300 ${meta.bg} bg-opacity-40 hover:bg-opacity-60`}>
        <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors relative z-10">
          <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${hasResult ? (isError ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500') : 'bg-primary-500/10 text-primary-500 animate-pulse'}`}>
            {hasResult ? (isError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />) : <meta.icon size={16} className="animate-pulse" />}
          </div>
          <div className="flex-1 min-w-0">
             <span className={`text-[9px] font-black uppercase tracking-[0.15em] ${meta.color} opacity-90`}>{meta.label}</span>
             {(step.args?.path || step.args?.command || step.args?.query) && <p className="text-[9px] font-mono opacity-30 truncate">{step.args.path || step.args.command || step.args.query}</p>}
          </div>
          <ChevronDown size={14} className={`transition-transform duration-500 ${expanded ? 'rotate-180 opacity-60' : 'opacity-20'}`} />
        </button>
        {expanded && step.result && (
          <div className="px-4 pb-4 animate-in slide-in-from-top-2">
            <div className={`p-3 rounded-xl bg-black/40 text-[10px] font-mono overflow-auto max-h-[300px] custom-scrollbar ${isError ? 'text-red-400' : 'text-slate-300'}`}>
              <pre className="whitespace-pre-wrap">{typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Project() {
  const { theme, toggleTheme } = useTheme()
  const { user, logout } = useAuth()
  const isDark = theme === 'dark'
  const navigate = useNavigate()
  const location = useLocation()

  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [files, setFiles] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [contentSearch, setContentSearch] = useState('')
  const [activeSidebarView, setActiveSidebarView] = useState('explorer')
  
  const [openTabs, setOpenTabs] = useState(() => JSON.parse(localStorage.getItem('hatai_open_tabs') || '[]'))
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('hatai_active_tab'))
  const [editingContents, setEditingContents] = useState({})
  const [proposingContents, setProposingContents] = useState({}) // NEW: For live AI streaming to editor
  const [originalContents, setOriginalContents] = useState({}) 
  const [sessions, setSessions] = useState([]) // NEW: Past sessions list
  const [activeSessionId, setActiveSessionId] = useState(() => localStorage.getItem('hatai_session_id'))
  const [gitStatus, setGitStatus] = useState({ branch: '', files: [] }) // NEW: Git state
  const [gitProfile, setGitProfile] = useState({ name: '', email: '' }) // NEW: Git profile
  const [isGitInit, setIsGitInit] = useState(true) // Assume initialized until check
  const [githubUrl, setGithubUrl] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [gitLoading, setGitLoading] = useState(false)
  const [saving, setSaving] = useState({})
  const [showCheatSheet, setShowCheatSheet] = useState(false) // Toggle for Git commands
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(window.innerWidth < 768 ? false : false)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(window.innerWidth > 768)
  const [aiInstructions, setAiInstructions] = useState({})
  const [editingWithAi, setEditingWithAi] = useState({})
  const [pendingChanges, setPendingChanges] = useState({}) 
  const [openFolders, setOpenFolders] = useState(new Set(['backend', 'frontend']))
  const [isEditingRemote, setIsEditingRemote] = useState(false) // NEW: Toggle for remote input UI
  
  const [showChat, setShowChat] = useState(true)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState(() => JSON.parse(localStorage.getItem('hatai_project_chat') || '[]'))
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [selectedModel, setSelectedModel] = useState('OpenAI Server') 
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [isContextOpen, setIsContextOpen] = useState(false)
  const [attachments, setAttachments] = useState([]) 
  const [isUploadingMedia, setIsUploadingMedia] = useState(false)
  
  const [showMentions, setShowMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const chatInputRef = useRef(null)
  const chatScrollRef = useRef(null)
  const socketRef = useRef(null)
  const [daemonState, setDaemonState] = useState('idle')
  
  // High-performance message batching
  const chatMessagesRef = useRef(chatMessages)
  useEffect(() => { chatMessagesRef.current = chatMessages }, [chatMessages])
  
  const [lastUpdate, setLastUpdate] = useState(0)
  const batchTimerRef = useRef(null)
  
  // Sync Ref back to State every 150ms during streaming
  const syncChatState = () => {
    setChatMessages([...chatMessagesRef.current])
    setLastUpdate(Date.now())
  }

  const availableModels = [
    { id: 'openai', name: 'OpenAI Server', icon: Server, desc: 'Generic API' },
    { id: 'gemini', name: 'Gemini 2.0', icon: Zap, desc: 'Max Reasoning Power' },
    { id: 'local', name: 'Local Qwen3', icon: Brain, desc: 'Ultra-fast Metal GPU' },
    { id: 'ollama', name: 'Ollama Engine', icon: Cpu, desc: 'Local/Remote Server' }
  ]

  useEffect(() => {
    localStorage.setItem('hatai_open_tabs', JSON.stringify(openTabs))
  }, [openTabs])
  useEffect(() => {
    if (activeTab) localStorage.setItem('hatai_active_tab', activeTab)
  }, [activeTab])
  // Use a ref for active session to use in WS handler without stale closure
  const activeSessionRef = useRef(activeSessionId)
  useEffect(() => {
    activeSessionRef.current = activeSessionId
    if (activeSessionId) localStorage.setItem('hatai_session_id', activeSessionId)
  }, [activeSessionId])

  // Optimize LocalStorage: Debounce saving chat history to prevent performance death during streaming
  const saveChatTimeoutRef = useRef(null)
  useEffect(() => {
    if (saveChatTimeoutRef.current) clearTimeout(saveChatTimeoutRef.current)
    saveChatTimeoutRef.current = setTimeout(() => {
      localStorage.setItem('hatai_project_chat', JSON.stringify(chatMessages))
    }, 2000)
  }, [chatMessages])

  useEffect(() => {
    fetchFiles()
    fetchSessions()
    fetchGitStatus()
    
    // ── WebSocket Integration ───────────────────────────────────────────
    const connectAgentWS = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const hostname = window.location.hostname
        const token = localStorage.getItem('hatai_token')
        const wsUrl = `${protocol}//${hostname}:8000/agent/daemon/ws?token=${token}`
        
        console.log(`🔌 Connecting to Agent Daemon WS at ${wsUrl}...`)
        const ws = new WebSocket(wsUrl)
        socketRef.current = ws

        ws.onopen = () => {
            console.log("✅ Agent Daemon Connected")
        }

        ws.onmessage = (event) => {
            const rawData = JSON.parse(event.data)
            
            // 1. Handle Global Status (Directly update small states)
            if (rawData.type === 'daemon_status' || rawData.type === 'heartbeat') {
                setDaemonState(rawData.state)
                const currentSession = activeSessionRef.current
                const isActiveRunning = (rawData.active_sessions || []).includes(Number(currentSession))
                if (isActiveRunning || (rawData.state === 'running' && rawData.session_id == currentSession)) {
                    setAgentStatus(rawData.message || '⚙️ Agent is working in background...')
                    setIsChatStreaming(true)
                } else if (rawData.state === 'idle' || rawData.state === 'done') {
                    if (rawData.session_id == currentSession || !rawData.session_id) {
                        setAgentStatus(null)
                        setIsChatStreaming(false)
                    }
                }
                return
            }

            // 2. Unpack task_log/raw event
            const isTaskLog = rawData.type === 'task_log'
            const data = isTaskLog ? { ...rawData.log, session_id: rawData.session_id } : rawData

            // 3. Handle Session-Specific Events via REF for performance
            const currentSessionId = activeSessionRef.current
            if (data.session_id && data.session_id == currentSessionId) {
                const messages = chatMessagesRef.current
                const lastIdx = messages.length - 1
                let lastMsg = lastIdx >= 0 ? messages[lastIdx] : null
                
                if (!lastMsg || lastMsg.role !== 'assistant') {
                    lastMsg = { role: 'assistant', content: '', thoughts: '', tool_calls: [], screenshots: [], processedIndices: new Set() }
                    messages.push(lastMsg)
                }

                // Deduplicate
                if (isTaskLog && data.index !== undefined) {
                    if (lastMsg.processedIndices.has(data.index)) return
                    lastMsg.processedIndices.add(data.index)
                }

                let changed = false
                if (data.type === 'thinking_token' || data.type === 'thinking') {
                    const newThought = data.content || ''
                    if (newThought && !lastMsg.thoughts.endsWith(newThought)) {
                        lastMsg.thoughts = (lastMsg.thoughts || '') + newThought
                        changed = true
                    }
                } else if (data.type === 'text') {
                    const newContent = data.content || ''
                    if (newContent && !lastMsg.content.endsWith(newContent)) {
                        lastMsg.content += newContent
                        changed = true

                        // Throttled Live stream to editor
                        if (activeTab && lastMsg.content.includes('```')) {
                            const codeLines = lastMsg.content.split('\n')
                            const blockStart = codeLines.lastIndexOf(codeLines.find(l => l.startsWith('```')))
                            if (blockStart !== -1) {
                                const currentBlock = codeLines.slice(blockStart + 1).join('\n')
                                if (!currentBlock.includes('```')) {
                                    setProposingContents(draft => ({ ...draft, [activeTab]: currentBlock }))
                                }
                            }
                        }
                    }
                } else if (data.type === 'tool_call') {
                    lastMsg.tool_calls.push({ tool: data.tool, args: data.args, result: null })
                    setAgentStatus(`⚙️ Running: ${data.tool}...`)
                    changed = true
                } else if (data.type === 'tool_result') {
                    const tcIdx = [...lastMsg.tool_calls].reverse().findIndex(t => t.tool.includes(data.tool) && !t.result)
                    if (tcIdx !== -1) {
                        const actualIdx = lastMsg.tool_calls.length - 1 - tcIdx
                        lastMsg.tool_calls[actualIdx] = { ...lastMsg.tool_calls[actualIdx], result: data.result }
                    }
                    setAgentStatus(`✅ Done: ${data.tool}`)
                    changed = true
                } else if (data.type === 'screenshot' || data.type === 'tool_result_screenshot') {
                    const url = data.url || data.content || (data.base64 ? `data:image/png;base64,${data.base64}` : null)
                    if (url && !lastMsg.screenshots.includes(url)) lastMsg.screenshots.push(url)
                    changed = true
                } else if (data.type === 'done' || data.type === 'task_result') {
                    setAgentStatus(null)
                    setIsChatStreaming(false)
                    
                    // Only update content if we have a better result and the current content is significantly shorter
                    // OR if the current content is empty. This prevents the "Digest" duplication.
                    if (data.result && (!lastMsg.content || (data.result.length > lastMsg.content.length + 50 && !lastMsg.content.includes(data.result.substring(0, 50))))) {
                        // If the result looks like a "Digest" (contains tool markers), but we already have content, don't overwrite
                        const isDigest = data.result.includes('🔧') || data.result.includes('📤')
                        if (!isDigest || !lastMsg.content) {
                            lastMsg.content = data.result
                            changed = true
                        }
                    }
                    syncChatState() // Forces final sync
                }

                // Batch the state update or use requestAnimationFrame
                if (changed && !batchTimerRef.current) {
                    batchTimerRef.current = setTimeout(() => {
                        batchTimerRef.current = null
                        syncChatState()
                    }, 150)
                }
            }
        }

        ws.onclose = () => {
            console.log("🔌 Agent Daemon Disconnected. Reconnecting...")
            setTimeout(connectAgentWS, 3000)
        }
        
        ws.onerror = (err) => {
            console.error("❌ WS Error", err)
            ws.close()
        }
    }

    connectAgentWS()

    const timer = setInterval(() => { 
        // Only trigger heavy background polling if page is visible and agent is not too busy
        if (!document.hidden) {
            fetchLogs()
            fetchGitStatus()
        }
    }, 20000) // Increase interval to 20s to reduce load
    return () => {
        clearInterval(timer)
        if (socketRef.current) socketRef.current.close()
    }
  }, [])

  const fetchFiles = async () => {
    setLoading(true)
    try {
      const resp = await codeApi.get('/code/scan')
      setFiles(resp.data.files || [])
      setError(null)
    } catch (err) {
      // Don't block the page — show a warning but let the user in
      setError('Code server không phản hồi. Hãy thử lại sau.')
    } finally {
      // ALWAYS exit loading so page renders even if agent is busy
      setLoading(false)
    }
  }

  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000)
    if (seconds < 60) return 'Just Now'
    if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`
    return new Date(date).toLocaleDateString()
  }

  const fetchSessions = async () => {
    try {
        const resp = await api.get('/ai/sessions')
        setSessions(resp.data || [])
    } catch (err) {}
  }

  const fetchGitStatus = async () => {
    setGitLoading(true)
    try {
        const rootDir = "/Users/nguyenhat/Public/hatai-remote"
        
        // Check if git is initialized — non-blocking, short timeout
        let initialised = false
        try {
            const checkInit = await codeApi.post('/code/execute', { command: '[ -d .git ] && echo "YES" || echo "NO"', cwd: rootDir })
            initialised = checkInit.data.stdout.trim() === 'YES'
        } catch { }
        setIsGitInit(initialised)
        
        if (!initialised) return

        // Fire all git commands independently — don't let one failure block others
        const safeExec = async (cmd) => {
            try {
                const r = await codeApi.post('/code/execute', { command: cmd, cwd: rootDir })
                return r.data.stdout.trim()
            } catch { return '' }
        }

        const [branch, statusOut, name, email, remote] = await Promise.all([
            safeExec('git branch --show-current'),
            safeExec('git status --porcelain'),
            safeExec('git config user.name'),
            safeExec('git config user.email'),
            safeExec('git remote get-url origin || echo ""'),
        ])
        
        const changedFiles = statusOut.split('\n').filter(l => l.trim()).map(line => ({
            file: line.substring(3),
            status: line.substring(0, 2).trim()
        }))
        setGitStatus({ branch, files: changedFiles })
        setGitProfile({ name, email })
        setGithubUrl(remote)
    } catch (err) {
        // Non-fatal — git section just shows empty data
    } finally { setGitLoading(false) }
  }

  const GIT_PRESETS = [
    { label: 'Feat', emoji: '🔥', text: 'feat: add feature' },
    { label: 'Fix', emoji: '🐛', text: 'fix: resolve issue' },
    { label: 'Refactor', emoji: '♻️', text: 'refactor: clean logic' },
    { label: 'Docs', emoji: '📝', text: 'docs: update readme' },
    { label: 'Hotfix', emoji: '⚡', text: 'hotfix: critical patch' }
  ]

  const handleGitCommit = async () => {
     if (!commitMessage.trim()) return
     setGitLoading(true)
     try {
         const rootDir = "/Users/nguyenhat/Public/hatai-remote"
         await codeApi.post('/code/execute', { command: `git add . && git commit -m "${commitMessage}"`, cwd: rootDir })
         setCommitMessage('')
         fetchGitStatus()
     } catch (err) { console.error('Commit Failed', err) } finally { setGitLoading(false) }
  }

  const handleGitInit = async () => {
    setGitLoading(true)
    try {
        const rootDir = "/Users/nguyenhat/Public/hatai-remote"
        await codeApi.post('/code/execute', { command: 'git init && git add . && git commit -m "initial commit"', cwd: rootDir })
        if (githubUrl.trim()) {
            await codeApi.post('/code/execute', { command: `git remote add origin ${githubUrl}`, cwd: rootDir })
        }
        fetchGitStatus()
    } catch (err) { console.error('Init Failed', err) } finally { setGitLoading(false) }
  }

  const handleGitSync = async () => {
    setGitLoading(true)
    try {
        const rootDir = "/Users/nguyenhat/Public/hatai-remote"
        const branch = gitStatus.branch || 'main'
        await codeApi.post('/code/execute', { command: `git push origin ${branch}`, cwd: rootDir })
        fetchGitStatus()
    } catch (err) { console.error('Sync Failed', err) } finally { setGitLoading(false) }
  }

  const handleGitConnectRemote = async () => {
    if (!githubUrl.trim()) return
    setGitLoading(true)
    try {
        const rootDir = "/Users/nguyenhat/Public/hatai-remote"
        // Try adding, if fails (exists), try setting
        await codeApi.post('/code/execute', { command: `git remote add origin ${githubUrl} || git remote set-url origin ${githubUrl}`, cwd: rootDir })
        fetchGitStatus()
    } catch (err) { console.error('Failed to update remote', err) } finally { setGitLoading(false) }
  }

  const handleLoadSession = async (id) => {
    setActiveSessionId(id)
    try {
        const resp = await api.get(`/ai/sessions/${id}/messages`)
        setChatMessages(resp.data || [])
        setShowChat(true)
    } catch (err) { alert('Failed to load session history') }
  }

  const handleDeleteSession = async (e, id) => {
    e.stopPropagation()
    // Instant deletion as requested
    try {
        await api.delete(`/ai/sessions/${id}`)
        setSessions(prev => prev.filter(s => s.id !== id))
        if (activeSessionId == id) {
            setActiveSessionId(null)
            setChatMessages([])
            localStorage.removeItem('hatai_session_id')
            localStorage.removeItem('hatai_project_chat')
        }
    } catch (err) { alert('Failed to delete session') }
  }

  const handleNewChat = () => {
    setActiveSessionId(null)
    setChatMessages([])
    setChatInput('')
    setAttachments([])
    localStorage.removeItem('hatai_session_id')
    localStorage.removeItem('hatai_project_chat')
    setAgentStatus(null)
    setIsChatStreaming(false)
    setShowChat(true)
  }

  const fetchLogs = async () => {
    try {
        const logResp = await api.get('/ai/logs')
        const recentLogs = logResp.data.logs || []
        setSystemLogs(recentLogs.slice(-20))
    } catch (err) { /* silent fail — don't block anything */ }
  }

  const handleOpenFile = async (path) => {
    if (!openTabs.includes(path)) setOpenTabs(prev => [...prev, path])
    setActiveTab(path)
    if (!editingContents[path]) {
      try {
        const file = files.find(f => f.path === path)
        const resp = await codeApi.post('/code/read', { path: file.full_path })
        setEditingContents(prev => ({ ...prev, [path]: resp.data.content }))
        setOriginalContents(prev => ({ ...prev, [path]: resp.data.content }))
      } catch (err) { }
    }
  }

  const handleSaveFile = async (path) => {
    setSaving(prev => ({ ...prev, [path]: true }))
    try {
      const fullPath = files.find(f => f.path === path).full_path
      await codeApi.post('/code/write', { path: fullPath, content: editingContents[path], change_summary: 'Cloud Sync' })
      setOriginalContents(prev => ({ ...prev, [path]: editingContents[path] }))
      setPendingChanges(prev => ({ ...prev, [path]: false }))
      
      // AUTO-PUSH PROTOCOL
      const rootDir = "/Users/nguyenhat/Public/hatai-remote"
      // Non-blocking attempt to sync
      codeApi.post('/code/execute', { 
         command: `git add . && git commit -m "Auto-sync: ${path.split('/').pop()}" && (git push origin main || git push origin master || true)`, 
         cwd: rootDir 
      }).then(() => fetchGitStatus())
    } catch (err) { } finally { setSaving(prev => ({ ...prev, [path]: false })); }
  }

  const handleAIEdit = async () => {
    if (!activeTab || !aiInstructions[activeTab]?.trim()) return
    const path = activeTab
    setEditingWithAi(prev => ({ ...prev, [path]: true }))
    try {
        const fullPath = files.find(f => f.path === path).full_path
        const resp = await codeApi.post('/code/ai-edit', { path: fullPath, instruction: aiInstructions[path], current_code: editingContents[path], model: selectedModel })
        setEditingContents(prev => ({ ...prev, [path]: resp.data.modified_code }))
        setAiInstructions(prev => ({ ...prev, [path]: '' }))
        setPendingChanges(prev => ({ ...prev, [path]: true }))
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Updated logic for ${path.split('/').pop()}. Please review and accept below.`, meta: { files: [path], type: 'edit' } }])
    } catch (err) { } finally { setEditingWithAi(prev => ({ ...prev, [path]: false })); }
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
        setIsContextOpen(false) // Auto-close menu
    } catch (err) { alert('Upload failed') } finally { setIsUploadingMedia(false) }
  }

  const [agentStatus, setAgentStatus] = useState(null)
  const [systemLogs, setSystemLogs] = useState([])

  async function handleSendChat() {
    if (!chatInput.trim() || isChatStreaming) return
    const userMsg = chatInput.trim()
    
    // Create local UI message immediately
    const userDisplayMsg = { role: 'user', content: userMsg, attachments: [...attachments] }
    setChatMessages(prev => [...prev, userDisplayMsg])
    
    setChatInput('')
    setAttachments([]) 
    
    const contextPrefix = activeTab && editingContents[activeTab] ? `[ACTIVE_FILE: ${activeTab}]\n` : ''
    const fullMsg = contextPrefix + userMsg

    setIsChatStreaming(true)
    setAgentStatus('⚙️ Đang khởi chạy...')
    
    try {
        // Submit as a formal Background Task
        const resp = await api.post('/tasks', {
            prompt: fullMsg,
            session_id: activeSessionId,
            attachments: attachments,
            max_tokens: 8192,
            temperature: 0.5
        })
        
        const taskId = resp.data.id
        if (resp.data.session_id && resp.data.session_id != activeSessionId) {
            setActiveSessionId(resp.data.session_id)
            localStorage.setItem('hatai_session_id', resp.data.session_id)
        }
        
        setAgentStatus(`📦 Task #${taskId} đã tạo. Đang thực thi...`)
    } catch (err) {
        setAgentStatus(`❌ Lỗi: ${err.response?.data?.detail || err.message}`)
        setIsChatStreaming(false)
        setChatMessages(prev => [...prev, { role: 'assistant', content: `❌ Không thể tạo task chạy ngầm: ${err.message}` }])
    }
  }


  const messagesEndRef = useRef(null)
  useEffect(() => {
    if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [chatMessages])

  const buildFileTree = (flatFiles) => {
    const root = { name: 'Root', type: 'folder', children: {}, path: '' }
    flatFiles.forEach(file => {
        const parts = file.path.split('/')
        let current = root
        parts.forEach((part, i) => {
            if (i === parts.length - 1) current.children[part] = { ...file, type: 'file' }
            else {
                if (!current.children[part]) current.children[part] = { name: part, type: 'folder', path: parts.slice(0, i + 1).join('/'), children: {} }
                current = current.children[part]
            }
        })
    })
    return root
  }

  useEffect(() => {
    const val = chatInput
    const lastAt = val.lastIndexOf('@')
    if (lastAt !== -1 && (lastAt === 0 || val[lastAt - 1] === ' ' || val[lastAt - 1] === '\n')) {
        const query = val.substring(lastAt + 1)
        if (!query.includes(' ')) {
            setShowMentions(true)
            setMentionQuery(query)
            return
        }
    }
    setShowMentions(false)
  }, [chatInput])

  const handleMentionSelect = (file) => {
    const textBefore = chatInput.substring(0, chatInput.lastIndexOf('@'))
    const textAfter = chatInput.substring(chatInput.lastIndexOf('@') + mentionQuery.length + 1)
    setChatInput(textBefore + '@' + file.name + ' ' + textAfter)
    setShowMentions(false)
    chatInputRef.current.focus()
  }

  const filteredFiles = files.filter(f => f.path.toLowerCase().includes(searchTerm.toLowerCase()))
  const contentResults = contentSearch.length > 2 ? files.filter(f => f.content?.toLowerCase().includes(contentSearch.toLowerCase())) : []
  const fileTree = buildFileTree(filteredFiles)
  const allFolders = Array.from(new Set(files.flatMap(f => {
    const parts = f.path.split('/')
    return parts.slice(0, -1).map((_, i) => ({
        name: parts[i],
        path: parts.slice(0, i+1).join('/'),
        type: 'folder'
    }))
  }))).filter((v, i, a) => a.findIndex(t => t.path === v.path) === i)

  const WORKFLOWS = [
    { id: 'review', name: 'Review Project', icon: Search, desc: 'Phân tích toàn bộ codebase và tìm lỗi' },
    { id: 'doc', name: 'Generate Docs', icon: FileCode, desc: 'Viết tài liệu README và API chuẩn' },
    { id: 'fix', name: 'Repair UI/UX', icon: Zap, desc: 'Sửa lỗi giao diện và trải nghiệm người dùng' },
    { id: 'git', name: 'Git Sync', icon: GitBranch, desc: 'Commit và Push toàn bộ thay đổi' },
    { id: 'brain', name: 'Self Improve', icon: Brain, desc: 'Tối ưu hóa code của chính mình' },
    { id: 'test', name: 'Auto Test', icon: Activity, desc: 'Viết và chạy unit tests' }
  ]

  const mentionFiles = [
    ...allFolders.map(f => ({ ...f, type: 'folder' })),
    ...files.map(f => ({ ...f, type: 'file' }))
  ].filter(f => f.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 12)

  const slashQuery = chatInput.lastIndexOf('/') !== -1 && (chatInput.lastIndexOf('/') === 0 || chatInput[chatInput.lastIndexOf('/')-1] === ' ' || chatInput[chatInput.lastIndexOf('/')-1] === '\n') 
    ? chatInput.substring(chatInput.lastIndexOf('/') + 1).split(' ')[0] 
    : null
  
  const filteredWorkflows = slashQuery !== null ? WORKFLOWS.filter(w => w.id.toLowerCase().includes(slashQuery.toLowerCase()) || w.name.toLowerCase().includes(slashQuery.toLowerCase())) : []

  const renderTree = (node, depth = 0) => {
    const sorted = Object.values(node.children).sort((a,b) => (a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name)))
    return sorted.map(child => (
        <div key={child.path}>
            <div onClick={() => {
                 if (child.type === 'folder') {
                     setOpenFolders(prev => { const n = new Set(prev); if (n.has(child.path)) n.delete(child.path); else n.add(child.path); return n; })
                 } else {
                     handleOpenFile(child.path);
                     if (window.innerWidth < 768) setMobileExplorerOpen(false);
                 }
            }} className={`flex items-center gap-1.5 px-3 py-0.5 cursor-pointer text-[12px] transition-colors ${activeTab === child.path ? (isDark ? 'bg-primary-500/20 text-white font-bold' : 'bg-primary-600/10 text-primary-600 font-bold') : (isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-900')}`} style={{ paddingLeft: `${depth * 12 + 12}px` }}>
                {child.type === 'folder' ? <ChevronRight size={12} className={openFolders.has(child.path) ? 'rotate-90' : ''} /> : <span className="w-3" />}
                <span className="truncate">{child.name}</span>
            </div>
            {child.type === 'folder' && openFolders.has(child.path) && renderTree(child, depth + 1)}
        </div>
    ))
  }

  return (
    <div className={`flex h-screen overflow-hidden font-sans transition-colors duration-300 ${isDark ? 'bg-[#0a0a0c] text-white' : 'bg-light-50 text-light-900'}`}>
    
          {/* IDE CORE - ABSOLUTELY INDEPENDENT */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
            
            {/* IDE Header - MOBILE ONLY */}
            <div className="flex md:hidden flex-col bg-white dark:bg-dark-900 border-b border-light-200 dark:border-slate-800/60 z-50">
                <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setSidebarOpen(true)} className="p-2 text-light-500 hover:text-primary-600 transition-colors"><Menu size={20} /></button>
                        <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-primary-500/5 border border-primary-500/10">
                            <Code2 size={16} className="text-primary-500" />
                            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-primary-600 dark:text-primary-400">Code Hub</span>
                        </div>
                    </div>
                    <button onClick={() => setShowChat(!showChat)} className={`p-2 rounded-xl transition-all ${showChat ? 'bg-amber-500 text-white shadow-lg' : 'text-light-400 dark:text-slate-500 hover:bg-light-100 dark:hover:bg-dark-800'}`}>
                        <Sparkles size={20} />
                    </button>
                </div>

                {/* Tab Switcher for Sidebar Views - MOBILE ONLY */}
                <div className="flex px-4 py-1.5 gap-2 border-t border-light-100 dark:border-slate-800/20 overflow-x-auto no-scrollbar bg-white/50 dark:bg-black/10">
                    {[
                        { id: 'explorer', icon: FileCode, label: 'Files' },
                        { id: 'history', icon: History, label: 'History' },
                        { id: 'git', icon: GitBranch, label: 'Source' }
                    ].map(v => (
                        <button 
                            key={v.id} 
                            onClick={() => { setActiveSidebarView(v.id); setMobileExplorerOpen(true); }}
                            className={`flex items-center gap-2 whitespace-nowrap px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeSidebarView === v.id ? 'bg-primary-600 text-white shadow-lg' : 'text-light-400 dark:text-slate-500 hover:bg-black/5'}`}
                        >
                            <v.icon size={12} />
                            <span>{v.label}</span>
                        </button>
                    ))}
                </div>
            </div>
            
            {/* Activity Bar - DESKTOP ONLY */}
            <div className={`hidden md:flex w-14 flex-col items-center py-6 border-r transition-colors z-50 ${isDark ? 'bg-[#0a0a0c] border-white/5' : 'bg-white border-black/[0.05]'}`}>
                <div onClick={() => { setActiveSidebarView('explorer'); setMobileExplorerOpen(true); }} className={`p-3 cursor-pointer rounded-xl mb-4 transition-all ${activeSidebarView === 'explorer' ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/30' : 'text-slate-500 hover:bg-slate-500/10'}`} title="Explorer"><FileCode size={20} /></div>
                <div onClick={() => { setActiveSidebarView('history'); setMobileExplorerOpen(true); }} className={`p-3 cursor-pointer rounded-xl mb-4 transition-all ${activeSidebarView === 'history' ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/30' : 'text-slate-500 hover:bg-slate-500/10'}`} title="Collaboration History"><History size={20} /></div>
                <div onClick={() => { setActiveSidebarView('git'); setMobileExplorerOpen(true); }} className={`p-3 cursor-pointer rounded-xl transition-all ${activeSidebarView === 'git' ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/30' : 'text-slate-500 hover:bg-slate-500/10'}`} title="Source Control"><GitBranch size={20} /></div>
            </div>
    
            {/* Sidebar View Area - Mobile Drawer (fixed) vs Desktop (relative) */}
            {mobileExplorerOpen && <div className="fixed inset-0 bg-black/40 z-[130] md:hidden" onClick={() => setMobileExplorerOpen(false)} />}
            <div className={`w-[280px] md:w-72 flex flex-col border-r transition-all duration-300 z-[140] ${isDark ? 'bg-[#0f0f12] border-white/5 shadow-2xl shadow-black/40' : 'bg-[#f0ede1] border-black/[0.05]'}
                ${mobileExplorerOpen 
                    ? 'translate-x-0 fixed left-0 h-full md:relative md:translate-x-0' 
                    : '-translate-x-full fixed left-0 h-full md:relative md:translate-x-0 md:flex hidden'}`}>
                
                <div className="md:hidden flex items-center justify-between p-4 border-b border-white/5">
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{activeSidebarView}</span>
                    <button onClick={() => setMobileExplorerOpen(false)}><X size={16}/></button>
                </div>

                {activeSidebarView === 'explorer' ? (
                    <>
                        <div className="p-6 pb-2 flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Explorer</span><div className="flex gap-2"><button onClick={fetchFiles} className="opacity-30 hover:opacity-100"><RotateCcw size={14}/></button></div></div>
                        <div className="px-5 py-2"><input className={`w-full bg-black/5 dark:bg-white/5 border-none rounded-lg px-3 py-2 text-[12px] outline-none placeholder:opacity-20`} placeholder="Filter files..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
                        <div className="flex-1 overflow-auto py-2 group custom-scrollbar">{renderTree(fileTree)}</div>
                    </>
                ) : activeSidebarView === 'history' ? (
                    <>
                        <div className="p-6 pb-2 flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Archive</span>
                            <div className="flex gap-2">
                                 <button onClick={handleNewChat} className="p-1 px-3 bg-primary-500/10 text-primary-500 rounded-full text-[8px] font-black uppercase tracking-widest hover:bg-primary-500 hover:text-white transition-all">+ New Chat</button>
                                 <button onClick={fetchSessions} className="opacity-30 hover:opacity-100"><RotateCcw size={14}/></button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto py-2 px-5 space-y-3 custom-scrollbar">
                            {sessions.map(s => (
                                <div key={s.id} onClick={() => { handleLoadSession(s.id); setMobileExplorerOpen(false); }} className={`relative p-5 rounded-3xl border cursor-pointer transition-all duration-500 group/session overflow-hidden ${activeSessionId == s.id ? (isDark ? 'bg-primary-500/[0.08] border-primary-500/30 shadow-2xl shadow-primary-900/20' : 'bg-primary-500/5 border-primary-500/20 shadow-xl shadow-primary-500/10') : (isDark ? 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10' : 'bg-white/40 border-black/[0.03] hover:bg-white hover:border-black/5')}`}>
                                    {activeSessionId == s.id && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary-500 rounded-r-full shadow-[0_0_15px_rgba(99,102,241,0.8)]" />}
                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <p className={`text-[13px] font-black leading-tight truncate group-hover/session:text-primary-500 transition-colors flex-1 ${activeSessionId == s.id ? 'text-primary-500' : (isDark ? 'text-slate-300' : 'text-slate-900')}`}>{s.title || 'Collaborative Node'}</p>
                                            <button onClick={(e) => handleDeleteSession(e, s.id)} className="opacity-0 group-hover/session:opacity-100 p-2 text-red-500/50 hover:text-red-500 transition-all hover:scale-110"><Trash2 size={12} /></button>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 opacity-30 text-[9px] font-bold uppercase tracking-widest group-hover/session:opacity-60 transition-opacity">
                                                <MessageSquare size={12} /> {s.message_count || 0} Events
                                            </div>
                                            <span className="text-[9px] font-black uppercase tracking-[0.1em] opacity-20 group-hover/session:opacity-40 transition-opacity">{timeAgo(s.created_at)}</span>
                                        </div>
                                    </div>
                                    <div className={`absolute -inset-[1px] rounded-3xl bg-gradient-to-br from-primary-500/5 to-transparent opacity-0 group-hover/session:opacity-100 transition-opacity pointer-events-none`} />
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <>
                        <div className="p-6 pb-2 flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Source Control</span>
                            <button onClick={fetchGitStatus} disabled={gitLoading} className="opacity-30 hover:opacity-100"><RotateCcw size={14} className={gitLoading ? 'animate-spin' : ''}/></button>
                        </div>
                    <div className="px-5 py-4 space-y-4">
                        {!isGitInit ? (
                            <div className={`p-6 rounded-3xl border ${isDark ? 'bg-primary-500/5 border-primary-500/20' : 'bg-primary-50 border-primary-100'}`}>
                                <h3 className="text-[12px] font-black uppercase tracking-widest mb-2">Chưa kết nối Git</h3>
                                <p className="text-[10px] opacity-60 mb-6 leading-relaxed">Workspace này chưa được khởi tạo Git. Hãy kết nối để quản lý phiên bản.</p>
                                
                                <div className="space-y-3">
                                    <div className="space-y-1">
                                        <label className="text-[9px] font-black uppercase tracking-widest opacity-40 ml-1">GitHub Remote URL (Optional)</label>
                                        <input value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} className={`w-full bg-black/5 dark:bg-white/5 border-none rounded-xl px-4 py-2.5 text-[11px] outline-none placeholder:opacity-20`} placeholder="https://github.com/user/repo.git" />
                                    </div>
                                    <button onClick={handleGitInit} disabled={gitLoading} className="w-full py-3 bg-primary-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-500 shadow-xl shadow-primary-900/30 transition-all flex items-center justify-center gap-2">
                                        {gitLoading ? <RotateCcw size={12} className="animate-spin" /> : <Plus size={14} />} 
                                        Khởi tạo & Kết nối
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className={`p-4 rounded-3xl border ${isDark ? 'bg-white/5 border-white/5' : 'bg-white/60 border-black/5 shadow-sm'}`}>
                                    <div className="flex flex-col gap-1 mb-4">
                                        <div className="flex items-center justify-between font-black text-[9px] uppercase tracking-[0.4em] mb-4">
                                            <span className="text-primary-600">Repository Status</span>
                                            <div className="flex items-center gap-2">
                                                <div className={`w-1.5 h-1.5 rounded-full ${githubUrl ? 'bg-green-500 animate-pulse ring-4 ring-green-500/20' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`} />
                                                <span className={githubUrl ? 'text-green-500' : 'text-red-500'}>{githubUrl ? 'SYNCED' : 'DISCONNECTED'}</span>
                                            </div>
                                        </div>
                                        
                                        {/* REMOTE MANAGEMENT SECTION - IMPROVED */}
                                        <div className={`mb-6 p-5 rounded-[30px] border transition-all duration-500 ${githubUrl && !isEditingRemote ? (isDark ? 'bg-primary-500/5 border-primary-500/20' : 'bg-primary-50 border-primary-200 shadow-sm') : (isDark ? 'bg-white/5 border-white/10' : 'bg-white shadow-xl')}`}>
                                            <div className="flex items-center justify-between mb-4">
                                                <div className="flex items-center gap-2">
                                                     <Zap size={14} className={githubUrl ? 'text-primary-500' : 'text-slate-400'} />
                                                     <span className="text-[10px] font-black uppercase tracking-widest opacity-60">GitHub Remote Connection</span>
                                                </div>
                                                {githubUrl && !isEditingRemote && (
                                                    <button onClick={() => setIsEditingRemote(true)} className="text-[9px] font-black uppercase text-primary-500 hover:underline">Change</button>
                                                )}
                                            </div>

                                            {(!githubUrl || isEditingRemote) ? (
                                                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                                    <div className="relative group">
                                                        <AtSign size={14} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-20 group-focus-within:opacity-100 transition-opacity" />
                                                        <input 
                                                            value={githubUrl} 
                                                            onChange={(e) => setGithubUrl(e.target.value)} 
                                                            className={`w-full bg-black/10 dark:bg-white/5 border-none rounded-2xl pl-12 pr-4 py-3 text-[12px] font-mono outline-none placeholder:opacity-20 focus:ring-2 focus:ring-primary-500/50 transition-all`} 
                                                            placeholder="git@github.com:user/repo.git" 
                                                        />
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button onClick={() => { handleGitConnectRemote(); setIsEditingRemote(false); }} className="flex-1 py-3 bg-primary-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-500 shadow-lg shadow-primary-900/30 transition-all">Link & Connect</button>
                                                        {isEditingRemote && <button onClick={() => setIsEditingRemote(false)} className="px-5 py-3 border border-white/10 rounded-2xl text-[10px] font-black uppercase opacity-40 hover:opacity-100 transition-all">Cancel</button>}
                                                    </div>
                                                    <p className="text-[9px] opacity-30 text-center uppercase tracking-widest">Supports SSH (git@) and HTTPS (.git)</p>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-3">
                                                    <p className="text-[11px] font-mono opacity-80 break-all bg-black/10 dark:bg-white/5 p-4 rounded-2xl border border-white/5 select-all cursor-copy" onClick={() => { navigator.clipboard.writeText(githubUrl); }} title="Click to copy repo URL">
                                                        {githubUrl}
                                                    </p>
                                                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-500 text-[9px] font-black uppercase tracking-widest w-fit">
                                                        <Link2 size={10} /> Established Node
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                                            <span className="text-[11px] font-black tracking-widest uppercase opacity-60">Branch: {gitStatus.branch || 'main'}</span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-2 opacity-30 text-[9px] font-bold">
                                            <AtSign size={10} /> {gitProfile.name || 'Author Name'}
                                        </div>
                                    </div>
                                    
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        {GIT_PRESETS.map(p => (
                                            <button key={p.label} onClick={() => setCommitMessage(p.text)} className={`px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${isDark ? 'bg-white/5 hover:bg-white/20 text-white/40' : 'bg-black/5 hover:bg-black/10 text-black/40'}`}>
                                                {p.emoji} {p.label}
                                            </button>
                                        ))}
                                    </div>

                                    <textarea value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} className={`w-full bg-black/5 dark:bg-white/5 border-none rounded-xl p-3 text-[12px] outline-none placeholder:opacity-30 min-h-[80px] resize-none mb-3`} placeholder="Message (Ctrl+Enter to commit)" />
                                    
                                    <div className="grid grid-cols-2 gap-3">
                                        <button onClick={handleGitCommit} disabled={gitLoading || !commitMessage.trim()} className="py-2.5 bg-primary-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-500 shadow-xl shadow-primary-900/30 disabled:opacity-30 transition-all">Commit</button>
                                        <button onClick={handleGitSync} disabled={gitLoading} className="py-2.5 bg-white/5 dark:bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 border border-white/5 transition-all flex items-center justify-center gap-2">
                                            <Zap size={10} /> Sync/Push
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-[9px] font-black uppercase tracking-widest opacity-20 mb-4 px-1">Changes ({gitStatus.files.filter(f => /\.(js|jsx|ts|tsx|py|html|css|json|md|c|cpp|h|go|rs|php|rb|sh|yml|yaml|sql|txt)$/i.test(f.file)).length})</p>
                                    <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                                        {gitStatus.files.filter(f => /\.(js|jsx|ts|tsx|py|html|css|json|md|c|cpp|h|go|rs|php|rb|sh|yml|yaml|sql|txt)$/i.test(f.file)).map(f => (
                                            <div key={f.file} onClick={() => handleOpenFile(f.file)} className={`group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${isDark ? 'bg-white/[0.02] border-white/5 hover:bg-white/5' : 'bg-white/40 border-black/[0.02] hover:bg-white shadow-sm'}`}>
                                                <div className="flex items-center gap-3 truncate">
                                                    <FileCode size={14} className="opacity-30 group-hover:text-primary-500 transition-colors" />
                                                    <span className="text-[12px] font-bold truncate opacity-80 group-hover:opacity-100">{f.file.split('/').pop()}</span>
                                                </div>
                                                <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-black ${f.status === 'M' ? 'text-yellow-500 bg-yellow-500/10' : (f.status === 'A' || f.status === '??' ? 'text-green-500 bg-green-500/10' : 'text-red-500 bg-red-500/10')}`}>{f.status === '??' ? 'U' : f.status}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-8 pt-6 border-t border-white/5 space-y-4">
                                    <div className="flex items-center justify-between px-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest opacity-30">Git Cheat Sheet</p>
                                        <button onClick={() => setShowCheatSheet(!showCheatSheet)} className={`text-[10px] font-black uppercase tracking-widest hover:text-primary-500 transition-all ${showCheatSheet ? 'text-primary-500' : 'opacity-40 hover:opacity-100'}`}>{showCheatSheet ? 'Hide' : 'Show'}</button>
                                    </div>
                                    
                                    {showCheatSheet && (
                                        <div className="grid grid-cols-1 gap-2 animate-in fade-in slide-in-from-top-2 duration-500">
                                            {[
                                                { cmd: 'git status', desc: 'Kiểm tra thay đổi' },
                                                { cmd: 'git pull origin main', desc: 'Cập nhật từ GitHub' },
                                                { cmd: 'git push origin main', desc: 'Đẩy lên GitHub' },
                                                { cmd: 'git log --oneline', desc: 'Lịch sử rút gọn' },
                                                { cmd: 'git checkout -b dev', desc: 'Tạo nhánh nháp' },
                                                { cmd: 'git reset --hard HEAD', desc: 'Về lại lúc nãy' }
                                            ].map(item => (
                                                <div key={item.cmd} onClick={() => { navigator.clipboard.writeText(item.cmd); }} className={`flex flex-col p-3 rounded-2xl border cursor-pointer transition-all ${isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-white border-black/5 hover:shadow-md'}`}>
                                                    <code className="text-[11px] font-bold text-primary-500">{item.cmd}</code>
                                                    <span className="text-[9px] opacity-40 mt-1 uppercase tracking-widest">{item.desc}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </>
            )}
        </div>

        <div className={`flex-1 flex flex-col relative overflow-hidden transition-colors duration-300 ${isDark ? 'bg-[#0a0a0c]' : 'bg-white'}`}>
            <div className={`flex items-center border-b transition-colors duration-300 ${isDark ? 'bg-[#0f0f12] border-white/5' : 'bg-[#f0ede1] border-black/[0.05]'}`}>
                <div className="flex-1 flex overflow-x-auto custom-scrollbar-h min-h-[48px] px-2">
                    {openTabs.map(path => (
                        <div key={path} onClick={() => setActiveTab(path)} className={`h-full px-6 flex items-center gap-4 cursor-pointer text-[12px] font-black uppercase tracking-widest transition-all relative border-r border-white/5
                            ${activeTab === path 
                                ? (isDark ? 'bg-gradient-to-b from-primary-500/10 to-transparent text-primary-400 opacity-100' : 'bg-white text-primary-600 shadow-sm') 
                                : 'opacity-30 hover:opacity-60 text-slate-400'}`}>
                            {path.split('/').pop()}
                            {pendingChanges[path] && <div className="w-2 h-2 rounded-full bg-primary-500 shadow-[0_0_8px_rgba(33,150,243,0.8)]" />}
                            <X 
                                size={15} 
                                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-white hover:bg-red-500 rounded-md p-1 transition-all ml-2" 
                                onClick={(e) => { e.stopPropagation(); setOpenTabs(prev => prev.filter(p => p !== path)); if (activeTab === path) setActiveTab(openTabs.filter(p => p !== path)[0] || null); }} 
                            />
                            {activeTab === path && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary-500" />}
                        </div>
                    ))}
                </div>
                {activeTab && (
                    <div className="flex items-center gap-2 px-4 border-l border-white/5">
                        <button onClick={() => handleSaveFile(activeTab)} disabled={saving[activeTab]} className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${pendingChanges[activeTab] ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/30' : 'opacity-40 hover:opacity-100'}`}>
                            {saving[activeTab] ? <RotateCcw size={10} className="animate-spin" /> : <Save size={10} />}
                            {saving[activeTab] ? 'Syncing...' : (pendingChanges[activeTab] ? 'Save & Push' : 'Saved')}
                        </button>
                        <button onClick={handleGitSync} className="p-2 opacity-30 hover:opacity-100 hover:text-primary-500 transition-all" title="Force Sync All"><Zap size={14}/></button>
                    </div>
                )}
            </div>
            <div className="flex-1 flex flex-col relative overflow-hidden">
                {activeTab ? (
                    <div className="flex-1 flex flex-col min-h-0">
                        {/* BREADCRUMBS - STICKY TOP */}
                        <div className={`sticky top-0 z-20 px-8 py-3 border-b backdrop-blur-3xl flex items-center gap-3 transition-colors ${isDark ? 'bg-[#0f0f12]/80 border-white/5' : 'bg-white/80 border-black/5'}`}>
                            <div className="w-2 h-2 rounded-full bg-primary-500 shadow-[0_0_10px_rgba(33,150,243,0.8)] animate-pulse" />
                            <span className="text-[12px] font-black uppercase tracking-[0.3em] opacity-40 truncate">{activeTab}</span>
                        </div>

                        <div className="flex-1 overflow-auto custom-scrollbar">
                            <div className="flex min-h-full relative overflow-x-hidden">
                                {/* AI RECONSTRUCTION OVERLAY */}
                                {proposingContents[activeTab] && (
                                    <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden flex">
                                        <div className="w-[40px] md:w-[60px]" /> {/* Spacer for line numbers */}
                                        <div className="flex-1 bg-primary-500/5 backdrop-blur-[1px] animate-pulse-slow px-4 md:px-10 pt-4 md:pt-10" />
                                    </div>
                                )}

                                {/* LINE NUMBERS */}
                                <div className={`p-4 md:p-10 pr-2 md:pr-4 text-right font-mono text-[11px] md:text-[14px] select-none opacity-20 border-r ${isDark ? 'border-white/5' : 'border-black/5'}`} style={{ minWidth: '40px', backgroundColor: 'transparent' }}>
                                    {(proposingContents[activeTab] || editingContents[activeTab] || '').split('\n').map((_, i) => (
                                        <div key={i} style={{ height: '1.9em', lineHeight: '1.9em' }}>{i + 1}</div>
                                    ))}
                                </div>
                                
                                {/* EDITOR CONTENT */}
                                <div className="flex-1 p-4 md:p-10 pt-4 md:pt-10 pl-4 md:pl-4 relative overflow-x-hidden">
                                    {proposingContents[activeTab] && (
                                        <div className="flex items-center gap-2 mb-6 text-[10px] font-bold text-primary-500 uppercase tracking-widest bg-primary-500/10 w-fit px-3 py-1 rounded-full">
                                            <Sparkles size={12}/> AI RECONSTRUCTION IN PROGRESS...
                                        </div>
                                    )}
                                    <Editor 
                                        value={proposingContents[activeTab] || editingContents[activeTab] || ''} 
                                        onValueChange={code => { setEditingContents(prev => ({ ...prev, [activeTab]: code })); if (code !== originalContents[activeTab]) setPendingChanges(p => ({ ...p, [activeTab]: true })); }} 
                                        highlight={code => highlight(code, (activeTab.endsWith('.py') ? languages.python : (activeTab.endsWith('.css') ? languages.css : (activeTab.endsWith('.html') ? languages.markup : languages.javascript))), activeTab.split('.').pop())} 
                                        padding={0} 
                                        style={{ fontFamily: '"Fira Code", "Fira Mono", monospace', fontSize: 13, minHeight: '100%', outline: 'none', caretColor: isDark ? '#fff' : '#000', color: isDark ? (proposingContents[activeTab] ? '#00ff99' : '#e2e8f0') : (proposingContents[activeTab] ? '#006644' : '#2d2d2d'), lineHeight: '1.9em', transition: 'color 0.3s ease' }} 
                                    />
                                    {proposingContents[activeTab] && !isChatStreaming && (
                                        <div className="mt-12 flex gap-4 animate-in fade-in slide-in-from-top-2 duration-500 pb-10">
                                            <button onClick={() => { setEditingContents(prev => ({ ...prev, [activeTab]: proposingContents[activeTab] })); setProposingContents(prev => ({ ...prev, [activeTab]: null })); setPendingChanges(prev => ({ ...prev, [activeTab]: true })); }} className="px-6 py-2.5 bg-primary-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-primary-500 shadow-xl shadow-primary-900/40">Accept Reconstruction</button>
                                            <button onClick={() => setProposingContents(prev => ({ ...prev, [activeTab]: null }))} className={`px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/5 transition-all`}>Discard</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center space-y-8 opacity-05">
                        <div className="relative group">
                            <Brain size={160} className="text-primary-500/10 group-hover:text-primary-500/20 transition-all duration-700" />
                            <div className="absolute inset-0 bg-primary-500/5 blur-[100px] rounded-full" />
                        </div>
                        <span className="text-[12px] font-black uppercase tracking-[2em] opacity-10">Core Stable</span>
                    </div>
                )}
                {/* TELEMETRY FEED - REFINED */}
                <div className={`transition-all duration-500 ease-in-out border-t overflow-hidden flex flex-col ${showDiagnostics ? 'h-48' : 'h-10'} ${isDark ? 'bg-[#08080a] border-white/5' : 'bg-[#f5f2e8] border-black/5'}`}>
                    <div onClick={() => setShowDiagnostics(!showDiagnostics)} className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-white/5 transition-colors shrink-0">
                        <div className="flex items-center gap-3 font-black uppercase tracking-[0.4em] opacity-40 text-primary-500 text-[10px]">
                             <Activity size={12} className={showDiagnostics ? "animate-pulse" : ""} /> 
                             Pulse Diagnostics
                        </div>
                        <div className="flex items-center gap-4">
                            {!showDiagnostics && systemLogs.length > 0 && (
                                <span className="text-[9px] font-mono opacity-40 truncate max-w-[200px] hidden md:block">{systemLogs[systemLogs.length-1]}</span>
                            )}
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-green-500/10 text-green-500 border border-green-500/20 text-[8px] font-bold tracking-widest animate-pulse">LIVE_NODE</div>
                            <ChevronDown size={14} className={`transition-transform duration-300 opacity-40 ${showDiagnostics ? '' : 'rotate-180'}`} />
                        </div>
                    </div>
                    {showDiagnostics && (
                        <div className={`p-6 pt-0 overflow-auto font-mono text-[12px] space-y-2 flex-1 custom-scrollbar ${isDark ? 'text-slate-500 shadow-[inset_0_20px_40px_rgba(0,0,0,0.5)]' : 'text-slate-400 shadow-inner'}`}>
                            {systemLogs.map((log, i) => (
                                <div key={i} className={`flex gap-4 group/log py-0.5 border-l-2 pl-3 transition-all ${log.startsWith('[THOUGHT]') ? 'border-primary-500/40 text-primary-500/70' : 'border-transparent hover:border-slate-800'}`}>
                                    <span className="opacity-20 shrink-0 select-none text-[10px]">[{new Date().toLocaleTimeString()}]</span>
                                    <span className="truncate group-hover/log:whitespace-normal group-hover/log:break-all">{log}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Chat Sidebar - Responsive Drawer */}
        {showChat && (
            <div 
                className="fixed inset-0 bg-black/60 z-[80] md:hidden animate-fade-in backdrop-blur-sm"
                onClick={() => setShowChat(false)}
            />
        )}
        
        <div className={`w-[280px] md:w-[460px] border-l flex flex-col z-[90] transition-all duration-300 h-full overflow-x-hidden
            ${showChat ? 'translate-x-0 fixed right-0' : 'translate-x-full fixed right-[-460px] md:relative md:right-0'} 
            ${isDark ? 'bg-[#0a0a0c] border-white/5 shadow-2xl shadow-black/80' : 'bg-[#f5f2eb] border-black/[0.05]'}`}>
            
            {!showChat && (
                <button onClick={() => setShowChat(true)} className={`hidden md:flex absolute left-[-40px] top-1/2 -translate-y-1/2 w-10 h-20 border rounded-l-2xl items-center justify-center shadow-2xl hover:scale-105 transition-all ${isDark ? 'bg-[#111114] border-white/10 text-primary-400' : 'bg-[#f5f2eb] border-black/5'}`}>
                    <Sparkles size={24} />
                </button>
            )}
            <div className={`p-6 md:p-8 flex items-center justify-between`}>
                <div className="flex items-center gap-3 md:gap-4 min-w-0">
                    <div className="flex-shrink-0 w-8 h-8 md:w-10 md:h-10 bg-primary-600 rounded-xl md:rounded-2xl flex items-center justify-center text-white shadow-2xl shadow-primary-600/30">
                        <Zap size={16} />
                    </div>
                    <h2 className="text-[12px] md:text-[14px] font-black uppercase tracking-[0.2em] md:tracking-[0.4em] truncate">HatAI Code</h2>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={handleNewChat}
                        title="Tạo đoạn chat mới"
                        className={`p-2 rounded-xl transition-all flex items-center gap-2 border ${isDark ? 'hover:bg-primary-500/10 border-white/5 text-primary-400 hover:text-primary-300' : 'hover:bg-primary-50 border-black/5 text-primary-600'}`}
                    >
                        <Plus size={18} />
                        <span className="text-[10px] font-black uppercase tracking-widest hidden md:inline">New Chat</span>
                    </button>
                    <button 
                        onClick={() => setShowChat(false)} 
                        className={`p-2 rounded-xl transition-all ${isDark ? 'hover:bg-white/5 text-slate-500 hover:text-white' : 'hover:bg-black/5 text-slate-300 hover:text-black'}`}
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-8 py-6 space-y-10 custom-scrollbar scroll-smooth" ref={chatScrollRef}>
                {chatMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-20 animate-fade-in">
                        <div className="relative group">
                            <Bot size={80} className="mb-8 text-primary-500 opacity-20 group-hover:opacity-40 transition-opacity" />
                            <div className="absolute inset-0 bg-primary-500/20 blur-[60px] rounded-full animate-pulse opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <h3 className="text-xl font-black uppercase tracking-[0.4em] mb-4 opacity-60">HatAI Code Agent</h3>
                        <p className="text-[12px] opacity-40 max-w-[280px] leading-relaxed font-bold mb-12">Chuyên gia lập trình tự động với quyền truy cập hệ thống toàn diện.</p>
                        
                        <div className="grid grid-cols-1 gap-3 w-full max-w-[320px]">
                            {[
                                { t: '🚀 Review dự án hiện tại', p: 'Review toàn bộ codebase và tìm lỗi tiềm ẩn' },
                                { t: '📝 Tạo README chuyên nghiệp', p: 'Viết tài liệu hướng dẫn đầy đủ cho repository này' },
                                { t: '🛠️ Fix lỗi UI / UX', p: 'Tìm và sửa các lỗi giao diện trong frontend' },
                                { t: '📦 Push toàn bộ lên GitHub', p: 'Commit và đẩy mã nguồn lên cloud' }
                            ].map(item => (
                                <button key={item.t} onClick={() => setChatInput(item.t)} className={`group relative p-5 text-left rounded-3xl border transition-all duration-300 ${isDark ? 'bg-white/[0.02] border-white/5 hover:border-primary-500/40 hover:bg-primary-500/[0.05]' : 'bg-white border-black/[0.03] hover:border-primary-500/40 hover:shadow-xl'}`}>
                                    <div className="text-[12px] font-black uppercase tracking-widest mb-1 group-hover:text-primary-500 transition-colors">{item.t}</div>
                                    <div className="text-[10px] opacity-40 font-medium leading-relaxed">{item.p}</div>
                                    <ArrowRight size={14} className="absolute right-5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all text-primary-500" />
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    chatMessages.map((msg, i) => (
                        <div key={i} className={`flex flex-col gap-6 w-full animate-slide-up mb-8 last:mb-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`} style={{ animationDelay: `${i * 100}ms` }}>
                            
                            {/* Role Header - ADVANCED */}
                            <div className="flex items-center gap-3 px-1">
                                {msg.role === 'user' ? (
                                    <>
                                        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-500/10 border border-slate-500/20">
                                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Command Node</span>
                                        </div>
                                        <div className="flex-1 h-[1px] bg-gradient-to-r from-slate-500/20 to-transparent" />
                                    </>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-3 px-4 py-1.5 rounded-xl bg-gradient-to-r from-amber-600/20 to-transparent border-l-4 border-amber-600">
                                            <div className={`w-2 h-2 rounded-full shadow-[0_0_12px_rgba(217,119,6,0.8)] ${isChatStreaming && (i === chatMessages.length - 1) ? 'bg-amber-500 animate-pulse' : 'bg-amber-600'}`} />
                                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-600">Core Engine</span>
                                        </div>
                                        <div className="flex-1 h-[1px] bg-gradient-to-r from-amber-600/20 to-transparent" />
                                    </>
                                )}
                            </div>

                            {msg.role === 'user' ? (
                                <div className="flex flex-col items-end gap-3 max-w-[90%]">
                                    {msg.attachments && msg.attachments.length > 0 && (
                                        <div className="flex flex-wrap gap-2 justify-end mb-2">
                                            {msg.attachments.map((file, idx) => (
                                                <div key={idx} className={`relative group w-16 h-16 rounded-xl overflow-hidden border ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                                                    {file.type?.startsWith('image') ? <img src={file.url} className="w-full h-full object-cover" /> : <div className="flex flex-col items-center justify-center h-full gap-1 opacity-40"><FileCode size={16}/><span className="text-[7px] uppercase font-black">File</span></div>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className={`px-6 py-4 text-[14px] leading-relaxed font-bold border transition-all ${isDark ? 'bg-[#121217] border-white/5 text-slate-100 rounded-[28px] rounded-tr-none shadow-2xl shadow-black/40' : 'bg-white border-black/[0.03] text-slate-800 rounded-[28px] rounded-tr-none shadow-xl shadow-black/5'}`}>
                                        {msg.content}
                                    </div>
                                </div>
                                ) : (
                                    <div className="flex flex-col gap-4 w-full max-w-full pl-2">
                                        {(() => {
                                            const events = parseEventsFromContent(msg.content)
                                            const toolCallCounters = {}
                                            const thinkingContent = msg.thoughts || events.filter(e => e.type === 'thinking').map(e => e.content).join('\n\n')
                                            const results = events.filter(e => e.type !== 'thinking')
                                            
                                            return (
                                                <>
                                                    {(thinkingContent || (isChatStreaming && (i === chatMessages.length - 1))) && (
                                                        <ThinkingBlock
                                                            thinking={thinkingContent}
                                                            isStreaming={isChatStreaming && (i === chatMessages.length - 1)}
                                                            isThinkingComplete={!isChatStreaming}
                                                        />
                                                    )}
                                                    {results.map((item, idx) => {
                                                        if (item.type === 'tool_call') {
                                                            const callIdx = toolCallCounters[item.tool] ?? 0
                                                            toolCallCounters[item.tool] = callIdx + 1
                                                            const resultEv = events.find(e => {
                                                                if (e.type !== 'tool_result' || e.tool !== item.tool) return false
                                                                return events.filter(res => res.type === 'tool_result' && res.tool === item.tool).indexOf(e) === callIdx
                                                            })
                                                            return <ToolStep key={idx} step={{ tool: item.tool, args: item.args, result: resultEv?.result }} isStreaming={isChatStreaming && (i === chatMessages.length - 1)} />
                                                        }
                                                        if (item.type === 'text') {
                                                            return (
                                                                <div key={idx} className={`prose prose-sm max-w-none prose-p:leading-relaxed prose-p:text-[14px] prose-p:mb-4 last:prose-p:mb-0 transition-colors ${isDark ? 'prose-invert text-slate-300' : 'text-slate-700'}`}>
                                                                    <ChatMarkdown content={item.content} />
                                                                </div>
                                                            )
                                                        }
                                                        if (item.type === 'step') {
                                                            return (
                                                                <div key={idx} className={`flex items-center gap-3 px-4 py-3 mb-6 rounded-2xl border animate-fade-in ${isDark ? 'bg-primary-500/10 border-primary-500/20 text-primary-400' : 'bg-primary-50 border-primary-200 text-primary-700'}`}>
                                                                    <div className="p-1.5 bg-primary-500/20 rounded-lg"><Activity size={14} className="animate-pulse" /></div>
                                                                    <span className="text-[11px] font-black uppercase tracking-widest leading-none">{item.content}</span>
                                                                </div>
                                                            )
                                                        }
                                                        if (item.type === 'plan') {
                                                            return <Roadmap key={idx} content={item.content} isDark={isDark} />
                                                        }
                                                        if (item.type === 'screenshot') {
                                                            return (
                                                                <div key={idx} className="group relative overflow-hidden rounded-2xl border border-white/5 shadow-2xl mb-4">
                                                                    <img src={item.url} alt="Result" className="w-full h-auto object-contain brightness-90 group-hover:brightness-110" />
                                                                </div>
                                                            )
                                                        }
                                                        return null
                                                    })}
                                                </>
                                            )
                                        })()}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                
                {agentStatus && (
                    <div className="flex items-center gap-4 px-6 py-3 rounded-full border border-primary-500/20 bg-primary-500/5 text-primary-500 text-[11px] font-black uppercase tracking-[0.2em] w-fit animate-pulse shadow-2xl shadow-primary-900/20 backdrop-blur-xl border-l-[3px] border-primary-500">
                      <div className="relative">
                        <Cpu size={16} className="animate-spin-slow" />
                        <div className="absolute inset-0 bg-primary-500 blur-md opacity-40 animate-pulse" />
                      </div>
                      <span className="opacity-80 transition-all">{agentStatus}</span>
                    </div>
                )}
                
                <div ref={messagesEndRef} className="h-12" />
            </div>
            <div className="p-8 pb-12 pt-4 relative">
                {/* MENTIONS & SLASH COMMANDS UI */}
                {showMentions && mentionFiles.length > 0 && (
                    <div className={`absolute bottom-full left-8 right-8 mb-4 rounded-2xl border shadow-3xl z-[800] overflow-hidden ${isDark ? 'bg-[#1a1a1f] border-white/10 shadow-black' : 'bg-white border-black/10'}`}>
                        <div className="px-4 py-2 text-[10px] font-black opacity-30 border-b border-white/5 uppercase tracking-widest">Suggest Files & Folders</div>
                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                            {mentionFiles.map(f => (
                               <button key={f.path} onClick={() => handleMentionSelect(f)} className={`w-full flex items-center gap-3 px-4 py-3 text-[12px] text-left transition-all ${isDark ? 'hover:bg-primary-600 text-slate-300 hover:text-white' : 'hover:bg-primary-50 text-slate-600 hover:text-primary-700'}`}>
                                   {f.type === 'folder' ? <ChevronRight size={14} className="opacity-40 text-amber-500" /> : <FileCode size={14} className="opacity-40" />}
                                   <span className="font-bold">{f.name}</span>
                                   <span className="opacity-30 text-[10px] truncate ml-auto">{f.path}</span>
                               </button>
                            ))}
                        </div>
                    </div>
                )}

                {slashQuery !== null && filteredWorkflows.length > 0 && (
                    <div className={`absolute bottom-full left-8 right-8 mb-4 rounded-2xl border shadow-3xl z-[800] overflow-hidden ${isDark ? 'bg-[#1a1a1f] border-white/10 shadow-black' : 'bg-white border-black/10'}`}>
                        <div className="px-4 py-2 text-[10px] font-black opacity-30 border-b border-white/5 uppercase tracking-widest text-primary-500">Available Workflows</div>
                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                            {filteredWorkflows.map(w => (
                               <button key={w.id} onClick={(e) => {
                                   const lastSlash = chatInput.lastIndexOf('/')
                                   const before = chatInput.substring(0, lastSlash)
                                   const after = chatInput.substring(lastSlash + slashQuery.length + 1)
                                   setChatInput(before + '/' + w.name + ' ' + after)
                                   chatInputRef.current.focus()
                               }} className={`w-full flex items-center gap-4 px-4 py-3.5 text-[12px] text-left transition-all border-b last:border-0 ${isDark ? 'hover:bg-primary-600 border-white/5 text-slate-300 hover:text-white' : 'hover:bg-primary-50 border-black/5 text-slate-600 hover:text-primary-700 font-medium'}`}>
                                   <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                                       <w.icon size={18} className="text-primary-500" />
                                   </div>
                                   <div className="flex flex-col">
                                       <span className="font-black uppercase tracking-widest text-[11px]">{w.name}</span>
                                       <span className="opacity-40 text-[10px] mt-0.5">{w.desc}</span>
                                   </div>
                               </button>
                            ))}
                        </div>
                    </div>
                )}
                {/* CONTEXT LOCK INDICATOR - ENHANCED */}
                {activeTab && (
                    <div className="flex px-6 mb-2">
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-widest animate-pulse-slow ${editingContents[activeTab] ? (isDark ? 'bg-primary-500/10 border-primary-500/20 text-primary-500' : 'bg-primary-100/50 border-primary-200 text-primary-700') : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-500'}`}>
                            <Link2 size={10} /> {editingContents[activeTab] ? 'Focus Ready' : 'Syncing Context'}: {activeTab.split('/').pop()}
                        </div>
                    </div>
                )}

                <div className={`border rounded-[32px] p-2 flex flex-col gap-1 transition-all ${isDark ? 'bg-[#111114] border-white/10 focus-within:border-primary-500/50 shadow-inner' : 'bg-[#ede8d8]/60 border-black/10 focus-within:border-black/20 shadow-sm'}`}>
                    
                    {/* ATTACHMENT PREVIEW - NEW */}
                    {attachments.length > 0 && (
                        <div className="flex gap-4 px-4 pt-2 overflow-x-auto custom-scrollbar-h pb-1">
                             {attachments.map((file, idx) => (
                                 <div key={idx} className="relative group shrink-0">
                                     <div className={`w-20 h-20 rounded-2xl overflow-hidden border ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                                         {file.type?.startsWith('image') ? <img src={file.url} className="w-full h-full object-cover" /> : <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40"><FileCode size={20}/><span className="text-[8px] uppercase font-black">File</span></div>}
                                     </div>
                                     <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 opacity-0 group-hover:opacity-100 transition-all"><X size={12} /></button>
                                 </div>
                             ))}
                        </div>
                    )}

                    <textarea 
                        ref={chatInputRef} 
                        className={`w-full bg-transparent px-5 py-3 text-[15px] outline-none min-h-[75px] max-h-[300px] resize-none font-bold transition-all ${isDark ? 'placeholder:opacity-20 text-white' : 'placeholder:opacity-50 text-slate-900'}`} 
                        placeholder="Sync thoughts..." 
                        value={chatInput} 
                        onChange={(e) => setChatInput(e.target.value)} 
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }} 
                    />
                    <div className="flex items-center justify-between px-4 pb-2">
                        <div className="flex gap-2 relative">
                            <input type="file" id="media-upload" className="hidden" onChange={handleFileUpload} accept="image/*,application/pdf" />
                            <button onClick={(e) => { e.stopPropagation(); setIsContextOpen(!isContextOpen); }} className={`w-10 h-10 flex items-center justify-center rounded-full border shadow-sm transition-all duration-300 active:scale-90 ${isContextOpen ? 'bg-primary-600 border-primary-500 text-white shadow-lg' : (isDark ? 'bg-white/5 border-white/10 text-slate-400' : 'bg-white/80 border-black/5 text-slate-500 shadow-sm')}`}>{isUploadingMedia ? <Activity size={18} className="animate-spin" /> : <Plus size={18} className={`transition-transform duration-300 ${isContextOpen ? 'rotate-45' : ''}`} />}</button>
                            {isContextOpen && (
                                <div className={`absolute bottom-[calc(100%+12px)] left-0 w-60 p-2 rounded-2xl border shadow-3xl z-[900] animate-slide-up backdrop-blur-3xl ${isDark ? 'bg-[#1a1a1f]/98 border-white/10 shadow-black' : 'bg-[#f0ede1]/95 border-black/10'}`}>
                                    <div className={`px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] opacity-40 border-b mb-1 ${isDark ? 'border-white/5' : 'border-black/[0.05]'}`}>Context Hub</div>
                                    <div className="space-y-1">
                                        {[
                                            { id: 'media', label: 'Media', icon: ImageIcon, color: 'text-orange-500', action: () => document.getElementById('media-upload').click() },
                                            { id: 'mentions', label: 'Mentions', icon: AtSign, color: 'text-primary-500', action: () => { setChatInput(p => p + '@'); setIsContextOpen(false); chatInputRef.current.focus(); } },
                                            { id: 'workflows', label: 'Workflows', icon: SquareSlash, color: 'text-primary-500', action: () => { setChatInput(p => p + '/'); setIsContextOpen(false); chatInputRef.current.focus(); } }
                                        ].map(item => (
                                            <button key={item.id} onClick={(e) => { e.stopPropagation(); item.action(); }} className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all ${isDark ? 'hover:bg-white/5 text-slate-300 hover:text-white' : 'hover:bg-black/5 text-slate-700 hover:text-black font-bold'}`}><div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDark ? 'bg-white/5' : 'bg-black/5'}`}><item.icon size={18} className={item.color} /></div><span className="text-[13px]">{item.label}</span></button>
                                        ))}
                                    </div>
                                </div>
                            )}

                        </div>
                        <button onClick={handleSendChat} disabled={!chatInput.trim() || isChatStreaming} className={`w-12 h-12 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 ${isChatStreaming ? 'bg-primary-500/20 text-primary-500 animate-pulse' : (isDark ? 'bg-primary-600 hover:bg-primary-500 text-white shadow-primary-900/40' : 'bg-white hover:bg-primary-600 text-slate-600 hover:text-white')}`}>{isChatStreaming ? <Bot size={22} className="animate-bounce" /> : <ArrowRight size={24} />}</button>
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  )
}
