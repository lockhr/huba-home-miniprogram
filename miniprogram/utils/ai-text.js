function cleanAssistantText(value) {
  let text = typeof value === 'string' ? value : ''
  text = text.replace(/\r\n?/g, '\n')
  text = text.replace(/<br\s*\/?\s*>/gi, '\n')
  text = text.replace(/<\/?[^>]+>/g, '')
  text = text.replace(/```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)```/g, '$1')
  text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]+\)/g, '$1')
  text = text.replace(/^\s{0,3}#{1,6}\s*/gm, '')
  text = text.replace(/^\s*>\s?/gm, '')
  text = text.replace(/^\s*[-*+]\s+/gm, '· ')
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
  text = text.replace(/\*([^*\n]+)\*/g, '$1')
  text = text.replace(/_([^_\n]+)_/g, '$1')
  text = text.replace(/`([^`\n]+)`/g, '$1')
  text = text.split('\n').filter(line => {
    if (!line.includes('|')) return true
    const cells = line.replace(/^\s*\||\|\s*$/g, '').split('|').map(cell => cell.trim())
    return !cells.length || !cells.every(cell => /^:?-{3,}:?$/.test(cell))
  }).map(line => {
    if (!line.includes('|')) return line
    return line.replace(/^\s*\||\|\s*$/g, '').split('|').map(cell => cell.trim()).filter(Boolean).join(' · ')
  }).join('\n')
  text = text.replace(/[ \t]+\n/g, '\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

module.exports = { cleanAssistantText }
