import React from 'react'

export default function Card({ children, className = '', ...props }) {
  return (
    <div 
      className={`bg-white dark:bg-dark-900 border border-light-200 dark:border-slate-800/60 rounded-2xl shadow-sm transition-all duration-300 hover:shadow-md ${className}`} 
      {...props}
    >
      {children}
    </div>
  )
}
