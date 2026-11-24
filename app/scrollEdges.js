const EDGE_TOLERANCE = 2

export default function observeScrollEdges(root, scrollSelectors) {
  const selector = scrollSelectors.join(', ')
  let frame = 0
  let watched = new Set()
  let scrollAreas = new Set()

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  const resizeObserver = new ResizeObserver(schedule)
  const mutationObserver = new MutationObserver(schedule)

  function update() {
    frame = 0
    const areas = new Set(root.querySelectorAll(selector))
    const nextWatched = new Set(areas)
    const edges = []
    for (const area of areas) {
      for (const child of area.children) nextWatched.add(child)
      const canScroll = ['auto', 'scroll'].includes(getComputedStyle(area).overflowY)
      const below = area.scrollHeight - area.clientHeight - area.scrollTop
      edges.push([area, canScroll && area.scrollTop > EDGE_TOLERANCE, canScroll && below > EDGE_TOLERANCE])
    }

    for (const node of watched) if (!nextWatched.has(node)) resizeObserver.unobserve(node)
    for (const node of nextWatched) if (!watched.has(node)) resizeObserver.observe(node)
    for (const area of scrollAreas) if (!areas.has(area)) edges.push([area, false, false])
    for (const [area, above, below] of edges) {
      area.toggleAttribute('data-wren-scroll-above', above)
      area.toggleAttribute('data-wren-scroll-below', below)
    }
    watched = nextWatched
    scrollAreas = areas
  }

  const onScroll = (event) => {
    if (scrollAreas.has(event.target)) schedule()
  }
  root.addEventListener('scroll', onScroll, { capture: true, passive: true })
  mutationObserver.observe(root, { childList: true, subtree: true })
  window.addEventListener(
    'pagehide',
    () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      root.removeEventListener('scroll', onScroll, true)
    },
    { once: true }
  )
  schedule()
}
