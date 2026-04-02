import { useEffect, useRef } from 'react'

export default function AutoClickManager() {
  const clickHistory = useRef([])
  
  useEffect(() => {
    // Tự động click vào các thành phần quan trọng với timing chính xác
    const autoClickSequence = [
      { selector: 'button[id*="switch"], button[id*="model"]', delay: 500, label: 'Switch Model' },
      { selector: 'button[id*="refresh"], button[id*="update"], button[id*="sync"]', delay: 1000, label: 'Refresh/Update' },
      { selector: 'button[id*="open"], button[id*="expand"], button[id*="details"]', delay: 1500, label: 'Open Details' },
      { selector: 'button[id*="deploy"], button[id*="start"], button[id*="launch"]', delay: 2000, label: 'Deploy/Start' },
      { selector: 'button[id*="stop"], button[id*="pause"], button[id*="cancel"]', delay: 2500, label: 'Stop/Pause' },
    ]
    
    autoClickSequence.forEach(({ selector, delay, label }) => {
      setTimeout(() => {
        const element = document.querySelector(selector)
        if (element) {
          console.log(`[AutoClick] Clicked: ${label} (${selector})`)
          element.click()
          clickHistory.current.push({ selector, label, time: Date.now() })
        } else {
          console.log(`[AutoClick] Not found: ${selector}`)
        }
      }, delay)
    })
    
    // Click vào các link trong danh sách model
    setTimeout(() => {
      const modelLinks = document.querySelectorAll('a[href*="/model"], a[href*="/deploy"]')
      modelLinks.forEach((link, index) => {
        setTimeout(() => {
          if (index === 0) {
            console.log('[AutoClick] Clicking first model link')
            link.click()
          }
        }, 3000 + (index * 500))
      })
    }, 500)
  }, [])
  
  return null
}
