/**
 * The streaming-agent avatar: a robot whose speech-bubble tail sits on the
 * centre line, so the whole glyph is symmetric about x=12. Lucide's
 * BotMessageSquare puts the tail in the bottom-left corner, which reads as
 * lopsided at the size the chat uses it.
 *
 * Drawn on lucide's 24×24 grid with the same stroke conventions so it sits
 * beside the other icons without visual seams.
 */
export function AgentBotIcon({
  size = 22,
  className,
}: {
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Body with a centred tail */}
      <path d="M6 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4l-2 4-2-4H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      {/* Antenna */}
      <path d="M12 6V3" />
      <circle cx="12" cy="1.6" r="1.1" fill="currentColor" stroke="none" />
      {/* Eyes */}
      <path d="M9 11v2" />
      <path d="M15 11v2" />
      {/* Side vents */}
      <path d="M2 12h2" />
      <path d="M20 12h2" />
    </svg>
  )
}
