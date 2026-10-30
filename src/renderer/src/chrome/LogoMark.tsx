export function LogoMark({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className="logo-mark">
      <path d="M256 138C290 133 308 132 322 134L418 230C420 243 420 256 418 270C406 362 330 446 256 474C182 446 106 362 94 270C80 176 160 124 256 138Z" fill="#E63946" />
      <path d="M322 134L418 230L334 220Z" fill="#FBE3E1" />
      <path d="M334 220L418 230L410 240Z" fill="#C42E3B" />
      {[
        [196, 222],
        [256, 212],
        [166, 280],
        [226, 272],
        [286, 272],
        [346, 280],
        [196, 334],
        [256, 328],
        [316, 334],
        [226, 388],
        [286, 388]
      ].map(([cx, cy]) => (
        <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx="7" ry="10" fill="#FFD166" />
      ))}
      <path
        d="M256 160C228 160 196 146 178 124C204 120 226 124 240 132C232 112 236 92 256 76C276 92 280 112 272 132C286 124 308 120 334 124C316 146 284 160 256 160Z"
        fill="#2E9E4F"
      />
      <rect x="249" y="40" width="14" height="44" rx="7" fill="#2E9E4F" />
    </svg>
  )
}
